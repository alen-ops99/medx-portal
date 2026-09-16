/**
 * plexus-pass.js — Apple Wallet + Google Wallet passes for every Plexus Week 2026 ticket a person
 * can hold WITHOUT logging in (Alen 2026-09-15: "look at how we do it for BB Boston and all other
 * Plexus Week stuff"). Boston is the model: possession-based HMAC tokens in the emails, the SAME
 * QR the door scanners already accept, both buttons wherever the ticket is shown.
 *
 * Ticket kinds (one pass per registration row):
 *   gala   — gala_registrations id. A Zagreb multi-event row (linked croatians_abroad row) yields
 *            the COMBINED ticket: every leg the person holds (Conference 4 Dec · Building Bridges
 *            Zagreb · Gala Evening 5 Dec) on one pass, party size when > 1 ("Admits 2"). A
 *            standalone gala row yields the Gala-only pass. Issued only once the seat is paid
 *            (or comped) — before that the row is a reservation, not a ticket.
 *   ca     — croatians_abroad_registrations id with NO gala: the free-events pass (Conference
 *            and/or Building Bridges Zagreb). Issued once the row is released by the gate.
 *   guest  — ca_registration_guests id: the named guest's copy of the party ticket — their name
 *            on the front, "Guest of <registrant>", the SAME party QR.
 *
 * THE QR. Every pass carries, byte for byte, the payload the /qr/:id.png route paints into the
 * emailed ticket image (the croatians_abroad branch, or the sparse standalone-gala branch), so a
 * pass scans at all three doors exactly like the email — nothing new for the scanners to learn.
 * qrPayloadFor() below mirrors that route; tests/plexus-pass.test.js pins the field order.
 *
 * Tokens: HMAC-SHA256(JWT_SECRET, 'plexus:pass:<kind>:<id>') hex[0..32) + '.' + kind + '.' + id.
 * timingSafeEqual; forged, unknown kind, or an ineligible row → 404 (never a 403, which would
 * confirm the row exists).
 *
 * Visual: the Plexus house pass — the default espresso/gold strip + Med&X wordmark already in
 * v2/apple-assets (Boston's skyline is Boston-only). Google: the approved Plexus Week class.
 *
 * Deps (injected, like gala-paylink.js): { query, JWT_SECRET, log? }. The module opens no
 * database and sends no email. Every collaborator that touches the wire (wallet.ensure*) is
 * fire-and-forget and never blocks a response.
 */
'use strict';

const crypto = require('crypto');
const path = require('path');
const applePass = require('./v2/apple-pass');
const wallet = require('../../shared/wallet');
const tpl = require('./v2/email-templates');

const SUPPORT_EMAIL = 'laura.rodman@medx.hr';
const KINDS = ['gala', 'ca', 'guest'];
const ID_RE = /^[0-9a-fA-F-]{16,64}$/;

const publicBase = () => String(process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || 'https://medx-user-portal.onrender.com')
    .replace(/\/+$/, '');
const shortCode = id => String(id || '').replace(/-/g, '').slice(0, 8).toUpperCase();
const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// ---------------------------------------------------------------- tokens
function passSig(secret, kind, id) {
    return crypto.createHmac('sha256', String(secret)).update(`plexus:pass:${kind}:${id}`).digest('hex').slice(0, 32);
}
function passToken(secret, kind, id) {
    if (!KINDS.includes(kind)) throw new Error('plexus-pass: unknown kind ' + kind);
    return `${passSig(secret, kind, id)}.${kind}.${id}`;
}
function verifyPassToken(secret, token) {
    const m = /^([0-9a-f]{32})\.(gala|ca|guest)\.([0-9a-fA-F-]{16,64})$/.exec(String(token || ''));
    if (!m) return null;
    const expect = passSig(secret, m[2], m[3]);
    try {
        if (!crypto.timingSafeEqual(Buffer.from(m[1]), Buffer.from(expect))) return null;
    } catch (e) { return null; }
    return { kind: m[2], id: m[3] };
}

