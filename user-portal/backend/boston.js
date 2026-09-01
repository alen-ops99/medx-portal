/**
 * boston.js — "Building Bridges in Biomedicine — Boston" public wing (additive, self-contained).
 *
 * Monday, 21 September 2026 · 6:00–9:00 PM (doors 5:30 PM) · Waterhouse Room, Gordon Hall,
 * 25 Shattuck Street, Harvard Medical School, Boston, MA. Free, business attire,
 * co-organized with the Harvard Medical Postdoc Association (HMPA).
 *
 * Mounted from server.js as: require('./boston')(app, { query, saveDb, sendEmail, flushDb, JWT_SECRET })
 *   - query     — server.js's { run, get, all } helper (run() persists via saveDb itself)
 *   - sendEmail — server.js's sendEventConfirmation (CCs Laura on every confirmation)
 *   - flushDb   — optional durability flush after inserts (same call the sibling
 *                 /api/public-events/register makes); absent → skipped
 *   - JWT_SECRET— HMAC key for every no-login token this wing mints
 *
 * Routes (all additive — nothing existing is touched):
 *   GET  /boston                              — standalone registration page (ink/cream/crimson/gold)
 *   GET  /boston/hero.jpg, /boston/hmpa.png   — page assets served from this backend
 *   POST /api/boston/register                 — register (dedupe by email → re-send, {already:true})
 *   GET  /boston.ics                          — single-VEVENT calendar file (18:00–21:00 EDT = 22:00Z–01:00Z)
 *   GET  /api/boston/pass/:token.pkpass       — HMAC-tokenized Apple Wallet pass (no login)
 *   GET  /api/boston/qr/:id.png               — entry QR with the Med&X × HMPA plate composited in the
 *                                               middle (EC level H so the overlay never hurts scanning);
 *                                               same payload as the prod /qr/:id.png bridges branch
 *   GET  /boston/upload/:token                — personal 5-minute-presentation upload page (no login)
 *   POST /api/boston/upload/:token            — multipart upload → S3 (25 MB cap, magic-byte checked)
 *   GET  /boston/presentations?key=…          — team page: who requested / who uploaded, links, downloads
 *   GET  /api/boston/presentations?key=…      — the same data as JSON (for the v2 admin portal later)
 *   GET  /api/boston/presentations/:id/download?key=… — 302 → 15-minute presigned S3 GET
 *   GET  /api/boston/registrations.csv?key=…  — full registrant export (UTF-8 BOM, quoted, CRLF)
 *
 * Storage: the existing bridges_events / bridges_registrations tables (event row find-or-created with
 * the FIXED id below), plus bridges_presentations (created lazily here) for uploaded talk files.
 * Presentation files live in the private S3 bucket BB_S3_BUCKET under
 * boston-2026/<registrationId>/<presentationId>.<ext> — every upload is a new key + a new history row;
 * the NEWEST row per registrant is authoritative. S3 access is a ~90-line SigV4 signer over plain
 * node crypto+https (PUT + presigned GET are all we need) — no @aws-sdk/* in the dependency tree.
 * All BB_S3_* env is read lazily per request: with the env absent the wing still mounts and answers
 * ("uploads open soon" on the personal page, 503 JSON on the API, admin list still renders).
 */
'use strict';

const path = require('path');
const crypto = require('crypto');
const https = require('https');
const fs = require('fs');
const emailTemplates = require('./v2/email-templates');
const applePass = require('./v2/apple-pass');
const wallet = require('../../shared/wallet');

// Optional libraries, resolved once. multer is the multipart parser server.js already uses (in
// package.json — always present on Render); qrcode + pngjs render/composite the branded entry QR.
// try/require so a dependency-free checkout (the hermetic test suite) still loads the module:
// absent libs degrade per-route (upload API → 503, branded QR → 302 to the plain /qr/:id.png).
function tryRequire(name) { try { return require(name); } catch (e) { return null; } }
const multerLib = tryRequire('multer');
const QRCodeLib = tryRequire('qrcode');
const pngjsLib = tryRequire('pngjs');

// ---------------------------------------------------------------- event constants
const EVENT_ID = 'bb-boston-2026-09-21';
const EVENT_SLUG = 'boston-2026';
const EVENT_NAME = 'Building Bridges in Biomedicine — Boston';
const EVENT_DATE = '2026-09-21';                       // Monday (verified)
const DATE_LONG = 'Monday, 21 September 2026';
const VENUE_NAME = 'Waterhouse Room, Gordon Hall';
const VENUE_ADDRESS = 'Harvard Medical School, Boston, MA';
const VENUE_FULL = 'Waterhouse Room, Gordon Hall · 25 Shattuck Street, Harvard Medical School, Boston, MA';
const SUPPORT_EMAIL = 'laura.rodman@medx.hr';
const DRESS = 'Business attire';
const EVENT_DESC = 'An evening of panels on Croatia–US biomedical collaboration, five-minute participant presentations, and a networking reception — co-organized with the Harvard Medical Postdoc Association.';
// 18:00–21:00 America/New_York on 2026-09-21 is EDT (UTC−4; US DST ends 1 Nov 2026) → 22:00Z–01:00Z.
const DTSTART_UTC = '20260921T220000Z';
const DTEND_UTC = '20260922T010000Z';
// The one place the page states when & where (the date must appear exactly once on /boston).
const WHEN_WHERE_HTML = `<b>${DATE_LONG} · 6:00–9:00 PM</b> (doors from 5:30 PM)<br>Waterhouse Room, Gordon Hall (25 Shattuck St), Harvard Medical School`;

// ---------------------------------------------------------------- presentation-upload constants
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;             // 25 MB
const UPLOAD_TYPES = {                                  // accepted extensions → stored Content-Type
    pdf:  { mime: 'application/pdf' },
    ppt:  { mime: 'application/vnd.ms-powerpoint' },
    pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
    key:  { mime: 'application/vnd.apple.keynote' }
};
const ACCEPT_ATTR = '.pdf,.ppt,.pptx,.key';

const LOGO_URL = process.env.EMAIL_LOGO_URL || 'https://cdn.jsdelivr.net/gh/alen-ops99/medx-portal@main/user-portal/frontend/assets/images/medx-logo.png';
const baseUrl = () => String(process.env.RENDER_EXTERNAL_URL || 'https://medx-user-portal.onrender.com').replace(/\/+$/, '');
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ticketNo = id => 'BB-BOS-' + String(id).slice(0, 8).toUpperCase();
const shortCode = id => String(id).slice(0, 8).toUpperCase();
const prettySize = n => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
const fmtWhen = iso => {
    const d = new Date(String(iso).includes('T') ? iso : String(iso).replace(' ', 'T') + 'Z');
    if (isNaN(d)) return String(iso || '');
    const s = d.toISOString();
    return s.slice(0, 10) + ' · ' + s.slice(11, 16) + ' UTC';
};
const sanitizeFilename = n => String(n || 'presentation').replace(/[\/\\]/g, ' ').replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 180) || 'presentation';

// Magic-byte check — the extension must match what the bytes actually are.
function magicOk(ext, buf) {
    if (!buf || buf.length < 8) return false;
    const starts = sig => sig.every((b, i) => buf[i] === b);
    if (ext === 'pdf') return buf.slice(0, 1024).includes('%PDF');   // the PDF spec allows a short preamble
    if (ext === 'ppt') return starts([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])  // OLE2 compound file
        || starts([0x50, 0x4b, 0x03, 0x04]);                          // …or a renamed .pptx (common)
    return starts([0x50, 0x4b, 0x03, 0x04]);                          // pptx / key — zip containers
}

const RESEND_AT = new Map(); // email -> last re-send ms (per process; resets on deploy — fine)

