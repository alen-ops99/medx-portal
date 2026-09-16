/**
 * plexus-program.js — "Your Plexus Week 2026 program & ticket": the one-touch re-send to every
 * Zagreb registrant, modelled on the Boston one-email machinery (Alen 2026-09-15 — built now,
 * SENT IN NOVEMBER once the program is final; nothing here ever sends without the team's click).
 *
 * Per registrant: the Boston-style ticket family (plexus-ticket.js) with a program framing —
 * "here is your program and your ticket — add it to your wallet" — the program PDF attached,
 * the final Conference and Building Bridges Zagreb dates/venues from plexus_settings (admin-
 * editable through the PROGRAM & TICKETS panel), the ticket card (hosted QR, legs held, party
 * size), Apple Wallet · Google Wallet · Add to calendar, the guest note, Laura.
 *
 * Branching per row (classify()):
 *   paid          Gala paid / comped            → the combined ticket
 *   unpaid-gala   Gala approved, pay link minted → the free-legs ticket + "Complete your Gala
 *                                                  reservation" button (their existing pay link)
 *   free          no Gala                        → the free-legs ticket
 *   held          any leg 'pending-review'       → SKIPPED, never emailed (the gate rule stands)
 *   cancelled     every leg cancelled            → SKIPPED
 *   unpaid-only   Gala unpaid AND no free legs   → SKIPPED (there is no ticket to send; the
 *                                                  unpaid-gala nudge is the tool for them)
 * Named guests with an email get their guest copy in the same style (Gala guests once paid).
 *
 * The program PDF is the gate exactly like Boston: 'all' and single sends refuse until it is
 * uploaded; previews go out without it, marked. Every real send is stamped PROGRAM-TICKET-SENT
 * <date> in the row's notes so 'all' never re-sends; a single-row send always re-sends.
 *
 * Team routes, key-gated like Boston (key = HMAC-SHA256(JWT_SECRET, 'plexus-admin')[0..40)) so
 * whichever admin is live in November can drive them through a proxy:
 *   GET  /api/plexus/program?key=               status · settings · counts · rows
 *   POST /api/plexus/program?key=               multipart PDF → S3 (replaces)
 *   PUT  /api/plexus/program/settings?key=      { conference_venue, conference_start_date,
 *                                                 bridges_zagreb_date, bridges_zagreb_time, bridges_zagreb_venue }
 *   POST /api/plexus/program/send?key=          { to:'preview'|'all'|'<ca id>', variant?:'paid'|'unpaid'|'free' }
 */
'use strict';

const crypto = require('crypto');
const reviewGate = require('./review-gate');
const plexusTicket = require('./plexus-ticket');
const galaPayLink = require('./gala-paylink');

const MARK = 'PROGRAM-TICKET-SENT';
const PROGRAM_UPLOAD_KEY = 'plexus/program/program.pdf';
const PROGRAM_FILENAME = 'Plexus-Week-2026-Program.pdf';
const MAX_PROGRAM_BYTES = 10 * 1024 * 1024;
const SUBJECT = 'Your Plexus Week 2026 program & ticket';
const PAID_STATES = ['paid', 'vip-comp', 'comp'];

function tryRequire(name) { try { return require(name); } catch (e) { return null; } }
const multerLib = tryRequire('multer');

const publicBase = () => String(process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || 'https://medx-user-portal.onrender.com').replace(/\/+$/, '');
const todayIso = () => new Date().toISOString().slice(0, 10);
const live = s => ['pre-registered', 'confirmed'].includes(String(s || ''));
const pdfMagicOk = buf => !!(buf && buf.length > 8 && buf.slice(0, 1024).includes('%PDF'));

// ---------------------------------------------------------------- classification (pure)
/**
 * @param {object} ca croatians_abroad_registrations row
 * @param {object|null} g the linked gala_registrations row (or null)
 * @returns {{state:'paid'|'unpaid-gala'|'free'|'held'|'cancelled'|'unpaid-only', legs:string[], paid:boolean, payLink:boolean}}
 */
