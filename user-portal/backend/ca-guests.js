/**
 * ca-guests.js — guests per event on the Zagreb (Plexus Week) registration (Alen, 2026-09-16).
 *
 * A registrant may bring up to two named guests, and each guest joins the legs the REGISTRANT
 * selected: Plexus Conference, Building Bridges Zagreb, Gala Evening — any subset. The form ticks
 * default to the registrant's own selection; this module is the server-side truth:
 *
 *   - a guest never holds a leg the host did not select (masked here, whatever the client sent),
 *   - a guest with neither name nor email, or with no leg left after masking, is dropped,
 *   - at most two guests are kept, in the order given,
 *   - payloads from before the flags existed (no conference / bridges / gala keys at all) are
 *     Gala guests — exactly what the form meant back then.
 *
 * `guest_count` on croatians_abroad_registrations / gala_registrations KEEPS its meaning —
 * additional GALA seats — because every reader of it (party pricing, the pay link, the Gala door,
 * the admin partyOf()) is a seats reader. galaGuestCount() derives it from the flags.
 */
'use strict';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const on = v => v === true || v === 1 || v === '1' || v === 'true' || v === 'on';

function normalizeGuests(raw, { wantConf, wantBridges, wantGala } = {}) {
    const list = Array.isArray(raw) ? raw.slice(0, 2) : [];
    const out = [];
    for (const g of list) {
        if (!g || typeof g !== 'object') continue;
        const name = String(g.name || '').slice(0, 120).trim();
        const institution = String(g.institution || '').slice(0, 160).trim();
        const emailRaw = String(g.email || '').slice(0, 160).trim().toLowerCase();
        const email = EMAIL_RE.test(emailRaw) ? emailRaw : '';
        if (!name && !email) continue;
        const legacy = !('conference' in g) && !('bridges' in g) && !('gala' in g);
        const conference = !!wantConf && !legacy && on(g.conference);
        const bridges = !!wantBridges && !legacy && on(g.bridges);
        const gala = !!wantGala && (legacy || on(g.gala));
        if (!conference && !bridges && !gala) continue;
        out.push({ name, institution, email, conference, bridges, gala });
    }
    return out;
}

const galaGuestCount = guests => (guests || []).filter(g => g && g.gala).length;

const LEG_NAME = { conference: 'Plexus Conference', bridges: 'Building Bridges Zagreb', gala: 'Gala Evening' };
// Legs of a stored or normalised guest row; an all-zero row (pre-flag) is a Gala guest.
function legsOf(g) {
    const legs = [on(g && g.conference) ? 'conference' : null, on(g && g.bridges) ? 'bridges' : null, on(g && g.gala) ? 'gala' : null].filter(Boolean);
    return legs.length ? legs : ['gala'];
}
const eventNames = g => legsOf(g).map(l => LEG_NAME[l]);
// "Ana Horvat (Plexus Conference + Gala Evening); Marko Kovač (Building Bridges Zagreb)"
const summary = guests => (guests || []).map(g => `${g.name || g.email || 'Guest'} (${eventNames(g).join(' + ')})`).join('; ');

module.exports = { normalizeGuests, galaGuestCount, legsOf, eventNames, summary, LEG_NAME };
