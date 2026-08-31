/**
 * v2/host-brief.js — HOST BRIEF: the old portal's "who is coming tonight" one-pager, rebuilt
 * for the ADMIN v2 Event Day room. Mounted by v2/index.js.
 *
 *   GET /api/v2/host-brief?event=conference|gala|bridges   (donor accepted too — the Event Day
 *   room has four doors and the card follows the door picker)   · auth + staffOrAdmin, exactly
 *   the gate v2/event-day.js declares for the scanner family.
 *
 * READ-ONLY by design: this module owns no tables, runs no DDL and writes nothing — the brief
 * is COMPOSED DETERMINISTICALLY from the registration tables (staging has no AI API keys; a
 * templated brief that reads well beats a dead external call, and the numbers stay auditable).
 * Tables other modules own (v2_checkin_admits from event-day, v2_gala_categories from gala-ops)
 * are read behind try/catch and simply thin the brief when absent.
 *
 * Inclusion rules mirror v2/event-day.js so the door list and the brief never disagree:
 *   conference → registrations (not revoked/cancelled) + croatians_abroad selected_conference=1
 *   gala       → gala_registrations (not cancelled; paid AND pending — the pending ones are the
 *                door problem the host must know about) + croatians_abroad selected_gala=1 with
 *                NO linked gala_registration (linked rows are counted via their gala row)
 *   donor      → bridges_registrations scoped TO the Donor Night event
 *   bridges    → bridges_registrations scoped AWAY from Donor Night + croatians_abroad
 *                selected_bridges=1
 *   croatians_abroad rows whose notes carry SCANNER TEST / BUNDLE TEST are excluded everywhere
 *   (same filter as the door list). One booking = a PARTY of 1 + guest_count people.
 *
 * The response carries both the structured brief (the Event Day card renders it) and `text` —
 * a plain-text one-pager for COPY AS TEXT (pasteable into a message to Alen before the evening).
 * Croatian diacritics pass through untouched end to end.
 */
'use strict';

const EVENT_KEYS = ['conference', 'gala', 'donor', 'bridges'];
const FALLBACK_LABELS = {
    conference: 'Plexus Week — Conference',
    gala: 'Plexus Gala Evening',
    donor: 'Plexus Donor Night',
    bridges: 'Building Bridges'
};
// gala-ops seeds these three; used only when v2_gala_categories has not been created yet.
const FALLBACK_CATEGORIES = { invoice: 'Invoice', vip: 'VIP — free', sponsor: 'Sponsor seat' };

// Country spellings arrive free-text and multilingual ("USA" / "United States" / "Deutschland" /
// "Österreich"). Canonicalised for grouping only — unknown spellings keep their original form,
// diacritics intact. Matching is lowercase-exact on the trimmed string.
const COUNTRY_CANON = (() => {
    const m = new Map();
    const add = (canon, names) => names.forEach(n => m.set(n, canon));
    add('United States', ['us', 'usa', 'u.s.', 'u.s.a.', 'united states', 'united states of america', 'america', 'sad', 'sjedinjene američke države']);
    add('United Kingdom', ['uk', 'u.k.', 'united kingdom', 'great britain', 'england', 'scotland', 'velika britanija']);
    add('Germany', ['germany', 'deutschland', 'njemačka', 'nemačka']);
    add('Austria', ['austria', 'österreich', 'austrija']);
    add('Croatia', ['croatia', 'hrvatska', 'republika hrvatska', 'republic of croatia']);
    add('Switzerland', ['switzerland', 'schweiz', 'suisse', 'svizzera', 'švicarska']);
    add('Czechia', ['czechia', 'czech republic', 'česká republika', 'češka']);
    add('Italy', ['italy', 'italia', 'italija']);
    add('Spain', ['spain', 'españa', 'španjolska']);
    add('Netherlands', ['netherlands', 'the netherlands', 'nederland', 'holland', 'nizozemska']);
    add('Slovenia', ['slovenia', 'slovenija']);
    add('Serbia', ['serbia', 'srbija']);
    add('Bosnia and Herzegovina', ['bosnia and herzegovina', 'bosna i hercegovina', 'bih', 'bosnia']);
    add('Hungary', ['hungary', 'magyarország', 'mađarska']);
    add('Sweden', ['sweden', 'sverige', 'švedska']);
    add('Norway', ['norway', 'norge', 'norveška']);
    add('Denmark', ['denmark', 'danmark', 'danska']);
    add('Poland', ['poland', 'polska', 'poljska']);
    add('France', ['france', 'francuska']);
    add('Belgium', ['belgium', 'belgië', 'belgique', 'belgija']);
    add('Ireland', ['ireland', 'irska']);
    add('Canada', ['canada', 'kanada']);
    add('Australia', ['australia', 'australija']);
    return m;
})();
// Talking-point shorthand only ("3 guests flying in from the US").
const COUNTRY_SHORT = { 'United States': 'the US', 'United Kingdom': 'the UK' };

