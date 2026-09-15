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
 *   GET  /boston/onepager/:token              — personal one-slide-summary page — EVERY guest (no login)
 *   POST /api/boston/onepager/:token          — multipart upload → S3 (PDF or .ppt/.pptx, 10 MB)
 *                                               + headline + the share-with-participants consent
 *   GET  /api/boston/onepagers?key=…          — team JSON: who sent a summary, headline, consent, download
 *   GET  /api/boston/onepagers.zip?key=…      — the SHARED summaries in one archive (private ones left out)
 *   GET  /api/boston/onepagers/:id/download?key=… — 302 → 15-minute presigned S3 GET
 *   GET  /boston/presentations?key=…          — team page: who requested / who uploaded, links, downloads
 *   GET  /api/boston/presentations?key=…      — the same data as JSON (for the v2 admin portal later)
 *   GET  /api/boston/presentations/:id/download?key=… — 302 → 15-minute presigned S3 GET
 *   GET  /api/boston/registrations.csv?key=…  — full registrant export (UTF-8 BOM, quoted, CRLF)
 *   GET  /boston/rsvp/:token/:answer          — one-tap catering answer (no login, HMAC token);
 *                                               records it, then offers the other question inline.
 *                                               answer 'cannot-attend' draws a CONFIRM page and
 *                                               writes nothing (a mail scanner must not cancel a seat)
 *   POST /api/boston/rsvp/:token/allergies    — the single "what to avoid" box behind that page
 *   POST /api/boston/rsvp/:token/cannot-attend— releases the seat (status cancelled + dated notes
 *                                               marker + custom_answers.cannot_attend_at); every
 *                                               other answer the guest gave is kept, so a restore
 *                                               is one field away. Idempotent; FYIs the two organizers
 *   POST /api/boston/registrations/:id/restore?key=… — the team's undo: back to 'registered'
 *   GET  /api/boston/program?key=…            — the program PDF's status (present / size / uploaded)
 *   POST /api/boston/program?key=…            — replace the program PDF (multipart, ≤10 MB)
 *   POST /api/boston/reminders/send?key=…     — THE Boston email: {to:'preview'|'all'|'<id>'}
 *   GET  /api/boston/catering?key=…           — catering summary + one row per registrant (JSON)
 *   GET  /api/boston/catering.csv?key=…       — the caterer's list (name, institution, preference,
 *                                               allergies, answered at, presenter)
 *
 * Storage: the existing bridges_events / bridges_registrations tables (event row find-or-created with
 * the FIXED id below), plus bridges_presentations and bridges_onepagers (both created lazily here)
 * for uploaded talk files and participant one-slide summaries.
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
const brandedQr = require('../../shared/branded-qr');

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
// The owner's program PDF (BB_Boston_Event_Info_and_Presentation_Instructions, 2026-09-13) is the
// source of truth for the two facts a presenter needs, so both live here once and every email and
// page reads them from this one place. Real UTF-8 punctuation — the same as the rest of the wing.
const SLIDES_DEADLINE = 'Sunday, 20 September 2026';
const SLIDES_FORMAT_LINE = '5 minutes · 5 to 8 slides · PowerPoint 16:9, in English (PDF also accepted) · up to 25 MB · all talks run from one laptop';

// ------------------------------------------------------- one-slide summary constants (EVERYONE)
// The PDF calls it a ONE-SLIDE SUMMARY: "who you are, what you do, and what you are looking for in
// a collaborator, with your contact details". Every guest is encouraged to send one, presenter or
// not, and the summaries go to all participants after the event — but only "if you are happy to
// share it", which is the consent checkbox below (ticked by default, stored per upload).
// Internally the table, the routes and the S3 prefix keep the older "onepager" name.
const MAX_ONEPAGER_BYTES = 10 * 1024 * 1024;           // 10 MB
const ONEPAGER_PREFIX = 'boston/onepagers';            // S3: boston/onepagers/<registration id>/<id>.<ext>
const MAX_HEADLINE_CHARS = 120;                        // "Sleep neuroscientist · looking for clinical collaborators"
const MAX_LINK_CHARS = 600;                            // a Drive / Dropbox share link (the over-25 MB slides lane)
const SUMMARY_TYPES = {                                 // a slide is a slide — PDF or PowerPoint
    pdf:  { mime: 'application/pdf' },
    ppt:  { mime: 'application/vnd.ms-powerpoint' },
    pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }
};
const SUMMARY_ACCEPT_ATTR = '.pdf,.ppt,.pptx';
const SUMMARY_BRIEF = 'who you are, what you do, and what you are looking for in a collaborator &mdash; with your contact details';
const SUMMARY_SHARE_LABEL = 'Yes, share my summary with all participants after the event';

// ---------------------------------------------------------------- the program PDF (the ONE attachment)
// The evening's program travels as an attachment on the one email. Two ways to provide it, checked
// in this order: BB_PROGRAM_PDF_KEY (an S3 key set in the env) or the admin-uploaded file at the
// fixed key below. Nothing is generated here — the owner's PDF is the program.
const MAX_PROGRAM_BYTES = 10 * 1024 * 1024;            // 10 MB
const PROGRAM_UPLOAD_KEY = 'boston/program/program.pdf';
const PROGRAM_FILENAME = 'Building-Bridges-Boston-Program.pdf';
const programKey = () => String(process.env.BB_PROGRAM_PDF_KEY || '').trim() || PROGRAM_UPLOAD_KEY;

// ---------------------------------------------------------------- catering (one-tap answers)
// Two questions, both critical for the caterer, both answerable from the reminder email without a
// login and without re-typing a name: every button in that email is a link carrying the guest's
// own HMAC token. The keys below are the ONLY answers the route accepts; the labels are what lands
// in bridges_registrations.dietary_requirements (so the CSV and the sheet read as written).
const DIET_PREFS = {
    'none':        'No restrictions',
    'vegetarian':  'Vegetarian',
    'vegan':       'Vegan',
    'halal':       'Halal',
    'kosher':      'Kosher',
    'gluten-free': 'Gluten-free'
};
const PREF_KEYS = Object.keys(DIET_PREFS);
const ALLERGY_NONE = 'no-allergies';        // one tap — "no allergies"
const ALLERGY_TELL = 'allergies';           // one tap — opens the single text box
const RSVP_OPEN = 'open';                   // the "change" link — shows the page, writes nothing
// "I can't make it after all" — the same diet token, a seventh whitelisted answer, so the email
// needs no new token type. Deliberately NOT a write: the GET only draws a confirm page, because a
// mail scanner that follows every link in an email must never be able to cancel somebody's seat.
// The release itself is the POST below, from that page.
const CANNOT_ATTEND = 'cannot-attend';
const RSVP_ANSWERS = PREF_KEYS.concat([ALLERGY_NONE, ALLERGY_TELL, RSVP_OPEN, CANNOT_ATTEND]);
const ALLERGY_PREFIX = 'Allergies: ';       // how the answer lives inside special_requests
const ALLERGY_NONE_VALUE = 'none';
const MAX_ALLERGY_CHARS = 300;
const REMINDER_MARK = 'REMINDER-SENT';
// A seat given back by the guest, and a seat put back by the team. Both live as dated markers in
// notes (the same restart-safe bookkeeping the reminder and the review gate use), so the history
// of a row reads in one column and nothing new has to be migrated into the schema.
const CANCELLED_MARK = 'CANCELLED-BY-GUEST';
const RESTORED_MARK = 'RESTORED-BY-TEAM';
// The one sentence every released-seat surface says — page notice and API refusal alike, so a
// guest who taps an old link and a guest who forces the form behind it read the same thing.
const RELEASED_LINE = when => `Your seat was released${when ? ' on ' + when : ''} — write to Laura if plans change.`;
// The same sentence for a page: one source, so the notice and the refusal can never drift apart.
const RELEASED_LINE_HTML = when => esc(RELEASED_LINE(when)).replace('—', '&mdash;');

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

// ---- catering answers, read and written inside the two existing free-text columns -------------
// special_requests is a ' | '-joined list; the allergy answer owns the segment that starts with
// "Allergies:" and nothing else in that column is ever disturbed.
function allergyPart(specialRequests) {
    for (const p of String(specialRequests || '').split(' | ')) {
        const s = p.trim();
        if (/^allergies:/i.test(s)) return s.slice(s.indexOf(':') + 1).trim() || ALLERGY_NONE_VALUE;
    }
    return null;                                        // never answered
}
function withAllergyPart(specialRequests, value) {
    const keep = String(specialRequests || '').split(' | ').map(s => s.trim())
        .filter(s => s && !/^allergies:/i.test(s));
    return [ALLERGY_PREFIX + value].concat(keep).join(' | ');
}
const prefKeyOf = label => {
    const want = String(label || '').trim().toLowerCase();
    return want ? (PREF_KEYS.find(k => DIET_PREFS[k].toLowerCase() === want) || null) : null;
};
// One row's catering answers, as the page, the email, the CSV and the admin card all read them.
function cateringStateOf(reg) {
    const prefLabelRaw = String(reg.dietary_requirements || '').trim();
    const prefKey = prefKeyOf(prefLabelRaw);
    const allergy = allergyPart(reg.special_requests);
    let ca = {};
    try { ca = JSON.parse(reg.custom_answers || '{}') || {}; } catch (e) { ca = {}; }
    if (!ca || typeof ca !== 'object' || Array.isArray(ca)) ca = {};
    return {
        prefKey,
        prefLabel: prefKey ? DIET_PREFS[prefKey] : (prefLabelRaw || null),
        allergyState: allergy == null ? null : (allergy === ALLERGY_NONE_VALUE ? 'none' : 'yes'),
        allergyText: allergy && allergy !== ALLERGY_NONE_VALUE ? allergy : '',
        answeredAt: ca.answered_at ? String(ca.answered_at) : null,
        answered: !!(prefKey || prefLabelRaw || allergy != null)
    };
}
// ---- who actually presents ---------------------------------------------------------------------
// Alen 2026-09-14: about thirty people ticked "5-minute presentation" and the evening has room for
// far fewer, so he picks. That makes two different facts, and they must never be conflated:
//   · requestedPresentation(r) — they OFFERED. Written at registration, never changed afterwards.
//   · presenterStatusOf(r)     — HIS decision: 'confirmed', 'declined', or null while he decides.
// isPresenterRow keeps its old name and its old meaning — "is on the running order" — so every
// existing reader (the email shape, the hub, the slides lane, the admin lists) stays correct. Until
// a row is decided it falls back to the offer, which is exactly the behaviour before he chose.
const PRESENTER_CONFIRMED = 'confirmed';
const PRESENTER_DECLINED = 'declined';
const requestedPresentation = r => /5-minute presentation/.test(String((r && r.notes) || ''));
const presenterStatusOf = r => {
    const v = String((r && r.presenter_status) || '').trim().toLowerCase();
    return v === PRESENTER_CONFIRMED || v === PRESENTER_DECLINED ? v : null;
};
const isPresenterRow = r => {
    const s = presenterStatusOf(r);
    if (s === PRESENTER_CONFIRMED) return true;
    if (s === PRESENTER_DECLINED) return false;
    return requestedPresentation(r);
};
// The one shape that earns the warm note: they offered, and he could not fit them in. A row marked
// declined that never offered is a data slip, not a disappointment — it gets the plain guest email.
const wasDeclinedPresenter = r => presenterStatusOf(r) === PRESENTER_DECLINED && requestedPresentation(r);
// A released seat: the row is cancelled. `releasedOn` prefers the dated notes marker, falls back to
// the custom_answers stamp, and answers '' when a row is cancelled without either (a review-gate
// rejection) — so every reader can say "released" without ever printing "undefined".
const isReleasedRow = r => String((r && r.status) || '').toLowerCase() === 'cancelled';
const releasedByGuest = r => new RegExp(CANCELLED_MARK).test(String((r && r.notes) || ''));
function releasedOn(reg) {
    const m = new RegExp(CANCELLED_MARK + '\\s+(\\d{4}-\\d{2}-\\d{2})').exec(String((reg && reg.notes) || ''));
    if (m) return m[1];
    let ca = {};
    try { ca = JSON.parse((reg && reg.custom_answers) || '{}') || {}; } catch (e) { ca = {}; }
    return ca && ca.cannot_attend_at ? String(ca.cannot_attend_at).slice(0, 10) : '';
}
const wasReminded = r => Number((r && r.reminder_sent) || 0) === 1 || new RegExp(REMINDER_MARK).test(String((r && r.notes) || ''));
const remindedOn = r => {
    const m = new RegExp(REMINDER_MARK + '\\s+(\\d{4}-\\d{2}-\\d{2})').exec(String((r && r.notes) || ''));
    return m ? m[1] : (wasReminded(r) ? '' : null);
};

// Magic-byte check — the extension must match what the bytes actually are.
function magicOk(ext, buf) {
    if (!buf || buf.length < 8) return false;
    const starts = sig => sig.every((b, i) => buf[i] === b);
    if (ext === 'pdf') return buf.slice(0, 1024).includes('%PDF');   // the PDF spec allows a short preamble
    if (ext === 'ppt') return starts([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])  // OLE2 compound file
        || starts([0x50, 0x4b, 0x03, 0x04]);                          // …or a renamed .pptx (common)
    return starts([0x50, 0x4b, 0x03, 0x04]);                          // pptx / key — zip containers
}

// ---- minimal ZIP writer (stored entries, UTF-8 names) -----------------------------------------
// Decks and PDFs are already compressed, so entries go in STORED and the whole archive is plain
// buffer arithmetic over node's zlib.crc32 — no zip dependency. One writer, two archives (every
// presentation, every one-pager): the naming rule is the caller's, the bytes are identical.
const zipSafe = str => String(str || '').normalize('NFKD').replace(/[^\w.\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 60) || 'x';
function buildZip(entries) {
    const zlib = require('zlib');
    const parts = []; const central = []; let offset = 0;
    const dosTime = (() => { const d = new Date(); return { t: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff, d: (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff }; })();
    for (const e of entries) {
        const name = Buffer.from(e.name, 'utf8'); const crc = zlib.crc32(e.data) >>> 0;
        const lh = Buffer.alloc(30);
        lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(0, 8);
        lh.writeUInt16LE(dosTime.t, 10); lh.writeUInt16LE(dosTime.d, 12); lh.writeUInt32LE(crc, 14);
        lh.writeUInt32LE(e.data.length, 18); lh.writeUInt32LE(e.data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
        const ch = Buffer.alloc(46);
        ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(0, 10);
        ch.writeUInt16LE(dosTime.t, 12); ch.writeUInt16LE(dosTime.d, 14); ch.writeUInt32LE(crc, 16);
        ch.writeUInt32LE(e.data.length, 20); ch.writeUInt32LE(e.data.length, 24); ch.writeUInt16LE(name.length, 28);
        ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32); ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36); ch.writeUInt32LE(0, 38); ch.writeUInt32LE(offset, 42);
        parts.push(lh, name, e.data); central.push(ch, name);
        offset += lh.length + name.length + e.data.length;
    }
    const cdSize = central.reduce((n, b) => n + b.length, 0);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10); eocd.writeUInt32LE(cdSize, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(0, 20);
    return Buffer.concat([...parts, ...central, eocd]);
}

const RESEND_AT = new Map(); // email -> last re-send ms (per process; resets on deploy — fine)

// ---- bot gate (Alen 2026-09-06: gibberish registrations got wallet passes) -----------------
// Score-based: random-string names/institutions/positions ("RQstQeTGKseNqJzmVHMmE", "Ugakeu LLC")
// put the registration on HOLD — no ticket, no sheet row — and Alen gets an approve/reject email.
// ONE shared implementation for every public form (heuristics + tokens + review email + the
// /api/review routes live in ./review-gate; server.js's Zagreb flow uses the same module).
const reviewGate = require('./review-gate');

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

    // Named so the read helpers below can go through S.presignGet — a test that stubs one method
    // is then honored by every other method that leans on it.
    const S = {
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
        },

        /** An object's bytes, pulled through a short-lived presigned GET. Rejects on anything but 200. */
        getObject(objectKey, { expires = 300 } = {}) {
            return new Promise((resolve, reject) => {
                const url = S.presignGet(objectKey, { expires });
                if (!url) return reject(new Error('BB_S3_* env not configured'));
                const req = https.get(url, resp => {
                    if (resp.statusCode !== 200) { resp.resume(); return reject(new Error('S3 GET ' + resp.statusCode + ' for ' + objectKey)); }
                    const chunks = [];
                    resp.on('data', c => chunks.push(c));
                    resp.on('end', () => resolve(Buffer.concat(chunks)));
                    resp.on('error', reject);
                });
                req.setTimeout(60000, () => req.destroy(new Error('S3 GET timed out')));
                req.on('error', reject);
            });
        },

        /** Size + last-modified without pulling the body: a presigned GET, abandoned at the headers.
         *  Answers null for "not there" (and for every failure) — callers treat both the same. */
        headObject(objectKey) {
            return new Promise(resolve => {
                let url = null;
                try { url = S.presignGet(objectKey, { expires: 300 }); } catch (e) { url = null; }
                if (!url) return resolve(null);
                let done = false;
                const finish = v => { if (!done) { done = true; resolve(v); } };
                const req = https.get(url, resp => {
                    const out = resp.statusCode === 200 ? {
                        size: Number(resp.headers['content-length'] || 0),
                        lastModified: resp.headers['last-modified'] ? new Date(resp.headers['last-modified']).toISOString() : null
                    } : null;
                    resp.destroy();
                    finish(out);
                });
                req.setTimeout(20000, () => { req.destroy(); finish(null); });
                req.on('error', () => finish(null));
            });
        }
    };
    return S;
})();