function classify(ca, g) {
    const sel = { conference: !!Number(ca.selected_conference), bridges: !!Number(ca.selected_bridges), gala: !!Number(ca.selected_gala) };
    const statuses = [sel.conference ? ca.conference_status : null, sel.bridges ? ca.bridges_status : null, sel.gala ? ca.gala_status : null].filter(Boolean);
    if (statuses.includes('pending-review')) return { state: 'held', legs: [], paid: false, payLink: false };
    if (statuses.length && statuses.every(s => s === 'cancelled')) return { state: 'cancelled', legs: [], paid: false, payLink: false };
    if (g && String(g.status || '') === 'cancelled' && !live(ca.conference_status) && !live(ca.bridges_status)) return { state: 'cancelled', legs: [], paid: false, payLink: false };
    const freeLegs = [sel.conference && live(ca.conference_status) ? 'conference' : null, sel.bridges && live(ca.bridges_status) ? 'bridges' : null].filter(Boolean);
    const galaPaid = !!(g && PAID_STATES.includes(String(g.payment_status || '').toLowerCase()) && String(g.status || '') !== 'cancelled');
    if (galaPaid) return { state: 'paid', legs: [...freeLegs, 'gala'], paid: true, payLink: false };
    if (sel.gala && g && String(g.status || '') !== 'cancelled') {
        if (!freeLegs.length) return { state: 'unpaid-only', legs: [], paid: false, payLink: !!g.pay_token };
        return { state: 'unpaid-gala', legs: freeLegs, paid: false, payLink: !!(g.pay_token && String(g.status) === 'approved') };
    }
    if (!freeLegs.length) return { state: 'cancelled', legs: [], paid: false, payLink: false };
    return { state: 'free', legs: freeLegs, paid: false, payLink: false };
}
const SENDABLE = ['paid', 'unpaid-gala', 'free'];
const wasSent = ca => !!reviewGate.getMarker(ca.notes, MARK);

