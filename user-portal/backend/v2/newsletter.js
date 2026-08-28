/**
 * v2/newsletter.js — the member newsletter as a REAL service (member-portal redesign,
 * README implementation note 11 + admin note 24). Mounted by v2/index.js.
 *
 * Store (owned here, never renamed/dropped):
 *   v2_newsletter_subscriptions  id · user_id (NULL for guest addresses) · email (lowercased,
 *                                UNIQUE) · topics (JSON array ⊆ [all, plexus, gala, accelerator,
 *                                bridges, forum]) · confirmed_at · unsubscribed_at ·
 *                                manage_token (32-byte-hex, UNIQUE) · created_at · updated_at
 *   v2_newsletter_sends          one row per admin send — subject · topic · counts · status
 *
 * Routes:
 *   POST /api/v2/newsletter/subscribe        auth — idempotent upsert; own address ⇒ confirmed
 *                                            immediately + branded welcome email; any other
 *                                            address ⇒ double-opt-in confirm email
 *   GET  /api/v2/newsletter/preferences      auth — the member's own subscription state
 *   PUT  /api/v2/newsletter/preferences      auth — { topics } and/or { subscribed:false }
 *   GET  /api/v2/newsletter/manage?t=        public+limited — branded preference center (HTML)
 *   POST /api/v2/newsletter/manage?t=        public+limited — form save (no topic ⇒ unsubscribe)
 *   GET  /api/v2/newsletter/unsubscribe?t=   public+limited — one click, branded confirmation
 *   GET  /api/v2/newsletter/confirm?t=       public+limited — double-opt-in click
 *   GET  /api/v2/newsletter/subscribers      adminOnly — ?topic= → counts per topic + list
 *   POST /api/v2/newsletter/send             adminOnly — subject + (items | html); builds the
 *                                            branded template per subscriber (personal manage/
 *                                            unsubscribe links) and sends via ctx.sendEmail in
 *                                            the background; records v2_newsletter_sends
 *   GET  /api/v2/newsletter/sends            adminOnly — recent send records
 *
 * Coherence with the legacy stores (best-effort, never fatal): pr_subscribers is mirrored
 * (admin PR dashboards keep counting), and email_optouts' 'newsletter' scope is honoured on
 * send + kept in sync on subscribe/unsubscribe (the legacy /unsubscribe one-click keeps
 * working against this service too).
 */
'use strict';

const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const tpl = require('./email-templates');