// ---------------------------------------------------------------- S3 (SigV4 — no SDK)
// Plain AWS Signature V4 over node crypto+https: exactly the two operations this wing needs (PUT an
// object; presign a 15-minute GET) in ~90 lines, instead of @aws-sdk/client-s3's ~40 MB dependency
// tree slowing every Render build. The signing core is proven against AWS's published SigV4 test
// vector in tests/boston.test.js (doc example "Authenticating Requests: Using Query Parameters").
// Env (read lazily on every call — absence degrades gracefully, see the routes):
//   BB_S3_BUCKET · BB_S3_REGION (default us-east-1) · BB_S3_KEY · BB_S3_SECRET
const s3 = (() => {
    const sha256hex = data => crypto.createHash('sha256').update(data).digest('hex');
    const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
    // AWS-flavor RFC 3986: encode everything except A-Z a-z 0-9 - _ . ~
    const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
    const encPath = p => String(p).split('/').map(enc).join('/');
    const amzStamp = now => now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); // YYYYMMDDTHHMMSSZ

    function config() {
        const bucket = process.env.BB_S3_BUCKET, key = process.env.BB_S3_KEY, secret = process.env.BB_S3_SECRET;
        if (!bucket || !key || !secret) return null;
        const region = process.env.BB_S3_REGION || 'us-east-1';
        // us-east-1's canonical endpoint is the global one (also what AWS's SigV4 doc vector signs).
        const host = region === 'us-east-1' ? `${bucket}.s3.amazonaws.com` : `${bucket}.s3.${region}.amazonaws.com`;
        return { bucket, region, key, secret, host };
    }
    function scopeAndKey(cfg, shortDate) {
        const scope = `${shortDate}/${cfg.region}/s3/aws4_request`;
        const kSigning = hmac(hmac(hmac(hmac('AWS4' + cfg.secret, shortDate), cfg.region), 's3'), 'aws4_request');
        return { scope, kSigning };
    }

    return {
        isConfigured: () => !!config(),

        /** Header-signed single-chunk PUT of a Buffer. Resolves { etag } on 200, rejects otherwise. */
        putObject(objectKey, body, contentType) {
            return new Promise((resolve, reject) => {
                const cfg = config();
                if (!cfg) return reject(new Error('BB_S3_* env not configured'));
                const amzDate = amzStamp(new Date()), shortDate = amzDate.slice(0, 8);
                const { scope, kSigning } = scopeAndKey(cfg, shortDate);
                const payloadHash = sha256hex(body);
                const canonicalPath = encPath('/' + objectKey);
                const headers = [                                     // lowercase + sorted = canonical
                    ['content-type', String(contentType)],
                    ['host', cfg.host],
                    ['x-amz-content-sha256', payloadHash],
                    ['x-amz-date', amzDate]
                ];
                const signedHeaders = headers.map(h => h[0]).join(';');
                const canonicalRequest = ['PUT', canonicalPath, '',
                    headers.map(h => h[0] + ':' + h[1] + '\n').join(''), signedHeaders, payloadHash].join('\n');
                const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
                const signature = hmac(kSigning, stringToSign).toString('hex');
                const req = https.request({
                    host: cfg.host, method: 'PUT', path: canonicalPath, timeout: 60000,
                    headers: {
                        'Content-Type': String(contentType), 'Content-Length': body.length,
                        'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate,
                        'Authorization': `AWS4-HMAC-SHA256 Credential=${cfg.key}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
                    }
                }, res => {
                    let out = '';
                    res.on('data', d => { if (out.length < 4096) out += d; });
                    res.on('end', () => {
                        if (res.statusCode === 200) resolve({ etag: res.headers.etag || null });
                        else reject(new Error(`S3 PUT ${res.statusCode}: ${String(out).slice(0, 300)}`));
                    });
                });
                req.on('timeout', () => req.destroy(new Error('S3 PUT timed out')));
                req.on('error', reject);
                req.end(body);
            });
        },

        /** Query-signed (presigned) GET URL — pure computation, no network. null when unconfigured. */
        presignGet(objectKey, { expires = 900, filename = null, now = new Date() } = {}) {
            const cfg = config();
            if (!cfg) return null;
            const amzDate = amzStamp(now), shortDate = amzDate.slice(0, 8);
            const { scope, kSigning } = scopeAndKey(cfg, shortDate);
            const params = [
                ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
                ['X-Amz-Credential', cfg.key + '/' + scope],
                ['X-Amz-Date', amzDate],
                ['X-Amz-Expires', String(expires)],
                ['X-Amz-SignedHeaders', 'host']
            ];
            if (filename) {                                           // friendly download name (RFC 6266)
                const safe = String(filename).replace(/[^\x20-\x7e]/g, '_').replace(/[\\";]/g, '_').slice(0, 150);
                params.push(['response-content-disposition', `attachment; filename="${safe}"`]);
            }
            const canonicalQuery = params.map(([k, v]) => [enc(k), enc(v)])
                .sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(p => p.join('=')).join('&');
            const canonicalPath = encPath('/' + objectKey);
            const canonicalRequest = ['GET', canonicalPath, canonicalQuery,
                'host:' + cfg.host + '\n', 'host', 'UNSIGNED-PAYLOAD'].join('\n');
            const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
            const signature = hmac(kSigning, stringToSign).toString('hex');
            return `https://${cfg.host}${canonicalPath}?${canonicalQuery}&X-Amz-Signature=${signature}`;
        }
    };
})();

// ---------------------------------------------------------------- branded entry QR (plate overlay)
// qr-plate.png — 253×58 white plate carrying the Med&X + HMPA logos — is alpha-composited onto the
// center of a 300 px QR rendered at error-correction level H (30% recoverable), so the overlay never
// costs scannability. Decodability is asserted in tests with a real decoder (jsQR).
let plateCache;                                          // undefined = not tried, null = unavailable
function loadPlate() {
    if (plateCache !== undefined) return plateCache;
    try { plateCache = pngjsLib.PNG.sync.read(fs.readFileSync(path.join(__dirname, 'qr-plate.png'))); }
    catch (e) { console.warn('[Boston] qr-plate.png unavailable — serving plain QR:', e.message); plateCache = null; }
    return plateCache;
}
async function brandedQrPng(payloadJson) {
    const qrBuf = await QRCodeLib.toBuffer(payloadJson, {
        errorCorrectionLevel: 'H', width: 300, margin: 2, color: { dark: '#000000', light: '#ffffff' }
    });
    const plate = loadPlate();
    if (!plate) return qrBuf;
    const img = pngjsLib.PNG.sync.read(qrBuf);
    const x0 = Math.round((img.width - plate.width) / 2), y0 = Math.round((img.height - plate.height) / 2);
    for (let y = 0; y < plate.height; y++) {
        for (let x = 0; x < plate.width; x++) {
            const ps = (plate.width * y + x) << 2, pd = (img.width * (y0 + y) + (x0 + x)) << 2;
            const a = plate.data[ps + 3] / 255;                       // real alpha compositing
            for (let c = 0; c < 3; c++) img.data[pd + c] = Math.round(plate.data[ps + c] * a + img.data[pd + c] * (1 - a));
            img.data[pd + 3] = 255;
        }
    }
    return pngjsLib.PNG.sync.write(img);
}

module.exports = function mountBoston(app, deps) {
    const { query, sendEmail } = deps;
    const flushDb = typeof deps.flushDb === 'function' ? deps.flushDb : () => {};
    const JWT_SECRET = deps.JWT_SECRET || process.env.JWT_SECRET || 'medx-dev-secret';

    // ------------------------------------------------------------ event row (lazy find-or-create)
    // Lazy because this module mounts at require time, before initializeApp() opens the DB.
    // INSERT OR IGNORE on the fixed PRIMARY KEY → idempotent; admin edits are never overwritten.
    function ensureEventRow() {
        query.run(`INSERT OR IGNORE INTO bridges_events
            (id, slug, name, city, venue_name, venue_address, event_date, event_time, end_time,
             description, capacity, registration_open, status, price, is_published, created_by)
            VALUES (?, ?, ?, 'Boston', ?, ?, ?, '18:00', '21:00', ?, 60, 1, 'upcoming', 0, 0, 'boston-module')`,
            [EVENT_ID, EVENT_SLUG, EVENT_NAME, VENUE_NAME, VENUE_ADDRESS, EVENT_DATE, EVENT_DESC]);
        return query.get('SELECT * FROM bridges_events WHERE id = ?', [EVENT_ID]);
    }

    // ------------------------------------------------------------ bridges_presentations (lazy)
    // Uploaded 5-minute talk files. Multiple rows per registrant are HISTORY (every upload inserts);
    // the newest row is the authoritative file. stored_key = boston-2026/<regId>/<presId>.<ext>.
    let presTableReady = false;
    function ensurePresentationsTable() {
        if (presTableReady) return;
        query.run(`CREATE TABLE IF NOT EXISTS bridges_presentations (
            id TEXT PRIMARY KEY,
            registration_id TEXT NOT NULL,
            original_name TEXT NOT NULL,
            stored_key TEXT NOT NULL,
            mime TEXT,
            size INTEGER NOT NULL,
            uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP
        )`);
        presTableReady = true;
    }
    function latestPresentation(regId) {
        ensurePresentationsTable();
        return query.get(`SELECT * FROM bridges_presentations WHERE registration_id = ?
            ORDER BY uploaded_at DESC, rowid DESC LIMIT 1`, [regId]);
    }

    // ------------------------------------------------------------ no-login tokens
    // Apple-pass download token: hex HMAC-SHA256(JWT_SECRET,'boston:'+id).slice(0,32) + '.' + id —
    // possession = authorization (travels only inside the guest's own confirmation email).
    const passSig = id => crypto.createHmac('sha256', String(JWT_SECRET)).update('boston:' + String(id)).digest('hex').slice(0, 32);
    const passToken = id => passSig(id) + '.' + String(id);
    function verifyPassToken(token) {
        const m = /^([0-9a-f]{32})\.([0-9a-fA-F-]{16,64})$/.exec(String(token || ''));
        if (!m) return null;
        const expect = passSig(m[2]);
        if (!crypto.timingSafeEqual(Buffer.from(m[1]), Buffer.from(expect))) return null;
        return m[2];
    }
    // Presentation-upload token — same scheme, distinct HMAC context so pass tokens and upload
    // tokens can never be swapped for each other.
    const uploadSig = id => crypto.createHmac('sha256', String(JWT_SECRET)).update('bostonup:' + String(id)).digest('hex').slice(0, 32);
    const uploadToken = id => uploadSig(id) + '.' + String(id);
    function verifyUploadToken(token) {
        const m = /^([0-9a-f]{32})\.([0-9a-fA-F-]{16,64})$/.exec(String(token || ''));
        if (!m) return null;
        const expect = uploadSig(m[2]);
        if (!crypto.timingSafeEqual(Buffer.from(m[1]), Buffer.from(expect))) return null;
        return m[2];
    }
    // Team key for the presentation list / downloads / CSV export — derived, so there is nothing to
    // provision: hex HMAC-SHA256(JWT_SECRET,'boston-admin').slice(0,40). Shared with the team once.
    const adminKey = () => crypto.createHmac('sha256', String(JWT_SECRET)).update('boston-admin').digest('hex').slice(0, 40);
    function checkAdminKey(k) {
        const got = Buffer.from(String(k || '')), want = Buffer.from(adminKey());
        return got.length === want.length && crypto.timingSafeEqual(got, want);
    }

    // ------------------------------------------------------------ confirmation email
    function confirmationEmailHtml(reg, presentation) {
        const base = baseUrl();
        const id = String(reg.id);
        const fullName = `${reg.first_name || ''} ${reg.last_name || ''}`.trim() || 'Med&X Guest';
        const first = reg.first_name || 'there';

        // Google Wallet — minted with the shared/wallet builders. The dedicated Boston class
        // (BB_GOOGLE_CLASS_ID) carries the event name/venue/date at CLASS level, so the object keeps
        // only what the class can't know: holder name, registration №, status, dress code. Falls back
        // to the shared approved class when the Boston env is absent. Provisioning is non-blocking
        // and failure never holds up the email.
        let walletSaveUrl = null;
        if (wallet.isConfigured()) {
            try {
                const classId = process.env.BB_GOOGLE_CLASS_ID
                    || process.env.GOOGLE_WALLET_EVENT_CLASS_ID
                    || wallet.classIdFor('bridges-boston-2026');
                const classBody = wallet.buildEventTicketClass({
                    classId, issuerName: 'Med&X', eventName: EVENT_NAME,
                    venue: VENUE_NAME, venueAddress: '25 Shattuck Street, Harvard Medical School, Boston, MA',
                    startISO: '2026-09-21T22:00:00Z', endISO: '2026-09-22T01:00:00Z',
                    logoUri: base + '/assets/images/medx-logo.png', hexBackgroundColor: '#14100d', homepageUri: base
                });
                const object = wallet.buildEventTicketObject({
                    objectId: wallet.objectIdFor('t-br-' + id), classId, token: id,
                    name: fullName, registrationNumber: ticketNo(id),
                    statusLabel: 'Confirmed', dressCode: DRESS,
                    logoUri: base + '/assets/images/medx-logo.png', hexBackgroundColor: '#14100d'
                });
                walletSaveUrl = wallet.buildSaveUrl({ classes: [classBody], objects: [object], origins: [base] }).saveUrl;
                Promise.resolve()
                    .then(() => wallet.ensureEventClass(classBody))
                    .then(() => wallet.ensureEventObject(object))
                    .catch(err => console.error('[Boston] wallet provision failed (non-blocking):', err.message));
            } catch (e) { console.error('[Boston] Google Wallet mint failed:', e.message); }
        }
        const appleWalletUrl = applePass.isConfigured()
            ? `${base}/api/boston/pass/${passToken(id)}.pkpass`
            : null;                                     // env absent → button simply omitted

        return emailTemplates.ticketConfirmation({
            firstName: first,
            eventName: 'Building Bridges — Boston',
            headlineHtml: 'Building Bridges Boston — you are <i>in</i>.',
            introHtml: `Dear ${esc(first)} — your registration is confirmed. Med&X and the Harvard Medical Postdoc Association look forward to welcoming you at Harvard Medical School for an evening of panels, participant presentations and a networking reception.`
                + (presentation ? ` You asked to give a 5-minute presentation — we will confirm presentation slots by email based on the total number of requests.` : ''),
            whenLines: [`Building Bridges in Biomedicine — ${DATE_LONG} · 18:00 · doors from 17:30`],
            venue: VENUE_FULL,
            guestLabel: fullName,
            ticketNumber: ticketNo(id),
            ticketLabel: 'Building Bridges Boston — evening registration' + (presentation ? ' + 5-minute presentation request' : ''),
            priceLabel: 'Free',
            dressLabel: DRESS,
            qrPngUrl: `${base}/api/boston/qr/${id}.png`,   // branded QR (Med&X × HMPA plate in the middle)
            walletSaveUrl,
            appleWalletUrl,
            calendarUrl: `${base}/boston.ics`,
            note: 'Present the QR above at the door — it is your entry to the evening. The same ticket lives in the wallet passes.',
            replyLine: `Questions? Laura Rodman (<a href="mailto:${SUPPORT_EMAIL}" style="color:#6b6259;">${SUPPORT_EMAIL}</a>).`
        });
    }

    async function sendConfirmation(reg, presentation) {
        const subject = `You are in — Building Bridges Boston · ${DATE_LONG}`;
        return sendEmail(reg.email, subject, confirmationEmailHtml(reg, presentation));
    }

    // ------------------------------------------------------------ upload-invite email (NOT WIRED — by design)
    // NO automatic emails to presenters: the team copies each personal link from
    // /boston/presentations?key=… and sends it manually (send-control rule). If we ever decide to
    // wire an automatic invite, this is the intended shape — uncomment, then call
    // `await sendUploadInvite(reg)` wherever the send is deliberately triggered:
    //
    // async function sendUploadInvite(reg) {
    //     const link = `${baseUrl()}/boston/upload/${uploadToken(reg.id)}`;
    //     const first = reg.first_name || 'there';
    //     const html = `<div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#2c2521;line-height:1.7;">
    //         <p>Dear ${esc(first)},</p>
    //         <p>You asked to give a <b>5-minute presentation</b> at Building Bridges in Biomedicine — Boston
    //         (${DATE_LONG}, Harvard Medical School). Please upload your slides from your personal link:</p>
    //         <p style="margin:22px 0;"><a href="${link}" style="background:#8f2d2a;color:#fbf3e6;padding:13px 26px;border-radius:10px;text-decoration:none;font-weight:600;">Upload your presentation</a></p>
    //         <p style="font-size:13px;color:#6f6256;">Accepted: .pdf, .ppt, .pptx or .key — up to 25 MB. You can
    //         replace the file any time from the same link. Questions? Laura Rodman
    //         (<a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>).</p></div>`;
    //     return sendEmail(reg.email, 'Your 5-minute presentation — Building Bridges Boston', html);
    // }

    // ------------------------------------------------------------ page assets
    app.get('/boston/hero.jpg', (req, res) => {
        res.set('Cache-Control', 'public, max-age=86400');
        res.sendFile(path.join(__dirname, 'boston-hero.jpg'));
    });
    app.get('/boston/hmpa.png', (req, res) => {
        res.set('Cache-Control', 'public, max-age=86400');
        res.sendFile(path.join(__dirname, 'hmpa-logo.png'));
    });

    // ------------------------------------------------------------ GET /boston — public page
    app.get('/boston', (req, res) => {
        res.send(bostonPage());
    });

    // ------------------------------------------------------------ POST /api/boston/register
    app.post('/api/boston/register', async (req, res) => {
        try {
            const b = req.body || {};
            const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
            const fullName = clean(b.name, 200);
            const email = clean(b.email, 160);
            const institution = clean(b.institution, 160);
            const position = clean(b.position, 120);
            const presentation = b.presentation === true || ['yes', 'true', '1', 'on'].includes(String(b.presentation).toLowerCase());
            if (!fullName) return res.status(400).json({ error: 'Please tell us your full name.' });
            if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'A valid email address is required.' });
            if (!institution) return res.status(400).json({ error: 'Please tell us your institution.' });
            const sp = fullName.split(/\s+/);
            const first_name = sp[0];
            const last_name = sp.slice(1).join(' ');

            const evt = ensureEventRow();
            if (!evt) return res.status(500).json({ error: 'Registration is momentarily unavailable. Please try again.' });
            if (!evt.registration_open) return res.status(403).json({ error: `Registration for this evening has closed. Write to ${SUPPORT_EMAIL} and we will help.` });

            // Dedupe by email (held seats only, same predicate as the sibling public-events route):
            // a duplicate submit RE-SENDS the confirmation instead of creating a second seat.
            const prior = query.get(`SELECT * FROM bridges_registrations
                WHERE event_id = ? AND LOWER(email) = LOWER(?)
                  AND (status IN ('confirmed','registered') OR payment_status IN ('paid','comp'))`, [EVENT_ID, email]);
            if (prior) {
                // Throttle re-sends: one confirmation re-send per address per 10 minutes, so the
                // public form can't be used to bombard someone's inbox.
                const rk = String(email).toLowerCase();
                const last = RESEND_AT.get(rk) || 0;
                if (Date.now() - last < 10 * 60 * 1000) {
                    return res.json({ already: true, message: 'You are already registered — your confirmation was re-sent a moment ago. Check your inbox (and spam).' });
                }
                RESEND_AT.set(rk, Date.now());
                const priorPresentation = /5-minute presentation/.test(String(prior.notes || ''));
                try {
                    const send = await sendConfirmation(prior, priorPresentation);
                    if (send && send.success !== false && !prior.confirmation_sent) {
                        query.run('UPDATE bridges_registrations SET confirmation_sent = 1 WHERE id = ?', [prior.id]);
                    }
                } catch (e) { console.warn('[Boston] re-send failed:', e.message); }
                return res.json({ already: true, message: 'You are already registered — we have re-sent your confirmation email to ' + email + '.' });
            }

            // Capacity gate — held seats only (mirrors /api/public-events/register).
            if (evt.capacity) {
                const held = query.get(`SELECT COUNT(*) AS n FROM bridges_registrations
                    WHERE event_id = ? AND (status IN ('confirmed','registered') OR payment_status IN ('paid','comp'))`, [EVENT_ID])?.n || 0;
                if (held >= evt.capacity) {
                    return res.status(409).json({ error: `The guest list is now full. Write to ${SUPPORT_EMAIL} and we will let you know the moment a seat opens.` });
                }
            }

            const id = crypto.randomUUID();
            query.run(`INSERT INTO bridges_registrations
                (id, event_id, first_name, last_name, email, institution, position, notes, status, payment_status, confirmation_sent, registered_at)
                VALUES (?,?,?,?,?,?,?,?,'registered','n/a',0,CURRENT_TIMESTAMP)`,
                [id, EVENT_ID, first_name, last_name, email, institution, position || null,
                 presentation ? '5-minute presentation requested' : null]);
            flushDb();                                  // durability: a confirmed seat must survive a redeploy

            const reg = { id, first_name, last_name, email, institution, position };
            try {
                const send = await sendConfirmation(reg, presentation);
                if (send && send.success !== false) {
                    query.run('UPDATE bridges_registrations SET confirmation_sent = 1 WHERE id = ?', [id]);
                }
            } catch (e) { console.warn('[Boston] confirmation email failed:', e.message); }

            // Google Sheets — non-blocking, same JSON shape as the Stripe-webhook sheet posts.
            try {
                const sheetsWebhook = process.env.GOOGLE_SHEETS_WEBHOOK;
                if (sheetsWebhook) {
                    fetch(sheetsWebhook, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            timestamp: new Date().toISOString(),
                            events: ['bridges'],
                            name: fullName, email, institution,
                            country: '', role: position || '',
                            event: 'Building Bridges Boston 2026',
                            event_type: 'bridges',
                            items: 'bridges',
                            dietary: '', allergies: '', guests: 0,
                            custom_summary: presentation ? '5-minute presentation requested' : '',
                            applied_for: 'bridges',
                            amount: 0, payment: 'Free',
                            coupon: '', discount: '0',
                            ticket_code: shortCode(id),
                            registration_id: id
                        })
                    }).catch(err => console.warn('[Boston] Sheets POST failed (non-blocking):', err.message));
                }
            } catch (e) { /* sheets must never affect the registration */ }

            res.json({ success: true });
        } catch (e) {
            console.error('[Boston] registration error:', e.message);
            res.status(500).json({ error: 'Registration failed. Please try again.' });
        }
    });

    // ------------------------------------------------------------ GET /boston.ics
    app.get('/boston.ics', (req, res) => {
        const escIcs = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
        const fold = line => {                          // RFC 5545 §3.1 — 75-octet folding
            const out = []; let s = line;
            while (Buffer.byteLength(s, 'utf8') > 74) {
                let cut = 74;
                while (cut > 1 && Buffer.byteLength(s.slice(0, cut), 'utf8') > 74) cut--;
                out.push(s.slice(0, cut)); s = ' ' + s.slice(cut);
            }
            out.push(s);
            return out.join('\r\n');
        };
        const dtstamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
        const ics = [
            'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Med&X//Building Bridges Boston//EN',
            'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
            'UID:' + EVENT_ID + '@medx.hr',
            'DTSTAMP:' + dtstamp,
            'DTSTART:' + DTSTART_UTC,
            'DTEND:' + DTEND_UTC,
            fold('SUMMARY:' + escIcs('Building Bridges in Biomedicine — Boston')),
            fold('LOCATION:' + escIcs('Waterhouse Room, Gordon Hall, 25 Shattuck Street, Harvard Medical School, Boston, MA')),
            fold('DESCRIPTION:' + escIcs('Doors open 17:30; the program runs 18:00–21:00. Present the entry QR from your confirmation email at the door. Dress code: business attire. Questions? Laura Rodman (laura.rodman@medx.hr).')),
            'STATUS:CONFIRMED', 'END:VEVENT', 'END:VCALENDAR'
        ].join('\r\n') + '\r\n';
        res.set('Content-Type', 'text/calendar; charset=utf-8');
        res.set('Content-Disposition', 'attachment; filename="building-bridges-boston.ics"');
        res.send(ics);
    });

    // ------------------------------------------------------------ GET /api/boston/pass/:token.pkpass
    app.get('/api/boston/pass/:token.pkpass', (req, res) => {
        try {
            const id = verifyPassToken(req.params.token);
            if (!id) return res.status(404).json({ error: 'Not found' });
            const reg = query.get('SELECT * FROM bridges_registrations WHERE id = ? AND event_id = ?', [id, EVENT_ID]);
            if (!reg) return res.status(404).json({ error: 'Not found' });
            if (!applePass.isConfigured()) {
                return res.status(503).json({ error: 'Apple Wallet passes are not enabled on this server yet. Your email QR admits you at the door.' });
            }
            const name = `${reg.first_name || ''} ${reg.last_name || ''}`.trim() || 'Med&X Guest';
            const buf = applePass.buildPkpass({
                style: 'eventTicket',
                serial: 'medx-t-br-' + id,
                description: 'Med&X — Building Bridges in Biomedicine — Boston',
                relevantDate: '2026-09-21T18:00:00-04:00',
                stripFiles: {
                    '1x': path.join(__dirname, 'v2/apple-assets/boston-strip.png'),
                    '2x': path.join(__dirname, 'v2/apple-assets/boston-strip@2x.png'),
                    '3x': path.join(__dirname, 'v2/apple-assets/boston-strip@3x.png')
                },
                // Med&X × HMPA combined wordmark top-left (Alen 2026-09-01)
                logoFiles: {
                    '1x': path.join(__dirname, 'v2/apple-assets/boston-logo.png'),
                    '2x': path.join(__dirname, 'v2/apple-assets/boston-logo@2x.png')
                },
                fields: {
                    // Label without the year — 'BUILDING BRIDGES 2026' truncated on the pass header.
                    header: [{ key: 'event', label: 'BUILDING BRIDGES', value: 'Boston' }],
                    primary: [],
                    secondary: [
                        { key: 'when', label: 'WHEN', value: 'Sep 21 · 18:00 (doors 17:30)' },
                        { key: 'where', label: 'WHERE', value: 'Gordon Hall · Harvard Medical School' }
                    ],
                    auxiliary: [
                        { key: 'guest', label: 'GUEST', value: name },
                        { key: 'ref', label: 'N°', value: ticketNo(id) }
                    ],
                    back: [
                        { key: 'included', label: 'INCLUDED', value: 'Building Bridges evening — program & networking' },
                        { key: 'venue', label: 'VENUE', value: VENUE_FULL },
                        { key: 'dress', label: 'DRESS CODE', value: DRESS },
                        { key: 'support', label: 'SUPPORT', value: `Questions? ${SUPPORT_EMAIL}` }
                    ]
                },
                qrMessage: id,
                altText: shortCode(id)
            });
            res.setHeader('Content-Type', 'application/vnd.apple.pkpass');
            res.setHeader('Content-Disposition', 'inline; filename="medx-building-bridges-boston.pkpass"');
            res.setHeader('Content-Length', buf.length);
            res.setHeader('Cache-Control', 'private, no-store');
            res.send(buf);
        } catch (e) {
            console.error('[Boston] Apple pass failed:', e.message);
            res.status(500).json({ error: 'Could not build the pass. Your email QR admits you at the door.' });
        }
    });

    // ------------------------------------------------------------ GET /api/boston/qr/:id.png
    // The confirmation-email entry QR with the Med&X × HMPA plate composited in the middle.
    // Payload replicates the prod /qr/:id.png bridges branch EXACTLY ({type,regId,evt:'bridges'}),
    // so the door scanner's bridges mode reads both interchangeably. Rendered at EC level 'H'
    // (instead of prod's 'L') so the plate overlay stays well inside the correction budget.
    // If qrcode/pngjs are unavailable, 302 → the plain prod QR — the email image always resolves.
    app.get('/api/boston/qr/:id.png', async (req, res) => {
        const id = String(req.params.id || '').trim();
        try {
            if (!/^[0-9a-fA-F-]{16,64}$/.test(id)) return res.status(404).json({ error: 'Not found' });
            const row = query.get('SELECT id FROM bridges_registrations WHERE id = ?', [id]);
            if (!row) return res.status(404).json({ error: 'Not found' });
            if (!QRCodeLib || !pngjsLib) return res.redirect(302, '/qr/' + id + '.png');
            const payload = { type: 'MEDX_MEMBER', regId: row.id, evt: 'bridges' };
            const png = await brandedQrPng(JSON.stringify(payload));
            res.set('Content-Type', 'image/png');
            res.set('Cache-Control', 'public, max-age=3600');
            res.send(png);
        } catch (e) {
            console.error('[Boston] branded QR failed:', e.message);
            if (!res.headersSent) res.redirect(302, '/qr/' + id + '.png');
        }
    });

    // ------------------------------------------------------------ multipart parser (upload API)
    // multer — the same library server.js already uses — with MEMORY storage: the file is buffered
    // (≤25 MB, multer aborts the stream past the limit), magic-checked, then PUT straight to S3.
    // It never touches the ephemeral local disk (which is why server.js's ephemeral-storage guard
    // exempts /api/boston/upload/ by prefix).
    const multerSingle = multerLib
        ? multerLib({ storage: multerLib.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }).single('file')
        : null;
    function uploadParser(req, res, next) {
        if (!multerSingle) return res.status(503).json({ error: 'Uploads are momentarily unavailable. Please try again shortly.' });
        multerSingle(req, res, err => {
            if (!err) return next();
            if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'That file is over the 25 MB limit. Please compress it (or export a PDF) and try again.' });
            return res.status(400).json({ error: 'We could not read that upload. Please try again with a .pdf, .ppt, .pptx or .key file.' });
        });
    }

    // ------------------------------------------------------------ GET /boston/upload/:token
    // Personal upload page — possession of the link is the authorization (mirrors the pass token).
    app.get('/boston/upload/:token', (req, res) => {
        res.set('X-Robots-Tag', 'noindex, nofollow');
        res.set('Cache-Control', 'private, no-store');
        try {
            const id = verifyUploadToken(req.params.token);
            const reg = id ? query.get('SELECT * FROM bridges_registrations WHERE id = ? AND event_id = ?', [id, EVENT_ID]) : null;
            if (!reg) return res.status(404).send(uploadNotFoundPage());
            const current = latestPresentation(reg.id);
            res.send(uploadPage(reg, current, s3.isConfigured(), String(req.params.token)));
        } catch (e) {
            console.error('[Boston] upload page error:', e.message);
            res.status(500).send(simplePage('Something went wrong', 'One moment, please.',
                `We could not open your upload page just now. Please try the link again in a minute, or write to Laura Rodman (<a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>).`));
        }
    });

    // ------------------------------------------------------------ POST /api/boston/upload/:token
    app.post('/api/boston/upload/:token', uploadParser, async (req, res) => {
        try {
            const id = verifyUploadToken(req.params.token);
            if (!id) return res.status(404).json({ error: 'This upload link is not valid. Please use the exact link you were sent.' });
            const reg = query.get('SELECT * FROM bridges_registrations WHERE id = ? AND event_id = ?', [id, EVENT_ID]);
            if (!reg) return res.status(404).json({ error: 'This upload link is not valid. Please use the exact link you were sent.' });
            if (!s3.isConfigured()) return res.status(503).json({ error: 'Uploads open soon — this same link will work shortly. Nothing else is needed from you.' });
            const f = req.file;
            if (!f || !f.buffer || !f.buffer.length) return res.status(400).json({ error: 'Choose a file first — .pdf, .ppt, .pptx or .key, up to 25 MB.' });
            const name = sanitizeFilename(f.originalname);
            const m = /\.([A-Za-z0-9]{1,10})$/.exec(name);
            const ext = m ? m[1].toLowerCase() : '';
            const type = UPLOAD_TYPES[ext];
            if (!type) return res.status(400).json({ error: 'That file type is not accepted. Please upload a .pdf, .ppt, .pptx or .key file.' });
            if (f.buffer.length > MAX_UPLOAD_BYTES) {   // belt — multer already aborts the stream at the cap
                return res.status(413).json({ error: 'That file is over the 25 MB limit. Please compress it (or export a PDF) and try again.' });
            }
            if (!magicOk(ext, f.buffer)) {
                return res.status(400).json({ error: `That file does not look like a real .${ext} file inside. Please re-export it and try again.` });
            }
            ensurePresentationsTable();
            const presId = crypto.randomUUID();
            const storedKey = `${EVENT_SLUG}/${id}/${presId}.${ext}`;
            await s3.putObject(storedKey, f.buffer, type.mime);   // S3 first — a DB row only for a stored file
            const uploadedAt = new Date().toISOString();
            query.run(`INSERT INTO bridges_presentations (id, registration_id, original_name, stored_key, mime, size, uploaded_at)
                VALUES (?,?,?,?,?,?,?)`, [presId, id, name, storedKey, type.mime, f.buffer.length, uploadedAt]);
            flushDb();
            res.json({ success: true, filename: name, size: f.buffer.length, uploaded_at: uploadedAt });
        } catch (e) {
            console.error('[Boston] presentation upload failed:', e.message);
            res.status(502).json({ error: 'The upload did not go through. Please try again — this same link keeps working.' });
        }
    });

    // ------------------------------------------------------------ team data (page + JSON share it)
    function presentationAdminData() {
        ensurePresentationsTable();
        const regs = query.all(`SELECT * FROM bridges_registrations
            WHERE event_id = ? AND (notes LIKE '%5-minute presentation%'
               OR id IN (SELECT registration_id FROM bridges_presentations))
            ORDER BY registered_at, rowid`, [EVENT_ID]);
        const base = baseUrl();
        const rows = regs.map(r => {
            const latest = latestPresentation(r.id);
            const versions = latest
                ? Number((query.get('SELECT COUNT(*) AS n FROM bridges_presentations WHERE registration_id = ?', [r.id]) || {}).n || 0)
                : 0;
            return {
                registration_id: r.id,
                name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
                institution: r.institution || '',
                email: r.email,
                requested: /5-minute presentation/.test(String(r.notes || '')),
                upload_url: `${base}/boston/upload/${uploadToken(r.id)}`,
                upload: latest ? {
                    id: latest.id,
                    filename: latest.original_name,
                    size: Number(latest.size),
                    mime: latest.mime,
                    uploaded_at: latest.uploaded_at,
                    versions,
                    download_url: `${base}/api/boston/presentations/${latest.id}/download?key=${adminKey()}`
                } : null
            };
        });
        return {
            event: EVENT_ID, event_name: EVENT_NAME,
            generated_at: new Date().toISOString(),
            s3_configured: s3.isConfigured(),
            requested: rows.filter(r => r.requested).length,
            uploaded: rows.filter(r => r.upload).length,
            rows
        };
    }

    // ------------------------------------------------------------ GET /boston/presentations (team page)
    app.get('/boston/presentations', (req, res) => {
        res.set('X-Robots-Tag', 'noindex, nofollow');
        res.set('Cache-Control', 'private, no-store');
        try {
            if (!checkAdminKey(req.query && req.query.key)) {
                return res.status(404).send(simplePage('Not found', 'Nothing here.',
                    'There is no page at this address.'));
            }
            res.send(adminPage(presentationAdminData(), adminKey()));
        } catch (e) {
            console.error('[Boston] presentations page error:', e.message);
            res.status(500).send(simplePage('Something went wrong', 'One moment, please.', 'Please reload in a minute.'));
        }
    });

    // ------------------------------------------------------------ GET /api/boston/presentations (JSON)
    app.get('/api/boston/presentations', (req, res) => {
        try {
            if (!checkAdminKey(req.query && req.query.key)) return res.status(404).json({ error: 'Not found' });
            res.set('Cache-Control', 'private, no-store');
            res.json(presentationAdminData());
        } catch (e) {
            console.error('[Boston] presentations JSON error:', e.message);
            res.status(500).json({ error: 'Could not assemble the list.' });
        }
    });

    // ------------------------------------------------------------ GET /api/boston/presentations/:id/download
    app.get('/api/boston/presentations/:id/download', (req, res) => {
        try {
            if (!checkAdminKey(req.query && req.query.key)) return res.status(404).json({ error: 'Not found' });
            ensurePresentationsTable();
            const p = query.get('SELECT * FROM bridges_presentations WHERE id = ?', [String(req.params.id || '')]);
            if (!p) return res.status(404).json({ error: 'Not found' });
            if (!s3.isConfigured()) return res.status(503).json({ error: 'File storage is not configured on this server yet.' });
            const url = s3.presignGet(p.stored_key, { expires: 900, filename: p.original_name });   // 15 minutes
            res.set('Cache-Control', 'private, no-store');
            res.redirect(302, url);
        } catch (e) {
            console.error('[Boston] download redirect failed:', e.message);
            res.status(500).json({ error: 'Could not build the download link.' });
        }
    });

    // ------------------------------------------------------------ GET /api/boston/registrations.csv
    // Full registrant export for the separate Boston Google Sheet (live-importing). UTF-8 BOM so
    // Excel/Sheets read the encoding, every cell quoted, CRLF line ends, oldest first.
    app.get('/api/boston/registrations.csv', (req, res) => {
        try {
            if (!checkAdminKey(req.query && req.query.key)) return res.status(403).json({ error: 'Forbidden' });
            const rows = query.all(`SELECT * FROM bridges_registrations WHERE event_id = ?
                ORDER BY registered_at, rowid`, [EVENT_ID]);
            const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
            const lines = [['Registered at', 'First name', 'Last name', 'Email', 'Institution', 'Position',
                '5-min presentation', 'Status', 'Checked in'].map(q).join(',')];
            for (const r of rows) {
                // human timestamp in Boston time, text-safe so Google Sheets shows it as written
                // (a bare ISO string gets auto-parsed into a date serial like 46266.23)
                const when = (() => { try {
                    const d = new Date(String(r.registered_at).replace(' ', 'T') + (String(r.registered_at).includes('Z') ? '' : 'Z'));
                    return d.toLocaleString('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) + ' ET';
                } catch (e) { return String(r.registered_at || ''); } })();
                lines.push([when, r.first_name, r.last_name, r.email, r.institution, r.position,
                    /5-minute presentation/.test(String(r.notes || '')) ? 'Yes' : 'No',
                    r.status, Number(r.checked_in) ? 'Yes' : 'No'].map(q).join(','));
            }
            res.set('Content-Type', 'text/csv; charset=utf-8');
            res.set('Content-Disposition', 'attachment; filename="building-bridges-boston-registrations.csv"');
            res.set('Cache-Control', 'private, no-store');
            res.send('\ufeff' + lines.join('\r\n') + '\r\n');
        } catch (e) {
            console.error('[Boston] CSV export failed:', e.message);
            res.status(500).json({ error: 'Export failed.' });
        }
    });

    console.log('[Boston] Building Bridges Boston wing mounted (/boston + presentation uploads)');
};

