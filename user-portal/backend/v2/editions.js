/**
 * v2/editions.js — PLEXUS WEEK on the member side: the edition list and the four-block overview.
 *
 * "Plexus Week" is the umbrella (design/MEETUPS-SPEC.md §1): Conference · Gala Evening ·
 * Building Bridges Zagreb · Meetups. Boston stays separate under Building Bridges and is never
 * one of these blocks.
 *
 *   GET /api/v2/editions                      auth  → { active, editions[] }
 *   GET /api/v2/plexus-week/overview[?edition=]auth → { edition, editions[], blocks[4], gala{…} }
 *
 * The rollover rule, the table and the seed all live in shared/editions.js so the ADMIN backend
 * runs the identical code against the identical rows — see that file's header.
 *
 * THE EARLY-BIRD FIX (spec §1, last line): the member copy used to carry a hard-coded
 * "EUR 150 through 1 Sep". `blocks.gala.price` is computed here from gala_settings +
 * event_components with the SAME arithmetic as server.js › effectiveGalaPrice(), so the page
 * quotes the date the /plexus form actually charges by — today 15 Sep — and keeps quoting the
 * right one after an admin moves the deadline.
 */
'use strict';

const editions = require('../../../shared/editions');

const GALA_DEFAULT_DEADLINE = '2026-09-15';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function longDate(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}
/** '4–5 December 2026' when the range sits in one month, else the two long dates. */
function rangeLabel(from, to) {
    const a = String(from || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    const b = String(to || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!a) return null;
    if (!b || (a[1] === b[1] && a[2] === b[2] && a[3] === b[3])) return longDate(from);
    if (a[1] === b[1] && a[2] === b[2]) return `${Number(a[3])}–${Number(b[3])} ${MONTHS[Number(a[2]) - 1]} ${a[1]}`;
    return `${longDate(from)} – ${longDate(to)}`;
}
const shortLabel = (iso) => {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1].slice(0, 3)}` : null;
};

module.exports = function mountEditions(app, ctx) {
    const { db, auth } = ctx;
    const log = ctx.log || ((...a) => console.log('[v2/editions]', ...a));

    function getRow(sql, params) {
        let st = null;
        try { st = db().prepare(sql); st.bind(params || []); return st.step() ? st.getAsObject() : null; }
        finally { if (st) try { st.free(); } catch (e) {} }
    }
    function getAll(sql, params) {
        let st = null;
        try { st = db().prepare(sql); st.bind(params || []); const out = []; while (st.step()) out.push(st.getAsObject()); return out; }
        finally { if (st) try { st.free(); } catch (e) {} }
    }
    const q = {
        run: (s, p) => db().run(s, p),
        get: (s, p) => { try { return getRow(s, p); } catch (e) { return null; } },
        all: (s, p) => { try { return getAll(s, p); } catch (e) { return []; } }
    };

    // schema + seed + rollover at boot, then once a day (idempotent on both backends)
    function tick() { try { return editions.bootstrap(q); } catch (e) { log('rollover:', e.message); return null; } }
    tick();
    if (!process.env.MEETUPS_NO_TIMERS && process.env.NODE_ENV !== 'test') {
        const t = setInterval(tick, 12 * 3600 * 1000);
        if (t.unref) t.unref();
    }

    const resolve = (query) => {
        const wanted = query && query.edition ? String(query.edition) : null;
        if (wanted) { const e = editions.getEdition(q, wanted); if (e) return e; }
        return editions.activeEdition(q);
    };

    // ---------------------------------------------------------------- gala price (ONE arithmetic)
    // Deliberately the same rule as server.js › effectiveGalaPrice(), v2/gala.js › priceBlock() and
    // gala-ops › computeGalaPrice: the Gala component price in event_components is the early-bird
    // amount; gala_settings.price_gala_regular applies after early_bird_deadline (inclusive).
    function galaPrice() {
        const s = q.get("SELECT price_gala_only, price_gala_early_bird, price_gala_regular, early_bird_deadline FROM gala_settings WHERE id = 'default'") || {};
        const comp = q.get("SELECT price FROM event_components WHERE event_type = 'plexus' AND component_key = 'gala' AND is_active = 1");
        const compPrice = comp && comp.price != null ? Number(comp.price) : NaN;
        const eb = Number.isFinite(compPrice) ? compPrice : Number(s.price_gala_early_bird);
        const early = Number.isFinite(eb) ? eb : (Number(s.price_gala_only) || 150);
        const regular = Number.isFinite(Number(s.price_gala_regular)) ? Number(s.price_gala_regular) : early;
        const flip = s.early_bird_deadline || GALA_DEFAULT_DEADLINE;
        const today = new Date().toISOString().slice(0, 10);
        const isEarly = today <= flip;
        return {
            current: isEarly ? early : regular, next: isEarly ? regular : null,
            early, regular, flip_date: flip, flip_label: shortLabel(flip),
            phase: isEarly ? 'early_bird' : 'regular', currency: 'EUR'
        };
    }

    // ---------------------------------------------------------------- the four blocks
    // A PAST edition must not borrow this year's numbers. Only the meetups block is genuinely
    // edition-scoped (plexus_meetups carries edition_id); conferences, gala_settings and
    // bridges_events each hold ONE live row with no per-year history, so reading them under a
    // 2025 label would print 2026's dates, venue and price as though they were that year's. When
    // the asked-for edition is not the active one, those three blocks say what we actually know —
    // the edition's own dates and city — and nothing we do not.
    const isPast = (ed) => !!(ed && ed.status !== 'active');
    function historicalBlock(ed, key, title, target) {
        return {
            key, title,
            status: 'Not recorded', status_kind: 'closed', historical: false,
            date_label: ed ? rangeLabel(ed.starts_on, ed.ends_on) : null,
            starts_on: ed ? ed.starts_on : null,
            venue: ed ? (ed.city || 'Zagreb') : null,
            price_label: null, cta_label: null, cta_target: target
        };
    }
    function conferenceBlock(ed) {
        if (isPast(ed)) return historicalBlock(ed, 'conference', 'Plexus Conference', '/app/plexus/program');
        const c = q.get('SELECT * FROM conferences WHERE is_active = 1 ORDER BY year DESC LIMIT 1')
            || q.get("SELECT * FROM conferences WHERE slug = 'plexus-2026'");
        const open = c ? Number(c.registration_open) === 1 : false;
        return {
            key: 'conference', historical: true,
            title: c && c.name ? c.name : 'Plexus Conference',
            status: open ? 'Registration open' : 'Registration closed',
            status_kind: open ? 'open' : 'closed',
            date_label: c ? rangeLabel(c.start_date, c.end_date) : (ed ? rangeLabel(ed.starts_on, ed.ends_on) : null),
            starts_on: c ? c.start_date : (ed ? ed.starts_on : null),
            venue: c ? [c.venue_name, c.venue_city].filter(Boolean).join(' · ') || null : null,
            price_label: 'Free to attend',
            cta_label: open ? 'REGISTER — FREE' : 'SEE THE PROGRAM',
            cta_target: '/app/plexus/program'
        };
    }
    function galaBlock(ed) {
        if (isPast(ed)) return historicalBlock(ed, 'gala', 'Gala Evening', '/app/gala');
        const g = q.get("SELECT * FROM gala_settings WHERE id = 'default'") || {};
        const price = galaPrice();
        const open = g.is_registration_open === undefined || g.is_registration_open === null ? true : Number(g.is_registration_open) === 1;
        return {
            key: 'gala', historical: true,
            title: 'Gala Evening',
            status: open ? `€${price.current} until ${price.flip_label}` : 'Seats closed',
            status_kind: open ? 'open' : 'closed',
            date_label: longDate(g.date) || (ed ? longDate(ed.ends_on) : null),
            starts_on: g.date || null,
            venue: [g.venue, g.city].filter(Boolean).join(' · ') || g.venue || null,
            price_label: `€${price.current}${price.next ? ` · €${price.next} after ${price.flip_label}` : ''}`,
            price,
            cta_label: open ? `RESERVE A SEAT · €${price.current}` : 'GALA DETAILS',
            cta_target: '/app/gala'
        };
    }
    function bridgesBlock(ed) {
        // Building Bridges ZAGREB — the home edition that runs inside Plexus Week. Boston is a
        // separate Building Bridges evening and never appears as a Plexus Week block.
        if (isPast(ed)) return historicalBlock(ed, 'bridges', 'Building Bridges Zagreb', '/app/bridges');
        const home = q.get("SELECT * FROM bridges_events WHERE slug = 'building-bridges'")
            || q.get("SELECT * FROM bridges_events WHERE lower(city) = 'zagreb' ORDER BY event_date DESC LIMIT 1");
        const open = home ? Number(home.registration_open) === 1 : false;
        return {
            key: 'bridges', historical: true,
            title: 'Building Bridges Zagreb',
            status: open ? 'Registration open' : (home ? 'By invitation' : 'Dates to come'),
            status_kind: open ? 'open' : 'soon',
            date_label: home ? longDate(home.event_date) : (ed ? longDate(ed.starts_on) : null),
            starts_on: home ? home.event_date : null,
            venue: home ? [home.venue_name, home.city].filter(Boolean).join(' · ') || null : null,
            price_label: 'Free to attend',
            cta_label: 'SEE THE EVENING',
            cta_target: '/app/bridges'
        };
    }
    function meetupsBlock(ed, userEmail) {
        if (!ed) return { key: 'meetups', title: 'Meetups', status: 'Coming soon', status_kind: 'soon', cta_label: 'SEE MEETUPS', cta_target: '/app/plexus/meetups' };
        const rows = q.all("SELECT id, capacity, starts_at FROM plexus_meetups WHERE edition_id = ? AND status = 'published'", [ed.id]);
        let seats = 0, taken = 0;
        for (const m of rows) {
            seats += Number(m.capacity) || 0;
            const c = q.get("SELECT COUNT(*) AS c FROM plexus_meetup_attendees WHERE meetup_id = ? AND status IN ('confirmed','promoted')", [m.id]);
            taken += Number(c && c.c) || 0;
        }
        const mine = userEmail
            ? (q.get("SELECT COUNT(*) AS c FROM plexus_meetup_attendees WHERE lower(email) = lower(?) AND status IN ('confirmed','promoted','waitlisted')", [userEmail]) || {}).c || 0
            : 0;
        const left = Math.max(0, seats - taken);
        const first = rows.map(m => m.starts_at).filter(Boolean).sort()[0] || null;
        return {
            key: 'meetups',
            title: 'Meetups',
            status: rows.length ? (left ? `${left} place${left === 1 ? '' : 's'} left` : 'All tables full') : 'Tables opening soon',
            status_kind: rows.length && left ? 'open' : (rows.length ? 'full' : 'soon'),
            date_label: first ? longDate(first) : (ed ? rangeLabel(ed.starts_on, ed.ends_on) : null),
            starts_on: first,
            venue: 'Small tables across the week',
            price_label: 'Free — by sign-up',
            meetups: rows.length, seats, seats_left: left, mine: Number(mine) || 0,
            cta_label: Number(mine) ? 'MY MEETUPS' : 'JOIN A TABLE',
            cta_target: '/app/plexus/meetups'
        };
    }

    // ================================================================ routes
    app.get('/api/v2/editions', auth, (req, res) => {
        try {
            const all = editions.listEditions(q).map(editions.toJson);
            res.json({ active: editions.toJson(editions.activeEdition(q)), editions: all });
        } catch (e) { log('list:', e.message); res.status(500).json({ error: 'Editions are unavailable right now.' }); }
    });

    // "Past editions" → a read-only summary of what I attended that year. Meetups are the only
    // edition-scoped thing today; the older registrations carry no edition_id and are NOT migrated
    // (spec §1), so they resolve through editionForDate() on their created_at year instead.
    function mineFor(ed, email) {
        if (!ed || !email) return { meetups: [], registrations: [] };
        const meetups = q.all(`SELECT m.id, m.title, m.starts_at, m.ends_at, a.status, a.checked_in
                                 FROM plexus_meetup_attendees a JOIN plexus_meetups m ON m.id = a.meetup_id
                                WHERE m.edition_id = ? AND lower(a.email) = lower(?)
                                  AND a.status IN ('confirmed','promoted')
                                ORDER BY m.starts_at`, [ed.id, email])
            .map(r => ({ id: r.id, title: r.title, when_label: rangeLabel(r.starts_at, r.starts_at), attended: Number(r.checked_in) === 1 }));
        const regs = [];
        for (const [table, label] of [['registrations', 'Conference'], ['gala_registrations', 'Gala Evening']]) {
            for (const r of q.all(`SELECT id, created_at, status FROM ${table} WHERE lower(email) = lower(?)`, [email])) {
                const own = editions.editionForDate(q, r.created_at);
                if (own && own.id === ed.id && String(r.status || '').toLowerCase() !== 'cancelled') {
                    regs.push({ kind: label, id: r.id, year: Number(ed.year) });
                }
            }
        }
        return { meetups, registrations: regs };
    }

    app.get('/api/v2/plexus-week/overview', auth, (req, res) => {
        try {
            const ed = resolve(req.query);
            const email = String((req.user && req.user.email) || '').trim();
            const archived = !!(ed && ed.status === 'archived');
            res.json({
                edition: editions.toJson(ed),
                editions: editions.listEditions(q).map(editions.toJson),
                archived,
                title: ed ? ed.label : 'Plexus Week',
                city: ed ? (ed.city || 'Zagreb') : 'Zagreb',
                date_label: ed ? rangeLabel(ed.starts_on, ed.ends_on) : null,
                blocks: [conferenceBlock(ed), galaBlock(ed), bridgesBlock(ed), meetupsBlock(ed, email)],
                gala_price: galaPrice(),
                // what I attended that year — the read-only "Past editions" summary
                mine: mineFor(ed, email),
                certificates_url: '/app/me'
            });
        } catch (e) { log('overview:', e.message); res.status(500).json({ error: 'Plexus Week is unavailable right now.' }); }
    });

    log('editions: plexus_editions seeded + rollover armed · /api/v2/editions · /api/v2/plexus-week/overview');
};

module.exports.rangeLabel = rangeLabel;
module.exports.longDate = longDate;
module.exports.shortLabel = shortLabel;