// ---------------------------------------------------------------- the ticket, resolved from the rows
// Mirrors the /qr/:id.png route in server.js (croatians_abroad branch first, then standalone
// gala) — SAME keys, SAME order, so the barcode is byte-identical to the emailed QR image.
function qrPayloadFor({ ca, galaId }) {
    if (ca) {
        const events = [
            Number(ca.selected_conference) ? 'conference' : null,
            Number(ca.selected_bridges) ? 'bridges' : null,
            Number(ca.selected_gala) ? 'gala' : null
        ].filter(Boolean);
        const p = {
            type: 'MEDX_MEMBER',
            caRegId: ca.id,
            regId: ca.gala_registration_id || ca.id,
            email: ca.email,
            name: `${ca.first_name} ${ca.last_name || ''}`.trim(),
            evt: Number(ca.selected_gala) ? 'gala' : 'croatians-abroad',
            evtName: Number(ca.selected_gala) ? 'Plexus 2026 — Gala Evening' : 'Plexus 2026',
            events
        };
        if (ca.amount_paid) p.amt = ca.amount_paid;
        if (ca.dietary) p.diet = ca.dietary;
        return p;
    }
    return { type: 'MEDX_MEMBER', regId: galaId, evt: 'gala' };
}

const PAID_STATES = ['paid', 'vip-comp', 'comp'];
const galaPaid = g => PAID_STATES.includes(String((g && g.payment_status) || '').toLowerCase())
    || String((g && g.status) || '') === 'vip-comp';
const legLive = s => ['pre-registered', 'confirmed'].includes(String(s || ''));

/**
 * Everything a pass needs, or null when the row is not a ticket (yet / any more).
 * @returns {{kind, id, name, email, party, legs:string[], gala:boolean, paid:boolean, invoice, seat,
 *            galaId, caId, guestOf, qr:string, serial, objectKey}|null}
 */
function resolveTicket(query, kind, id) {
    if (!KINDS.includes(kind) || !ID_RE.test(String(id || ''))) return null;
    const legsOf = ca => [
        ca && Number(ca.selected_conference) && legLive(ca.conference_status) ? 'conference' : null,
        ca && Number(ca.selected_bridges) && legLive(ca.bridges_status) ? 'bridges' : null
    ].filter(Boolean);

    // Which legs a named guest holds (2026-09-16: guests may join any leg the host selected).
    const on = v => v === 1 || v === true || v === '1';
    const guestOwnLegs = (guest, hostLegs, galaPaid) => {
        const flags = [on(guest.conference) ? 'conference' : null, on(guest.bridges) ? 'bridges' : null, on(guest.gala) ? 'gala' : null].filter(Boolean);
        const own = flags.length ? flags : ['gala'];                 // pre-flag rows were Gala guests
        return own.filter(l => l === 'gala' ? galaPaid : hostLegs.includes(l));
    };

    if (kind === 'guest') {
        const guest = query.get('SELECT * FROM ca_registration_guests WHERE id = ?', [id]);
        if (!guest) return null;
        const ca = query.get('SELECT * FROM croatians_abroad_registrations WHERE id = ?', [guest.registration_id]);
        if (!ca) return null;
        const g = ca.gala_registration_id ? query.get('SELECT * FROM gala_registrations WHERE id = ?', [ca.gala_registration_id]) : null;
        const galaOk = !!(g && String(g.status || '') !== 'cancelled' && galaPaid(g));
        const hostLegs = legsOf(ca);
        const legs = guestOwnLegs(guest, hostLegs, galaOk);
        if (!legs.length) return null;                                // nothing of theirs is a ticket (yet)
        const hasGala = legs.includes('gala');
        const registrant = `${ca.first_name || ''} ${ca.last_name || ''}`.trim() || 'Med&X Guest';
        const party = hasGala ? 1 + Math.max(0, parseInt(g.guest_count, 10) || 0) : 1;
        return {
            kind, id, galaId: hasGala ? g.id : null, caId: ca.id,
            name: String(guest.name || '').trim() || 'Guest', guestOf: registrant, email: guest.email || '',
            party, legs, gala: hasGala, paid: hasGala,
            invoice: hasGala ? (g.invoice_number || null) : null, seat: hasGala ? (g.seat_number || null) : null,
            qr: JSON.stringify(qrPayloadFor({ ca, galaId: hasGala ? g.id : null })),
            serial: hasGala ? `medx-t-galaguest-${id}` : `medx-t-caguest-${id}`, objectKey: `g-${id}`
        };
    }
    if (kind === 'gala') {
        const galaId = id;
        const g = query.get('SELECT * FROM gala_registrations WHERE id = ?', [galaId]);
        if (!g || String(g.status || '') === 'cancelled' || !galaPaid(g)) return null;
        const ca = query.get('SELECT * FROM croatians_abroad_registrations WHERE gala_registration_id = ?', [galaId]);
        const legs = [...legsOf(ca), 'gala'];
        const party = 1 + Math.max(0, parseInt(g.guest_count, 10) || 0);
        const registrant = `${g.first_name || ''} ${g.last_name || ''}`.trim() || 'Med&X Guest';
        return {
            kind, id, galaId, caId: ca ? ca.id : null,
            name: registrant, guestOf: null, email: g.email || '',
            party, legs, gala: true, paid: true,
            invoice: g.invoice_number || null, seat: g.seat_number || null,
            qr: JSON.stringify(qrPayloadFor({ ca, galaId })),
            serial: `medx-t-gala-${galaId}`, objectKey: galaId
        };
    }
    // kind === 'ca' — the free-events ticket (no gala leg on this row)
    const ca = query.get('SELECT * FROM croatians_abroad_registrations WHERE id = ?', [id]);
    if (!ca) return null;
    const legs = legsOf(ca);
    if (!legs.length) return null;
    if (Number(ca.selected_gala) && ca.gala_registration_id) {
        // A row with a Gala leg holds the COMBINED ticket instead — never two passes for one person.
        return resolveTicket(query, 'gala', ca.gala_registration_id);
    }
    return {
        kind: 'ca', id, galaId: null, caId: ca.id,
        name: `${ca.first_name || ''} ${ca.last_name || ''}`.trim() || 'Med&X Guest', guestOf: null,
        email: ca.email || '', party: 1, legs, gala: false, paid: false,
        invoice: null, seat: null,
        qr: JSON.stringify(qrPayloadFor({ ca, galaId: null })),
        serial: `medx-t-ca-${id}`, objectKey: id
    };
}

