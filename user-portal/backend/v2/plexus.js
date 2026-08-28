/**
 * v2/plexus.js — backend additions for the redesigned Plexus screen group
 * (frontend-v2 js/views/plexus.js: overview · program · zagreb · mine).
 *
 * Routes (all under /api/v2/plexus/…, never reusing an existing /api path):
 *   GET    /api/v2/plexus/speaker-meta            public  → { meta: { <speaker_id>: { institution_logo_url, event_tag } } }
 *   PUT    /api/v2/plexus/speakers/:id/meta       admin   { institution_logo_url?, event_tag? ('plexus'|'gala'|'both'|null) }
 *   POST   /api/v2/plexus/photos                  admin   { file_path, title?, description?, photographer?, sort_order?, is_public? } → conference_photos
 *   DELETE /api/v2/plexus/photos/:id              admin
 *   GET    /api/v2/plexus/program.pdf             public  PDF built from the PUBLISHED sessions + confirmed speakers + gala settings
 *   GET    /api/v2/plexus/welcome-guide.pdf       public  PDF of the Explore Zagreb guide (static copy — same text as the artboard)
 *
 * Tables: v2_speaker_meta (speaker_id PK, institution_logo_url, event_tag, updated_at) — the
 * `speakers` table has no institution-logo column and no "which event" flag (gap matrix C-7);
 * this side table carries both until the admin Speakers manager ships. Everything else reads
 * the existing tables (conferences, sessions, speakers, gala_settings, conference_photos).
 * The member-facing reads stay on the existing routes (/api/plexus/schedule, /api/plexus/speakers…).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EVENT_TAGS = ['plexus', 'gala', 'both'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Explore Zagreb — the welcome guide copy (Plexus Zagreb.dc.html; static content, gap matrix C-12)
const ZAGREB_GUIDE = {
    title: 'Dobrodošli u Zagreb.',
    eyebrow: 'Plexus 2026 · Your December in Croatia\'s capital',
    intro: 'Austro-Hungarian elegance, Mediterranean warmth, and Europe\'s best advent season — compact, walkable, and at its most magical in December.',
    stops: {
        heading: '01 · Six stops before dinner',
        note: 'All in the walkable centre, an easy stroll from the venue.',
        items: [
            ['Ban Jelačić Square', 'The city\'s beating heart — cafés on every side, advent stalls in December. 5 minutes from the venue.'],
            ['St. Mark\'s Church', 'The famous tiled roof, coats of arms and all.'],
            ['Zagreb Cathedral', 'Croatia\'s tallest building — twin spires over Kaptol.'],
            ['Dolac Market', 'The "Belly of Zagreb" — red umbrellas, morning buzz.'],
            ['Upper Town at dusk', 'Cobblestones, the Stone Gate, gas lamps lit by hand.'],
            ['Tkalčićeva Street', 'Café-lined and lively till late — end the night here.']
        ],
        bonus: ['December bonus: Advent in Zagreb', 'Voted Europe\'s best Christmas market three years running — mulled wine, lights, and music on every square.']
    },
    taste: {
        heading: '02 · Taste Zagreb',
        note: 'Come hungry.',
        items: [
            ['Štrukli', 'Baked dough, fresh cheese, sour cream — the city\'s signature comfort.'],
            ['Ćevapi', 'The Balkan classic — flatbread, raw onion, ajvar. No cutlery required.'],
            ['Croatian wine', '130+ native grapes — start with a Graševina, stay for the Plavac Mali.'],
            ['Craft beer', 'The Garden, Zmajska, Nova Runda — a scene in full swing.']
        ]
    },
    around: {
        heading: '03 · Getting around',
        items: [
            ['On foot', 'the centre is compact and walkable'],
            ['Blue trams', 'Zagreb\'s classic way around · ZET app'],
            ['Bolt & Uber', 'available across the city and from the airport']
        ]
    },
    closing: 'December in Zagreb: advent stalls, mulled wine, and the season\'s best conversations.'
};

module.exports = function mountPlexus(app, ctx) {
    const { db, auth, adminOnly, ROOT } = ctx;
    const log = ctx.log || ((...a) => console.log('[v2/plexus]', ...a));

    // ---- sql.js-style helpers (shared/db.js wrapper: prepare → bind → step → getAsObject → free)
    const q = {
        all(sql, params = []) {
            const st = db().prepare(sql);
            st.bind(params);
            const rows = [];
            while (st.step()) rows.push(st.getAsObject());
            st.free();
            return rows;
        },
        get(sql, params = []) { return q.all(sql, params)[0] || null; },
        run(sql, params = []) { return db().run(sql, params); }
    };
    const safeAll = (sql, params) => { try { return q.all(sql, params); } catch (e) { return []; } };
    const safeGet = (sql, params) => { try { return q.get(sql, params); } catch (e) { return null; } };

    // ---- schema (both portals share ONE database — new table prefixed v2_, nothing renamed)
    try {
        q.run(`CREATE TABLE IF NOT EXISTS v2_speaker_meta (
            speaker_id TEXT PRIMARY KEY,
            institution_logo_url TEXT,
            event_tag TEXT,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )`);
    } catch (e) { log('v2_speaker_meta schema failed:', e.message); }

    const activeConf = () =>
        safeGet('SELECT * FROM conferences WHERE is_active = 1 ORDER BY year DESC LIMIT 1') ||
        safeGet("SELECT * FROM conferences WHERE slug = 'plexus-2026'");
    const galaSettings = () => safeGet("SELECT * FROM gala_settings WHERE id = 'default'") || {};
    const publishedSessions = (confId) => safeAll(
        `SELECT s.*, GROUP_CONCAT(sp.name, ', ') AS speaker_names
           FROM sessions s LEFT JOIN speakers sp ON s.speaker_ids LIKE '%' || sp.id || '%'
          WHERE s.conference_id = ? AND s.is_published = 1
          GROUP BY s.id ORDER BY s.day, s.start_time`, [confId]);
    const publishedSpeakers = (confId) => safeAll(
        `SELECT id, name, title, institution, talk_title, is_keynote, sort_order FROM speakers
          WHERE conference_id = ? AND is_confirmed = 1 AND COALESCE(is_published, 0) = 1
          ORDER BY is_keynote DESC, sort_order, name`, [confId]);

    const isUrl = (s) => /^(https?:\/\/[^\s"'<>]+|\/uploads\/[^\s"'<>]+)$/i.test(String(s || ''));
    const clip = (v, n) => (v == null ? null : String(v).trim().slice(0, n) || null);
    const dayDate = (startIso, dayIndex) => {
        const m = String(startIso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!m) return null;
        const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + (Number(dayIndex || 1) - 1)));
        return d;
    };
    const longDate = (d) => d ? `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` : '';
    const isoToLong = (iso) => { const d = dayDate(iso, 1); return longDate(d); };
    const dateRange = (a, b) => {
        const da = dayDate(a, 1), dbb = dayDate(b, 1);
        if (!da) return '';
        if (!dbb || da.getTime() === dbb.getTime()) return `${da.getUTCDate()} ${MONTHS[da.getUTCMonth()]} ${da.getUTCFullYear()}`;
        if (da.getUTCMonth() === dbb.getUTCMonth()) return `${da.getUTCDate()}–${dbb.getUTCDate()} ${MONTHS[da.getUTCMonth()]} ${da.getUTCFullYear()}`;
        return `${da.getUTCDate()} ${MONTHS[da.getUTCMonth()]} – ${dbb.getUTCDate()} ${MONTHS[dbb.getUTCMonth()]} ${dbb.getUTCFullYear()}`;
    };
    const hhmm = (t) => { const m = String(t || '').match(/(\d{1,2}):(\d{2})/); return m ? `${m[1].padStart(2, '0')}:${m[2]}` : ''; };

    // ---- pdfkit + Unicode font (same candidates as server.js: shared/fonts/DejaVuSans*.ttf) -----
    const FONT = (() => {
        const c = [process.env.PDF_FONT_PATH, path.join(ROOT, 'shared', 'fonts', 'DejaVuSans.ttf')].filter(Boolean);
        for (const p of c) { try { if (fs.existsSync(p)) return p; } catch (e) {} }
        return null;
    })();
    const FONT_BOLD = (() => {
        const c = [process.env.PDF_FONT_BOLD_PATH, path.join(ROOT, 'shared', 'fonts', 'DejaVuSans-Bold.ttf')].filter(Boolean);
        for (const p of c) { try { if (fs.existsSync(p)) return p; } catch (e) {} }
        return FONT;
    })();
    const TRANSLIT = { 'č': 'c', 'ć': 'c', 'đ': 'd', 'š': 's', 'ž': 'z', 'Č': 'C', 'Ć': 'C', 'Đ': 'D', 'Š': 'S', 'Ž': 'Z' };
    function pdfDoc(res, filename) {
        const PDFDocument = require('pdfkit');
        const doc = new PDFDocument({ margin: 54, size: 'A4', info: { Title: filename.replace(/\.pdf$/, ''), Author: 'Med&X' } });
        let body = 'Helvetica', bold = 'Helvetica-Bold', safe = (t) => String(t == null ? '' : t).replace(/[čćđšžČĆĐŠŽ]/g, ch => TRANSLIT[ch] || ch);
        if (FONT) {
            try { doc.registerFont('MedXBody', FONT); doc.registerFont('MedXBold', FONT_BOLD || FONT); body = 'MedXBody'; bold = 'MedXBold'; safe = (t) => String(t == null ? '' : t); } catch (e) {}
        }
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
        res.setHeader('Cache-Control', 'no-store');
        doc.pipe(res);
        return { doc, body, bold, safe };
    }
    // brand: ink #191512 · crimson #9b1b22 · gold #c9a962 · soft ink #4a4239 (README "Design Tokens")
    function pdfHeader(p, eyebrow, title, sub) {
        const { doc, body, bold, safe } = p;
        doc.font(bold).fontSize(9).fillColor('#9b1b22').text(safe(eyebrow).toUpperCase(), { characterSpacing: 1.4 });
        doc.moveDown(0.4);
        doc.font(bold).fontSize(24).fillColor('#191512').text(safe(title));
        if (sub) { doc.moveDown(0.2); doc.font(body).fontSize(11).fillColor('#4a4239').text(safe(sub)); }
        doc.moveDown(0.6);
        doc.moveTo(doc.x, doc.y).lineTo(doc.page.width - 54, doc.y).lineWidth(0.6).strokeColor('#c9a962').stroke();
        doc.moveDown(0.8);
    }
    function pdfSection(p, label) {
        const { doc, bold, safe } = p;
        doc.moveDown(0.5);
        doc.font(bold).fontSize(10).fillColor('#9b1b22').text(safe(label).toUpperCase(), { characterSpacing: 1.2 });
        doc.moveDown(0.35);
    }
    function pdfFooter(p, line) {
        const { doc, body, safe } = p;
        doc.moveDown(1.2);
        doc.font(body).fontSize(8.5).fillColor('#9b8f80').text(safe(line));
    }

    // ================================================================ speaker meta
    app.get('/api/v2/plexus/speaker-meta', (req, res) => {
        try {
            const rows = safeAll('SELECT speaker_id, institution_logo_url, event_tag FROM v2_speaker_meta');
            const meta = {};
            rows.forEach(r => { meta[r.speaker_id] = { institution_logo_url: r.institution_logo_url || null, event_tag: r.event_tag || null }; });
            res.json({ meta });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.put('/api/v2/plexus/speakers/:id/meta', auth, adminOnly, (req, res) => {
        try {
            const id = String(req.params.id || '').trim();
            const speaker = safeGet('SELECT id FROM speakers WHERE id = ?', [id]);
            if (!speaker) return res.status(404).json({ error: 'Speaker not found' });
            const b = req.body || {};
            const prev = safeGet('SELECT * FROM v2_speaker_meta WHERE speaker_id = ?', [id]) || {};
            let logo = prev.institution_logo_url || null;
            if (b.institution_logo_url !== undefined) {
                const v = clip(b.institution_logo_url, 500);
                if (v && !isUrl(v)) return res.status(400).json({ error: 'institution_logo_url must be an http(s) URL or an /uploads/ path' });
                logo = v;
            }
            let tag = prev.event_tag || null;
            if (b.event_tag !== undefined) {
                const v = b.event_tag == null || b.event_tag === '' ? null : String(b.event_tag).trim().toLowerCase();
                if (v && !EVENT_TAGS.includes(v)) return res.status(400).json({ error: 'event_tag must be plexus, gala, both or empty' });
                tag = v;
            }
            q.run(`INSERT INTO v2_speaker_meta (speaker_id, institution_logo_url, event_tag, updated_at) VALUES (?, ?, ?, datetime('now'))
                   ON CONFLICT(speaker_id) DO UPDATE SET institution_logo_url = excluded.institution_logo_url, event_tag = excluded.event_tag, updated_at = excluded.updated_at`,
                [id, logo, tag]);
            res.json({ success: true, speaker_id: id, institution_logo_url: logo, event_tag: tag });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ================================================================ photos (conference_photos has no writer in either backend)
    app.post('/api/v2/plexus/photos', auth, adminOnly, (req, res) => {
        try {
            const conf = activeConf();
            if (!conf) return res.status(400).json({ error: 'No active conference' });
            const b = req.body || {};
            const file_path = clip(b.file_path, 800);
            if (!file_path || !isUrl(file_path)) return res.status(400).json({ error: 'file_path must be an http(s) URL or an /uploads/ path' });
            const id = crypto.randomUUID();
            q.run(`INSERT INTO conference_photos (id, conference_id, title, description, file_path, thumbnail_path, photographer, uploaded_by, is_public, sort_order)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [id, conf.id, clip(b.title, 200), clip(b.description, 1000), file_path, isUrl(b.thumbnail_path) ? clip(b.thumbnail_path, 800) : null,
                 clip(b.photographer, 200), req.user.id, b.is_public === undefined ? 1 : (b.is_public ? 1 : 0), Number.isFinite(Number(b.sort_order)) ? Number(b.sort_order) : 0]);
            res.json({ success: true, id });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.delete('/api/v2/plexus/photos/:id', auth, adminOnly, (req, res) => {
        try {
            const row = safeGet('SELECT id FROM conference_photos WHERE id = ?', [String(req.params.id || '')]);
            if (!row) return res.status(404).json({ error: 'Photo not found' });
            q.run('DELETE FROM conference_photos WHERE id = ?', [row.id]);
            res.json({ success: true });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ================================================================ program PDF (published rows only)
    app.get('/api/v2/plexus/program.pdf', (req, res) => {
        try {
            const conf = activeConf();
            if (!conf) return res.status(404).json({ error: 'No active conference' });
            const sessions = publishedSessions(conf.id);
            const speakers = publishedSpeakers(conf.id);
            const gala = galaSettings();
            const p = pdfDoc(res, `plexus-${conf.year || ''}-program.pdf`.replace('--', '-'));
            const { doc, body, bold, safe } = p;
            const venue = [conf.venue_name, conf.venue_city].filter(Boolean).join(', ');
            pdfHeader(p, 'Med&X · Program', conf.name || 'Plexus Conference', [dateRange(conf.start_date, conf.end_date), venue].filter(Boolean).join(' · '));

            // days
            const start = dayDate(conf.start_date, 1), end = dayDate(conf.end_date, 1) || start;
            const dayCount = start && end ? Math.min(6, Math.max(1, Math.round((end - start) / 86400000) + 1)) : 1;
            for (let i = 1; i <= dayCount; i++) {
                const d = dayDate(conf.start_date, i);
                pdfSection(p, `Day ${i} — ${longDate(d)}`);
                const rows = sessions.filter(s => Number(s.day || 1) === i);
                if (!rows.length) {
                    doc.font(body).fontSize(10.5).fillColor('#4a4239').text(safe('Program in preparation — session times are published closer to the event, and registered members hear first.'), { oblique: true });
                    continue;
                }
                rows.forEach(s => {
                    const time = [hhmm(s.start_time), hhmm(s.end_time)].filter(Boolean).join('–');
                    doc.font(bold).fontSize(10.5).fillColor('#191512').text(safe(`${time ? time + '   ' : ''}${s.title || 'Session'}`));
                    const meta = [s.room, s.track, s.session_type && s.session_type !== 'talk' ? s.session_type : null].filter(Boolean).join(' · ');
                    if (meta) doc.font(body).fontSize(9.5).fillColor('#4a4239').text(safe(meta));
                    if (s.speaker_names) doc.font(body).fontSize(9.5).fillColor('#4a4239').text(safe(s.speaker_names));
                    if (s.description) doc.font(body).fontSize(9.5).fillColor('#4a4239').text(safe(String(s.description).slice(0, 400)));
                    doc.moveDown(0.45);
                });
            }

            // gala evening (gala_settings — admin content)
            if (gala && (gala.date || gala.title)) {
                pdfSection(p, 'Gala Evening & Annual Awards');
                const when = [isoToLong(gala.date), hhmm(gala.time)].filter(Boolean).join(', ');
                doc.font(bold).fontSize(10.5).fillColor('#191512').text(safe(gala.title || 'Plexus Gala Evening'));
                doc.font(body).fontSize(9.5).fillColor('#4a4239').text(safe([when, gala.venue].filter(Boolean).join(' · ')));
                if (gala.dress_code) doc.text(safe(gala.dress_code));
            }

            // speakers
            pdfSection(p, 'Speakers');
            if (!speakers.length) doc.font(body).fontSize(10.5).fillColor('#4a4239').text(safe('Speakers are announced as they confirm.'), { oblique: true });
            speakers.forEach(sp => {
                doc.font(bold).fontSize(10.5).fillColor('#191512').text(safe(sp.name) + (sp.is_keynote ? '   ' : ''), { continued: !!sp.is_keynote });
                if (sp.is_keynote) doc.font(body).fontSize(8.5).fillColor('#6e5626').text('KEYNOTE', { characterSpacing: 1 });
                const role = [sp.title, sp.institution].filter(Boolean).join(', ');
                if (role) doc.font(body).fontSize(9.5).fillColor('#4a4239').text(safe(role));
                if (sp.talk_title) doc.font(body).fontSize(9.5).fillColor('#4a4239').text(safe(sp.talk_title), { oblique: true });
                doc.moveDown(0.35);
            });

            pdfFooter(p, `Generated ${new Date().toISOString().slice(0, 10)} from the published program · medx.hr · Times may change until the event.`);
            doc.end();
        } catch (e) {
            log('program.pdf failed:', e.message);
            if (!res.headersSent) res.status(500).json({ error: 'Could not generate the program PDF' });
            else try { res.end(); } catch (e2) {}
        }
    });

    // ================================================================ Explore Zagreb — welcome guide PDF
    app.get('/api/v2/plexus/welcome-guide.pdf', (req, res) => {
        try {
            const conf = activeConf() || {};
            const G = ZAGREB_GUIDE;
            const p = pdfDoc(res, `plexus-${conf.year || 2026}-welcome-guide.pdf`);
            const { doc, body, bold, safe } = p;
            pdfHeader(p, G.eyebrow, G.title, G.intro);
            const venue = [conf.venue_name, conf.venue_city].filter(Boolean).join(', ');
            if (conf.start_date) {
                doc.font(body).fontSize(10).fillColor('#191512').text(safe(`${conf.name || 'Plexus Conference'} · ${dateRange(conf.start_date, conf.end_date)}${venue ? ' · ' + venue : ''}`));
            }
            pdfSection(p, G.stops.heading);
            doc.font(body).fontSize(9.5).fillColor('#4a4239').text(safe(G.stops.note)); doc.moveDown(0.3);
            G.stops.items.forEach(([name, note], i) => {
                doc.font(bold).fontSize(10.5).fillColor('#191512').text(safe(`${String(i + 1).padStart(2, '0')}  ${name}`));
                doc.font(body).fontSize(9.5).fillColor('#4a4239').text(safe(note)); doc.moveDown(0.3);
            });
            doc.font(bold).fontSize(10.5).fillColor('#6e5626').text(safe(G.stops.bonus[0]));
            doc.font(body).fontSize(9.5).fillColor('#4a4239').text(safe(G.stops.bonus[1]));
            pdfSection(p, G.taste.heading);
            doc.font(body).fontSize(9.5).fillColor('#4a4239').text(safe(G.taste.note), { oblique: true }); doc.moveDown(0.3);
            G.taste.items.forEach(([name, note]) => {
                doc.font(bold).fontSize(10.5).fillColor('#191512').text(safe(name));
                doc.font(body).fontSize(9.5).fillColor('#4a4239').text(safe(note)); doc.moveDown(0.3);
            });
            pdfSection(p, G.around.heading);
            G.around.items.forEach(([name, note]) => {
                doc.font(bold).fontSize(10.5).fillColor('#191512').text(safe(name) + ' — ', { continued: true });
                doc.font(body).fontSize(10).fillColor('#4a4239').text(safe(note));
            });
            doc.moveDown(0.8);
            doc.font(body).fontSize(11).fillColor('#191512').text(safe(G.closing), { oblique: true });
            pdfFooter(p, 'Med&X · medx.hr · Questions about your trip? Message us from the portal — replies land in your inbox.');
            doc.end();
        } catch (e) {
            log('welcome-guide.pdf failed:', e.message);
            if (!res.headersSent) res.status(500).json({ error: 'Could not generate the welcome guide' });
            else try { res.end(); } catch (e2) {}
        }
    });

    log('plexus: speaker-meta · photos (admin write) · program.pdf · welcome-guide.pdf' + (FONT ? '' : ' (no Unicode PDF font — transliterating)'));
};