const TOPICS = ['all', 'plexus', 'gala', 'accelerator', 'bridges', 'forum'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

module.exports = function mountNewsletter(app, ctx) {
    const { db, auth, adminOnly, sendEmail, log } = ctx;

    const q = {
        get(sql, p = []) { const s = db().prepare(sql); if (p.length) s.bind(p); const r = s.step() ? s.getAsObject() : null; s.free(); return r; },
        all(sql, p = []) { const s = db().prepare(sql); if (p.length) s.bind(p); const rows = []; while (s.step()) rows.push(s.getAsObject()); s.free(); return rows; },
        run(sql, p = []) { db().run(sql, p); save(); }
    };
    let _syncT = null;
    function save() {
        if (!process.env.TURSO_DATABASE_URL) return;
        if (_syncT) clearTimeout(_syncT);
        _syncT = setTimeout(() => { try { db().sync(); } catch (e) { /* best-effort */ } }, 2000);
        if (_syncT.unref) _syncT.unref();
    }

    // ---- schema (shared DB — v2_ prefix, idempotent) ----
    try {
        db().run(`CREATE TABLE IF NOT EXISTS v2_newsletter_subscriptions (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            email TEXT NOT NULL UNIQUE,
            topics TEXT NOT NULL DEFAULT '["all"]',
            confirmed_at TEXT,
            unsubscribed_at TEXT,
            manage_token TEXT UNIQUE NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )`);
        db().run(`CREATE TABLE IF NOT EXISTS v2_newsletter_sends (
            id TEXT PRIMARY KEY,
            subject TEXT,
            topic TEXT,
            items_json TEXT,
            recipient_count INTEGER DEFAULT 0,
            sent_count INTEGER DEFAULT 0,
            failed_count INTEGER DEFAULT 0,
            status TEXT DEFAULT 'sending',
            test_to TEXT,
            last_error TEXT,
            sent_by TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            finished_at TEXT
        )`);
        db().run('CREATE INDEX IF NOT EXISTS idx_v2_nl_subs_user ON v2_newsletter_subscriptions (user_id)');
    } catch (e) { console.error('[v2/newsletter] schema:', e.message); }

    // ---- helpers ----
    const now = () => new Date().toISOString();
    const uid = () => crypto.randomUUID();
    const newToken = () => crypto.randomBytes(32).toString('hex');
    const cleanToken = (t) => { const s = String(t || '').trim(); return /^[0-9a-f]{64}$/.test(s) ? s : null; };
    function apiBase(req) {
        return (process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
    }
    function portalBase(req) {
        return (process.env.MEMBER_PORTAL_URL || process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
    }
    const manageUrl = (req, token) => `${apiBase(req)}/api/v2/newsletter/manage?t=${token}`;
    const unsubscribeUrl = (req, token) => `${apiBase(req)}/api/v2/newsletter/unsubscribe?t=${token}`;
    const confirmUrl = (req, token) => `${apiBase(req)}/api/v2/newsletter/confirm?t=${token}`;

    function normTopics(input) {
        if (!Array.isArray(input)) return null;
        const set = [];
        for (const raw of input) {
            const t = String(raw || '').trim().toLowerCase();
            if (!TOPICS.includes(t)) return null;           // topics ⊆ the catalogue — reject junk
            if (!set.includes(t)) set.push(t);
        }
        if (!set.length) return null;
        return set.includes('all') ? ['all'] : set;
    }
    const parseTopics = (row) => { try { const a = JSON.parse(row.topics || '[]'); return Array.isArray(a) && a.length ? a : ['all']; } catch (e) { return ['all']; } };
    const topicMatch = (row, topic) => { if (!topic || topic === 'all') return true; const t = parseTopics(row); return t.includes('all') || t.includes(topic); };
    const isActive = (row) => !!row.confirmed_at && !row.unsubscribed_at;

    function legacyOptedOut(email) {
        try {
            const row = q.get('SELECT scopes FROM email_optouts WHERE email = ?', [email]);
            return !!(row && String(row.scopes || '').split(',').map(s => s.trim()).includes('newsletter'));
        } catch (e) { return false; }
    }
    // Mirrors — never fatal, the v2 table is the source of truth.
    function mirrorSubscribe(email, firstName, lastName, topics) {
        try {
            const projects = topics.includes('all') ? 'all' : topics.join(',');
            q.run(`INSERT INTO pr_subscribers (id, email, first_name, last_name, subscribed_projects, language, status, source)
                   VALUES (?, ?, ?, ?, ?, 'en', 'active', 'member-portal-v2')
                   ON CONFLICT(email) DO UPDATE SET subscribed_projects = excluded.subscribed_projects, status = 'active', unsubscribed_at = NULL`,
                [uid(), email, firstName || '', lastName || '', projects]);
        } catch (e) { /* pr_subscribers is a mirror only */ }
        try {
            const row = q.get('SELECT scopes FROM email_optouts WHERE email = ?', [email]);
            if (row) {
                const scopes = String(row.scopes || '').split(',').map(s => s.trim()).filter(s => s && s !== 'newsletter');
                if (scopes.length) q.run('UPDATE email_optouts SET scopes = ?, updated_at = ? WHERE email = ?', [scopes.join(','), now(), email]);
                else q.run('DELETE FROM email_optouts WHERE email = ?', [email]);
            }
        } catch (e) { /* mirror only */ }
    }
    function mirrorUnsubscribe(email) {
        try { q.run(`UPDATE pr_subscribers SET status = 'unsubscribed', unsubscribed_at = ? WHERE email = ?`, [now(), email]); } catch (e) {}
        try {
            const row = q.get('SELECT scopes FROM email_optouts WHERE email = ?', [email]);
            const scopes = row ? String(row.scopes || '').split(',').map(s => s.trim()).filter(Boolean) : [];
            if (!scopes.includes('newsletter')) scopes.push('newsletter');
            q.run(`INSERT INTO email_optouts (email, scopes, updated_at) VALUES (?, ?, ?)
                   ON CONFLICT(email) DO UPDATE SET scopes = excluded.scopes, updated_at = excluded.updated_at`,
                [email, scopes.join(','), now()]);
        } catch (e) {}
    }

    function subState(req, row) {
        return {
            subscribed: isActive(row),
            pending_confirmation: !row.confirmed_at && !row.unsubscribed_at,
            email: row.email,
            topics: parseTopics(row),
            confirmed_at: row.confirmed_at || null,
            unsubscribed_at: row.unsubscribed_at || null,
            manage_url: manageUrl(req, row.manage_token),
            updated_at: row.updated_at || null
        };
    }
    function accountOf(req) {
        try { return q.get('SELECT id, email, first_name, last_name, email_verified FROM users WHERE id = ?', [req.user.id]); }
        catch (e) { return null; }
    }
    // idempotent upsert keyed on the (lowercased) address
    function upsert({ email, userId, topics, confirm }) {
        const existing = q.get('SELECT * FROM v2_newsletter_subscriptions WHERE email = ?', [email]);
        if (existing) {
            q.run(`UPDATE v2_newsletter_subscriptions
                   SET topics = ?, user_id = COALESCE(?, user_id), unsubscribed_at = NULL,
                       confirmed_at = COALESCE(confirmed_at, ?), updated_at = ?
                   WHERE email = ?`,
                [JSON.stringify(topics), userId || null, confirm ? now() : null, now(), email]);
        } else {
            q.run(`INSERT INTO v2_newsletter_subscriptions (id, user_id, email, topics, confirmed_at, manage_token, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [uid(), userId || null, email, JSON.stringify(topics), confirm ? now() : null, newToken(), now(), now()]);
        }
        return q.get('SELECT * FROM v2_newsletter_subscriptions WHERE email = ?', [email]);
    }

    // ---- rate limits (same shape as the server's limiters) ----
    const publicLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests. Please try again in a little while.' } });
    const subscribeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests. Please try again in a little while.' } });

    // ================================================================ member routes
    app.post('/api/v2/newsletter/subscribe', subscribeLimiter, auth, async (req, res) => {
        try {
            const account = accountOf(req);
            if (!account || !account.email) return res.status(400).json({ error: 'No account email on file' });
            const topics = normTopics((req.body || {}).topics);
            if (!topics) return res.status(400).json({ error: 'Pick at least one topic', topics: TOPICS });
            const requested = String((req.body || {}).email || account.email).trim().toLowerCase();
            if (!EMAIL_RE.test(requested)) return res.status(400).json({ error: 'That email address does not look right' });
            const own = requested === String(account.email).trim().toLowerCase();

            const row = upsert({ email: requested, userId: own ? account.id : null, topics, confirm: own });
            mirrorSubscribe(requested, own ? account.first_name : '', own ? account.last_name : '', topics);

            try {
                const html = own
                    ? tpl.newsletterWelcome({ firstName: account.first_name, topics, manageUrl: manageUrl(req, row.manage_token), unsubscribeUrl: unsubscribeUrl(req, row.manage_token) })
                    : tpl.newsletterConfirm({ firstName: account.first_name, email: requested, confirmUrl: confirmUrl(req, row.manage_token) });
                await sendEmail(requested, own ? 'You are subscribed — the Med&X newsletter' : 'Confirm your Med&X newsletter subscription', html);
            } catch (e) { console.error('[v2/newsletter] subscribe email:', e.message); }

            res.json(Object.assign({ ok: true }, subState(req, row)));
        } catch (e) { console.error('[v2/newsletter] subscribe:', e.message); res.status(500).json({ error: 'Could not save your subscription' }); }
    });

    app.get('/api/v2/newsletter/preferences', auth, (req, res) => {
        try {
            const account = accountOf(req);
            const email = account && account.email ? String(account.email).trim().toLowerCase() : null;
            const row = (email && q.get('SELECT * FROM v2_newsletter_subscriptions WHERE email = ?', [email]))
                || q.get('SELECT * FROM v2_newsletter_subscriptions WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1', [req.user.id]);
            if (!row) return res.json({ subscribed: false, email, topics: [], available_topics: TOPICS });
            res.json(Object.assign({ available_topics: TOPICS }, subState(req, row)));
        } catch (e) { console.error('[v2/newsletter] preferences:', e.message); res.status(500).json({ error: 'Could not load your preferences' }); }
    });

    app.put('/api/v2/newsletter/preferences', subscribeLimiter, auth, (req, res) => {
        try {
            const account = accountOf(req);
            if (!account || !account.email) return res.status(400).json({ error: 'No account email on file' });
            const email = String(account.email).trim().toLowerCase();
            const b = req.body || {};
            const wantsOff = b.subscribed === false || (Array.isArray(b.topics) && b.topics.length === 0);
            if (wantsOff) {
                const row = q.get('SELECT * FROM v2_newsletter_subscriptions WHERE email = ?', [email]);
                if (row) { q.run('UPDATE v2_newsletter_subscriptions SET unsubscribed_at = ?, updated_at = ? WHERE email = ?', [now(), now(), email]); mirrorUnsubscribe(email); }
                const fresh = q.get('SELECT * FROM v2_newsletter_subscriptions WHERE email = ?', [email]);
                return res.json(fresh ? Object.assign({ ok: true }, subState(req, fresh)) : { ok: true, subscribed: false, email, topics: [] });
            }
            const topics = normTopics(b.topics);
            if (!topics) return res.status(400).json({ error: 'Pick at least one topic', topics: TOPICS });
            const row = upsert({ email, userId: account.id, topics, confirm: true });
            mirrorSubscribe(email, account.first_name, account.last_name, topics);
            res.json(Object.assign({ ok: true }, subState(req, row)));
        } catch (e) { console.error('[v2/newsletter] preferences PUT:', e.message); res.status(500).json({ error: 'Could not save your preferences' }); }
    });

    // ================================================================ public preference center
    const invalidPage = () => tpl.brandedPage({
        title: 'Med&X newsletter', eyebrow: 'NEWSLETTER',
        headlineHtml: 'This link has <i>expired</i>.',
        bodyHtml: `<p style="font-size:14px;color:#4a4239;line-height:1.65;margin-top:14px;">Preference links are personal and occasionally rotate. Open the portal and manage your newsletter from Profile &amp; settings instead.</p>
                   <a class="ghost" href="https://medx.hr">BACK TO MED&amp;X →</a>`
    });

    function prefsPage(req, row, saved) {
        const topics = parseTopics(row);
        const off = !!row.unsubscribed_at;
        const boxes = TOPICS.map(t => {
            const checked = !off && (topics.includes(t) || (t !== 'all' && topics.includes('all')));
            const hints = {
                all: 'Everything below, one subscription.', plexus: 'The free December conference in Zagreb.',
                gala: 'The black-tie evening at the Esplanade.', accelerator: 'Placements, deadlines, results.',
                bridges: 'Symposia with the diaspora — next: Boston.', forum: 'The invitation-only biomedical network.'
            };
            return `<label class="topic"><input type="checkbox" name="topic" value="${t}" ${checked ? 'checked' : ''} ${t === 'all' ? 'data-all="1"' : 'data-one="1"'}>
                <span><strong>${tpl.esc(tpl.TOPIC_LABELS[t])}</strong><span class="hint">${hints[t]}</span></span></label>`;
        }).join('');
        const body = `
        <p style="font-size:13px;color:#4a4239;margin:14px 0 4px;">Preferences for <strong style="color:#191512;">${tpl.esc(row.email)}</strong>${off ? ' · currently unsubscribed' : ''}</p>
        <form method="POST" action="/api/v2/newsletter/manage?t=${row.manage_token}">
          ${boxes}
          <p style="font-size:11.5px;color:#4a4239;margin:12px 0 0;">Untick everything and save to stop the newsletter completely. Tickets and registration confirmations always send.</p>
          <button class="mx" type="submit">SAVE MY TOPICS</button>
          ${saved ? `<span style="display:inline-block;margin-left:14px;font-size:12px;color:#6e5626;font-weight:600;">Saved.</span>` : ''}
        </form>
        <script>
          (function(){ var all=document.querySelector('[data-all]'); var ones=[].slice.call(document.querySelectorAll('[data-one]'));
            if(all){ all.addEventListener('change',function(){ if(all.checked) ones.forEach(function(c){c.checked=false;}); });
              ones.forEach(function(c){ c.addEventListener('change',function(){ if(c.checked) all.checked=false; }); }); } })();
        </script>`;
        return tpl.brandedPage({ title: 'Newsletter preferences — Med&X', eyebrow: 'NEWSLETTER · PREFERENCE CENTER', headlineHtml: 'Your <i>topics</i>, your call.', bodyHtml: body });
    }

    app.get('/api/v2/newsletter/manage', publicLimiter, (req, res) => {
        try {
            const token = cleanToken(req.query.t);
            const row = token && q.get('SELECT * FROM v2_newsletter_subscriptions WHERE manage_token = ?', [token]);
            if (!row) return res.status(404).send(invalidPage());
            res.send(prefsPage(req, row, req.query.saved === '1'));
        } catch (e) { console.error('[v2/newsletter] manage GET:', e.message); res.status(500).send(invalidPage()); }
    });

    app.post('/api/v2/newsletter/manage', publicLimiter, express.urlencoded({ extended: false }), (req, res) => {
        try {
            const token = cleanToken(req.query.t);
            const row = token && q.get('SELECT * FROM v2_newsletter_subscriptions WHERE manage_token = ?', [token]);
            if (!row) return res.status(404).send(invalidPage());
            const raw = req.body ? req.body.topic : null;
            const picked = normTopics(Array.isArray(raw) ? raw : raw ? [raw] : []);
            if (!picked) {
                q.run('UPDATE v2_newsletter_subscriptions SET unsubscribed_at = ?, updated_at = ? WHERE manage_token = ?', [now(), now(), token]);
                mirrorUnsubscribe(row.email);
            } else {
                q.run('UPDATE v2_newsletter_subscriptions SET topics = ?, unsubscribed_at = NULL, confirmed_at = COALESCE(confirmed_at, ?), updated_at = ? WHERE manage_token = ?',
                    [JSON.stringify(picked), now(), now(), token]);
                mirrorSubscribe(row.email, '', '', picked);
            }
            res.redirect(`/api/v2/newsletter/manage?t=${token}&saved=1`);
        } catch (e) { console.error('[v2/newsletter] manage POST:', e.message); res.status(500).send(invalidPage()); }
    });

    app.get('/api/v2/newsletter/unsubscribe', publicLimiter, (req, res) => {
        try {
            const token = cleanToken(req.query.t);
            const row = token && q.get('SELECT * FROM v2_newsletter_subscriptions WHERE manage_token = ?', [token]);
            if (!row) return res.status(404).send(invalidPage());
            q.run('UPDATE v2_newsletter_subscriptions SET unsubscribed_at = ?, updated_at = ? WHERE manage_token = ?', [now(), now(), token]);
            mirrorUnsubscribe(row.email);
            res.send(tpl.brandedPage({
                title: 'Unsubscribed — Med&X', eyebrow: 'NEWSLETTER',
                headlineHtml: `You're <i>unsubscribed</i>.`,
                bodyHtml: `<p style="font-size:14px;color:#4a4239;line-height:1.65;margin-top:14px;">No more newsletter for <strong style="color:#191512;">${tpl.esc(row.email)}</strong>. Tickets and registration confirmations still arrive — those follow your bookings, not this list.</p>
                           <p style="font-size:13px;color:#4a4239;line-height:1.6;">Changed your mind, or only wanted fewer topics?</p>
                           <a class="ghost" href="/api/v2/newsletter/manage?t=${row.manage_token}">PICK MY TOPICS INSTEAD →</a>`
            }));
        } catch (e) { console.error('[v2/newsletter] unsubscribe:', e.message); res.status(500).send(invalidPage()); }
    });

    app.get('/api/v2/newsletter/confirm', publicLimiter, (req, res) => {
        try {
            const token = cleanToken(req.query.t);
            const row = token && q.get('SELECT * FROM v2_newsletter_subscriptions WHERE manage_token = ?', [token]);
            if (!row) return res.status(404).send(invalidPage());
            q.run('UPDATE v2_newsletter_subscriptions SET confirmed_at = COALESCE(confirmed_at, ?), unsubscribed_at = NULL, updated_at = ? WHERE manage_token = ?', [now(), now(), token]);
            res.send(tpl.brandedPage({
                title: 'Subscription confirmed — Med&X', eyebrow: 'NEWSLETTER',
                headlineHtml: `You're <i>in</i>.`,
                bodyHtml: `<p style="font-size:14px;color:#4a4239;line-height:1.65;margin-top:14px;">${tpl.esc(row.email)} now receives the Med&amp;X newsletter — topics: <strong style="color:#191512;">${tpl.esc(tpl.topicLabels(parseTopics(row)))}</strong>.</p>
                           <a class="ghost" href="/api/v2/newsletter/manage?t=${row.manage_token}">MANAGE MY TOPICS →</a>`
            }));
        } catch (e) { console.error('[v2/newsletter] confirm:', e.message); res.status(500).send(invalidPage()); }
    });

    // ================================================================ admin
    app.get('/api/v2/newsletter/subscribers', auth, adminOnly, (req, res) => {
        try {
            const topic = String(req.query.topic || '').trim().toLowerCase() || null;
            if (topic && !TOPICS.includes(topic)) return res.status(400).json({ error: 'Unknown topic', topics: TOPICS });
            const rows = q.all('SELECT * FROM v2_newsletter_subscriptions ORDER BY created_at DESC');
            const active = rows.filter(isActive);
            const counts = { total: rows.length, active: active.length, pending: rows.filter(r => !r.confirmed_at && !r.unsubscribed_at).length, unsubscribed: rows.filter(r => !!r.unsubscribed_at).length };
            for (const t of TOPICS) counts[t] = active.filter(r => topicMatch(r, t)).length;
            const list = (topic ? rows.filter(r => topicMatch(r, topic)) : rows).slice(0, 500).map(r => ({
                id: r.id, email: r.email, user_id: r.user_id || null, topics: parseTopics(r),
                active: isActive(r), confirmed_at: r.confirmed_at || null, unsubscribed_at: r.unsubscribed_at || null, created_at: r.created_at
            }));
            res.json({ counts, topic: topic || 'all', subscribers: list });
        } catch (e) { console.error('[v2/newsletter] subscribers:', e.message); res.status(500).json({ error: 'Could not load subscribers' }); }
    });

    app.post('/api/v2/newsletter/send', auth, adminOnly, (req, res) => {
        try {
            const b = req.body || {};
            const topic = String(b.topic || 'all').trim().toLowerCase();
            if (!TOPICS.includes(topic)) return res.status(400).json({ error: 'Unknown topic', topics: TOPICS });
            const items = Array.isArray(b.items) ? b.items.filter(it => it && it.title).map(it => ({
                title: String(it.title), blurb: it.blurb ? String(it.blurb) : '', url: it.url ? String(it.url) : '', tag: it.tag ? String(it.tag) : ''
            })) : [];
            const rawHtml = typeof b.html === 'string' && b.html.trim() ? b.html : null;
            const subject = String(b.subject || '').trim();

            const recipients = q.all('SELECT * FROM v2_newsletter_subscriptions ORDER BY created_at')
                .filter(r => isActive(r) && topicMatch(r, topic) && !legacyOptedOut(r.email));

            if (b.dry_run) return res.json({ ok: true, dry_run: true, topic, recipients: recipients.length });
            if (!subject) return res.status(400).json({ error: 'Subject is required' });
            if (!items.length && !rawHtml) return res.status(400).json({ error: 'Provide items[] or html' });

            const buildFor = (row) => tpl.newsletter({
                monthLabel: b.monthLabel, headline: b.headline,
                items, bodyHtml: rawHtml,
                manageUrl: manageUrl(req, row.manage_token),
                unsubscribeUrl: unsubscribeUrl(req, row.manage_token)
            });

            // test send — one address, nothing recorded as a campaign
            if (b.test_to) {
                const to = String(b.test_to).trim().toLowerCase();
                if (!EMAIL_RE.test(to)) return res.status(400).json({ error: 'test_to is not a valid address' });
                const own = q.get('SELECT * FROM v2_newsletter_subscriptions WHERE email = ?', [to]);
                const html = buildFor(own || { manage_token: 'preview' });
                sendEmail(to, `[TEST] ${subject}`, html)
                    .then(r => log && log(`newsletter test → ${to}: ${r && r.success !== false ? 'ok' : 'failed'}`))
                    .catch(e => console.error('[v2/newsletter] test send:', e.message));
                return res.json({ ok: true, test: true, to, recipients: recipients.length });
            }

            const sendId = uid();
            q.run(`INSERT INTO v2_newsletter_sends (id, subject, topic, items_json, recipient_count, sent_by, status)
                   VALUES (?, ?, ?, ?, ?, ?, 'sending')`,
                [sendId, subject, topic, JSON.stringify(rawHtml ? { html: true } : items), recipients.length, req.user.email || req.user.id]);

            // deliver in the background — an admin send of hundreds must never time the request out
            (async () => {
                let sent = 0, failed = 0, lastError = null;
                for (const row of recipients) {
                    try {
                        const r = await sendEmail(row.email, subject, buildFor(row));
                        if (r && r.success === false && !r.mock) { failed++; lastError = String(r.error || 'send failed').slice(0, 300); }
                        else sent++;
                    } catch (e) { failed++; lastError = String(e.message || e).slice(0, 300); }
                }
                try {
                    q.run(`UPDATE v2_newsletter_sends SET sent_count = ?, failed_count = ?, status = 'sent', last_error = ?, finished_at = ? WHERE id = ?`,
                        [sent, failed, lastError, now(), sendId]);
                } catch (e) { console.error('[v2/newsletter] send record:', e.message); }
                log && log(`newsletter send ${sendId} (${topic}): ${sent} sent, ${failed} failed of ${recipients.length}`);
            })().catch(e => console.error('[v2/newsletter] send loop:', e.message));

            res.json({ ok: true, send_id: sendId, topic, recipients: recipients.length, status: 'sending' });
        } catch (e) { console.error('[v2/newsletter] send:', e.message); res.status(500).json({ error: 'Could not start the send' }); }
    });

    app.get('/api/v2/newsletter/sends', auth, adminOnly, (req, res) => {
        try { res.json({ sends: q.all('SELECT * FROM v2_newsletter_sends ORDER BY created_at DESC LIMIT 50') }); }
        catch (e) { res.status(500).json({ error: 'Could not load sends' }); }
    });

    log && log('newsletter service mounted (topics: ' + TOPICS.join(', ') + ')');
};