// ---------------------------------------------------------------- copy shared by both wallets
const LEG = {
    conference: { name: 'Plexus Conference', when: '4 December 2026', where: 'Novinarski dom, Zagreb' },
    bridges:    { name: 'Building Bridges Zagreb', when: '4 or 5 December 2026', where: 'Zagreb · venue to be confirmed' },
    gala:       { name: 'Gala Evening', when: '5 December 2026 · 19:00', where: 'Hotel Esplanade, Zagreb' }
};
function whenLine(legs) {
    const hasConf = legs.includes('conference'), hasGala = legs.includes('gala');
    if (hasConf && (hasGala || legs.includes('bridges'))) return '4–5 December 2026';
    if (hasGala) return '5 December 2026 · 19:00';
    if (hasConf) return '4 December 2026';
    return '4 or 5 December 2026';
}
function whereLine(legs) {
    if (legs.length === 1) return LEG[legs[0]].where;
    return legs.includes('gala') ? 'Zagreb · Gala at Hotel Esplanade' : 'Zagreb';
}
const includedLine = legs => legs.map(l => `${LEG[l].name} — ${LEG[l].when}, ${LEG[l].where}`).join('\n');
const refOf = t => t.invoice || shortCode(t.galaId || t.id);

// ---------------------------------------------------------------- Apple
function applePassModel(t) {
    const auxiliary = [
        { key: 'guest', label: t.guestOf ? 'GUEST' : 'NAME', value: t.name },
        { key: 'ref', label: 'N°', value: refOf(t) }
    ];
    if (t.party > 1) auxiliary.push({ key: 'admits', label: 'ADMITS', value: String(t.party) });
    const back = [{ key: 'included', label: 'INCLUDED', value: includedLine(t.legs) }];
    if (t.guestOf) back.push({ key: 'guestof', label: 'GUEST OF', value: t.guestOf });
    if (t.party > 1) back.push({ key: 'party', label: 'ONE QR, WHOLE PARTY', value: `This code admits your party of ${t.party}, arriving together or separately.` });
    if (t.gala) {
        back.push({ key: 'dress', label: 'DRESS CODE', value: 'Black tie' });
        back.push({ key: 'table', label: 'TABLE', value: t.seat ? `Table ${t.seat}` : 'Assigned closer to the Gala — show this pass at the door.' });
    }
    if (t.invoice) back.push({ key: 'invoice', label: 'INVOICE', value: t.invoice });
    back.push({ key: 'support', label: 'SUPPORT', value: `Questions? ${SUPPORT_EMAIL}` });
    return {
        style: 'eventTicket',
        serial: t.serial,
        description: 'Med&X — Plexus Week 2026',
        relevantDate: t.legs.includes('conference') ? '2026-12-04T09:00:00+01:00' : '2026-12-05T19:00:00+01:00',
        fields: {
            header: [{ key: 'event', label: 'PLEXUS WEEK 2026', value: 'Zagreb' }],
            primary: [],
            secondary: [
                { key: 'when', label: 'WHEN', value: whenLine(t.legs) },
                { key: 'where', label: 'WHERE', value: whereLine(t.legs) }
            ],
            auxiliary,
            back
        },
        qrMessage: t.qr,
        altText: shortCode(t.galaId || t.id)
    };
}

