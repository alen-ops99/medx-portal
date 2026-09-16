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
const SUBJECT = 'Your Plexus Week 2026 events & ticket';
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
    const { query, saveDb, flushDb, sendEmail, JWT_SECRET, qrImageUrl, walletLinks, s3 } = deps;
    // Read the DB handle at call time: server.js assigns `db` after this module mounts.
    const db = { run: (...a) => deps.db.run(...a), get: (...a) => deps.db.get(...a), all: (...a) => deps.db.all(...a) };
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
    // Gala-only payers who never used the Zagreb multi-event form (standalone gala page, invite
    // links, older sign-ups) hold a Gala ticket too, so they get the program & ticket email like
    // everyone else. They have no CA row: a synthetic one carries what buildFor() reads, the
    // sent-marker lives on gala_registrations.admin_notes, and the QR/pass is their gala row.
    function standaloneGalaRows() {
        const gs = query.all(`SELECT g.* FROM gala_registrations g
            WHERE COALESCE(g.email, '') <> ''
              AND NOT EXISTS (SELECT 1 FROM croatians_abroad_registrations c WHERE c.gala_registration_id = g.id)
            ORDER BY rowid`) || [];
        return gs
            .filter(g => PAID_STATES.includes(String(g.payment_status || '').toLowerCase()) && String(g.status || '') !== 'cancelled')
            .map(g => {
                const ca = { id: g.id, first_name: g.first_name, last_name: g.last_name, email: g.email, institution: g.institution || '',
                    country: '', source: 'gala', guest_count: g.guest_count, notes: g.admin_notes || '',
                    selected_conference: 0, selected_bridges: 0, selected_gala: 1, gala_registration_id: g.id };
                const mark = reviewGate.getMarker(g.admin_notes, MARK) || null;
                return { ca, g, state: 'paid', legs: ['gala'], paid: true, payLink: false, standalone: true, sent: !!mark, sent_at: mark };
            });
    }
    function rows() {
        const cas = query.all(`SELECT * FROM croatians_abroad_registrations ORDER BY created_at, rowid`) || [];
        const linked = cas.map(ca => {
            const g = ca.gala_registration_id ? query.get('SELECT * FROM gala_registrations WHERE id = ?', [ca.gala_registration_id]) : null;
            const c = classify(ca, g);
            return { ca, g, ...c, sent: wasSent(ca), sent_at: reviewGate.getMarker(ca.notes, MARK) || null };
        });
        return linked.concat(standaloneGalaRows());
    }
    function summary(all) {
        const count = st => all.filter(r => r.state === st).length;
        const eligible = all.filter(r => SENDABLE.includes(r.state));
        return {
            eligible: eligible.length,
            sent: eligible.filter(r => r.sent).length,
            unsent: eligible.filter(r => !r.sent).length,
            paid: count('paid'), unpaid_gala: count('unpaid-gala'), free: count('free'),
            // seats = registrant + guests (guest_count is ADDITIONAL guests everywhere in this codebase)
            paid_seats: all.filter(r => r.state === 'paid').reduce((n, r) => n + 1 + Math.max(0, parseInt((r.g || r.ca).guest_count, 10) || 0), 0),
            paid_standalone: all.filter(r => r.state === 'paid' && r.standalone).length,
            skipped_held: count('held'), skipped_cancelled: count('cancelled'), skipped_unpaid_gala_only: count('unpaid-only')
        };
    }
    const rowJson = r => ({
        id: r.ca.id, gala_registration_id: r.ca.gala_registration_id || null,
        name: `${r.ca.first_name || ''} ${r.ca.last_name || ''}`.trim(), email: r.ca.email, institution: r.ca.institution || '',
        country: r.ca.country || '', source: r.ca.source || 'croatians-abroad',
        state: r.state, legs: r.legs, party: 1 + Math.max(0, parseInt((r.g || r.ca).guest_count, 10) || 0),
        pay_link: r.payLink, invoice: r.g ? (r.g.invoice_number || null) : null,
        sent: r.sent, sent_at: r.sent_at, standalone: !!r.standalone
    });

    // ---------------------------------------------------------------- the email for one row
    function buildFor(r, opts) {
        const o = opts || {};
        const base = publicBase();
        const F = facts();
        const ca = r.ca, g = r.g;
        const seats = 1 + Math.max(0, parseInt((g || ca).guest_count, 10) || 0);
        const qrId = r.paid && g ? g.id : ca.id;
        const named = query.all('SELECT * FROM ca_registration_guests WHERE registration_id = ? ORDER BY rowid', [ca.id]) || [];
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
            headlineHtml: 'Plexus Week 2026 — your events and your ticket.',
            subjectTitle: SUBJECT,
            preheader: 'Your Plexus Week 2026 events and your ticket, ready for your wallet — the program is attached.',
            guestsHtml: r.paid ? plexusTicket.guestsHtml(named) : ''
        };
        const party = plexusTicket.partyByLeg(r.legs, named, seats);
        common.party = party;
        const legsText = plexusTicket.joinAnd(plexusTicket.legNamesWithParty(r.legs, F, r.paid ? party : {}));
        if (r.state === 'paid') {
            return plexusTicket.ticketEmail('combined', {
                ...common,
                introHtml: `Dear ${escapeHtml(ca.first_name || 'there')} — here are your Plexus Week 2026 events and your ticket for ${escapeHtml(legsText)}. The program is attached as a PDF. Add the ticket to your wallet and bring the QR below; it admits you at every event you hold.`,
                partyNote: galaPayLink.partyNote(seats, withEmail)
            });
        }
        if (r.state === 'unpaid-gala') {
            // Everything automated (Alen 2026-09-16): a reserved-but-unpaid seat ALWAYS gets its pay
            // button. Rows that never had a link (Stripe session expired before pay-links existed)
            // get one minted here — same token shape as gala-paylink.js, and /pay/gala/:token needs
            // status 'approved', so a still-'awaiting_payment' row is released to it on the spot.
            if (g && !g.pay_token) {
                g.pay_token = galaPayLink.mintPayToken();
                db.run("UPDATE gala_registrations SET pay_token = ?, status = CASE WHEN status = 'awaiting_payment' THEN 'approved' ELSE status END WHERE id = ?", [g.pay_token, g.id]);
                try { saveDb && saveDb(); } catch (e) {}
            }
            const payUrl = g && g.pay_token ? `${base}/pay/gala/${g.pay_token}` : null;
            // The pay button sits DIRECTLY under the sentence that asks for it (Alen 2026-09-16), the
            // free-events QR + passes stay, and the copy says plainly that the Gala joins this same
            // ticket on payment — same QR identity, the wallet pass upgrades in place, never a second one.
            return plexusTicket.ticketEmail('free', {
                ...common,
                introHtml: `Dear ${escapeHtml(ca.first_name || 'there')} — here are your Plexus Week 2026 events and your ticket for ${escapeHtml(legsText)}. The program is attached as a PDF. Your Gala Evening seat is still reserved for you — one step completes it:`,
                ctaUrl: payUrl || undefined, ctaLabel: payUrl ? 'COMPLETE MY GALA RESERVATION →' : undefined, ctaPosition: 'top',
                ctaNote: 'Secure card payment via Stripe. Your Gala entry is added the moment it is done.',
                extraNote: 'This ticket already covers ' + escapeHtml(plexusTicket.joinAnd(plexusTicket.legNames(r.legs, F))) + '. When your Gala payment is done, the Gala is added to this same ticket — the QR stays the same and your wallet pass updates itself; you will not get a second pass.'
            });
        }
        return plexusTicket.ticketEmail('free', {
            ...common,
            introHtml: `Dear ${escapeHtml(ca.first_name || 'there')} — here are your Plexus Week 2026 events and your ticket for ${escapeHtml(legsText)}. The program is attached as a PDF. There is nothing to pay — add the ticket to your wallet and bring the QR below.`
        });
    }
    function guestEmails(r, program) {
        if (!r.paid || !r.g) return [];
        const named = query.all('SELECT * FROM ca_registration_guests WHERE registration_id = ? AND COALESCE(email, \'\') <> \'\' ORDER BY rowid', [r.ca.id]) || [];
        const registrantName = `${r.ca.first_name || ''} ${r.ca.last_name || ''}`.trim();
        // Each guest gets THEIR legs (2026-09-16): a Conference-only guest gets a free entry, not a Gala one.
        return named.map(gst => ({ gst, own: plexusTicket.guestLegs(gst).filter(l => r.legs.includes(l)) })).filter(x => x.own.length).map(({ gst, own }) => ({
            to: gst.email,
            subject: own.includes('gala') ? 'Your Plexus Week 2026 program & Gala entry' : 'Your Plexus Week 2026 program & entry',
            html: plexusTicket.ticketEmail(own.includes('gala') ? 'gala-guest' : 'free', {
                firstName: String(gst.name || 'there').split(' ')[0], fullName: String(gst.name || '').trim() || 'Guest',
                legs: own, seats: 1, guestOf: registrantName, seat: own.includes('gala') ? (r.g.seat_number || null) : null,
                ticketCode: String(r.g.id).slice(0, 8).toUpperCase(),
                qrPngUrl: qrImageUrl(own.includes('gala') ? r.g.id : r.ca.id), wallet: walletLinks('guest', gst.id),
                calendarUrl: plexusTicket.calendarUrl(publicBase(), own), facts: facts(),
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
        if (r.standalone) db.run('UPDATE gala_registrations SET admin_notes = ? WHERE id = ?', [reviewGate.upsertMarker(r.g.admin_notes, MARK, todayIso()), r.g.id]);
        else db.run('UPDATE croatians_abroad_registrations SET notes = ? WHERE id = ?', [reviewGate.upsertMarker(r.ca.notes, MARK, todayIso()), r.ca.id]);
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
