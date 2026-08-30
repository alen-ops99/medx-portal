/**
 * v2/people.js — backend additions for the redesigned admin PEOPLE destination
 * (frontend-v2/js/views/people.js · artboard Admin People.dc.html). Mounted by v2/index.js.
 *
 * Why it exists: the artboard's directory is ONE list for everyone — members, event guests,
 * team, guest-pass holders, contacts — and no single existing route serves that union. This
 * module only READS existing tables (explicit column lists, never password_hash / secrets)
 * plus one write route for the "+ ADD A PERSON" panel.
 *
 * Routes (admin JWT — ctx.auth → ctx.adminOnly):
 *   GET  /api/v2/people/directory   → { people: [...], generated_at }
 *       one row per person (merged by lowercased email; rows with no email stay separate),
 *       each { key, name, email, country, institution, user_id, member:{since,last_login},
 *              team:{role,last_login,sections}, gala:{id,status,payment_status,amount_paid,pricing,created_at},
 *              plexus:{id,status,payment_status,created_at}, bridges:{id,city,event_name,status,registered_at},
 *              forum:{status}, passes:[{id,token,event_key,modules,created_at,last_viewed_at,page_views,revoked}],
 *              contact:{id,type,organization}, tags:[...], segs:[...] }
 *   POST /api/v2/people             → add a person { name, email?, country?, kind }
 *       kind 'member'  → users INSERT (email required, unique) + portal invitation staged in the
 *                        approval outbox (scheduled_emails, status pending_approval — NOTHING sends
 *                        without the one human approve click in Inbox → Outbox)
 *       kind 'gala'    → gala_registrations INSERT (status 'pending' — surfaces as GALA — TO CHASE)
 *       kind 'plexus'  → registrations INSERT against the active conference (status 'confirmed', free entry)
 *       kind 'contact' → contacts INSERT (internal only, no invite)
 *
 * No schema changes. Every write is audited into audit_log (best-effort) and saveDb()'d.
 */
'use strict';
const crypto = require('crypto');

const CAP = 1500;                       // per-table read cap — the seed has dozens, production hundreds
const lc = v => String(v || '').trim().toLowerCase();

