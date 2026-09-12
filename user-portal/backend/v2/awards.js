/**
 * v2/awards.js — PLEXUS GALA AWARDS, public + member side (design/AWARDS-SPEC.md).
 *
 * Four awards, presented at the Gala Evening on 5 December 2026: the Med&X Lifetime Bridge Award
 * (the organizers choose, no public call), Croatian Excellence in Medicine & Science and Rising
 * Talent (public nominations, third-party AND self), and the Plexus Fellowship (a structured
 * student application, two Fellows, each with a funded gala seat and three minutes on the stage).
 *
 * PUBLIC PAGES — server-rendered, EN + HR, and they work with NO LOGIN AT ALL. They are reached
 * through cfg.serverPaths ('/awards') and the Netlify proxy rows for /awards + /awards/*, exactly
 * the way /boston and /meetups/manage are reached: the SPA never intercepts them, so somebody who
 * has never had a Med&X account can open a link from medx.hr and nominate.
 *   GET  /awards[?lang=hr]                     the four awards + the open/closed banner
 *   GET  /awards/:key[?lang=hr]                criteria, deadline, and the form
 *   GET  /awards/manage/:token                 "where does my nomination stand" + withdraw
 *   POST /awards/manage/:token                 the withdraw itself (plain form post, no JS needed)
 *   GET  /awards/review/:token                 the reviewer's reading room (no login)
 *   GET  /awards/slides/:token                 a laureate's slides + "yes, I will present" page
 *
 * PUBLIC API (the token IS the credential — HMAC(JWT_SECRET), 32 hex, timingSafeEqual)
 *   GET  /api/v2/awards/overview               categories + windows (drives the pages and tests)
 *   POST /api/v2/awards/entries                nomination · self-nomination · application
 *   POST /api/v2/awards/entries/:token/attachment   the optional one-page PDF (≤5 MB, magic-checked)
 *   GET  /api/v2/awards/entries/:token         status JSON behind the manage page
 *   POST /api/v2/awards/entries/:token/withdraw
 *   GET  /api/v2/awards/review/:token/data     THE reviewer's own queue — scoped, nothing else
 *   POST /api/v2/awards/review/:token/score    one score per entry, editable
 *   GET  /api/v2/awards/review/:token/attachment/:entryId   302 → a 15-minute presigned S3 GET
 *   POST /api/v2/awards/slides/:token/confirm  a laureate confirms the three minutes
 *   POST /api/v2/awards/slides/:token/upload   a laureate's slides (PDF ≤5 MB)
 *   GET  /api/v2/awards/me                     auth — prefill for a signed-in member
 *
 * SCOPING IS ABSOLUTE (spec §Non-negotiables): a reviewer token resolves exactly that reviewer's
 * categories. Reviewer A asking for an entry in reviewer B's category gets a 404, never a 403 —
 * a 403 would confirm the entry exists. Reviewers never see each other's scores, and the
 * nominator is anonymised in the room.
 *
 * REVIEW GATE IS MANDATORY (standing rule): every public submission runs review-gate.js —
 * honeypot, suspicionScore, and the safe-country list — before anything is acknowledged. A held
 * entry is written as 'pending-review', Alen gets the approve/reject email, and the submitter
 * gets the soft acknowledgment that tips nobody off.
 *
 * The domain — schema, the seeded categories, the window, word limits, uniqueness, the ranking
 * maths — lives in shared/awards-core.js, the SAME module the admin backend calls.
 */
'use strict';

const crypto = require('crypto');

const core = require('../../../shared/awards-core');
const editions = require('../../../shared/editions');
const mail = require('../../../shared/award-emails');
const tpl = require('./email-templates');
const reviewGate = require('../review-gate');
const boston = require('../boston');           // the SigV4 S3 helper + the magic-byte sniffing

function tryRequire(name) { try { return require(name); } catch (e) { return null; } }
const multerLib = tryRequire('multer');

const { esc, clean, validEmail, nowIso, fullName, wordCount } = core;
const S3_PREFIX = 'awards';
const MAX_PDF = core.MAX_ATTACHMENT_BYTES;