// ---------------------------------------------------------------- Google
function googleObjects(t, base) {
    const classId = process.env.PLEXUS_GOOGLE_CLASS_ID || wallet.classIdFor('plexus-week-2026');
    const classBody = wallet.buildEventTicketClass({
        classId, issuerName: 'Med&X', eventName: 'Plexus Week 2026',
        venue: 'Zagreb', venueAddress: 'Zagreb, Croatia',
        startISO: '2026-12-04T08:00:00Z', endISO: '2026-12-05T22:00:00Z',
        logoUri: base + '/assets/images/medx-logo.png', hexBackgroundColor: '#14100d', homepageUri: base
    });
    const object = wallet.buildEventTicketObject({
        objectId: wallet.objectIdFor(t.objectKey), classId,
        token: t.qr,                                    // the SAME payload as the emailed QR
        name: t.name, registrationNumber: refOf(t),
        category: t.party > 1 ? `Plexus Week 2026 · admits ${t.party}` : 'Plexus Week 2026',
        statusLabel: t.guestOf ? `Guest of ${t.guestOf}` : (t.gala ? 'Paid' : 'Confirmed'),
        events: t.legs.map(l => LEG[l].name),
        dressCode: t.gala ? 'Black tie' : undefined,
        galaTable: t.seat ? `Table ${t.seat}` : undefined,
        logoUri: base + '/assets/images/medx-logo.png', hexBackgroundColor: '#14100d'
    });
    return { classBody, object };
}
function googleSaveUrl(t, log) {
    if (!wallet.isConfigured()) return null;
    try {
        const base = publicBase();
        const { classBody, object } = googleObjects(t, base);
        const url = wallet.buildSaveUrl({ classes: [classBody], objects: [object], origins: [base] }).saveUrl;
        Promise.resolve()
            .then(() => wallet.ensureEventClass(classBody))
            .then(() => wallet.ensureEventObject(object))
            .catch(err => (log || console.error)('[PlexusPass] wallet provision failed (non-blocking):', err.message));
        return url;
    } catch (e) { (log || console.error)('[PlexusPass] Google Wallet mint failed:', e.message); return null; }
}

// ---------------------------------------------------------------- the links an email / page shows
/**
 * { apple, google } for a ticket, or nulls where the platform env is absent or the row is not
 * (yet) a ticket. The google link is our own 302 route, not the raw save URL, so the JWT is
 * minted fresh on tap (short-lived by design) and the email never carries a stale one.
 */
function walletLinks(query, secret, kind, id) {
    const t = resolveTicket(query, kind, id);
    if (!t) return { apple: null, google: null };
    const tok = passToken(secret, t.kind, t.id);
    const base = publicBase();
    return {
        apple: applePass.isConfigured() ? `${base}/api/plexus/pass/${tok}.pkpass` : null,
        google: wallet.isConfigured() ? `${base}/api/plexus/wallet/${tok}` : null
    };
}