module.exports = function mountPeople(app, ctx) {
    const { auth, adminOnly, saveDb, log } = ctx;
    const db = () => ctx.db();
    const get = (sql, params = []) => { const st = db().prepare(sql); if (params.length) st.bind(params); let r = null; if (st.step()) r = st.getAsObject(); st.free(); return r; };
    const all = (sql, params = []) => { const st = db().prepare(sql); if (params.length) st.bind(params); const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out; };
    const run = (sql, params = []) => db().run(sql, params);
    const tryAll = (sql, params = []) => { try { return all(sql, params); } catch (e) { return []; } };
    const audit = (req, action, detail) => {
        try {
            run('INSERT INTO audit_log (id, actor_id, actor_email, action, detail) VALUES (?,?,?,?,?)',
                [crypto.randomUUID(), (req.user && req.user.id) || null, (req.user && req.user.email) || 'admin', action, String(detail || '').slice(0, 400)]);
        } catch (e) { /* audit is best-effort */ }
    };
    const splitName = (name) => {
        const parts = String(name || '').trim().replace(/\s+/g, ' ').split(' ');
        return { first: parts[0] || '', last: parts.slice(1).join(' ') };
    };
    const galaPaid = r => r.payment_status === 'paid' || ['confirmed', 'paid'].includes(lc(r.status));
    const galaDead = r => ['rejected', 'cancelled'].includes(lc(r.status));

    // ---------------------------------------------------------------- directory
    app.get('/api/v2/people/directory', auth, adminOnly, (req, res) => {
        try {
            const byEmail = {};       // lowercased email → person
            const loose = [];         // rows with no usable email
            const person = (email, name, extra) => {
                const key = lc(email);
                let p = key ? byEmail[key] : null;
                if (!p) {
                    p = { name: name || (email || '(no name)'), email: email || '', country: '', institution: '',
                          user_id: null, member: null, team: null, gala: null, plexus: null, bridges: null,
                          forum: null, passes: [], contact: null };
                    if (key) byEmail[key] = p; else loose.push(p);
                }
                if (name && (!p.name || p.name === p.email || p.name === '(no name)')) p.name = name;
                if (extra) { if (extra.country && !p.country) p.country = extra.country; if (extra.institution && !p.institution) p.institution = extra.institution; }
                return p;
            };
            const full = r => `${r.first_name || ''} ${r.last_name || ''}`.trim();

            // 1) portal users — members AND team (never password_hash)
            tryAll(`SELECT id, email, first_name, last_name, country, institution, is_admin,
                           COALESCE(is_staff, 0) AS is_staff, COALESCE(is_founder, 0) AS is_founder,
                           created_at, last_login
                    FROM users ORDER BY created_at DESC LIMIT ${CAP}`)
                .forEach(u => {
                    const p = person(u.email, full(u), u);
                    p.user_id = u.id;
                    if (Number(u.is_admin) === 1 || Number(u.is_staff) === 1) {
                        p.team = { role: Number(u.is_founder) === 1 ? 'founder' : Number(u.is_admin) === 1 ? 'admin' : 'staff', last_login: u.last_login || null };
                    } else {
                        p.member = { since: u.created_at || null, last_login: u.last_login || null };
                    }
                });

            // 2) gala guests
            tryAll(`SELECT id, first_name, last_name, email, institution, status, payment_status, amount_paid, pricing, created_at
                    FROM gala_registrations ORDER BY created_at DESC LIMIT ${CAP}`)
                .forEach(g => {
                    const p = person(g.email, full(g), g);
                    if (!p.gala || (galaPaid(g) && !galaPaid(p.gala))) p.gala = { id: g.id, status: g.status || '', payment_status: g.payment_status || '', amount_paid: g.amount_paid || null, pricing: g.pricing || '', created_at: g.created_at || null };
                });

            // 3) plexus conference registrations (active conference; names/emails fall back to the
            //    linked users row — member self-registrations keep their identity there)
            tryAll(`SELECT r.id, COALESCE(NULLIF(r.first_name, ''), u.first_name) AS first_name,
                           COALESCE(NULLIF(r.last_name, ''), u.last_name) AS last_name,
                           COALESCE(NULLIF(r.email, ''), u.email) AS email,
                           COALESCE(NULLIF(r.country, ''), u.country) AS country,
                           r.status, r.payment_status, r.created_at, r.user_id
                    FROM registrations r JOIN conferences c ON r.conference_id = c.id AND c.is_active = 1
                    LEFT JOIN users u ON r.user_id = u.id
                    ORDER BY r.created_at DESC LIMIT ${CAP}`)
                .forEach(r => {
                    const p = person(r.email, full(r), r);
                    if (!p.user_id && r.user_id) p.user_id = r.user_id;
                    if (!p.plexus) p.plexus = { id: r.id, status: r.status || '', payment_status: r.payment_status || '', created_at: r.created_at || null };
                });

            // 4) bridges registrations (+ their event's city)
            tryAll(`SELECT br.id, br.first_name, br.last_name, br.email, br.status, br.registered_at, be.city, be.name AS event_name
                    FROM bridges_registrations br LEFT JOIN bridges_events be ON br.event_id = be.id
                    ORDER BY br.registered_at DESC LIMIT ${CAP}`)
                .forEach(b => {
                    const p = person(b.email, full(b), b);
                    if (!p.bridges) p.bridges = { id: b.id, city: b.city || '', event_name: b.event_name || '', status: b.status || '', registered_at: b.registered_at || null };
                });

            // 5) forum members (standing network)
            tryAll(`SELECT fm.user_id, fm.membership_status, u.email, u.first_name, u.last_name, u.country
                    FROM forum_members fm LEFT JOIN users u ON fm.user_id = u.id
                    WHERE COALESCE(fm.membership_status, '') <> 'rejected' LIMIT ${CAP}`)
                .forEach(f => {
                    if (!f.email && !f.user_id) return;
                    const p = person(f.email, full(f), f);
                    if (!p.user_id && f.user_id) p.user_id = f.user_id;
                    p.forum = { status: f.membership_status || 'member' };
                });

            // 6) guest passes (VIP links — one person, one event)
            tryAll(`SELECT id, token, guest_name, guest_email, event_key, modules_json, created_at, last_viewed_at,
                           COALESCE(page_views, 0) AS page_views, COALESCE(revoked, 0) AS revoked
                    FROM vip_passes ORDER BY created_at DESC LIMIT ${CAP}`)
                .forEach(v => {
                    const p = person(v.guest_email, v.guest_name, null);
                    let modules = []; try { modules = JSON.parse(v.modules_json || '[]'); } catch (e) {}
                    p.passes.push({ id: v.id, token: v.token, event_key: v.event_key, modules, created_at: v.created_at || null, last_viewed_at: v.last_viewed_at || null, page_views: v.page_views, revoked: Number(v.revoked) });
                });

            // 7) contacts (internal address book)
            tryAll(`SELECT id, first_name, last_name, email, country, organization, contact_type, created_at
                    FROM contacts ORDER BY created_at DESC LIMIT ${CAP}`)
                .forEach(c => {
                    const p = person(c.email, full(c), c);
                    if (!p.institution && c.organization) p.institution = c.organization;
                    if (!p.contact) p.contact = { id: c.id, type: c.contact_type || 'general', organization: c.organization || '' };
                });

            // tags + segments, artboard vocabulary
            const people = Object.values(byEmail).concat(loose).map(p => {
                const tags = [], segs = [];
                if (p.team) { tags.push(p.team.role === 'staff' ? 'TEAM — STAFF' : 'TEAM — ADMIN'); segs.push('TEAM'); }
                if (p.member) { tags.push('MEMBER'); segs.push('MEMBERS'); }
                if (p.gala && !galaDead(p.gala)) { tags.push(galaPaid(p.gala) ? 'GALA PAID' : 'GALA — TO CHASE'); if (lc(p.gala.pricing) === 'vip') tags.push('VIP'); segs.push('GALA'); }
                if (p.plexus && !['rejected', 'cancelled'].includes(lc(p.plexus.status))) { tags.push('PLEXUS'); segs.push('REGISTRANTS'); }
                if (p.bridges) { tags.push((p.bridges.city || 'BRIDGES').toUpperCase()); segs.push('BOSTON'); }
                if (p.forum) { tags.push('FORUM'); segs.push('FORUM'); }
                if (p.passes.length) tags.push('GUEST PASS');
                if (p.contact && !tags.length) tags.push('CONTACT');
                return { ...p, tags, segs };
            }).filter(p => p.tags.length || p.member || p.team);
            people.sort((a, b) => a.name.localeCompare(b.name));

            res.json({ people, generated_at: new Date().toISOString() });
        } catch (e) {
            console.error('[v2/people] directory:', e);
            res.status(500).json({ error: 'Could not load the directory — please try again.' });
        }
    });

    // ---------------------------------------------------------------- add a person
    app.post('/api/v2/people', auth, adminOnly, (req, res) => {
        try {
            const b = req.body || {};
            const name = String(b.name || '').trim().replace(/\s+/g, ' ').slice(0, 160);
            const email = String(b.email || '').trim().slice(0, 200);
            const country = String(b.country || '').trim().slice(0, 80);
            const kind = ['member', 'gala', 'plexus', 'contact'].includes(b.kind) ? b.kind : 'contact';
            if (!name) return res.status(400).json({ error: 'The name is the one thing I need.' });
            if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'That email does not look right.' });
            const { first, last } = splitName(name);
            const id = crypto.randomUUID();
            const now = new Date().toISOString();

            if (kind === 'member') {
                if (!email) return res.status(400).json({ error: 'A member needs an email — the portal invitation goes there.' });
                if (get('SELECT id FROM users WHERE lower(email) = ?', [lc(email)])) return res.status(409).json({ error: 'Someone with that email is already in People.' });
                run('INSERT INTO users (id, email, first_name, last_name, country, is_admin, created_at) VALUES (?,?,?,?,?,0,?)',
                    [id, email, first, last, country || null, now]);
                // Stage the portal invitation in the approval outbox — one human APPROVE in
                // Inbox → Outbox sends it; nothing emails a member without that click.
                let staged = false;
                try {
                    const portal = (process.env.USER_PORTAL_URL || 'https://medx-user-portal.onrender.com').replace(/\/$/, '');
                    const subject = 'Welcome to the Med&X member portal';
                    const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#201b16">
<p>Dear ${first || 'colleague'},</p>
<p>You have been added to the <strong>Med&amp;X member portal</strong> — the place for your Plexus Conference and Gala Evening registrations, tickets and updates.</p>
<p style="text-align:center;margin:22px 0"><a href="${portal}" style="display:inline-block;background:#9b1b22;color:#ffffff;padding:12px 26px;text-decoration:none;font-weight:600">Open the member portal</a></p>
<p>Create your account with this email address and everything we hold for you is already attached.</p>
<p style="color:#6d6459;font-size:13px">If you were not expecting this, simply ignore it.</p></div>`;
                    run(`INSERT INTO scheduled_emails (id, status, batch_id, source_engine, template, payload_json, recipient_email, subject, created_by, created_at)
                         VALUES (?, 'pending_approval', ?, 'people-v2', 'member_portal_invite', ?, ?, ?, ?, datetime('now'))`,
                        [crypto.randomUUID(), crypto.randomUUID(), JSON.stringify({ to: email, subject, html }), email, subject, (req.user && req.user.email) || 'admin']);
                    staged = true;
                } catch (e) { log('people: could not stage the invite — ' + e.message); }
                audit(req, 'people.add', `member: ${name} <${email}>`);
                saveDb();
                return res.json({ success: true, kind, id, invite_staged: staged });
            }

            if (kind === 'gala') {
                run('INSERT INTO gala_registrations (id, first_name, last_name, email, status, created_at) VALUES (?,?,?,?,?,?)',
                    [id, first, last || '', email || '', 'pending', now]);
                audit(req, 'people.add', `gala guest: ${name}${email ? ' <' + email + '>' : ''}`);
                saveDb();
                return res.json({ success: true, kind, id });
            }

            if (kind === 'plexus') {
                const conf = get('SELECT id FROM conferences WHERE is_active = 1 ORDER BY start_date DESC LIMIT 1');
                if (!conf) return res.status(400).json({ error: 'No active conference to register against.' });
                const ticket = get('SELECT id FROM ticket_types WHERE conference_id = ? ORDER BY COALESCE(price_early_bird, 0) LIMIT 1', [conf.id]);
                run(`INSERT INTO registrations (id, conference_id, ticket_type_id, first_name, last_name, email, country, status, payment_status, created_at)
                     VALUES (?,?,?,?,?,?,?, 'confirmed', 'unpaid', ?)`,
                    [id, conf.id, ticket ? ticket.id : null, first, last || '', email || '', country || null, now]);
                audit(req, 'people.add', `plexus registrant: ${name}${email ? ' <' + email + '>' : ''}`);
                saveDb();
                return res.json({ success: true, kind, id });
            }

            // contact — internal only, no invite
            run('INSERT INTO contacts (id, first_name, last_name, email, country, contact_type, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)',
                [id, first, last || '', email || null, country || null, 'general', (req.user && req.user.email) || 'admin', now]);
            audit(req, 'people.add', `contact: ${name}${email ? ' <' + email + '>' : ''}`);
            saveDb();
            return res.json({ success: true, kind, id });
        } catch (e) {
            console.error('[v2/people] add:', e);
            res.status(500).json({ error: 'Could not add the person — please try again.' });
        }
    });

    log('people routes ready (directory + add)');
};
