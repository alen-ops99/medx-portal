/**
 * v2/attendance-cards.js — auto-generated branded attendance cards (member-portal redesign,
 * README product rule: no "Share your Med&X" section — on registration, and payment where it
 * applies, the system generates a branded "I'm attending …" card and EMAILS it; same idea for
 * the year-in-review card). Mounted by v2/index.js.
 *
 * Table (owned here): v2_attendance_cards
 *   id · user_id · kind ('plexus'|'gala'|'bridges'|'forum'|'year') · registration_ref (UNIQUE
 *   with kind) · image_path (uploads/cards/<id>.svg) · png_path (when a raster renderer is in
 *   deps) · event_name · email_to · generated_at · emailed_at · email_attempts · last_error
 *
 * Sweep: 30 s after boot, then every 5 minutes — finds confirmed (and paid, where payment
 * applies) registrations across registrations / gala_registrations / bridges_registrations /
 * forum_event_registrations for events that are not in the past, renders a 1200×630 ink SVG
 * (embedded wordmark + mark-X, Fraunces/Inter with system fallbacks), stores it under
 * uploads/cards/ (served by the existing /uploads static route) and emails it with the
 * attendanceCard template. Idempotent (UNIQUE kind+ref), never throws out of the interval,
 * logs counts. Failed emails retry on later sweeps (max 5 attempts).
 *
 * Routes:
 *   GET  /api/v2/attendance-cards/mine            auth — the member's cards for the wallet
 *   GET  /api/v2/attendance-cards/:id/image       public (unguessable uuid, same model as
 *                                                 /qr/:id.png) — inline SVG/PNG view
 *   POST /api/v2/attendance-cards/sweep           adminOnly — run the sweep now (ops/tests)
 *   POST /api/v2/attendance-cards/year-in-review  adminOnly — generate + email the year card
 *                                                 for all active members ({ year?, dry_run?,
 *                                                 limit? }); runs in the background
 *
 * Env: V2_CARDS_DISABLED=1 stops the timers (routes stay). V2_CARDS_EMAIL_SINCE=<ISO date>
 * generates but does NOT email cards for registrations created before that date (deploy-day
 * guard against retroactively mailing an old guest list). PNG output appears automatically if
 * `@resvg/resvg-js` or `sharp` is ever added to package.json — SVG-only until then.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const tpl = require('./email-templates');

const KINDS = ['plexus', 'gala', 'bridges', 'forum', 'year'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

module.exports = function mountAttendanceCards(app, ctx) {
    const { db, auth, adminOnly, sendEmail, ROOT, log } = ctx;

    const q = {
        get(sql, p = []) { const s = db().prepare(sql); if (p.length) s.bind(p); const r = s.step() ? s.getAsObject() : null; s.free(); return r; },
        all(sql, p = []) { const s = db().prepare(sql); if (p.length) s.bind(p); const rows = []; while (s.step()) rows.push(s.getAsObject()); s.free(); return rows; },
        run(sql, p = []) { db().run(sql, p); save(); }
    };
    let _syncT = null;
    function save() {
        if (!process.env.TURSO_DATABASE_URL) return;
        if (_syncT) clearTimeout(_syncT);
        _syncT = setTimeout(() => { try { db().sync(); } catch (e) { /* best-effort */ } }, 2000);
        if (_syncT.unref) _syncT.unref();
    }

    // ---- schema ----
    try {
        db().run(`CREATE TABLE IF NOT EXISTS v2_attendance_cards (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            kind TEXT NOT NULL,
            registration_ref TEXT NOT NULL,
            image_path TEXT,
            png_path TEXT,
            event_name TEXT,
            email_to TEXT,
            generated_at TEXT,
            emailed_at TEXT,
            email_attempts INTEGER DEFAULT 0,
            last_error TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (kind, registration_ref)
        )`);
        db().run('CREATE INDEX IF NOT EXISTS idx_v2_cards_user ON v2_attendance_cards (user_id)');
        db().run('CREATE INDEX IF NOT EXISTS idx_v2_cards_email ON v2_attendance_cards (email_to)');
    } catch (e) { console.error('[v2/cards] schema:', e.message); }

    const cardsDir = path.join(__dirname, '..', 'uploads', 'cards');
    try { fs.mkdirSync(cardsDir, { recursive: true }); } catch (e) { console.error('[v2/cards] mkdir:', e.message); }

    // ---- optional raster renderer (none in package.json today — SVG-only then) ----
    let rasterize = null, rasterName = null;
    try { const { Resvg } = require('@resvg/resvg-js'); rasterize = (svg) => new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng(); rasterName = '@resvg/resvg-js'; } catch (e) {}
    if (!rasterize) { try { const sharp = require('sharp'); rasterize = (svg) => sharp(Buffer.from(svg)).resize(1200).png().toBuffer(); rasterName = 'sharp'; } catch (e) {} }

    // ---- brand assets, embedded so the SVG is self-contained in <img> contexts ----
    function b64Asset(rel) {
        try { return fs.readFileSync(path.join(ROOT, 'user-portal', 'frontend-v2', 'assets', rel)).toString('base64'); }
        catch (e) { return null; }
    }
    const LOGO_B64 = b64Asset('logo-white.png');   // 750×165 white wordmark
    const MARK_B64 = b64Asset('mark-x.png');       // 172×165 ampersand-X mark

    const X = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const fitSize = (text, base, perfect, min) => Math.max(min, Math.min(base, Math.round(base * perfect / Math.max(String(text || '').length, 1))));

    function fmtLong(iso) {
        const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!m) return '';
        return `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}`;
    }
    function fmtRange(startIso, endIso) {
        const s = String(startIso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
        const e = String(endIso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!s) return '';
        if (!e || (s[2] === e[2] && s[3] === e[3])) return fmtLong(startIso);
        if (s[1] === e[1] && s[2] === e[2]) return `${MONTHS[+s[2] - 1]} ${+s[3]}–${+e[3]}, ${s[1]}`;
        return `${MONTHS[+s[2] - 1]} ${+s[3]} – ${MONTHS[+e[2] - 1]} ${+e[3]}, ${e[1]}`;
    }
    function shortEventName(name, year) {
        const n = String(name || '').trim();
        if (/plexus/i.test(n)) { const y = (n.match(/(20\d{2})/) || [])[1] || year || ''; return ('Plexus ' + y).trim(); }
        return n.replace(/\s+/g, ' ');
    }

    // ---------------------------------------------------------------- SVG (1200×630, ink)
    const SVG_FONTS = `<style>@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..700;1,9..144,300..700&amp;family=Inter:wght@400..700&amp;display=swap');
      .fr{font-family:Fraunces,Georgia,'Times New Roman',serif}.in{font-family:Inter,Helvetica,Arial,sans-serif}</style>`;
    const SVG_GROUND = `
  <defs><radialGradient id="ink" cx="30%" cy="18%" r="120%">
    <stop offset="0%" stop-color="#221d18"/><stop offset="55%" stop-color="#191512"/><stop offset="100%" stop-color="#131009"/>
  </radialGradient></defs>
  <rect width="1200" height="630" fill="url(#ink)"/>
  <rect x="26" y="26" width="1148" height="578" fill="none" stroke="rgba(201,169,98,.5)" stroke-width="1"/>`;
    const svgHeader = (eyebrow) => `
  ${MARK_B64 ? `<image href="data:image/png;base64,${MARK_B64}" x="790" y="128" width="430" height="412" opacity="0.1"/>` : ''}
  ${LOGO_B64 ? `<image href="data:image/png;base64,${LOGO_B64}" x="64" y="54" width="141" height="31"/>`
             : `<text x="64" y="80" class="fr" font-size="30" fill="#f7f1e6">med<tspan font-style="italic" fill="#c9a962">&amp;X</tspan></text>`}
  <text x="1136" y="76" text-anchor="end" class="in" font-size="15" font-weight="600" letter-spacing="3.2" fill="#c9a962">${X(String(eyebrow || '').toUpperCase())}</text>
  <line x1="64" y1="112" x2="1136" y2="112" stroke="rgba(201,169,98,.35)" stroke-width="1"/>`;
    const svgIdentity = (name, sub, hashtag) => `
  <line x1="64" y1="500" x2="106" y2="500" stroke="#9b1b22" stroke-width="3"/>
  <text x="64" y="546" class="fr" font-size="${fitSize(name, 34, 26, 22)}" fill="#f7f1e6">${X(name)}</text>
  ${sub ? `<text x="64" y="578" class="in" font-size="17" fill="rgba(247,241,230,.55)">${X(sub)}</text>` : ''}
  <text x="1136" y="546" text-anchor="end" class="in" font-size="16" font-weight="600" letter-spacing="2.4" fill="#c9a962">MEDX.HR</text>
  ${hashtag ? `<text x="1136" y="574" text-anchor="end" class="in" font-size="13" letter-spacing="1.6" fill="rgba(247,241,230,.45)">${X(String(hashtag).toUpperCase())}</text>` : ''}`;

    function attendSvg({ eyebrow, line2, metaLine, name, sub, hashtag }) {
        const size2 = fitSize(line2, 88, 15, 44);
        return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  ${SVG_FONTS}${SVG_GROUND}${svgHeader(eyebrow)}
  <text x="64" y="286" class="fr" font-style="italic" font-size="76" fill="#f7f1e6">I'm attending</text>
  <text x="64" y="${286 + size2 + 22}" class="fr" font-weight="600" font-size="${size2}" fill="#f7f1e6">${X(line2)}<tspan fill="#c9a962">.</tspan></text>
  ${metaLine ? `<text x="64" y="${286 + size2 + 74}" class="in" font-size="24" font-weight="500" fill="rgba(247,241,230,.72)">${X(metaLine)}</text>` : ''}
  ${svgIdentity(name, sub, hashtag)}
</svg>`;
    }

    function yearSvg({ year, name, sub, cells }) {
        const shown = (cells || []).filter(c => Number(c.n) > 0).slice(0, 4);
        const stats = shown.map((c, i) => {
            const x = 64 + i * 210;
            return `<text x="${x}" y="440" class="fr" font-weight="600" font-size="46" fill="#c9a962">${X(c.n)}</text>
  <text x="${x}" y="468" class="in" font-size="12.5" font-weight="600" letter-spacing="2.4" fill="rgba(247,241,230,.55)">${X(String(c.label).toUpperCase())}</text>`;
        }).join('\n  ');
        return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  ${SVG_FONTS}${SVG_GROUND}${svgHeader('MED&X · YEAR IN REVIEW')}
  <text x="64" y="272" class="fr" font-weight="600" font-size="132" fill="#c9a962">${X(year)}</text>
  <text x="64" y="342" class="fr" font-style="italic" font-size="48" fill="#f7f1e6">My year at Med&amp;X.</text>
  ${stats}
  ${svgIdentity(name, sub, `#MEDX${year}`)}
</svg>`;
    }

    // ---------------------------------------------------------------- shared plumbing
    const now = () => new Date().toISOString();
    const absBase = () => (process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, '');
    const portalBase = () => (process.env.MEMBER_PORTAL_URL || absBase()).replace(/\/+$/, '');

    function writeCardFiles(id, svg) {
        const svgRel = `uploads/cards/${id}.svg`;
        fs.writeFileSync(path.join(cardsDir, `${id}.svg`), svg, 'utf8');
        let pngRel = null;
        if (rasterize) {
            try { fs.writeFileSync(path.join(cardsDir, `${id}.png`), rasterize(svg)); pngRel = `uploads/cards/${id}.png`; }
            catch (e) { console.error('[v2/cards] raster:', e.message); }
        }
        return { svgRel, pngRel };
    }

    function insertCard({ userId, kind, ref, svg, eventName, emailTo }) {
        const id = crypto.randomUUID();
        const { svgRel, pngRel } = writeCardFiles(id, svg);
        q.run(`INSERT INTO v2_attendance_cards (id, user_id, kind, registration_ref, image_path, png_path, event_name, email_to, generated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, userId || null, kind, ref, svgRel, pngRel, eventName || '', (emailTo || '').toLowerCase(), now()]);
        return q.get('SELECT * FROM v2_attendance_cards WHERE id = ?', [id]);
    }

    async function emailCard(card, meta) {
        if (!card.email_to) { q.run('UPDATE v2_attendance_cards SET last_error = ?, email_attempts = email_attempts + 1 WHERE id = ?', ['no recipient address', card.id]); return false; }
        if (!meta.firstName) {
            try { const u = q.get('SELECT first_name FROM users WHERE LOWER(email) = ?', [card.email_to]); if (u && u.first_name) meta.firstName = u.first_name; } catch (e) {}
        }
        const base = absBase();
        const fileRel = card.png_path || card.image_path;
        const isYear = card.kind === 'year';
        const html = isYear
            ? tpl.yearInReview({ firstName: meta.firstName, year: meta.year, stats: meta.stats, cardImageUrl: `${base}/${fileRel}`, cardDownloadUrl: `${base}/${card.image_path}`, walletUrl: `${portalBase()}/app/me` })
            : tpl.attendanceCard({ firstName: meta.firstName, eventName: card.event_name, dateLabel: meta.dateLabel, venue: meta.venue, cardImageUrl: `${base}/${fileRel}`, cardDownloadUrl: `${base}/${card.image_path}`, walletUrl: `${portalBase()}/app/me`, shareText: meta.shareText });
        const subject = isYear ? `Your ${meta.year} at Med&X — your card is inside` : `I'm attending ${card.event_name} — your card is inside`;
        let attachments = [];
        try {
            const p = path.join(cardsDir, path.basename(card.png_path || card.image_path));
            attachments = [{ filename: `medx-${card.kind}-card.${card.png_path ? 'png' : 'svg'}`, content: fs.readFileSync(p) }];
        } catch (e) { /* attachment is a nicety */ }
        try {
            const r = await sendEmail(card.email_to, subject, html, attachments);
            if (r && r.success === false && !r.mock) {
                q.run('UPDATE v2_attendance_cards SET email_attempts = email_attempts + 1, last_error = ? WHERE id = ?', [String(r.error || 'send failed').slice(0, 300), card.id]);
                return false;
            }
            q.run('UPDATE v2_attendance_cards SET emailed_at = ?, last_error = NULL WHERE id = ?', [now(), card.id]);
            return true;
        } catch (e) {
            q.run('UPDATE v2_attendance_cards SET email_attempts = email_attempts + 1, last_error = ? WHERE id = ?', [String(e.message || e).slice(0, 300), card.id]);
            return false;
        }
    }

    const personName = (r) => {
        const fn = r.first_name || r.user_fn || '', ln = r.last_name || r.user_ln || '';
        const full = `${fn} ${ln}`.trim() || String(r.full_name || '').trim();
        return { firstName: fn || (full.split(' ')[0] || ''), fullName: full || String(r.email || r.user_email || '').split('@')[0] };
    };
    const userIdByEmail = (email) => {
        if (!email) return null;
        try { const u = q.get('SELECT id FROM users WHERE LOWER(email) = LOWER(?)', [email]); return u ? u.id : null; } catch (e) { return null; }
    };

    // ---------------------------------------------------------------- eligibility queries
    const notExists = (kind, refCol) => `NOT EXISTS (SELECT 1 FROM v2_attendance_cards vc WHERE vc.kind = '${kind}' AND vc.registration_ref = ${refCol})`;
    function findEligible() {
        const out = [];
        const push = (rows, mapFn) => { for (const r of rows) { try { out.push(mapFn(r)); } catch (e) { console.error('[v2/cards] map:', e.message); } } };
        try {
            push(q.all(`SELECT r.id AS ref, r.user_id, r.email, r.first_name, r.last_name, r.institution, r.created_at,
                               u.email AS user_email, u.first_name AS user_fn, u.last_name AS user_ln, u.institution AS user_inst,
                               c.name AS ev_name, c.year, c.start_date, c.end_date, c.venue_city
                        FROM registrations r
                        JOIN conferences c ON c.id = r.conference_id
                        LEFT JOIN users u ON u.id = r.user_id
                        LEFT JOIN ticket_types t ON t.id = r.ticket_type_id
                        WHERE r.status = 'confirmed' AND COALESCE(r.revoked, 0) = 0
                          AND (r.payment_status IN ('paid','comp','free','n/a','waived')
                               OR (COALESCE(t.price_regular, 0) = 0 AND COALESCE(r.amount_paid, 0) = 0))
                          AND COALESCE(NULLIF(c.end_date,''), NULLIF(c.start_date,''), '9999') >= date('now')
                          AND ${notExists('plexus', 'r.id')}`), (r) => {
                const short = shortEventName(r.ev_name, r.year);
                const dateLabel = fmtRange(r.start_date, r.end_date);
                const city = r.venue_city || 'Zagreb';
                return { kind: 'plexus', ref: r.ref, createdAt: r.created_at, userId: r.user_id || userIdByEmail(r.email), email: (r.email || r.user_email || '').toLowerCase(), r,
                    eventName: short, dateLabel, city, sub: r.institution || r.user_inst || '',
                    eyebrow: `${short} · ${city}`, metaLine: [city, dateLabel].filter(Boolean).join(' · '), hashtag: '#' + short.replace(/\s+/g, '').toUpperCase() };
            });
        } catch (e) { console.error('[v2/cards] plexus query:', e.message); }
        try {
            push(q.all(`SELECT gr.id AS ref, gr.user_id, gr.email, gr.first_name, gr.last_name, gr.institution, gr.created_at,
                               g.title AS ev_name, g.date AS start_date, g.venue
                        FROM gala_registrations gr LEFT JOIN gala_settings g ON g.id = 'default'
                        WHERE gr.status IN ('confirmed','approved','vip-comp')
                          AND (gr.payment_status IN ('paid','comp') OR gr.status = 'vip-comp')
                          AND COALESCE(NULLIF(g.date,''), '9999') >= date('now')
                          AND ${notExists('gala', 'gr.id')}`), (r) => {
                // gala_settings.title is "Plexus Gala Evening 2026" — the card reads better short
                const short = (String(r.ev_name || '').replace(/^plexus\s+/i, '').trim()) || 'Gala Evening 2026';
                const dateLabel = fmtLong(r.start_date);
                const venue = String(r.venue || '').split(/[;,]/)[0].trim() || 'Hotel Esplanade';
                return { kind: 'gala', ref: r.ref, createdAt: r.created_at, userId: r.user_id || userIdByEmail(r.email), email: (r.email || '').toLowerCase(), r,
                    eventName: short, dateLabel, city: 'Zagreb', sub: r.institution || '',
                    eyebrow: `${short} · ZAGREB`, metaLine: [venue + ', Zagreb', dateLabel].filter(Boolean).join(' · '), hashtag: '#PLEXUSGALA' };
            });
        } catch (e) { console.error('[v2/cards] gala query:', e.message); }
        try {
            push(q.all(`SELECT br.id AS ref, br.user_id, br.email, br.first_name, br.last_name, br.institution, br.registered_at AS created_at,
                               e.name AS ev_name, e.city, e.venue_name, e.event_date AS start_date
                        FROM bridges_registrations br JOIN bridges_events e ON e.id = br.event_id
                        WHERE br.status IN ('confirmed','registered')
                          AND (COALESCE(e.price, 0) = 0 OR br.payment_status IN ('paid','comp','n/a'))
                          AND COALESCE(NULLIF(e.event_date,''), '9999') >= date('now')
                          AND ${notExists('bridges', 'br.id')}`), (r) => {
                const dateLabel = fmtLong(r.start_date);
                return { kind: 'bridges', ref: r.ref, createdAt: r.created_at, userId: r.user_id || userIdByEmail(r.email), email: (r.email || '').toLowerCase(), r,
                    eventName: r.ev_name || 'Building Bridges', dateLabel, city: r.city || '', sub: r.institution || '',
                    eyebrow: `BUILDING BRIDGES · ${(r.city || '').toUpperCase()}`, metaLine: [r.city, dateLabel].filter(Boolean).join(' · '), hashtag: '#BUILDINGBRIDGES' };
            });
        } catch (e) { console.error('[v2/cards] bridges query:', e.message); }
        try {
            push(q.all(`SELECT fer.id AS ref, fer.email, fer.first_name, fer.last_name, fer.name AS full_name, fer.institution, fer.registered_at AS created_at,
                               fe.title AS ev_name, fe.start_date, fe.end_date, COALESCE(NULLIF(fe.venue,''), fe.location_name) AS venue
                        FROM forum_event_registrations fer JOIN forum_events fe ON fe.id = fer.event_id
                        WHERE COALESCE(NULLIF(fer.status,''), 'registered') IN ('registered','confirmed')
                          AND (COALESCE(fe.is_paid, 0) = 0 OR fer.payment_status = 'paid')
                          AND COALESCE(NULLIF(fe.start_date,''), '9999') >= date('now')
                          AND ${notExists('forum', 'fer.id')}`), (r) => {
                const dateLabel = fmtRange(r.start_date, r.end_date);
                return { kind: 'forum', ref: r.ref, createdAt: r.created_at, userId: userIdByEmail(r.email), email: (r.email || '').toLowerCase(), r,
                    eventName: r.ev_name || 'Biomedical Forum', dateLabel, city: r.venue || '', sub: r.institution || '',
                    eyebrow: 'MED&X · BIOMEDICAL FORUM', metaLine: [r.venue, dateLabel].filter(Boolean).join(' · '), hashtag: '#BIOMEDICALFORUM' };
            });
        } catch (e) { console.error('[v2/cards] forum query:', e.message); }
        return out;
    }

    // ---------------------------------------------------------------- the sweep
    let _busy = false;
    async function sweep(trigger) {
        if (_busy) return { skipped: true };
        _busy = true;
        const emailSince = String(process.env.V2_CARDS_EMAIL_SINCE || '').slice(0, 10);
        let generated = 0, emailed = 0, failed = 0, retried = 0;
        try {
            const eligible = findEligible();
            for (const item of eligible) {
                try {
                    const who = personName(item.r);
                    const svg = attendSvg({ eyebrow: item.eyebrow, line2: item.eventName, metaLine: item.metaLine, name: who.fullName, sub: item.sub, hashtag: item.hashtag });
                    const card = insertCard({ userId: item.userId, kind: item.kind, ref: item.ref, svg, eventName: item.eventName, emailTo: item.email });
                    generated++;
                    const skipEmail = emailSince && String(item.createdAt || '').slice(0, 10) < emailSince;
                    if (skipEmail) { q.run('UPDATE v2_attendance_cards SET last_error = ? WHERE id = ?', ['not emailed: created before V2_CARDS_EMAIL_SINCE', card.id]); continue; }
                    const ok = await emailCard(card, {
                        firstName: who.firstName, dateLabel: item.dateLabel, venue: item.city,
                        shareText: `I'm attending ${item.eventName} — ${[item.city, item.dateLabel].filter(Boolean).join(', ')}. See you there? medx.hr`
                    });
                    ok ? emailed++ : failed++;
                } catch (e) { failed++; console.error('[v2/cards] item:', e.message); }
            }
            // retry earlier failures (never the deliberately-skipped backfill rows)
            const retries = q.all(`SELECT * FROM v2_attendance_cards
                                   WHERE emailed_at IS NULL AND email_to != '' AND email_attempts BETWEEN 1 AND 4
                                     AND COALESCE(last_error,'') NOT LIKE 'not emailed:%' AND kind != 'year'`);
            for (const card of retries) {
                try {
                    const ok = await emailCard(card, { firstName: '', dateLabel: '', venue: '', shareText: '' });
                    retried++; ok ? emailed++ : failed++;
                } catch (e) { failed++; }
            }
        } catch (e) { console.error('[v2/cards] sweep:', e.message); }
        finally { _busy = false; }
        const summary = { trigger: trigger || 'interval', generated, emailed, failed, retried };
        log && log(`cards sweep (${summary.trigger}): ${generated} generated, ${emailed} emailed, ${failed} failed${retried ? `, ${retried} retried` : ''}${rasterName ? '' : ' [SVG only — no raster dep]'}`);
        return summary;
    }

    if (process.env.V2_CARDS_DISABLED !== '1') {
        const t0 = setTimeout(() => { sweep('boot').catch(() => {}); }, 30 * 1000);
        const ti = setInterval(() => { sweep('interval').catch(() => {}); }, 5 * 60 * 1000);
        if (t0.unref) t0.unref();
        if (ti.unref) ti.unref();
    }

    // ---------------------------------------------------------------- routes
    app.get('/api/v2/attendance-cards/mine', auth, (req, res) => {
        try {
            const me = q.get('SELECT id, email FROM users WHERE id = ?', [req.user.id]);
            const email = ((me && me.email) || req.user.email || '').toLowerCase();
            const rows = q.all(`SELECT * FROM v2_attendance_cards WHERE user_id = ? OR (email_to != '' AND email_to = ?) ORDER BY generated_at DESC`, [req.user.id, email]);
            // relative paths on purpose — the SPA loads them through its own origin/proxy, the
            // same idiom as the '/qr/<id>.png' tickets in GET /api/my/events (helmet's
            // Cross-Origin-Resource-Policy: same-origin blocks cross-origin <img> otherwise)
            res.json({
                cards: rows.map(r => ({
                    id: r.id, kind: r.kind, event_name: r.event_name,
                    image_url: `/${r.png_path || r.image_path}`,
                    download_url: `/${r.image_path}`,
                    view_url: `/api/v2/attendance-cards/${r.id}/image`,
                    generated_at: r.generated_at, emailed_at: r.emailed_at
                }))
            });
        } catch (e) { console.error('[v2/cards] mine:', e.message); res.status(500).json({ error: 'Could not load your cards' }); }
    });

    // Inline view (the /uploads static route forces download by design; this one renders).
    // :id is an unguessable uuid — the same access model as the hosted /qr/:id.png tickets.
    app.get('/api/v2/attendance-cards/:id/image', (req, res) => {
        try {
            const id = String(req.params.id || '').trim();
            if (!/^[0-9a-f-]{36}$/.test(id)) return res.status(404).json({ error: 'Not found' });
            const row = q.get('SELECT * FROM v2_attendance_cards WHERE id = ?', [id]);
            if (!row) return res.status(404).json({ error: 'Not found' });
            const png = row.png_path && fs.existsSync(path.join(cardsDir, `${id}.png`));
            const file = path.join(cardsDir, `${id}.${png ? 'png' : 'svg'}`);
            if (!fs.existsSync(file)) return res.status(404).json({ error: 'Not found' });
            res.setHeader('Content-Type', png ? 'image/png' : 'image/svg+xml');
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.setHeader('Cache-Control', 'public, max-age=86400');
            // our own generated markup, but stay defensive: no scripts can run from this response
            res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data:;");
            res.send(fs.readFileSync(file));
        } catch (e) { console.error('[v2/cards] image:', e.message); res.status(500).json({ error: 'Could not load the card' }); }
    });

    app.post('/api/v2/attendance-cards/sweep', auth, adminOnly, async (req, res) => {
        try { res.json(Object.assign({ ok: true }, await sweep('admin'))); }
        catch (e) { res.status(500).json({ error: 'Sweep failed' }); }
    });

    // ---------------------------------------------------------------- year in review
    function yearStats(user, year) {
        const s = { events_registered: 0, events_attended: 0, connections: 0, certificates: 0, talks: 0, cities: [] };
        const cities = new Set();
        try {
            q.all(`SELECT c.venue_city, r.checked_in FROM registrations r JOIN conferences c ON c.id = r.conference_id
                   WHERE r.user_id = ? AND COALESCE(r.revoked,0) = 0 AND substr(COALESCE(c.start_date, r.created_at),1,4) = ?`, [user.id, String(year)]).forEach(r => {
                s.events_registered++; if (r.checked_in) s.events_attended++; if (r.venue_city) cities.add(String(r.venue_city).trim());
            });
        } catch (e) {}
        try {
            q.all(`SELECT e.city, br.checked_in FROM bridges_registrations br JOIN bridges_events e ON e.id = br.event_id
                   WHERE LOWER(br.email) = LOWER(?) AND substr(COALESCE(e.event_date, br.registered_at),1,4) = ?`, [user.email || '', String(year)]).forEach(r => {
                s.events_registered++; if (r.checked_in) s.events_attended++; if (r.city) cities.add(String(r.city).trim());
            });
        } catch (e) {}
        try {
            q.all(`SELECT gr.checked_in FROM gala_registrations gr WHERE LOWER(gr.email) = LOWER(?)
                   AND gr.status IN ('confirmed','approved','vip-comp') AND substr(gr.created_at,1,4) = ?`, [user.email || '', String(year)]).forEach(r => {
                s.events_registered++; if (r.checked_in) s.events_attended++; cities.add('Zagreb');
            });
        } catch (e) {}
        try { const row = q.get(`SELECT COUNT(*) AS n FROM networking_connections WHERE status = 'accepted' AND (requester_id = ? OR receiver_id = ?)`, [user.id, user.id]); s.connections = (row && row.n) || 0; } catch (e) {}
        try { const row = q.get(`SELECT COUNT(*) AS n FROM certificates ct JOIN registrations r ON ct.registration_id = r.id WHERE r.user_id = ?`, [user.id]); s.certificates = (row && row.n) || 0; } catch (e) {}
        s.cities = Array.from(cities);
        return s;
    }

    app.post('/api/v2/attendance-cards/year-in-review', auth, adminOnly, (req, res) => {
        try {
            const b = req.body || {};
            const year = parseInt(b.year, 10) || new Date().getFullYear();
            const limit = Math.max(0, parseInt(b.limit, 10) || 0);
            const members = q.all(`SELECT id, email, first_name, last_name, institution FROM users
                                   WHERE deleted_at IS NULL AND email IS NOT NULL AND email != ''
                                     AND (
                                       EXISTS (SELECT 1 FROM registrations r WHERE r.user_id = users.id)
                                       OR EXISTS (SELECT 1 FROM gala_registrations g WHERE LOWER(g.email) = LOWER(users.email))
                                       OR EXISTS (SELECT 1 FROM bridges_registrations bb WHERE LOWER(bb.email) = LOWER(users.email))
                                       OR COALESCE(last_login, created_at) >= ?
                                     )
                                     AND NOT EXISTS (SELECT 1 FROM v2_attendance_cards vc WHERE vc.kind = 'year' AND vc.registration_ref = ? || ':' || users.id)`,
                [`${year}-01-01`, String(year)]);
            const batch = limit ? members.slice(0, limit) : members;
            if (b.dry_run) return res.json({ ok: true, dry_run: true, year, candidates: members.length });

            (async () => {
                let generated = 0, emailed = 0, failed = 0;
                for (const u of batch) {
                    try {
                        const stats = yearStats(u, year);
                        const fullName = `${u.first_name || ''} ${u.last_name || ''}`.trim() || String(u.email).split('@')[0];
                        const cells = [
                            { n: stats.events_registered, label: 'Events' }, { n: stats.events_attended, label: 'Attended' },
                            { n: stats.connections, label: 'Connections' }, { n: stats.certificates, label: 'Certificates' }
                        ];
                        const svg = yearSvg({ year, name: fullName, sub: u.institution || '', cells });
                        const card = insertCard({ userId: u.id, kind: 'year', ref: `${year}:${u.id}`, svg, eventName: `Med&X ${year}`, emailTo: u.email });
                        generated++;
                        const ok = await emailCard(card, { firstName: u.first_name || '', year, stats });
                        ok ? emailed++ : failed++;
                    } catch (e) { failed++; console.error('[v2/cards] year item:', e.message); }
                }
                log && log(`year-in-review ${year}: ${generated} generated, ${emailed} emailed, ${failed} failed of ${batch.length}`);
            })().catch(e => console.error('[v2/cards] year loop:', e.message));

            res.json({ ok: true, year, candidates: members.length, processing: batch.length, status: 'generating' });
        } catch (e) { console.error('[v2/cards] year-in-review:', e.message); res.status(500).json({ error: 'Could not start the year-in-review run' }); }
    });

    log && log(`attendance cards mounted (raster: ${rasterName || 'none — SVG only'}; dir: uploads/cards)`);
};
