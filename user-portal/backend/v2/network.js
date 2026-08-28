/**
 * user-portal/backend/v2/network.js — NETWORK · PEOPLE (frontend-v2 `js/views/network.js`,
 * artboard Network.dc.html). Mounted by v2/index.js; routes live under /api/v2/network/….
 *
 * What the existing server.js already gives the screen (unchanged, reused by the view):
 *   POST /api/networking/connections {receiver_id}      CONNECT           → {id, status:'pending'} (409 when any row exists)
 *   PUT  /api/networking/connections/:id {status}       ACCEPT / DECLINE  → receiver only, 'accepted' | 'rejected'
 *   GET  /api/networking/connections                    MY NETWORK        → accepted rows + partner fields
 *   GET  /api/networking/connections/pending            REQUESTS          → incoming pending + requester fields
 *
 * What was missing (README note 12, gap matrix H-1…H-4) and lives here:
 *   GET  /api/v2/network/search?q=&page=&size=          one field, every angle: tokenised LIKE across name,
 *                                                       institution, specialty/interests, city, country, bio and
 *                                                       program participation; cards carry connection state + matchedOn
 *   GET  /api/v2/network/suggestions?limit=             "People for you" with server-computed reason chips
 *   GET  /api/v2/network/directory?page=&size=          BROWSE ALL <N> MEMBERS — paginated full directory
 *   GET  /api/v2/network/summary                        live counts (members, requests in/out, connections)
 *   DELETE /api/v2/network/connections/:id              cancel my pending request · remove a connection · (as the
 *                                                       decliner) clear a declined request so a fresh one can be sent
 *
 * Privacy: only `users.is_public_profile = 1`, not deleted, named accounts are ever listed; quiet (senior-only)
 * members are excluded like GET /api/networking/discover (deriveAffiliationClass, fail-closed) — EXCEPT active Forum
 * members with profile_visibility ≠ private, who surface year-round (README note 13, same gates as the Forum builder's
 * GET /api/v2/forum/members-public). E-mail and phone are never selected into a response. Every query is parameterised;
 * page sizes are capped.
 *
 * Schema: nothing new is created except two idempotent indexes on networking_connections (both portals share one DB —
 * no table/column is renamed or dropped). Optional columns a Profile builder may add (users.title / users.city /
 * users.specialties) are detected at request time via PRAGMA and used when present.
 */
'use strict';