// Test seam: the SigV4 helper — tests stub putObject (never the wire) and drive presignGet as-is
// (pure computation) against AWS's published test vector.
module.exports._s3 = s3;

// ---------------------------------------------------------------- shared page chrome
// Same premium ink/cream/crimson/gold language as the portal's public shells (premiumPage):
// warm-ink hero, Fraunces serif headlines, cream ground, crimson primary, gold hairline details.
const FONTS_HTML = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,400&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">`;
const BASE_CSS = `
:root{--ink:#211b17;--ink-deep:#1b1613;--cream:#efe7d6;--sheet:#fbf8f1;--text:#2c2521;--muted:#6f6256;--gold:#b0893b;--gold-soft:rgba(176,137,59,.32);--crimson:#8f2d2a;--crimson-dark:#772320;}
*{box-sizing:border-box;margin:0;padding:0;}
body{min-height:100vh;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;color:var(--text);
  background:radial-gradient(1200px 640px at 50% -8%,#f6efe0,transparent 62%),var(--cream);-webkit-font-smoothing:antialiased;}
main{max-width:660px;margin:0 auto;padding:0 16px 56px;}
.sheet{background:var(--sheet);border:1px solid rgba(43,33,25,.07);border-radius:20px;box-shadow:0 1px 0 rgba(255,255,255,.7) inset,0 24px 60px -30px rgba(43,33,25,.34);
  padding:clamp(26px,5.4vw,40px) clamp(20px,4.6vw,38px);margin-top:22px;}
.sheet:first-child{margin-top:-34px;position:relative;}
.slabel{font-size:10.5px;font-weight:600;letter-spacing:2.6px;text-transform:uppercase;color:var(--gold);margin-bottom:14px;}
.rule{width:38px;height:1px;background:var(--gold-soft);margin:0 0 18px;}
.foot{text-align:center;font-size:12px;letter-spacing:.3px;color:#94897c;padding:26px 18px 40px;line-height:1.9;}
.foot b{font-weight:600;color:#6f6256;}
.foot a{color:var(--crimson);text-decoration:none;font-weight:600;}
.miniband{background:var(--ink-deep);color:#f3ece0;}
.miniband .inner{max-width:660px;margin:0 auto;padding:clamp(38px,7vw,60px) 22px clamp(34px,6vw,50px);text-align:center;}
.orgs{display:flex;align-items:center;justify-content:center;gap:14px;margin-bottom:clamp(24px,5vw,38px);}
.orgs img.medx{height:26px;width:auto;filter:brightness(0) invert(1);opacity:.95;}
.orgs .x{font-family:'Fraunces',Georgia,serif;font-style:italic;font-size:15px;color:rgba(243,236,224,.55);}
.orgs .hmpa{background:#fdfcf9;border-radius:8px;padding:5px 8px;box-shadow:0 6px 18px -8px rgba(0,0,0,.6);}
.orgs .hmpa img{height:30px;width:auto;display:block;}
.kicker{font-size:11px;font-weight:600;letter-spacing:3.2px;text-transform:uppercase;color:var(--gold);margin-bottom:16px;}
.miniband h1{font-family:'Fraunces',Georgia,'Times New Roman',serif;font-weight:500;font-size:clamp(26px,6.4vw,38px);line-height:1.14;letter-spacing:-.4px;color:#f7f1e6;}
@media(max-width:430px){.sheet{border-radius:16px;}.orgs{gap:10px;}}`;