// ---------------------------------------------------------------- branded entry QR (plate overlay)
// qr-plate.png — a 3× (retina-sharp) white plate carrying the Med&X + HMPA logos — is
// alpha-composited onto the center of a 900 px QR rendered at error-correction level H (30%
// recoverable); the email displays it at 120 px so every screen gets ≥3× density and the logos
// stay crisp when tapped-to-enlarge. Decodability is asserted in tests with a real decoder (jsQR).
//
// The compositing itself moved to shared/branded-qr.js (2026-09-11) so the Plexus Week meetup
// codes reuse it with the Med&X-only plate instead of a second copy of the same maths. Same
// pixels as before: 900 px, level H, margin 2, real alpha blend.
const BOSTON_PLATE = path.join(__dirname, 'qr-plate.png');
async function brandedQrPng(payloadJson) {
    return brandedQr.render({ payload: payloadJson, platePath: BOSTON_PLATE, qrcode: QRCodeLib, pngjs: pngjsLib });
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

    // ------------------------------------------------------------ presenter_status (lazy, additive)
    // The owner's pick, one nullable column on the registration row — no new table, nothing to
    // backfill, and every reader already treats NULL as "not decided yet" (see isPresenterRow).
    // Guarded by PRAGMA so a redeploy over an already-migrated database is a no-op.
    let presenterStatusReady = false;
    function ensurePresenterStatusColumn() {
        if (presenterStatusReady) return;
        try {
            const cols = query.all('PRAGMA table_info(bridges_registrations)') || [];
            if (!cols.some(c => String(c.name) === 'presenter_status')) {
                query.run('ALTER TABLE bridges_registrations ADD COLUMN presenter_status TEXT');
                console.log('[Boston] presenter_status column added to bridges_registrations');
            }
            presenterStatusReady = true;
        } catch (e) { console.warn('[Boston] presenter_status migration skipped:', e.message); }
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
        // The over-25 MB lane (Alen 2026-09-15): a deck too big for the uploader lives on the
        // presenter's Google Drive / Dropbox and the row carries the share link instead of a
        // stored object (stored_key '' / size 0). Additive, PRAGMA-guarded like share_ok.
        try {
            const cols = query.all('PRAGMA table_info(bridges_presentations)') || [];
            if (!cols.some(c => String(c.name) === 'external_url')) {
                query.run('ALTER TABLE bridges_presentations ADD COLUMN external_url TEXT');
            }
        } catch (e) { console.warn('[Boston] external_url migration skipped:', e.message); }
        presTableReady = true;
    }
    const isLinkRow = row => !!(row && String(row.external_url || '').trim());
    function latestPresentation(regId) {
        ensurePresentationsTable();
        return query.get(`SELECT * FROM bridges_presentations WHERE registration_id = ?
            ORDER BY uploaded_at DESC, rowid DESC LIMIT 1`, [regId]);
    }

    // ------------------------------------------------------------ bridges_onepagers (lazy)
    // The one-slide summaries — one slide per GUEST, not per presenter. Mirrors
    // bridges_presentations exactly (every upload inserts, the newest row per registrant wins)
    // plus two columns the decks do not need: the optional single-line headline that goes under
    // the name in the index, and share_ok — the guest's own answer to the PDF's "if you are happy
    // to share it". stored_key = boston/onepagers/<regId>/<onepagerId>.<ext>.
    let onePagerTableReady = false;
    function ensureOnepagersTable() {
        if (onePagerTableReady) return;
        query.run(`CREATE TABLE IF NOT EXISTS bridges_onepagers (
            id TEXT PRIMARY KEY,
            registration_id TEXT NOT NULL,
            original_name TEXT NOT NULL,
            stored_key TEXT NOT NULL,
            mime TEXT,
            size INTEGER NOT NULL,
            headline TEXT,
            share_ok INTEGER DEFAULT 1,
            uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP
        )`);
        // Additive migration for a table created before the consent question existed. Nullable,
        // defaulting to 1: a row uploaded when sharing was the stated promise keeps that promise,
        // and readers treat NULL as shared (shareOkOf below) so nothing depends on a backfill.
        try {
            const cols = query.all('PRAGMA table_info(bridges_onepagers)') || [];
            if (!cols.some(c => String(c.name) === 'share_ok')) {
                query.run('ALTER TABLE bridges_onepagers ADD COLUMN share_ok INTEGER DEFAULT 1');
            }
        } catch (e) { console.warn('[Boston] share_ok migration skipped:', e.message); }
        onePagerTableReady = true;
    }
    // The consent, read the same way everywhere: absent/NULL (pre-consent rows, or an upload that
    // never carried the field) means shared, only an explicit 0 keeps a summary private.
    const shareOkOf = row => Number(row && row.share_ok != null ? row.share_ok : 1) !== 0;
    function latestOnepager(regId) {
        ensureOnepagersTable();
        return query.get(`SELECT * FROM bridges_onepagers WHERE registration_id = ?
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
    // Catering-answer token — same scheme again, third distinct HMAC context, so a diet link can
    // never be replayed as a pass or an upload link (and vice versa). This one travels inside the
    // reminder email and is what makes every answer button a one-tap link: possession identifies
    // the guest, so nobody logs in and nobody re-types their name.
    const dietSig = id => crypto.createHmac('sha256', String(JWT_SECRET)).update('boston:diet:' + String(id)).digest('hex').slice(0, 32);
    const dietToken = id => dietSig(id) + '.' + String(id);
    function verifyDietToken(token) {
        const m = /^([0-9a-f]{32})\.([0-9a-fA-F-]{16,64})$/.exec(String(token || ''));
        if (!m) return null;
        const expect = dietSig(m[2]);
        if (!crypto.timingSafeEqual(Buffer.from(m[1]), Buffer.from(expect))) return null;
        return m[2];
    }
    // One-pager token — the FOURTH distinct HMAC context. A pass, an upload, a diet and a one-pager
    // link are four different keys over the same id: replaying any one of them at another route is
    // a 404, so the booklet lane cannot be opened with a slides link (or the other way round).
    const onepagerSig = id => crypto.createHmac('sha256', String(JWT_SECRET)).update('boston:onepager:' + String(id)).digest('hex').slice(0, 32);
    const onepagerToken = id => onepagerSig(id) + '.' + String(id);
    function verifyOnepagerToken(token) {
        const m = /^([0-9a-f]{32})\.([0-9a-fA-F-]{16,64})$/.exec(String(token || ''));
        if (!m) return null;
        const expect = onepagerSig(m[2]);
        if (!crypto.timingSafeEqual(Buffer.from(m[1]), Buffer.from(expect))) return null;
        return m[2];
    }
    // Hub token — the FIFTH distinct HMAC context, and the only link a guest now needs. It opens
    // the one personal page that carries all three asks; the four older contexts keep working
    // untouched, so links already in somebody's inbox still resolve. Replaying a hub token at any
    // older route (or any older token here) is a 404, exactly as the other four are to each other.
    const meSig = id => crypto.createHmac('sha256', String(JWT_SECRET)).update('boston:me:' + String(id)).digest('hex').slice(0, 32);
    const meToken = id => meSig(id) + '.' + String(id);
    function verifyMeToken(token) {
        const m = /^([0-9a-f]{32})\.([0-9a-fA-F-]{16,64})$/.exec(String(token || ''));
        if (!m) return null;
        const expect = meSig(m[2]);
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

    // ------------------------------------------------------------ live Boston sheet push
    // IMPORTDATA refreshed only hourly (Alen: "not good enough") — so every new registration is
    // APPENDED to the sheet directly via the Sheets API with an OAuth refresh grant. Silent no-op
    // without the env; never blocks or fails a registration.
    let _gTok = null, _gTokAt = 0;
    async function sheetsToken() {
        if (_gTok && Date.now() - _gTokAt < 45 * 60 * 1000) return _gTok;
        // Preferred: the wallet service account (never expires; the sheet must be shared with
        // its client_email as Editor). The user-OAuth refresh token died 2026-09-09 — Google
        // revokes testing-mode refresh tokens after 7 days — killing sheet pushes silently.
        try {
            const sa = JSON.parse(process.env.GOOGLE_WALLET_SA_KEY || 'null');
            if (sa && sa.client_email && sa.private_key) {
                const now = Math.floor(Date.now() / 1000);
                const b64u = x => Buffer.from(JSON.stringify(x)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
                const input = b64u({ alg: 'RS256', typ: 'JWT' }) + '.' + b64u({
                    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets',
                    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600
                });
                const sig = crypto.sign('RSA-SHA256', Buffer.from(input), sa.private_key)
                    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
                const r = await fetch('https://oauth2.googleapis.com/token', {
                    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: input + '.' + sig })
                });
                const j = await r.json();
                if (j.access_token) { _gTok = j.access_token; _gTokAt = Date.now(); return _gTok; }
                console.warn('[Boston] SA sheets token refused:', j.error || r.status);
            }
        } catch (e) { console.warn('[Boston] SA sheets token failed:', e.message); }
        const body = new URLSearchParams({
            client_id: process.env.GOOGLE_OAUTH_CLIENT_ID, client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
            refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN, grant_type: 'refresh_token'
        });
        const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
        const j = await r.json();
        if (!j.access_token) throw new Error('sheets token: ' + (j.error || r.status));
        _gTok = j.access_token; _gTokAt = Date.now();
        return _gTok;
    }
    function bostonSheetRow(reg, presentation, statusLabel) {
        let when = String(reg.registered_at || '');
        try {
            const d = new Date(when.replace(' ', 'T') + (when.includes('Z') ? '' : 'Z'));
            when = d.toLocaleString('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) + ' ET';
        } catch (e) {}
        const label = statusLabel || (reg.status === 'registered' || reg.status === 'confirmed' ? 'Confirmed'
            : reg.status === 'pending-review' ? 'Pending review'
            : reg.status === 'cancelled' ? 'Rejected' : (reg.status || 'registered'));
        return [when, reg.first_name || '', reg.last_name || '', reg.email, reg.institution || '', reg.position || '',
                presentation ? 'Yes' : 'No', label, Number(reg.checked_in) ? 'Yes' : 'No', String(reg.id || '')];
    }
    // Upsert by registration id (column J): held rows land as 'Pending review', then the SAME
    // row is updated in place — 'Institutional confirmation requested' → 'Confirmed'/'Rejected' —
    // so the sheet mirrors the review pipeline without duplicate rows. (Alen 2026-09-06)
    function pushToBostonSheet(reg, presentation, statusLabel) {
        const sheetId = process.env.BB_SHEET_ID;
        if (!sheetId || !process.env.GOOGLE_OAUTH_REFRESH_TOKEN) return;
        const doAppend = tok => fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A1:J1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
            { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
              body: JSON.stringify({ values: [bostonSheetRow(reg, presentation, statusLabel)] }) });
        sheetsToken().then(async tok => {
            const rowIdx = await findBostonSheetRow(tok, sheetId, String(reg.id || ''));
            if (rowIdx == null) return doAppend(tok);
            return fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A${rowIdx}:J${rowIdx}?valueInputOption=RAW`,
                { method: 'PUT', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ values: [bostonSheetRow(reg, presentation, statusLabel)] }) });
        }).then(r => { if (r && !r.ok) console.warn('[Boston] sheet upsert HTTP', r.status); })
          .catch(e => console.warn('[Boston] sheet upsert failed (non-blocking):', e.message));
    }
    async function findBostonSheetRow(tok, sheetId, id) {
        if (!id) return null;
        try {
            const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/J1:J2000`,
                { headers: { Authorization: 'Bearer ' + tok } });
            if (!r.ok) return null;
            const vals = (await r.json()).values || [];
            for (let i = 0; i < vals.length; i++) if ((vals[i][0] || '') === id) return i + 1;
        } catch (e) {}
        return null;
    }
    function updateBostonSheetStatus(id, label) {
        const sheetId = process.env.BB_SHEET_ID;
        if (!sheetId || !process.env.GOOGLE_OAUTH_REFRESH_TOKEN) return;
        sheetsToken().then(async tok => {
            const rowIdx = await findBostonSheetRow(tok, sheetId, String(id));
            if (rowIdx == null) return null;
            return fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/H${rowIdx}?valueInputOption=RAW`,
                { method: 'PUT', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ values: [[label]] }) });
        }).then(r => { if (r && !r.ok) console.warn('[Boston] sheet status HTTP', r.status); })
          .catch(e => console.warn('[Boston] sheet status failed (non-blocking):', e.message));
    }

    // ------------------------------------------------------------ wallet links (email + on-page)
    // Google Wallet — minted with the shared/wallet builders. The dedicated Boston class
    // (BB_GOOGLE_CLASS_ID) carries the event name/venue/date at CLASS level, so the object keeps
    // only what the class can't know: holder name, registration №, status, dress code. Falls back
    // to the shared approved class when the Boston env is absent. Provisioning is non-blocking.
    // Reused by the confirmation email AND the register response, so the success box on the page
    // can offer the same three buttons immediately (Alen 2026-09-01).
    function walletLinks(reg) {
        const base = baseUrl();
        const id = String(reg.id);
        const fullName = `${reg.first_name || ''} ${reg.last_name || ''}`.trim() || 'Med&X Guest';
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
        return { google: walletSaveUrl, apple: appleWalletUrl, calendar: `${base}/boston.ics` };
    }

    function confirmationEmailHtml(reg, presentation) {
        const base = baseUrl();
        const id = String(reg.id);
        const fullName = `${reg.first_name || ''} ${reg.last_name || ''}`.trim() || 'Med&X Guest';
        const first = reg.first_name || 'there';
        const links = walletLinks(reg);
        const walletSaveUrl = links.google, appleWalletUrl = links.apple;

        return emailTemplates.ticketConfirmation({
            firstName: first,
            eventName: 'Building Bridges in Biomedicine — Boston',
            headlineHtml: 'Building Bridges Boston — you are <i>in</i>.',
            introHtml: `Dear ${esc(first)} — your registration is confirmed. Med&X and the Harvard Medical Postdoc Association look forward to welcoming you in the Waterhouse Room, Gordon Hall, Harvard Medical School for an evening of panels, participant presentations and a networking reception.`
                + (presentation ? ` You asked to give a 5-minute presentation — we will confirm presentation slots by email based on the total number of requests.` : ''),
            whenLines: [`${DATE_LONG} · 6:00 PM · doors from 5:30 PM`],
            venue: VENUE_FULL,
            guestLabel: fullName,
            ticketNumber: ticketNo(id),
            ticketLabel: 'Evening registration — free' + (presentation ? ' · 5-minute presentation requested' : ''),
            dressLabel: DRESS,
            qrPngUrl: `${base}/api/boston/qr/${id}.png`,   // branded QR (Med&X × HMPA plate in the middle)
            walletSaveUrl,
            appleWalletUrl,
            calendarUrl: `${base}/boston.ics`,
            note: 'Present the QR above at the door — it is your entry to the evening. The same ticket lives in the wallet passes.',
            replyLine: `Questions? Laura Rodman — ${SUPPORT_EMAIL}.`
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
            // Honeypot: the form carries a visually hidden 'website' input no human sees or
            // tabs into. Filled → a bot autofilled everything: pretend success, write NOTHING.
            if (String(b.website || '').trim()) {
                console.log('[ReviewGate] Boston honeypot tripped — submission silently dropped');
                return res.json({ success: true });
            }
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
            // One person = one registration: a row re-pointed at a verified institutional inbox
            // still answers for the ORIGINAL address it registered with (notes original-email).
            const prior = query.get(`SELECT * FROM bridges_registrations
                WHERE event_id = ? AND (LOWER(email) = LOWER(?) OR notes LIKE '%original-email ' || ? || '%')
                  AND (status IN ('confirmed','registered') OR payment_status IN ('paid','comp'))`, [EVENT_ID, email, String(email).trim().toLowerCase()]);
            if (prior) {
                // Throttle re-sends: one confirmation re-send per address per 10 minutes, so the
                // public form can't be used to bombard someone's inbox.
                const rk = String(email).toLowerCase();
                const last = RESEND_AT.get(rk) || 0;
                if (Date.now() - last < 10 * 60 * 1000) {
                    return res.json({ already: true, wallet: walletLinks(prior), message: 'You are already registered — your confirmation was re-sent a moment ago. Check your inbox (and spam).' });
                }
                RESEND_AT.set(rk, Date.now());
                const priorPresentation = /5-minute presentation/.test(String(prior.notes || ''));
                try {
                    const send = await sendConfirmation(prior, priorPresentation);
                    if (send && send.success !== false && !prior.confirmation_sent) {
                        query.run('UPDATE bridges_registrations SET confirmation_sent = 1 WHERE id = ?', [prior.id]);
                    }
                } catch (e) { console.warn('[Boston] re-send failed:', e.message); }
                return res.json({ already: true, wallet: walletLinks(prior), message: 'You are already registered — we have re-sent your confirmation email to ' + email + '.' });
            }

            // Capacity gate — held seats only (mirrors /api/public-events/register).
            if (evt.capacity) {
                const held = query.get(`SELECT COUNT(*) AS n FROM bridges_registrations
                    WHERE event_id = ? AND (status IN ('confirmed','registered') OR payment_status IN ('paid','comp'))`, [EVENT_ID])?.n || 0;
                if (held >= evt.capacity) {
                    return res.status(409).json({ error: `The guest list is now full. Write to ${SUPPORT_EMAIL} and we will let you know the moment a seat opens.` });
                }
            }

            // ---- review gate (Alen 2026-09-06): gibberish-looking registrations are HELD ----
            // No confirmation, no QR, no wallet pass, no sheet row — Alen decides by email.
            // The response is indistinguishable from a real success so bots learn nothing.
            if (reviewGate.suspicionScore({ name: fullName, institution, position }) >= 2) {
                // One review email per address: a retrying bot must not bombard the inbox.
                const priorHeld = query.get(`SELECT id FROM bridges_registrations
                    WHERE event_id = ? AND LOWER(email) = LOWER(?) AND status = 'pending-review'`, [EVENT_ID, email]);
                if (priorHeld) return res.json({ success: true, held: true });
                const heldId = crypto.randomUUID();
                query.run(`INSERT INTO bridges_registrations
                    (id, event_id, first_name, last_name, email, institution, position, notes, status, payment_status, confirmation_sent, registered_at)
                    VALUES (?,?,?,?,?,?,?,?,'pending-review','n/a',0,CURRENT_TIMESTAMP)`,
                    [heldId, EVENT_ID, first_name, last_name, email, institution, position || null,
                     (presentation ? '5-minute presentation requested | ' : '') + 'HELD — review']);
                flushDb();
                try {
                    const urls = reviewGate.reviewUrls(JWT_SECRET, 'bridges_registrations', heldId);
                    await sendEmail(reviewGate.REVIEW_TO, 'A registration needs your review — Building Bridges Boston',
                        reviewGate.buildReviewEmail({
                            kind: 'Boston form',
                            reason: 'Looks machine-generated',
                            fields: {
                                'Full name': fullName, 'Email': email, 'Institution': institution,
                                'Position': position, '5-min presentation': presentation ? 'Yes' : 'No'
                            },
                            approveUrl: urls.approveUrl, rejectUrl: urls.rejectUrl, verifyUrl: urls.verifyUrl
                        }));
                } catch (e) { console.error('[ReviewGate] Boston review email failed:', e.message); }
                try {
                    await sendEmail(email, 'We received your registration — Building Bridges Boston',
                        reviewGate.buildPendingEmail({ firstName: first_name, eventLabel: EVENT_NAME }));
                } catch (e) { console.warn('[ReviewGate] pending-ack email failed:', e.message); }
                pushToBostonSheet(query.get('SELECT * FROM bridges_registrations WHERE id = ?', [heldId]), presentation, 'Pending review');
                console.log(`[ReviewGate] Boston registration ${heldId} (${email}) held for review`);
                return res.json({ success: true, held: true });
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
// Master Plexus sheet mirror REMOVED (Alen 2026-09-02): Boston rows belong only to the
            // dedicated Boston sheet (pushToBostonSheet below) — the Croatia master must not list them.

            const freshRow = query.get('SELECT * FROM bridges_registrations WHERE id = ?', [id]) || { id };
            pushToBostonSheet(freshRow, presentation);
            res.json({ success: true, wallet: walletLinks(freshRow) });
        } catch (e) {
            console.error('[Boston] registration error:', e.message);
            res.status(500).json({ error: 'Registration failed. Please try again.' });
        }
    });

    // ------------------------------------------------------------ review-gate decisions (bridges)
    // Approve/reject handlers for rows this wing held. The /api/review/:token routes themselves
    // are mounted ONCE from server.js (top level) via reviewGate.mountReviewRoutes; this only
    // plugs the bridges_registrations decisions into that shared dispatcher. Idempotent: a
    // decision applies only to 'pending-review' rows — clicking a link twice re-sends nothing.
    reviewGate.registerReviewHandlers('bridges_registrations', {
        approve: async (id) => {
            const reg = query.get('SELECT * FROM bridges_registrations WHERE id = ? AND event_id = ?', [id, EVENT_ID]);
            if (!reg) return { status: 'notfound' };
            const guest = `${reg.first_name || ''} ${reg.last_name || ''}`.trim() || 'the guest';
            if (reg.status !== 'pending-review') {
                return { status: 'already', headline: reg.status === 'cancelled' ? 'Already rejected.' : 'Already approved.',
                    message: reg.status === 'cancelled'
                        ? `${guest}'s registration was rejected earlier — nothing was sent.`
                        : `${guest}'s registration was approved earlier — the confirmation email was already on its way. Nothing was re-sent.` };
            }
            const notes = String(reg.notes || '').replace('HELD — review', 'HELD — review · approved ' + new Date().toISOString().slice(0, 10));
            query.run(`UPDATE bridges_registrations SET status = 'registered', notes = ? WHERE id = ?`, [notes, id]);
            flushDb();
            const presentation = /5-minute presentation/.test(String(reg.notes || ''));
            const fresh = query.get('SELECT * FROM bridges_registrations WHERE id = ?', [id]) || reg;
            try {
                const send = await sendConfirmation(fresh, presentation);
                if (send && send.success !== false) {
                    query.run('UPDATE bridges_registrations SET confirmation_sent = 1 WHERE id = ?', [id]);
                }
            } catch (e) { console.warn('[ReviewGate] approved-registration confirmation failed:', e.message); }
            pushToBostonSheet(query.get('SELECT * FROM bridges_registrations WHERE id = ?', [id]) || fresh, presentation, 'Confirmed');
            console.log(`[ReviewGate] Boston registration ${id} APPROVED — confirmation sent, sheet row pushed`);
            return { status: 'done', headline: 'Approved.',
                message: `${guest} is registered for Building Bridges Boston — the standard confirmation email (entry QR + wallet passes) has been sent to ${reg.email}, and the row was pushed to the Boston sheet.` };
        },
        reject: async (id) => {
            const reg = query.get('SELECT * FROM bridges_registrations WHERE id = ? AND event_id = ?', [id, EVENT_ID]);
            if (!reg) return { status: 'notfound' };
            const guest = `${reg.first_name || ''} ${reg.last_name || ''}`.trim() || 'the registrant';
            if (reg.status !== 'pending-review') {
                return { status: 'already', headline: reg.status === 'cancelled' ? 'Already rejected.' : 'Already approved.',
                    message: reg.status === 'cancelled'
                        ? `${guest}'s registration was already rejected.`
                        : `${guest}'s registration was approved earlier and the confirmation already went out — rejecting from this link is disabled. Cancel it from the admin side if needed.` };
            }
            const notes = String(reg.notes || '').replace('HELD — review', 'HELD — review · rejected ' + new Date().toISOString().slice(0, 10));
            query.run(`UPDATE bridges_registrations SET status = 'cancelled', notes = ? WHERE id = ?`, [notes, id]);
            flushDb();
            updateBostonSheetStatus(id, 'Rejected');
            console.log(`[ReviewGate] Boston registration ${id} REJECTED`);
            return { status: 'done', headline: 'Rejected.',
                message: `${guest}'s registration has been cancelled. They received nothing — no confirmation, no QR, no wallet pass — and no sheet row was written.` };
        },
        // Institutional-confirmation flow primitives (state = notes markers, restart-safe).
        getRow: (id) => {
            const reg = query.get('SELECT * FROM bridges_registrations WHERE id = ? AND event_id = ?', [id, EVENT_ID]);
            if (!reg) return null;
            return {
                id: reg.id,
                name: `${reg.first_name || ''} ${reg.last_name || ''}`.trim(),
                email: reg.email,
                institution: reg.institution || '',
                notes: reg.notes,
                state: reg.status === 'pending-review' ? 'pending' : (reg.status === 'cancelled' ? 'rejected' : 'approved')
            };
        },
        setNotes: (id, notes) => {
            query.run('UPDATE bridges_registrations SET notes = ? WHERE id = ?', [notes, id]);
            flushDb();
        },
        // Institutional confirmation re-points the row at the verified inbox: the ticket,
        // wallet passes and sheet row then all go to the proven-real address.
        setEmail: (id, email) => {
            query.run('UPDATE bridges_registrations SET email = ? WHERE id = ?', [email, id]);
            flushDb();
        },
        // The confirmed page shows the ticket immediately (QR + wallets) so nobody depends
        // on institutional spam filters to see it. Same assets as the confirmation email.
        ticketAssets: (id) => {
            const reg = query.get('SELECT * FROM bridges_registrations WHERE id = ? AND event_id = ?', [id, EVENT_ID]);
            if (!reg) return null;
            const links = walletLinks(reg);
            return {
                qrUrl: `${baseUrl()}/api/boston/qr/${String(id)}.png`,
                apple: links.apple,
                google: links.google,
                calendar: links.calendar,
                ticketNumber: ticketNo(id),
                eventLine: `${EVENT_NAME} · ${DATE_LONG} · 6:00 PM`
            };
        },
        sheetStatus: (id, label) => updateBostonSheetStatus(id, label),
        eventLabel: 'Building Bridges in Biomedicine — Boston'
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
            fold('DESCRIPTION:' + escIcs('Doors open 5:30 PM; the program runs 6:00–9:00 PM. Present the entry QR from your confirmation email at the door. Dress code: business attire. Questions? Laura Rodman (laura.rodman@medx.hr).')),
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
                fields: {
                    // Label without the year — 'BUILDING BRIDGES 2026' truncated on the pass header.
                    header: [{ key: 'event', label: 'BUILDING BRIDGES', value: 'Boston' }],
                    primary: [],
                    secondary: [
                        { key: 'when', label: 'WHEN', value: 'Sep 21 · 6:00 PM (doors 5:30 PM)' },
                        { key: 'where', label: 'WHERE', value: 'Waterhouse Room, Harvard Medical School' }
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
            if (isReleasedRow(reg)) return res.send(releasedPage(reg));   // a released seat gets the notice, not the form
            const current = latestPresentation(reg.id);
            res.send(uploadPage(reg, current, s3.isConfigured(), String(req.params.token)));
        } catch (e) {
            console.error('[Boston] upload page error:', e.message);
            res.status(500).send(simplePage('Something went wrong', 'One moment, please.',
                `We could not open your upload page just now. Please try the link again in a minute, or write to Laura Rodman (<a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>).`));
        }
    });

    // ---- the ONE storage path for a presentation deck ------------------------------------------
    // Two front doors now reach it — the original personal /boston/upload link and step 3 of the
    // hub — so the rules (extension whitelist, 25 MB cap, magic bytes, S3 key shape, history row)
    // live here once. A second copy of this is how the two doors would quietly drift apart.
    // Answers {status, body} rather than writing the response, so each route owns its own framing.
    async function storeSlides(reg, file) {
        if (!s3.isConfigured()) return { status: 503, body: { error: 'Uploads open soon — this same link will work shortly. Nothing else is needed from you.' } };
        if (!file || !file.buffer || !file.buffer.length) return { status: 400, body: { error: 'Choose a file first — .pdf, .ppt, .pptx or .key, up to 25 MB.' } };
        const name = sanitizeFilename(file.originalname);
        const m = /\.([A-Za-z0-9]{1,10})$/.exec(name);
        const ext = m ? m[1].toLowerCase() : '';
        const type = UPLOAD_TYPES[ext];
        if (!type) return { status: 400, body: { error: 'That file type is not accepted. Please upload a .pdf, .ppt, .pptx or .key file.' } };
        if (file.buffer.length > MAX_UPLOAD_BYTES) {   // belt — multer already aborts the stream at the cap
            return { status: 413, body: { error: 'That file is over the 25 MB limit. Please compress it (or export a PDF) and try again.' } };
        }
        if (!magicOk(ext, file.buffer)) {
            return { status: 400, body: { error: `That file does not look like a real .${ext} file inside. Please re-export it and try again.` } };
        }
        ensurePresentationsTable();
        const presId = crypto.randomUUID();
        const storedKey = `${EVENT_SLUG}/${reg.id}/${presId}.${ext}`;
        await s3.putObject(storedKey, file.buffer, type.mime);   // S3 first — a DB row only for a stored file
        const uploadedAt = new Date().toISOString();
        query.run(`INSERT INTO bridges_presentations (id, registration_id, original_name, stored_key, mime, size, uploaded_at)
            VALUES (?,?,?,?,?,?,?)`, [presId, reg.id, name, storedKey, type.mime, file.buffer.length, uploadedAt]);
        flushDb();
        return { status: 200, body: { success: true, filename: name, size: file.buffer.length, uploaded_at: uploadedAt } };
    }

    // The over-25 MB lane: a Google Drive / Dropbox (any https) share link saved as the presenter's
    // deck. Same history table, newest wins, so a link counts as the required upload everywhere
    // latestPresentation() is read — the progress line, the admin list, the ZIP's links.txt.
    function parseShareLink(raw) {
        const s = String(raw == null ? '' : raw).trim();
        if (!s || s.length > MAX_LINK_CHARS) return null;
        let u;
        try { u = new URL(s); } catch (e) { return null; }
        if (!/^https?:$/.test(u.protocol) || !u.hostname || !u.hostname.includes('.')) return null;
        return u;
    }
    function storeSlidesLink(reg, raw) {
        const u = parseShareLink(raw);
        if (!u) return { status: 400, body: { error: 'Please paste a full web link (starting with https://) from Google Drive, Dropbox or a similar service.' } };
        ensurePresentationsTable();
        const presId = crypto.randomUUID();
        const uploadedAt = new Date().toISOString();
        const label = `Link · ${u.hostname.replace(/^www\./, '')}`;
        query.run(`INSERT INTO bridges_presentations (id, registration_id, original_name, stored_key, mime, size, uploaded_at, external_url)
            VALUES (?,?,?,?,?,?,?,?)`, [presId, reg.id, label, '', 'text/uri-list', 0, uploadedAt, u.href]);
        flushDb();
        return { status: 200, body: { success: true, filename: label, external_url: u.href, size: 0, uploaded_at: uploadedAt } };
    }

    // ------------------------------------------------------------ POST /api/boston/upload/:token
    app.post('/api/boston/upload/:token', uploadParser, async (req, res) => {
        try {
            const id = verifyUploadToken(req.params.token);
            if (!id) return res.status(404).json({ error: 'This upload link is not valid. Please use the exact link you were sent.' });
            const reg = query.get('SELECT * FROM bridges_registrations WHERE id = ? AND event_id = ?', [id, EVENT_ID]);
            if (!reg) return res.status(404).json({ error: 'This upload link is not valid. Please use the exact link you were sent.' });
            if (isReleasedRow(reg)) return res.status(409).json({ error: RELEASED_LINE(releasedOn(reg)) });
            const out = await storeSlides(reg, req.file);
            res.status(out.status).json(out.body);
        } catch (e) {
            console.error('[Boston] presentation upload failed:', e.message);
            res.status(502).json({ error: 'The upload did not go through. Please try again — this same link keeps working.' });
        }
    });

    // ============================================================ ONE-SLIDE SUMMARIES (every guest)
    // "Introduce yourself to the room." One slide per guest, sent to all participants after the
    // event. Same machinery as the decks — memory multer → magic-byte check → S3 → a history row,
    // newest wins — with three deliberate differences: it is open to EVERYONE (not only
    // presenters), it carries an optional one-line headline for the index, and it carries the
    // guest's own sharing consent, which is what the archive filters on.
    const onepagerMulter = multerLib
        ? multerLib({ storage: multerLib.memoryStorage(), limits: { fileSize: MAX_ONEPAGER_BYTES, files: 1 } }).single('file')
        : null;
    function onepagerParser(req, res, next) {
        if (!onepagerMulter) return res.status(503).json({ error: 'Uploads are momentarily unavailable. Please try again shortly.' });
        onepagerMulter(req, res, err => {
            if (!err) return next();
            if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'That file is over the 10 MB limit. One slide is all we need — export it again and try.' });
            return res.status(400).json({ error: 'We could not read that upload. Please try again with a PDF or a PowerPoint file.' });
        });
    }
    const cleanHeadline = v => String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, MAX_HEADLINE_CHARS);
    // The checkbox is ticked by default and the page always posts its state, so a missing field is
    // somebody using the link by hand — and the default the guest would have seen is "share".
    const readShareOk = v => {
        if (v == null || String(v).trim() === '') return 1;
        return ['0', 'false', 'no', 'off', 'unchecked'].includes(String(v).trim().toLowerCase()) ? 0 : 1;
    };

    // ------------------------------------------------------------ GET /boston/onepager/:token
    app.get('/boston/onepager/:token', (req, res) => {
        res.set('X-Robots-Tag', 'noindex, nofollow');
        res.set('Cache-Control', 'private, no-store');
        try {
            const id = verifyOnepagerToken(req.params.token);
            const reg = id ? query.get('SELECT * FROM bridges_registrations WHERE id = ? AND event_id = ?', [id, EVENT_ID]) : null;
            if (!reg) return res.status(404).send(onepagerNotFoundPage());
            if (isReleasedRow(reg)) return res.send(releasedPage(reg));   // a released seat gets the notice, not the form
            res.send(onepagerPage(reg, latestOnepager(reg.id), s3.isConfigured(), String(req.params.token)));
        } catch (e) {
            console.error('[Boston] one-slide summary page error:', e.message);
            res.status(500).send(simplePage('Something went wrong', 'One moment, please.',
                `We could not open your page just now. Please try the link again in a minute, or write to Laura Rodman (<a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>).`));
        }
    });

    // ---- the ONE storage path for a one-slide summary -------------------------------------------
    // Same reasoning as storeSlides: the original /boston/onepager link and step 2 of the hub are
    // two doors onto ONE table, ONE S3 prefix and ONE consent column, so the rules live here once.
    // The consent is always read from what the page posted (readShareOk defaults to "share", which
    // is what a guest looking at a ticked box would have meant).
    async function storeSummary(reg, file, fields) {
        if (!s3.isConfigured()) return { status: 503, body: { error: 'Uploads open soon — this same link will work shortly. Nothing else is needed from you.' } };
        if (!file || !file.buffer || !file.buffer.length) return { status: 400, body: { error: 'Choose your one-slide summary first — a PDF or a PowerPoint, up to 10 MB.' } };
        const name = sanitizeFilename(file.originalname || 'one-slide-summary.pdf');
        const m = /\.([A-Za-z0-9]{1,10})$/.exec(name);
        const ext = m ? m[1].toLowerCase() : '';
        const type = SUMMARY_TYPES[ext];
        if (!type) return { status: 400, body: { error: 'PDF or PowerPoint (.ppt/.pptx), please — export your slide and try again.' } };
        if (file.buffer.length > MAX_ONEPAGER_BYTES) {  // belt — multer already aborts the stream at the cap
            return { status: 413, body: { error: 'That file is over the 10 MB limit. One slide is all we need — export it again and try.' } };
        }
        if (!magicOk(ext, file.buffer)) {
            return { status: 400, body: { error: `That file does not look like a real .${ext} file inside. Please re-export it and try again.` } };
        }
        ensureOnepagersTable();
        const headline = cleanHeadline((fields || {}).headline);
        const shareOk = readShareOk((fields || {}).share_ok);
        const docId = crypto.randomUUID();
        const storedKey = `${ONEPAGER_PREFIX}/${reg.id}/${docId}.${ext}`;
        await s3.putObject(storedKey, file.buffer, type.mime);   // S3 first — a row only for a stored file
        const uploadedAt = new Date().toISOString();
        query.run(`INSERT INTO bridges_onepagers (id, registration_id, original_name, stored_key, mime, size, headline, share_ok, uploaded_at)
            VALUES (?,?,?,?,?,?,?,?,?)`, [docId, reg.id, name, storedKey, type.mime, file.buffer.length, headline || null, shareOk, uploadedAt]);
        flushDb();
        return { status: 200, body: { success: true, filename: name, size: file.buffer.length, headline: headline || null, share_ok: shareOk === 1, uploaded_at: uploadedAt } };
    }

    // ------------------------------------------------------------ POST /api/boston/onepager/:token
    app.post('/api/boston/onepager/:token', onepagerParser, async (req, res) => {
        try {
            const id = verifyOnepagerToken(req.params.token);
            if (!id) return res.status(404).json({ error: 'This link is not valid. Please use the exact link you were sent.' });
            const reg = query.get('SELECT * FROM bridges_registrations WHERE id = ? AND event_id = ?', [id, EVENT_ID]);
            if (!reg) return res.status(404).json({ error: 'This link is not valid. Please use the exact link you were sent.' });
            if (isReleasedRow(reg)) return res.status(409).json({ error: RELEASED_LINE(releasedOn(reg)) });
            const out = await storeSummary(reg, req.file, req.body);
            res.status(out.status).json(out.body);
        } catch (e) {
            console.error('[Boston] one-slide summary upload failed:', e.message);
            res.status(502).json({ error: 'The upload did not go through. Please try again — this same link keeps working.' });
        }
    });

    // ------------------------------------------------------------ team data (one-slide summaries)
    // EVERY guest holding a seat is a row here (the ask is for the whole room), with their
    // personal link so the team can re-send one by hand, and the latest file when there is one.
    function onepagerAdminData() {
        ensureOnepagersTable();
        const regs = query.all(`SELECT * FROM bridges_registrations
            WHERE event_id = ? AND status IN ('registered','confirmed')
            ORDER BY registered_at, rowid`, [EVENT_ID]);
        const base = baseUrl();
        const rows = regs.map(r => {
            const latest = latestOnepager(r.id);
            const versions = latest
                ? Number((query.get('SELECT COUNT(*) AS n FROM bridges_onepagers WHERE registration_id = ?', [r.id]) || {}).n || 0)
                : 0;
            return {
                registration_id: r.id,
                name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
                institution: r.institution || '',
                email: r.email,
                presenter: isPresenterRow(r),
                upload_url: `${base}/boston/onepager/${onepagerToken(r.id)}`,
                headline: latest && latest.headline ? String(latest.headline) : null,
                share_ok: latest ? shareOkOf(latest) : null,
                onepager: latest ? {
                    id: latest.id,
                    filename: latest.original_name,
                    size: Number(latest.size),
                    mime: latest.mime || null,
                    headline: latest.headline || null,
                    share_ok: shareOkOf(latest),
                    uploaded_at: latest.uploaded_at,
                    versions,
                    download_url: `${base}/api/boston/onepagers/${latest.id}/download?key=${adminKey()}`
                } : null
            };
        });
        const received = rows.filter(r => r.onepager);
        const shared = received.filter(r => r.onepager.share_ok).length;
        return {
            event: EVENT_ID, event_name: EVENT_NAME,
            generated_at: new Date().toISOString(),
            s3_configured: s3.isConfigured(),
            total: rows.length,
            received: received.length,
            // What the archive will and will not contain: a guest who unticked the box is counted
            // here and nowhere else, so the team can see the gap without opening the file.
            shared,
            private: received.length - shared,
            zip_excluded: received.length - shared,
            rows
        };
    }

    // ------------------------------------------------------------ GET /api/boston/onepagers (JSON)
    app.get('/api/boston/onepagers', (req, res) => {
        try {
            if (!checkAdminKey(req.query && req.query.key)) return res.status(404).json({ error: 'Not found' });
            res.set('Cache-Control', 'private, no-store');
            res.json(onepagerAdminData());
        } catch (e) {
            console.error('[Boston] one-slide summaries JSON error:', e.message);
            res.status(500).json({ error: 'Could not assemble the list.' });
        }
    });

    // ------------------------------------------------------------ GET /api/boston/onepagers.zip?key=…
    // What goes to all participants: "<Last>_<First>__<original>", same writer and the same naming
    // rule as the presentations archive — and ONLY the summaries whose owner ticked the box. A
    // private one is not in the file at all; the count that was left out rides on a header and in
    // the JSON list beside it, so nobody has to infer it from the entry count.
    app.get('/api/boston/onepagers.zip', async (req, res) => {
        try {
            if (!checkAdminKey(req.query && req.query.key)) return res.status(404).json({ error: 'Not found' });
            ensureOnepagersTable();
            if (!s3.isConfigured()) return res.status(503).json({ error: 'File storage is not configured on this server yet.' });
            const data = onepagerAdminData();
            const withFile = data.rows.filter(r => r.onepager && r.onepager.id);
            const shareable = withFile.filter(r => r.onepager.share_ok);
            const excluded = withFile.length - shareable.length;
            if (!shareable.length) {
                return res.status(404).json({
                    error: excluded
                        ? `No shareable one-slide summaries yet — ${excluded} on file ${excluded === 1 ? 'is' : 'are'} marked private.`
                        : 'No one-slide summaries uploaded yet.',
                    received: withFile.length, shared: 0, excluded_private: excluded
                });
            }
            const entries = [];
            for (const r of shareable) {
                const p = query.get('SELECT * FROM bridges_onepagers WHERE id = ?', [r.onepager.id]);
                if (!p) continue;
                const buf = await s3.getObject(p.stored_key);
                const reg = query.get('SELECT first_name, last_name FROM bridges_registrations WHERE id = ?', [p.registration_id]) || {};
                entries.push({ name: `${zipSafe(reg.last_name)}_${zipSafe(reg.first_name)}__${zipSafe(p.original_name)}`, data: buf });
            }
            const zip = buildZip(entries);
            res.set('Content-Type', 'application/zip');
            res.set('Content-Disposition', `attachment; filename="BB-Boston-one-slide-summaries-${new Date().toISOString().slice(0, 10)}.zip"`);
            res.set('X-Summaries-Excluded-Private', String(excluded));
            res.set('Cache-Control', 'private, no-store');
            res.send(zip);
        } catch (e) {
            console.error('[Boston] one-slide summary zip failed:', e.message);
            res.status(500).json({ error: 'Could not build the archive: ' + e.message });
        }
    });

    // ------------------------------------------------------------ GET /api/boston/onepagers/:id/download
    app.get('/api/boston/onepagers/:id/download', (req, res) => {
        try {
            if (!checkAdminKey(req.query && req.query.key)) return res.status(404).json({ error: 'Not found' });
            ensureOnepagersTable();
            const p = query.get('SELECT * FROM bridges_onepagers WHERE id = ?', [String(req.params.id || '')]);
            if (!p) return res.status(404).json({ error: 'Not found' });
            if (!s3.isConfigured()) return res.status(503).json({ error: 'File storage is not configured on this server yet.' });
            const url = s3.presignGet(p.stored_key, { expires: 900, filename: p.original_name });   // 15 minutes
            res.set('Cache-Control', 'private, no-store');
            res.redirect(302, url);
        } catch (e) {
            console.error('[Boston] one-slide summary download redirect failed:', e.message);
            res.status(500).json({ error: 'Could not build the download link.' });
        }
    });

    // ============================================================ THE ONE PERSONAL PAGE ("the hub")
    // Alen 2026-09-14: "Can it all be one link? People open one link and everything is there:
    // first choose dietary/allergies, then upload the one-slide summary, then (presenters) upload
    // the presentation." So this is the whole ask on one address: three numbered steps, each with
    // its own state, each saved in place by fetch — no page reload, no second link, no login. The
    // four older personal links keep working exactly as they did (they are in inboxes already);
    // this one simply makes them unnecessary.
    //
    // One thing is required, of one group: a presenter without slides is a gap in the running
    // order. Everything else — the catering answers, the one-slide summary — is asked for and
    // welcome, but optional (Alen 2026-09-15), and the page says so rather than nagging for it.

    /** Every fact the page and its progress line are drawn from — one read, one shape. */
    function meStateOf(reg) {
        const presenter = isPresenterRow(reg);
        const declined = wasDeclinedPresenter(reg);
        const cat = cateringStateOf(reg);
        const summary = latestOnepager(reg.id);
        // A deck on file OR a saved share link (the over-25 MB lane) — either satisfies step 3.
        const slides = presenter ? latestPresentation(reg.id) : null;
        // Step 1 is done only when BOTH rows are answered — "vegan, allergies unknown" is not an
        // answer the kitchen can cook from.
        const step1 = !!(cat.prefKey && cat.allergyState);
        const step2 = !!summary;
        const step3 = !!slides;
        const total = presenter ? 3 : 2;
        const done = (step1 ? 1 : 0) + (step2 ? 1 : 0) + (presenter && step3 ? 1 : 0);
        return {
            presenter, declined, cat, summary, slides,
            step1, step2, step3, total, done,
            // Only the required step gates this: a presenter is finished once the slides are in;
            // an attendee has nothing required and is finished from the start. The optional
            // steps stay open below regardless.
            allDone: !presenter || step3
        };
    }

    /** The row behind a hub token, or null — one lookup for the page and all three APIs. */
    const meRegOf = token => {
        const id = verifyMeToken(token);
        return id ? query.get('SELECT * FROM bridges_registrations WHERE id = ? AND event_id = ?', [id, EVENT_ID]) : null;
    };

    // ------------------------------------------------------------ GET /boston/me/:token
    // Always server-rendered from the CURRENT row, so a reload (or a second device, or a tap on an
    // old email button weeks later) shows exactly what is on file — the page holds no state of its
    // own beyond the request that drew it.
    app.get('/boston/me/:token', (req, res) => {
        res.set('X-Robots-Tag', 'noindex, nofollow');
        res.set('Cache-Control', 'private, no-store');
        try {
            const reg = meRegOf(req.params.token);
            if (!reg) return res.status(404).send(meNotFoundPage());
            if (isReleasedRow(reg)) return res.send(releasedPage(reg));   // a released seat gets the notice, not the form
            res.send(mePage(reg, meStateOf(reg), s3.isConfigured(), {
                me: String(req.params.token),
                diet: dietToken(reg.id)          // the allergy box and the way out reuse the existing routes
            }, walletLinks(reg)));
        } catch (e) {
            console.error('[Boston] personal page error:', e.message);
            res.status(500).send(simplePage('Something went wrong', 'One moment, please.',
                `We could not open your page just now. Please try the link again in a minute, or write to Laura Rodman (<a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>).`));
        }
    });

    // ------------------------------------------------------------ POST /api/boston/me/:token/diet
    // The preference row, saved in place. Writes exactly what the one-tap GET route writes, so a
    // guest who used the email chips last week and the hub today leaves one consistent record.
    // Idempotent: posting the same preference twice is the same single row state.
    app.post('/api/boston/me/:token/diet', (req, res) => {
        try {
            const reg = meRegOf(req.params.token);
            if (!reg) return res.status(404).json({ error: 'This link is not valid. Please use the exact link you were sent.' });
            if (isReleasedRow(reg)) return res.status(409).json({ error: RELEASED_LINE(releasedOn(reg)) });
            const pref = String((req.body || {}).pref || '').trim().toLowerCase();
            if (!DIET_PREFS[pref]) return res.status(400).json({ error: 'Please choose one of the options shown.' });
            query.run('UPDATE bridges_registrations SET dietary_requirements = ? WHERE id = ?', [DIET_PREFS[pref], reg.id]);
            stampCateringAnswers(reg, { diet_pref: pref });
            flushDb();
            res.json({ success: true, pref, label: DIET_PREFS[pref] });
        } catch (e) {
            console.error('[Boston] hub diet save failed:', e.message);
            res.status(500).json({ error: 'We could not save that just now. Please try again.' });
        }
    });

    // ------------------------------------------------------------ POST /api/boston/me/:token/summary
    // Step 2 — the optional one-slide summary, through the SAME storage path as /boston/onepager.
    app.post('/api/boston/me/:token/summary', onepagerParser, async (req, res) => {
        try {
            const reg = meRegOf(req.params.token);
            if (!reg) return res.status(404).json({ error: 'This link is not valid. Please use the exact link you were sent.' });
            if (isReleasedRow(reg)) return res.status(409).json({ error: RELEASED_LINE(releasedOn(reg)) });
            const out = await storeSummary(reg, req.file, req.body);
            res.status(out.status).json(out.body);
        } catch (e) {
            console.error('[Boston] hub summary upload failed:', e.message);
            res.status(502).json({ error: 'The upload did not go through. Please try again — this same link keeps working.' });
        }
    });

    // ------------------------------------------------------------ POST /api/boston/me/:token/slides
    // Step 3 — presenters ONLY. A guest who is not on the running order has no slides slot, so this
    // refuses rather than quietly filing a deck nobody will ever play.
    app.post('/api/boston/me/:token/slides', uploadParser, async (req, res) => {
        try {
            const reg = meRegOf(req.params.token);
            if (!reg) return res.status(404).json({ error: 'This link is not valid. Please use the exact link you were sent.' });
            if (isReleasedRow(reg)) return res.status(409).json({ error: RELEASED_LINE(releasedOn(reg)) });
            if (!isPresenterRow(reg)) {
                return res.status(403).json({
                    error: wasDeclinedPresenter(reg)
                        // They offered and there was no room. The refusal has to carry the seat with
                        // it — this is the one place a declined guest could still read "not wanted".
                        ? 'Your seat on Monday is confirmed and we look forward to seeing you. Sadly we could not accommodate your presentation this time, so there is no slides slot — but your one-slide summary is very welcome: the summaries of everyone’s work are shared with all participants.'
                        : 'Only the evening’s presenters upload slides. If you would like a 5-minute slot, write to Laura Rodman (' + SUPPORT_EMAIL + ').'
                });
            }
            const out = await storeSlides(reg, req.file);
            res.status(out.status).json(out.body);
        } catch (e) {
            console.error('[Boston] hub slides upload failed:', e.message);
            res.status(502).json({ error: 'The upload did not go through. Please try again — this same link keeps working.' });
        }
    });

    // ------------------------------------------------------------ POST /api/boston/me/:token/slides-link
    // Step 3, the other way in: a deck over 25 MB, shared from Drive / Dropbox. Presenters only,
    // exactly like the upload — and it needs no S3, so it works even before storage is configured.
    app.post('/api/boston/me/:token/slides-link', (req, res) => {
        try {
            const reg = meRegOf(req.params.token);
            if (!reg) return res.status(404).json({ error: 'This link is not valid. Please use the exact link you were sent.' });
            if (isReleasedRow(reg)) return res.status(409).json({ error: RELEASED_LINE(releasedOn(reg)) });
            if (!isPresenterRow(reg)) {
                return res.status(403).json({
                    error: wasDeclinedPresenter(reg)
                        ? 'Your seat on Monday is confirmed and we look forward to seeing you. Sadly we could not accommodate your presentation this time, so there is no slides slot — but your one-slide summary is very welcome: the summaries of everyone’s work are shared with all participants.'
                        : 'Only the evening’s presenters send slides. If you would like a 5-minute slot, write to Laura Rodman (' + SUPPORT_EMAIL + ').'
                });
            }
            const out = storeSlidesLink(reg, (req.body || {}).url);
            res.status(out.status).json(out.body);
        } catch (e) {
            console.error('[Boston] hub slides link failed:', e.message);
            res.status(500).json({ error: 'We could not save that just now. Please try again.' });
        }
    });

    // ============================================================ THE PROGRAM PDF (one attachment)
    // Uploaded once by the team, attached to every copy of the one email. Read back from S3 per
    // batch (not per recipient), so a 300-guest send pulls the file exactly once.
    const programMulter = multerLib
        ? multerLib({ storage: multerLib.memoryStorage(), limits: { fileSize: MAX_PROGRAM_BYTES, files: 1 } }).single('file')
        : null;
    function programParser(req, res, next) {
        if (!programMulter) return res.status(503).json({ error: 'Uploads are momentarily unavailable. Please try again shortly.' });
        programMulter(req, res, err => {
            if (!err) return next();
            if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'That file is over the 10 MB limit. Please compress the PDF and try again.' });
            return res.status(400).json({ error: 'We could not read that upload. Please try again with a PDF.' });
        });
    }
    async function programStatus() {
        const key = programKey();
        if (!s3.isConfigured()) return { present: false, configured: false, key, source: key === PROGRAM_UPLOAD_KEY ? 'upload' : 'env' };
        const head = await s3.headObject(key);
        return {
            present: !!head, configured: true, key,
            source: key === PROGRAM_UPLOAD_KEY ? 'upload' : 'env',
            size: head ? head.size : null,
            uploaded_at: head ? head.lastModified : null
        };
    }
    /** The attachment, in sendEmail's own shape — or null when there is no program PDF to attach. */
    async function loadProgramAttachment() {
        if (!s3.isConfigured()) return null;
        try {
            const buf = await s3.getObject(programKey());
            if (!buf || !buf.length) return null;
            return { filename: PROGRAM_FILENAME, content: buf, type: 'application/pdf' };
        } catch (e) {
            console.warn('[Boston] program PDF unavailable:', e.message);
            return null;
        }
    }

    app.get('/api/boston/program', async (req, res) => {
        try {
            if (!checkAdminKey(req.query && req.query.key)) return res.status(404).json({ error: 'Not found' });
            res.set('Cache-Control', 'private, no-store');
            res.json(await programStatus());
        } catch (e) {
            console.error('[Boston] program status failed:', e.message);
            res.status(500).json({ error: 'Could not read the program status.' });
        }
    });

    app.post('/api/boston/program', programParser, async (req, res) => {
        try {
            if (!checkAdminKey(req.query && req.query.key)) return res.status(404).json({ error: 'Not found' });
            if (!s3.isConfigured()) return res.status(503).json({ error: 'File storage is not configured on this server yet.' });
            const f = req.file;
            if (!f || !f.buffer || !f.buffer.length) return res.status(400).json({ error: 'Choose the program PDF first.' });
            if (f.buffer.length > MAX_PROGRAM_BYTES) return res.status(413).json({ error: 'That file is over the 10 MB limit. Please compress the PDF and try again.' });
            if (!/\.pdf$/i.test(String(f.originalname || ''))) return res.status(400).json({ error: 'PDF only, please.' });
            if (!magicOk('pdf', f.buffer)) return res.status(400).json({ error: 'That file does not look like a real PDF inside. Please re-export it and try again.' });
            await s3.putObject(PROGRAM_UPLOAD_KEY, f.buffer, 'application/pdf');   // one key — a new upload replaces
            console.log(`[Boston] program PDF replaced (${f.buffer.length} bytes)`);
            res.json({ success: true, size: f.buffer.length, key: PROGRAM_UPLOAD_KEY, uploaded_at: new Date().toISOString() });
        } catch (e) {
            console.error('[Boston] program upload failed:', e.message);
            res.status(502).json({ error: 'The upload did not go through. Please try again.' });
        }
    });

    // ------------------------------------------------------------ POST /api/boston/presenters/:id/status
    // The owner's pick, one row at a time: 'confirmed' (they present), 'declined' (they offered and
    // there was no room — the warm third email shape), or null (undecided again, back to the offer).
    // Idempotent, keyed like every other organizer route, and it writes nothing else on the row —
    // the offer in `notes` is a historical fact and stays exactly as it was written.
    app.post('/api/boston/presenters/:id/status', (req, res) => {
        try {
            if (!checkAdminKey(req.query && req.query.key)) return res.status(404).json({ error: 'Not found' });
            ensurePresenterStatusColumn();
            const reg = query.get('SELECT * FROM bridges_registrations WHERE id = ? AND event_id = ?',
                [String(req.params.id || ''), EVENT_ID]);
            if (!reg) return res.status(404).json({ error: 'That guest is not on the Boston list.' });
            const raw = (req.body || {}).status;
            const want = raw == null || String(raw).trim() === '' ? null : String(raw).trim().toLowerCase();
            if (want !== null && want !== PRESENTER_CONFIRMED && want !== PRESENTER_DECLINED) {
                return res.status(400).json({ error: 'status must be "confirmed", "declined" or null.' });
            }
            query.run('UPDATE bridges_registrations SET presenter_status = ? WHERE id = ?', [want, reg.id]);
            flushDb();
            const fresh = query.get('SELECT * FROM bridges_registrations WHERE id = ?', [reg.id]) || reg;
            res.json({
                success: true, id: reg.id, presenter_status: want,
                presenter: isPresenterRow(fresh),
                presentation_requested: requestedPresentation(fresh),
                declined_presenter: wasDeclinedPresenter(fresh)
            });
        } catch (e) {
            console.error('[Boston] presenter status write failed:', e.message);
            res.status(500).json({ error: 'Could not record that just now. Please try again.' });
        }
    });

    // ------------------------------------------------------------ team data (page + JSON share it)
    function presentationAdminData() {
        ensurePresentationsTable();
        ensurePresenterStatusColumn();
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
                requested: requestedPresentation(r),
                // The offer and the decision, side by side and never conflated: `requested` /
                // `presentation_requested` is what THEY asked for, `presenter_status` is what HE
                // decided, and `presenter` is the answer everything downstream actually acts on.
                presentation_requested: requestedPresentation(r),
                presenter_status: presenterStatusOf(r),
                presenter: isPresenterRow(r),
                declined_presenter: wasDeclinedPresenter(r),
                // A presenter who gave the seat back stays visible here (their deck is still on
                // file) but is marked, so nobody sends slides chasers to somebody who is not coming.
                status: r.status || null,
                released: isReleasedRow(r),
                released_on: isReleasedRow(r) ? releasedOn(r) : null,
                upload_url: `${base}/boston/upload/${uploadToken(r.id)}`,
                // The link the team should actually hand out now: one address carrying all three
                // asks. upload_url stays beside it — it is in inboxes already and still works.
                me_url: `${base}/boston/me/${meToken(r.id)}`,
                upload: latest ? {
                    id: latest.id,
                    filename: latest.original_name,
                    size: Number(latest.size),
                    mime: latest.mime,
                    uploaded_at: latest.uploaded_at,
                    versions,
                    // A share link (the over-25 MB lane) instead of a stored file. download_url
                    // still works — it redirects there — so every existing "Download" control is
                    // right either way; external_url is exposed so the team can see WHERE it goes.
                    external_url: isLinkRow(latest) ? String(latest.external_url) : null,
                    download_url: `${base}/api/boston/presentations/${latest.id}/download?key=${adminKey()}`
                } : null
            };
        });
        const askedToPresent = rows.filter(r => r.presentation_requested);
        return {
            event: EVENT_ID, event_name: EVENT_NAME,
            generated_at: new Date().toISOString(),
            s3_configured: s3.isConfigured(),
            requested: askedToPresent.length,
            uploaded: rows.filter(r => r.upload).length,
            // The three counts the card's header reads. They partition the people who OFFERED, so
            // confirmed + declined + undecided is always exactly `requested` — nothing can go
            // missing between the owner's decisions and the number of talks the evening holds.
            confirmed: askedToPresent.filter(r => r.presenter_status === PRESENTER_CONFIRMED).length,
            declined: askedToPresent.filter(r => r.presenter_status === PRESENTER_DECLINED).length,
            undecided: askedToPresent.filter(r => r.presenter_status == null).length,
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

    // ------------------------------------------------------------ GET /api/boston/presentations.zip?key=…
    // One archive of every presenter's latest upload (fetched from S3 via presigned GET), named
    // "<Last>_<First>__<original>". Stored (uncompressed) entries — decks are already compressed —
    // built with node's zlib.crc32, so no zip dependency. Team use on event day.
    app.get('/api/boston/presentations.zip', async (req, res) => {
        try {
            if (!checkAdminKey(req.query && req.query.key)) return res.status(404).json({ error: 'Not found' });
            ensurePresentationsTable();
            const data = presentationAdminData();
            const withFile = data.rows.filter(r => r.upload && r.upload.id);
            if (!withFile.length) return res.status(404).json({ error: 'No presentations uploaded yet.' });
            // Stored decks need S3; share links (the over-25 MB lane) do not — they go into
            // links.txt, so the archive is complete even when some decks live on Drive / Dropbox.
            const files = withFile.filter(r => !r.upload.external_url);
            const linked = withFile.filter(r => r.upload.external_url);
            if (files.length && !s3.isConfigured()) return res.status(503).json({ error: 'File storage is not configured on this server yet.' });
            const entries = [];
            for (const r of files) {
                const p = query.get('SELECT * FROM bridges_presentations WHERE id = ?', [r.upload.id]);
                if (!p) continue;
                const buf = await s3.getObject(p.stored_key);
                const reg = query.get('SELECT first_name, last_name FROM bridges_registrations WHERE id = ?', [p.registration_id]) || {};
                entries.push({ name: `${zipSafe(reg.last_name)}_${zipSafe(reg.first_name)}__${zipSafe(p.original_name)}`, data: buf });
            }
            if (linked.length) {
                const lines = ['Decks shared as links (larger than 25 MB) — open each in a browser and download it:', ''];
                for (const r of linked) lines.push(`${r.name}${r.institution ? ' (' + r.institution + ')' : ''}\n  ${r.upload.external_url}`, '');
                entries.push({ name: 'links.txt', data: Buffer.from(lines.join('\n'), 'utf8') });
            }
            const zip = buildZip(entries);
            res.set('Content-Type', 'application/zip');
            res.set('Content-Disposition', `attachment; filename="BB-Boston-presentations-${new Date().toISOString().slice(0, 10)}.zip"`);
            res.set('Cache-Control', 'private, no-store');
            res.send(zip);
        } catch (e) {
            console.error('[Boston] zip-all failed:', e.message);
            res.status(500).json({ error: 'Could not build the archive: ' + e.message });
        }
    });

    // ------------------------------------------------------------ presenter upload-link email (deliberate send only)
    // House-shell email with the presenter's PERSONAL upload link. Never automatic: POST
    // /api/boston/presenters/send-links?key=… with {to:'preview'} mails ONE sample to REVIEW_TO;
    // with {to:'all'} it mails every presenter who has not been invited yet (marker in notes);
    // {to:'<registration id>'} re-sends one. Each send is stamped so nobody is invited twice.
    function presenterInviteHtml(reg) {
        const T = emailTemplates.T;
        const link = `${baseUrl()}/boston/upload/${uploadToken(reg.id)}`;
        const first = reg.first_name || 'there';
        const body = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:36px 40px 32px;">
      <div style="font-family:${T.sans};font-weight:600;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#d7b56c;">Your 5-minute presentation</div>
      <div style="font-family:${T.serif};font-weight:500;font-size:27px;line-height:1.18;color:#f2e7d6;margin-top:10px;">Upload your slides for Boston</div>
      <div style="font-family:${T.sans};font-size:14px;line-height:1.7;color:#d3c5b2;margin-top:16px;">
        <p style="margin:0 0 10px;">Dear ${esc(first)},</p>
        <p style="margin:0 0 10px;">We are happy to have you presenting at <b style="color:#f2e7d6;">Building Bridges in Biomedicine — Boston</b> on ${DATE_LONG}, in the Waterhouse Room, Gordon Hall, Harvard Medical School.</p>
        <p style="margin:0;">Please upload your slides through your <b style="color:#f2e7d6;">personal link</b> below — it is yours alone, and only the Med&amp;X team can see what you upload. You can replace the file any time before the event from the same link.</p>
      </div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding-top:24px;">${emailTemplates.btn('Upload my presentation', link, 'solid', 'width:300px;max-width:100%;padding-left:0;padding-right:0;text-align:center;box-sizing:border-box;background:#a8232b;')}</td></tr></table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;background:#342718;border:1px solid rgba(240,228,210,.16);"><tr><td style="padding:12px 18px;font-family:${T.sans};font-size:12.5px;line-height:1.6;color:#d3c5b2;">
        <b style="color:#f2e7d6;">Format:</b> ${SLIDES_FORMAT_LINE} &middot; <b style="color:#f2e7d6;">Deadline:</b> please upload by ${SLIDES_DEADLINE} so we can preload every deck.
      </td></tr></table>
      <div style="margin-top:24px;padding-top:14px;border-top:1px solid rgba(240,228,210,.18);font-family:${T.sans};font-size:11.5px;line-height:1.7;color:#d3c5b2;">Questions? Just reply to this email — or write to Laura Rodman at ${SUPPORT_EMAIL}.</div>
    </td></tr></table>`;
        return emailTemplates.shell({ tone: 'dark', title: 'Upload your presentation — Building Bridges Boston', preheader: 'Your personal upload link for the 5-minute presentation.', headerRightLabel: 'BUILDING BRIDGES · BOSTON', rule: 'crimson', bodyHtml: body });
    }
    app.post('/api/boston/presenters/send-links', async (req, res) => {
        try {
            if (!checkAdminKey(req.query && req.query.key)) return res.status(404).json({ error: 'Not found' });
            const to = String((req.body || {}).to || '').trim();
            ensurePresenterStatusColumn();
            // Only people who are actually on the running order get a "upload your slides" link —
            // sending one to somebody the owner could not fit in would be the cruellest possible bug.
            const presenters = query.all(`SELECT * FROM bridges_registrations WHERE event_id = ? AND status IN ('registered','confirmed') AND notes LIKE '%5-minute presentation%' ORDER BY registered_at`, [EVENT_ID])
                .filter(isPresenterRow);
            const subject = 'Upload your 5-minute presentation — Building Bridges Boston';
            if (to === 'preview') {
                const sample = presenters[0] || { id: 'preview', first_name: 'Alen', email: reviewGate.REVIEW_TO };
                await sendEmail(reviewGate.REVIEW_TO, '[PREVIEW] ' + subject, presenterInviteHtml(sample));
                return res.json({ success: true, preview_to: reviewGate.REVIEW_TO, presenters: presenters.length });
            }
            const targets = to === 'all' ? presenters.filter(r => !/UPLOAD-LINK-SENT/.test(String(r.notes || ''))) : presenters.filter(r => r.id === to);
            const sent = [];
            for (const r of targets) {
                const out = await sendEmail(r.email, subject, presenterInviteHtml(r));
                if (out && out.success !== false) {
                    query.run('UPDATE bridges_registrations SET notes = ? WHERE id = ?', [String(r.notes || '') + ' | UPLOAD-LINK-SENT ' + new Date().toISOString().slice(0, 10), r.id]);
                    sent.push(r.email);
                }
            }
            flushDb();
            console.log(`[Boston] presenter upload links sent: ${sent.length}/${targets.length}`);
            return res.json({ success: true, sent, skipped_already_sent: to === 'all' ? presenters.length - targets.length : 0 });
        } catch (e) {
            console.error('[Boston] send-links failed:', e.message);
            res.status(500).json({ error: e.message });
        }
    });

    // ============================================================ THE ONE BOSTON EMAIL
    // Alen 2026-09-13: "people receive ONLY ONE email, personalized". So this is not a reminder
    // beside four other sends — it is the whole evening in one message, in a fixed module order:
    //   (a) see you on Monday — date, venue, doors, dress
    //   (b) your program      — the attached PDF
    //   (c) your ticket       — the entry QR they already have + wallet passes + calendar
    //   (d) two quick questions for the catering — one-tap links, no login, no re-typing
    //   (e) your one-slide summary — the introduce-yourself upload, EVERY guest
    //   (f) you're presenting  — the slides upload, presenters ONLY
    //   (g) reply-to / Laura
    // Nothing here sends by itself: the route is keyed, and 'all' only ever arrives from an
    // explicit admin click behind a confirm.

    const REMINDER_SUBJECT = 'See you on ' + DATE_LONG.replace(/\s*\d{4}$/, '') + ' — Building Bridges Boston';
    // The real subject asks for something — a guest must not file this as a pleasantry.
    const ACTION_SUBJECT = r => `${r && r.first_name ? String(r.first_name).trim() + ', your' : 'Your'} Building Bridges Boston details — action needed before 21 September`;

    function reminderEmailHtml(reg, opts) {
        const o = opts || {};
        const T = emailTemplates.T;
        const base = baseUrl();
        const id = String(reg.id);
        const first = reg.first_name || 'there';
        const fullName = `${reg.first_name || ''} ${reg.last_name || ''}`.trim() || 'Med&X Guest';
        const links = walletLinks(reg);
        const tok = dietToken(id);
        const rsvp = a => `${base}/boston/rsvp/${tok}/${a}`;
        // Alen 2026-09-14: "Can it all be one link?" — it can. Every button below now lands on the
        // SAME personal page, each on the step it belongs to, so a guest who opens any one of them
        // has the whole ask in front of them and can finish the rest without going back to the
        // email. The numbered sections stay because they are what explains the three asks.
        const me = `${base}/boston/me/${meToken(id)}`;
        const state = cateringStateOf(reg);

        const fact = (label, valueHtml) => `<tr>
        <td style="padding:5px 0;vertical-align:baseline;width:86px;font-family:${T.sans};font-weight:600;font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:#d7b56c;">${label}</td>
        <td style="padding:5px 0 5px 10px;vertical-align:baseline;font-family:${T.sans};font-size:13px;line-height:1.55;color:#f2e7d6;">${valueHtml}</td></tr>`;
        // A one-tap answer: a real link styled as a chip. The chosen one reads back filled.
        const chip = (label, href, chosen) => `<a href="${esc(href)}" style="display:inline-block;margin:0 8px 9px 0;padding:12px 17px;${chosen
            ? 'background:#a8232b;border:1px solid #a8232b;color:#fff3e2;'
            : 'background:#3b2c1c;border:1px solid rgba(215,181,108,.5);color:#f2e7d6;'}font-family:${T.sans};font-weight:600;font-size:11px;letter-spacing:.1em;text-transform:uppercase;text-decoration:none;">${chosen ? '&#10003; ' : ''}${label}</a>`;

        const prefChips = PREF_KEYS.map(k => chip(esc(DIET_PREFS[k]), rsvp(k), state.prefKey === k)).join('');
        const allergyChips = chip('No allergies', rsvp(ALLERGY_NONE), state.allergyState === 'none')
            + chip('I have allergies &rarr; tell us', rsvp(ALLERGY_TELL), state.allergyState === 'yes');

        const answeredNote = state.answered
            ? `<div style="font-family:${T.sans};font-size:11.5px;line-height:1.6;color:#c9b89f;margin-top:2px;">You already told us${state.prefLabel ? ' <b style="color:#f2e7d6;">' + esc(state.prefLabel) + '</b>' : ''}${state.allergyState === 'none' ? ' and <b style="color:#f2e7d6;">no allergies</b>' : state.allergyState === 'yes' ? ' and <b style="color:#f2e7d6;">' + esc(state.allergyText) + '</b>' : ''} — tap anything above to change it.</div>`
            : '';

        // ---- the quiet way out, one line, under the catering block ----
        // A guest who cannot come should be able to say so in one tap instead of composing an
        // email — the room is 60 seats and a freed one goes to somebody else. Deliberately small
        // and last in this block: it is the footnote to the food questions, not a sixth module.
        const cannotAttendLine = `<div style="font-family:${T.sans};font-size:11.5px;line-height:1.7;color:#a8998a;margin-top:16px;">Can&rsquo;t make it after all? <a href="${esc(rsvp(CANNOT_ATTEND))}" style="color:#d7b56c;text-decoration:underline;">Let us know with one tap</a> &mdash; it frees your seat.</div>`;

        // ---- the to-do list at the top: number · task · hint, each row a link to its section ----
        const todo = (n, task, hint, href) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;"><tr>
          <td style="width:26px;vertical-align:top;padding-top:1px;"><span style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;background:#a8232b;color:#fff3e2;font-family:${T.sans};font-weight:700;font-size:11px;">${n}</span></td>
          <td style="vertical-align:top;padding-left:8px;font-family:${T.sans};font-size:13.5px;line-height:1.45;color:#f2e7d6;">${href ? `<a href="${esc(href)}" style="color:#f2e7d6;text-decoration:underline;text-decoration-color:rgba(215,181,108,.7);font-weight:600;">${task}</a>` : `<b>${task}</b>`}<span style="display:block;font-size:11.5px;color:#c9b89f;margin-top:1px;">${hint}</span></td></tr></table>`;

        // ---- the module chrome every block below shares ----
        const label = t => `<div style="font-family:${T.sans};font-weight:600;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#d7b56c;">${t}</div>`;
        const para = (html, mt) => `<div style="font-family:${T.sans};font-size:13.5px;line-height:1.65;color:#d3c5b2;margin-top:${mt == null ? 8 : mt}px;">${html}</div>`;
        const module = inner => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:22px;border-top:1px solid rgba(240,228,210,.18);"><tr><td style="padding-top:20px;">${inner}</td></tr></table>`;
        const wideBtn = (text, href) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding-top:16px;">${emailTemplates.btn(text, href, 'solid', 'width:300px;max-width:100%;padding-left:0;padding-right:0;text-align:center;box-sizing:border-box;background:#a8232b;')}</td></tr></table>`;
        const onFile = (verb, filename) => `<div style="font-family:${T.sans};font-size:12px;line-height:1.6;color:#c9b89f;margin-top:12px;text-align:center;">${verb} &#10003;${filename ? ' <b style="color:#f2e7d6;">' + esc(filename) + '</b>' : ''} &mdash; open the same link to replace it.</div>`;

        // ---- (b) your program — the PDF attached to this very email ----
        const programBlock = module(`${label((o.presenter ? '4' : '3') + ' · Your program')}
        ${para(`<b style="color:#f2e7d6;">Attached as a PDF</b> &mdash; running order, presentation instructions, good-to-know.${o.programMissing
            ? ' <b style="color:#e8b45c;">(program PDF not uploaded yet)</b>' : ''}`)}`);

        // ---- (e) introduce yourself — the one-slide summary, for EVERY guest ----
        const onepagerBlock = module(`${label('2 · Your one-slide summary')}
        ${para(`One slide: ${SUMMARY_BRIEF}. <span style="color:#c9b89f;font-size:12px;">PDF or PowerPoint, up to 10&nbsp;MB, by <b style="color:#f2e7d6;">${SLIDES_DEADLINE}</b>. Shared with all participants after the event if you tick the box.</span>`)}
        ${wideBtn(o.onepager ? 'Replace my one-slide summary' : 'Upload my one-slide summary', base + '/boston/onepager/' + onepagerToken(id))}
        ${o.onepager ? onFile('Already received', o.onepager.original_name) : ''}`);

        // ---- (f) you're presenting — the slides, presenters ONLY ----
        const presenterBlock = o.presenter ? module(`${label("3 · Your presentation slides")}
        ${para(`We preload every deck on one laptop. <span style="color:#c9b89f;font-size:12px;">${SLIDES_FORMAT_LINE} &middot; by <b style="color:#f2e7d6;">${SLIDES_DEADLINE}</b>.</span>`)}
        ${wideBtn(o.uploaded ? 'Replace my slides' : 'Upload my slides', base + '/boston/upload/' + uploadToken(id))}
        ${o.uploaded ? onFile('Already received', o.uploaded && o.uploaded.original_name) : ''}`) : '';

        const walletStack = (links.apple || links.google || links.calendar) ? `
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px auto 0;">
                ${links.apple ? `<tr><td align="center" style="padding:0 0 10px;">${emailTemplates.btn('ADD TO APPLE WALLET →', links.apple, 'ink', 'width:260px;max-width:100%;padding-left:0;padding-right:0;text-align:center;box-sizing:border-box;')}</td></tr>` : ''}
                ${links.google ? `<tr><td align="center" style="padding:0 0 10px;">${emailTemplates.btn('ADD TO GOOGLE WALLET →', links.google, 'gold', 'width:260px;max-width:100%;padding-left:0;padding-right:0;text-align:center;box-sizing:border-box;')}</td></tr>` : ''}
                ${links.calendar ? `<tr><td align="center" style="padding:0 0 10px;">${emailTemplates.btn('ADD TO CALENDAR →', links.calendar, 'ghost', 'width:260px;max-width:100%;padding-left:0;padding-right:0;text-align:center;box-sizing:border-box;')}</td></tr>` : ''}
              </table>` : '';

        // ---- numbered sections: the number IS the section, the buttons live inside it ----
        const section = (n, title, inner) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:26px;background:#342718;border:1px solid rgba(215,181,108,.42);"><tr>
          <td style="width:44px;vertical-align:top;padding:20px 0 0 18px;"><span style="display:inline-block;width:30px;height:30px;line-height:30px;text-align:center;background:#a8232b;color:#fff3e2;font-family:${T.sans};font-weight:700;font-size:15px;">${n}</span></td>
          <td style="vertical-align:top;padding:18px 20px 20px 10px;">
            <div style="font-family:${T.serif};font-weight:500;font-size:20px;line-height:1.25;color:#f2e7d6;">${title}</div>
            ${inner}
          </td></tr></table>`;
        const text = (html, mt) => `<div style="font-family:${T.sans};font-size:14.5px;line-height:1.65;color:#e3d6c2;margin-top:${mt == null ? 10 : mt}px;">${html}</div>`;
        const small = html => `<div style="font-family:${T.sans};font-size:12.5px;line-height:1.6;color:#c9b89f;margin-top:8px;">${html}</div>`;
        const bigBtn = (label, href) => `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:14px;"><tr><td>${emailTemplates.btn(label, href, 'solid', 'padding:15px 26px;font-size:12px;background:#a8232b;')}</td></tr></table>`;
        // The small-caps word that says whether a section is an obligation or an invitation.
        const secTag = kind => `<span style="font-family:${T.sans};font-weight:600;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:${kind === 'required' ? '#e8a6a1' : '#d7b56c'};vertical-align:middle;">&nbsp;${kind}</span>`;

        // 1 · dietary — the buttons are right here, no detour
        const sec1 = section(1, 'Please tell us your dietary restrictions and allergies' + secTag('required'), `
            ${text('Dinner is served during the networking part of the evening. Please use the button below to choose your dietary preference and tell us about any food allergies &mdash; it is a very short form, two questions, and your name is already on it.')}
            ${bigBtn('Choose my dietary preferences', me + '#step1')}`);

        // 2 · the one-slide summary — explained, because this is the first time they hear of it
        const sec2 = section(2, 'Please send us a one-slide summary of your work' + secTag('optional'), `
            ${text('We invite every participant to prepare <b style="color:#f2e7d6;">one slide</b> about their work: your institution and group, what you work on, and what kind of collaboration or partner you are looking for &mdash; with your contact details. After the event we will compile all summaries into one document and share it with every participant, so people know who is working on what and can follow up.')}
            ${small(`PDF or PowerPoint, one slide, up to 10&nbsp;MB &middot; please send it by <b style="color:#f2e7d6;">${SLIDES_DEADLINE}</b>. Click the button, choose your file, done. You can replace it any time from the same link.`)}
            ${bigBtn(o.onepager ? 'Replace my one-slide summary' : 'Upload my one-slide summary', me + '#step2')}
            ${o.onepager ? onFile('Already received', o.onepager.original_name) : ''}`);

        // 3 · slides — presenters only
        const sec3 = o.presenter ? section(3, 'Please send us your presentation slides' + secTag('required'), `
            ${text('You are giving one of the <b style="color:#f2e7d6;">5-minute presentations</b>. In short: introduce your lab, clinic or department and the work you do there at a broad level &mdash; who you are and what your group is known for, two or three areas of your work, one example of a project or result &mdash; and use your <b style="color:#f2e7d6;">last slide</b> to say how you would like to collaborate and in which area. The audience is broad, so keep it simple and readable from the back of the room. Talks run back to back from one laptop; there is no Q&amp;A, the discussion continues at the reception. Full instructions are in the attached program.')}
            ${small(`${SLIDES_FORMAT_LINE} &middot; please upload by <b style="color:#f2e7d6;">${SLIDES_DEADLINE}</b>. You can replace the file any time from the same link.`)}
            ${bigBtn(o.uploaded ? 'Replace my slides' : 'Upload my slides', me + '#step3')}
            ${o.uploaded ? onFile('Already received', o.uploaded && o.uploaded.original_name) : ''}`) : '';

        // 4 · the program PDF
        const sec4 = section(o.presenter ? 4 : 3, 'Please read the attached program', `
            ${text(`Attached to this email is a two-page PDF with the running order of the evening, the instructions for presentations and the practical notes.${o.programMissing ? ' <b style="color:#e8b45c;">(program PDF not uploaded yet)</b>' : ''}`)}`);

        // ---- the third shape: they offered to present, and there was no room ----------------------
        // The whole risk in this email is that somebody reads "not presenting" as "not invited" and
        // quietly stays home. So it opens on the seat, in bold, before the word presentation appears
        // at all — and the ticket block is hoisted to sit directly underneath it (see `body` below).
        const declinedNote = o.declined ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;background:#342718;border:1px solid rgba(215,181,108,.42);"><tr>
          <td style="padding:20px 22px;">
            <div style="font-family:${T.serif};font-weight:500;font-size:20px;line-height:1.25;color:#f2e7d6;">About your presentation</div>
            ${text(`<b style="color:#f2e7d6;">Your seat on Monday is confirmed and we very much look forward to seeing you.</b>`)}
            ${text('Thank you for offering to give one of the 5-minute presentations. The interest this year was exceptionally high &mdash; we have far more requests than the evening can hold &mdash; so we sadly cannot give everyone the floor this time.')}
            ${text('Please do come. The panel, the presentations, the reception and the networking afterwards are the heart of the evening, and they are exactly where the connections happen. We would also be glad to have your one-slide summary, so your work reaches every participant in the document we share after the event.')}
            ${text('And we hope to have you present at one of the next editions.')}
          </td></tr></table>` : '';

        // The ticket. Normally it closes the email (it is for Monday, not for today) — but in the
        // declined shape it is hoisted directly under the note, because the one thing that guest
        // must not doubt is that they still hold a seat.
        const ticketBlock = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px;border-top:1px solid rgba(240,228,210,.18);"><tr><td style="padding-top:22px;">
        ${label('Your ticket for the door')}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;background:#342718;border:1px solid rgba(215,181,108,.42);"><tr><td align="center" style="padding:18px 20px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#ffffff;border:1px solid rgba(240,228,210,.2);padding:8px;">
            <a href="${esc(base + '/api/boston/qr/' + id + '.png')}" style="display:block;text-decoration:none;"><img src="${esc(base + '/api/boston/qr/' + id + '.png')}" alt="Your entry QR code" width="120" height="120" style="display:block;width:120px;height:120px;border:0;"></a>
          </td></tr></table>
          <div style="font-family:${T.sans};font-weight:600;font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:#c9b89f;margin-top:8px;">${esc(fullName)} &middot; N&deg; ${esc(ticketNo(id))} &middot; show at the door</div>
          <div style="font-family:${T.sans};font-size:11px;color:#c9b89f;margin-top:4px;">Tap the QR to enlarge it &mdash; then save it to your photos.</div>${walletStack}
        </td></tr></table>
      </td></tr></table>`;

        // Light house shell: the dark card looked wrong on white Gmail. Plain short letter — the
        // three asks stated in the text, one button, the ticket below.
        const ink = T.ink, soft = T.soft, gold = T.goldDark;
        const line = (n, html) => `<tr><td style="width:30px;vertical-align:top;padding:7px 0;"><span style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;background:${T.crimson};color:#fff;font-family:${T.sans};font-weight:700;font-size:12px;">${n}</span></td><td style="padding:7px 0 7px 8px;font-family:${T.sans};font-size:14.5px;line-height:1.55;color:${ink};">${html}</td></tr>`;
        const tag = t => `<span style="font-family:${T.sans};font-weight:600;font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:${gold};border:1px solid ${T.gold};padding:2px 6px;margin-left:6px;vertical-align:1px;">${t}</span>`;
        const asks = [];
        asks.push(line(1, `<b>Tell us your dietary preference and any food allergies</b>${tag('optional')}<br><span style="color:${soft};font-size:13px;">Finger food and drinks will be served.</span>`));
        asks.push(line(2, `<b>Send us a one-slide summary of your work</b>${tag('optional')}<br><span style="color:${soft};font-size:13px;">We would like every participant to leave with the key information about everyone else in the room. If you would like to take part, please share one slide: who you are, a bit about your work and where you do it, what you are looking for in collaborators or partners, and your contact details. We compile all the slides into one document and share it with every participant after the event. PDF or PowerPoint, by ${esc(SLIDES_DEADLINE)}.</span>`));
        if (o.presenter) asks.push(line(3, `<b>Send us your presentation slides</b>${tag('required')}<br><span style="color:${soft};font-size:13px;">5 minutes, 5 to 8 slides, PowerPoint 16:9. Introduce your lab, department or institution (whichever you are representing), what you or your group do, and how you would like to collaborate. We will load all presentations onto one laptop, so there is no need to bring your own. Q&amp;A is reserved for the networking reception, given the number of presentations. Full instructions in the attached program. By ${esc(SLIDES_DEADLINE)}.</span>`));
        asks.push(line(o.presenter ? 4 : 3, `<b>Have a look at the attached program</b><br><span style="color:${soft};font-size:13px;">Running order, presentation instructions and practical notes (PDF).${o.programMissing ? ' <b style="color:#b45309;">(program PDF not uploaded yet)</b>' : ''}</span>`));

        const declinedNoteLight = o.declined ? `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;background:${T.cardCream};border-left:3px solid ${T.gold};"><tr><td style="padding:14px 18px;font-family:${T.sans};font-size:14.5px;line-height:1.65;color:${ink};">
        <b>Your seat on Monday is confirmed and we very much look forward to seeing you.</b><br><br>
        Thank you for offering to give one of the 5-minute presentations. We received many more requests than the evening can hold, and sadly we could not accommodate your presentation this time. We are sorry about that, and we hope to have you present at one of the next editions.<br><br>
        We would warmly encourage you to send us your <b>one-slide summary</b> (point 2 below). The summaries of everyone&rsquo;s work are compiled into one document and shared with all participants, so your work is still presented to the room &mdash; with your contact details, for anyone who wants to follow up.
      </td></tr></table>` : '';

        const ticketLight = `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:26px;border-top:1px solid ${T.hairline};"><tr><td style="padding-top:18px;">
        <div style="font-family:${T.sans};font-weight:600;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:${gold};">Your ticket for the door</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;background:${T.cardCream};border:1px solid ${T.hairline};"><tr><td align="center" style="padding:18px 20px;">
          <a href="${esc(base + '/api/boston/qr/' + id + '.png')}" style="display:inline-block;text-decoration:none;background:#fff;padding:8px;border:1px solid ${T.hairline};"><img src="${esc(base + '/api/boston/qr/' + id + '.png')}" alt="Your entry QR code" width="120" height="120" style="display:block;width:120px;height:120px;border:0;"></a>
          <div style="font-family:${T.sans};font-size:12px;color:${soft};margin-top:8px;">${esc(fullName)} &middot; N&deg; ${esc(ticketNo(id))} &middot; show this at the door</div>${walletStack}
        </td></tr></table>
      </td></tr></table>`;

        const body = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:34px 40px 30px;">
      <div style="font-family:${T.sans};font-weight:600;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:${gold};">Building Bridges in Biomedicine &middot; Croatia &amp; the US</div>
      <div style="font-family:${T.serif};font-weight:500;font-size:26px;line-height:1.2;color:${ink};margin-top:8px;">Your details for Monday, 21 September</div>
      <div style="font-family:${T.sans};font-size:14.5px;line-height:1.7;color:${ink};margin-top:16px;">
        <p style="margin:0 0 10px;">Dear ${esc(first)},</p>
        <p style="margin:0;">We look forward to welcoming you to <b>Building Bridges in Biomedicine: Croatia &amp; the US</b> on <b>${esc(DATE_LONG)}</b> in the Waterhouse Room, Gordon Hall, Harvard Medical School &mdash; doors open at 5:30&nbsp;PM, the program runs 6:00&ndash;9:00&nbsp;PM, business attire.</p>
      </div>
      ${declinedNoteLight}
      <div style="font-family:${T.sans};font-size:14.5px;line-height:1.7;color:${ink};margin-top:18px;">Before then, we would ask you to do the following <b>by clicking the button below</b>:</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;">${asks.join('')}</table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:26px 0 0;">${emailTemplates.btn('Open my personal page', me, 'solid', 'padding:18px 44px;font-size:13.5px;letter-spacing:.14em;')}</td></tr></table>
      <div style="font-family:${T.sans};font-size:12.5px;line-height:1.6;color:${soft};margin-top:8px;text-align:center;">This is your personal link.</div>
      <div style="font-family:${T.sans};font-size:15px;line-height:1.7;color:${ink};margin-top:20px;text-align:center;">See you soon! <span style="font-size:18px;vertical-align:-2px;">\uD83C\uDDED\uD83C\uDDF7 \uD83C\uDDFA\uD83C\uDDF8</span></div>
      ${ticketLight}
      <div style="font-family:${T.sans};font-size:12px;line-height:1.7;color:${soft};margin-top:18px;">Unable to attend? <a href="${esc(rsvp(CANNOT_ATTEND))}" style="color:${T.crimson};text-decoration:underline;">Cancel your participation here</a> &mdash; your seat goes to someone on the waiting list.</div>
      <div style="margin-top:20px;padding-top:12px;border-top:1px solid ${T.hairline};font-family:${T.sans};font-size:12px;line-height:1.7;color:${soft};">Questions? Just reply to this email &mdash; or write to Laura Rodman at ${SUPPORT_EMAIL}.</div>
    </td></tr></table>`;

        return emailTemplates.shell({
            title: 'Your Building Bridges Boston details — action needed before 21 September',
            preheader: 'Your food preferences, your one-slide summary, the program — and your ticket for the door.',
            headerRightLabel: 'BUILDING BRIDGES · BOSTON',
            rule: 'crimson',
            bodyHtml: body
        });
    }

    // ------------------------------------------------------------ GET /boston/rsvp/:token/:answer
    // The one-tap answer page. A forged token or an answer outside the whitelist is a 404 — the
    // page never says which. Every write is idempotent: re-clicking simply overwrites.
    app.get('/boston/rsvp/:token/:answer', (req, res) => {
        res.set('X-Robots-Tag', 'noindex, nofollow');
        res.set('Cache-Control', 'private, no-store');
        try {
            const id = verifyDietToken(req.params.token);
            const answer = String(req.params.answer || '').toLowerCase();
            const reg = id ? query.get('SELECT * FROM bridges_registrations WHERE id = ? AND event_id = ?', [id, EVENT_ID]) : null;
            if (!reg || !RSVP_ANSWERS.includes(answer)) return res.status(404).send(rsvpNotFoundPage());

            // "I can't make it" — the confirm page, never the deed. The POST behind its one button
            // is what releases the seat, so a mail scanner walking this link changes nothing.
            if (answer === CANNOT_ATTEND) return res.send(cannotAttendPage(reg, dietToken(reg.id)));
            // A guest who already gave the seat back still holds working links — they just meet a
            // notice instead of a form. Placed BEFORE every write: a released row records nothing.
            if (isReleasedRow(reg)) return res.send(releasedPage(reg));

            if (DIET_PREFS[answer]) {
                query.run('UPDATE bridges_registrations SET dietary_requirements = ? WHERE id = ?', [DIET_PREFS[answer], reg.id]);
                stampCateringAnswers(reg, { diet_pref: answer });
                flushDb();
            } else if (answer === ALLERGY_NONE) {
                query.run('UPDATE bridges_registrations SET special_requests = ? WHERE id = ?',
                    [withAllergyPart(reg.special_requests, ALLERGY_NONE_VALUE), reg.id]);
                stampCateringAnswers(reg, { allergies: ALLERGY_NONE_VALUE });
                flushDb();
            }
            // ALLERGY_TELL and RSVP_OPEN write nothing — they only open the page.
            const fresh = query.get('SELECT * FROM bridges_registrations WHERE id = ?', [reg.id]) || reg;
            res.send(rsvpPage(fresh, dietToken(reg.id), answer));
        } catch (e) {
            console.error('[Boston] rsvp page error:', e.message);
            res.status(500).send(simplePage('Something went wrong', 'One moment, please.',
                `We could not record that just now. Please try the link again in a minute, or write to Laura Rodman (<a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>).`));
        }
    });

    // ------------------------------------------------------------ POST /api/boston/rsvp/:token/allergies
    // The one text box behind "I have allergies". Stored into special_requests, prefixed
    // "Allergies: ", and mirrored into custom_answers. Idempotent — saving again replaces it.
    app.post('/api/boston/rsvp/:token/allergies', (req, res) => {
        try {
            const id = verifyDietToken(req.params.token);
            const reg = id ? query.get('SELECT * FROM bridges_registrations WHERE id = ? AND event_id = ?', [id, EVENT_ID]) : null;
            if (!reg) return res.status(404).json({ error: 'Not found' });
            if (isReleasedRow(reg)) return res.status(409).json({ error: RELEASED_LINE(releasedOn(reg)) });
            const text = String((req.body || {}).text == null ? '' : (req.body || {}).text)
                .replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, MAX_ALLERGY_CHARS);
            if (!text) return res.status(400).json({ error: 'Tell us what to avoid — or tap “No allergies”.' });
            query.run('UPDATE bridges_registrations SET special_requests = ? WHERE id = ?',
                [withAllergyPart(reg.special_requests, text), reg.id]);
            stampCateringAnswers(reg, { allergies: text });
            flushDb();
            res.json({ success: true, allergies: text });
        } catch (e) {
            console.error('[Boston] rsvp allergies save failed:', e.message);
            res.status(500).json({ error: 'We could not save that just now. Please try again.' });
        }
    });

    // ------------------------------------------------------------ POST /api/boston/rsvp/:token/cannot-attend
    // The deed behind the confirm page's one button. Everything the guest gave us stays on the row
    // — the seat is what is released, not the record — so a restore is one field away and the
    // catering history, the summary and the deck are all still there if plans change back.
    // Idempotent: a second confirm re-reads as released, sends nothing and writes nothing.
    app.post('/api/boston/rsvp/:token/cannot-attend', async (req, res) => {
        try {
            const id = verifyDietToken(req.params.token);
            const reg = id ? query.get('SELECT * FROM bridges_registrations WHERE id = ? AND event_id = ?', [id, EVENT_ID]) : null;
            if (!reg) return res.status(404).json({ error: 'Not found' });
            if (isReleasedRow(reg)) {
                return res.json({ success: true, already: true, released_on: releasedOn(reg) });
            }
            const today = new Date().toISOString().slice(0, 10);
            const notes = String(reg.notes || '');
            const stamped = new RegExp(CANCELLED_MARK).test(notes) ? notes
                : (notes ? notes + ' | ' : '') + CANCELLED_MARK + ' ' + today;
            query.run(`UPDATE bridges_registrations SET status = 'cancelled', notes = ? WHERE id = ?`, [stamped, reg.id]);
            // Not a catering answer — so this stamp deliberately leaves answered_at alone; the row
            // must not start reading as "they answered the food questions today".
            stampCateringAnswers(reg, { cannot_attend_at: new Date().toISOString() }, { touchAnsweredAt: false });
            flushDb();

            // The sheet is the team's live view of the room, so the released seat has to show there
            // too — the one status write this flow makes, through the helper the review gate uses.
            updateBostonSheetStatus(reg.id, 'Cancelled by guest');

            const stillHeld = Number((query.get(`SELECT COUNT(*) AS n FROM bridges_registrations
                WHERE event_id = ? AND status IN ('registered','confirmed')`, [EVENT_ID]) || {}).n || 0);
            const who = `${reg.first_name || ''} ${reg.last_name || ''}`.trim() || reg.email;
            const fyi = releasedFyiHtml(who, reg.institution || '', stillHeld);
            const subject = `Seat released — ${who} cannot attend Boston`;
            for (const to of [process.env.CONFIRMATION_CC || SUPPORT_EMAIL, reviewGate.REVIEW_TO]) {
                try { await sendEmail(to, subject, fyi); }
                catch (e) { console.warn('[Boston] cannot-attend FYI failed for ' + to + ':', e.message); }
            }
            console.log(`[Boston] seat released by guest: ${reg.id} (${reg.email}) — ${stillHeld} registered now`);
            res.json({ success: true, released_on: today, registered_now: stillHeld });
        } catch (e) {
            console.error('[Boston] cannot-attend failed:', e.message);
            res.status(500).json({ error: 'We could not record that just now. Please try again in a minute.' });
        }
    });

    // ------------------------------------------------------------ POST /api/boston/registrations/:id/restore
    // The team's undo, behind the same derived key as every other organizer route. Plans change
    // back more often than one would think, and the row still holds everything — so a restore is a
    // status flip plus a dated marker, and the sheet returns to 'Confirmed'.
    app.post('/api/boston/registrations/:id/restore', (req, res) => {
        try {
            if (!checkAdminKey(req.query && req.query.key)) return res.status(404).json({ error: 'Not found' });
            const reg = query.get('SELECT * FROM bridges_registrations WHERE id = ? AND event_id = ?',
                [String(req.params.id || ''), EVENT_ID]);
            if (!reg) return res.status(404).json({ error: 'That guest is not on the Boston list.' });
            if (!isReleasedRow(reg)) return res.json({ success: true, already: true, status: reg.status || 'registered' });
            const today = new Date().toISOString().slice(0, 10);
            const notes = String(reg.notes || '');
            const stamped = new RegExp(RESTORED_MARK).test(notes) ? notes
                : (notes ? notes + ' | ' : '') + RESTORED_MARK + ' ' + today;
            query.run(`UPDATE bridges_registrations SET status = 'registered', notes = ? WHERE id = ?`, [stamped, reg.id]);
            flushDb();
            updateBostonSheetStatus(reg.id, 'Confirmed');
            console.log(`[Boston] seat restored by the team: ${reg.id} (${reg.email})`);
            res.json({ success: true, status: 'registered', restored_on: today, email: reg.email });
        } catch (e) {
            console.error('[Boston] restore failed:', e.message);
            res.status(500).json({ error: 'Could not restore that seat just now.' });
        }
    });

    // custom_answers is a shared JSON blob on the registration row — merge into it, never replace.
    // opts.touchAnsweredAt === false is for stamps that are not a catering answer (the released
    // seat), so answered_at keeps meaning what the CSV column says it means.
    function stampCateringAnswers(reg, patch, opts) {
        let ca = {};
        try { ca = JSON.parse(reg.custom_answers || '{}') || {}; } catch (e) { ca = {}; }
        if (!ca || typeof ca !== 'object' || Array.isArray(ca)) ca = {};
        Object.assign(ca, patch);
        if (!opts || opts.touchAnsweredAt !== false) ca.answered_at = new Date().toISOString();
        query.run('UPDATE bridges_registrations SET custom_answers = ? WHERE id = ?', [JSON.stringify(ca), reg.id]);
        return ca;
    }

    // ------------------------------------------------------------ catering data (JSON + CSV share it)
    // Everyone holding a seat — the same population the reminder goes to.
    function cateringRows() {
        return query.all(`SELECT * FROM bridges_registrations
            WHERE event_id = ? AND status IN ('registered','confirmed')
            ORDER BY registered_at, rowid`, [EVENT_ID]);
    }
    // Seats given back by their guest. Deliberately a SECOND list, never mixed into the one above:
    // every count on the card and every head the caterer cooks for comes from cateringRows(), and
    // a released seat must not be in any of them. A review-gate rejection is cancelled too but was
    // never a seat, so only rows carrying the guest's own marker appear here.
    function releasedSeatRows() {
        return query.all(`SELECT * FROM bridges_registrations
            WHERE event_id = ? AND status = 'cancelled'
            ORDER BY registered_at, rowid`, [EVENT_ID]).filter(releasedByGuest);
    }
    function cateringData() {
        const regs = cateringRows();
        const preferences = PREF_KEYS.map(k => ({ key: k, label: DIET_PREFS[k], count: 0 }));
        const byKey = new Map(preferences.map(p => [p.key, p]));
        let withAllergies = 0, noAllergies = 0, notAnswered = 0, remindersSent = 0, onepagers = 0;
        const rows = regs.map(r => {
            const st = cateringStateOf(r);
            if (st.prefKey && byKey.has(st.prefKey)) byKey.get(st.prefKey).count++;
            if (st.allergyState === 'yes') withAllergies++;
            if (st.allergyState === 'none') noAllergies++;
            if (!st.answered) notAnswered++;
            if (wasReminded(r)) remindersSent++;
            const presenter = isPresenterRow(r);
            const onePager = latestOnepager(r.id);
            if (onePager) onepagers++;
            return {
                registration_id: r.id,
                name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
                first_name: r.first_name || '',
                email: r.email,
                institution: r.institution || '',
                preference: st.prefLabel,
                preference_key: st.prefKey,
                allergy_state: st.allergyState,
                allergies: st.allergyText,
                answered: st.answered,
                answered_at: st.answeredAt,
                presenter,
                presentation_requested: requestedPresentation(r),
                presenter_status: presenterStatusOf(r),
                declined_presenter: wasDeclinedPresenter(r),
                uploaded: presenter ? !!latestPresentation(r.id) : false,
                onepager: !!onePager,
                onepager_headline: onePager && onePager.headline ? String(onePager.headline) : null,
                onepager_share_ok: onePager ? shareOkOf(onePager) : null,
                onepager_at: onePager ? onePager.uploaded_at : null,
                onepager_download_url: onePager ? `${baseUrl()}/api/boston/onepagers/${onePager.id}/download?key=${adminKey()}` : null,
                reminder_sent: wasReminded(r),
                reminder_sent_at: remindedOn(r)
            };
        });
        const preferenceUnanswered = rows.filter(r => !r.preference_key).length;
        const released = releasedSeatRows().map(r => ({
            registration_id: r.id,
            name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
            email: r.email,
            institution: r.institution || '',
            presenter: isPresenterRow(r),
            released_on: releasedOn(r)
        }));
        return {
            event: EVENT_ID, event_name: EVENT_NAME,
            generated_at: new Date().toISOString(),
            // `total` is and stays the number of seats actually held — the released list rides
            // beside it so the card can show both without either number lying about the other.
            total: rows.length,
            registered: rows.length,
            released,
            released_count: released.length,
            answered: rows.length - notAnswered,
            not_answered: notAnswered,
            preferences,
            preference_unanswered: preferenceUnanswered,
            with_allergies: withAllergies,
            no_allergies: noAllergies,
            allergies_unanswered: rows.length - withAllergies - noAllergies,
            presenters: rows.filter(r => r.presenter).length,
            onepagers_received: onepagers,
            onepagers_pending: rows.length - onepagers,
            onepagers_shared: rows.filter(r => r.onepager_share_ok === true).length,
            onepagers_private: rows.filter(r => r.onepager_share_ok === false).length,
            reminders_sent: remindersSent,
            reminders_pending: rows.length - remindersSent,
            rows
        };
    }

    // ------------------------------------------------------------ POST /api/boston/reminders/send
    // {to:'preview'}                       → BOTH shapes of the email to the reviewer, nothing stamped.
    // {to:'preview', variant:'presenter'}  → just that shape (the other is 'attendee').
    // {to:'all'}                           → everyone not yet reminded (already-sent rows are skipped).
    // {to:'<id>'}                          → that one registrant, always (this is the Resend button).
    //
    // The program PDF is the one attachment, fetched from S3 ONCE per batch and reused for every
    // recipient. A real send without it would leave the whole room without the program, so 'all'
    // and single sends refuse; only the preview goes out marked "(program PDF not uploaded yet)"
    // so the owner can read the email before the PDF exists.
    const perRegistrantOpts = (r, programMissing) => {
        const presenter = isPresenterRow(r);
        return {
            presenter,
            // The third shape. presenter is already false for a declined row, so the slides section
            // disappears on its own; this flag is what adds the note that explains why.
            declined: wasDeclinedPresenter(r),
            uploaded: presenter ? (latestPresentation(r.id) || null) : null,
            onepager: latestOnepager(r.id) || null,
            programMissing: !!programMissing
        };
    };

    app.post('/api/boston/reminders/send', async (req, res) => {
        try {
            if (!checkAdminKey(req.query && req.query.key)) return res.status(404).json({ error: 'Not found' });
            const body = req.body || {};
            const to = String(body.to || '').trim();
            const everyone = cateringRows();
            const program = await loadProgramAttachment();

            if (to === 'preview') {
                const wanted = String(body.variant || '').trim().toLowerCase();
                const SHAPES = ['presenter', 'attendee', 'declined'];
                if (wanted && !SHAPES.includes(wanted)) {
                    return res.status(400).json({ error: 'variant must be "presenter", "attendee" or "declined".' });
                }
                // Each variant is built from a REAL row of that shape, so the preview shows the
                // links, the ticket and the answers the owner would actually see. A declined row
                // may not exist yet (he has not decided) — in that case the shape is rendered from
                // the first person who OFFERED and is still undecided, and the subject says so, so
                // a preview can never be mistaken for somebody's real standing.
                const fallback = (extraNotes) => ({ id: 'preview', first_name: 'Alen', last_name: '', email: reviewGate.REVIEW_TO, institution: '', notes: extraNotes || null });
                const realDeclined = everyone.find(wasDeclinedPresenter);
                const declinedSample = realDeclined
                    || everyone.find(r => requestedPresentation(r) && presenterStatusOf(r) == null)
                    || fallback('5-minute presentation requested');
                const pick = {
                    presenter: everyone.find(isPresenterRow) || fallback('5-minute presentation requested'),
                    // never a declined row: that person reads a different email entirely
                    attendee: everyone.find(r => !isPresenterRow(r) && !requestedPresentation(r)) || fallback(null),
                    declined: declinedSample
                };
                const label = { presenter: 'presenter', attendee: 'attendee', declined: 'declined-presenter · still expected' };
                const variants = wanted ? [wanted] : SHAPES;
                for (const v of variants) {
                    const sample = pick[v];
                    const opts = perRegistrantOpts(sample, !program);
                    // the declined shape is what is being previewed, whoever the sample row is
                    if (v === 'declined') { opts.declined = true; opts.presenter = false; opts.uploaded = null; }
                    const sampled = v === 'declined' && !realDeclined ? ' (sample)' : '';
                    await sendEmail(reviewGate.REVIEW_TO, `[PREVIEW · ${label[v]}${sampled}] ` + REMINDER_SUBJECT,
                        reminderEmailHtml(sample, opts),
                        program ? [program] : undefined);
                }
                return res.json({
                    success: true, preview_to: reviewGate.REVIEW_TO, variants,
                    declined_sample: !realDeclined,
                    program_attached: !!program, registrants: everyone.length
                });
            }
            if (to !== 'all' && !to) return res.status(400).json({ error: 'Say who: "preview", "all", or a registration id.' });
            if (!program) return res.status(400).json({ error: 'Upload the program PDF first' });

            const targets = to === 'all' ? everyone.filter(r => !wasReminded(r)) : everyone.filter(r => String(r.id) === to);
            const today = new Date().toISOString().slice(0, 10);
            const sent = [];
            for (const r of targets) {
                const out = await sendEmail(r.email, ACTION_SUBJECT(r),
                    reminderEmailHtml(r, perRegistrantOpts(r, false)), [program]);
                if (out && out.success !== false) {
                    const notes = String(r.notes || '');
                    const stamped = new RegExp(REMINDER_MARK).test(notes) ? notes
                        : (notes ? notes + ' | ' : '') + REMINDER_MARK + ' ' + today;
                    query.run('UPDATE bridges_registrations SET reminder_sent = 1, notes = ? WHERE id = ?', [stamped, r.id]);
                    sent.push(r.email);
                }
            }
            flushDb();
            console.log(`[Boston] Boston emails sent: ${sent.length}/${targets.length}`);
            return res.json({
                success: true, sent, program_attached: true,
                skipped_already_sent: to === 'all' ? everyone.length - targets.length : 0,
                not_found: to !== 'all' && !targets.length
            });
        } catch (e) {
            console.error('[Boston] reminder send failed:', e.message);
            res.status(500).json({ error: e.message });
        }
    });

    // ------------------------------------------------------------ GET /api/boston/catering(.csv)
    app.get('/api/boston/catering', (req, res) => {
        try {
            if (!checkAdminKey(req.query && req.query.key)) return res.status(404).json({ error: 'Not found' });
            res.set('Cache-Control', 'private, no-store');
            res.json(cateringData());
        } catch (e) {
            console.error('[Boston] catering JSON error:', e.message);
            res.status(500).json({ error: 'Could not assemble the catering list.' });
        }
    });
    app.get('/api/boston/catering.csv', (req, res) => {
        try {
            if (!checkAdminKey(req.query && req.query.key)) return res.status(403).json({ error: 'Forbidden' });
            const data = cateringData();
            const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
            // The last column is the caterer's head count in one word. Guests who gave their seat
            // back are listed AFTER everyone coming, marked and with no food answers carried over —
            // a released seat that reads like an order is exactly how a room gets over-catered.
            const lines = [['Name', 'Institution', 'Preference', 'Allergies', 'Answered at', 'Presenter',
                'One-slide summary', 'Seat'].map(q).join(',')];
            for (const r of data.rows) {
                lines.push([r.name, r.institution, r.preference || '',
                    r.allergy_state === 'none' ? 'None' : (r.allergies || ''),
                    r.answered_at ? fmtWhen(r.answered_at) : '',
                    r.presenter ? 'Yes' : 'No',
                    // the guest's own sharing answer, so the list that leaves the building and the
                    // archive that goes to participants can never disagree
                    r.onepager ? (r.onepager_share_ok ? 'Shared' : 'Private') : '',
                    'Coming'].map(q).join(','));
            }
            for (const r of data.released) {
                lines.push([r.name, r.institution, '', '', '', r.presenter ? 'Yes' : 'No', '',
                    'Released seat' + (r.released_on ? ' ' + r.released_on : '')].map(q).join(','));
            }
            res.set('Content-Type', 'text/csv; charset=utf-8');
            res.set('Content-Disposition', 'attachment; filename="building-bridges-boston-catering.csv"');
            res.set('Cache-Control', 'private, no-store');
            res.send('\ufeff' + lines.join('\r\n') + '\r\n');
        } catch (e) {
            console.error('[Boston] catering CSV failed:', e.message);
            res.status(500).json({ error: 'Export failed.' });
        }
    });

    // ------------------------------------------------------------ GET /api/boston/presentations/:id/download
    app.get('/api/boston/presentations/:id/download', (req, res) => {
        try {
            if (!checkAdminKey(req.query && req.query.key)) return res.status(404).json({ error: 'Not found' });
            ensurePresentationsTable();
            const p = query.get('SELECT * FROM bridges_presentations WHERE id = ?', [String(req.params.id || '')]);
            if (!p) return res.status(404).json({ error: 'Not found' });
            if (isLinkRow(p)) {                     // the over-25 MB lane: the deck lives on Drive / Dropbox
                res.set('Cache-Control', 'private, no-store');
                return res.redirect(302, String(p.external_url));
            }
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

    console.log('[Boston] Building Bridges Boston wing mounted (/boston + presentation & one-slide-summary uploads + the one Boston email)');
};

// Test seam: the SigV4 helper — tests stub putObject (never the wire) and drive presignGet as-is
// (pure computation) against AWS's published test vector.
module.exports._s3 = s3;
// The awards wing (v2/awards.js) stores its optional one-page PDFs in the SAME private bucket
// under awards/<entry id>/ and vets them with the SAME magic-byte check — reusing these two
// rather than keeping a second, quietly diverging copy of the signer and the sniffing rules.
module.exports._magicOk = magicOk;
module.exports._sanitizeFilename = sanitizeFilename;

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
.hp{position:absolute!important;left:-9999px!important;top:-9999px!important;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;}
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
      <div class="frow"><span>When</span><span>${esc(DATE_LONG)}</span></div>
      <div class="frow"><span>Time</span><span>6:00&ndash;9:00 PM &middot; doors from 5:30 PM</span></div>
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
        <div class="hp" aria-hidden="true"><label for="f_web">Website</label>
          <input type="text" id="f_web" name="website" tabindex="-1" autocomplete="off"></div>
        <label class="check" for="f_pres">
          <input type="checkbox" id="f_pres" name="presentation">
          <span class="t">I would like to give a short 5-minute presentation of my lab, clinic, department, or institution.</span>
        </label>
        <p class="slots">Presentation slots are confirmed by email based on the total number of requests.</p>
        <p class="fine" style="margin:0 0 12px;">Email addresses collected during registration will only be used to inform attendants about the event and will not be used for other purposes.</p>
        <button type="submit" class="btn" id="subbtn">Register for the evening</button>
        <div class="err" id="errbox"></div>
      </form>
      <p class="fine">Your confirmation email arrives with your entry QR code, Apple &amp; Google Wallet passes and a calendar invite. Your personal data is processed under the EU GDPR and used solely to organize this event. Questions? Laura Rodman (<a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>)</p>
    </div>
    <div id="done">
      <p class="slabel" style="text-align:center;">Registration received</p>
      <p class="headline" id="doneheadline">You are <i style="font-weight:400;">in</i>.</p>
      <p class="lede" id="donetext">Your confirmation email is on its way — it carries your <b>entry QR code</b> and your <b>Apple &amp; Google Wallet passes</b>. Show either at the door.</p>
      <div id="walletbtns" style="display:none;margin:18px 0 4px;text-align:center;"></div>
      <a class="cal" id="callink" href="/boston.ics">Add to calendar &darr;</a>
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
      body:JSON.stringify({name:name,email:email,institution:inst,position:pos,presentation:pres,
        website:(document.getElementById('f_web')||{value:''}).value})})
    .then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j};});})
    .then(function(res){
      if(res.ok&&(res.j.success||res.j.already)){
        if(res.j.held){
          /* Held for review: no imminent-confirmation promise, no wallet buttons, no calendar. */
          document.getElementById('doneheadline').textContent='Thank you for registering.';
          document.getElementById('donetext').textContent='Your registration is being reviewed — we will confirm it by email shortly.';
          document.getElementById('callink').style.display='none';
          document.getElementById('formwrap').style.display='none';
          document.getElementById('done').style.display='block';
          window.scrollTo({top:document.getElementById('done').getBoundingClientRect().top+window.pageYOffset-90,behavior:'smooth'});
          return;
        }
        if(res.j.already){document.getElementById('donetext').innerHTML='You were already registered — we have <b>re-sent your confirmation email</b> with your entry QR and wallet passes to <b>'+email.replace(/</g,'&lt;')+'</b>.';}
        var w=res.j.wallet||{};var wb=document.getElementById('walletbtns');var bs='';
        var st='display:block;margin:0 auto 10px;max-width:280px;padding:14px 10px;font:600 11px Inter,Helvetica,sans-serif;letter-spacing:.16em;text-decoration:none;text-transform:uppercase;text-align:center;';
        if(w.apple){bs+='<a href="'+w.apple+'" style="'+st+'background:#191512;color:#f7f1e6;border:1px solid #c9a962;">Add to Apple Wallet &rarr;</a>';}
        if(w.google){bs+='<a href="'+w.google+'" style="'+st+'background:#c9a962;color:#191512;border:1px solid #191512;">Add to Google Wallet &rarr;</a>';}
        if(w.calendar){bs+='<a href="'+w.calendar+'" style="'+st+'border:1px solid rgba(25,21,18,.35);color:#191512;">Add to Calendar &rarr;</a>';document.getElementById('callink').style.display='none';}
        if(bs){wb.innerHTML=bs;wb.style.display='block';}
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
        <p class="reqs">Accepted: <b>.pdf &middot; .ppt &middot; .pptx &middot; .key</b> &mdash; up to <b>25 MB</b>.</p>
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
.brief{font-size:15px;line-height:1.72;color:#4a4139;margin-bottom:20px;}
.brief b{color:#241d18;font-weight:600;}
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
    <p class="brief">${SLIDES_FORMAT_LINE}. <b>Deadline ${SLIDES_DEADLINE}.</b></p>
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

// ---------------------------------------------------------------- personal one-slide summary page
// The same chrome as the presentation page, one lane narrower: a single slide, PDF or PowerPoint,
// 10 MB — plus the optional line that goes under the guest's name in the index, and the sharing
// tick box, which is the owner's "if you are happy to share it" made into an answer we can store.
function onepagerPage(reg, current, s3ok, token) {
    const first = reg.first_name || 'there';
    const fullName = `${reg.first_name || ''} ${reg.last_name || ''}`.trim() || 'Med&X Guest';
    const currentShared = !current || current.share_ok == null || Number(current.share_ok) !== 0;
    const currentCard = current ? `
      <div class="onfile" id="onfile">
        <p class="slabel" style="margin-bottom:8px;">On file with us</p>
        <p class="fname" id="of_name">${esc(current.original_name)}</p>
        <p class="fmeta" id="of_meta">${esc(prettySize(Number(current.size)))} &middot; uploaded ${esc(fmtWhen(current.uploaded_at))}</p>
        ${current.headline ? `<p class="fmeta">&ldquo;${esc(current.headline)}&rdquo;</p>` : ''}
        <p class="fmeta">${currentShared ? 'Shared with all participants after the event.' : 'Kept private &mdash; only the Med&amp;X team sees it.'}</p>
        <p class="fnote">Uploading a new file from this page replaces it, together with the answer below.</p>
      </div>` : '';
    // (The "one line about you" text field was removed 2026-09-15 — file upload only.)
    const shareField = `
        <div class="share">
          <label class="sharebox" for="share_ok"><input type="checkbox" id="share_ok"${currentShared ? ' checked' : ''}><span>${SUMMARY_SHARE_LABEL}</span></label>
          <p class="reqs" style="margin-top:7px;">Leave it ticked and your slide goes to everyone who was in the room. Untick it and only the Med&amp;X team sees it.</p>
        </div>`;
    const uploader = s3ok ? `
      ${currentCard}
      <div id="upwrap">
        <div class="drop" id="drop" tabindex="0" role="button" aria-label="Choose your one-slide summary">
          <div class="dtitle">${current ? 'Replace it &mdash; drag &amp; drop the new file here' : 'Drag &amp; drop your one-slide summary here'}</div>
          <div class="dor">or</div>
          <button type="button" class="pick" id="pickbtn">${current ? 'Choose a replacement file' : 'Browse for the file'}</button>
          <input type="file" id="fileinput" accept="${SUMMARY_ACCEPT_ATTR}" hidden>
        </div>
        <p class="reqs">Accepted: <b>.pdf &middot; .ppt &middot; .pptx</b> &mdash; up to <b>10 MB</b>. Please keep it to one slide &mdash; a single PowerPoint slide or a one-page PDF.</p>
        ${shareField}
        <div class="picked" id="picked" style="display:none;">
          <span class="pname" id="pname"></span><span class="psize" id="psize"></span>
          <button type="button" class="btn" id="upbtn">Upload my one-slide summary</button>
        </div>
        <div class="prog" id="prog" style="display:none;"><div class="bar" id="bar"></div></div>
        <div class="err" id="errbox"></div>
      </div>
      <div id="donebox" style="display:none;">
        <p class="slabel" style="text-align:center;">Received</p>
        <p class="headline">Got it.</p>
        <p class="lede"><b id="donefile"></b> is with us. You can replace it any time from this same link.</p>
      </div>` : `
      ${currentCard}
      <div class="soon">
        <p class="slabel" style="margin-bottom:8px;">Uploads open soon</p>
        <p class="lede" style="text-align:left;max-width:none;">This personal link is yours and will be ready shortly &mdash; keep it. Nothing else is needed from you for now. Questions? Laura Rodman (<a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>).</p>
      </div>`;

    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Your one-slide summary — Building Bridges Boston · Med&amp;X</title>
<meta name="robots" content="noindex, nofollow">
<link rel="icon" type="image/png" href="/assets/favicon-x.png">
${FONTS_HTML}
<style>${BASE_CSS}
.who{margin-top:18px;font-size:13px;color:rgba(243,236,224,.85);line-height:1.7;}
.who b{color:#fff;font-weight:600;}
.who .attr{display:block;font-size:11.5px;color:rgba(243,236,224,.55);}
.brief{font-size:15px;line-height:1.72;color:#4a4139;margin-bottom:20px;}
.brief b{color:#241d18;font-weight:600;}
.onfile{border:1px solid rgba(176,137,59,.28);background:#f4eede;border-radius:14px;padding:18px 20px;margin-bottom:20px;}
.fname{font-family:'Fraunces',Georgia,serif;font-weight:600;font-size:17px;color:#241d18;word-break:break-word;}
.fmeta{margin-top:4px;font-size:12.5px;color:var(--muted);}
.fnote{margin-top:10px;font-size:12px;color:#8a7d70;line-height:1.6;}
.hl{margin-bottom:18px;}
.hl label{display:block;font-size:10.5px;font-weight:600;letter-spacing:1.8px;text-transform:uppercase;color:var(--muted);margin-bottom:8px;}
.hl input{width:100%;padding:13px 14px;border:1px solid rgba(43,33,25,.18);border-radius:11px;background:#fff;color:#241d18;font-size:16px;font-family:inherit;}
.hl input:focus{outline:none;border-color:var(--gold);box-shadow:0 0 0 3px rgba(176,137,59,.14);}
.share{margin-top:16px;padding:14px 16px;border:1px solid rgba(176,137,59,.34);border-radius:12px;background:#fdfbf5;}
.sharebox{display:flex;gap:10px;align-items:flex-start;cursor:pointer;font-size:14px;line-height:1.55;color:#241d18;font-weight:600;}
.sharebox input{flex:0 0 auto;width:18px;height:18px;margin-top:1px;accent-color:var(--crimson);cursor:pointer;}
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
    <p class="kicker">Building Bridges — Boston &middot; One-slide summary</p>
    <h1>Hi ${esc(first)} — your one-slide summary</h1>
    <p class="who"><b>${esc(fullName)}</b> &middot; ${esc(reg.institution || '')}<span class="attr">Files uploaded from this page are attributed to this registration.</span></p>
  </div>
</header>

<main>
  <section class="sheet" aria-label="Your one-slide summary">
    <p class="brief">One slide that introduces you to the room &mdash; ${SUMMARY_BRIEF}. <b>PDF or PowerPoint (.ppt/.pptx), up to 10 MB.</b> Deadline <b>${SLIDES_DEADLINE}</b>. If you are happy to share it, we send the summaries to all participants after the event.</p>
    ${uploader}
  </section>
</main>

${FOOTER_HTML}

<script>
(function(){
  var API='/api/boston/onepager/${token}';
  var MAX=${MAX_ONEPAGER_BYTES};
  var input=document.getElementById('fileinput');
  if(!input) return;                                    /* uploads-open-soon page has no uploader */
  var drop=document.getElementById('drop'),pick=document.getElementById('pickbtn'),
      picked=document.getElementById('picked'),pname=document.getElementById('pname'),psize=document.getElementById('psize'),
      upbtn=document.getElementById('upbtn'),errbox=document.getElementById('errbox'),
      prog=document.getElementById('prog'),bar=document.getElementById('bar'),
      hl=document.getElementById('hl_text'),share=document.getElementById('share_ok'),file=null;
  function human(n){return n>=1048576?(n/1048576).toFixed(1)+' MB':Math.max(1,Math.round(n/1024))+' KB';}
  function err(m){errbox.textContent=m;errbox.style.display='block';}
  function take(f){
    errbox.style.display='none';
    if(!f)return;
    if(!/\\.(pdf|ppt|pptx)$/i.test(f.name)){err('PDF or PowerPoint (.ppt/.pptx), please — export your slide and try again.');return;}
    if(f.size>MAX){err('That file is over the 10 MB limit ('+human(f.size)+'). One slide is all we need — export it again and try.');return;}
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
    errbox.style.display='none';upbtn.disabled=true;upbtn.textContent='Uploading\\u2026';
    prog.style.display='block';bar.style.width='0%';
    var fd=new FormData();
    if(hl&&hl.value.trim())fd.append('headline',hl.value.trim());
    fd.append('share_ok',(!share||share.checked)?'1':'0');   /* always stated, never inferred */
    fd.append('file',file,file.name);
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
        upbtn.disabled=false;upbtn.textContent='Upload my one-slide summary';prog.style.display='none';
      }
    };
    xhr.onerror=function(){err('We could not reach the server. Please check your connection and try again.');upbtn.disabled=false;upbtn.textContent='Upload my one-slide summary';prog.style.display='none';};
    xhr.send(fd);
  });
})();
</script>
</body></html>`;
}

