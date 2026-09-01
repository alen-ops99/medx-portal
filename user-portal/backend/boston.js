/**
 * boston.js — "Building Bridges in Biomedicine — Boston" public wing (additive, self-contained).
 *
 * Monday, 21 September 2026 · 18:00 (doors 17:30) · Waterhouse Room, Gordon Hall,
 * 25 Shattuck Street, Harvard Medical School, Boston, MA. Free, business attire,
 * co-organized with the Harvard Medical Postdoc Association (HMPA).
 *
 * Mounted from server.js as: require('./boston')(app, { query, saveDb, sendEmail, flushDb, JWT_SECRET })
 *   - query     — server.js's { run, get, all } helper (run() persists via saveDb itself)
 *   - sendEmail — server.js's sendEventConfirmation (CCs Laura on every confirmation)
 *   - flushDb   — optional durability flush after inserts (same call the sibling
 *                 /api/public-events/register makes); absent → skipped
 *   - JWT_SECRET— HMAC key for the no-login Apple-pass download tokens
 *
 * Routes (all public, all additive — nothing existing is touched):
 *   GET  /boston                          — standalone registration page (ink/cream/crimson/gold)
 *   GET  /boston/hero.jpg, /boston/hmpa.png — page assets served from this backend
 *   POST /api/boston/register             — register (dedupe by email → re-send, {already:true})
 *   GET  /boston.ics                      — single-VEVENT calendar file (18:00–21:00 EDT = 22:00Z–01:00Z)
 *   GET  /api/boston/pass/:token.pkpass   — HMAC-tokenized Apple Wallet pass (no login)
 *
 * Storage: the existing bridges_events / bridges_registrations tables — the Boston event row is
 * find-or-created with the FIXED id below (INSERT OR IGNORE), so /qr/:id.png, the door scanner's
 * bridges mode and the admin bridges views all see these registrations with zero schema change.
 */
'use strict';

const path = require('path');
const crypto = require('crypto');
const emailTemplates = require('./v2/email-templates');
const applePass = require('./v2/apple-pass');
const wallet = require('../../shared/wallet');

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

const LOGO_URL = process.env.EMAIL_LOGO_URL || 'https://cdn.jsdelivr.net/gh/alen-ops99/medx-portal@main/user-portal/frontend/assets/images/medx-logo.png';
const baseUrl = () => String(process.env.RENDER_EXTERNAL_URL || 'https://medx-user-portal.onrender.com').replace(/\/+$/, '');
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ticketNo = id => 'BB-BOS-' + String(id).slice(0, 8).toUpperCase();
const shortCode = id => String(id).slice(0, 8).toUpperCase();