module.exports = function mountNetwork(app, ctx) {
    const { db, auth } = ctx;
    const log = ctx.log || ((...a) => console.log('[v2/network]', ...a));

    // ---------------------------------------------------------------- db helpers (sql.js-style wrapper, see shared/db.js)
    const q = {
        get(sql, params = []) {
            const st = db().prepare(sql); st.bind(params);
            const row = st.step() ? st.getAsObject() : null; st.free(); return row;
        },
        all(sql, params = []) {
            const st = db().prepare(sql); st.bind(params);
            const rows = []; while (st.step()) rows.push(st.getAsObject()); st.free(); return rows;
        },
        run(sql, params = []) { return db().run(sql, params); }
    };

    // idempotent indexes — the connection-state lookups are per member, both directions
    for (const ddl of [
        'CREATE INDEX IF NOT EXISTS idx_networking_connections_requester ON networking_connections (requester_id)',
        'CREATE INDEX IF NOT EXISTS idx_networking_connections_receiver ON networking_connections (receiver_id)'
    ]) { try { db().run(ddl); } catch (e) { /* read-only replica or older engine — queries still work */ } }

    // ---------------------------------------------------------------- optional columns (Profile builder may ALTER users)
    let colCache = { at: 0, users: new Set(), bridges: new Set(), gala: new Set(), registrations: new Set(), accelerator: new Set(), forum: new Set() };
    function columns(table) {
        try { return new Set(q.all(`PRAGMA table_info(${table})`).map(r => r.name)); } catch (e) { return new Set(); }
    }
    function cols() {
        if (Date.now() - colCache.at > 60000) {
            colCache = { at: Date.now(), users: columns('users'), bridges: columns('bridges_registrations'), gala: columns('gala_registrations'),
                registrations: columns('registrations'), accelerator: columns('accelerator_applications'), forum: columns('forum_members') };
        }
        return colCache;
    }

    // ---------------------------------------------------------------- vocab
    const COUNTRIES = [
        { iso: 'hr', name: 'Croatia', aliases: ['hr', 'croatia', 'hrvatska'] },
        { iso: 'us', name: 'United States', aliases: ['us', 'usa', 'united states', 'united states of america', 'america'] },
        { iso: 'ch', name: 'Switzerland', aliases: ['ch', 'switzerland', 'schweiz', 'suisse'] },
        { iso: 'de', name: 'Germany', aliases: ['de', 'germany', 'deutschland'] },
        { iso: 'at', name: 'Austria', aliases: ['at', 'austria', 'österreich', 'osterreich'] },
        { iso: 'gb', name: 'United Kingdom', aliases: ['gb', 'uk', 'united kingdom', 'england', 'scotland', 'wales', 'britain'] },
        { iso: 'ie', name: 'Ireland', aliases: ['ie', 'ireland'] },
        { iso: 'gh', name: 'Ghana', aliases: ['gh', 'ghana'] },
        { iso: 'nl', name: 'Netherlands', aliases: ['nl', 'netherlands', 'holland'] },
        { iso: 'it', name: 'Italy', aliases: ['it', 'italy', 'italia'] },
        { iso: 'fr', name: 'France', aliases: ['fr', 'france'] },
        { iso: 'es', name: 'Spain', aliases: ['es', 'spain', 'españa'] },
        { iso: 'pt', name: 'Portugal', aliases: ['pt', 'portugal'] },
        { iso: 'se', name: 'Sweden', aliases: ['se', 'sweden'] },
        { iso: 'no', name: 'Norway', aliases: ['no', 'norway'] },
        { iso: 'dk', name: 'Denmark', aliases: ['dk', 'denmark'] },
        { iso: 'fi', name: 'Finland', aliases: ['fi', 'finland'] },
        { iso: 'pl', name: 'Poland', aliases: ['pl', 'poland'] },
        { iso: 'cz', name: 'Czechia', aliases: ['cz', 'czechia', 'czech republic'] },
        { iso: 'si', name: 'Slovenia', aliases: ['si', 'slovenia', 'slovenija'] },
        { iso: 'ba', name: 'Bosnia and Herzegovina', aliases: ['ba', 'bosnia', 'bosnia and herzegovina', 'bih'] },
        { iso: 'rs', name: 'Serbia', aliases: ['rs', 'serbia'] },
        { iso: 'hu', name: 'Hungary', aliases: ['hu', 'hungary'] },
        { iso: 'be', name: 'Belgium', aliases: ['be', 'belgium'] },
        { iso: 'ca', name: 'Canada', aliases: ['ca', 'canada'] },
        { iso: 'au', name: 'Australia', aliases: ['au', 'australia'] },
        { iso: 'jp', name: 'Japan', aliases: ['jp', 'japan'] },
        { iso: 'cn', name: 'China', aliases: ['cn', 'china'] },
        { iso: 'in', name: 'India', aliases: ['in', 'india'] },
        { iso: 'br', name: 'Brazil', aliases: ['br', 'brazil', 'brasil'] },
        { iso: 'sg', name: 'Singapore', aliases: ['sg', 'singapore'] },
        { iso: 'il', name: 'Israel', aliases: ['il', 'israel'] },
        { iso: 'tr', name: 'Türkiye', aliases: ['tr', 'turkey', 'türkiye'] },
        { iso: 'gr', name: 'Greece', aliases: ['gr', 'greece'] }
    ];
    const countryByAlias = new Map();
    COUNTRIES.forEach(c => c.aliases.forEach(a => countryByAlias.set(a, c)));
    function countryOf(raw) {
        const s = String(raw || '').trim().toLowerCase();
        if (!s) return null;
        return countryByAlias.get(s) || null;
    }
    function countryLabel(raw) { const c = countryOf(raw); return c ? c.name : String(raw || '').trim(); }

    // program keywords → participation flag (a search token that is a prefix of one of these matches the flag)
    const PROGRAM_WORDS = {
        plexus: ['plexus', 'conference', 'zagreb 2026'], gala: ['gala', 'evening', 'esplanade'],
        bridges: ['bridges', 'bridge', 'boston', 'diaspora'], forum: ['forum', 'biomedical'],
        alumni: ['accelerator', 'alumni', 'alumna', 'alumnus', 'fellow', 'fellows', 'fellowship'],
        team: ['team', 'staff', 'coordinator', 'medx', 'med&x', 'organiser', 'organizer']
    };
    function programsForToken(tok) {
        const out = [];
        if (tok.length < 3) return out;
        for (const [flag, words] of Object.entries(PROGRAM_WORDS)) if (words.some(w => w.startsWith(tok))) out.push(flag);
        return out;
    }

    const fold = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const likeEscape = s => String(s).replace(/[\\%_]/g, m => '\\' + m);
    function tokens(qs) {
        return String(qs || '').toLowerCase().replace(/[“”"'‘’]/g, ' ').split(/[\s,;/|]+/).map(t => t.trim()).filter(Boolean)
            .filter((t, i, arr) => t.length >= 2 || arr.length === 1).slice(0, 6);
    }
    function parseList(v) {
        if (v == null || v === '') return [];
        if (Array.isArray(v)) return v.map(x => String(x).trim()).filter(Boolean);
        const s = String(v).trim();
        if (s.startsWith('[')) { try { const a = JSON.parse(s); if (Array.isArray(a)) return a.map(x => String(x).trim()).filter(Boolean); } catch (e) { /* csv below */ } }
        return s.split(/[,;|]+/).map(x => x.trim()).filter(Boolean);
    }
    function dedupe(list, cap) {
        const seen = new Set(); const out = [];
        for (const x of list) { const k = fold(x); if (!k || seen.has(k)) continue; seen.add(k); out.push(x); if (out.length >= cap) break; }
        return out;
    }
    const clampInt = (v, def, min, max) => { const n = parseInt(v, 10); return isNaN(n) ? def : Math.max(min, Math.min(max, n)); };

    // ---------------------------------------------------------------- active conference (for the PLEXUS <year> tag)
    let confCache = { at: 0, row: null };
    function activeConf() {
        if (Date.now() - confCache.at > 60000) {
            try { confCache = { at: Date.now(), row: q.get('SELECT id, name, year FROM conferences WHERE is_active = 1 ORDER BY year DESC, start_date DESC LIMIT 1') }; }
            catch (e) { confCache = { at: Date.now(), row: null }; }
        }
        return confCache.row;
    }

    // ---------------------------------------------------------------- the member base (one CTE shared by every route)
    // Builds `WITH members AS (…)` with participation flags, the search haystack and the visibility + quiet gates.
    function memberCte() {
        const c = cols();
        const uTitle = c.users.has('title') ? 'u.title' : 'NULL';
        const uCity = c.users.has('city') ? 'u.city' : 'NULL';
        const uSpec = c.users.has('specialties') ? 'u.specialties' : 'NULL';
        const bridgesByUser = c.bridges.has('user_id') ? 'b.user_id = u.id OR ' : '';
        const galaByUser = c.gala.has('user_id') ? 'g.user_id = u.id OR ' : '';
        const regByEmail = c.registrations.has('email') ? ' OR lower(r.email) = lower(u.email)' : '';
        const accByEmail = c.accelerator.has('email') ? ' OR lower(a.email) = lower(u.email)' : '';
        const accDecision = c.accelerator.has('decision') ? "a.decision = 'accepted' OR " : '';
        const fmBanned = c.forum.has('banned') ? ' AND COALESCE(fm.banned,0) = 0' : '';
        const fmValid = c.forum.has('valid_until') ? " AND (fm.valid_until IS NULL OR fm.valid_until >= date('now'))" : '';
        const fmVisible = c.forum.has('profile_visibility') ? " AND lower(COALESCE(fm.profile_visibility,'members')) <> 'private'" : '';
        // active forum membership — same gates as GET /api/v2/forum/members-public (the Forum builder's endpoint)
        const fmJoin = `fm.user_id = u.id AND lower(COALESCE(fm.membership_status,'')) IN ('approved','active')${fmBanned}${fmValid}${fmVisible}`;
        // quiet = senior-only affiliations (gala/forum) and no general-member signal — mirrors deriveAffiliationClass()
        const quiet = `(COALESCE(u.is_admin,0) = 0
            AND ( EXISTS(SELECT 1 FROM gala_registrations g WHERE ${galaByUser}lower(g.email) = lower(u.email))
               OR EXISTS(SELECT 1 FROM forum_members f WHERE f.user_id = u.id AND COALESCE(f.membership_status,'') <> 'rejected') )
            AND NOT ( EXISTS(SELECT 1 FROM registrations r WHERE r.user_id = u.id)
                   OR EXISTS(SELECT 1 FROM accelerator_applications a WHERE a.user_id = u.id${accByEmail})
                   OR EXISTS(SELECT 1 FROM bridges_registrations b WHERE ${bridgesByUser}lower(b.email) = lower(u.email)) ))`;
        const sql = `WITH members AS (
          SELECT u.id, u.first_name, u.last_name, u.institution, u.country, u.bio, u.photo_url, COALESCE(u.is_admin,0) AS is_admin, u.created_at,
                 ${uTitle} AS u_title, ${uCity} AS u_city, ${uSpec} AS u_specialties,
                 up.title AS up_title, up.department AS up_department, up.research_interests AS up_interests, up.career_stage AS up_stage,
                 np.research_interests AS np_interests, np.career_stage AS np_stage, np.looking_for AS np_looking, np.working_on AS np_working,
                 fm.specialty AS fm_specialty, fm.sub_specialties AS fm_sub, fm.institution AS fm_institution, fm.position AS fm_position,
                 fm.department AS fm_department, fm.location_city AS fm_city, fm.location_country AS fm_country, fm.research_interests AS fm_interests,
                 CASE WHEN fm.id IS NULL THEN 0 ELSE 1 END AS p_forum,
                 EXISTS(SELECT 1 FROM registrations r JOIN conferences cf ON cf.id = r.conference_id
                        WHERE cf.is_active = 1 AND (r.user_id = u.id${regByEmail}) AND COALESCE(r.revoked,0) = 0
                          AND COALESCE(r.status,'') NOT IN ('cancelled','rejected','refunded')) AS p_plexus,
                 EXISTS(SELECT 1 FROM gala_registrations g WHERE (${galaByUser}lower(g.email) = lower(u.email))
                          AND COALESCE(g.status,'') NOT IN ('cancelled','rejected','declined','refunded')) AS p_gala,
                 EXISTS(SELECT 1 FROM bridges_registrations b WHERE (${bridgesByUser}lower(b.email) = lower(u.email))
                          AND COALESCE(b.status,'') NOT IN ('cancelled')) AS p_bridges,
                 (EXISTS(SELECT 1 FROM accelerator_applications a WHERE (a.user_id = u.id${accByEmail}) AND (${accDecision}a.status IN ('accepted','completed')))
                  OR EXISTS(SELECT 1 FROM member_meta mm WHERE mm.user_id = u.id AND mm.member_type = 'alumni')) AS p_alumni,
                 lower(TRIM(COALESCE(u.country,''))) AS country_l, lower(TRIM(COALESCE(fm.location_country,''))) AS fm_country_l,
                 (COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')) AS full_name,
                 (COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'') || ' ' || COALESCE(u.institution,'') || ' ' || COALESCE(u.country,'') || ' ' || COALESCE(u.bio,'')
                  || ' ' || COALESCE(${uTitle},'') || ' ' || COALESCE(${uCity},'') || ' ' || COALESCE(${uSpec},'')
                  || ' ' || COALESCE(up.title,'') || ' ' || COALESCE(up.department,'') || ' ' || COALESCE(up.research_interests,'') || ' ' || COALESCE(up.career_stage,'')
                  || ' ' || COALESCE(np.research_interests,'') || ' ' || COALESCE(np.career_stage,'') || ' ' || COALESCE(np.looking_for,'') || ' ' || COALESCE(np.working_on,'')
                  || ' ' || COALESCE(fm.specialty,'') || ' ' || COALESCE(fm.sub_specialties,'') || ' ' || COALESCE(fm.institution,'') || ' ' || COALESCE(fm.position,'')
                  || ' ' || COALESCE(fm.department,'') || ' ' || COALESCE(fm.location_city,'') || ' ' || COALESCE(fm.location_country,'') || ' ' || COALESCE(fm.research_interests,'')) AS hay
          FROM users u
          LEFT JOIN user_profiles up ON up.user_id = u.id
          LEFT JOIN networking_profiles np ON np.user_id = u.id
          LEFT JOIN forum_members fm ON ${fmJoin}
          WHERE u.id <> ? AND u.deleted_at IS NULL AND COALESCE(u.is_public_profile,1) = 1
            AND (COALESCE(TRIM(u.first_name),'') <> '' OR COALESCE(TRIM(u.last_name),'') <> '')
            AND NOT (${quiet} AND fm.id IS NULL)
        )`;
        return sql;
    }

    // token → SQL clause over the CTE (+ params). A token matches the haystack, a program flag, or a country alias.
    function tokenClause(tok) {
        const params = ['%' + likeEscape(tok) + '%'];
        let sql = "hay LIKE ? ESCAPE '\\'";
        for (const flag of programsForToken(tok)) sql += flag === 'team' ? ' OR is_admin = 1' : ` OR p_${flag} = 1`;
        const country = countryOf(tok) || (tok.length >= 4 ? COUNTRIES.find(c => c.aliases.some(a => a.startsWith(tok))) : null);
        if (country) {
            const ph = country.aliases.map(() => '?').join(',');
            sql += ` OR country_l IN (${ph}) OR fm_country_l IN (${ph})`;
            params.push(...country.aliases, ...country.aliases);
        }
        return { sql: '(' + sql + ')', params };
    }

    // ---------------------------------------------------------------- connection state per counterpart
    function connectionMap(me) {
        const map = new Map();
        try {
            q.all('SELECT id, requester_id, receiver_id, status FROM networking_connections WHERE requester_id = ? OR receiver_id = ?', [me, me]).forEach(r => {
                const other = r.requester_id === me ? r.receiver_id : r.requester_id;
                const mine = r.requester_id === me;
                const state = r.status === 'accepted' ? 'connected' : r.status === 'pending' ? (mine ? 'pending_out' : 'pending_in')
                    : r.status === 'rejected' ? (mine ? 'declined' : 'declined_by_me') : 'none';
                if (!map.has(other) || state === 'connected') map.set(other, { id: r.id, state, status: r.status });
            });
        } catch (e) { /* table optional */ }
        return map;
    }
    function mutualCounts(me) {
        const out = new Map();
        try {
            q.all(`WITH mine AS (
                     SELECT CASE WHEN requester_id = ? THEN receiver_id ELSE requester_id END AS uid
                     FROM networking_connections WHERE (requester_id = ? OR receiver_id = ?) AND status = 'accepted')
                   SELECT other_uid AS user_id, COUNT(*) AS n FROM (
                     SELECT (CASE WHEN nc.requester_id = mine.uid THEN nc.receiver_id ELSE nc.requester_id END) AS other_uid
                     FROM networking_connections nc JOIN mine ON (nc.requester_id = mine.uid OR nc.receiver_id = mine.uid)
                     WHERE nc.status = 'accepted')
                   WHERE other_uid <> ? GROUP BY other_uid`, [me, me, me, me]).forEach(r => out.set(r.user_id, Number(r.n) || 0));
        } catch (e) { /* optional */ }
        return out;
    }

    // ---------------------------------------------------------------- row → card (never carries email / phone)
    function specialtiesOf(r) {
        return dedupe([].concat(parseList(r.u_specialties), parseList(r.np_interests), parseList(r.up_interests), parseList(r.fm_specialty), parseList(r.fm_sub)), 6);
    }
    function card(r, cmap, conf) {
        const first = String(r.first_name || '').trim(), last = String(r.last_name || '').trim();
        const name = (first + ' ' + last).trim() || 'Member';
        const initials = ((first[0] || '') + (last[0] || (first.split(' ')[1] || '')[0] || '')).toUpperCase() || name[0].toUpperCase();
        const tags = [];
        if (r.is_admin) tags.push('MED&X TEAM');
        if (r.p_plexus) tags.push('PLEXUS' + (conf && conf.year ? ' ' + conf.year : ''));
        if (r.p_gala) tags.push('GALA');
        if (r.p_forum) tags.push('FORUM MEMBER');
        if (r.p_bridges) tags.push('BRIDGES');
        if (r.p_alumni) tags.push('ACCELERATOR ALUMNI');
        const conn = cmap.get(r.id) || { id: null, state: 'none' };
        const city = String(r.u_city || r.fm_city || '').trim();
        const countryRaw = String(r.country || r.fm_country || '').trim();
        return {
            id: r.id, first_name: first, last_name: last, name, initials,
            photo_url: r.photo_url || null,
            title: String(r.u_title || r.up_title || r.fm_position || '').trim(),
            institution: String(r.institution || r.fm_institution || '').trim(),
            city, country: countryLabel(countryRaw), country_iso: (countryOf(countryRaw) || {}).iso || null,
            specialties: specialtiesOf(r),
            tags, is_team: !!r.is_admin,
            programs: { plexus: !!r.p_plexus, gala: !!r.p_gala, forum: !!r.p_forum, bridges: !!r.p_bridges, alumni: !!r.p_alumni, team: !!r.is_admin },
            bio: String(r.bio || '').replace(/\s+/g, ' ').trim().slice(0, 280),
            member_since: r.created_at ? String(r.created_at).slice(0, 10) : null,
            connection: { state: conn.state, id: conn.id }
        };
    }
    // which fields a search token hit (client shows "matches specialty" etc.) — diacritic-folded, superset of the SQL LIKE
    function matchedOn(r, c, toks) {
        const fields = [
            ['name', c.name], ['institution', c.institution], ['specialty', c.specialties.join(' ')], ['city', c.city],
            ['country', [c.country, r.country, r.fm_country].join(' ')], ['title', c.title], ['bio', c.bio],
            ['interests', [r.np_looking, r.np_working, r.up_department, r.fm_department, r.np_stage, r.up_stage].join(' ')],
            ['program', [c.tags.join(' '), ...Object.entries(c.programs).filter(([, v]) => v).map(([k]) => k), c.is_team ? 'team medx' : ''].join(' ')]
        ].map(([k, v]) => [k, fold(v)]);
        const hits = [];
        toks.forEach(t => {
            const tf = fold(t); const progs = programsForToken(tf);
            fields.forEach(([k, v]) => { if (v && v.includes(tf) && !hits.includes(k)) hits.push(k); });
            if (progs.some(p => c.programs[p]) && !hits.includes('program')) hits.push('program');
            const co = countryOf(tf); if (co && co.iso === c.country_iso && !hits.includes('country')) hits.push('country');
        });
        return hits;
    }

    // ---------------------------------------------------------------- list query (search + directory)
    function listMembers(me, qs, page, size) {
        const toks = tokens(qs);
        const clauses = toks.map(tokenClause);
        const where = clauses.length ? ' WHERE ' + clauses.map(c => c.sql).join(' AND ') : '';
        const params = [me].concat(...clauses.map(c => c.params));
        const cte = memberCte();
        const total = (q.get(`${cte} SELECT COUNT(*) AS n FROM members${where}`, params) || {}).n || 0;
        // relevance: name hits first (per token), then a stable alphabetical order
        const nameScore = toks.map(() => "(CASE WHEN full_name LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END)").join(' + ');
        const orderBy = (toks.length ? `(${nameScore}) DESC, ` : '') + "lower(COALESCE(last_name,'')), lower(COALESCE(first_name,'')), id";
        const orderParams = toks.map(t => '%' + likeEscape(t) + '%');
        const rows = q.all(`${cte} SELECT * FROM members${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
            params.concat(orderParams, [size, (page - 1) * size]));
        const cmap = connectionMap(me), conf = activeConf();
        const results = rows.map(r => { const c = card(r, cmap, conf); if (toks.length) c.matchedOn = matchedOn(r, c, toks); return c; });
        return { total: Number(total), results, tokens: toks };
    }
    function memberTotal(me) {
        try { return Number((q.get(`${memberCte()} SELECT COUNT(*) AS n FROM members`, [me]) || {}).n || 0); } catch (e) { return 0; }
    }
    function meProfile(me) {
        const c = cols();
        const r = q.get(`SELECT u.id, u.institution, u.country, ${c.users.has('city') ? 'u.city' : 'NULL'} AS u_city, ${c.users.has('specialties') ? 'u.specialties' : 'NULL'} AS u_specialties,
                            up.research_interests AS up_interests, np.research_interests AS np_interests, fm.specialty AS fm_specialty, fm.sub_specialties AS fm_sub,
                            fm.location_city AS fm_city, fm.location_country AS fm_country
                         FROM users u LEFT JOIN user_profiles up ON up.user_id = u.id LEFT JOIN networking_profiles np ON np.user_id = u.id
                         LEFT JOIN forum_members fm ON fm.user_id = u.id AND lower(COALESCE(fm.membership_status,'')) IN ('approved','active') WHERE u.id = ?`, [me]) || {};
        return {
            institution: fold(r.institution || ''),
            city: fold(r.u_city || r.fm_city || ''),
            country: (countryOf(r.country || r.fm_country) || {}).iso || fold(r.country || r.fm_country || ''),
            specialties: new Set(specialtiesOf(r).map(fold))
        };
    }

    // ---------------------------------------------------------------- routes
    // GET /api/v2/network/search?q=&page=&size=
    app.get('/api/v2/network/search', auth, (req, res) => {
        try {
            const qs = String(req.query.q || '').slice(0, 80).trim();
            const page = clampInt(req.query.page, 1, 1, 500), size = clampInt(req.query.size, 20, 1, 50);
            const { total, results, tokens: toks } = listMembers(req.user.id, qs, page, size);
            res.json({ q: qs, tokens: toks, page, size, total, pages: Math.max(1, Math.ceil(total / size)), members_total: memberTotal(req.user.id), results });
        } catch (e) { log('search failed:', e.message); res.status(500).json({ error: 'Search is unavailable right now.' }); }
    });

    // GET /api/v2/network/directory?page=&size=  — the full directory, alphabetical, paginated
    app.get('/api/v2/network/directory', auth, (req, res) => {
        try {
            const page = clampInt(req.query.page, 1, 1, 500), size = clampInt(req.query.size, 24, 1, 50);
            const { total, results } = listMembers(req.user.id, '', page, size);
            res.json({ page, size, total, pages: Math.max(1, Math.ceil(total / size)), results });
        } catch (e) { log('directory failed:', e.message); res.status(500).json({ error: 'The directory is unavailable right now.' }); }
    });

    // GET /api/v2/network/suggestions?limit=  — "People for you": reasons computed here, deterministic order
    const REASONS = {
        mutual: { label: n => `MUTUAL CONTACTS · ${n}`, weight: 5 },
        institution: { label: () => 'SAME INSTITUTION', weight: 4 },
        specialty: { label: () => 'SHARED FIELD', weight: 4 },
        city: { label: () => 'SAME CITY', weight: 3 },
        plexus: { label: () => 'ATTENDS PLEXUS', weight: 2.5 },
        country: { label: () => 'SAME COUNTRY', weight: 2 },
        forum: { label: () => 'FORUM MEMBER', weight: 1.5 },
        team: { label: () => 'MED&X TEAM', weight: 1 },
        new: { label: () => 'NEW MEMBER', weight: 1 },
        member: { label: () => 'MED&X MEMBER', weight: 0 }
    };
    app.get('/api/v2/network/suggestions', auth, (req, res) => {
        try {
            const me = req.user.id;
            const limit = clampInt(req.query.limit, 8, 1, 24);
            const cmap = connectionMap(me), mutual = mutualCounts(me), mine = meProfile(me), conf = activeConf();
            const rows = q.all(`${memberCte()} SELECT * FROM members ORDER BY datetime(created_at) DESC, id LIMIT 2000`, [me]);
            const now = Date.now();
            const scored = [];
            for (const r of rows) {
                if (cmap.has(r.id)) continue;                         // already connected / pending / declined — never re-suggested
                const c = card(r, cmap, conf);
                const reasons = [];
                const add = (key, n) => reasons.push({ key, label: REASONS[key].label(n), weight: REASONS[key].weight + (key === 'mutual' ? Math.min(3, n - 1) : 0), n });
                const m = mutual.get(r.id) || 0; if (m > 0) add('mutual', m);
                if (mine.institution && fold(c.institution) === mine.institution) add('institution');
                if (mine.specialties.size && c.specialties.some(s => mine.specialties.has(fold(s)))) add('specialty');
                if (mine.city && fold(c.city) && fold(c.city) === mine.city) add('city');
                if (c.programs.plexus) add('plexus');
                if (mine.country && c.country_iso && c.country_iso === mine.country && !reasons.some(x => x.key === 'city')) add('country');
                if (c.programs.forum) add('forum');
                if (c.is_team) add('team');
                const created = r.created_at ? new Date(String(r.created_at).replace(' ', 'T') + (String(r.created_at).length <= 19 ? 'Z' : '')).getTime() : 0;
                if (created && now - created < 30 * 86400000) add('new');
                if (!reasons.length) add('member');
                reasons.sort((a, b) => b.weight - a.weight);
                const score = reasons.reduce((s, x) => s + x.weight, 0);
                scored.push({ card: c, score, createdTs: created, reasons });
            }
            scored.sort((a, b) => b.score - a.score || b.createdTs - a.createdTs || a.card.last_name.localeCompare(b.card.last_name) || a.card.first_name.localeCompare(b.card.first_name) || a.card.id.localeCompare(b.card.id));
            const out = scored.slice(0, limit).map(s => Object.assign(s.card, { why: s.reasons[0].key, why_label: s.reasons[0].label, reasons: s.reasons.map(x => ({ key: x.key, label: x.label, n: x.n || null })), score: Math.round(s.score * 10) / 10 }));
            res.json({ limit, count: out.length, candidates: scored.length, results: out });
        } catch (e) { log('suggestions failed:', e.message); res.status(500).json({ error: 'Suggestions are unavailable right now.' }); }
    });

    // GET /api/v2/network/summary  — live counts for the screen (BROWSE ALL <N> MEMBERS, badges)
    app.get('/api/v2/network/summary', auth, (req, res) => {
        try {
            const me = req.user.id;
            const cnt = (sql, p) => Number((q.get(sql, p) || {}).n || 0);
            res.json({
                members: memberTotal(me),
                connections: cnt("SELECT COUNT(*) AS n FROM networking_connections WHERE (requester_id = ? OR receiver_id = ?) AND status = 'accepted'", [me, me]),
                pending_in: cnt("SELECT COUNT(*) AS n FROM networking_connections WHERE receiver_id = ? AND status = 'pending'", [me]),
                pending_out: cnt("SELECT COUNT(*) AS n FROM networking_connections WHERE requester_id = ? AND status = 'pending'", [me])
            });
        } catch (e) { log('summary failed:', e.message); res.status(500).json({ error: 'Network summary is unavailable right now.' }); }
    });

    // DELETE /api/v2/network/connections/:id — the one mutation the legacy family lacks:
    //   pending  + I am the requester  → cancel my request
    //   accepted + either side         → remove the connection (both lose the DM channel)
    //   rejected + I am the receiver   → clear my decline so a fresh request can be made (the requester can never force this)
    app.delete('/api/v2/network/connections/:id', auth, (req, res) => {
        try {
            const me = req.user.id;
            const row = q.get('SELECT id, requester_id, receiver_id, status FROM networking_connections WHERE id = ?', [String(req.params.id || '')]);
            if (!row || (row.requester_id !== me && row.receiver_id !== me)) return res.status(404).json({ error: 'Connection not found' });
            const mine = row.requester_id === me;
            let action = null;
            if (row.status === 'pending' && mine) action = 'cancelled';
            else if (row.status === 'accepted') action = 'removed';
            else if (row.status === 'rejected' && !mine) action = 'cleared';
            if (!action) return res.status(403).json({ error: row.status === 'pending' ? 'Decline the request instead of deleting it.' : 'This request was declined — only the other member can reopen it.' });
            q.run('DELETE FROM networking_connections WHERE id = ?', [row.id]);
            res.json({ success: true, action, other_id: mine ? row.receiver_id : row.requester_id });
        } catch (e) { log('delete failed:', e.message); res.status(500).json({ error: 'Could not update the connection.' }); }
    });

    log('network: /api/v2/network/{search,directory,suggestions,summary} + DELETE connections/:id');
};