module.exports = function mountAwards(app, ctx) {
    const { db, auth, sendEmail } = ctx;
    const JWT_SECRET = ctx.JWT_SECRET || process.env.JWT_SECRET || 'medx-dev-secret';
    const log = ctx.log || ((...a) => console.log('[v2/awards]', ...a));

    // ---------------------------------------------------------------- query bag
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
    let syncTimer = null;
    function persist() {
        try {
            if (!process.env.TURSO_DATABASE_URL) return;
            clearTimeout(syncTimer);
            syncTimer = setTimeout(() => { try { db().sync(); } catch (e) {} }, 2000);
            if (syncTimer.unref) syncTimer.unref();
        } catch (e) {}
    }

    // ---------------------------------------------------------------- schema + seed
    // The v2 modules mount in alphabetical order, so 'awards' loads BEFORE 'editions' — and on a
    // fresh database plexus_editions is still empty at that moment. Two guards, both idempotent:
    // this boot call seeds the edition itself if it has to, and seedCategoriesFor() below re-checks
    // on the first request that needs a category. Neither can create anything twice.
    let schemaReady = false, seededFor = null;
    function seedCategoriesFor(ed) {
        if (!ed || seededFor === ed.id) return;
        core.seedCategories(q, ed.id);
        if (core.listCategories(q, ed.id).length) seededFor = ed.id;
    }
    function ensureSchema() {
        try {
            editions.ensureSchema(q);
            editions.seed(q);
            schemaReady = core.ensureSchema(q);
            if (schemaReady) seedCategoriesFor(editions.activeEdition(q));
        } catch (e) { schemaReady = false; }
        return schemaReady && !!seededFor;
    }
    if (!ensureSchema()) {                                // in some boots the DB opens after mount
        let tries = 0;
        const retry = setInterval(() => { if (ensureSchema() || ++tries >= 10) clearInterval(retry); }, 4000);
        if (retry.unref) retry.unref();
    }

    // ---------------------------------------------------------------- tokens
    // HMAC(JWT_SECRET) over 'medxaward:<kind>:<id>', first 32 hex. Stored on the row (UNIQUE), so
    // the lookup is one indexed read; the recomputed HMAC is then compared with timingSafeEqual,
    // so a forged token can never shortcut the check.
    function sign(kind, id) {
        return crypto.createHmac('sha256', JWT_SECRET).update(`medxaward:${kind}:${id}`).digest('hex').slice(0, 32);
    }
    function tokenMatches(kind, id, given) {
        const expected = Buffer.from(sign(kind, id), 'utf8');
        const got = Buffer.from(String(given == null ? '' : given), 'utf8');
        if (expected.length !== got.length) return false;
        try { return crypto.timingSafeEqual(expected, got); } catch (e) { return false; }
    }
    const isToken = (t) => /^[0-9a-f]{32}$/.test(String(t || ''));
    const cx = { q, sign };

    function byManageToken(token) {
        if (!isToken(token)) return null;
        const e = q.get('SELECT * FROM award_entries WHERE manage_token = ?', [String(token)]);
        if (!e || !tokenMatches('manage', e.id, token)) return null;
        const cat = core.categoryById(q, e.category_id);
        return cat ? { entry: e, category: cat } : null;
    }
    function byReviewerToken(token) {
        if (!isToken(token)) return null;
        const r = q.get('SELECT * FROM award_reviewers WHERE token = ?', [String(token)]);
        if (!r || !tokenMatches('reviewer', r.id, token)) return null;
        if (String(r.status) === 'revoked') return null;
        return r;
    }
    function bySlidesToken(token) {
        if (!isToken(token)) return null;
        const l = q.get('SELECT * FROM award_laureates WHERE slides_token = ?', [String(token)]);
        if (!l || !tokenMatches('slides', l.id, token)) return null;
        const cat = core.categoryById(q, l.category_id);
        return cat ? { laureate: l, category: cat } : null;
    }

    // ---------------------------------------------------------------- bases
    const absBase = () => String(process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, '');
    const memberBase = () => String(process.env.MEMBER_PORTAL_URL || absBase()).replace(/\/+$/, '');
    const manageUrl = (tok) => `${absBase()}/awards/manage/${tok}`;
    const reviewUrl = (tok) => `${absBase()}/awards/review/${tok}`;
    const slidesUrl = (tok) => `${absBase()}/awards/slides/${tok}`;
    const awardsUrl = (lang) => `${absBase()}/awards${lang === 'hr' ? '?lang=hr' : ''}`;

    const activeEd = () => { const ed = editions.activeEdition(q); if (ed && seededFor !== ed.id) seedCategoriesFor(ed); return ed; };
    const cats = () => { const ed = activeEd(); return ed ? core.listCategories(q, ed.id) : []; };
    const catByKey = (key) => { const ed = activeEd(); return ed ? core.categoryByKey(q, ed.id, key) : null; };

    // ---------------------------------------------------------------- copy (EN + HR)
    const L = (lang) => (String(lang) === 'hr' ? 'hr' : 'en');
    const langOf = (req) => L(req && req.query && req.query.lang);
    // A Croatian date already ENDS in a period ("5. prosinca 2026."), so a sentence closing on one
    // printed "…2026..". Close every such sentence through this instead of typing the full stop.
    const stop = (s) => String(s == null ? '' : s).replace(/\.\s*$/, '') + '.';
    // The Fellowship's intake is 'application', not 'nomination' — the four public copy lines that
    // name the act take the intake so the student award never says "Nominations open".
    const C = {
        en: {
            eyebrow: 'PLEXUS WEEK · THE AWARDS',
            title: 'The Plexus Awards.',
            lede: 'Four awards, presented at the Gala Evening on Saturday 5 December 2026 at the Esplanade in Zagreb. Two of them are open to anyone who wants to put a name forward — including their own. One is a student fellowship. One is chosen quietly, by us.',
            opensBanner: (d, app) => stop(`${app ? 'Applications' : 'Nominations'} open ${d}`),
            openBanner: (d, app) => stop(`${app ? 'Applications' : 'Nominations'} are open until ${d}`),
            closedBanner: (app) => `Thank you — ${app ? 'applications' : 'nominations'} are closed. Decisions come in November.`,
            noneBanner: 'Chosen by the organizers — there is no public call for this one.',
            read: 'READ THE CRITERIA →',
            nominate: 'NOMINATE SOMEONE', nominateSelf: 'NOMINATE YOURSELF', apply: 'APPLY',
            deadline: 'DEADLINE', presented: 'PRESENTED', laureates: 'LAUREATES',
            back: '← All four awards',
            formTitle: { nomination: 'Nominate someone', self: 'Nominate yourself', application: 'Your application' },
            nominee: 'THE PERSON YOU ARE NOMINATING', you: 'ABOUT YOU', yourself: 'ABOUT YOU',
            statement: 'WHY THIS PERSON', statementSelf: 'WHY YOU',
            fields: {
                nominee_name: 'Full name', nominee_email: 'Email (optional, but it helps us reach them)',
                nominee_institution: 'Institution', nominee_position: 'Position or title',
                nominee_country: 'Country', nominee_birth_year: 'Year of birth (optional)',
                nominee_links: 'Links — a profile, a paper, a company (one per line, optional)',
                nominator_name: 'Your full name', nominator_email: 'Your email',
                nominator_relation: 'How do you know them?',
                my_name: 'Your full name', my_email: 'Your email',
                school: 'School or university', study_year: 'Year of study', city: 'City',
                challenge: 'The challenge', solution: 'Your solution', why_you: 'Why you',
                attachment: 'One optional page (PDF, up to 5 MB)',
                present: 'I am willing to give a 3-minute presentation at the Gala Evening',
                consent: 'If selected, Med&X may name the laureate publicly — at the Gala Evening, on medx.hr and in the press.',
                words: (n) => `${n} words maximum`, wordsLeft: 'words'
            },
            submit: 'SEND IT', sending: 'SENDING…',
            thanksTitle: 'Thank you — we have it.',
            thanks: 'A confirmation is on its way to your inbox, with a link you can use to check where it stands or withdraw it.',
            closedTitle: (app) => `${app ? 'Applications' : 'Nominations'} are closed.`,
            closedBody: (app) => `Thank you to everyone who ${app ? 'applied' : 'wrote in'}. Decisions are made in November, and the awards are presented at the Gala Evening on 5 December.`,
            beforeTitle: 'Not open yet.',
            beforeBody: (d, app) => `${stop(`${app ? 'Applications' : 'Nominations'} open ${d}`)} Come back then — or write to us in the meantime and we will remind you.`,
            refuseNone: 'This award has no public call — the organizers choose its laureates.',
            lang: 'HRVATSKI'
        },
        hr: {
            eyebrow: 'PLEXUS TJEDAN · NAGRADE',
            title: 'Plexus nagrade.',
            lede: 'Četiri nagrade, uručuju se na Gala večeri u subotu 5. prosinca 2026. u Esplanadi u Zagrebu. Dvije su otvorene svima koji žele predložiti ime — uključujući i vlastito. Jedna je studentska stipendija. Jednu biramo mi, u tišini.',
            opensBanner: (d, app) => stop(`${app ? 'Prijave' : 'Nominacije'} se otvaraju ${d}`),
            openBanner: (d, app) => stop(`${app ? 'Prijave' : 'Nominacije'} su otvorene do ${d}`),
            closedBanner: (app) => `Hvala — ${app ? 'prijave' : 'nominacije'} su zatvorene. Odluke stižu u studenome.`,
            noneBanner: 'Biraju organizatori — za ovu nagradu nema javnog poziva.',
            read: 'PROČITAJ KRITERIJE →',
            nominate: 'NOMINIRAJ NEKOGA', nominateSelf: 'NOMINIRAJ SEBE', apply: 'PRIJAVI SE',
            deadline: 'ROK', presented: 'DODJELA', laureates: 'LAUREATI',
            back: '← Sve četiri nagrade',
            formTitle: { nomination: 'Nominirajte nekoga', self: 'Nominirajte sebe', application: 'Vaša prijava' },
            nominee: 'OSOBA KOJU NOMINIRATE', you: 'O VAMA', yourself: 'O VAMA',
            statement: 'ZAŠTO BAŠ TA OSOBA', statementSelf: 'ZAŠTO VI',
            fields: {
                nominee_name: 'Ime i prezime', nominee_email: 'E-mail (nije obavezno, ali nam pomaže)',
                nominee_institution: 'Ustanova', nominee_position: 'Pozicija ili titula',
                nominee_country: 'Država', nominee_birth_year: 'Godina rođenja (nije obavezno)',
                nominee_links: 'Poveznice — profil, rad, tvrtka (jedna po retku, nije obavezno)',
                nominator_name: 'Vaše ime i prezime', nominator_email: 'Vaš e-mail',
                nominator_relation: 'Odakle poznajete tu osobu?',
                my_name: 'Vaše ime i prezime', my_email: 'Vaš e-mail',
                school: 'Škola ili fakultet', study_year: 'Godina studija', city: 'Grad',
                challenge: 'Izazov', solution: 'Vaše rješenje', why_you: 'Zašto vi',
                attachment: 'Jedna neobavezna stranica (PDF, do 5 MB)',
                present: 'Spreman/na sam održati trominutnu prezentaciju na Gala večeri',
                consent: 'Ako budem odabran/a, Med&X smije javno objaviti ime laureata — na Gala večeri, na medx.hr i u medijima.',
                words: (n) => `najviše ${n} riječi`, wordsLeft: 'riječi'
            },
            submit: 'POŠALJI', sending: 'ŠALJEM…',
            thanksTitle: 'Hvala — zaprimljeno je.',
            thanks: 'Potvrda je na putu u vaš inbox, s poveznicom na kojoj možete vidjeti status ili povući prijavu.',
            closedTitle: (app) => `${app ? 'Prijave' : 'Nominacije'} su zatvorene.`,
            closedBody: (app) => `Hvala svima koji su se ${app ? 'prijavili' : 'javili'}. Odluke se donose u studenome, a nagrade se uručuju na Gala večeri 5. prosinca.`,
            beforeTitle: 'Još nije otvoreno.',
            beforeBody: (d, app) => `${stop(`${app ? 'Prijave' : 'Nominacije'} se otvaraju ${d}`)} Vratite se tada — ili nam se javite pa ćemo vas podsjetiti.`,
            refuseNone: 'Za ovu nagradu nema javnog poziva — laureate biraju organizatori.',
            lang: 'ENGLISH'
        }
    };

    const MONTHS = {
        en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
        hr: ['siječnja', 'veljače', 'ožujka', 'travnja', 'svibnja', 'lipnja', 'srpnja', 'kolovoza', 'rujna', 'listopada', 'studenoga', 'prosinca']
    };
    function dateLabel(iso, lang) {
        const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!m) return '';
        const d = Number(m[3]), mon = MONTHS[L(lang)][Number(m[2]) - 1], y = m[1];
        return L(lang) === 'hr' ? `${d}. ${mon} ${y}.` : `${d} ${mon} ${y}`;
    }
    const catName = (cat, lang) => (L(lang) === 'hr' && cat.name_hr) ? cat.name_hr : cat.name;
    const catCitation = (cat, lang) => (L(lang) === 'hr' && cat.citation_hr) ? cat.citation_hr : (cat.citation || '');
    const catCriteria = (cat, lang) => (L(lang) === 'hr' && cat.criteria_md_hr) ? cat.criteria_md_hr : (cat.criteria_md || '');

    /** A deliberately tiny markdown: paragraphs, **bold**, and · bullets. No HTML passes through. */
    function md(src) {
        return String(src || '').split(/\n{2,}/).map(block => {
            const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
            if (lines.length && lines.every(l => l.startsWith('·'))) {
                return `<ul style="margin:0 0 14px;padding-left:18px;line-height:1.75;">${lines.map(l =>
                    `<li style="margin-bottom:5px;">${inline(l.replace(/^·\s*/, ''))}</li>`).join('')}</ul>`;
            }
            return `<p style="margin:0 0 14px;line-height:1.75;">${inline(lines.join(' '))}</p>`;
        }).join('');
    }
    const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

    // ---------------------------------------------------------------- page shell
    const page = (o) => tpl.brandedPage({ title: o.title, eyebrow: o.eyebrow, headlineHtml: o.headline, bodyHtml: o.bodyHtml });
    function notFoundPage(res, lang) {
        const hr = L(lang) === 'hr';
        res.status(404).send(page({
            title: hr ? 'Poveznica nije dostupna — Med&X' : 'This link is not available — Med&X',
            eyebrow: hr ? 'Plexus tjedan' : 'Plexus Week',
            headline: hr ? 'Ova poveznica nije dostupna.' : 'This link is not available.',
            bodyHtml: `<p style="font-size:14px;line-height:1.7;color:#4a4239;margin-top:14px;">${hr
                ? 'Poveznica je možda istekla ili je ono na što je vodila nestalo. Ako mislite da je ovo greška, javite se Lauri Rodman na laura.rodman@medx.hr.'
                : 'The link may have expired, or the thing it pointed at is gone. If you believe this is a mistake, write to Laura Rodman at laura.rodman@medx.hr and she will sort it out.'}</p>`
        }));
    }

    const FORM_CSS = `<style>
      .awf label{display:block;font-weight:600;font-size:9.5px;letter-spacing:.15em;text-transform:uppercase;color:#6e5626;margin:16px 0 6px;}
      .awf input[type=text],.awf input[type=email],.awf input[type=number],.awf textarea,.awf select{
        width:100%;box-sizing:border-box;padding:11px 12px;border:1px solid rgba(25,21,18,.25);background:#fff;
        font-family:inherit;font-size:14px;color:#191512;}
      .awf textarea{min-height:120px;line-height:1.6;resize:vertical;}
      .awf input:focus,.awf textarea:focus{outline:none;border-color:#9b1b22;}
      .awf .sec{margin-top:26px;padding-top:18px;border-top:1px solid rgba(25,21,18,.12);}
      .awf .sech{font-weight:600;font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:#191512;}
      .awf .hint{font-size:12px;color:#6d6459;line-height:1.6;margin-top:5px;}
      .awf .count{float:right;font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;color:#6d6459;}
      .awf .count.over{color:#9b1b22;font-weight:600;}
      .awf .check{display:flex;gap:10px;align-items:flex-start;margin-top:14px;font-size:13.5px;line-height:1.6;color:#4a4239;}
      .awf .check input{margin-top:3px;width:16px;height:16px;accent-color:#9b1b22;flex:none;}
      .awf .hp{position:absolute;left:-9999px;width:1px;height:1px;opacity:0;}
      .awf .err{display:none;margin-top:14px;padding:11px 14px;background:rgba(155,27,34,.07);border-left:3px solid #9b1b22;color:#7c2320;font-size:13px;line-height:1.6;}
      .awf .ok{display:none;margin-top:16px;padding:16px 18px;background:rgba(30,110,66,.07);border-left:3px solid #1e6e42;color:#1e6e42;font-size:14px;line-height:1.7;}
      .awf .tabs{display:flex;gap:0;margin-top:20px;border-bottom:1px solid rgba(25,21,18,.15);}
      .awf .tabs a{padding:9px 14px;font-weight:600;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#6d6459;border-bottom:2px solid transparent;text-decoration:none;}
      .awf .tabs a.on{color:#191512;border-bottom-color:#9b1b22;}
      .awcard{display:block;padding:18px 0;border-bottom:1px solid rgba(25,21,18,.12);color:#191512;text-decoration:none;}
      .awcard:hover{background:#fdfaf3;}
      .awbanner{margin-top:16px;padding:11px 16px;border-left:3px solid #c9a962;background:#fdfaf3;font-size:13px;color:#4a4239;}
    </style>`;

    // ================================================================ PUBLIC PAGE · /awards
    app.get('/awards', (req, res) => {
        try {
            const lang = langOf(req);
            const c = C[lang];
            const list = cats();
            const other = lang === 'hr' ? 'en' : 'hr';
            const cards = list.map(cat => {
                const w = core.windowState(cat);
                const app = String(cat.intake) === 'application';
                const banner = w === 'none' ? c.noneBanner
                    : w === 'before' ? c.opensBanner(dateLabel(cat.opens_at, lang), app)
                        : w === 'open' ? c.openBanner(dateLabel(cat.closes_at, lang), app)
                            : c.closedBanner(app);
                return `
        <a class="awcard" href="/awards/${esc(cat.key)}${lang === 'hr' ? '?lang=hr' : ''}">
          <div style="font-family:Fraunces,Georgia,serif;font-size:21px;line-height:1.25;">${esc(catName(cat, lang))}</div>
          ${catCitation(cat, lang) ? `<div style="font-size:13px;color:#4a4239;font-style:italic;margin-top:5px;line-height:1.6;">${esc(catCitation(cat, lang))}</div>` : ''}
          <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:baseline;margin-top:9px;">
            <span style="font-weight:600;font-size:9px;letter-spacing:.14em;color:#6e5626;">${esc(banner)}</span>
            <span style="font-weight:600;font-size:9px;letter-spacing:.14em;color:#9b1b22;">${c.read}</span>
          </div>
        </a>`;
            }).join('');
            res.send(page({
                title: (lang === 'hr' ? 'Plexus nagrade' : 'The Plexus Awards') + ' — Med&X',
                eyebrow: c.eyebrow,
                headline: esc(c.title),
                bodyHtml: `${FORM_CSS}
        <p style="font-size:14.5px;line-height:1.75;color:#4a4239;margin-top:14px;">${esc(c.lede)}</p>
        <div style="margin-top:22px;">${cards || `<p style="font-size:13px;color:#6d6459;font-style:italic;">${lang === 'hr' ? 'Nagrade se upravo pripremaju.' : 'The awards are being set up.'}</p>`}</div>
        <p style="margin-top:24px;"><a class="ghost" href="/awards?lang=${other}">${c.lang}</a></p>`
            }));
        } catch (e) { log('awards page:', e.message); notFoundPage(res, langOf(req)); }
    });

    // ================================================================ PUBLIC PAGE · /awards/:key
    app.get('/awards/:key', (req, res) => {
        const lang = langOf(req);
        try {
            const key = String(req.params.key || '');
            // 'manage' / 'review' / 'slides' are their own routes; anything else must be a category.
            const cat = catByKey(key);
            if (!cat) return notFoundPage(res, lang);
            const c = C[lang];
            const w = core.windowState(cat);
            const other = lang === 'hr' ? 'en' : 'hr';
            const facts = [
                cat.closes_at ? [c.deadline, dateLabel(cat.closes_at, lang)] : null,
                [c.presented, dateLabel('2026-12-05', lang) + ' · Hotel Esplanade, Zagreb'],
                [c.laureates, String(Number(cat.laureates_max) || 2)]
            ].filter(Boolean).map(([k, v]) => `
        <div style="display:flex;gap:10px;padding:9px 0;border-bottom:1px solid rgba(25,21,18,.1);font-size:13px;">
          <span style="min-width:110px;font-weight:600;font-size:9px;letter-spacing:.14em;color:#6e5626;text-transform:uppercase;padding-top:3px;">${esc(k)}</span>
          <span style="color:#191512;">${esc(v)}</span>
        </div>`).join('');
            res.send(page({
                title: catName(cat, lang) + ' — Med&X',
                eyebrow: c.eyebrow,
                headline: esc(catName(cat, lang)),
                bodyHtml: `${FORM_CSS}
        ${catCitation(cat, lang) ? `<p style="font-size:14px;font-style:italic;color:#4a4239;margin-top:10px;line-height:1.7;">${esc(catCitation(cat, lang))}</p>` : ''}
        <div style="margin-top:18px;">${facts}</div>
        <div style="margin-top:20px;font-size:14px;color:#4a4239;">${md(catCriteria(cat, lang))}</div>
        ${formSection(cat, w, lang)}
        <p style="margin-top:26px;display:flex;gap:14px;flex-wrap:wrap;">
          <a class="ghost" href="/awards${lang === 'hr' ? '?lang=hr' : ''}">${c.back}</a>
          <a class="ghost" href="/awards/${esc(cat.key)}?lang=${other}">${c.lang}</a>
        </p>`
            }));
        } catch (e) { log('award page:', e.message); notFoundPage(res, lang); }
    });

    // ---------------------------------------------------------------- the form
    function counterField(role, label, limit, lang) {
        const c = C[L(lang)];
        return `<label for="${role}">${esc(label)} <span class="count" data-count-for="${role}" data-limit="${limit}">0 / ${limit} ${esc(c.fields.wordsLeft)}</span></label>
                <textarea id="${role}" data-role="${role}" data-limit="${limit}" placeholder=""></textarea>`;
    }
    function textField(role, label, type, extra) {
        return `<label for="${role}">${esc(label)}</label><input id="${role}" data-role="${role}" type="${type || 'text'}"${extra || ''}>`;
    }

    function formSection(cat, w, lang) {
        const c = C[L(lang)];
        const isApp = String(cat.intake) === 'application';
        if (w === 'none') {
            return `<div class="awbanner">${esc(c.noneBanner)}</div>`;
        }
        if (w === 'before') {
            return `<div class="sec"><div class="sech">${esc(c.beforeTitle)}</div>
              <p class="hint" style="margin-top:8px;font-size:13.5px;">${esc(c.beforeBody(dateLabel(cat.opens_at, lang), isApp))}</p></div>`;
        }
        if (w === 'closed') {
            return `<div class="sec"><div class="sech">${esc(c.closedTitle(isApp))}</div>
              <p class="hint" style="margin-top:8px;font-size:13.5px;">${esc(c.closedBody(isApp))}</p></div>`;
        }
        const allowSelf = Number(cat.allow_self) === 1;
        const F = c.fields;
        const body = isApp ? `
      <div class="sec">
        <div class="sech">${esc(c.yourself)}</div>
        ${textField('nominee_name', F.my_name)}
        ${textField('nominee_email', F.my_email, 'email')}
        ${textField('school', F.school)}
        ${textField('study_year', F.study_year)}
        ${textField('nominee_institution', F.city)}
        ${textField('nominee_country', F.nominee_country, 'text', ' value="Croatia"')}
      </div>
      <div class="sec">
        <div class="sech">${esc(L(lang) === 'hr' ? 'VAŠ PRIJEDLOG' : 'YOUR PROPOSAL')}</div>
        ${counterField('challenge', F.challenge + ' — ' + F.words(core.WORD_LIMITS.challenge), core.WORD_LIMITS.challenge, lang)}
        ${counterField('solution', F.solution + ' — ' + F.words(core.WORD_LIMITS.solution), core.WORD_LIMITS.solution, lang)}
        ${counterField('why_you', F.why_you + ' — ' + F.words(core.WORD_LIMITS.why_you), core.WORD_LIMITS.why_you, lang)}
        <label for="aw_lang">${esc(L(lang) === 'hr' ? 'Jezik prijave' : 'Language of your entry')}</label>
        <select id="aw_lang" data-role="language"><option value="en">English</option><option value="hr"${L(lang) === 'hr' ? ' selected' : ''}>Hrvatski</option></select>
        <label for="aw_pdf">${esc(F.attachment)}</label>
        <input id="aw_pdf" type="file" accept="application/pdf,.pdf" style="font-size:13px;">
        <div class="check"><input type="checkbox" id="aw_present" data-role="willing_to_present" checked><label for="aw_present" style="margin:0;font-weight:400;font-size:13.5px;letter-spacing:0;text-transform:none;color:#4a4239;">${esc(F.present)}</label></div>
      </div>` : `
      ${allowSelf ? `<div class="tabs" data-role="tabs">
        <a href="#" data-mode="nomination" class="on">${esc(c.nominate)}</a>
        <a href="#" data-mode="self">${esc(c.nominateSelf)}</a>
      </div>` : ''}
      <div class="sec">
        <div class="sech" data-role="nomineeHead">${esc(c.nominee)}</div>
        ${textField('nominee_name', F.nominee_name)}
        ${textField('nominee_email', F.nominee_email, 'email')}
        ${textField('nominee_institution', F.nominee_institution)}
        ${textField('nominee_position', F.nominee_position)}
        ${textField('nominee_country', F.nominee_country)}
        ${textField('nominee_birth_year', F.nominee_birth_year, 'text')}
        <label for="nominee_links">${esc(F.nominee_links)}</label>
        <textarea id="nominee_links" data-role="nominee_links" style="min-height:70px;"></textarea>
      </div>
      <div class="sec" data-role="nominatorBlock">
        <div class="sech">${esc(c.you)}</div>
        ${textField('nominator_name', F.nominator_name)}
        ${textField('nominator_email', F.nominator_email, 'email')}
        ${textField('nominator_relation', F.nominator_relation)}
      </div>
      <div class="sec">
        <div class="sech" data-role="statementHead">${esc(c.statement)}</div>
        ${counterField('statement', F.words(core.WORD_LIMITS.statement), core.WORD_LIMITS.statement, lang)}
      </div>`;
        return `
      <form class="awf" data-role="awForm" novalidate style="margin-top:26px;position:relative;" autocomplete="on">
        <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true" data-role="website">
        <div class="sech" style="font-size:11px;letter-spacing:.18em;">${esc(isApp ? c.formTitle.application : c.formTitle.nomination)}</div>
        ${body}
        <div class="sec">
          <div class="check"><input type="checkbox" id="aw_consent" data-role="consent_publish"><label for="aw_consent" style="margin:0;font-weight:400;font-size:13.5px;letter-spacing:0;text-transform:none;color:#4a4239;">${esc(F.consent)}</label></div>
        </div>
        <button class="mx" type="submit" data-role="submit">${esc(c.submit)}</button>
        <div class="err" data-role="err"></div>
        <div class="ok" data-role="ok"><b>${esc(c.thanksTitle)}</b><br>${esc(c.thanks)}</div>
      </form>
      ${formScript(cat, lang, isApp, allowSelf)}`;
    }

    // The form's own script: live word counters, the third-party/self toggle, the submit, and the
    // optional PDF that follows the entry. Vanilla and self-contained — this page has no bundle.
    function formScript(cat, lang, isApp, allowSelf) {
        const c = C[L(lang)];
        return `<script>
(function(){
  var form = document.querySelector('[data-role="awForm"]');
  if (!form) return;
  var KEY = ${JSON.stringify(String(cat.key))}, LANG = ${JSON.stringify(L(lang))};
  var IS_APP = ${isApp ? 'true' : 'false'}, ALLOW_SELF = ${allowSelf ? 'true' : 'false'};
  var mode = IS_APP ? 'application' : 'nomination';
  var v = function (r) { var el = form.querySelector('[data-role="' + r + '"]'); return el ? (el.type === 'checkbox' ? el.checked : el.value) : ''; };
  var words = function (s) { return String(s || '').trim().split(/\\s+/).filter(Boolean).length; };

  // live counters — the server enforces the same limits in words, this is the courtesy copy
  form.querySelectorAll('textarea[data-limit]').forEach(function (ta) {
    var lim = Number(ta.getAttribute('data-limit')) || 0;
    var out = form.querySelector('[data-count-for="' + ta.getAttribute('data-role') + '"]');
    var tick = function () {
      var n = words(ta.value);
      if (out) { out.textContent = n + ' / ' + lim + ' ${esc(c.fields.wordsLeft)}'; out.className = 'count' + (n > lim ? ' over' : ''); }
    };
    ta.addEventListener('input', tick); tick();
  });

  if (ALLOW_SELF) {
    var tabs = form.querySelectorAll('[data-role="tabs"] a');
    var nomBlock = form.querySelector('[data-role="nominatorBlock"]');
    var nHead = form.querySelector('[data-role="nomineeHead"]');
    var sHead = form.querySelector('[data-role="statementHead"]');
    tabs.forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        mode = a.getAttribute('data-mode');
        tabs.forEach(function (x) { x.className = x === a ? 'on' : ''; });
        if (nomBlock) nomBlock.style.display = mode === 'self' ? 'none' : '';
        if (nHead) nHead.textContent = mode === 'self' ? ${JSON.stringify(c.yourself)} : ${JSON.stringify(c.nominee)};
        if (sHead) sHead.textContent = mode === 'self' ? ${JSON.stringify(c.statementSelf)} : ${JSON.stringify(c.statement)};
      });
    });
  }

  // A signed-in member gets the About-you fields filled in. Anonymous visitors see an empty form
  // and nothing at all happens — the page never depends on a session.
  try {
    var tok = localStorage.getItem('medx_user_token');
    if (tok) {
      fetch('/api/v2/awards/me', { headers: { Authorization: 'Bearer ' + tok } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (me) {
          if (!me || !me.email) return;
          var set = function (role, val) { var el = form.querySelector('[data-role="' + role + '"]'); if (el && !el.value && val) el.value = val; };
          if (IS_APP) { set('nominee_name', me.name); set('nominee_email', me.email); set('nominee_institution', me.institution); }
          else { set('nominator_name', me.name); set('nominator_email', me.email); }
        }).catch(function () {});
    }
  } catch (e) {}

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var err = form.querySelector('[data-role="err"]'), ok = form.querySelector('[data-role="ok"]');
    var btn = form.querySelector('[data-role="submit"]');
    err.style.display = 'none';
    var body = {
      category: KEY, website: v('website'), language: v('language') || LANG,
      self: mode === 'self',
      nominee_name: v('nominee_name'), nominee_email: v('nominee_email'),
      nominee_institution: v('nominee_institution'), nominee_position: v('nominee_position'),
      nominee_country: v('nominee_country'), nominee_birth_year: v('nominee_birth_year'),
      nominee_links: v('nominee_links'),
      nominator_name: v('nominator_name'), nominator_email: v('nominator_email'), nominator_relation: v('nominator_relation'),
      statement: v('statement'), challenge: v('challenge'), solution: v('solution'), why_you: v('why_you'),
      school: v('school'), study_year: v('study_year'),
      willing_to_present: v('willing_to_present'), consent_publish: v('consent_publish')
    };
    btn.disabled = true; btn.textContent = ${JSON.stringify(c.sending)};
    fetch('/api/v2/awards/entries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok || !res.j.success) {
          err.textContent = (res.j && (res.j.error || (res.j.errors && res.j.errors[0]))) || 'That did not go through. Please try again.';
          err.style.display = 'block';
          btn.disabled = false; btn.textContent = ${JSON.stringify(c.submit)};
          return;
        }
        var f = form.querySelector('#aw_pdf');
        var done = function () {
          form.querySelectorAll('.sec, .tabs, [data-role="submit"]').forEach(function (el) { el.style.display = 'none'; });
          ok.style.display = 'block';
          if (res.j.manage_url) ok.innerHTML += '<div style="margin-top:10px;"><a href="' + res.j.manage_url + '">' + (LANG === 'hr' ? 'Otvorite stranicu svoje prijave' : 'Open your entry\\'s page') + '</a></div>';
        };
        if (f && f.files && f.files[0] && res.j.token) {
          var fd = new FormData(); fd.append('file', f.files[0]);
          fetch('/api/v2/awards/entries/' + res.j.token + '/attachment', { method: 'POST', body: fd })
            .then(function () { done(); }).catch(function () { done(); });
        } else done();
      })
      .catch(function () {
        err.textContent = 'We could not reach the server. Please try again in a moment.';
        err.style.display = 'block';
        btn.disabled = false; btn.textContent = ${JSON.stringify(c.submit)};
      });
  });
})();
</script>`;
    }

    // ================================================================ PUBLIC API
    app.get('/api/v2/awards/overview', (req, res) => {
        try {
            const ed = activeEd();
            if (!ed) return res.json({ edition: null, categories: [] });
            res.json({
                edition: editions.toJson(ed),
                categories: cats().map(cat => core.categoryJson(q, cat))
            });
        } catch (e) { log('overview:', e.message); res.status(500).json({ error: 'The awards are unavailable right now.' }); }
    });

    // Prefill for a signed-in member. Auth'd on purpose: nothing here is public.
    app.get('/api/v2/awards/me', auth, (req, res) => {
        try {
            const u = q.get('SELECT id, email, first_name, last_name, institution, title, country FROM users WHERE id = ?', [(req.user || {}).id || ''])
                || q.get('SELECT id, email, first_name, last_name, institution FROM users WHERE id = ?', [(req.user || {}).id || '']);
            if (!u) return res.json({});
            res.json({
                name: [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || null,
                email: u.email || null, institution: u.institution || null,
                position: u.title || null, country: u.country || null
            });
        } catch (e) { res.json({}); }
    });

    // ---------------------------------------------------------------- the review gate
    const ipHash = (req) => {
        try {
            const ip = String((req.headers && (req.headers['x-forwarded-for'] || '').split(',')[0]) || (req.ip || '')).trim();
            return ip ? crypto.createHmac('sha256', JWT_SECRET).update('awip:' + ip).digest('hex').slice(0, 32) : null;
        } catch (e) { return null; }
    };

    /**
     * The one gate every public submission passes. Returns null when the entry is clean, or
     * { reason } when it must be HELD. Exactly the signals boston.js and the Zagreb form use:
     * the honeypot is handled by the caller (it writes nothing at all), gibberish is
     * suspicionScore >= 2, and a country outside the safe list — or a blank one — holds.
     */
    function gateFor(fields) {
        const nomineeName = [fields.nominee_first, fields.nominee_last].filter(Boolean).join(' ');
        const scores = [
            reviewGate.suspicionScore({ name: nomineeName, institution: fields.nominee_institution, position: fields.nominee_position }),
            fields.nominator_name
                ? reviewGate.suspicionScore({ name: fields.nominator_name, institution: null, position: fields.nominator_relation })
                : 0
        ];
        if (Math.max(...scores) >= 2) return { reason: 'Looks machine-generated' };
        if (!reviewGate.isSafeCountry(fields.nominee_country)) {
            return { reason: 'Country outside the safe list: ' + (fields.nominee_country || 'not given') };
        }
        return null;
    }

    async function send(to, subject, html) {
        if (!to || !validEmail(to)) return false;
        try { await sendEmail(to, subject, html); return true; }
        catch (e) { log('email failed:', e.message); return false; }
    }

    const closesLabel = (cat, lang) => dateLabel(cat.closes_at, lang);

    // ---------------------------------------------------------------- POST an entry
    app.post('/api/v2/awards/entries', async (req, res) => {
        try {
            const b = req.body || {};
            // Honeypot: a hidden 'website' input no human sees or tabs into. Filled → a bot
            // autofilled everything: answer like a success and write NOTHING.
            if (String(b.website || '').trim()) {
                log('honeypot tripped — awards submission silently dropped');
                return res.json({ success: true });
            }
            const lang = core.LANGS.includes(String(b.language)) ? String(b.language) : 'en';
            const cat = catByKey(String(b.category || ''));
            if (!cat) return res.status(404).json({ error: 'That award does not exist.' });
            // Refusals answer in the language the form was filled in, and in the intake's own words
            // — a Croatian applicant to the student fellowship used to be told, in English, that
            // "Nominations" were closed.
            const rc = C[L(lang)];
            const isApp = String(cat.intake) === 'application';
            if (String(cat.intake) === 'none') return res.status(400).json({ error: rc.refuseNone });
            const w = core.windowState(cat);
            if (w === 'before') return res.status(400).json({ error: rc.opensBanner(dateLabel(cat.opens_at, lang), isApp) });
            if (w === 'closed') return res.status(400).json({ error: rc.closedBanner(isApp) });

            const { errors, fields } = core.validateEntry(cat, b);
            if (errors.length) return res.status(400).json({ error: errors[0], errors });

            const held = gateFor(fields);
            const out = core.createEntry(cx, cat, fields, {
                status: held ? 'pending-review' : 'received',
                gate_reason: held ? held.reason : null,
                source_ip_hash: ipHash(req),
                actor: fields.nominator_email || fields.nominee_email
            });
            persist();
            const entry = out.entry;
            if (!entry) return res.status(500).json({ error: 'Could not record that just now — please try again.' });
            if (out.locked) {
                return res.json({ success: true, already: true, token: entry.manage_token, manage_url: manageUrl(entry.manage_token) });
            }

            const replyTo = entry.nominator_email || entry.nominee_email;
            const firstName = (entry.nominator_name || entry.nominee_first || '').split(/\s+/)[0] || null;

            if (held) {
                // HELD: nothing is acknowledged as accepted, nobody is told they tripped anything.
                try {
                    const urls = reviewGate.reviewUrls(JWT_SECRET, 'award_entries', entry.id);
                    await sendEmail(reviewGate.REVIEW_TO, `An awards entry needs your review — ${cat.name}`,
                        reviewGate.buildReviewEmail({
                            kind: `${cat.name} · ${entry.kind}`,
                            reason: held.reason,
                            fields: {
                                'Award': cat.name,
                                'Kind': entry.kind,
                                'Nominee': fullName(entry),
                                'Nominee email': entry.nominee_email || '',
                                'Institution': entry.nominee_institution || '',
                                'Position': entry.nominee_position || '',
                                'Country': entry.nominee_country || '',
                                'Nominator': entry.nominator_name || '',
                                'Nominator email': entry.nominator_email || '',
                                'Statement': (entry.statement || entry.challenge || '').slice(0, 600),
                                'School': entry.school || ''
                            },
                            approveUrl: urls.approveUrl, rejectUrl: urls.rejectUrl
                        }));
                } catch (e) { log('review email failed:', e.message); }
                await send(replyTo, lang === 'hr' ? 'Zaprimljeno — Med&X nagrade' : 'We received it — the Med&X awards',
                    mail.softAcknowledgment({ firstName, awardName: cat.name, isApplication: entry.kind === 'application', locale: lang }));
                log(`awards entry ${entry.id} (${replyTo}) held for review — ${held.reason}`);
                return res.json({ success: true, held: true, token: entry.manage_token, manage_url: manageUrl(entry.manage_token) });
            }

            await acknowledge(entry, cat, lang);
            res.json({ success: true, token: entry.manage_token, manage_url: manageUrl(entry.manage_token), already: !!out.duplicate });
        } catch (e) { log('submit:', e.message); res.status(500).json({ error: 'Could not send that just now — please try again.' }); }
    });

    /** The two (or three) emails a clean entry produces. Called on submit AND on gate approval. */
    async function acknowledge(entry, cat, lang) {
        const locale = core.LANGS.includes(String(lang)) ? lang : (entry.language || 'en');
        const firstName = (entry.nominator_name || entry.nominee_first || '').split(/\s+/)[0] || null;
        const params = {
            firstName, locale,
            awardName: cat.name, nomineeName: fullName(entry),
            closesLabel: closesLabel(cat, locale),
            manageUrl: manageUrl(entry.manage_token),
            school: entry.school, attachmentName: entry.attachment_name
        };
        if (entry.kind === 'application') {
            await send(entry.nominee_email, locale === 'hr' ? 'Prijava zaprimljena — Plexus stipendija' : 'Application received — the Plexus Fellowship',
                mail.applicationReceived(params));
            return;
        }
        const self = entry.kind === 'self-nomination';
        await send(self ? entry.nominee_email : entry.nominator_email,
            locale === 'hr' ? `Nominacija zaprimljena — ${cat.name}` : `Nomination received — ${cat.name}`,
            mail.nominationReceived(Object.assign({}, params, { self })));
        // A third-party nominee with an address hears it from us, warmly, and is asked for nothing.
        if (!self && entry.nominee_email && validEmail(entry.nominee_email)) {
            await send(entry.nominee_email,
                locale === 'hr' ? `Nominirani ste — ${cat.name}` : `You have been nominated — ${cat.name}`,
                mail.nomineeNotified({
                    firstName: entry.nominee_first || null, locale,
                    awardName: cat.name, nominatorName: entry.nominator_name || null
                }));
        }
    }

    // ---------------------------------------------------------------- review-gate decisions
    // The /api/review/:token routes themselves are mounted ONCE from server.js; this only plugs
    // the award_entries decisions into that shared dispatcher. Idempotent: a decision applies
    // only to a 'pending-review' row, so clicking a link twice re-sends nothing.
    reviewGate.registerReviewHandlers('award_entries', {
        eventLabel: 'the Plexus Gala awards',
        approve: async (id) => {
            const entry = core.entryById(q, id);
            if (!entry) return { status: 'notfound' };
            const cat = core.categoryById(q, entry.category_id);
            const who = fullName(entry);
            if (entry.status !== 'pending-review') {
                return {
                    status: 'already',
                    headline: entry.status === 'ineligible' ? 'Already rejected.' : 'Already approved.',
                    message: entry.status === 'ineligible'
                        ? `${who}'s entry was rejected earlier — nothing was sent.`
                        : `${who}'s entry was released earlier and the acknowledgment already went out. Nothing was re-sent.`
                };
            }
            q.run("UPDATE award_entries SET status = 'received', gate_reason = ?, updated_at = ? WHERE id = ?",
                [String(entry.gate_reason || '') + ' · approved ' + nowIso().slice(0, 10), nowIso(), id]);
            core.audit(q, id, entry.category_id, 'gate-approved', entry.gate_reason || '', 'review-gate');
            persist();
            if (cat) { try { await acknowledge(core.entryById(q, id), cat, entry.language || 'en'); } catch (e) { log('approve ack:', e.message); } }
            log(`awards entry ${id} APPROVED from the review gate`);
            return { status: 'done', headline: 'Approved.', message: `${who} is in the running for ${cat ? cat.name : 'the award'} — the acknowledgment has been sent and the entry is now with the panel.` };
        },
        reject: async (id) => {
            const entry = core.entryById(q, id);
            if (!entry) return { status: 'notfound' };
            const who = fullName(entry);
            if (entry.status !== 'pending-review') {
                return {
                    status: 'already',
                    headline: entry.status === 'ineligible' ? 'Already rejected.' : 'Already approved.',
                    message: entry.status === 'ineligible'
                        ? `${who}'s entry was already rejected.`
                        : `${who}'s entry was approved earlier and the acknowledgment already went out — rejecting from this link is disabled. Mark it ineligible from the admin side if you need to.`
                };
            }
            q.run("UPDATE award_entries SET status = 'ineligible', gate_reason = ?, updated_at = ? WHERE id = ?",
                [String(entry.gate_reason || '') + ' · rejected ' + nowIso().slice(0, 10), nowIso(), id]);
            core.audit(q, id, entry.category_id, 'gate-rejected', entry.gate_reason || '', 'review-gate');
            persist();
            log(`awards entry ${id} REJECTED from the review gate`);
            return { status: 'done', headline: 'Rejected.', message: `${who}'s entry has been set aside. They were never told, and nothing reached the panel.` };
        },
        getRow: (id) => {
            const e = core.entryById(q, id);
            if (!e) return null;
            return {
                id: e.id, name: fullName(e),
                email: e.nominator_email || e.nominee_email || '',
                institution: e.nominee_institution || '',
                notes: e.admin_notes || '',
                state: e.status === 'pending-review' ? 'pending' : (e.status === 'ineligible' ? 'rejected' : 'approved')
            };
        },
        setNotes: (id, notes) => { try { q.run('UPDATE award_entries SET admin_notes = ? WHERE id = ?', [notes, id]); persist(); } catch (e) {} }
    });

    // ---------------------------------------------------------------- attachment upload
    const multerSingle = multerLib
        ? multerLib({ storage: multerLib.memoryStorage(), limits: { fileSize: MAX_PDF, files: 1 } }).single('file')
        : null;
    function pdfParser(req, res, next) {
        if (!multerSingle) return res.status(503).json({ error: 'Uploads are momentarily unavailable. Your entry is already saved — the page is enough without the PDF.' });
        multerSingle(req, res, err => {
            if (!err) return next();
            if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'That file is over the 5 MB limit. One page is all we need.' });
            return res.status(400).json({ error: 'We could not read that upload. Please try again with a PDF.' });
        });
    }

    app.post('/api/v2/awards/entries/:token/attachment', pdfParser, async (req, res) => {
        try {
            const hit = byManageToken(req.params.token);
            if (!hit) return res.status(404).json({ error: 'This link is not valid.' });
            const { entry, category } = hit;
            if (!core.isOpen(category)) return res.status(400).json({ error: 'This award is closed — the entry can no longer be changed.' });
            const f = req.file;
            if (!f || !f.buffer || !f.buffer.length) return res.status(400).json({ error: 'Choose a PDF first — one page, up to 5 MB.' });
            if (f.buffer.length > MAX_PDF) return res.status(413).json({ error: 'That file is over the 5 MB limit.' });
            const name = String(f.originalname || 'page.pdf');
            if (!/\.pdf$/i.test(name)) return res.status(400).json({ error: 'PDF only, please — export it and try again.' });
            if (!boston._magicOk('pdf', f.buffer)) return res.status(400).json({ error: 'That file does not look like a PDF inside. Please export a real PDF and try again.' });
            if (!boston._s3.isConfigured()) return res.status(503).json({ error: 'Attachments are not enabled on this server yet. Your entry itself is safely recorded.' });
            const storedKey = `${S3_PREFIX}/${entry.id}/page.pdf`;
            await boston._s3.putObject(storedKey, f.buffer, 'application/pdf');
            q.run('UPDATE award_entries SET attachment_key = ?, attachment_name = ?, attachment_size = ?, updated_at = ? WHERE id = ?',
                [storedKey, boston._sanitizeFilename(name), f.buffer.length, nowIso(), entry.id]);
            core.audit(q, entry.id, entry.category_id, 'attachment', `${name} · ${f.buffer.length} bytes`, entry.nominee_email);
            persist();
            res.json({ success: true, name: boston._sanitizeFilename(name), size: f.buffer.length });
        } catch (e) { log('attachment:', e.message); res.status(500).json({ error: 'The upload did not go through. Your entry itself is safe.' }); }
    });

    // ---------------------------------------------------------------- manage / withdraw
    function manageJson(entry, cat) {
        const stage = entry.status === 'withdrawn' ? 'withdrawn'
            : ['winner', 'declined', 'ineligible'].includes(String(entry.status)) ? 'decided'
                : entry.status === 'shortlisted' ? 'shortlisted'
                    : entry.status === 'eligible' ? 'under-review' : 'received';
        return {
            award: cat.name, award_hr: cat.name_hr || null, kind: entry.kind,
            nominee: fullName(entry), status: entry.status, stage,
            can_withdraw: !['withdrawn', 'winner'].includes(String(entry.status)),
            attachment: entry.attachment_name || null,
            submitted_at: entry.created_at || null,
            closes_at: cat.closes_at || null
        };
    }

    app.get('/api/v2/awards/entries/:token', (req, res) => {
        const hit = byManageToken(req.params.token);
        if (!hit) return res.status(404).json({ error: 'Not found' });
        res.json(manageJson(hit.entry, hit.category));
    });

    app.post('/api/v2/awards/entries/:token/withdraw', (req, res) => {
        try {
            const hit = byManageToken(req.params.token);
            if (!hit) return res.status(404).json({ error: 'Not found' });
            const out = core.withdrawEntry(cx, hit.entry, hit.entry.nominator_email || hit.entry.nominee_email);
            persist();
            if (!out.ok) return res.status(400).json({ error: out.reason === 'decided' ? 'This one has already been decided — write to us and we will sort it out.' : 'Not found' });
            res.json({ success: true, already: !!out.already });
        } catch (e) { log('withdraw:', e.message); res.status(500).json({ error: 'Could not withdraw that just now.' }); }
    });

    function managePageHtml(entry, cat, lang, justWithdrawn) {
        const hr = L(lang) === 'hr';
        const j = manageJson(entry, cat);
        const stageLine = {
            received: hr ? 'Zaprimljeno — čeka panel.' : 'Received — with the panel.',
            'under-review': hr ? 'U čitanju kod panela.' : 'Being read by the panel.',
            shortlisted: hr ? 'U užem izboru.' : 'On the shortlist.',
            decided: hr ? 'Odlučeno.' : 'Decided.',
            withdrawn: hr ? 'Povučeno.' : 'Withdrawn.'
        }[j.stage];
        const fact = (k, v) => v ? `
        <div style="display:flex;gap:10px;padding:9px 0;border-bottom:1px solid rgba(25,21,18,.1);font-size:13px;">
          <span style="min-width:110px;font-weight:600;font-size:9px;letter-spacing:.14em;color:#6e5626;text-transform:uppercase;padding-top:3px;">${esc(k)}</span>
          <span style="color:#191512;">${esc(v)}</span></div>` : '';
        return page({
            title: `${cat.name} — Med&X`,
            eyebrow: hr ? 'Plexus tjedan · Nagrade' : 'Plexus Week · The Awards',
            headline: esc(hr && cat.name_hr ? cat.name_hr : cat.name),
            bodyHtml: `${FORM_CSS}
        <p style="font-size:14px;line-height:1.7;color:#4a4239;margin-top:14px;">${justWithdrawn
                ? (hr ? 'Povukli smo vašu prijavu. Hvala što ste nam javili — ništa više nije potrebno.' : 'Your entry has been withdrawn. Thank you for telling us — nothing more is needed.')
                : (hr ? 'Sve o vašoj prijavi je niže. Ako se predomislite, možete je povući u bilo kojem trenutku.' : 'Everything about your entry is below. If you change your mind, you can withdraw it at any time.')}</p>
        <div style="margin-top:18px;">
          ${fact(hr ? 'Nagrada' : 'Award', hr && cat.name_hr ? cat.name_hr : cat.name)}
          ${fact(hr ? 'Kandidat' : 'Nominee', j.nominee)}
          ${fact(hr ? 'Status' : 'Status', stageLine)}
          ${fact(hr ? 'Poslano' : 'Sent', String(j.submitted_at || '').slice(0, 10))}
          ${fact(hr ? 'Prilog' : 'Attachment', j.attachment)}
        </div>
        ${j.can_withdraw ? `<form method="POST" action="/awards/manage/${esc(entry.manage_token)}${hr ? '?lang=hr' : ''}" style="margin:0;">
          <button class="mx" type="submit">${hr ? 'Povuci prijavu' : 'Withdraw my entry'}</button></form>` : ''}
        <p style="font-size:12px;color:#4a4239;margin-top:22px;">${hr ? 'Pitanja? Odgovorite na e-mail koji vas je doveo ovdje ili pišite na laura.rodman@medx.hr.' : 'Questions? Reply to the email that brought you here, or write to laura.rodman@medx.hr.'}</p>`
        });
    }

    app.get('/awards/manage/:token', (req, res) => {
        try {
            const hit = byManageToken(req.params.token);
            if (!hit) return notFoundPage(res, langOf(req));
            res.send(managePageHtml(hit.entry, hit.category, langOf(req) || hit.entry.language, false));
        } catch (e) { log('manage page:', e.message); notFoundPage(res, langOf(req)); }
    });

    app.post('/awards/manage/:token', (req, res) => {
        try {
            const hit = byManageToken(req.params.token);
            if (!hit) return notFoundPage(res, langOf(req));
            const out = core.withdrawEntry(cx, hit.entry, hit.entry.nominator_email || hit.entry.nominee_email);
            persist();
            const fresh = core.entryById(q, hit.entry.id) || hit.entry;
            res.send(managePageHtml(fresh, hit.category, langOf(req) || fresh.language, !!(out && out.ok)));
        } catch (e) { log('manage withdraw:', e.message); notFoundPage(res, langOf(req)); }
    });

    // ================================================================ REVIEWER ROOM
    function touchReviewer(r) {
        try {
            q.run("UPDATE award_reviewers SET last_seen = ?, accepted_at = COALESCE(accepted_at, ?), status = CASE WHEN status = 'invited' THEN 'active' ELSE status END WHERE id = ?",
                [nowIso(), nowIso(), r.id]);
            persist();
        } catch (e) {}
    }

    /** The reviewer's own queue. Nothing outside their categories is ever shaped, let alone sent. */
    function reviewerPayload(r) {
        const queue = core.reviewerQueue(q, r);
        return {
            reviewer: { name: r.name, email: r.email, status: r.status },
            progress: { scored: queue.scored, total: queue.total },
            groups: queue.groups.map(g => ({
                category: { id: g.category.id, key: g.category.key, name: g.category.name, name_hr: g.category.name_hr || null },
                rubric: g.rubric,
                closes_at: g.category.closes_at || null,
                open_for_scoring: true,
                entries: g.entries.map(x => ({
                    // The nominator is anonymised in the room, and the gate reason never leaves admin.
                    entry: core.entryJson(x.entry, { anonymiseNominator: true, redactGate: true }),
                    mine: x.mine ? {
                        scores: (() => { try { return JSON.parse(x.mine.scores_json || '{}'); } catch (e) { return {}; } })(),
                        total: Number(x.mine.total) || 0, comment: x.mine.comment || null,
                        conflict: Number(x.mine.conflict) === 1,
                        submitted_at: x.mine.submitted_at || null, updated_at: x.mine.updated_at || null
                    } : null
                }))
            }))
        };
    }

    app.get('/api/v2/awards/review/:token/data', (req, res) => {
        try {
            const r = byReviewerToken(req.params.token);
            if (!r) return res.status(404).json({ error: 'Not found' });
            touchReviewer(r);
            res.json(reviewerPayload(r));
        } catch (e) { log('review data:', e.message); res.status(500).json({ error: 'Unavailable' }); }
    });

    app.post('/api/v2/awards/review/:token/score', (req, res) => {
        try {
            const r = byReviewerToken(req.params.token);
            if (!r) return res.status(404).json({ error: 'Not found' });
            const b = req.body || {};
            const entry = core.entryById(q, String(b.entry_id || ''));
            // SCOPING: an entry outside this reviewer's categories is a 404, never a 403 — a 403
            // would confirm that the entry exists.
            if (!entry || !core.reviewerMaySee(r, entry.category_id)) return res.status(404).json({ error: 'Not found' });
            const cat = core.categoryById(q, entry.category_id);
            if (!cat) return res.status(404).json({ error: 'Not found' });
            const out = core.submitScore(cx, r, entry, cat, b);
            if (out.errors) return res.status(400).json({ error: out.errors[0], errors: out.errors });
            touchReviewer(r);
            persist();
            const queue = core.reviewerQueue(q, r);
            res.json({
                success: true, edited: !!out.edited,
                total: Number(out.score.total) || 0, conflict: Number(out.score.conflict) === 1,
                progress: { scored: queue.scored, total: queue.total }
            });
        } catch (e) { log('score:', e.message); res.status(500).json({ error: 'Could not record that score — please try again.' }); }
    });

    // A 15-minute presigned GET of one entry's PDF — only for a reviewer scoped to its category.
    app.get('/api/v2/awards/review/:token/attachment/:entryId', (req, res) => {
        try {
            const r = byReviewerToken(req.params.token);
            if (!r) return res.status(404).json({ error: 'Not found' });
            const entry = core.entryById(q, String(req.params.entryId || ''));
            if (!entry || !core.reviewerMaySee(r, entry.category_id) || !entry.attachment_key) return res.status(404).json({ error: 'Not found' });
            const url = boston._s3.presignGet(entry.attachment_key, { expires: 900, filename: entry.attachment_name || 'entry.pdf' });
            if (!url) return res.status(503).json({ error: 'Attachments are not available on this server yet.' });
            res.redirect(302, url);
        } catch (e) { log('review attachment:', e.message); res.status(500).json({ error: 'Unavailable' }); }
    });

    app.get('/awards/review/:token', (req, res) => {
        try {
            const r = byReviewerToken(req.params.token);
            if (!r) return notFoundPage(res, 'en');
            touchReviewer(r);
            const d = reviewerPayload(r);
            const tok = String(req.params.token);
            const entryCard = (g, x) => {
                const e = x.entry;
                const body = e.statement
                    ? `<div style="font-size:13.5px;line-height:1.75;color:#4a4239;margin-top:10px;white-space:pre-wrap;">${esc(e.statement)}</div>`
                    : `<div style="margin-top:10px;">
                         ${['challenge', 'solution', 'why_you'].map(f => e[f] ? `
                           <div style="margin-top:10px;"><div style="font-weight:600;font-size:9px;letter-spacing:.14em;color:#6e5626;text-transform:uppercase;">${f === 'why_you' ? 'WHY THEM' : f.toUpperCase()}</div>
                           <div style="font-size:13.5px;line-height:1.75;color:#4a4239;margin-top:4px;white-space:pre-wrap;">${esc(e[f])}</div></div>` : '').join('')}
                       </div>`;
                const mine = x.mine;
                return `
      <div class="awentry" data-entry="${esc(e.id)}" style="padding:20px 0;border-bottom:1px solid rgba(25,21,18,.14);">
        <div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;">
          <span style="font-family:Fraunces,Georgia,serif;font-size:19px;">${esc(e.name)}</span>
          ${mine ? `<span style="font-weight:600;font-size:9px;letter-spacing:.14em;color:#1e6e42;">${mine.conflict ? 'SET ASIDE' : '✓ SCORED · ' + mine.total}</span>` : ''}
        </div>
        <div style="font-size:12px;color:#6d6459;margin-top:2px;">${esc([e.nominee_position, e.nominee_institution, e.school, e.study_year].filter(Boolean).join(' · ') || '—')}</div>
        ${e.links && e.links.length ? `<div style="font-size:12px;margin-top:6px;">${e.links.map(u => `<a href="${esc(u)}" rel="noopener noreferrer nofollow" target="_blank">${esc(u)}</a>`).join('<br>')}</div>` : ''}
        ${body}
        ${e.attachment ? `<div style="margin-top:10px;"><a class="ghost" style="margin-top:6px;" href="/api/v2/awards/review/${esc(tok)}/attachment/${esc(e.id)}" target="_blank" rel="noopener">Open the PDF (${esc(e.attachment.name)})</a></div>` : ''}
        <div class="awf" style="margin-top:14px;padding-top:12px;border-top:1px dashed rgba(25,21,18,.18);">
          <div style="display:flex;gap:18px;flex-wrap:wrap;">
            ${g.rubric.map(cr => `
            <div>
              <div style="font-weight:600;font-size:9px;letter-spacing:.14em;color:#6e5626;text-transform:uppercase;">${esc(cr.label)}</div>
              ${cr.desc ? `<div style="font-size:11.5px;color:#6d6459;max-width:230px;line-height:1.5;margin-top:2px;">${esc(cr.desc)}</div>` : ''}
              <div style="display:flex;gap:5px;margin-top:6px;">
                ${[1, 2, 3, 4, 5].map(n => `<label style="cursor:pointer;"><input type="radio" name="${esc(e.id)}_${esc(cr.key)}" value="${n}" data-crit="${esc(cr.key)}"${mine && mine.scores[cr.key] === n ? ' checked' : ''} style="display:none;">
                  <span class="pip" style="display:inline-block;width:26px;height:26px;line-height:26px;text-align:center;font-size:12px;border:1px solid ${mine && mine.scores[cr.key] === n ? '#9b1b22' : 'rgba(25,21,18,.25)'};background:${mine && mine.scores[cr.key] === n ? '#9b1b22' : '#fff'};color:${mine && mine.scores[cr.key] === n ? '#fff' : '#191512'};">${n}</span></label>`).join('')}
              </div>
            </div>`).join('')}
          </div>
          <label for="c_${esc(e.id)}">A line of comment (optional)</label>
          <textarea id="c_${esc(e.id)}" data-comment style="min-height:70px;">${esc(mine && mine.comment ? mine.comment : '')}</textarea>
          <div class="check"><input type="checkbox" data-conflict${mine && mine.conflict ? ' checked' : ''}><label style="margin:0;font-weight:400;font-size:13px;letter-spacing:0;text-transform:none;color:#4a4239;">I have a conflict of interest — set this one aside (it is left out of every number)</label></div>
          <button class="mx" type="button" data-save>${mine ? 'Update my score' : 'Save my score'}</button>
          <span data-said style="margin-left:12px;font-weight:600;font-size:10px;letter-spacing:.14em;color:#1e6e42;"></span>
        </div>
      </div>`;
            };
            const groups = d.groups.map(g => `
      <div style="margin-top:28px;">
        <div style="font-weight:600;font-size:10px;letter-spacing:.16em;color:#6e5626;text-transform:uppercase;">${esc(g.category.name)}</div>
        ${g.entries.length ? g.entries.map(x => entryCard(g, x)).join('') : '<p style="font-size:13px;color:#6d6459;font-style:italic;margin-top:10px;">Nothing to read here yet — entries appear as they come in.</p>'}
      </div>`).join('');
            res.send(page({
                title: 'Your reading room — Med&X',
                eyebrow: 'PLEXUS WEEK · AWARDS PANEL',
                headline: `Your reading room, <i>${esc(String(r.name || '').split(/\s+/)[0] || 'reader')}</i>.`,
                bodyHtml: `${FORM_CSS}
        <p style="font-size:14px;line-height:1.7;color:#4a4239;margin-top:14px;">Score each entry from 1 to 5 on the three criteria, and add a line where you have one. You will not see anybody else's scores, and they will not see yours. If you know somebody personally, tick the conflict box — that entry is then left out of every number we print.</p>
        <div style="margin-top:16px;padding:12px 16px;background:#fdfaf3;border-left:3px solid #c9a962;">
          <span style="font-weight:600;font-size:10px;letter-spacing:.14em;color:#6e5626;">PROGRESS</span>
          <span style="font-size:13.5px;color:#191512;margin-left:10px;" data-progress>You have scored ${d.progress.scored} of ${d.progress.total}.</span>
        </div>
        ${groups}
        <p style="font-size:12px;color:#4a4239;margin-top:26px;">This page is yours alone — the link is the key, so please keep it to yourself.</p>
        ${reviewerScript(tok)}`
            }));
        } catch (e) { log('review page:', e.message); notFoundPage(res, 'en'); }
    });

    function reviewerScript(token) {
        return `<script>
(function(){
  var TOKEN = ${JSON.stringify(String(token))};
  document.querySelectorAll('input[type=radio][data-crit]').forEach(function (r) {
    r.addEventListener('change', function () {
      var name = r.getAttribute('name');
      document.querySelectorAll('input[name="' + name + '"]').forEach(function (x) {
        var pip = x.nextElementSibling;
        if (!pip) return;
        pip.style.background = x.checked ? '#9b1b22' : '#fff';
        pip.style.color = x.checked ? '#fff' : '#191512';
        pip.style.borderColor = x.checked ? '#9b1b22' : 'rgba(25,21,18,.25)';
      });
    });
  });
  document.querySelectorAll('[data-save]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var card = btn.closest('.awentry');
      var id = card.getAttribute('data-entry');
      var said = card.querySelector('[data-said]');
      var scores = {};
      card.querySelectorAll('input[type=radio][data-crit]:checked').forEach(function (r) { scores[r.getAttribute('data-crit')] = Number(r.value); });
      var body = {
        entry_id: id, scores: scores,
        comment: (card.querySelector('[data-comment]') || {}).value || '',
        conflict: !!(card.querySelector('[data-conflict]') || {}).checked
      };
      btn.disabled = true; said.textContent = 'SAVING…'; said.style.color = '#6d6459';
      fetch('/api/v2/awards/review/' + TOKEN + '/score', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          btn.disabled = false;
          if (!res.ok || !res.j.success) { said.textContent = (res.j && res.j.error) || 'DID NOT SAVE'; said.style.color = '#9b1b22'; return; }
          said.textContent = res.j.conflict ? 'SET ASIDE' : ('SAVED · ' + res.j.total); said.style.color = '#1e6e42';
          btn.textContent = 'Update my score';
          var p = document.querySelector('[data-progress]');
          if (p && res.j.progress) p.textContent = 'You have scored ' + res.j.progress.scored + ' of ' + res.j.progress.total + '.';
        })
        .catch(function () { btn.disabled = false; said.textContent = 'NO CONNECTION'; said.style.color = '#9b1b22'; });
    });
  });
})();
</script>`;
    }

    // ================================================================ LAUREATE · slides + presentation
    app.get('/awards/slides/:token', (req, res) => {
        try {
            const hit = bySlidesToken(req.params.token);
            if (!hit) return notFoundPage(res, langOf(req));
            const { laureate, category } = hit;
            const hr = L(langOf(req)) === 'hr';
            const tok = String(req.params.token);
            res.send(page({
                title: (hr ? 'Vaša prezentacija' : 'Your presentation') + ' — Med&X',
                eyebrow: hr ? 'PLEXUS TJEDAN · GALA VEČER' : 'PLEXUS WEEK · GALA EVENING',
                headline: hr ? `Vaših tri minute, <i>${esc(String(laureate.name).split(/\s+/)[0])}</i>.` : `Your three minutes, <i>${esc(String(laureate.name).split(/\s+/)[0])}</i>.`,
                bodyHtml: `${FORM_CSS}
        <p style="font-size:14px;line-height:1.7;color:#4a4239;margin-top:14px;">${hr
                    ? `Na Gala večeri 5. prosinca imate tri minute na pozornici, o ideji koju ste nam poslali za <b>${esc(category.name_hr || category.name)}</b>. Potvrdite nam da dolazite i, ako želite, pošaljite slajdove.`
                    : `At the Gala Evening on 5 December you have three minutes on the stage, about the idea you sent us for <b>${esc(category.name)}</b>. Confirm that you will be there and, if you would like, send us your slides.`}</p>
        <div class="awf" style="margin-top:20px;">
          <div class="check"><input type="checkbox" id="aw_conf" ${Number(laureate.presentation_confirmed) === 1 ? 'checked disabled' : ''}><label for="aw_conf" style="margin:0;font-weight:400;font-size:13.5px;letter-spacing:0;text-transform:none;color:#4a4239;">${hr ? 'Potvrđujem — održat ću trominutnu prezentaciju.' : 'Yes — I will give the three-minute presentation.'}</label></div>
          <label for="aw_sl">${hr ? 'Slajdovi (PDF, do 5 MB, neobavezno)' : 'Slides (PDF, up to 5 MB, optional)'}</label>
          <input id="aw_sl" type="file" accept="application/pdf,.pdf" style="font-size:13px;">
          <button class="mx" type="button" id="aw_go">${hr ? 'Spremi' : 'Save'}</button>
          <span id="aw_said" style="margin-left:12px;font-weight:600;font-size:10px;letter-spacing:.14em;color:#1e6e42;">${laureate.slides_name ? esc(laureate.slides_name) : ''}</span>
          <div class="err" id="aw_err"></div>
        </div>
        <p style="font-size:12px;color:#4a4239;margin-top:22px;">${hr ? 'Bez slajdova je posve u redu. Pitanja? laura.rodman@medx.hr' : 'No slides at all is perfectly fine. Questions? laura.rodman@medx.hr'}</p>
        <script>
        (function(){
          var TOKEN=${JSON.stringify(tok)};
          var said=document.getElementById('aw_said'), err=document.getElementById('aw_err');
          document.getElementById('aw_go').addEventListener('click', function(){
            err.style.display='none'; said.textContent='…';
            var conf=document.getElementById('aw_conf').checked;
            fetch('/api/v2/awards/slides/'+TOKEN+'/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmed:conf})})
              .then(function(){
                var f=document.getElementById('aw_sl');
                if(f&&f.files&&f.files[0]){
                  var fd=new FormData(); fd.append('file',f.files[0]);
                  return fetch('/api/v2/awards/slides/'+TOKEN+'/upload',{method:'POST',body:fd}).then(function(r){return r.json();});
                }
                return {success:true};
              })
              .then(function(j){
                if(j&&j.error){ err.textContent=j.error; err.style.display='block'; said.textContent=''; return; }
                said.textContent=${JSON.stringify(hr ? 'SPREMLJENO' : 'SAVED')};
              })
              .catch(function(){ err.textContent=${JSON.stringify(hr ? 'Nije prošlo — pokušajte ponovno.' : 'That did not go through — please try again.')}; err.style.display='block'; said.textContent=''; });
          });
        })();
        </script>`
            }));
        } catch (e) { log('slides page:', e.message); notFoundPage(res, langOf(req)); }
    });

    app.post('/api/v2/awards/slides/:token/confirm', (req, res) => {
        try {
            const hit = bySlidesToken(req.params.token);
            if (!hit) return res.status(404).json({ error: 'Not found' });
            const on = (req.body || {}).confirmed === false ? 0 : 1;
            q.run('UPDATE award_laureates SET presentation_confirmed = ?, presentation_confirmed_at = ? WHERE id = ?',
                [on, on ? nowIso() : null, hit.laureate.id]);
            core.audit(q, hit.laureate.entry_id, hit.laureate.category_id, on ? 'presentation-confirmed' : 'presentation-unconfirmed', hit.laureate.name, hit.laureate.email);
            persist();
            res.json({ success: true, confirmed: on === 1 });
        } catch (e) { log('confirm:', e.message); res.status(500).json({ error: 'Could not save that just now.' }); }
    });

    app.post('/api/v2/awards/slides/:token/upload', pdfParser, async (req, res) => {
        try {
            const hit = bySlidesToken(req.params.token);
            if (!hit) return res.status(404).json({ error: 'Not found' });
            const f = req.file;
            if (!f || !f.buffer || !f.buffer.length) return res.status(400).json({ error: 'Choose a PDF first.' });
            if (!boston._magicOk('pdf', f.buffer)) return res.status(400).json({ error: 'That file does not look like a PDF inside. Please export a real PDF.' });
            if (!boston._s3.isConfigured()) return res.status(503).json({ error: 'Uploads are not enabled on this server yet — email the slides to laura.rodman@medx.hr instead.' });
            const key = `${S3_PREFIX}/slides/${hit.laureate.id}/slides.pdf`;
            await boston._s3.putObject(key, f.buffer, 'application/pdf');
            q.run('UPDATE award_laureates SET slides_key = ?, slides_name = ?, slides_size = ?, slides_uploaded_at = ? WHERE id = ?',
                [key, boston._sanitizeFilename(String(f.originalname || 'slides.pdf')), f.buffer.length, nowIso(), hit.laureate.id]);
            core.audit(q, hit.laureate.entry_id, hit.laureate.category_id, 'slides-uploaded', String(f.buffer.length) + ' bytes', hit.laureate.email);
            persist();
            res.json({ success: true });
        } catch (e) { log('slides upload:', e.message); res.status(500).json({ error: 'The upload did not go through.' }); }
    });

    // Exposed for the test suite (and for anything in-process that needs the same maths).
    mountAwards._internals = {
        sign, tokenMatches, byManageToken, byReviewerToken, bySlidesToken,
        gateFor, acknowledge, reviewerPayload, manageJson, ensureSchema, q, cx,
        dateLabel, md, formSection
    };

    log('awards: public pages EN/HR · nomination + fellowship forms · review gate · manage/withdraw · reviewer room · laureate slides');
};

module.exports.AWARDS_DDL = core.AWARDS_DDL;