const RESEND_AT = new Map(); // email -> last re-send ms (per process; resets on deploy — fine)

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

    // ------------------------------------------------------------ Apple pass download token
    // hex HMAC-SHA256(JWT_SECRET, 'boston:'+id).slice(0,32) + '.' + id — possession = authorization
    // (the token only ever travels inside the guest's own confirmation email).
    const passSig = id => crypto.createHmac('sha256', String(JWT_SECRET)).update('boston:' + String(id)).digest('hex').slice(0, 32);
    const passToken = id => passSig(id) + '.' + String(id);
    function verifyPassToken(token) {
        const m = /^([0-9a-f]{32})\.([0-9a-fA-F-]{16,64})$/.exec(String(token || ''));
        if (!m) return null;
        const expect = passSig(m[2]);
        if (!crypto.timingSafeEqual(Buffer.from(m[1]), Buffer.from(expect))) return null;
        return m[2];
    }

    // ------------------------------------------------------------ confirmation email
    function confirmationEmailHtml(reg, presentation) {
        const base = baseUrl();
        const id = String(reg.id);
        const fullName = `${reg.first_name || ''} ${reg.last_name || ''}`.trim() || 'Med&X Guest';
        const first = reg.first_name || 'there';

        // Google Wallet — minted exactly as the v2 wallet does for bridges tickets (shared/wallet.js
        // builders; approved event class from env; deterministic object id; provisioning is
        // non-blocking and failure never holds up the email).
        let walletSaveUrl = null;
        if (wallet.isConfigured()) {
            try {
                const classId = process.env.GOOGLE_WALLET_EVENT_CLASS_ID || wallet.classIdFor('bridges-boston-2026');
                const classBody = wallet.buildEventTicketClass({
                    classId, issuerName: 'Med&X', eventName: EVENT_NAME,
                    venue: VENUE_NAME, venueAddress: '25 Shattuck Street, Harvard Medical School, Boston, MA',
                    startISO: '2026-09-21T22:00:00Z', endISO: '2026-09-22T01:00:00Z',
                    logoUri: base + '/assets/images/medx-logo.png', hexBackgroundColor: '#14100d', homepageUri: base
                });
                const object = wallet.buildEventTicketObject({
                    objectId: wallet.objectIdFor('t-br-' + id), classId, token: id,
                    name: fullName, registrationNumber: ticketNo(id),
                    category: 'Building Bridges — Boston', statusLabel: 'Confirmed',
                    events: [`Building Bridges in Biomedicine — Boston · ${DATE_LONG} · 18:00 · Gordon Hall, Harvard Medical School`],
                    dressCode: DRESS,
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
            qrPngUrl: `${base}/qr/${id}.png`,
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
                fields: {
                    header: [{ key: 'event', label: 'BUILDING BRIDGES 2026', value: 'Boston' }],
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

    console.log('[Boston] Building Bridges Boston wing mounted (/boston)');
};

// ---------------------------------------------------------------- the page
// Same premium ink/cream/crimson/gold language as the portal's public shells (premiumPage):
// warm-ink hero carrying the HMS facade + white logotype, Fraunces serif headlines, cream ground,
// crimson primary action, gold hairline details. Mobile-first — composed on a 390px column.
function bostonPage() {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Building Bridges in Biomedicine — Boston · Med&amp;X</title>
<meta name="description" content="Building Bridges in Biomedicine — Boston. ${esc(DATE_LONG)} · 18:00 · Waterhouse Room, Gordon Hall, Harvard Medical School. Free, by registration.">
<link rel="icon" type="image/png" href="/assets/favicon-x.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,400&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root{--ink:#211b17;--ink-deep:#1b1613;--cream:#efe7d6;--sheet:#fbf8f1;--text:#2c2521;--muted:#6f6256;--gold:#b0893b;--gold-soft:rgba(176,137,59,.32);--crimson:#8f2d2a;--crimson-dark:#772320;}
*{box-sizing:border-box;margin:0;padding:0;}
body{min-height:100vh;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;color:var(--text);
  background:radial-gradient(1200px 640px at 50% -8%,#f6efe0,transparent 62%),var(--cream);-webkit-font-smoothing:antialiased;}
/* ---- hero — the invitation's dark HMS facade ---- */
.hero{position:relative;background:var(--ink-deep);color:#f3ece0;overflow:hidden;}
.hero .bg{position:absolute;inset:0;background:url('/boston/hero.jpg') center 32%/cover no-repeat;opacity:.6;}
.hero .veil{position:absolute;inset:0;background:linear-gradient(180deg,rgba(27,22,19,.55) 0%,rgba(27,22,19,.28) 40%,rgba(27,22,19,.92) 88%,#1b1613 100%);}
.hero .inner{position:relative;max-width:660px;margin:0 auto;padding:clamp(46px,9vw,84px) 22px clamp(40px,7vw,64px);text-align:center;}
.orgs{display:flex;align-items:center;justify-content:center;gap:14px;margin-bottom:clamp(30px,7vw,52px);}
.orgs img.medx{height:26px;width:auto;filter:brightness(0) invert(1);opacity:.95;}
.orgs .x{font-family:'Fraunces',Georgia,serif;font-style:italic;font-size:15px;color:rgba(243,236,224,.55);}
.orgs .hmpa{background:#fdfcf9;border-radius:8px;padding:5px 8px;box-shadow:0 6px 18px -8px rgba(0,0,0,.6);}
.orgs .hmpa img{height:30px;width:auto;display:block;}
.kicker{font-size:11px;font-weight:600;letter-spacing:3.2px;text-transform:uppercase;color:var(--gold);margin-bottom:16px;}
.hero h1{font-family:'Fraunces',Georgia,'Times New Roman',serif;font-weight:500;font-size:clamp(34px,8.6vw,54px);line-height:1.06;letter-spacing:-.5px;color:#f7f1e6;}
.hero h1 .city{display:block;font-style:italic;font-weight:400;color:var(--gold);font-size:clamp(26px,6.4vw,40px);margin-top:8px;}
.flavor{margin-top:20px;font-size:12px;font-weight:600;letter-spacing:2.4px;text-transform:uppercase;color:rgba(243,236,224,.78);}
.flavor + .flavor{margin-top:9px;color:rgba(243,236,224,.55);}
.edition{margin-top:22px;font-family:'Fraunces',Georgia,serif;font-style:italic;font-size:15.5px;color:rgba(226,214,192,.85);}
.hero .whenline{margin-top:26px;padding-top:22px;border-top:1px solid rgba(176,137,59,.35);font-size:14px;line-height:1.75;color:#efe7d6;}
.hero .whenline b{color:#fff;font-weight:600;}
/* ---- body sheets ---- */
main{max-width:660px;margin:0 auto;padding:0 16px 56px;}
.sheet{background:var(--sheet);border:1px solid rgba(43,33,25,.07);border-radius:20px;box-shadow:0 1px 0 rgba(255,255,255,.7) inset,0 24px 60px -30px rgba(43,33,25,.34);
  padding:clamp(26px,5.4vw,40px) clamp(20px,4.6vw,38px);margin-top:22px;}
.sheet:first-child{margin-top:-34px;position:relative;}
.slabel{font-size:10.5px;font-weight:600;letter-spacing:2.6px;text-transform:uppercase;color:var(--gold);margin-bottom:14px;}
.rule{width:38px;height:1px;background:var(--gold-soft);margin:0 0 18px;}
.facts{border:1px solid rgba(176,137,59,.22);background:#f4eede;border-radius:14px;padding:6px 18px;}
.facts .frow{display:flex;gap:16px;justify-content:space-between;align-items:baseline;padding:11px 0;font-size:14px;color:#3a322b;}
.facts .frow + .frow{border-top:1px solid rgba(176,137,59,.16);}
.facts .frow span:first-child{color:var(--muted);font-size:10.5px;font-weight:600;letter-spacing:1.8px;text-transform:uppercase;white-space:nowrap;}
.facts .frow span:last-child{font-weight:600;text-align:right;line-height:1.5;}
.prose{font-size:15px;line-height:1.72;color:#4a4139;}
.prose + .prose{margin-top:14px;}
.coorg{display:flex;align-items:center;gap:12px;margin-top:18px;padding-top:16px;border-top:1px solid rgba(43,33,25,.1);font-size:13px;color:var(--muted);}
.coorg .hmpa{background:#fff;border:1px solid rgba(43,33,25,.1);border-radius:8px;padding:4px 6px;flex-shrink:0;}
.coorg img{height:26px;width:auto;display:block;}
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
.foot{text-align:center;font-size:12px;letter-spacing:.3px;color:#94897c;padding:26px 18px 40px;line-height:1.9;}
.foot b{font-weight:600;color:#6f6256;}
.foot a{color:var(--crimson);text-decoration:none;font-weight:600;}
@media(max-width:430px){.sheet{border-radius:16px;}.facts .frow{flex-direction:column;gap:3px;}.facts .frow span:last-child{text-align:left;}.orgs{gap:10px;}}
</style></head><body>

<header class="hero">
  <div class="bg"></div><div class="veil"></div>
  <div class="inner">
    <div class="orgs">
      <img class="medx" src="${LOGO_URL}" alt="Med&amp;X">
      <span class="x">&times;</span>
      <span class="hmpa"><img src="/boston/hmpa.png" alt="Harvard Medical Postdoc Association"></span>
    </div>
    <p class="kicker">Med&amp;X &middot; Plexus Series</p>
    <h1>Building Bridges in Biomedicine<span class="city">Boston</span></h1>
    <p class="flavor">Fifth Edition &middot; By invitation only</p>
    <p class="flavor">Organized by Med&amp;X &middot; Harvard Medical Postdoc Association</p>
    <p class="edition">Fifth edition — after London, New York, Washington, D.C., and Z&uuml;rich.</p>
    <div class="whenline"><b>${esc(DATE_LONG)} &middot; 18:00</b> &middot; doors from 17:30<br>Waterhouse Room, Gordon Hall — Harvard Medical School, Boston, MA</div>
  </div>
</header>

<main>
  <section class="sheet" aria-label="The evening">
    <p class="slabel">The evening</p><div class="rule"></div>
    <div class="facts">
      <div class="frow"><span>Date</span><span>${esc(DATE_LONG)}</span></div>
      <div class="frow"><span>Time</span><span>18:00 &middot; doors &amp; arrival from 17:30</span></div>
      <div class="frow"><span>Venue</span><span>Waterhouse Room, Gordon Hall<br>Harvard Medical School, Boston, MA</span></div>
      <div class="frow"><span>Admission</span><span>Free &middot; by registration</span></div>
      <div class="frow"><span>Dress</span><span>${esc(DRESS)}</span></div>
    </div>
    <p class="prose" style="margin-top:20px;">Med&amp;X invites physicians, scientists, and biomedical professionals from across Greater Boston — together with Croatian professionals working in the United States — for an evening of panels on Croatia&ndash;US biomedical collaboration, five-minute presentations by participants, and a networking reception. Following editions in London, New York, Washington, D.C., and Z&uuml;rich, the series comes to Boston.</p>
    <p class="program"><b>The program.</b> Welcome remarks &middot; panel discussion &middot; 5-minute participant presentations &middot; networking reception. ~40&ndash;60 invited guests.</p>
    <div class="coorg"><span class="hmpa"><img src="/boston/hmpa.png" alt="HMPA"></span><span>Co-organized with the <strong>Harvard Medical Postdoc Association (HMPA)</strong>.</span></div>
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
      <p class="lede" id="donetext">Your confirmation email is on its way — it carries your <b>entry QR code</b> and your <b>Apple &amp; Google Wallet passes</b>. Show either at the door on ${esc(DATE_LONG)}.</p>
      <a class="cal" href="/boston.ics">Add to calendar &darr;</a>
    </div>
  </section>
</main>

<footer class="foot">
  Questions? Laura Rodman (<a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>)<br>
  <b>Med&amp;X Association</b> &middot; medx.hr &middot; with the Harvard Medical Postdoc Association
</footer>

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