const FOOTER_HTML = `<footer class="foot">
  Questions? Laura Rodman (<a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>)<br>
  Organized by Med&amp;X and the Harvard Medical Postdoc Association<br>
  <a href="https://medx.hr">www.medx.hr</a>
</footer>`;

// ---------------------------------------------------------------- the registration page
function bostonPage() {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Building Bridges in Biomedicine: Croatia and the US — Boston · Med&amp;X</title>
<meta name="description" content="Building Bridges in Biomedicine: Croatia and the US — Boston. 21 September 2026 · 6:00–9:00 PM (doors from 5:30 PM) · Waterhouse Room, Gordon Hall (25 Shattuck St), Harvard Medical School. Free, by registration.">
<link rel="icon" type="image/png" href="/assets/favicon-x.png">
${FONTS_HTML}
<style>${BASE_CSS}
/* ---- hero — the invitation's dark HMS facade ---- */
.hero{position:relative;background:var(--ink-deep);color:#f3ece0;overflow:hidden;}
.hero .bg{position:absolute;inset:0;background:url('/boston/hero.jpg') center 32%/cover no-repeat;opacity:.6;}
.hero .veil{position:absolute;inset:0;background:linear-gradient(180deg,rgba(27,22,19,.55) 0%,rgba(27,22,19,.28) 40%,rgba(27,22,19,.92) 88%,#1b1613 100%);}
.hero .inner{position:relative;max-width:660px;margin:0 auto;padding:clamp(46px,9vw,84px) 22px clamp(40px,7vw,64px);text-align:center;}
.hero .orgs{margin-bottom:clamp(30px,7vw,52px);}
.hero h1{font-family:'Fraunces',Georgia,'Times New Roman',serif;font-weight:500;font-size:clamp(30px,7.4vw,48px);line-height:1.1;letter-spacing:-.5px;color:#f7f1e6;}
.hero h1 .city{display:block;font-style:italic;font-weight:400;color:var(--gold);font-size:clamp(26px,6.4vw,40px);margin-top:10px;}
.flavor{margin-top:20px;font-size:12px;font-weight:600;letter-spacing:2.4px;text-transform:uppercase;color:rgba(243,236,224,.78);}
.hero .whenline{margin-top:26px;padding-top:22px;border-top:1px solid rgba(176,137,59,.35);font-size:14px;line-height:1.75;color:#efe7d6;}
.hero .whenline b{color:#fff;font-weight:600;}
/* ---- body sheets ---- */
.facts{border:1px solid rgba(176,137,59,.22);background:#f4eede;border-radius:14px;padding:6px 18px;}
.facts .frow{display:flex;gap:16px;justify-content:space-between;align-items:baseline;padding:11px 0;font-size:14px;color:#3a322b;}
.facts .frow + .frow{border-top:1px solid rgba(176,137,59,.16);}
.facts .frow span:first-child{color:var(--muted);font-size:10.5px;font-weight:600;letter-spacing:1.8px;text-transform:uppercase;white-space:nowrap;}
.facts .frow span:last-child{font-weight:600;text-align:right;line-height:1.5;}
.prose{font-size:15px;line-height:1.72;color:#4a4139;}
.prose + .prose{margin-top:14px;}
.program{margin-top:18px;font-size:13.5px;line-height:1.8;color:#4a4139;}
.program b{font-family:'Fraunces',Georgia,serif;font-weight:600;color:#241d18;}
/* ---- form ---- */
label{display:block;font-size:10.5px;font-weight:600;letter-spacing:1.8px;text-transform:uppercase;color:var(--muted);margin:0 0 7px;}
label .opt{color:#a89a86;text-transform:none;letter-spacing:.2px;font-weight:500;}
input[type=text],input[type=email]{width:100%;padding:13px 14px;border:1px solid rgba(43,33,25,.18);border-radius:11px;background:#fff;color:#241d18;font-size:16px;font-family:inherit;}
input:focus{outline:none;border-color:var(--gold);box-shadow:0 0 0 3px rgba(176,137,59,.14);}
.field{margin-bottom:16px;}
.check{display:flex;gap:12px;align-items:flex-start;margin:20px 0 6px;padding:15px 16px;border:1px solid rgba(176,137,59,.28);background:#f4eede;border-radius:12px;cursor:pointer;}
.check input{width:19px;height:19px;margin-top:1px;accent-color:var(--crimson);flex-shrink:0;cursor:pointer;}
.check .t{font-size:13.5px;line-height:1.55;color:#3a322b;font-weight:500;text-transform:none;letter-spacing:normal;}
.slots{font-size:12px;line-height:1.6;color:var(--muted);margin:8px 2px 0;}
.btn{display:block;width:100%;margin-top:20px;padding:16px;border:none;border-radius:12px;cursor:pointer;font-family:inherit;font-size:15px;font-weight:600;letter-spacing:.2px;color:#fbf3e6;
  background:linear-gradient(180deg,#a03330,var(--crimson));box-shadow:0 12px 26px -12px rgba(143,45,42,.7);transition:transform .15s,box-shadow .15s;}
.btn:hover{background:linear-gradient(180deg,#8f2d2a,var(--crimson-dark));transform:translateY(-1px);}
.btn:disabled{opacity:.55;cursor:not-allowed;transform:none;}
.err{display:none;margin-top:14px;padding:12px 14px;border-radius:10px;background:rgba(143,45,42,.08);border:1px solid rgba(143,45,42,.3);color:#7c2320;font-size:13.5px;line-height:1.55;}
.fine{margin-top:18px;padding-top:16px;border-top:1px solid rgba(43,33,25,.1);font-size:11.5px;line-height:1.65;color:#8a7d70;}
.fine a{color:var(--gold);text-decoration:none;}
/* ---- success ---- */
#done{display:none;text-align:center;}
#done .headline{font-family:'Fraunces',Georgia,serif;font-weight:600;font-size:clamp(28px,6.4vw,36px);line-height:1.1;letter-spacing:-.4px;color:#241d18;margin:6px 0 14px;}
#done .lede{font-size:15px;line-height:1.7;color:var(--muted);max-width:420px;margin:0 auto;}
#done .lede b{color:#2c2521;}
#done .cal{display:inline-flex;align-items:center;justify-content:center;margin-top:24px;padding:13px 26px;border-radius:11px;text-decoration:none;font-size:14px;font-weight:600;color:#4a3f36;border:1px solid rgba(43,33,25,.22);}
#done .cal:hover{background:rgba(43,33,25,.045);}
@media(max-width:430px){.facts .frow{flex-direction:column;gap:3px;}.facts .frow span:last-child{text-align:left;}}
</style></head><body>

<header class="hero">
  <div class="bg"></div><div class="veil"></div>
  <div class="inner">
    <div class="orgs">
      <img class="medx" src="${LOGO_URL}" alt="Med&amp;X">
      <span class="x">&times;</span>
      <span class="hmpa"><img src="/boston/hmpa.png" alt="Harvard Medical Postdoc Association"></span>
    </div>
    <h1>Building Bridges in Biomedicine: Croatia and the US<span class="city">Boston</span></h1>
    <p class="flavor">Fifth Edition &middot; By invitation only</p>
  </div>
</header>

<main>
  <section class="sheet" aria-label="The evening">
    <p class="slabel">The evening</p><div class="rule"></div>
    <div class="facts">
      <div class="frow"><span>When</span><span>${esc(DATE_LONG)} &middot; 6:00&ndash;9:00 PM</span></div>
      <div class="frow"><span>Doors</span><span>From 5:30 PM</span></div>
      <div class="frow"><span>Where</span><span>Waterhouse Room, Gordon Hall &middot; 25 Shattuck Street<br>Harvard Medical School, Boston, MA</span></div>
      <div class="frow"><span>Admission</span><span>Free &middot; by registration</span></div>
      <div class="frow"><span>Dress</span><span>${esc(DRESS)}</span></div>
    </div>
    <p class="prose" style="margin-top:20px;">Med&amp;X and the Harvard Medical Postdoc Association invite physicians, scientists, and biomedical professionals from across Greater Boston — together with Croatian professionals working in the United States — for an evening of panels on Croatia&ndash;US biomedical collaboration, five-minute presentations by participants, and a networking reception.</p>
    <p class="program"><b>The program.</b> Welcome remarks &middot; panel discussion &middot; 5-minute participant presentations &middot; networking reception. ~40&ndash;60 invited guests.</p>
  </section>

  <section class="sheet" aria-label="Registration">
    <div id="formwrap">
      <p class="slabel">Reserve your place</p><div class="rule"></div>
      <form id="regform" novalidate>
        <div class="field"><label for="f_name">Full name</label>
          <input type="text" id="f_name" name="name" autocomplete="name" placeholder="e.g. Ana Horvat, MD" required></div>
        <div class="field"><label for="f_email">Email</label>
          <input type="email" id="f_email" name="email" autocomplete="email" placeholder="you@institution.edu" required></div>
        <div class="field"><label for="f_inst">Institution</label>
          <input type="text" id="f_inst" name="institution" autocomplete="organization" placeholder="Hospital, university, institute or company" required></div>
        <div class="field"><label for="f_pos">Position <span class="opt">(optional)</span></label>
          <input type="text" id="f_pos" name="position" autocomplete="organization-title" placeholder="e.g. Postdoctoral fellow"></div>
        <label class="check" for="f_pres">
          <input type="checkbox" id="f_pres" name="presentation">
          <span class="t">I would like to give a short 5-minute presentation of my lab, clinic, department, or institution.</span>
        </label>
        <p class="slots">Presentation slots are confirmed by email based on the total number of requests.</p>
        <button type="submit" class="btn" id="subbtn">Register for the evening</button>
        <div class="err" id="errbox"></div>
      </form>
      <p class="fine">Your confirmation email arrives with your entry QR code, Apple &amp; Google Wallet passes and a calendar invite. Your personal data is processed under the EU GDPR and used solely to organize this event. Questions? Laura Rodman (<a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>)</p>
    </div>
    <div id="done">
      <p class="slabel" style="text-align:center;">Registration received</p>
      <p class="headline">You are <i style="font-weight:400;">in</i>.</p>
      <p class="lede" id="donetext">Your confirmation email is on its way — it carries your <b>entry QR code</b> and your <b>Apple &amp; Google Wallet passes</b>. Show either at the door.</p>
      <a class="cal" href="/boston.ics">Add to calendar &darr;</a>
    </div>
  </section>
</main>

${FOOTER_HTML}

<script>
(function(){
  var form=document.getElementById('regform'),btn=document.getElementById('subbtn'),errbox=document.getElementById('errbox');
  form.addEventListener('submit',function(ev){
    ev.preventDefault();errbox.style.display='none';
    var name=document.getElementById('f_name').value.trim(),
        email=document.getElementById('f_email').value.trim(),
        inst=document.getElementById('f_inst').value.trim(),
        pos=document.getElementById('f_pos').value.trim(),
        pres=document.getElementById('f_pres').checked;
    if(!name||!email||!inst){errbox.textContent='Please fill in your name, email and institution.';errbox.style.display='block';return;}
    btn.disabled=true;btn.textContent='Registering\u2026';
    fetch('/api/boston/register',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({name:name,email:email,institution:inst,position:pos,presentation:pres})})
    .then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j};});})
    .then(function(res){
      if(res.ok&&(res.j.success||res.j.already)){
        if(res.j.already){document.getElementById('donetext').innerHTML='You were already registered — we have <b>re-sent your confirmation email</b> with your entry QR and wallet passes to <b>'+email.replace(/</g,'&lt;')+'</b>.';}
        document.getElementById('formwrap').style.display='none';
        document.getElementById('done').style.display='block';
        window.scrollTo({top:document.getElementById('done').getBoundingClientRect().top+window.pageYOffset-90,behavior:'smooth'});
      }else{
        errbox.textContent=(res.j&&res.j.error)||'Registration failed. Please try again.';errbox.style.display='block';
        btn.disabled=false;btn.textContent='Register for the evening';
      }
    })
    .catch(function(){errbox.textContent='We could not reach the server. Please try again.';errbox.style.display='block';btn.disabled=false;btn.textContent='Register for the evening';});
  });
})();
</script>
</body></html>`;
}

// ---------------------------------------------------------------- personal upload page
function uploadPage(reg, current, s3ok, token) {
    const first = reg.first_name || 'there';
    const fullName = `${reg.first_name || ''} ${reg.last_name || ''}`.trim() || 'Med&X Guest';
    const currentCard = current ? `
      <div class="onfile" id="onfile">
        <p class="slabel" style="margin-bottom:8px;">On file with us</p>
        <p class="fname" id="of_name">${esc(current.original_name)}</p>
        <p class="fmeta" id="of_meta">${esc(prettySize(Number(current.size)))} &middot; uploaded ${esc(fmtWhen(current.uploaded_at))}</p>
        <p class="fnote">Uploading a new file from this page replaces it for the team.</p>
      </div>` : '';
    const uploader = s3ok ? `
      ${currentCard}
      <div id="upwrap">
        <div class="drop" id="drop" tabindex="0" role="button" aria-label="Choose your presentation file">
          <div class="dtitle">${current ? 'Replace it — drag &amp; drop the new file here' : 'Drag &amp; drop your presentation here'}</div>
          <div class="dor">or</div>
          <button type="button" class="pick" id="pickbtn">${current ? 'Choose a replacement file' : 'Browse for the file'}</button>
          <input type="file" id="fileinput" accept="${ACCEPT_ATTR}" hidden>
        </div>
        <p class="reqs">Accepted: <b>.pdf &middot; .ppt &middot; .pptx &middot; .key</b> — up to <b>25 MB</b>.</p>
        <div class="picked" id="picked" style="display:none;">
          <span class="pname" id="pname"></span><span class="psize" id="psize"></span>
          <button type="button" class="btn" id="upbtn">Upload</button>
        </div>
        <div class="prog" id="prog" style="display:none;"><div class="bar" id="bar"></div></div>
        <div class="err" id="errbox"></div>
      </div>
      <div id="donebox" style="display:none;">
        <p class="slabel" style="text-align:center;">Received</p>
        <p class="headline">Got it.</p>
        <p class="lede"><b id="donefile"></b> is safely with us. You can replace it any time from this same link.</p>
      </div>` : `
      ${currentCard}
      <div class="soon">
        <p class="slabel" style="margin-bottom:8px;">Uploads open soon</p>
        <p class="lede" style="text-align:left;max-width:none;">This personal link is yours and will be ready shortly — keep it. Nothing else is needed from you for now. Questions? Laura Rodman (<a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>).</p>
      </div>`;

    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Upload your presentation — Building Bridges Boston · Med&amp;X</title>
<meta name="robots" content="noindex, nofollow">
<link rel="icon" type="image/png" href="/assets/favicon-x.png">
${FONTS_HTML}
<style>${BASE_CSS}
.who{margin-top:18px;font-size:13px;color:rgba(243,236,224,.85);line-height:1.7;}
.who b{color:#fff;font-weight:600;}
.who .attr{display:block;font-size:11.5px;color:rgba(243,236,224,.55);}
.onfile{border:1px solid rgba(176,137,59,.28);background:#f4eede;border-radius:14px;padding:18px 20px;margin-bottom:20px;}
.fname{font-family:'Fraunces',Georgia,serif;font-weight:600;font-size:17px;color:#241d18;word-break:break-word;}
.fmeta{margin-top:4px;font-size:12.5px;color:var(--muted);}
.fnote{margin-top:10px;font-size:12px;color:#8a7d70;line-height:1.6;}
.drop{border:1.5px dashed rgba(176,137,59,.55);border-radius:16px;background:#fdfbf5;padding:34px 20px;text-align:center;cursor:pointer;transition:border-color .15s,background .15s;}
.drop.over{border-color:var(--crimson);background:#faf3ec;}
.dtitle{font-family:'Fraunces',Georgia,serif;font-size:16.5px;color:#3a322b;}
.dor{margin:10px 0;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#a89a86;}
.pick{padding:11px 22px;border-radius:10px;border:1px solid rgba(43,33,25,.22);background:#fff;font-family:inherit;font-size:13.5px;font-weight:600;color:#4a3f36;cursor:pointer;}
.pick:hover{background:rgba(43,33,25,.045);}
.reqs{margin:12px 2px 0;font-size:12px;color:var(--muted);line-height:1.6;}
.reqs b{color:#4a4139;font-weight:600;}
.picked{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;margin-top:16px;padding:14px 16px;border:1px solid rgba(43,33,25,.12);border-radius:12px;background:#fff;}
.pname{font-weight:600;font-size:14px;color:#241d18;word-break:break-word;flex:1 1 100%;}
.psize{font-size:12px;color:var(--muted);}
.btn{padding:13px 30px;border:none;border-radius:11px;cursor:pointer;font-family:inherit;font-size:14px;font-weight:600;color:#fbf3e6;margin-left:auto;
  background:linear-gradient(180deg,#a03330,var(--crimson));box-shadow:0 12px 26px -12px rgba(143,45,42,.7);}
.btn:disabled{opacity:.55;cursor:not-allowed;}
.prog{margin-top:14px;height:7px;border-radius:5px;background:rgba(43,33,25,.1);overflow:hidden;}
.bar{height:100%;width:0%;background:linear-gradient(90deg,var(--gold),#c79a4d);transition:width .2s;}
.err{display:none;margin-top:14px;padding:12px 14px;border-radius:10px;background:rgba(143,45,42,.08);border:1px solid rgba(143,45,42,.3);color:#7c2320;font-size:13.5px;line-height:1.55;}
.headline{font-family:'Fraunces',Georgia,serif;font-weight:600;font-size:clamp(26px,6vw,34px);line-height:1.1;letter-spacing:-.4px;color:#241d18;margin:6px 0 14px;text-align:center;}
.lede{font-size:15px;line-height:1.7;color:var(--muted);max-width:440px;margin:0 auto;text-align:center;}
.lede b{color:#2c2521;word-break:break-word;}
.soon{border:1px solid rgba(176,137,59,.28);background:#f4eede;border-radius:14px;padding:20px 22px;}
</style></head><body>

<header class="miniband">
  <div class="inner">
    <div class="orgs">
      <img class="medx" src="${LOGO_URL}" alt="Med&amp;X">
      <span class="x">&times;</span>
      <span class="hmpa"><img src="/boston/hmpa.png" alt="Harvard Medical Postdoc Association"></span>
    </div>
    <p class="kicker">Building Bridges — Boston &middot; 5-minute presentations</p>
    <h1>Hi ${esc(first)} — upload your 5-minute presentation</h1>
    <p class="who"><b>${esc(fullName)}</b> &middot; ${esc(reg.institution || '')}<span class="attr">Files uploaded from this page are attributed to this registration.</span></p>
  </div>
</header>

<main>
  <section class="sheet" aria-label="Upload">
    ${uploader}
  </section>
</main>

${FOOTER_HTML}

<script>
(function(){
  var API='/api/boston/upload/${token}';
  var MAX=${MAX_UPLOAD_BYTES};
  var input=document.getElementById('fileinput');
  if(!input) return;                                    /* uploads-open-soon page has no uploader */
  var drop=document.getElementById('drop'),pick=document.getElementById('pickbtn'),
      picked=document.getElementById('picked'),pname=document.getElementById('pname'),psize=document.getElementById('psize'),
      upbtn=document.getElementById('upbtn'),errbox=document.getElementById('errbox'),
      prog=document.getElementById('prog'),bar=document.getElementById('bar'),file=null;
  function human(n){return n>=1048576?(n/1048576).toFixed(1)+' MB':Math.max(1,Math.round(n/1024))+' KB';}
  function err(m){errbox.textContent=m;errbox.style.display='block';}
  function take(f){
    errbox.style.display='none';
    if(!f)return;
    if(!/\\.(pdf|ppt|pptx|key)$/i.test(f.name)){err('That file type is not accepted — please choose a .pdf, .ppt, .pptx or .key file.');return;}
    if(f.size>MAX){err('That file is over the 25 MB limit ('+human(f.size)+'). Please compress it (or export a PDF) and try again.');return;}
    file=f;pname.textContent=f.name;psize.textContent=human(f.size);picked.style.display='flex';
  }
  pick.addEventListener('click',function(){input.click();});
  drop.addEventListener('click',function(e){if(e.target!==pick)input.click();});
  drop.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();input.click();}});
  input.addEventListener('change',function(){take(input.files[0]);});
  ;['dragenter','dragover'].forEach(function(ev){drop.addEventListener(ev,function(e){e.preventDefault();drop.classList.add('over');});});
  ;['dragleave','drop'].forEach(function(ev){drop.addEventListener(ev,function(e){e.preventDefault();drop.classList.remove('over');});});
  drop.addEventListener('drop',function(e){take(e.dataTransfer.files&&e.dataTransfer.files[0]);});
  upbtn.addEventListener('click',function(){
    if(!file)return;
    errbox.style.display='none';upbtn.disabled=true;upbtn.textContent='Uploading\u2026';
    prog.style.display='block';bar.style.width='0%';
    var fd=new FormData();fd.append('file',file,file.name);
    var xhr=new XMLHttpRequest();
    xhr.open('POST',API);
    xhr.upload.onprogress=function(e){if(e.lengthComputable)bar.style.width=Math.round(100*e.loaded/e.total)+'%';};
    xhr.onload=function(){
      var j=null;try{j=JSON.parse(xhr.responseText);}catch(e){}
      if(xhr.status===200&&j&&j.success){
        bar.style.width='100%';
        document.getElementById('donefile').textContent=j.filename||file.name;
        document.getElementById('upwrap').style.display='none';
        var of=document.getElementById('onfile');if(of)of.style.display='none';
        document.getElementById('donebox').style.display='block';
        window.scrollTo({top:0,behavior:'smooth'});
      }else{
        err((j&&j.error)||'The upload did not go through. Please try again.');
        upbtn.disabled=false;upbtn.textContent='Upload';prog.style.display='none';
      }
    };
    xhr.onerror=function(){err('We could not reach the server. Please check your connection and try again.');upbtn.disabled=false;upbtn.textContent='Upload';prog.style.display='none';};
    xhr.send(fd);
  });
})();
</script>
</body></html>`;
}

// ---------------------------------------------------------------- friendly 404 / notice pages
function simplePage(title, headline, proseHtml) {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)} · Med&amp;X</title>
<meta name="robots" content="noindex, nofollow">
<link rel="icon" type="image/png" href="/assets/favicon-x.png">
${FONTS_HTML}
<style>${BASE_CSS}
.headline{font-family:'Fraunces',Georgia,serif;font-weight:600;font-size:clamp(26px,6vw,34px);line-height:1.12;letter-spacing:-.4px;color:#241d18;margin:2px 0 14px;}
.lede{font-size:15px;line-height:1.72;color:#4a4139;}
.lede a{color:var(--crimson);font-weight:600;text-decoration:none;}
</style></head><body>
<header class="miniband"><div class="inner">
  <div class="orgs">
    <img class="medx" src="${LOGO_URL}" alt="Med&amp;X">
    <span class="x">&times;</span>
    <span class="hmpa"><img src="/boston/hmpa.png" alt="Harvard Medical Postdoc Association"></span>
  </div>
  <p class="kicker">Building Bridges — Boston</p>
  <h1>${headline}</h1>
</div></header>
<main><section class="sheet"><p class="lede">${proseHtml}</p></section></main>
${FOOTER_HTML}
</body></html>`;
}
function uploadNotFoundPage() {
    return simplePage('This link is not quite right', 'This link is not quite right.',
        `The upload link you opened is incomplete or has been mistyped — links are personal, so every character matters. Please open the exact link you were sent (copy &amp; paste is safest). If it still does not work, write to Laura Rodman (<a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>) and we will sort it out.`);
}

// ---------------------------------------------------------------- team page
function adminPage(data, key) {
    const rowsHtml = data.rows.map(r => {
        const chips = (r.requested ? '<span class="chip">requested</span>' : '')
            + (r.upload ? '<span class="chip ok">uploaded</span>' : '');
        const status = r.upload
            ? `<p class="fname">${esc(r.upload.filename)}</p>
               <p class="fmeta">${esc(prettySize(r.upload.size))} &middot; ${esc(fmtWhen(r.upload.uploaded_at))}${r.upload.versions > 1 ? ' &middot; v' + r.upload.versions : ''}</p>
               <a class="dl" href="${esc(r.upload.download_url)}">Download &darr;</a>`
            : `<p class="notyet">not yet</p>`;
        return `<div class="prow">
      <div class="who"><b>${esc(r.name)}</b>${chips}<span>${esc(r.institution)}</span><span class="em">${esc(r.email)}</span></div>
      <div class="stat">${status}</div>
      <div class="linkrow">
        <input readonly value="${esc(r.upload_url)}" aria-label="Personal upload link for ${esc(r.name)}">
        <button type="button" class="copy" data-link="${esc(r.upload_url)}">Copy link</button>
      </div>
    </div>`;
    }).join('\n');

    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>5-minute presentations — Building Bridges Boston · Med&amp;X</title>
<meta name="robots" content="noindex, nofollow">
<link rel="icon" type="image/png" href="/assets/favicon-x.png">
${FONTS_HTML}
<style>${BASE_CSS}
main{max-width:760px;}
.statsline{margin-top:16px;font-size:13px;color:rgba(243,236,224,.8);}
.statsline b{color:#fff;}
.warn{margin-top:14px;font-size:12.5px;color:#e8c98a;}
.prow{padding:18px 0;border-top:1px solid rgba(43,33,25,.1);display:grid;grid-template-columns:1.2fr 1fr;gap:6px 18px;}
.prow:first-of-type{border-top:none;padding-top:4px;}
.who{font-size:14px;color:#241d18;line-height:1.6;}
.who b{font-family:'Fraunces',Georgia,serif;font-weight:600;font-size:16px;margin-right:8px;}
.who span:not(.chip){display:block;color:var(--muted);font-size:12.5px;}
.who .em{color:#8a7d70;}
.chip{display:inline-block;vertical-align:2px;margin-right:6px;padding:2.5px 9px;border-radius:20px;font-size:10px;font-weight:600;letter-spacing:1.2px;text-transform:uppercase;border:1px solid rgba(176,137,59,.4);color:#8a6a25;background:#f6efdc;}
.chip.ok{border-color:rgba(47,110,58,.35);color:#2f6e3a;background:#eaf3ea;}
.fname{font-weight:600;font-size:13.5px;color:#241d18;word-break:break-word;}
.fmeta{font-size:12px;color:var(--muted);margin-top:2px;}
.notyet{font-size:12px;letter-spacing:1.6px;text-transform:uppercase;color:#a89a86;font-weight:600;padding-top:6px;}
.dl{display:inline-block;margin-top:8px;padding:8px 16px;border-radius:9px;font-size:12.5px;font-weight:600;color:#fbf3e6;text-decoration:none;background:linear-gradient(180deg,#a03330,var(--crimson));}
.linkrow{grid-column:1 / -1;display:flex;gap:8px;margin-top:6px;}
.linkrow input{flex:1;min-width:0;padding:9px 12px;border:1px solid rgba(43,33,25,.14);border-radius:9px;background:#fff;font-size:11.5px;color:#6f6256;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;}
.copy{padding:9px 16px;border-radius:9px;border:1px solid rgba(43,33,25,.22);background:#fff;font-family:inherit;font-size:12.5px;font-weight:600;color:#4a3f36;cursor:pointer;white-space:nowrap;}
.copy:hover{background:rgba(43,33,25,.045);}
.copy.done{border-color:rgba(47,110,58,.5);color:#2f6e3a;}
.jsonhint{margin-top:18px;padding-top:14px;border-top:1px solid rgba(43,33,25,.1);font-size:11.5px;color:#8a7d70;line-height:1.7;word-break:break-all;}
@media(max-width:560px){.prow{grid-template-columns:1fr;}}
</style></head><body>
<header class="miniband"><div class="inner">
  <div class="orgs">
    <img class="medx" src="${LOGO_URL}" alt="Med&amp;X">
    <span class="x">&times;</span>
    <span class="hmpa"><img src="/boston/hmpa.png" alt="Harvard Medical Postdoc Association"></span>
  </div>
  <p class="kicker">Building Bridges — Boston &middot; Team view</p>
  <h1>5-minute presentations</h1>
  <p class="statsline"><b>${data.uploaded}</b> uploaded &middot; <b>${data.requested}</b> requested &middot; ${data.rows.length} listed</p>
  ${data.s3_configured ? '' : '<p class="warn">S3 is not configured yet — links can be shared, uploads start working the moment BB_S3_* is set.</p>'}
</div></header>
<main>
  <section class="sheet" aria-label="Presenters">
    <p class="slabel">Who requested &middot; who uploaded</p><div class="rule"></div>
    ${rowsHtml || '<p class="notyet" style="padding:10px 0;">No presentation requests yet.</p>'}
    <p class="jsonhint">Send each guest their personal link above (copy → email; nothing is emailed automatically).
    JSON for the admin portal: <b>/api/boston/presentations?key=${esc(key)}</b> &middot; Registrant CSV: <b>/api/boston/registrations.csv?key=${esc(key)}</b></p>
  </section>
</main>
${FOOTER_HTML}
<script>
(function(){
  document.querySelectorAll('.copy').forEach(function(btn){
    btn.addEventListener('click',function(){
      var link=btn.getAttribute('data-link');
      function done(){btn.classList.add('done');btn.textContent='Copied \u2713';setTimeout(function(){btn.classList.remove('done');btn.textContent='Copy link';},1600);}
      if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(link).then(done,function(){fallback();});}
      else fallback();
      function fallback(){var inp=btn.parentElement.querySelector('input');inp.focus();inp.select();try{document.execCommand('copy');done();}catch(e){}}
    });
  });
})();
</script>
</body></html>`;
}