// Kitchen buckets — keyword → bucket, keywords in English and Croatian. A text may land in
// several buckets ("vegan, bez glutena" = 1 vegan + 1 gluten-free); the verbatim line is kept
// beside the name either way, because the kitchen works from the exact words.
const DIET_BUCKETS = [
    ['vegan', ['vegan']],
    ['vegetarian', ['vegetari', 'veggie']],
    ['gluten-free', ['gluten', 'celiac', 'celijak']],
    ['lactose-free', ['lactose', 'laktoz']],
    ['halal', ['halal']],
    ['kosher', ['kosher', 'košer']],
    ['no pork', ['no pork', 'without pork', 'svinjetin']],
    ['pescatarian', ['pescatari', 'pesketari']],
    ['allergy', ['allerg', 'alergi', 'anaphyla', 'anafila', 'orašast', 'orasast', 'kikiriki', 'peanut', 'shellfish', 'školjk', 'skoljk', 'intoleran']]
];
const DIET_NONE = new Set(['', 'none', 'no', 'n/a', 'na', 'nema', 'ništa', 'nista', '/', '-', '–', '—', '.', 'regular', 'nothing', 'all good', 'sve', 'everything', 'not applicable']);

module.exports = function mountHostBrief(app, ctx) {
    const { db, auth, log } = ctx;

    // sql.js-idiom read helpers (shared/db.js wrapper) — this module never calls run().
    const q = {
        get(sql, p = []) { const s = db().prepare(sql); if (p.length) s.bind(p); const r = s.step() ? s.getAsObject() : null; s.free(); return r; },
        all(sql, p = []) { const s = db().prepare(sql); if (p.length) s.bind(p); const rows = []; while (s.step()) rows.push(s.getAsObject()); s.free(); return rows; }
    };
    const safeAll = (sql, p) => { try { return q.all(sql, p); } catch (e) { return []; } };
    const safeGet = (sql, p) => { try { return q.get(sql, p); } catch (e) { return null; } };

    // ctx carries auth + adminOnly only; scanner staff (is_staff) reach the brief exactly like
    // the Event Day room — same local staffOrAdmin gate v2/event-day.js declares.
    function staffOrAdmin(req, res, next) {
        if (req.user && (req.user.is_admin || req.user.is_staff)) return next();
        return res.status(403).json({ error: 'Staff or admin access required' });
    }

    // ---------------------------------------------------------------- small shared bits
    const party = row => 1 + (Number(row && row.guest_count) || 0);
    const fullName = r => (((r.first_name || '') + ' ' + (r.last_name || '')).trim()) || r.email || 'Guest';
    const clean = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));
    const NOT_TEST = "AND (notes IS NULL OR (notes NOT LIKE '%SCANNER TEST%' AND notes NOT LIKE '%BUNDLE TEST%'))";
    const JUNK = new Set(['', '-', '–', '—', '/', '.', 'n/a', 'na', 'none', 'nema', 'x', 'test']);

    function donorEventId() {
        const r = safeGet("SELECT id FROM bridges_events WHERE slug = 'donor-night'")
               || safeGet("SELECT id FROM bridges_events WHERE name = 'Plexus Donor Night'");
        return (r && r.id) || null;
    }
    function gateRow(key) { return safeGet('SELECT * FROM checkin_events WHERE event_key = ? AND is_active = 1', [key]); }

    function longDate(iso) {
        const t = Date.parse(String(iso || ''));
        if (isNaN(t)) return '';
        try { return new Date(t).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }
        catch (e) { return String(iso).slice(0, 10); }
    }
    function stamp(d) {
        try { return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }); }
        catch (e) { return d.toISOString().slice(0, 16).replace('T', ' '); }
    }

    // ---------------------------------------------------------------- row collectors
    // Every included booking becomes one normalized guest record:
    //   { id, name, institution, country, party, pay: 'paid'|'pending'|'free', dietary,
    //     note (team note text or null), category (gala pricing key or null), vipComp }
    function payStateConference(r) {
        if (String(r.payment_status || '') === 'paid') return 'paid';
        return r.ticket_type_id ? 'pending' : 'free';   // no priced ticket chosen → free entry
    }
    function payStateGala(r) { return ['paid', 'vip-comp'].includes(String(r.payment_status || '')) ? 'paid' : 'pending'; }
    function payStateBridges(r) {
        const p = String(r.payment_status || '').toLowerCase();
        if (p === 'paid') return 'paid';
        if (p === 'pending' || p === 'unpaid') return 'pending';
        return 'free';                                   // 'n/a' / '' — Building Bridges is a free evening
    }
    function payStateCaGala(r) { return String(r.gala_payment_status || '') === 'paid' ? 'paid' : 'pending'; }

    function guestsFor(eventKey) {
        const out = [];
        const push = (id, name, o) => out.push(Object.assign({ id: String(id), name, institution: '', country: '', party: 1, pay: 'free', dietary: '', note: null, category: null, vipComp: false }, o));
        if (eventKey === 'conference') {
            safeAll(`SELECT * FROM registrations WHERE COALESCE(revoked,0) = 0 AND lower(COALESCE(status,'')) != 'cancelled' LIMIT 5000`)
                .forEach(r => push(r.id, fullName(r), { institution: clean(r.institution), country: clean(r.country), party: party(r), pay: payStateConference(r), dietary: clean(r.dietary_requirements) }));
            safeAll(`SELECT * FROM croatians_abroad_registrations WHERE selected_conference = 1 ${NOT_TEST} LIMIT 5000`)
                .forEach(r => push(r.id, fullName(r), { institution: clean(r.institution), country: clean(r.country), party: party(r), pay: 'free', dietary: clean(r.dietary), note: clean(r.notes) || null }));
        } else if (eventKey === 'gala') {
            safeAll(`SELECT * FROM gala_registrations WHERE lower(COALESCE(status,'')) != 'cancelled' LIMIT 5000`)
                .forEach(r => push(r.id, fullName(r), { institution: clean(r.institution), party: party(r), pay: payStateGala(r), dietary: clean(r.dietary), note: clean(r.admin_notes) || null, category: clean(r.pricing).toLowerCase() || null, vipComp: String(r.payment_status || '') === 'vip-comp' }));
            safeAll(`SELECT * FROM croatians_abroad_registrations WHERE selected_gala = 1 AND gala_registration_id IS NULL ${NOT_TEST} LIMIT 5000`)
                .forEach(r => push(r.id, fullName(r), { institution: clean(r.institution), country: clean(r.country), party: party(r), pay: payStateCaGala(r), dietary: clean(r.dietary), note: clean(r.notes) || null }));
        } else if (eventKey === 'donor') {
            const donorId = donorEventId();
            if (donorId) safeAll(`SELECT * FROM bridges_registrations WHERE event_id = ? AND lower(COALESCE(status,'')) != 'cancelled' LIMIT 5000`, [donorId])
                .forEach(r => push(r.id, fullName(r), { institution: clean(r.institution), party: party(r), pay: payStateBridges(r), dietary: clean(r.dietary_requirements), note: clean(r.notes) || null }));
        } else { // bridges
            const donorId = donorEventId();
            const w = donorId ? 'AND event_id != ?' : '', args = donorId ? [donorId] : [];
            safeAll(`SELECT * FROM bridges_registrations WHERE lower(COALESCE(status,'')) != 'cancelled' ${w} LIMIT 5000`, args)
                .forEach(r => push(r.id, fullName(r), { institution: clean(r.institution), party: party(r), pay: payStateBridges(r), dietary: clean(r.dietary_requirements), note: clean(r.notes) || null }));
            safeAll(`SELECT * FROM croatians_abroad_registrations WHERE selected_bridges = 1 ${NOT_TEST} LIMIT 5000`)
                .forEach(r => push(r.id, fullName(r), { institution: clean(r.institution), country: clean(r.country), party: party(r), pay: 'free', dietary: clean(r.dietary), note: clean(r.notes) || null }));
        }
        return out;
    }

    // Append-only registrant_notes (the timeline notes admins leave on a person) — one query,
    // matched in JS so no dynamic IN(...) is built from row ids.
    function timelineNotes() {
        const map = new Map();
        for (const n of safeAll('SELECT registrant_id, body FROM registrant_notes ORDER BY created_at ASC')) {
            const k = String(n.registrant_id);
            const cur = map.get(k) || { n: 0, last: '' };
            cur.n += 1; cur.last = clean(n.body);
            map.set(k, cur);
        }
        return map;
    }

    function galaCategoryLabels() {
        const rows = safeAll('SELECT key, label FROM v2_gala_categories');
        if (!rows.length) return Object.assign({}, FALLBACK_CATEGORIES);
        const m = {};
        rows.forEach(r => { if (r.key) m[String(r.key).toLowerCase()] = clean(r.label) || String(r.key); });
        return m;
    }

    // Arrivals — v2 party ledger + rows only the OLD scanner flagged (1 person each), the same
    // side-by-side arithmetic as event-day's admittedPeople, all behind try/catch.
    function arrivalsFor(eventKey, expectedPeople) {
        let admitted = 0, started = 0, complete = 0;
        const a = safeGet(`SELECT COUNT(*) n, COALESCE(SUM(admitted_count),0) c,
                                  COALESCE(SUM(CASE WHEN admitted_count >= party_size THEN 1 ELSE 0 END),0) f
                           FROM v2_checkin_admits WHERE event_key = ?`, [eventKey]);
        if (a) { started = Number(a.n) || 0; admitted = Number(a.c) || 0; complete = Number(a.f) || 0; }
        const notIn = `AND id NOT IN (SELECT registration_ref FROM v2_checkin_admits WHERE event_key = ?)`;
        const legacy = (sql, p) => { const r = safeGet(sql, p); return r ? Number(r.c) || 0 : 0; };
        if (eventKey === 'conference') {
            admitted += legacy(`SELECT COUNT(*) c FROM registrations WHERE (COALESCE(checked_in,0) = 1 OR id IN (SELECT registration_id FROM event_checkins WHERE event_key = 'conference')) ${notIn}`, [eventKey]);
            admitted += legacy(`SELECT COUNT(*) c FROM croatians_abroad_registrations WHERE conference_checked_in = 1 ${notIn}`, [eventKey]);
        } else if (eventKey === 'gala') {
            admitted += legacy(`SELECT COUNT(*) c FROM gala_registrations WHERE COALESCE(checked_in,0) = 1 ${notIn}`, [eventKey]);
        } else {
            const donorId = donorEventId();
            const w = donorId ? (eventKey === 'donor' ? 'AND event_id = ?' : 'AND event_id != ?') : '';
            admitted += legacy(`SELECT COUNT(*) c FROM bridges_registrations WHERE COALESCE(checked_in,0) = 1 ${w} ${notIn}`, donorId ? [donorId, eventKey] : [eventKey]);
            if (eventKey === 'bridges') admitted += legacy(`SELECT COUNT(*) c FROM croatians_abroad_registrations WHERE bridges_checked_in = 1 ${notIn}`, [eventKey]);
        }
        if (!admitted) return null;
        return { admitted_people: admitted, parties_started: started, parties_complete: complete, expected_people: expectedPeople };
    }

    // ---------------------------------------------------------------- the composer
    function composeBrief(eventKey) {
        const gate = gateRow(eventKey);
        const label = (gate && gate.label) || FALLBACK_LABELS[eventKey] || eventKey;
        const dateLabel = gate && gate.starts_at ? longDate(gate.starts_at) : '';
        const guests = guestsFor(eventKey);
        const notes = timelineNotes();
        const catLabels = eventKey === 'gala' ? galaCategoryLabels() : {};

        // -------- headline counts
        const bookings = guests.length;
        const people = guests.reduce((n, g) => n + g.party, 0);
        const plusOnes = people - bookings;
        const sumPay = s => guests.filter(g => g.pay === s).reduce((n, g) => n + g.party, 0);
        const paidPeople = sumPay('paid'), pendingPeople = sumPay('pending'), freePeople = sumPay('free');
        const pendingBookings = guests.filter(g => g.pay === 'pending').length;

        // -------- institutions and countries (party-weighted people, junk-safe, diacritics kept)
        const groupBy = keyOf => {
            const m = new Map();
            for (const g of guests) {
                const raw = keyOf(g);
                if (!raw) continue;
                const k = raw.toLowerCase();
                if (JUNK.has(k)) continue;
                const cur = m.get(k) || { name: raw, people: 0 };
                cur.people += g.party;
                m.set(k, cur);
            }
            return [...m.values()].sort((a, b) => b.people - a.people || a.name.localeCompare(b.name));
        };
        const institutions = groupBy(g => g.institution);
        const countries = groupBy(g => {
            if (!g.country) return '';
            return COUNTRY_CANON.get(g.country.toLowerCase()) || g.country;
        });

        // -------- notable guests: VIP/sponsor categories · team notes · biggest parties
        const notableMap = new Map();
        const mark = (g, tag, rank) => {
            const cur = notableMap.get(g.id) || { name: g.name, institution: g.institution, country: g.country, party_size: g.party, tags: [], rank: 99 };
            if (!cur.tags.includes(tag)) cur.tags.push(tag);
            cur.rank = Math.min(cur.rank, rank);
            notableMap.set(g.id, cur);
        };
        const catCounts = new Map();   // label → { n, names[] }
        for (const g of guests) {
            const catKey = g.category && g.category !== 'invoice' && catLabels[g.category] ? g.category : null;
            if (catKey) {
                const lab = catLabels[catKey];
                mark(g, lab, 0);
                const c = catCounts.get(lab) || { n: 0, names: [] };
                c.n += 1; c.names.push(g.name);
                catCounts.set(lab, c);
            } else if (g.vipComp) {
                mark(g, catLabels.vip || 'VIP — comp', 0);
                const c = catCounts.get(catLabels.vip || 'VIP — comp') || { n: 0, names: [] };
                c.n += 1; c.names.push(g.name);
                catCounts.set(catLabels.vip || 'VIP — comp', c);
            }
            const tn = notes.get(g.id);
            const noteText = g.note || (tn && tn.last) || null;
            if (noteText) mark(g, 'note: ' + (noteText.length > 90 ? noteText.slice(0, 89) + '…' : noteText), 1);
            if (g.party >= 3) mark(g, 'party of ' + g.party, 2);
        }
        const notable = [...notableMap.values()]
            .sort((a, b) => a.rank - b.rank || b.party_size - a.party_size || a.name.localeCompare(b.name))
            .slice(0, 12)
            .map(({ rank, ...rest }) => rest);
        const notedGuests = guests.filter(g => g.note || notes.get(g.id));

        // -------- kitchen
        const buckets = new Map();
        const dietLines = [];
        for (const g of guests) {
            const d = g.dietary;
            if (!d || DIET_NONE.has(d.toLowerCase())) continue;
            const low = d.toLowerCase();
            let hit = false;
            for (const [labelB, kws] of DIET_BUCKETS) {
                if (kws.some(k => low.includes(k))) { buckets.set(labelB, (buckets.get(labelB) || 0) + 1); hit = true; }
            }
            if (!hit) buckets.set('other', (buckets.get('other') || 0) + 1);
            if (dietLines.length < 20) dietLines.push({ name: g.name, text: d });
        }
        const dietary = {
            buckets: DIET_BUCKETS.map(([labelB]) => labelB).concat(['other'])
                .filter(labelB => buckets.has(labelB))
                .map(labelB => ({ label: labelB, count: buckets.get(labelB) })),
            lines: dietLines,
            unknown_plus_ones: plusOnes
        };

        // -------- arrivals
        const arrivals = bookings ? arrivalsFor(eventKey, people) : null;

        // -------- talking points (auto-derived, deterministic, each one door-usable)
        const points = [];
        if (!bookings) {
            points.push('No registrations yet for this door — the brief fills itself as bookings land.');
        } else {
            if (institutions.length && institutions[0].people >= 2) {
                points.push(`${plural(institutions[0].people, 'guest')} from ${institutions[0].name} — largest delegation`);
            }
            const foreign = countries.filter(c => c.name !== 'Croatia');
            if (foreign.length) {
                const top = foreign[0];
                if (top.people >= 2) points.push(`${top.people} guests flying in from ${COUNTRY_SHORT[top.name] || top.name}`);
                else points.push(`${plural(foreign.reduce((n, c) => n + c.people, 0), 'guest')} from abroad tonight`);
                if (countries.length >= 5) points.push(`Guests from ${countries.length} countries in the room`);
            }
            if (pendingPeople > 0) points.push(`${plural(pendingPeople, 'unpaid seat')} to resolve at the door (${plural(pendingBookings, 'booking')})`);
            if (catCounts.size) {
                const bits = [...catCounts.entries()].map(([lab, c]) => `${c.n} × ${lab}`);
                const names = [...catCounts.values()].flatMap(c => c.names);
                points.push(`Notable seats: ${bits.join(' · ')}${names.length && names.length <= 3 ? ' (' + names.join(', ') + ')' : ''} — greet by name at the door`);
            }
            const biggest = guests.reduce((b, g) => (g.party > (b ? b.party : 2) ? g : b), null);
            if (biggest) points.push(`Largest party: ${biggest.name} — ${biggest.party} people on one QR`);
            if (notedGuests.length) points.push(`${plural(notedGuests.length, 'guest carries', 'guests carry')} a note from the team — see notable guests`);
            if (dietary.buckets.length) {
                points.push('Kitchen: ' + dietary.buckets.map(b => `${b.count} ${b.label}`).join(' · '));
            }
            if (arrivals) {
                const partial = Math.max(0, arrivals.parties_started - arrivals.parties_complete);
                points.push(`${arrivals.admitted_people} of ${people} already in${partial ? ` — ${plural(partial, 'party', 'parties')} arriving in parts` : ''}`);
            }
        }

        const brief = {
            ok: true,
            event: eventKey,
            event_label: label,
            date_label: dateLabel,
            generated_at: new Date().toISOString(),
            empty: !bookings,
            headline: {
                bookings, people, plus_ones: plusOnes,
                paid_people: paidPeople, pending_people: pendingPeople, pending_bookings: pendingBookings, free_people: freePeople,
                institutions: institutions.length, countries: countries.length
            },
            arrivals,
            notable,
            top_institutions: institutions.slice(0, 5),
            top_countries: countries.slice(0, 6),
            dietary,
            talking_points: points.slice(0, 8)
        };
        brief.text = composeText(brief);
        return brief;
    }

    // Plain-text one-pager — what COPY AS TEXT puts on the clipboard. Reads well in a chat
    // message; middle dots, no tables, Croatian diacritics untouched.
    function composeText(b) {
        const L = [];
        L.push('MED&X — HOST BRIEF');
        L.push(b.event_label + (b.date_label ? ' · ' + b.date_label : ''));
        L.push('composed ' + stamp(new Date()));
        L.push('');
        if (b.empty) {
            L.push('No registrations yet for this door — the brief fills itself as bookings land.');
            return L.join('\n');
        }
        const h = b.headline;
        L.push('THE ROOM');
        L.push(`· ${h.people} people expected across ${plural(h.bookings, 'booking')}${h.plus_ones ? ` (${h.plus_ones} plus-one${h.plus_ones === 1 ? '' : 's'})` : ''}`);
        const pay = [`${h.paid_people} paid`, `${h.pending_people} pending`];
        if (h.free_people) pay.push(`${h.free_people} free / no payment needed`);
        L.push('· ' + pay.join(' · '));
        const scope = [];
        if (h.institutions) scope.push(plural(h.institutions, 'institution'));
        if (h.countries) scope.push(plural(h.countries, 'country', 'countries'));
        if (scope.length) L.push('· ' + scope.join(' · '));
        if (b.arrivals) L.push(`· ${b.arrivals.admitted_people} already in`);
        L.push('');
        L.push('TALKING POINTS');
        b.talking_points.forEach(p => L.push('· ' + p));
        if (b.notable.length) {
            L.push('');
            L.push(`NOTABLE GUESTS (${b.notable.length})`);
            b.notable.forEach(n => {
                const bits = [...n.tags];
                if (n.party_size > 1 && !n.tags.some(t => t.startsWith('party of'))) bits.push('party of ' + n.party_size);
                if (n.institution) bits.push(n.institution);
                L.push('· ' + n.name + ' — ' + bits.join(' · '));
            });
        }
        L.push('');
        L.push('KITCHEN');
        if (b.dietary.buckets.length) {
            L.push('· ' + b.dietary.buckets.map(x => `${x.count} ${x.label}`).join(' · '));
            b.dietary.lines.forEach(x => L.push(`· ${x.name} — ${x.text}`));
        } else {
            L.push('· No dietary requests on file.');
        }
        if (b.dietary.unknown_plus_ones) L.push(`· ${plural(b.dietary.unknown_plus_ones, 'plus-one guest carries', 'plus-one guests carry')} no dietary info`);
        return L.join('\n');
    }

    // ---------------------------------------------------------------- route
    app.get('/api/v2/host-brief', auth, staffOrAdmin, (req, res) => {
        try {
            const eventKey = String(req.query.event || '').trim();
            if (!EVENT_KEYS.includes(eventKey)) {
                return res.status(400).json({ error: 'Unknown event: ' + (eventKey || '(none)') + ' — use conference | gala | donor | bridges' });
            }
            res.json(composeBrief(eventKey));
        } catch (e) {
            console.error('[v2/host-brief]', e);
            res.status(500).json({ error: e.message });
        }
    });

    log('host-brief: deterministic "who is coming tonight" one-pager ready');
};