// ---------------------------------------------------------------- mount
module.exports = function mountPlexusProgram(app, deps) {
    const { query, db, saveDb, flushDb, sendEmail, JWT_SECRET, qrImageUrl, walletLinks, s3 } = deps;
    const log = deps.log || ((...a) => console.log('[PlexusProgram]', ...a));
    const adminKey = () => crypto.createHmac('sha256', String(JWT_SECRET)).update('plexus-admin').digest('hex').slice(0, 40);
    const checkKey = k => { const e = adminKey(); const s = String(k || ''); try { return s.length === e.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(e)); } catch (x) { return false; } };
    const programKey = () => process.env.PLEXUS_PROGRAM_PDF_KEY || PROGRAM_UPLOAD_KEY;

    // ---------------------------------------------------------------- settings (plexus_settings)
    function settings() {
        try { return query.get("SELECT * FROM plexus_settings WHERE id = 'default'") || {}; } catch (e) { return {}; }
    }
    const facts = () => plexusTicket.legFacts(settings());

    // ---------------------------------------------------------------- the program PDF
    async function programStatus() {
        const key = programKey();
        if (!s3 || !s3.isConfigured()) return { present: false, configured: false, key, filename: PROGRAM_FILENAME };
        let head = null;                                  // null = not there (or unreadable) — never a 500
        try { head = typeof s3.headObject === 'function' ? await s3.headObject(key) : null; }
        catch (e) { log('program head failed:', e.message); head = null; }
        return { present: !!head, configured: true, key, filename: PROGRAM_FILENAME, size: head ? head.size : null, uploaded_at: head ? head.lastModified : null, source: key === PROGRAM_UPLOAD_KEY ? 'upload' : 'env' };
    }
    async function loadProgramAttachment() {
        if (!s3 || !s3.isConfigured()) return null;
        try {
            const buf = await s3.getObject(programKey());
            if (!buf || !buf.length) return null;
            return { filename: PROGRAM_FILENAME, content: buf, type: 'application/pdf' };
        } catch (e) { log('program PDF unavailable:', e.message); return null; }
    }
    const programMulter = multerLib ? multerLib({ storage: multerLib.memoryStorage(), limits: { fileSize: MAX_PROGRAM_BYTES, files: 1 } }).single('file') : null;
    function programParser(req, res, next) {
        if (!programMulter) return res.status(503).json({ error: 'Uploads are momentarily unavailable. Please try again shortly.' });
        programMulter(req, res, err => {
            if (!err) return next();
            if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'That file is over the 10 MB limit. Please compress the PDF and try again.' });
            return res.status(400).json({ error: 'We could not read that upload. Please try again with a PDF.' });
        });
    }

    // ---------------------------------------------------------------- rows
    function rows() {
        const cas = query.all(`SELECT * FROM croatians_abroad_registrations ORDER BY created_at, rowid`) || [];
        return cas.map(ca => {
            const g = ca.gala_registration_id ? query.get('SELECT * FROM gala_registrations WHERE id = ?', [ca.gala_registration_id]) : null;
            const c = classify(ca, g);
            return { ca, g, ...c, sent: wasSent(ca), sent_at: reviewGate.getMarker(ca.notes, MARK) || null };
        });
    }
    function summary(all) {
        const count = st => all.filter(r => r.state === st).length;
        const eligible = all.filter(r => SENDABLE.includes(r.state));
        return {
            eligible: eligible.length,
            sent: eligible.filter(r => r.sent).length,
            unsent: eligible.filter(r => !r.sent).length,
            paid: count('paid'), unpaid_gala: count('unpaid-gala'), free: count('free'),
            skipped_held: count('held'), skipped_cancelled: count('cancelled'), skipped_unpaid_gala_only: count('unpaid-only')
        };
    }
    const rowJson = r => ({
        id: r.ca.id, gala_registration_id: r.ca.gala_registration_id || null,
        name: `${r.ca.first_name || ''} ${r.ca.last_name || ''}`.trim(), email: r.ca.email, institution: r.ca.institution || '',
        country: r.ca.country || '', source: r.ca.source || 'croatians-abroad',
        state: r.state, legs: r.legs, party: 1 + Math.max(0, parseInt((r.g || r.ca).guest_count, 10) || 0),
        pay_link: r.payLink, invoice: r.g ? (r.g.invoice_number || null) : null,
        sent: r.sent, sent_at: r.sent_at
    });

    // ---------------------------------------------------------------- the email for one row
    function buildFor(r, opts) {
        const o = opts || {};
        const base = publicBase();
        const F = facts();
        const ca = r.ca, g = r.g;
        const seats = 1 + Math.max(0, parseInt((g || ca).guest_count, 10) || 0);
        const qrId = r.paid && g ? g.id : ca.id;
        const named = query.all('SELECT id, name, email FROM ca_registration_guests WHERE registration_id = ?', [ca.id]) || [];
        const withEmail = named.filter(x => String(x.email || '').trim()).length;
        const fullName = `${ca.first_name || ''} ${ca.last_name || ''}`.trim();
        const common = {
            firstName: ca.first_name, fullName, legs: r.legs, seats: r.paid ? seats : 1,
            amount: r.paid && g ? Number(g.amount_paid || 0) : 0, invoice: r.paid && g ? g.invoice_number : null,
            seat: g ? g.seat_number : null, source: ca.source,
            ticketCode: String(qrId).slice(0, 8).toUpperCase(),
            qrPngUrl: qrImageUrl(qrId), wallet: walletLinks(r.paid ? 'gala' : 'ca', qrId),
            calendarUrl: plexusTicket.calendarUrl(base, r.legs), facts: F,
            programAttached: !!o.programAttached,
            kicker: 'YOUR PROGRAM & TICKET',
            headlineHtml: 'Plexus Week 2026 — your program and your ticket.',
            subjectTitle: SUBJECT,
            preheader: 'The Plexus Week 2026 program is attached — and here is your ticket, ready for your wallet.',
            guestsHtml: r.paid ? plexusTicket.guestsHtml(named) : ''
        };
        const legsText = plexusTicket.joinAnd(plexusTicket.legNames(r.legs, F));
        if (r.state === 'paid') {
            return plexusTicket.ticketEmail('combined', {
                ...common,
                introHtml: `Dear ${escapeHtml(ca.first_name || 'there')} — here is your program for Plexus Week 2026 (attached as a PDF) and your ticket for ${escapeHtml(legsText)}${seats > 1 ? ` — <b>${seats} Gala seats</b>` : ''}. Add it to your wallet and bring the QR below; it admits you at every event you hold.`,
                partyNote: galaPayLink.partyNote(seats, withEmail)
            });
        }
        if (r.state === 'unpaid-gala') {
            const payUrl = g && g.pay_token ? `${base}/pay/gala/${g.pay_token}` : null;
            return plexusTicket.ticketEmail('free', {
                ...common,
                introHtml: `Dear ${escapeHtml(ca.first_name || 'there')} — here is your program for Plexus Week 2026 (attached as a PDF) and your ticket for ${escapeHtml(legsText)}. Your Gala Evening seat is still reserved for you — one step completes it${payUrl ? ' (the button below)' : ''}.`,
                ctaUrl: payUrl || undefined, ctaLabel: payUrl ? 'COMPLETE MY GALA RESERVATION →' : undefined,
                extraNote: payUrl ? 'Your Gala Evening seat is held but not yet confirmed — the button above opens the secure card payment; your Gala entry follows the moment it is done.' : 'Your Gala Evening seat is held but not yet confirmed — just reply to this email and we will send you the payment link.'
            });
        }
        return plexusTicket.ticketEmail('free', {
            ...common,
            introHtml: `Dear ${escapeHtml(ca.first_name || 'there')} — here is your program for Plexus Week 2026 (attached as a PDF) and your ticket for ${escapeHtml(legsText)}. There is nothing to pay — add it to your wallet and bring the QR below.`
        });
    }
    function guestEmails(r, program) {
        if (!r.paid || !r.g) return [];
        const named = query.all('SELECT id, name, email FROM ca_registration_guests WHERE registration_id = ? AND COALESCE(email, \'\') <> \'\'', [r.ca.id]) || [];
        const registrantName = `${r.ca.first_name || ''} ${r.ca.last_name || ''}`.trim();
        return named.map(gst => ({
            to: gst.email,
            subject: 'Your Plexus Week 2026 program & Gala entry',
            html: plexusTicket.ticketEmail('gala-guest', {
                firstName: String(gst.name || 'there').split(' ')[0], fullName: String(gst.name || '').trim() || 'Guest',
                legs: ['gala'], seats: 1, guestOf: registrantName, seat: r.g.seat_number || null,
                ticketCode: String(r.g.id).slice(0, 8).toUpperCase(),
                qrPngUrl: qrImageUrl(r.g.id), wallet: walletLinks('guest', gst.id),
                calendarUrl: plexusTicket.calendarUrl(publicBase(), ['gala']), facts: facts(),
                programAttached: !!program, kicker: 'YOUR PROGRAM & TICKET',
                headlineHtml: 'Plexus Week 2026 — your program and your Gala entry.',
                subjectTitle: 'Your Plexus Week 2026 program & Gala entry'
            })
        }));
    }
    const escapeHtml = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    async function sendOne(r, program) {
        const out = await sendEmail(r.ca.email, SUBJECT, buildFor(r, { programAttached: !!program }), program ? [program] : undefined);
        if (!out || out.success === false || out.mock) return { ok: false, error: (out && out.error) || (out && out.mock ? 'mock mode' : 'unknown') };
        db.run('UPDATE croatians_abroad_registrations SET notes = ? WHERE id = ?', [reviewGate.upsertMarker(r.ca.notes, MARK, todayIso()), r.ca.id]);
        try { saveDb && saveDb(); } catch (e) {}
        let guests = 0;
        for (const ge of guestEmails(r, program)) {
            try { const g2 = await sendEmail(ge.to, ge.subject, ge.html, program ? [program] : undefined); if (g2 && g2.success !== false && !g2.mock) guests++; }
            catch (e) { log('guest copy failed (non-blocking):', e.message); }
        }
        return { ok: true, guests };
    }

    // ---------------------------------------------------------------- routes
    app.get('/api/plexus/program', async (req, res) => {
        try {
            if (!checkKey(req.query && req.query.key)) return res.status(404).json({ error: 'Not found' });
            const all = rows();
            res.set('Cache-Control', 'private, no-store');
            res.json({ program: await programStatus(), settings: (({ conference_venue, conference_start_date, conference_end_date, bridges_zagreb_date, bridges_zagreb_time, bridges_zagreb_venue }) => ({ conference_venue, conference_start_date, conference_end_date, bridges_zagreb_date, bridges_zagreb_time, bridges_zagreb_venue }))(settings()),
                facts: facts(), counts: summary(all), rows: all.map(rowJson), subject: SUBJECT, marker: MARK });
        } catch (e) { log('status failed:', e.message); res.status(500).json({ error: 'Could not read the program status.' }); }
    });

    app.post('/api/plexus/program', programParser, async (req, res) => {
        try {
            if (!checkKey(req.query && req.query.key)) return res.status(404).json({ error: 'Not found' });
            if (!s3 || !s3.isConfigured()) return res.status(503).json({ error: 'File storage is not configured on this server yet.' });
            const f = req.file;
            if (!f || !f.buffer || !f.buffer.length) return res.status(400).json({ error: 'Choose the program PDF first.' });
            if (!/\.pdf$/i.test(String(f.originalname || ''))) return res.status(400).json({ error: 'PDF only, please.' });
            if (!pdfMagicOk(f.buffer)) return res.status(400).json({ error: 'That file does not look like a real PDF inside. Please re-export it and try again.' });
            await s3.putObject(PROGRAM_UPLOAD_KEY, f.buffer, 'application/pdf');
            log(`program PDF replaced (${f.buffer.length} bytes)`);
            res.json({ success: true, size: f.buffer.length, key: PROGRAM_UPLOAD_KEY, uploaded_at: new Date().toISOString() });
        } catch (e) { log('program upload failed:', e.message); res.status(502).json({ error: 'The upload did not go through. Please try again.' }); }
    });

    app.put('/api/plexus/program/settings', async (req, res) => {
        try {
            if (!checkKey(req.query && req.query.key)) return res.status(404).json({ error: 'Not found' });
            const b = req.body || {};
            const clean = (v, n) => { const s = String(v == null ? '' : v).trim().slice(0, n); return s || null; };
            const date = v => { const s = clean(v, 10); return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; };
            const time = v => { const s = clean(v, 5); return s && /^\d{1,2}:\d{2}$/.test(s) ? s : null; };
            const patch = {
                conference_venue: clean(b.conference_venue, 160),
                conference_start_date: date(b.conference_start_date),
                bridges_zagreb_date: date(b.bridges_zagreb_date),
                bridges_zagreb_time: time(b.bridges_zagreb_time),
                bridges_zagreb_venue: clean(b.bridges_zagreb_venue, 160)
            };
            const keys = Object.keys(patch).filter(k => Object.prototype.hasOwnProperty.call(b, k));
            if (!keys.length) return res.status(400).json({ error: 'Nothing to save.' });
            if (!query.get("SELECT id FROM plexus_settings WHERE id = 'default'")) db.run("INSERT INTO plexus_settings (id) VALUES ('default')");
            db.run(`UPDATE plexus_settings SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = 'default'`, keys.map(k => patch[k]));
            try { saveDb && saveDb(); } catch (e) {}
            try { flushDb && flushDb(); } catch (e) {}
            res.json({ success: true, settings: settings(), facts: facts() });
        } catch (e) { log('settings failed:', e.message); res.status(500).json({ error: 'Could not save the settings.' }); }
    });

    app.post('/api/plexus/program/send', async (req, res) => {
        try {
            if (!checkKey(req.query && req.query.key)) return res.status(404).json({ error: 'Not found' });
            const body = req.body || {};
            const to = String(body.to || '').trim();
            const all = rows();
            const program = await loadProgramAttachment();

            if (to === 'preview') {
                const VARIANTS = { paid: 'paid', unpaid: 'unpaid-gala', free: 'free' };
                const wanted = String(body.variant || '').trim().toLowerCase();
                if (wanted && !VARIANTS[wanted]) return res.status(400).json({ error: 'variant must be "paid", "unpaid" or "free".' });
                const list = wanted ? [wanted] : Object.keys(VARIANTS);
                const previewTo = String(body.to_email || '').trim() || reviewGate.REVIEW_TO;
                const sentTo = [];
                for (const v of list) {
                    const sample = all.find(r => r.state === VARIANTS[v] && (body.id ? String(r.ca.id) === String(body.id) : true));
                    if (!sample) continue;
                    const html = buildFor(sample, { programAttached: !!program });
                    await sendEmail(previewTo, `[PREVIEW · program & ticket · ${v === 'unpaid' ? 'unpaid gala' : v === 'free' ? 'free only' : 'paid'}${program ? '' : ' · program PDF not uploaded yet'}] ${SUBJECT}`, html, program ? [program] : undefined);
                    sentTo.push({ variant: v, sample: sample.ca.email });
                }
                return res.json({ success: true, preview_to: previewTo, previews: sentTo, program_attached: !!program, counts: summary(all) });
            }
            if (to !== 'all' && !to) return res.status(400).json({ error: 'Say who: "preview", "all", or a registration id.' });
            if (!program) return res.status(400).json({ error: 'Upload the program PDF first — nobody gets this email without it.' });
            const targets = to === 'all'
                ? all.filter(r => SENDABLE.includes(r.state) && !r.sent)
                : all.filter(r => String(r.ca.id) === to && SENDABLE.includes(r.state));
            if (to !== 'all' && !targets.length) {
                const r = all.find(x => String(x.ca.id) === to);
                return res.status(r ? 409 : 404).json({ error: r ? `This registration is ${r.state} — it is never emailed by this tool.` : 'Registration not found.' });
            }
            const sent = [], failed = [];
            let guests = 0;
            for (const r of targets) {
                try { const out = await sendOne(r, program); if (out.ok) { sent.push(r.ca.email); guests += out.guests; } else failed.push({ email: r.ca.email, error: out.error }); }
                catch (e) { failed.push({ email: r.ca.email, error: e.message }); }
            }
            try { flushDb && flushDb(); } catch (e) {}
            log(`program & ticket sent: ${sent.length}/${targets.length} (+${guests} guest copies)${failed.length ? `, ${failed.length} failed` : ''}`);
            return res.json({ success: true, sent, guests, failed, skipped_already_sent: to === 'all' ? all.filter(r => SENDABLE.includes(r.state) && r.sent).length : 0, counts: summary(rows()) });
        } catch (e) { log('send failed:', e.message); res.status(500).json({ error: e.message }); }
    });

    log('plexus-program: /api/plexus/program routes ready (send in November — nothing automatic)');
    return { classify, rows, summary, buildFor, adminKey };
};

module.exports.classify = classify;
module.exports.MARK = MARK;
module.exports.SUBJECT = SUBJECT;
module.exports.PROGRAM_UPLOAD_KEY = PROGRAM_UPLOAD_KEY;