/** The two-button stack for emails — 'dark' (Zagreb shell) or 'light' (legacy template). */
function walletStackHtml(links, opts) {
    const l = links || {};
    if (!l.apple && !l.google) return '';
    const o = opts || {};
    const W = 'width:260px;max-width:100%;padding-left:0;padding-right:0;text-align:center;box-sizing:border-box;';
    const rows = [];
    if (l.apple) rows.push(`<tr><td align="center" style="padding:0 0 10px;">${tpl.btn('ADD TO APPLE WALLET →', l.apple, o.tone === 'light' ? 'ink' : 'ink', W)}</td></tr>`);
    if (l.google) rows.push(`<tr><td align="center" style="padding:0 0 10px;">${tpl.btn('ADD TO GOOGLE WALLET →', l.google, 'gold', W)}</td></tr>`);
    const lead = o.lead === false ? '' : `<tr><td align="center" style="padding:0 0 10px;font-family:${tpl.T.sans};font-size:11.5px;color:${o.tone === 'light' ? tpl.T.soft : '#c9b89f'};">Keep it on your phone &mdash; the same QR, in your wallet.</td></tr>`;
    return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:14px auto 0;">${lead}${rows.join('')}</table>`;
}
/** The same two buttons for an HTML page (the ticket page). */
function walletButtonsPageHtml(links) {
    const l = links || {};
    if (!l.apple && !l.google) return '';
    const b = (href, label, dark) => `<a href="${esc(href)}" style="display:block;margin:10px auto 0;max-width:280px;padding:12px 18px;background:${dark ? '#241d18' : '#c9a962'};color:${dark ? '#f7f1e6' : '#191512'};font:600 12.5px Inter,sans-serif;letter-spacing:.4px;text-decoration:none;text-align:center;">${label}</a>`;
    return `<div style="margin-top:14px;">${l.apple ? b(l.apple, 'Add to Apple Wallet →', true) : ''}${l.google ? b(l.google, 'Add to Google Wallet →', false) : ''}</div>`;
}

// ---------------------------------------------------------------- routes
function mount(app, deps) {
    const { query, JWT_SECRET } = deps;
    const log = deps.log || ((...a) => console.log('[PlexusPass]', ...a));
    const notFound = res => res.status(404).json({ error: 'Not found' });

    app.get('/api/plexus/pass/:token.pkpass', (req, res) => {
        try {
            const t0 = verifyPassToken(JWT_SECRET, req.params.token);
            if (!t0) return notFound(res);
            const t = resolveTicket(query, t0.kind, t0.id);
            if (!t) return notFound(res);
            if (!applePass.isConfigured()) return res.status(503).json({ error: 'Apple Wallet passes are not enabled on this server yet. Your email QR admits you at the door.' });
            const buf = applePass.buildPkpass(applePassModel(t));
            res.setHeader('Content-Type', 'application/vnd.apple.pkpass');
            res.setHeader('Content-Disposition', 'inline; filename="medx-plexus-week-2026.pkpass"');
            res.setHeader('Content-Length', buf.length);
            res.setHeader('Cache-Control', 'private, no-store');
            res.send(buf);
        } catch (e) {
            log('Apple pass failed:', e.message);
            if (!res.headersSent) res.status(500).json({ error: 'Could not build the pass. Your email QR admits you at the door.' });
        }
    });

    app.get('/api/plexus/wallet/:token', (req, res) => {
        try {
            const t0 = verifyPassToken(JWT_SECRET, req.params.token);
            if (!t0) return notFound(res);
            const t = resolveTicket(query, t0.kind, t0.id);
            if (!t) return notFound(res);
            const url = googleSaveUrl(t, log);
            if (!url) return res.status(503).json({ configured: false, error: 'Google Wallet is not enabled on this server yet. Your email QR admits you at the door.' });
            res.set('Cache-Control', 'private, no-store');
            if (String(req.query.format || '') === 'json') return res.json({ configured: true, save_url: url });
            res.redirect(302, url);
        } catch (e) {
            log('Google wallet failed:', e.message);
            if (!res.headersSent) res.status(500).json({ error: 'Could not build the wallet link.' });
        }
    });

    log(`plexus-pass: /api/plexus/pass + /api/plexus/wallet ready (apple ${applePass.isConfigured() ? 'on' : 'off'}, google ${wallet.isConfigured() ? 'on' : 'off'})`);
    return {
        walletLinks: (kind, id) => walletLinks(query, JWT_SECRET, kind, id),
        walletStackHtml, walletButtonsPageHtml
    };
}

module.exports = mount;
module.exports.KINDS = KINDS;
module.exports.passToken = passToken;
module.exports.verifyPassToken = verifyPassToken;
module.exports.qrPayloadFor = qrPayloadFor;
module.exports.resolveTicket = resolveTicket;
module.exports.applePassModel = applePassModel;
module.exports.googleObjects = googleObjects;
module.exports.walletLinks = walletLinks;
module.exports.walletStackHtml = walletStackHtml;
module.exports.walletButtonsPageHtml = walletButtonsPageHtml;
module.exports.whenLine = whenLine;
module.exports.includedLine = includedLine;