// ---------------------------------------------------------------- THE ONE PERSONAL PAGE
// Everything a Boston guest was asked for, on one address, in the order the owner dictated:
// dietary first (the kitchen needs it from everyone), then the optional one-slide summary, then —
// for presenters only — the deck that must be on the laptop. Each step is a card that carries its
// own state, saves in place, and reads back from the server on any reload. The ticket sits at the
// bottom of every render, finished or not: it is what the guest comes back for on the day.
function mePage(reg, st, s3ok, tok, links) {
    const first = reg.first_name || 'there';
    const fullName = `${reg.first_name || ''} ${reg.last_name || ''}`.trim() || 'Med&X Guest';
    const id = String(reg.id);
    const cat = st.cat;

    const tag = (kind, text) => `<span class="tag ${kind}">${text}</span>`;
    const head = (n, doneFlag, title, tagHtml) => `
      <div class="shead">
        <span class="snum${doneFlag ? ' on' : ''}" aria-hidden="true">${doneFlag ? '&#10003;' : n}</span>
        <div class="sh"><h2>${title}</h2>${tagHtml}</div>
      </div>`;
    const linkOf = file => (file && file.external_url) ? String(file.external_url) : '';
    const onFileCard = (domId, file, extraHtml) => `
      <div class="onfile" id="${domId}"${file ? '' : ' hidden'}>
        <p class="slabel" style="margin-bottom:6px;">On file with us</p>
        <p class="fname" id="${domId}_name">${file ? esc(file.original_name) : ''}</p>
        <p class="fmeta" id="${domId}_meta">${file ? (linkOf(file) ? 'shared link &middot; saved ' : esc(prettySize(Number(file.size))) + ' &middot; uploaded ') + esc(fmtWhen(file.uploaded_at)) : ''}</p>
        <p class="fmeta" id="${domId}_link"${linkOf(file) ? '' : ' hidden'} style="word-break:break-all;"><a id="${domId}_href" href="${esc(linkOf(file))}" target="_blank" rel="noopener">${esc(linkOf(file))}</a></p>
        ${extraHtml || ''}
      </div>`;

    // ---- step 1 · the two catering questions, one tap each, saved without a reload ----
    const prefChips = PREF_KEYS.map(k =>
        `<button type="button" class="chip${cat.prefKey === k ? ' on' : ''}" data-pref="${esc(k)}">${esc(DIET_PREFS[k])}</button>`).join('');
    const allergyChips =
        `<button type="button" class="chip${cat.allergyState === 'none' ? ' on' : ''}" data-allergy="none">No allergies</button>`
        + `<button type="button" class="chip${cat.allergyState === 'yes' ? ' on' : ''}" data-allergy="yes">I have allergies</button>`;

    const step1 = `
    <section class="sheet step" id="step1" aria-label="Step 1 — dietary preferences and allergies">
      ${head(1, st.step1, 'Dietary preferences and allergies', tag('opt', 'Optional'))}
      <p class="sbody">Finger food and drinks will be served during the networking part of the evening. If you have a preference or an allergy, one tap in each row tells the kitchen &mdash; nothing to type, nothing to sign in to.</p>

      <p class="qlabel">What should we put on your plate?</p>
      <div class="chips" id="prefrow">${prefChips}</div>
      <p class="ok" id="pref_ok"${cat.prefKey ? '' : ' hidden'}>Saved &#10003; <b id="pref_val">${cat.prefLabel ? esc(cat.prefLabel) : ''}</b></p>

      <p class="qlabel">Any food allergies?</p>
      <div class="chips" id="allrow">${allergyChips}</div>
      <div class="abox" id="abox"${cat.allergyState === 'yes' ? '' : ' hidden'}>
        <label for="a_text">Tell us what to avoid</label>
        <input type="text" id="a_text" maxlength="${MAX_ALLERGY_CHARS}" placeholder="e.g. nuts, shellfish" value="${esc(cat.allergyText)}" autocomplete="off">
        <button type="button" class="save" id="a_save">Save</button>
      </div>
      <p class="ok" id="all_ok"${cat.allergyState ? '' : ' hidden'}>Saved &#10003; <b id="all_val">${cat.allergyState === 'none' ? 'no allergies' : esc(cat.allergyText)}</b></p>
      <p class="err" id="d_err"></p>
    </section>`;

    // ---- step 2 · the one-slide summary — the one genuinely optional ask ----
    const shareOn = !st.summary || st.summary.share_ok == null || Number(st.summary.share_ok) !== 0;
    const step2 = `
    <section class="sheet step" id="step2" aria-label="Step 2 — your one-slide summary">
      ${head(2, st.step2, 'One-slide summary of your work', tag('opt', 'Optional'))}
      <p class="sbody">One slide about your work: your institution and group, what you work on, and what kind of collaboration you are looking for &mdash; with your contact details. After the event we compile every summary into one document and send it to all participants.</p>
      <p class="sbody" style="margin-top:8px;"><b>Please keep it to one slide</b> &mdash; a single PowerPoint slide or a one-page PDF.</p>
      ${onFileCard('s2_file_card', st.summary, `<p class="fmeta" id="s2_share_line">${st.summary ? (shareOn ? 'Shared with all participants after the event.' : 'Kept private &mdash; only the Med&amp;X team sees it.') : ''}</p>`)}
      ${s3ok ? `
      <label class="filepick" for="s2_file">
        <span class="fpl">Choose your slide</span>
        <input type="file" id="s2_file" accept="${SUMMARY_ACCEPT_ATTR}">
      </label>
      <p class="reqs">PDF or PowerPoint (<b>.pdf &middot; .ppt &middot; .pptx</b>), one slide, up to <b>10 MB</b> &middot; by <b>${SLIDES_DEADLINE}</b>.</p>
      <label class="sharebox" for="s2_share"><input type="checkbox" id="s2_share"${shareOn ? ' checked' : ''}><span>${SUMMARY_SHARE_LABEL}</span></label>
      <button type="button" class="go" id="s2_go">${st.summary ? 'Replace my one-slide summary' : 'Upload my one-slide summary'}</button>
      <p class="ok" id="s2_ok" hidden>Saved &#10003;</p>
      <p class="err" id="s2_err"></p>` : `
      <div class="soon"><p class="slabel" style="margin-bottom:6px;">Uploads open soon</p><p class="sbody" style="margin-top:0;">This page is yours &mdash; keep the link. The upload box opens shortly and nothing else is needed from you for now.</p></div>`}
    </section>`;

    // ---- step 3 · the deck — presenters only, and required of them ----
    const step3 = st.presenter ? `
    <section class="sheet step" id="step3" aria-label="Step 3 — your presentation slides">
      ${head(3, st.step3, 'Your presentation slides', tag('req', 'Required'))}
      <p class="sbody">You are giving one of the <b>5-minute presentations</b>. Introduce your lab, clinic or department at a broad level, show one project or result, and use your <b>last slide</b> to say how you would like to collaborate. Talks run back to back from one laptop, so the deck has to be with us in advance.</p>
      ${onFileCard('s3_file_card', st.slides)}
      ${s3ok ? `
      <label class="filepick" for="s3_file">
        <span class="fpl">Choose your slides</span>
        <input type="file" id="s3_file" accept="${ACCEPT_ATTR}">
      </label>
      <p class="reqs">${SLIDES_FORMAT_LINE} &middot; by <b>${SLIDES_DEADLINE}</b>.</p>
      <button type="button" class="go" id="s3_go">${st.slides ? 'Replace my slides' : 'Upload my slides'}</button>
      <p class="ok" id="s3_ok" hidden>Saved &#10003;</p>
      <p class="err" id="s3_err"></p>` : `
      <div class="soon"><p class="slabel" style="margin-bottom:6px;">Uploads open soon</p><p class="sbody" style="margin-top:0;">This page is yours &mdash; keep the link. The upload box opens shortly.</p></div>`}
      <div class="biglink">
        <p class="qlabel">Larger than 25 MB?</p>
        <p class="reqs" style="margin-top:6px;">Upload it to Google Drive or Dropbox and paste the share link here.</p>
        <div class="linkrow">
          <input type="url" id="s3_link" inputmode="url" maxlength="${MAX_LINK_CHARS}" placeholder="https://drive.google.com/&hellip;" value="${esc(linkOf(st.slides))}" autocomplete="off">
          <button type="button" class="save" id="s3_link_save">Save link</button>
        </div>
        <p class="ok" id="s3_link_ok" hidden>Link saved &#10003;</p>
        <p class="err" id="s3_link_err"></p>
      </div>
    </section>` : st.declined ? `
    <section class="sheet" id="step3note" aria-label="About your presentation">
      <p class="slabel">About your presentation</p><div class="rule"></div>
      <p class="sbody"><b>Your seat on Monday is confirmed and we very much look forward to seeing you.</b></p>
      <p class="sbody" style="margin-top:10px;">Thank you for offering to give one of the 5-minute presentations. We received many more requests than the evening can hold, and sadly we could not accommodate your presentation this time. We are sorry about that, and we hope to have you present at one of the next editions.</p>
      <p class="sbody" style="margin-top:10px;">We would warmly encourage you to send us your <b>one-slide summary</b> (step 2 above). The summaries of everyone&rsquo;s work are compiled into one document and shared with all participants, so your work is still presented to the room &mdash; with your contact details, for anyone who wants to follow up.</p>
    </section>` : '';

    const w = links || {};
    const walletRow = [
        w.apple ? `<a class="wbtn" href="${esc(w.apple)}">Add to Apple Wallet &rarr;</a>` : '',
        w.google ? `<a class="wbtn" href="${esc(w.google)}">Add to Google Wallet &rarr;</a>` : '',
        w.calendar ? `<a class="wbtn ghost" href="${esc(w.calendar)}">Add to Calendar &rarr;</a>` : ''
    ].join('');

    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Your personal page — Building Bridges Boston · Med&amp;X</title>
<meta name="robots" content="noindex, nofollow">
<link rel="icon" type="image/png" href="/assets/favicon-x.png">
${FONTS_HTML}
<style>${BASE_CSS}
main{max-width:640px;}
.who{margin-top:16px;font-size:13px;color:rgba(243,236,224,.85);line-height:1.7;}
.who b{color:#fff;font-weight:600;}
.prog{margin-top:20px;display:inline-block;padding:9px 18px;border:1px solid rgba(176,137,59,.5);border-radius:999px;font-size:12px;font-weight:600;letter-spacing:1.6px;text-transform:uppercase;color:#f3ece0;}
.prog.allset{border-color:rgba(120,200,140,.55);background:rgba(60,140,85,.18);color:#d8f0dd;letter-spacing:.6px;text-transform:none;font-size:13.5px;}
.step{scroll-margin-top:14px;}
.shead{display:flex;gap:13px;align-items:flex-start;}
.snum{flex:0 0 auto;width:31px;height:31px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#fbf3e6;background:linear-gradient(180deg,#a03330,var(--crimson));}
.snum.on{background:linear-gradient(180deg,#3f8b57,#2f6e3a);}
.sh{flex:1 1 auto;}
.sh h2{font-family:'Fraunces',Georgia,serif;font-weight:600;font-size:clamp(19px,4.6vw,23px);line-height:1.2;letter-spacing:-.3px;color:#241d18;}
.tag{display:inline-block;margin-top:7px;padding:3px 9px;border-radius:20px;font-size:9.5px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;}
.tag.req{border:1px solid rgba(143,45,42,.35);color:#8f2d2a;background:rgba(143,45,42,.07);}
.tag.opt{border:1px solid rgba(176,137,59,.42);color:#8a6a25;background:#f6efdc;}
.sbody{margin-top:14px;font-size:14.5px;line-height:1.68;color:#4a4139;}
.sbody b{color:#241d18;font-weight:600;}
.qlabel{margin-top:20px;font-size:10.5px;font-weight:600;letter-spacing:1.8px;text-transform:uppercase;color:var(--muted);}
.chips{display:flex;flex-wrap:wrap;gap:9px;margin-top:10px;}
.chip{padding:12px 16px;border-radius:11px;border:1px solid rgba(43,33,25,.2);background:#fff;color:#3a322b;font-family:inherit;font-size:14px;font-weight:600;line-height:1.2;cursor:pointer;}
.chip:hover{border-color:var(--gold);background:#fdfbf5;}
.chip.on{background:linear-gradient(180deg,#a03330,var(--crimson));border-color:var(--crimson);color:#fbf3e6;box-shadow:0 10px 22px -14px rgba(143,45,42,.8);}
.chip:disabled{opacity:.6;cursor:progress;}
.abox{margin-top:13px;padding:15px 16px;border:1px solid rgba(176,137,59,.3);background:#f4eede;border-radius:13px;}
.abox label{display:block;font-size:10.5px;font-weight:600;letter-spacing:1.8px;text-transform:uppercase;color:var(--muted);margin-bottom:8px;}
.abox input{width:100%;padding:13px 14px;border:1px solid rgba(43,33,25,.18);border-radius:11px;background:#fff;color:#241d18;font-size:16px;font-family:inherit;}
.abox input:focus,.hl input:focus{outline:none;border-color:var(--gold);box-shadow:0 0 0 3px rgba(176,137,59,.14);}
.save{margin-top:11px;padding:12px 26px;border:none;border-radius:11px;cursor:pointer;font-family:inherit;font-size:14px;font-weight:600;color:#fbf3e6;background:linear-gradient(180deg,#a03330,var(--crimson));}
.save:disabled,.go:disabled{opacity:.55;cursor:not-allowed;}
.ok{margin-top:11px;font-size:13.5px;font-weight:600;color:#2f6e3a;line-height:1.5;}
.ok b{color:#245c2e;font-weight:700;}
.err{display:none;margin-top:12px;padding:11px 13px;border-radius:10px;background:rgba(143,45,42,.08);border:1px solid rgba(143,45,42,.3);color:#7c2320;font-size:13.5px;line-height:1.55;}
.onfile{margin-top:16px;border:1px solid rgba(176,137,59,.28);background:#f4eede;border-radius:14px;padding:15px 17px;}
.fname{font-family:'Fraunces',Georgia,serif;font-weight:600;font-size:16px;color:#241d18;word-break:break-word;}
.fmeta{margin-top:4px;font-size:12.5px;color:var(--muted);}
.hl{margin-top:16px;}
.hl label{display:block;font-size:10.5px;font-weight:600;letter-spacing:1.8px;text-transform:uppercase;color:var(--muted);margin-bottom:8px;}
.hl .lc{text-transform:none;letter-spacing:.2px;font-weight:500;color:#a89a86;}
.hl input{width:100%;padding:13px 14px;border:1px solid rgba(43,33,25,.18);border-radius:11px;background:#fff;color:#241d18;font-size:16px;font-family:inherit;}
.filepick{display:block;margin-top:16px;padding:16px 17px;border:1.5px dashed rgba(176,137,59,.55);border-radius:14px;background:#fdfbf5;cursor:pointer;}
.filepick .fpl{display:block;font-family:'Fraunces',Georgia,serif;font-size:15.5px;color:#3a322b;margin-bottom:10px;}
.filepick input[type=file]{width:100%;font-family:inherit;font-size:13.5px;color:#4a4139;}
.filepick input[type=file]::file-selector-button{margin-right:12px;padding:10px 16px;border-radius:9px;border:1px solid rgba(43,33,25,.22);background:#fff;font-family:inherit;font-size:13px;font-weight:600;color:#4a3f36;cursor:pointer;}
.reqs{margin-top:11px;font-size:12px;color:var(--muted);line-height:1.6;}
.reqs b{color:#4a4139;font-weight:600;}
.sharebox{display:flex;gap:10px;align-items:flex-start;margin-top:15px;padding:14px 15px;border:1px solid rgba(176,137,59,.34);border-radius:12px;background:#fdfbf5;cursor:pointer;font-size:13.5px;line-height:1.55;color:#241d18;font-weight:600;}
.sharebox input{flex:0 0 auto;width:18px;height:18px;margin-top:1px;accent-color:var(--crimson);cursor:pointer;}
.go{display:block;width:100%;margin-top:16px;padding:15px;border:none;border-radius:12px;cursor:pointer;font-family:inherit;font-size:15px;font-weight:600;color:#fbf3e6;background:linear-gradient(180deg,#a03330,var(--crimson));box-shadow:0 12px 26px -14px rgba(143,45,42,.7);}
.soon{margin-top:16px;border:1px solid rgba(176,137,59,.28);background:#f4eede;border-radius:14px;padding:16px 18px;}
.tickwrap{text-align:center;}
.qr{display:inline-block;background:#fff;border:1px solid rgba(43,33,25,.12);border-radius:12px;padding:10px;}
.qr img{display:block;width:150px;height:150px;border:0;}
.tmeta{margin-top:10px;font-size:10px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);line-height:1.7;}
.thint{margin-top:5px;font-size:12px;color:#8a7d70;}
.wbtn{display:block;margin:10px auto 0;max-width:280px;padding:12px 18px;border-radius:11px;background:#241d18;color:#f7f1e6;font-size:12.5px;font-weight:600;letter-spacing:.4px;text-decoration:none;}
.wbtn.ghost{background:transparent;border:1px solid rgba(43,33,25,.3);color:#3a322b;}
.evline{margin-top:20px;padding-top:15px;border-top:1px solid rgba(43,33,25,.1);font-size:12.5px;line-height:1.7;color:#8a7d70;text-align:center;}
.bail{margin:22px 4px 0;text-align:center;font-size:12.5px;line-height:1.7;color:#8a7d70;}
.bail a{color:var(--crimson);font-weight:600;text-decoration:underline;}
/* the Boston skyline behind the greeting — the same photo the registration page opens on */
.miniband.skyline{position:relative;overflow:hidden;}
.miniband.skyline .bg{position:absolute;inset:0;background:url('/boston/hero.jpg') center 32%/cover no-repeat;opacity:.6;}
.miniband.skyline .veil{position:absolute;inset:0;background:linear-gradient(180deg,rgba(27,22,19,.6) 0%,rgba(27,22,19,.42) 40%,rgba(27,22,19,.93) 88%,#1b1613 100%);}
.miniband.skyline .inner{position:relative;}
.biglink{margin-top:18px;padding-top:16px;border-top:1px solid rgba(43,33,25,.1);}
.linkrow{display:flex;gap:9px;margin-top:10px;}
.linkrow input{flex:1 1 auto;min-width:0;padding:13px 14px;border:1px solid rgba(43,33,25,.18);border-radius:11px;background:#fff;color:#241d18;font-size:15px;font-family:inherit;}
.linkrow input:focus{outline:none;border-color:var(--gold);box-shadow:0 0 0 3px rgba(176,137,59,.14);}
.linkrow .save{margin-top:0;flex:0 0 auto;white-space:nowrap;}
@media(max-width:430px){.chip{flex:1 1 auto;text-align:center;}.linkrow{flex-direction:column;}}
</style></head><body>

<header class="miniband skyline"><div class="bg" aria-hidden="true"></div><div class="veil" aria-hidden="true"></div><div class="inner">
  <div class="orgs">
    <img class="medx" src="${LOGO_URL}" alt="Med&amp;X">
    <span class="x">&times;</span>
    <span class="hmpa"><img src="/boston/hmpa.png" alt="Harvard Medical Postdoc Association"></span>
  </div>
  <p class="kicker">Building Bridges — Boston &middot; Your personal page</p>
  <h1>Hi ${esc(first)}!</h1>
  <p class="who"><b>${esc(fullName)}</b>${reg.institution ? ' &middot; ' + esc(reg.institution) : ''}</p>
  <p class="prog${st.allDone ? ' allset' : ''}" id="prog"
     data-total="${st.total}" data-presenter="${st.presenter ? 1 : 0}"
     data-s1="${st.step1 ? 1 : 0}" data-s2="${st.step2 ? 1 : 0}" data-s3="${st.step3 ? 1 : 0}">${st.allDone
        ? 'All set &mdash; see you on Monday.'
        : `<b>${st.done}</b> of ${st.total} done`}</p>
</div></header>

<main>
  ${step1}
  ${step2}
  ${step3}

  <section class="sheet" aria-label="Your ticket">
    <p class="slabel">Your ticket for the door</p><div class="rule"></div>
    <div class="tickwrap">
      <span class="qr"><img src="/api/boston/qr/${esc(id)}.png" alt="Your entry QR code" width="150" height="150"></span>
      <p class="tmeta">${esc(fullName)} &middot; N&deg; ${esc(ticketNo(id))} &middot; show at the door</p>
      <p class="thint">Save it to your photos, or add it to your phone below.</p>
      ${walletRow}
    </div>
    <p class="evline">${esc(DATE_LONG)} &middot; 6:00&ndash;9:00 PM (doors 5:30 PM)<br>${esc(VENUE_FULL)} &middot; ${esc(DRESS)}</p>
  </section>

  <p class="bail">Unable to attend? <a href="/boston/rsvp/${encodeURIComponent(tok.diet)}/${CANNOT_ATTEND}">Cancel your participation</a> &mdash; your seat goes to someone on the waiting list.</p>
</main>

${FOOTER_HTML}

<script>
(function(){
  var ME='/api/boston/me/${tok.me}';
  var ALLERGIES='/api/boston/rsvp/${tok.diet}/allergies';
  var $=function(id){return document.getElementById(id);};
  var prog=$('prog');

  /* The progress line is recomputed from the same three facts the server rendered it from, so a
     save in place and a reload always agree. */
  function mark(step,on){prog.setAttribute('data-s'+step,on?'1':'0');
    var card=$('step'+step);if(card){var n=card.querySelector('.snum');if(n&&on){n.classList.add('on');n.innerHTML='&#10003;';}}
    render();}
  function render(){
    var pres=prog.getAttribute('data-presenter')==='1',total=Number(prog.getAttribute('data-total'));
    var s1=prog.getAttribute('data-s1')==='1',s2=prog.getAttribute('data-s2')==='1',s3=prog.getAttribute('data-s3')==='1';
    var done=(s1?1:0)+(s2?1:0)+(pres&&s3?1:0);
    /* only the required step (a presenter's slides) gates "all set" — the rest is optional */
    if(!pres||s3){prog.classList.add('allset');prog.innerHTML='All set &mdash; see you on Monday.';}
    else{prog.classList.remove('allset');prog.innerHTML='<b>'+done+'</b> of '+total+' done';}
  }
  function show(el,m){if(!el)return;el.textContent=m;el.style.display='block';}
  function hide(el){if(el)el.style.display='none';}
  function post(url,body){
    return fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
      .then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j||{}};},function(){return{ok:false,j:{}};});});
  }
  function upload(url,fd){
    return fetch(url,{method:'POST',body:fd})
      .then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j||{}};},function(){return{ok:false,j:{}};});});
  }
  function human(n){return n>=1048576?(n/1048576).toFixed(1)+' MB':Math.max(1,Math.round(n/1024))+' KB';}

  /* ---- step 1 · preference row ---- */
  var derr=$('d_err');
  var prefRow=$('prefrow');
  if(prefRow) prefRow.addEventListener('click',function(e){
    var b=e.target.closest('button[data-pref]');if(!b)return;
    hide(derr);
    var all=prefRow.querySelectorAll('.chip');
    for(var i=0;i<all.length;i++)all[i].disabled=true;
    post(ME+'/diet',{pref:b.getAttribute('data-pref')}).then(function(res){
      for(var i=0;i<all.length;i++)all[i].disabled=false;
      if(res.ok&&res.j.success){
        for(var k=0;k<all.length;k++)all[k].classList.remove('on');
        b.classList.add('on');
        $('pref_val').textContent=res.j.label||'';
        $('pref_ok').removeAttribute('hidden');
        if($('all_ok')&&!$('all_ok').hasAttribute('hidden'))mark(1,true);
      }else show(derr,res.j.error||'We could not save that. Please try again.');
    },function(){for(var i=0;i<all.length;i++)all[i].disabled=false;show(derr,'We could not reach the server. Please try again.');});
  });

  /* ---- step 1 · allergy row (the existing allergies route, reused as-is) ---- */
  var allRow=$('allrow'),abox=$('abox'),atext=$('a_text'),asave=$('a_save');
  function allergySaved(label){
    $('all_val').textContent=label;$('all_ok').removeAttribute('hidden');
    if($('pref_ok')&&!$('pref_ok').hasAttribute('hidden'))mark(1,true);
  }
  if(allRow) allRow.addEventListener('click',function(e){
    var b=e.target.closest('button[data-allergy]');if(!b)return;
    hide(derr);
    var which=b.getAttribute('data-allergy'),all=allRow.querySelectorAll('.chip');
    for(var k=0;k<all.length;k++)all[k].classList.remove('on');
    b.classList.add('on');
    if(which==='yes'){
      abox.removeAttribute('hidden');$('all_ok').setAttribute('hidden','');
      try{atext.focus();}catch(err){}
      return;
    }
    abox.setAttribute('hidden','');
    for(var i=0;i<all.length;i++)all[i].disabled=true;
    /* "no allergies" is the same stored answer the one-tap email link writes */
    post(ALLERGIES,{text:'none'}).then(function(res){
      for(var i=0;i<all.length;i++)all[i].disabled=false;
      if(res.ok&&res.j.success)allergySaved('no allergies');
      else show(derr,res.j.error||'We could not save that. Please try again.');
    },function(){for(var i=0;i<all.length;i++)all[i].disabled=false;show(derr,'We could not reach the server. Please try again.');});
  });
  function saveAllergies(){
    var t=(atext.value||'').trim();
    hide(derr);
    if(!t){show(derr,'Tell us what to avoid \\u2014 or tap \\u201CNo allergies\\u201D.');return;}
    asave.disabled=true;asave.textContent='Saving…';
    post(ALLERGIES,{text:t}).then(function(res){
      asave.disabled=false;asave.textContent='Save';
      if(res.ok&&res.j.success)allergySaved(res.j.allergies||t);
      else show(derr,res.j.error||'We could not save that. Please try again.');
    },function(){asave.disabled=false;asave.textContent='Save';show(derr,'We could not reach the server. Please try again.');});
  }
  if(asave){asave.addEventListener('click',saveAllergies);
    atext.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();saveAllergies();}});}

  /* ---- a step-2 / step-3 uploader, built once ---- */
  function wireUpload(o){
    var input=$(o.input),go=$(o.go),errb=$(o.err),okb=$(o.ok),card=$(o.card);
    if(!input||!go)return;
    go.addEventListener('click',function(){
      hide(errb);okb.setAttribute('hidden','');
      var f=input.files&&input.files[0];
      if(!f){show(errb,o.pick);return;}
      if(!o.re.test(f.name)){show(errb,o.wrongType);return;}
      if(f.size>o.max){show(errb,o.tooBig+' ('+human(f.size)+').');return;}
      var label=go.textContent;
      go.disabled=true;go.textContent='Uploading…';
      var fd=new FormData();
      if(o.extra)o.extra(fd);
      fd.append('file',f,f.name);
      upload(ME+o.path,fd).then(function(res){
        go.disabled=false;
        if(res.ok&&res.j.success){
          go.textContent=o.replaceLabel;
          okb.removeAttribute('hidden');
          card.removeAttribute('hidden');
          $(o.card+'_name').textContent=res.j.filename||f.name;
          $(o.card+'_meta').textContent=human(res.j.size||f.size)+' · just now';
          if(o.after)o.after(res.j);
          input.value='';
          mark(o.step,true);
        }else{go.textContent=label;show(errb,res.j.error||'The upload did not go through. Please try again.');}
      },function(){go.disabled=false;go.textContent=label;show(errb,'We could not reach the server. Please try again.');});
    });
  }
  wireUpload({step:2,input:'s2_file',go:'s2_go',err:'s2_err',ok:'s2_ok',card:'s2_file_card',path:'/summary',
    re:/\\.(pdf|ppt|pptx)$/i,max:${MAX_ONEPAGER_BYTES},
    pick:'Choose your slide first \\u2014 a PDF or a PowerPoint, up to 10 MB.',
    wrongType:'PDF or PowerPoint (.ppt/.pptx), please \\u2014 export your slide and try again.',
    tooBig:'That file is over the 10 MB limit',
    replaceLabel:'Replace my one-slide summary',
    extra:function(fd){var s=$('s2_share');
      fd.append('share_ok',(!s||s.checked)?'1':'0');},
    after:function(j){var l=$('s2_share_line');
      if(l)l.innerHTML=j.share_ok?'Shared with all participants after the event.':'Kept private &mdash; only the Med&amp;X team sees it.';}
  });
  wireUpload({step:3,input:'s3_file',go:'s3_go',err:'s3_err',ok:'s3_ok',card:'s3_file_card',path:'/slides',
    re:/\\.(pdf|ppt|pptx|key)$/i,max:${MAX_UPLOAD_BYTES},
    pick:'Choose your slides first \\u2014 .pdf, .ppt, .pptx or .key, up to 25 MB.',
    wrongType:'That file type is not accepted \\u2014 please choose a .pdf, .ppt, .pptx or .key file.',
    tooBig:'That file is over the 25 MB limit (use the share link below instead)',
    replaceLabel:'Replace my slides',
    after:function(){var l=$('s3_file_card_link');if(l)l.setAttribute('hidden','');}
  });

  /* ---- step 3 · the over-25 MB lane: a Drive / Dropbox share link, saved as the deck ---- */
  var linkIn=$('s3_link'),linkSave=$('s3_link_save'),linkErr=$('s3_link_err'),linkOk=$('s3_link_ok');
  function saveLink(){
    var v=(linkIn.value||'').trim();
    hide(linkErr);linkOk.setAttribute('hidden','');
    if(!v){show(linkErr,'Paste the share link first \\u2014 it should start with https://');return;}
    if(!/^https?:\\/\\//i.test(v)){show(linkErr,'Please paste the full link, starting with https://');return;}
    linkSave.disabled=true;linkSave.textContent='Saving…';
    post(ME+'/slides-link',{url:v}).then(function(res){
      linkSave.disabled=false;linkSave.textContent='Save link';
      if(res.ok&&res.j.success){
        linkOk.removeAttribute('hidden');
        var card=$('s3_file_card');if(card)card.removeAttribute('hidden');
        if($('s3_file_card_name'))$('s3_file_card_name').textContent=res.j.filename||'Link';
        if($('s3_file_card_meta'))$('s3_file_card_meta').textContent='shared link · saved just now';
        var l=$('s3_file_card_link'),a=$('s3_file_card_href');
        if(a){a.href=res.j.external_url||v;a.textContent=res.j.external_url||v;}
        if(l)l.removeAttribute('hidden');
        var go=$('s3_go');if(go)go.textContent='Replace my slides';
        mark(3,true);
      }else show(linkErr,res.j.error||'We could not save that link. Please try again.');
    },function(){linkSave.disabled=false;linkSave.textContent='Save link';show(linkErr,'We could not reach the server. Please try again.');});
  }
  if(linkSave){linkSave.addEventListener('click',saveLink);
    linkIn.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();saveLink();}});}

  /* An email button lands on #step1/#step2/#step3 — bring it into view under the header. */
  if(window.location.hash){var t=$(window.location.hash.slice(1));
    if(t)setTimeout(function(){t.scrollIntoView({behavior:'smooth',block:'start'});},80);}
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
// ---------------------------------------------------------------- one-tap catering page
// What the guest lands on after tapping an answer in the reminder email: their first name, the
// answer just recorded, and the OTHER question still answerable right there — so preference plus
// allergies is two taps in total. Built for a phone first.
function rsvpPage(reg, token, answer) {
    const st = cateringStateOf(reg);
    const first = reg.first_name || 'there';
    const url = a => `/boston/rsvp/${encodeURIComponent(token)}/${a}`;
    const showBox = answer === ALLERGY_TELL || st.allergyState === 'yes';

    const headline = answer === ALLERGY_TELL
        ? 'What should we keep away from you?'
        : st.prefKey && DIET_PREFS[answer]
            ? `Noted &mdash; ${esc(DIET_PREFS[answer].toLowerCase())}.`
            : answer === ALLERGY_NONE
                ? 'Noted &mdash; no allergies.'
                : st.prefKey || st.allergyState
                    ? 'Here is what we have.'
                    : 'Two quick questions.';
    const lede = st.prefKey && st.allergyState
        ? 'That is everything the caterer needs &mdash; thank you. Tap anything below if it changes.'
        : st.prefKey
            ? 'One left: any food allergies?'
            : st.allergyState
                ? 'One left: what should we put on your plate?'
                : 'One tap each. Nothing to fill in, nothing to sign in to.';

    const chip = (label, href, chosen) => `<a class="chip${chosen ? ' on' : ''}" href="${esc(href)}">${chosen ? '<b>&#10003;</b> ' : ''}${label}</a>`;
    const prefChips = PREF_KEYS.map(k => chip(esc(DIET_PREFS[k]), url(k), st.prefKey === k)).join('');
    const allergyChips = chip('No allergies', url(ALLERGY_NONE), st.allergyState === 'none')
        + chip('I have allergies', url(ALLERGY_TELL), st.allergyState === 'yes');

    const box = `
      <div class="abox" id="abox"${showBox ? '' : ' hidden'}>
        <label for="a_text">Tell us what to avoid</label>
        <input type="text" id="a_text" maxlength="${MAX_ALLERGY_CHARS}" placeholder="e.g. nuts, shellfish" value="${esc(st.allergyText)}" autocomplete="off">
        <button type="button" class="save" id="a_save">Save</button>
        <p class="aerr" id="a_err"></p>
        <p class="aok" id="a_ok"${st.allergyState === 'yes' ? '' : ' hidden'}>Saved &mdash; <b id="a_val">${esc(st.allergyText)}</b>. The kitchen has it.</p>
      </div>`;

    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Two quick questions — Building Bridges Boston · Med&amp;X</title>
<meta name="robots" content="noindex, nofollow">
<link rel="icon" type="image/png" href="/assets/favicon-x.png">
${FONTS_HTML}
<style>${BASE_CSS}
main{max-width:600px;}
.headline{font-family:'Fraunces',Georgia,serif;font-weight:600;font-size:clamp(24px,5.8vw,32px);line-height:1.14;letter-spacing:-.4px;color:#241d18;margin:2px 0 10px;}
.lede{font-size:14.5px;line-height:1.7;color:#4a4139;}
.qlabel{margin-top:24px;font-size:10.5px;font-weight:600;letter-spacing:1.8px;text-transform:uppercase;color:var(--muted);}
.chips{display:flex;flex-wrap:wrap;gap:9px;margin-top:11px;}
.chip{display:inline-block;padding:12px 16px;border-radius:11px;border:1px solid rgba(43,33,25,.2);background:#fff;color:#3a322b;font-size:14px;font-weight:600;text-decoration:none;line-height:1.2;}
.chip:hover{border-color:var(--gold);background:#fdfbf5;}
.chip.on{background:linear-gradient(180deg,#a03330,var(--crimson));border-color:var(--crimson);color:#fbf3e6;box-shadow:0 10px 22px -14px rgba(143,45,42,.8);}
.chip.on b{font-weight:700;}
.abox{margin-top:14px;padding:16px 17px;border:1px solid rgba(176,137,59,.3);background:#f4eede;border-radius:13px;}
.abox label{display:block;font-size:10.5px;font-weight:600;letter-spacing:1.8px;text-transform:uppercase;color:var(--muted);margin-bottom:8px;}
.abox input{width:100%;padding:13px 14px;border:1px solid rgba(43,33,25,.18);border-radius:11px;background:#fff;color:#241d18;font-size:16px;font-family:inherit;}
.abox input:focus{outline:none;border-color:var(--gold);box-shadow:0 0 0 3px rgba(176,137,59,.14);}
.save{margin-top:11px;padding:13px 28px;border:none;border-radius:11px;cursor:pointer;font-family:inherit;font-size:14px;font-weight:600;color:#fbf3e6;background:linear-gradient(180deg,#a03330,var(--crimson));}
.save:disabled{opacity:.55;cursor:not-allowed;}
.aerr{display:none;margin-top:10px;font-size:13px;color:#7c2320;line-height:1.5;}
.aok{margin-top:10px;font-size:13px;color:#2f6e3a;line-height:1.5;}
.aok b{color:#245c2e;}
.sofar{margin-top:22px;padding-top:15px;border-top:1px solid rgba(43,33,25,.1);font-size:13px;line-height:1.75;color:var(--muted);}
.sofar b{color:#2c2521;}
.sofar a{color:var(--crimson);font-weight:600;text-decoration:none;}
.evline{margin-top:14px;font-size:12.5px;line-height:1.7;color:#8a7d70;}
@media(max-width:430px){.chip{flex:1 1 auto;text-align:center;}}
</style></head><body>

<header class="miniband"><div class="inner">
  <div class="orgs">
    <img class="medx" src="${LOGO_URL}" alt="Med&amp;X">
    <span class="x">&times;</span>
    <span class="hmpa"><img src="/boston/hmpa.png" alt="Harvard Medical Postdoc Association"></span>
  </div>
  <p class="kicker">Building Bridges — Boston &middot; Catering</p>
  <h1>Hi ${esc(first)}</h1>
</div></header>

<main>
  <section class="sheet" aria-label="Your catering answers">
    <p class="headline">${headline}</p>
    <p class="lede">${lede}</p>

    <p class="qlabel">1 &middot; What should we put on your plate?</p>
    <div class="chips">${prefChips}</div>

    <p class="qlabel">2 &middot; Any food allergies?</p>
    <div class="chips">${allergyChips}</div>
    ${box}

    <p class="sofar">So far: <b>${st.prefLabel ? esc(st.prefLabel) : 'preference not set'}</b> &middot; <b>${st.allergyState === 'none' ? 'no allergies' : st.allergyState === 'yes' ? esc(st.allergyText) : 'allergies not set'}</b> &mdash; <a href="${esc(url(RSVP_OPEN))}">change</a></p>
    <p class="evline">${esc(DATE_LONG)} &middot; 6:00&ndash;9:00 PM (doors 5:30 PM) &middot; ${esc(VENUE_FULL)} &middot; ${esc(DRESS)}</p>
  </section>
</main>

${FOOTER_HTML}

<script>
(function(){
  var API='/api/boston/rsvp/${token}/allergies';
  var box=document.getElementById('abox');
  if(!box) return;
  var input=document.getElementById('a_text'),btn=document.getElementById('a_save'),
      err=document.getElementById('a_err'),ok=document.getElementById('a_ok'),val=document.getElementById('a_val');
  if(!box.hasAttribute('hidden')&&input&&!input.value) setTimeout(function(){try{input.focus();}catch(e){}},60);
  function save(){
    var t=(input.value||'').trim();
    err.style.display='none';
    if(!t){err.textContent='Tell us what to avoid — or tap “No allergies” above.';err.style.display='block';return;}
    btn.disabled=true;btn.textContent='Saving…';
    fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:t})})
      .then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j};});})
      .then(function(res){
        btn.disabled=false;btn.textContent='Save';
        if(res.ok&&res.j.success){val.textContent=res.j.allergies;ok.removeAttribute('hidden');}
        else{err.textContent=(res.j&&res.j.error)||'We could not save that. Please try again.';err.style.display='block';}
      })
      .catch(function(){btn.disabled=false;btn.textContent='Save';err.textContent='We could not reach the server. Please try again.';err.style.display='block';});
  }
  btn.addEventListener('click',save);
  input.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();save();}});
})();
</script>
</body></html>`;
}
// ---------------------------------------------------------------- "I can't make it" — confirm, then done
// TWO states in one page, because they are the same address: before, a single button that releases
// the seat; after, the receipt. The GET never writes — a mail scanner, a link preview or a
// prefetching inbox must not be able to cancel a guest — so the button posts, and the same page
// re-rendered later (or on a second tap of the email link) simply opens in the released state.
function cannotAttendPage(reg, token) {
    const first = reg.first_name || 'there';
    const released = String(reg.status || '').toLowerCase() === 'cancelled';
    const when = released ? releasedOn(reg) : '';
    const back = `/boston/rsvp/${encodeURIComponent(token)}/${RSVP_OPEN}`;
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Can you still join us? — Building Bridges Boston · Med&amp;X</title>
<meta name="robots" content="noindex, nofollow">
<link rel="icon" type="image/png" href="/assets/favicon-x.png">
${FONTS_HTML}
<style>${BASE_CSS}
main{max-width:600px;}
.headline{font-family:'Fraunces',Georgia,serif;font-weight:600;font-size:clamp(24px,5.8vw,32px);line-height:1.14;letter-spacing:-.4px;color:#241d18;margin:2px 0 12px;}
.lede{font-size:14.5px;line-height:1.72;color:#4a4139;}
.lede a{color:var(--crimson);font-weight:600;text-decoration:none;}
.go{margin-top:22px;padding:15px 30px;border:none;border-radius:12px;cursor:pointer;font-family:inherit;font-size:15px;font-weight:600;color:#fbf3e6;
  background:linear-gradient(180deg,#a03330,var(--crimson));box-shadow:0 12px 26px -14px rgba(143,45,42,.7);}
.go:disabled{opacity:.55;cursor:not-allowed;}
.keep{display:block;margin-top:16px;font-size:13.5px;color:var(--muted);text-decoration:none;}
.keep b{color:var(--crimson);font-weight:600;}
.cerr{display:none;margin-top:12px;font-size:13px;color:#7c2320;line-height:1.55;}
.evline{margin-top:22px;padding-top:15px;border-top:1px solid rgba(43,33,25,.1);font-size:12.5px;line-height:1.7;color:#8a7d70;}
</style></head><body>

<header class="miniband"><div class="inner">
  <div class="orgs">
    <img class="medx" src="${LOGO_URL}" alt="Med&amp;X">
    <span class="x">&times;</span>
    <span class="hmpa"><img src="/boston/hmpa.png" alt="Harvard Medical Postdoc Association"></span>
  </div>
  <p class="kicker">Building Bridges — Boston</p>
  <h1>Hi ${esc(first)}</h1>
</div></header>

<main>
  <section class="sheet" aria-label="Release your seat">
    <div id="ask"${released ? ' hidden' : ''}>
      <p class="headline">Sorry you can&rsquo;t join us, ${esc(first)}.</p>
      <p class="lede">Confirm below and we&rsquo;ll release your seat. The room holds sixty, so somebody on the list can take it.</p>
      <button type="button" class="go" id="c_go">Cancel my participation</button>
      <p class="cerr" id="c_err"></p>
      <a class="keep" href="${esc(back)}"><b>Keep my seat</b></a>
    </div>
    <div id="done"${released ? '' : ' hidden'}>
      <p class="headline">Seat released &mdash; thank you for telling us.</p>
      <p class="lede">If plans change, write to <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.${when ? ` <span style="color:#8a7d70;">Released on ${esc(when)}.</span>` : ''}</p>
    </div>
    <p class="evline">${esc(DATE_LONG)} &middot; 6:00&ndash;9:00 PM (doors 5:30 PM) &middot; ${esc(VENUE_FULL)}</p>
  </section>
</main>

${FOOTER_HTML}

<script>
(function(){
  var API='/api/boston/rsvp/${token}/cannot-attend';
  var go=document.getElementById('c_go'),err=document.getElementById('c_err'),
      ask=document.getElementById('ask'),done=document.getElementById('done');
  if(!go) return;
  go.addEventListener('click',function(){
    err.style.display='none';go.disabled=true;go.textContent='One moment…';
    fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})
      .then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j};});})
      .then(function(res){
        if(res.ok&&res.j.success){ask.setAttribute('hidden','');done.removeAttribute('hidden');window.scrollTo(0,0);}
        else{go.disabled=false;go.textContent='Cancel my participation';err.textContent=(res.j&&res.j.error)||'We could not record that. Please try again.';err.style.display='block';}
      })
      .catch(function(){go.disabled=false;go.textContent='Cancel my participation';err.textContent='We could not reach the server. Please try again.';err.style.display='block';});
  });
})();
</script>
</body></html>`;
}

// ---------------------------------------------------------------- the released-seat notice
// What every OTHER personal link shows once the seat is gone: the links still resolve (they are in
// an email somebody may open next week), they just carry a small notice instead of a form.
function releasedPage(reg) {
    return simplePage('Your seat was released', 'Your seat was released.',
        `${RELEASED_LINE_HTML(releasedOn(reg))} Write to Laura Rodman (<a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>) and we will put you back on the list.`);
}

// One line to the two people who run the room. Same dark house shell as every other FYI.
function releasedFyiHtml(who, institution, registeredNow) {
    const T = emailTemplates.T;
    const body = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:32px 40px 30px;">
      <div style="font-family:${T.sans};font-weight:600;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#d7b56c;">For your information</div>
      <div style="font-family:${T.serif};font-weight:500;font-size:26px;line-height:1.2;color:#f2e7d6;margin-top:10px;">Seat released</div>
      <div style="font-family:${T.sans};font-size:14px;line-height:1.7;color:#d3c5b2;margin-top:14px;"><b style="color:#f2e7d6;">${esc(who)}</b>${institution ? ` (${esc(institution)})` : ''} can&rsquo;t attend Boston &mdash; seat released. <b style="color:#f2e7d6;">${registeredNow}</b> registered now.</div>
    </td></tr></table>`;
    return emailTemplates.shell({
        tone: 'dark',
        title: 'Seat released — Building Bridges Boston',
        preheader: `${who} can’t attend — ${registeredNow} registered now.`,
        headerRightLabel: 'BUILDING BRIDGES · BOSTON',
        rule: 'gold',
        bodyHtml: body,
        footerItems: [`© Med&amp;X ${new Date().getFullYear()} · Split, Croatia`, 'Sent only to the Boston team']
    });
}

function rsvpNotFoundPage() {
    return simplePage('This link is not quite right', 'This link is not quite right.',
        `The link you opened is incomplete or has been mistyped &mdash; links are personal, so every character matters. Please open the exact link from your reminder email (copy &amp; paste is safest). If it still does not work, write to Laura Rodman (<a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>) and we will note your answers by hand.`);
}

function uploadNotFoundPage() {
    return simplePage('This link is not quite right', 'This link is not quite right.',
        `The upload link you opened is incomplete or has been mistyped — links are personal, so every character matters. Please open the exact link you were sent (copy &amp; paste is safest). If it still does not work, write to Laura Rodman (<a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>) and we will sort it out.`);
}

function meNotFoundPage() {
    return simplePage('This link is not quite right', 'This link is not quite right.',
        `The link you opened is incomplete or has been mistyped &mdash; your page is personal, so every character matters. Please open the exact link from your Boston email (copy &amp; paste is safest). If it still does not work, write to Laura Rodman (<a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>) and we will take your answers by hand.`);
}

function onepagerNotFoundPage() {
    return simplePage('This link is not quite right', 'This link is not quite right.',
        `The link you opened is incomplete or has been mistyped — links are personal, so every character matters. Please open the exact link from your Boston email (copy &amp; paste is safest). If it still does not work, write to Laura Rodman (<a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>) and we will add your page by hand.`);
}

// ---------------------------------------------------------------- team page
function adminPage(data, key) {
    const rowsHtml = data.rows.map(r => {
        const chips = (r.requested ? '<span class="chip">requested</span>' : '')
            + (r.upload ? '<span class="chip ok">uploaded</span>' : '');
        const status = r.upload
            ? (r.upload.external_url
                ? `<p class="fname">${esc(r.upload.filename)}</p>
               <p class="fmeta">shared link &middot; ${esc(fmtWhen(r.upload.uploaded_at))}${r.upload.versions > 1 ? ' &middot; v' + r.upload.versions : ''}</p>
               <p class="fmeta" style="word-break:break-all;">${esc(r.upload.external_url)}</p>
               <a class="dl" href="${esc(r.upload.external_url)}" target="_blank" rel="noopener">Open link &nearr;</a>`
                : `<p class="fname">${esc(r.upload.filename)}</p>
               <p class="fmeta">${esc(prettySize(r.upload.size))} &middot; ${esc(fmtWhen(r.upload.uploaded_at))}${r.upload.versions > 1 ? ' &middot; v' + r.upload.versions : ''}</p>
               <a class="dl" href="${esc(r.upload.download_url)}">Download &darr;</a>`)
            : `<p class="notyet">not yet</p>`;
        return `<div class="prow">
      <div class="who"><b>${esc(r.name)}</b>${chips}<span>${esc(r.institution)}</span><span class="em">${esc(r.email)}</span></div>
      <div class="stat">${status}</div>
      <div class="linkrow">
        <input readonly value="${esc(r.me_url || r.upload_url)}" aria-label="Personal page link for ${esc(r.name)}">
        <button type="button" class="copy" data-link="${esc(r.me_url || r.upload_url)}">Copy link</button>
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
  ${data.uploaded ? `<p style="margin:12px 0 0;"><a href="/api/boston/presentations.zip?key=${esc(key)}" style="display:inline-block;background:#9b1b22;color:#f7f1e6;padding:11px 20px;font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;text-decoration:none;">Download all presentations (ZIP)</a></p>` : ''}
  ${data.s3_configured ? '' : '<p class="warn">S3 is not configured yet — links can be shared, uploads start working the moment BB_S3_* is set.</p>'}
</div></header>
<main>
  <section class="sheet" aria-label="Presenters">
    <p class="slabel">Who requested &middot; who uploaded</p><div class="rule"></div>
    ${rowsHtml || '<p class="notyet" style="padding:10px 0;">No presentation requests yet.</p>'}
    <p class="jsonhint">Personal links are emailed only on the team's explicit go (POST /api/boston/presenters/send-links?key=… with {"to":"preview"|"all"|"&lt;id&gt;"}); rows marked UPLOAD-LINK-SENT in notes have been invited.
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
