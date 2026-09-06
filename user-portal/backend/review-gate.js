/**
 * review-gate.js — shared registration REVIEW GATE (Alen 2026-09-06).
 *
 * Why this exists: bots hit the public forms with gibberish registrations (first_name
 * 'RQstQeTGKseNqJzmVHMmE', institution 'Ugakeu LLC', position 'cCzNfiIdNITvvnWjrBf') and got
 * real wallet passes; separately, visa-seeking fake registrants (real prior cases from Ghana)
 * used the Zagreb /plexus form. Rules:
 *   1. Gibberish-looking registrations on ANY public form are HELD — no confirmation, no QR,
 *      no wallet pass, no sheet row — and Alen gets an email with APPROVE / REJECT buttons.
 *   2. On the Zagreb form (/plexus → POST /api/croatians-abroad/register), registrants whose
 *      country is OUTSIDE the safe list below are HELD the same way regardless of gibberish.
 *      Unknown/blank country there → HOLD (it is a required signal on that form).
 *
 * ONE implementation shared by boston.js (Boston form) and server.js (Zagreb form):
 *   - looksRandom / suspicionScore    — gibberish heuristics (score >= 2 → hold)
 *   - isSafeCountry / SAFE_COUNTRIES  — tolerant country matcher (variants, diacritics, codes)
 *   - reviewToken / verifyReviewToken / reviewUrls — HMAC no-login approve/reject tokens
 *   - buildReviewEmail                — branded ink/cream/gold review email for Alen
 *   - registerReviewHandlers + mountReviewRoutes — GET /api/review/:token/approve|reject.
 *     The routes are mounted ONCE (server.js top level); each wing registers its own
 *     table handler (boston.js → bridges_registrations, server.js → croatians_abroad_
 *     registrations) whenever it initializes — the registry is consulted per request,
 *     so mount/registration order never matters.
 *
 * Review emails go to REVIEW_TO (juginovic.alen@gmail.com) — that is wanted in production.
 */
'use strict';

const crypto = require('crypto');
const tpl = require('./v2/email-templates');   // house shell/btn/T — every gate email uses the brand template

const REVIEW_TO = process.env.REVIEW_EMAIL || 'juginovic.alen@gmail.com';

const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const baseUrl = () => String(process.env.RENDER_EXTERNAL_URL || 'https://medx-user-portal.onrender.com').replace(/\/+$/, '');

// ---------------------------------------------------------------- gibberish heuristics
// Score-based; >= 2 → hold. Tuned against the real September 2026 bot rows AND real registrant
// names (academics with credentials — 'Ana Jaklenec, Ph.D.', 'Tanja Petnicki-Ocwieja, PhD' —
// must NOT trip it): case flips and consonant runs are counted PER WORD (ordinary Title-Case
// words and ALL-CAPS acronyms count zero), and credentials after a comma / trailing degree
// tokens are stripped from names before scoring.
function looksRandom(str) {
    const t = String(str || '').trim();
    if (t.length < 8) return false;
    const letters = t.replace(/[^A-Za-z]/g, '');
    if (letters.length < 8) return false;
    const vowels = (letters.match(/[aeiouAEIOU]/g) || []).length;
    if (vowels / letters.length < 0.22) return true;                     // consonant soup
    let flips = 0;
    for (const rawWord of t.split(/\s+/)) {
        const w = rawWord.replace(/[^A-Za-z]/g, '');
        if (!w) continue;
        if (/[bcdfghjklmnpqrstvwxz]{5,}/i.test(w)) return true;          // 5+ consonant run in one word
        if (/^[A-Z][a-z]+$/.test(w) || /^[a-z]+$/.test(w) || /^[A-Z]+$/.test(w)) continue; // normal word / acronym
        for (let i = 1; i < w.length; i++) {                             // aAbBcC case chatter
            const a = w[i - 1], b = w[i];
            if ((/[a-z]/.test(a) && /[A-Z]/.test(b)) || (/[A-Z]/.test(a) && /[a-z]/.test(b))) flips++;
        }
    }
    return flips >= 6;
}

// Trailing credentials must not poison the name signal: 'Ana Jaklenec, Ph.D.' → 'Ana Jaklenec'.
function stripCredentials(name) {
    let n = String(name || '').split(',')[0].trim();
    for (let guard = 0; guard < 4; guard++) {
        const next = n.replace(/[\s.]+(?:ph\.?\s*d|m\.?d|dr|prof|m\.?sc|b\.?sc|mba|mph|dds|dvm|rn|do|esq)\.?$/i, '').trim();
        if (next === n) break;
        n = next;
    }
    return n;
}

function suspicionScore({ name, institution, position }) {
    let score = 0;
    if (looksRandom(stripCredentials(name))) score += 2;
    if (looksRandom(position)) score += 1;
    const inst = String(institution || '').trim();
    const instCore = inst.replace(/\s+(LLC|Inc\.?|Ltd\.?|d\.o\.o\.?)$/i, '');
    if (looksRandom(instCore)) score += 1;
    if (/^[A-Za-z]{5,}\s+LLC$/i.test(inst) && looksRandom(instCore)) score += 1;
    return score;                                                        // >= 2 → hold for review
}

// ---------------------------------------------------------------- safe-country matcher
// Safe = all European countries (EU/EEA/UK/CH/NO + Balkans + the unambiguously European rest)
// plus the United States, Canada, Australia and New Zealand. Everything else — Africa, Asia
// (Bangladesh/India/China/Gulf...), all Latin America, and any unknown/blank value — HOLDS.
// Matching is tolerant: trimmed, case-insensitive, diacritics folded (Sjedinjene Američke
// Države), Croatian/native names, common abbreviations and short codes.
function normalizeCountry(raw) {
    let s = String(raw == null ? '' : raw)
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')                // strip diacritics
        .replace(/[đĐ]/g, 'd').replace(/ß/g, 'ss')
        .toLowerCase()
        .replace(/[^a-z]+/g, ' ')                                        // punctuation/emoji → spaces
        .replace(/\s+/g, ' ').trim();
    s = s.replace(/^the /, '').replace(/^republic of /, '').replace(/^republika /, '').replace(/^rep of /, '');
    return s;
}

// Safe countries keyed by ccTLD-style code (uk not gb — the code doubles as the email-TLD
// corroboration signal below). Values are the accepted normalized spellings/variants.
const SAFE_COUNTRY_VARIANTS = {
    // --- EU 27 (English + native/Croatian variants) ---
    at: ['austria', 'osterreich', 'austrija'],
    be: ['belgium', 'belgique', 'belgie', 'belgien', 'belgija'],
    bg: ['bulgaria', 'bugarska', 'balgariya'],
    hr: ['croatia', 'hrvatska', 'croatie', 'croazia', 'kroatien'],
    cy: ['cyprus', 'cipar'],
    cz: ['czech republic', 'czechia', 'ceska', 'ceska republika', 'ceska rep'],
    dk: ['denmark', 'danmark', 'danska'],
    ee: ['estonia', 'eesti', 'estonija'],
    fi: ['finland', 'suomi', 'finska'],
    fr: ['france', 'francuska'],
    de: ['germany', 'deutschland', 'njemacka', 'nemacka', 'allemagne'],
    gr: ['greece', 'hellas', 'grcka', 'ellada'],
    hu: ['hungary', 'magyarorszag', 'madarska'],
    ie: ['ireland', 'eire', 'irska'],
    it: ['italy', 'italia', 'italija'],
    lv: ['latvia', 'latvija'],
    lt: ['lithuania', 'lietuva', 'litva'],
    lu: ['luxembourg', 'luksemburg'],
    mt: ['malta'],
    nl: ['netherlands', 'the netherlands', 'holland', 'nederland', 'nizozemska'],
    pl: ['poland', 'polska', 'poljska'],
    pt: ['portugal'],
    ro: ['romania', 'rumunjska', 'rumunija'],
    sk: ['slovakia', 'slovensko', 'slovacka'],
    si: ['slovenia', 'slovenija'],
    es: ['spain', 'espana', 'spanjolska', 'spanija'],
    se: ['sweden', 'sverige', 'svedska'],
    // --- EEA / EFTA ---
    no: ['norway', 'norge', 'norveska'],
    is: ['iceland', 'island', 'islandija'],
    li: ['liechtenstein', 'lihtenstajn'],
    ch: ['switzerland', 'schweiz', 'suisse', 'svizzera', 'svicarska'],
    // --- United Kingdom & parts ---
    uk: ['united kingdom', 'uk', 'u k', 'gb', 'great britain', 'britain', 'england', 'scotland',
         'wales', 'northern ireland', 'velika britanija', 'ujedinjeno kraljevstvo',
         'united kingdom of great britain and northern ireland'],
    // --- Balkans (non-EU) ---
    rs: ['serbia', 'srbija'],
    ba: ['bosnia', 'bosnia and herzegovina', 'bosnia herzegovina', 'bosna', 'bosna i hercegovina', 'bih', 'b i h'],
    me: ['montenegro', 'crna gora'],
    mk: ['north macedonia', 'macedonia', 'makedonija', 'sjeverna makedonija'],
    al: ['albania', 'albanija', 'shqiperia'],
    xk: ['kosovo', 'kosova'],
    // --- rest of Europe (unambiguous) + microstates ---
    ua: ['ukraine', 'ukrajina'],
    md: ['moldova', 'moldavija'],
    by: ['belarus', 'bjelorusija'],
    ru: ['russia', 'russian federation', 'rusija'],
    ad: ['andorra'], mc: ['monaco', 'monako'], sm: ['san marino'],
    va: ['vatican', 'vatican city', 'holy see', 'vatikan'],
    // --- North America ---
    us: ['united states', 'united states of america', 'usa', 'us', 'u s', 'u s a', 'america',
         'sjedinjene americke drzave', 'sjedinjene drzave', 'sad', 'estados unidos'],
    ca: ['canada', 'kanada'],
    // --- Oceania ---
    au: ['australia', 'australija'],
    nz: ['new zealand', 'nz', 'novi zeland', 'aotearoa']
};

const VARIANT_TO_CODE = new Map();
for (const [code, variants] of Object.entries(SAFE_COUNTRY_VARIANTS)) {
    for (const v of variants) VARIANT_TO_CODE.set(v, code);
}
const SAFE_COUNTRIES = new Set(VARIANT_TO_CODE.keys());                  // kept for callers/tests

/** ccTLD-style code for a safe-country claim ('hr', 'us', 'uk', ...) — null when not safe/blank. */
function countryCode(raw) {
    const n = normalizeCountry(raw);
    if (!n) return null;                                                 // blank/unknown → HOLD
    if (VARIANT_TO_CODE.has(n)) return VARIANT_TO_CODE.get(n);
    const compact = n.replace(/ /g, '');                                 // 'u s a' → 'usa'
    if (compact.length <= 3 && VARIANT_TO_CODE.has(compact)) return VARIANT_TO_CODE.get(compact);
    return null;
}

function isSafeCountry(raw) {
    return countryCode(raw) !== null;
}

// ---------------------------------------------------------------- country-claim coherence
// Real fraud pattern (Alen 2026-09-06): a foreign-looking registrant with a random free-mail
// address and a non-Croatian company simply types "Croatia" to slip past the country gate.
// A claimed SAFE country must therefore be corroborated by at least ONE aligning signal:
//   (a) the email domain plausibly matches the claim — the country's ccTLD, or an institutional
//       domain (.edu / .ac.* / .gov / .mil, or a university/hospital/institute token);
//   (b) for Croatia specifically, the name reads Croatian — diacritics (č ć ž š đ), surname
//       endings -ić/-ović/-ek/-ac (ASCII spellings included), or a common Croatian given name;
//   (c) the institution names something of that country (for Croatia: hrvat/zagreb/split/…,
//       KBC, klinik/bolnic, sveučilišt, or a d.o.o.; elsewhere: the country's own name).
// Deliberately conservative in the PASS direction — any single signal suffices (a diaspora
// Croat on gmail passes via the name; a foreign postdoc at KBC Zagreb via domain/institution).
// The HOLD needs zero corroboration AND a free-mail domain: an unrecognized corporate domain
// alone never holds anyone.

const FREE_MAIL_DOMAINS = new Set([
    'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'yahoo.fr', 'yahoo.de', 'ymail.com',
    'hotmail.com', 'hotmail.co.uk', 'hotmail.fr', 'hotmail.de', 'outlook.com', 'outlook.de',
    'live.com', 'live.co.uk', 'msn.com', 'proton.me', 'protonmail.com', 'pm.me', 'aol.com',
    'mail.ru', 'inbox.ru', 'list.ru', 'bk.ru', 'yandex.ru', 'yandex.com', 'icloud.com', 'me.com',
    'mac.com', 'gmx.com', 'gmx.de', 'gmx.net', 'web.de', 'zoho.com', 'mail.com', 'email.com',
    'rediffmail.com', 'qq.com', '163.com', '126.com', 'sina.com', 'naver.com', 'daum.net',
    'rocketmail.com', 'yopmail.com', 'tutanota.com', 'tuta.io', 'hushmail.com', 'fastmail.com'
]);

// ~70 common Croatian given names, diacritics-folded (compare against normalized tokens).
const CROATIAN_GIVEN_NAMES = new Set([
    'ana', 'ivan', 'marija', 'petar', 'josip', 'luka', 'marta', 'domagoj', 'katarina', 'hrvoje',
    'tomislav', 'dubravka', 'ivana', 'marko', 'matej', 'mateo', 'lucija', 'petra', 'karla', 'ante',
    'sime', 'stipe', 'duje', 'frane', 'jure', 'kresimir', 'zvonimir', 'branimir', 'dario', 'davor',
    'drazen', 'goran', 'zoran', 'damir', 'igor', 'vedran', 'vedrana', 'sanja', 'snjezana', 'vesna',
    'jasna', 'mirjana', 'ljiljana', 'zeljka', 'zeljko', 'nikola', 'nikolina', 'antonija', 'tena',
    'maja', 'iva', 'lana', 'ema', 'lovro', 'borna', 'jakov', 'filip', 'karlo', 'bruno', 'bartol',
    'matija', 'mislav', 'vjekoslav', 'slaven', 'stjepan', 'blaz', 'klara', 'dora', 'lea',
    'anamarija', 'gabrijela', 'ines', 'jelena', 'kristina', 'kristijan', 'tihana', 'tihomir',
    'zrinka', 'vlatka', 'vlatko', 'ozren', 'vanja', 'boris', 'miro', 'miroslav', 'dinko', 'niko'
]);

const foldText = s => String(s == null ? '' : s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd').replace(/ß/g, 'ss')
    .toLowerCase();

function emailDomain(email) {
    const m = /@([^@\s>]+)$/.exec(String(email || '').trim().toLowerCase());
    return m ? m[1].replace(/\.+$/, '') : '';
}

function isFreeMailDomain(domain) {
    return FREE_MAIL_DOMAINS.has(String(domain || '').toLowerCase());
}

function isInstitutionalDomain(domain) {
    const d = foldText(domain);
    if (!d) return false;
    const labels = d.split('.');
    if (labels.some((p, i) => i > 0 && (p === 'edu' || p === 'gov' || p === 'ac' || p === 'mil'))) return true;
    return /(universit|univerz|sveucilist|hospital|clinic|klinik|bolnic|institut|academy|akademi|college|faculty|fakultet|school|medizin|medical|health|research)/.test(d);
}

function croatianNameSignal(name) {
    if (/[čćžšđČĆŽŠĐ]/.test(String(name || ''))) return true;            // typed with diacritics
    const tokens = foldText(name).split(/[^a-z]+/).filter(Boolean);
    if (!tokens.length) return false;
    if (tokens.some(t => CROATIAN_GIVEN_NAMES.has(t))) return true;
    const last = tokens[tokens.length - 1];
    return last.length >= 4 && /(ic|ovic|evic|ek|ac)$/.test(last);       // -ić/-ović/-ek/-ac, ASCII too
}

function institutionCountrySignal(institution, code) {
    const inst = foldText(institution).replace(/[^a-z]+/g, ' ').trim();
    if (!inst) return false;
    if (code === 'hr') {
        if (/(hrvat|zagreb|split|rijeka|osijek|klinik|bolnic|kbc|sveucilist)/.test(inst)) return true;
        if (/\bd o o$/.test(inst)) return true;                          // '… d.o.o.'
    }
    // Generic: the institution literally names the claimed country ('University of Zagreb,
    // Croatia', 'Charité Berlin, Germany', …). Short codes (us/uk/sad/bih…) are skipped.
    return (SAFE_COUNTRY_VARIANTS[code] || []).some(v => v.length >= 4 && inst.includes(v));
}

/**
 * true → the SAFE-country claim is uncorroborated (no aligning signal) AND the email is a
 * free-mail address → hold for review ('Claimed country does not match name/email/institution').
 * Countries outside the safe list never reach this — the plain country gate holds them first.
 */
function coherenceHold({ country, name, email, institution }) {
    const code = countryCode(country);
    if (!code) return false;                                             // not a safe claim → other gate
    const domain = emailDomain(email);
    if (domain) {
        if (domain === code || domain.endsWith('.' + code)) return false;    // ccTLD matches the claim
        if (isInstitutionalDomain(domain)) return false;                     // institutional address
    }
    if (code === 'hr' && croatianNameSignal(name)) return false;             // name reads Croatian
    if (institutionCountrySignal(institution, code)) return false;           // institution names the country
    return isFreeMailDomain(domain);                                     // zero corroboration: hold only on free-mail
}

// ---------------------------------------------------------------- institutional-email vetting
// For the "ask for institutional confirmation" flow: the registrant must confirm from a
// NON-consumer address. Free-mail and obviously-disposable domains are rejected; everything
// else is accepted (and recorded) — the point is provenance, not a whitelist.
const DISPOSABLE_TOKENS = /(mailinator|guerrilla|10minute|tempmail|temp mail|temp-mail|trashmail|sharklasers|getnada|maildrop|dispostable|fakeinbox|minuteinbox|yopmail|dropmail|burnermail|mohmal|mintemail|throwawaymail|spamgourmet|mailcatch|emailondeck)/;
const FREE_MAIL_BRANDS = new Set(['gmail', 'googlemail', 'yahoo', 'ymail', 'rocketmail', 'hotmail',
    'outlook', 'live', 'msn', 'proton', 'protonmail', 'aol', 'icloud', 'gmx', 'yandex', 'qq',
    '163', '126', 'sina', 'naver', 'daum', 'zoho', 'rediffmail', 'tutanota', 'tuta', 'hushmail',
    'fastmail', 'inbox', 'seznam', 'wp', 'op', 'interia', 'libero', 'laposte', 'orange', 'wanadoo',
    'freemail', 'citromail', 'abv', 'centrum', 'atlas', 'volja', 'net']);

/** { ok: true, domain } or { ok: false, reason } — server-side vetting of the claimed institutional address. */
function checkInstitutionalEmail(email) {
    const e = String(email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return { ok: false, reason: 'Please enter a valid email address.' };
    const domain = emailDomain(e);
    const labels = domain.split('.');
    const consumer = isFreeMailDomain(domain)
        || (FREE_MAIL_BRANDS.has(labels[0]) && labels.length <= 3 && !isInstitutionalDomain(domain));
    if (consumer) return { ok: false, reason: 'That looks like a personal email address — please use your institutional address (university, hospital, institute or company).' };
    if (DISPOSABLE_TOKENS.test(domain)) return { ok: false, reason: 'That email domain cannot be used for confirmation — please use your institutional address.' };
    return { ok: true, domain };
}

// ---------------------------------------------------------------- notes markers (verify state)
// The verification flow keeps NO in-memory state: everything derives from the HMAC tokens plus
// notes markers on the row itself, so a pending ask survives restarts and redeploys.
//   'VERIFY-REQUESTED <iso>'          — the ask email went to the registrant at <iso>
//   'VERIFY-SENT <email> <iso>'       — the confirm email went to that institutional address
//   'verified via <email>'            — the institutional confirmation completed
const MARKER_SEP = ' | ';

function getMarker(notes, key) {
    const seg = String(notes || '').split(MARKER_SEP).find(s => s.startsWith(key + ' '));
    return seg ? seg.slice(key.length + 1).trim() : null;
}

function upsertMarker(notes, key, value) {
    const segs = String(notes || '').split(MARKER_SEP).filter(s => s.trim() && !s.startsWith(key + ' '));
    segs.push(key + ' ' + value);
    return segs.join(MARKER_SEP);
}

const markerAgeMs = iso => { const t = Date.parse(iso || ''); return isNaN(t) ? Infinity : Date.now() - t; };
const VERIFY_RESEND_MS = 10 * 60 * 1000;                                 // one outgoing email / row / 10 min

// ---------------------------------------------------------------- approve/reject tokens
// token = HMAC-SHA256(JWT_SECRET, 'medxrev:' + table + ':' + id).hex.slice(0,32) + '.' + table + '.' + id
// Possession = authorization (the token travels only inside Alen's review email).
const REVIEW_TABLES = ['bridges_registrations', 'croatians_abroad_registrations'];

const reviewSig = (secret, table, id) => crypto.createHmac('sha256', String(secret))
    .update('medxrev:' + String(table) + ':' + String(id)).digest('hex').slice(0, 32);

function reviewToken(secret, table, id) {
    if (!REVIEW_TABLES.includes(table)) throw new Error('review token: unknown table ' + table);
    return reviewSig(secret, table, id) + '.' + table + '.' + String(id);
}

function verifyReviewToken(secret, token) {
    const m = /^([0-9a-f]{32})\.(bridges_registrations|croatians_abroad_registrations)\.([0-9a-fA-F-]{16,64})$/
        .exec(String(token || ''));
    if (!m) return null;
    const expect = reviewSig(secret, m[2], m[3]);
    if (!crypto.timingSafeEqual(Buffer.from(m[1]), Buffer.from(expect))) return null;
    return { table: m[2], id: m[3] };
}

function reviewUrls(secret, table, id) {
    const t = reviewToken(secret, table, id);
    return {
        approveUrl: `${baseUrl()}/api/review/${t}/approve`,
        rejectUrl: `${baseUrl()}/api/review/${t}/reject`,
        verifyUrl: `${baseUrl()}/api/review/${t}/verify`
    };
}

// Registrant-facing verification tokens — separate HMAC contexts so a review token can never
// be replayed as a verification link (or vice versa):
//   vtoken  = HMAC('medxver:'  + table + ':' + id).slice(0,32) + '.' + table + '.' + id
//   sig2    = HMAC('medxver2:' + table + ':' + id + ':' + lower(instEmail)).slice(0,32)
// sig2 travels only inside the email sent TO the institutional address, so a confirming click
// proves access to that inbox.
const verifySig = (secret, table, id) => crypto.createHmac('sha256', String(secret))
    .update('medxver:' + String(table) + ':' + String(id)).digest('hex').slice(0, 32);

function verifyPageToken(secret, table, id) {
    if (!REVIEW_TABLES.includes(table)) throw new Error('verify token: unknown table ' + table);
    return verifySig(secret, table, id) + '.' + table + '.' + String(id);
}

function parseVerifyPageToken(secret, token) {
    const m = /^([0-9a-f]{32})\.(bridges_registrations|croatians_abroad_registrations)\.([0-9a-fA-F-]{16,64})$/
        .exec(String(token || ''));
    if (!m) return null;
    const expect = verifySig(secret, m[2], m[3]);
    if (!crypto.timingSafeEqual(Buffer.from(m[1]), Buffer.from(expect))) return null;
    return { table: m[2], id: m[3] };
}

const instConfirmSig = (secret, table, id, instEmail) => crypto.createHmac('sha256', String(secret))
    .update('medxver2:' + String(table) + ':' + String(id) + ':' + String(instEmail || '').trim().toLowerCase())
    .digest('hex').slice(0, 32);

// ---------------------------------------------------------------- the review email (to Alen)
// Built on the house v2 shell (ink header + wordmark, gold rule, cream body, Fraunces
// headline, light color-scheme metas so dark-mode clients don't invert it). Every submitted
// field is shown VERBATIM (escaped) so machine-generated garbage is visible at a glance.
function buildReviewEmail({ kind, fields, reason, approveUrl, rejectUrl, verifyUrl }) {
    const T = tpl.T;
    const rows = Object.entries(fields || {}).map(([label, value], i) => {
        const v = String(value == null ? '' : value).trim();
        const sep = i ? `border-top:1px solid ${T.hairline};` : '';
        return `<tr>
          <td class="em-goldlab em-hair" style="${sep}padding:11px 18px 11px 0;font-family:${T.sans};font-weight:600;font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:${T.goldDark};vertical-align:top;white-space:nowrap;">${esc(label)}</td>
          <td class="em-ink em-hair" style="${sep}padding:11px 0;font-family:${T.sans};font-size:13.5px;line-height:1.55;color:${T.ink};word-break:break-word;">${v ? esc(v) : `<span class="em-soft" style="color:${T.soft};">&mdash;</span>`}</td>
        </tr>`;
    }).join('\n');
    const W = 'width:320px;max-width:100%;padding-left:0;padding-right:0;text-align:center;box-sizing:border-box;white-space:normal;line-height:1.5;';
    const action = (html, caption) => `
        <tr><td align="center" style="padding-top:16px;">${html}</td></tr>
        <tr><td align="center" class="em-soft" style="padding-top:6px;font-family:${T.sans};font-size:11px;line-height:1.55;color:${T.soft};">${caption}</td></tr>`;
    const bodyHtml = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:36px 40px 32px;">
      <div class="em-goldlab" style="font-family:${T.sans};font-weight:600;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:${T.goldDark};">Held for your review</div>
      <div class="em-ink" style="font-family:${T.serif};font-weight:500;font-size:29px;line-height:1.15;letter-spacing:-.01em;color:${T.ink};margin-top:10px;">A registration needs your review</div>
      <div class="em-soft" style="font-family:${T.sans};font-size:13.5px;line-height:1.65;color:${T.soft};margin-top:14px;">A new submission on the <b class="em-ink" style="color:${T.ink};">${esc(kind)}</b> was held. The registrant has received <b class="em-ink" style="color:${T.ink};">nothing</b> — no confirmation, QR, wallet pass or sheet row — until you decide.</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;"><tr>
        <td class="em-reason" style="background:rgba(155,27,34,.06);border-left:3px solid ${T.crimson};padding:12px 16px;">
          <span style="font-family:${T.sans};font-weight:600;font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:${T.crimson};">Reason&nbsp;&nbsp;</span>
          <span class="em-ink" style="font-family:${T.sans};font-size:13px;color:${T.ink};">${esc(reason)}</span>
        </td>
      </tr></table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="em-fact" style="margin-top:18px;background:${T.cardCream};border:1px solid ${T.hairline};"><tr><td style="padding:8px 20px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
${rows}
        </table>
      </td></tr></table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;">
        ${action(tpl.btn('Approve', approveUrl, 'solid', W), 'Releases the registration — standard confirmation, ticket and sheet row.')}
        ${verifyUrl ? action(tpl.btn('Ask for institutional confirmation', verifyUrl, 'gold', W + 'font-size:10px;letter-spacing:.12em;'), 'They confirm from an institutional inbox — success issues tickets automatically and you get a one&#8209;line FYI.') : ''}
        ${action(tpl.btn('Reject', rejectUrl, 'ghost', W + '" class="em-ghost'), 'Cancels quietly — the registrant is never notified.')}
      </table>
      <div class="em-soft em-hair" style="margin-top:24px;padding-top:14px;border-top:1px solid ${T.hairline};font-family:${T.sans};font-size:11px;line-height:1.7;color:${T.soft};">Safe to click twice — each decision is applied once. This email was sent only to you.</div>
    </td></tr></table>`;
    return tpl.shell({
        darkReady: true,
        title: 'Registration review — Med&X',
        preheader: 'Held before anything was issued — approve, reject, or ask for institutional confirmation.',
        headerRightLabel: 'REGISTRATION REVIEW',
        rule: 'gold',
        bodyHtml,
        footerItems: [`© Med&amp;X ${new Date().getFullYear()} · Split, Croatia`, 'Review gate · sent only to the organizer']
    });
}

// ---------------------------------------------------------------- result pages (browser)
function resultPage(title, headline, proseHtml, accent) {
    const chip = accent === 'reject' ? '#8f2d2a' : accent === 'approve' ? '#2f6e3a' : '#b0893b';
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)} · Med&amp;X</title><meta name="robots" content="noindex, nofollow">
<style>
body{margin:0;min-height:100vh;background:#efe7d6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#2c2521;}
main{max-width:560px;margin:0 auto;padding:56px 18px;}
.sheet{background:#fbf8f1;border:1px solid rgba(43,33,25,.09);border-radius:16px;padding:34px 32px;box-shadow:0 24px 60px -30px rgba(43,33,25,.34);}
.kicker{font-size:10.5px;font-weight:600;letter-spacing:2.6px;text-transform:uppercase;color:#b0893b;margin:0 0 14px;}
h1{font-family:Georgia,'Times New Roman',serif;font-weight:500;font-size:27px;letter-spacing:-.3px;color:#211b17;margin:0 0 8px;}
.bar{width:38px;height:2px;background:${chip};margin:14px 0 16px;border-radius:2px;}
p{font-size:14.5px;line-height:1.7;color:#4a4139;margin:0 0 10px;}
.fine{margin-top:16px;padding-top:14px;border-top:1px solid rgba(43,33,25,.08);font-size:12px;color:#8a7d70;line-height:1.7;}
</style></head><body><main><div class="sheet">
<p class="kicker">Med&amp;X &middot; Registration review</p>
<h1>${headline}</h1><div class="bar"></div>
<p>${proseHtml}</p>
<p class="fine">You can close this tab. Med&amp;X registration review gate.</p>
</div></main></body></html>`;
}

function notFoundPage() {
    return resultPage('Not found', 'Nothing here.',
        'There is no review at this address. The link may be incomplete or mistyped &mdash; every character matters. Open the exact link from the review email.');
}

// ---------------------------------------------------------------- registrant-facing pages
// Same house language, but the kicker never says "review" — these pages are seen by guests.
function guestPage(title, headline, proseHtml, accent, extraHtml) {
    const chip = accent === 'ok' ? '#2f6e3a' : '#b0893b';
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)} · Med&amp;X</title><meta name="robots" content="noindex, nofollow">
<style>
body{margin:0;min-height:100vh;background:#efe7d6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#2c2521;}
main{max-width:560px;margin:0 auto;padding:56px 18px;}
.sheet{background:#fbf8f1;border:1px solid rgba(43,33,25,.09);border-radius:16px;padding:34px 32px;box-shadow:0 24px 60px -30px rgba(43,33,25,.34);}
.kicker{font-size:10.5px;font-weight:600;letter-spacing:2.6px;text-transform:uppercase;color:#b0893b;margin:0 0 14px;}
h1{font-family:Georgia,'Times New Roman',serif;font-weight:500;font-size:27px;letter-spacing:-.3px;color:#211b17;margin:0 0 8px;}
.bar{width:38px;height:2px;background:${chip};margin:14px 0 16px;border-radius:2px;}
p{font-size:14.5px;line-height:1.7;color:#4a4139;margin:0 0 10px;}
label{display:block;font-size:10.5px;font-weight:600;letter-spacing:1.8px;text-transform:uppercase;color:#6f6256;margin:18px 0 7px;}
input[type=email]{width:100%;box-sizing:border-box;padding:13px 14px;border:1px solid rgba(43,33,25,.18);border-radius:11px;background:#fff;color:#241d18;font-size:16px;font-family:inherit;}
input:focus{outline:none;border-color:#b0893b;box-shadow:0 0 0 3px rgba(176,137,59,.14);}
.btn{display:block;width:100%;margin-top:16px;padding:15px;border:none;border-radius:11px;cursor:pointer;font-family:inherit;font-size:14px;font-weight:600;letter-spacing:.2px;color:#fbf3e6;background:linear-gradient(180deg,#a03330,#8f2d2a);}
.btn:disabled{opacity:.55;cursor:not-allowed;}
.err{display:none;margin-top:12px;padding:11px 13px;border-radius:10px;background:rgba(143,45,42,.08);border:1px solid rgba(143,45,42,.3);color:#7c2320;font-size:13px;line-height:1.55;}
.okbox{display:none;margin-top:12px;padding:11px 13px;border-radius:10px;background:rgba(47,110,58,.09);border:1px solid rgba(47,110,58,.3);color:#2f6e3a;font-size:13.5px;line-height:1.55;}
.fine{margin-top:16px;padding-top:14px;border-top:1px solid rgba(43,33,25,.08);font-size:12px;color:#8a7d70;line-height:1.7;}
</style></head><body><main><div class="sheet">
<p class="kicker">Med&amp;X</p>
<h1>${headline}</h1><div class="bar"></div>
${proseHtml}
${extraHtml || ''}
<p class="fine">Questions? Laura Rodman (laura.rodman@medx.hr).</p>
</div></main></body></html>`;
}

function guestLinkNotRightPage() {
    return guestPage('This link is not quite right', 'This link is not quite right.',
        '<p>The link you opened is incomplete or has been mistyped &mdash; links are personal, so every character matters. Please open the exact link from your email (copy &amp; paste is safest).</p>');
}

function guestLinkInactivePage() {
    return guestPage('Link no longer active', 'This link is no longer active.',
        '<p>This confirmation link is not active any more. If you believe this is a mistake, just reply to the email you received and we will sort it out.</p>');
}

function guestAlmostDonePage() {
    return guestPage('All set — thank you', 'All set — thank you.',
        '<p>Your confirmation went through. We are finalizing your registration and <b>your ticket will follow by email</b> shortly.</p>', 'ok');
}

function guestConfirmedPage(instEmail) {
    const where = instEmail ? 'to <b>' + esc(instEmail) + '</b>' : 'to the email address you registered with';
    return guestPage('You are confirmed', 'You are confirmed.',
        '<p>Thank you &mdash; your registration is confirmed and <b>your ticket is on its way</b> ' + where + '. We look forward to welcoming you.</p>', 'ok');
}

function verifyFormPage(vtoken, firstName) {
    const hello = firstName ? esc(firstName) + ', one' : 'One';
    return guestPage('Confirm your registration', 'Confirm your registration.',
        `<p>${hello} quick step: to complete your registration, please confirm it from your <b>institutional email address</b> (university, hospital, institute or company) &mdash; we will send a confirmation link there.</p>`,
        undefined,
        `<form id="vform" novalidate>
  <label for="v_email">Your institutional email</label>
  <input type="email" id="v_email" name="email" autocomplete="email" placeholder="you@institution.edu" required>
  <button type="submit" class="btn" id="v_btn">Send confirmation link</button>
  <div class="err" id="v_err"></div>
  <div class="okbox" id="v_ok">Sent &mdash; please open your institutional inbox (check spam too) and click the confirmation button there.</div>
</form>
<script>
(function(){
  var f=document.getElementById('vform'),b=document.getElementById('v_btn'),e=document.getElementById('v_err'),ok=document.getElementById('v_ok');
  f.addEventListener('submit',function(ev){
    ev.preventDefault();e.style.display='none';
    var em=document.getElementById('v_email').value.trim();
    if(!em){e.textContent='Please enter your institutional email address.';e.style.display='block';return;}
    b.disabled=true;b.textContent='Sending\\u2026';
    fetch('/verify-registration/${vtoken}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:em})})
    .then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};});})
    .then(function(res){
      if(res.ok&&res.j.success){ok.style.display='block';b.textContent='Sent \\u2713';}
      else{e.textContent=(res.j&&res.j.error)||'That did not go through. Please try again.';e.style.display='block';b.disabled=false;b.textContent='Send confirmation link';}
    })
    .catch(function(){e.textContent='We could not reach the server. Please try again.';e.style.display='block';b.disabled=false;b.textContent='Send confirmation link';});
  });
})();
</script>`);
}

// ---------------------------------------------------------------- registrant-facing emails
// Polite and unsuspicious — a legitimate guest reads a routine "one more step"; the emails
// never mention review, holds or fraud.
function emailShell(headline, bodyHtml, buttonLabel, buttonUrl, opts) {
    const T = tpl.T;
    const o = opts || {};
    const factsHtml = (o.facts && o.facts.length) ? `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="em-fact" style="margin-top:18px;background:${T.cardCream};border:1px solid ${T.hairline};"><tr><td style="padding:8px 20px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        ${o.facts.map(([label, value], i) => {
            const sep = i ? `border-top:1px solid ${T.hairline};` : '';
            return `<tr>
              <td class="em-goldlab em-hair" style="${sep}padding:10px 18px 10px 0;font-family:${T.sans};font-weight:600;font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:${T.goldDark};vertical-align:top;white-space:nowrap;">${esc(label)}</td>
              <td class="em-ink em-hair" style="${sep}padding:10px 0;font-family:${T.sans};font-size:13.5px;line-height:1.55;color:${T.ink};word-break:break-word;">${esc(value)}</td>
            </tr>`;
        }).join('\n')}
        </table>
      </td></tr></table>` : '';
    const noteHtml = o.footNote ? `<div class="em-soft" style="font-family:${T.sans};font-size:12px;line-height:1.65;color:${T.soft};margin-top:14px;">${o.footNote}</div>` : '';
    const body = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:36px 40px 32px;">
      <div class="em-goldlab" style="font-family:${T.sans};font-weight:600;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:${T.goldDark};">${o.eyebrow || 'Your registration'}</div>
      <div class="em-ink" style="font-family:${T.serif};font-weight:500;font-size:27px;line-height:1.18;letter-spacing:-.01em;color:${T.ink};margin-top:10px;">${headline}</div>
      <div class="em-soft" style="font-family:${T.sans};font-size:14px;line-height:1.7;color:${T.soft};margin-top:16px;">${bodyHtml}</div>${factsHtml}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding-top:24px;">${tpl.btn(buttonLabel, buttonUrl, 'solid', 'width:300px;max-width:100%;padding-left:0;padding-right:0;text-align:center;box-sizing:border-box;')}</td></tr></table>${noteHtml}
      <div class="em-soft em-hair" style="margin-top:24px;padding-top:14px;border-top:1px solid ${T.hairline};font-family:${T.sans};font-size:11.5px;line-height:1.7;color:${T.soft};">Questions? Just reply to this email — or write to Laura Rodman at laura.rodman@medx.hr.</div>
    </td></tr></table>`;
    return tpl.shell({
        darkReady: true,
        title: headline + ' — Med&X',
        preheader: o.preheader || '',
        headerRightLabel: 'REGISTRATION',
        rule: 'crimson',
        bodyHtml: body
    });
}

function buildVerifyAskEmail({ firstName, confirmUrl, eventLabel }) {
    const forEvent = eventLabel ? ` for <b class="em-ink">${esc(eventLabel)}</b>` : '';
    return emailShell('One more step — confirm your registration',
        `<p style="margin:0 0 10px;">Dear ${esc(firstName || 'guest')},</p>
         <p style="margin:0 0 10px;">Thank you for registering${forEvent} — we are delighted you will be joining us.</p>
         <p style="margin:0;">To complete your registration, please confirm it from your <b>institutional email address</b> (your university, hospital, institute or company). It takes under a minute — and your ticket will be delivered to that address:</p>`,
        'Confirm my registration', confirmUrl,
        { preheader: 'One quick step and your ticket is on its way.' });
}

function buildFyiEmail({ name, instEmail, evidence }) {
    const T = tpl.T;
    const evHtml = (evidence && evidence.length) ? `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="em-fact" style="margin-top:16px;background:${T.cardCream};border:1px solid ${T.hairline};"><tr><td style="padding:6px 20px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        ${evidence.map(([label, value], i) => {
            const sep = i ? `border-top:1px solid ${T.hairline};` : '';
            return `<tr>
              <td class="em-goldlab em-hair" style="${sep}padding:9px 18px 9px 0;font-family:${T.sans};font-weight:600;font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:${T.goldDark};vertical-align:top;white-space:nowrap;">${esc(label)}</td>
              <td class="em-ink em-hair" style="${sep}padding:9px 0;font-family:${T.sans};font-size:13px;line-height:1.5;color:${T.ink};word-break:break-word;">${esc(value)}</td>
            </tr>`;
        }).join('')}
        </table>
      </td></tr></table>` : '';
    const body = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:32px 40px 30px;">
      <div class="em-goldlab" style="font-family:${T.sans};font-weight:600;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:${T.goldDark};">For your information</div>
      <div class="em-ink" style="font-family:${T.serif};font-weight:500;font-size:26px;line-height:1.2;color:${T.ink};margin-top:10px;">&#10003; Registration confirmed</div>
      <div class="em-soft" style="font-family:${T.sans};font-size:14px;line-height:1.7;color:${T.soft};margin-top:14px;"><b class="em-ink" style="color:${T.ink};">${esc(name)}</b> confirmed from <b class="em-ink" style="color:${T.ink};">${esc(instEmail)}</b>. The ticket was issued automatically to that institutional address — nothing for you to do.</div>${evHtml}
    </td></tr></table>`;
    return tpl.shell({
        darkReady: true,
        title: 'Registration confirmed — Med&X',
        headerRightLabel: 'REGISTRATION REVIEW',
        rule: 'gold',
        bodyHtml: body,
        footerItems: [`© Med&amp;X ${new Date().getFullYear()} · Split, Croatia`, 'Review gate · sent only to the organizer']
    });
}

function buildInstConfirmEmail({ firstName, confirmUrl, eventLabel, name, instEmail }) {
    const ev = eventLabel || 'our event';
    const facts = [];
    if (name) facts.push(['Name', name]);
    facts.push(['Event', ev]);
    if (instEmail) facts.push(['Ticket goes to', instEmail]);
    return emailShell('Almost there — one click to confirm',
        `<p style="margin:0 0 10px;">Dear ${esc(firstName || 'guest')},</p>
         <p style="margin:0 0 10px;">We are happy to have you at <b class="em-ink">${esc(ev)}</b>.</p>
         <p style="margin:0;">Confirming from this address completes your registration — your ticket will arrive right here, moments later.</p>`,
        'Confirm my registration', confirmUrl,
        { facts,
          preheader: 'Confirm your registration — your ticket follows to this address.',
          footNote: 'If this wasn&#39;t you, simply ignore this email — nothing will be issued.' });
}

// ---------------------------------------------------------------- company-domain intelligence
// Inbox control proves a person can read mail at a domain — not that the "company" is real
// (a fraud domain costs $10 and five minutes). Tiers, per Alen 2026-09-06:
//   academic/hospital-style domains  → trusted, auto-issue (hard to fake).
//   corporate domains                → free background check: RDAP registration age,
//                                      website liveness, name match vs the claimed
//                                      institution. Clean → auto-issue (FYI carries the
//                                      evidence). Shaky → NO auto-issue: Alen gets the
//                                      findings with Approve/Reject; the guest sees a warm
//                                      "your ticket will follow" page and learns nothing.
const ACADEMIC_DOMAIN_RE = /\.(edu|gov|mil|int)$|\.(edu|ac|gov|gouv|nhs|uni)\.[a-z]{2,3}$/i;
const ACADEMIC_HINT_RE = /(univ|uni-|college|hospital|klinik|clinic|kbc-|bolnica|institut|academy|akadem|fakultet|charite|helmholtz|max-planck|mpg\.de|cnrs|inserm|pasteur|salk|scripps|broadinstitute|dana-farber|mskcc|mayo|clevelandclinic|hopkinsmedicine|mgb|partners)/i;

function isAcademicishDomain(domain) {
    const d = String(domain || '').toLowerCase().trim();
    return !!d && (ACADEMIC_DOMAIN_RE.test(d) || ACADEMIC_HINT_RE.test(d));
}

// Does the claimed institution plausibly own this domain? Token containment both ways,
// plus an acronym check ("Boston Medical Consulting" ↔ bmc.com).
function institutionNameMatch(institution, domain) {
    const core = String(domain || '').toLowerCase().split('.').slice(0, -1).join('');   // labels minus TLD
    const inst = String(institution || '').toLowerCase()
        .replace(/\b(llc|inc|ltd|gmbh|corp|co|doo|d\.o\.o|sa|ag|plc|kg|bv|oy|ab)\b\.?/g, ' ')
        .replace(/[^a-z0-9]+/g, ' ').trim();
    if (!core || !inst) return false;
    const tokens = inst.split(' ').filter(t => t.length >= 4);
    const squashed = inst.replace(/ /g, '');
    if (tokens.some(t => core.includes(t))) return true;
    if (core.length >= 4 && squashed.includes(core)) return true;
    const acronym = inst.split(' ').filter(Boolean).map(w => w[0]).join('');
    if (acronym.length >= 3 && core === acronym) return true;
    return false;
}

async function fetchWithTimeout(url, ms, opts) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try { return await fetch(url, Object.assign({ signal: ctrl.signal, redirect: 'follow' }, opts || {})); }
    finally { clearTimeout(t); }
}

// RDAP (free, no key): IANA bootstrap maps the TLD to its registry's RDAP base, then
// <base>/domain/<name> yields the registration date → age in days. null = could not verify
// (registry without RDAP — e.g. .hr — timeout, parse trouble): treated as "unverified",
// never as young. The bootstrap is cached in-process for a day. (rdap.org itself 403s
// automated callers, so we go straight to the registries the way it would have.)
let RDAP_BOOTSTRAP = { at: 0, map: null };
async function rdapBaseForTld(tld) {
    if (!RDAP_BOOTSTRAP.map || Date.now() - RDAP_BOOTSTRAP.at > 86400000) {
        const r = await fetchWithTimeout('https://data.iana.org/rdap/dns.json', 6000);
        if (!r.ok) throw new Error('rdap bootstrap ' + r.status);
        const j = await r.json();
        const map = {};
        for (const [tlds, urls] of (j.services || [])) {
            for (const t of tlds) map[t.toLowerCase()] = urls[0];
        }
        RDAP_BOOTSTRAP = { at: Date.now(), map };
    }
    return RDAP_BOOTSTRAP.map[tld] || null;
}
async function rdapDomainAgeDays(domain) {
    try {
        const tld = String(domain).toLowerCase().split('.').pop();
        const base = await rdapBaseForTld(tld);
        if (!base) return null;
        const r = await fetchWithTimeout(base.replace(/\/+$/, '') + '/domain/' + encodeURIComponent(domain), 6000,
            { headers: { Accept: 'application/rdap+json' } });
        if (!r.ok) return null;
        const j = await r.json();
        const ev = (j.events || []).find(e => e.eventAction === 'registration');
        if (!ev || !ev.eventDate) return null;
        const days = (Date.now() - Date.parse(ev.eventDate)) / 86400000;
        return Number.isFinite(days) ? days : null;
    } catch { return null; }
}

async function websiteAlive(domain) {
    for (const host of [domain, 'www.' + domain]) {
        try {
            const r = await fetchWithTimeout('https://' + host, 6000, { method: 'GET' });
            if (r.status < 500) return true;
        } catch { /* try next */ }
    }
    return false;
}

// Pure verdict combiner (unit-tested). Clean corporate = verified age >= 1 year AND a live
// website AND a name match. Anything less goes to Alen with the reasons spelled out.
function domainVerdict({ academic, ageDays, alive, nameMatch }) {
    if (academic) return { pass: true, tier: 'academic', reasons: [] };
    const reasons = [];
    if (ageDays == null) reasons.push('the domain\u2019s registration age could not be verified');
    else if (ageDays < 365) reasons.push('the domain was registered only ' + Math.max(1, Math.round(ageDays)) + ' days ago');
    if (!alive) reasons.push('no website answers at the domain');
    if (!nameMatch) reasons.push('the domain does not match the claimed institution');
    return { pass: reasons.length === 0, tier: 'corporate', reasons };
}

const fmtAge = d => d == null ? 'unverified' : d >= 365 ? (d / 365).toFixed(1) + ' years' : Math.max(1, Math.round(d)) + ' days';

// The full check → verdict + human-readable evidence rows for the FYI / review email.
async function checkCompanyDomain(domain, institution) {
    const d = String(domain || '').toLowerCase().trim();
    if (isAcademicishDomain(d)) {
        return { pass: true, tier: 'academic', reasons: [],
            evidence: [['Domain', d + ' — academic/hospital, auto-trusted']] };
    }
    const [ageDays, alive] = await Promise.all([rdapDomainAgeDays(d), websiteAlive(d)]);
    const nameMatch = institutionNameMatch(institution, d);
    const v = domainVerdict({ academic: false, ageDays, alive, nameMatch });
    v.evidence = [
        ['Domain', d],
        ['Registered', fmtAge(ageDays) + (ageDays != null && ageDays < 365 ? ' ago \u26a0' : ageDays == null ? ' \u26a0' : ' ago')],
        ['Website', alive ? 'live' : 'not reachable \u26a0'],
        ['Matches institution', nameMatch ? 'yes' : 'no \u26a0']
    ];
    return v;
}

// ---------------------------------------------------------------- routes + handler registry
// Handlers are registered per table by the module that owns that flow. Contract:
//   {
//     approve:  async(id) => outcome,        // release: statuses + standard confirmation + sheet
//     reject:   async(id) => outcome,        // cancel quietly
//     getRow:   (id) => { id, name, email, notes, state } | null,   // state: pending|approved|rejected
//     setNotes: (id, notes) => void          // persist updated notes markers (must flush)
//   }
//   outcome = { status: 'done'|'already'|'notfound', headline?, message? }
// 'already' is the idempotent case (a decision was applied earlier — nothing re-sent).
// getRow/setNotes power the institutional-confirmation flow; approve/reject alone still work.
const HANDLERS = new Map();

function registerReviewHandlers(table, handlers) {
    if (!REVIEW_TABLES.includes(table)) throw new Error('review handlers: unknown table ' + table);
    HANDLERS.set(table, handlers);
}

function mountReviewRoutes(app, deps = {}) {
    const secret = deps.JWT_SECRET || process.env.JWT_SECRET || 'medx-dev-secret';
    const sendEmail = typeof deps.sendEmail === 'function'
        ? deps.sendEmail
        : async () => { throw new Error('review-gate: no sendEmail dep — verification emails cannot be sent'); };

    const act = action => async (req, res) => {
        try {
            const parsed = verifyReviewToken(secret, req.params.token);
            if (!parsed) return res.status(404).send(notFoundPage());
            const h = HANDLERS.get(parsed.table);
            if (!h || typeof h[action] !== 'function') {
                console.error(`[ReviewGate] no ${action} handler registered for ${parsed.table}`);
                return res.status(404).send(notFoundPage());
            }
            const out = await h[action](parsed.id) || {};
            if (out.status === 'notfound') return res.status(404).send(notFoundPage());
            const fallback = action === 'approve'
                ? { headline: 'Approved.', message: 'The registration has been released.' }
                : { headline: 'Rejected.', message: 'The registration has been cancelled. The registrant was not notified.' };
            return res.send(resultPage(
                action === 'approve' ? 'Approved' : 'Rejected',
                esc(out.headline || fallback.headline),
                out.messageHtml || esc(out.message || fallback.message),
                out.status === 'already' ? 'info' : action));
        } catch (e) {
            console.error('[ReviewGate] ' + action + ' failed:', e.message);
            return res.status(500).send(resultPage('Something went wrong', 'One moment, please.',
                'The decision could not be applied just now. Open the same link again in a minute &mdash; it stays valid.'));
        }
    };

    app.get('/api/review/:token/approve', act('approve'));
    app.get('/api/review/:token/reject', act('reject'));

    // -------- third admin action: ask the registrant for an institutional confirmation --------
    // Emails the registrant a polite "one more step" note whose link leads to the public
    // verification page below. State lives in notes markers only (restart-safe); the ask is
    // idempotent and rate-limited to one outgoing email per row per 10 minutes.
    app.get('/api/review/:token/verify', async (req, res) => {
        try {
            const parsed = verifyReviewToken(secret, req.params.token);
            if (!parsed) return res.status(404).send(notFoundPage());
            const h = HANDLERS.get(parsed.table);
            if (!h || typeof h.getRow !== 'function' || typeof h.setNotes !== 'function') {
                console.error(`[ReviewGate] no verify-capable handler registered for ${parsed.table}`);
                return res.status(404).send(notFoundPage());
            }
            const row = h.getRow(parsed.id);
            if (!row) return res.status(404).send(notFoundPage());
            if (row.state === 'approved') {
                return res.send(resultPage('Already approved', 'Already approved.',
                    'This registration was approved earlier &mdash; there is nothing left to confirm, and no request was sent.', 'info'));
            }
            if (row.state === 'rejected') {
                return res.send(resultPage('Already rejected', 'Already rejected.',
                    'This registration was rejected earlier &mdash; no confirmation request was sent. Approve it first if you want to revisit that.', 'info'));
            }
            const asked = getMarker(row.notes, 'VERIFY-REQUESTED');
            if (asked && markerAgeMs(asked) < VERIFY_RESEND_MS) {
                return res.send(resultPage('Confirmation request sent', 'Confirmation request sent.',
                    `The request is already on its way to <b>${esc(row.email)}</b> (sent moments ago &mdash; nothing was re-sent). When they confirm from an institutional address, the registration approves automatically and you get a one-line FYI.`, 'info'));
            }
            const vtoken = verifyPageToken(secret, parsed.table, parsed.id);
            const firstName = String(row.name || '').trim().split(/\s+/)[0] || '';
            await sendEmail(row.email, 'One more step — confirm your registration',
                buildVerifyAskEmail({ firstName, confirmUrl: `${baseUrl()}/verify-registration/${vtoken}`, eventLabel: h.eventLabel }));
            h.setNotes(parsed.id, upsertMarker(row.notes, 'VERIFY-REQUESTED', new Date().toISOString()));
            console.log(`[ReviewGate] institutional confirmation requested for ${parsed.table}/${parsed.id} (${row.email})`);
            return res.send(resultPage('Confirmation request sent', 'Confirmation request sent.',
                `A polite &ldquo;one more step&rdquo; note was emailed to <b>${esc(row.email)}</b>. If they confirm from an institutional address, the registration approves automatically &mdash; tickets go out and you get a one-line FYI. Approve and Reject in your review email keep working meanwhile.`, 'approve'));
        } catch (e) {
            console.error('[ReviewGate] verify request failed:', e.message);
            return res.status(500).send(resultPage('Something went wrong', 'One moment, please.',
                'The request could not be sent just now. Open the same link again in a minute &mdash; it stays valid.'));
        }
    });

    // -------- public: the registrant's verification page + institutional-email submit --------
    app.get('/verify-registration/:vtoken', (req, res) => {
        try {
            res.set('X-Robots-Tag', 'noindex, nofollow');
            const parsed = parseVerifyPageToken(secret, req.params.vtoken);
            const h = parsed && HANDLERS.get(parsed.table);
            const row = h && typeof h.getRow === 'function' ? h.getRow(parsed.id) : null;
            if (!row) return res.status(404).send(guestLinkNotRightPage());
            if (row.state === 'approved') return res.send(guestConfirmedPage());
            if (row.state === 'rejected') return res.status(410).send(guestLinkInactivePage());
            const firstName = String(row.name || '').trim().split(/\s+/)[0] || '';
            return res.send(verifyFormPage(String(req.params.vtoken), firstName));
        } catch (e) {
            console.error('[ReviewGate] verify page failed:', e.message);
            return res.status(500).send(guestLinkNotRightPage());
        }
    });

    app.post('/verify-registration/:vtoken', async (req, res) => {
        try {
            const parsed = parseVerifyPageToken(secret, req.params.vtoken);
            const h = parsed && HANDLERS.get(parsed.table);
            const row = h && typeof h.getRow === 'function' ? h.getRow(parsed.id) : null;
            if (!row) return res.status(404).json({ error: 'This link is not valid. Please open the exact link from your email.' });
            if (row.state === 'approved') return res.json({ success: true, already: true });
            if (row.state === 'rejected') return res.status(410).json({ error: 'This link is no longer active.' });
            const check = checkInstitutionalEmail((req.body || {}).email);
            if (!check.ok) return res.status(400).json({ error: check.reason });
            const instEmail = String((req.body || {}).email).trim().toLowerCase();
            const sentVal = getMarker(row.notes, 'VERIFY-SENT');
            if (sentVal && markerAgeMs(sentVal.split(/\s+/)[1]) < VERIFY_RESEND_MS) {
                return res.status(429).json({ error: 'We sent a confirmation email just now — please check that inbox (and its spam folder). You can request another in a few minutes.' });
            }
            const sig2 = instConfirmSig(secret, parsed.table, parsed.id, instEmail);
            const firstName = String(row.name || '').trim().split(/\s+/)[0] || '';
            await sendEmail(instEmail, 'Confirm your registration — Med&X',
                buildInstConfirmEmail({ firstName, confirmUrl: `${baseUrl()}/verify-registration/${req.params.vtoken}/confirm/${sig2}`, eventLabel: h.eventLabel, name: row.name, instEmail }));
            h.setNotes(parsed.id, upsertMarker(row.notes, 'VERIFY-SENT', instEmail + ' ' + new Date().toISOString()));
            console.log(`[ReviewGate] institutional confirm email sent for ${parsed.table}/${parsed.id} → ${instEmail} (domain recorded: ${check.domain})`);
            return res.json({ success: true });
        } catch (e) {
            console.error('[ReviewGate] institutional email submit failed:', e.message);
            return res.status(500).json({ error: 'That did not go through. Please try again in a moment.' });
        }
    });

    // -------- public: the click from the institutional inbox — proves access, auto-approves --------
    app.get('/verify-registration/:vtoken/confirm/:sig2', async (req, res) => {
        try {
            const parsed = parseVerifyPageToken(secret, req.params.vtoken);
            const h = parsed && HANDLERS.get(parsed.table);
            const row = h && typeof h.getRow === 'function' ? h.getRow(parsed.id) : null;
            if (!row) return res.status(404).send(guestLinkNotRightPage());
            if (row.state === 'approved') return res.send(guestConfirmedPage(row.email));  // idempotent
            if (row.state === 'rejected') return res.status(410).send(guestLinkInactivePage());
            const sentVal = getMarker(row.notes, 'VERIFY-SENT');
            if (!sentVal) return res.status(404).send(guestLinkNotRightPage());
            const instEmail = sentVal.split(/\s+/)[0];
            const given = String(req.params.sig2 || '');
            const expect = instConfirmSig(secret, parsed.table, parsed.id, instEmail);
            if (!/^[0-9a-f]{32}$/.test(given) || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expect))) {
                return res.status(404).send(guestLinkNotRightPage());
            }
            // Already flagged for Alen on an earlier click — re-show the friendly page, re-send nothing.
            if (getMarker(row.notes, 'DOMAIN-FLAGGED')) return res.send(guestAlmostDonePage());
            let notes2 = upsertMarker(row.notes, 'verified via', instEmail);
            if (typeof h.setEmail === 'function' && String(row.email || '').trim().toLowerCase() !== instEmail) {
                notes2 = upsertMarker(notes2, 'original-email', String(row.email || '').trim());
                h.setEmail(parsed.id, instEmail);   // ticket + passes + sheet row go to the verified institutional inbox
            }
            // Company-domain background check (tiers: academic auto-trusts; corporate must look real).
            const domain = instEmail.split('@')[1] || '';
            const checkFn = typeof deps.checkDomain === 'function' ? deps.checkDomain : checkCompanyDomain;
            let intel;
            try { intel = await checkFn(domain, row.institution || ''); }
            catch (e) {
                console.warn('[ReviewGate] domain check errored (treated as shaky):', e.message);
                intel = { pass: false, tier: 'corporate', reasons: ['the domain background check could not complete'],
                    evidence: [['Domain', domain], ['Check', 'errored \u26a0']] };
            }
            if (!intel.pass) {
                notes2 = upsertMarker(notes2, 'DOMAIN-FLAGGED', new Date().toISOString());
                h.setNotes(parsed.id, notes2);
                try {
                    const urls = reviewUrls(secret, parsed.table, parsed.id);
                    const fields = {
                        'Name': row.name || '\u2014',
                        'Institutional email': instEmail,
                        'Original email': row.email || '\u2014',
                        'Claimed institution': row.institution || '\u2014'
                    };
                    for (const [k, v] of (intel.evidence || [])) fields[k] = v;
                    await sendEmail(REVIEW_TO, `Company domain needs your OK — ${row.name || instEmail}`,
                        buildReviewEmail({
                            kind: (h.eventLabel || parsed.table) + ' \u00b7 company-domain check',
                            fields,
                            reason: 'They control ' + instEmail + ', but: ' + intel.reasons.join('; ') + '.',
                            approveUrl: urls.approveUrl, rejectUrl: urls.rejectUrl
                        }));
                } catch (revErr) { console.warn('[ReviewGate] domain-flag review email failed:', revErr.message); }
                console.log(`[ReviewGate] ${parsed.table}/${parsed.id} confirmed via ${instEmail} but domain flagged (${intel.reasons.join('; ')}) — held for Alen`);
                return res.send(guestAlmostDonePage());
            }
            h.setNotes(parsed.id, notes2);
            const out = await h.approve(parsed.id) || {};                                  // EXACT approve path
            if (out.status === 'done') {
                try {
                    await sendEmail(REVIEW_TO, `✓ Registration confirmed — ${row.name || row.email}`,
                        buildFyiEmail({ name: row.name || row.email, instEmail, evidence: intel.evidence }));
                } catch (fyiErr) { console.warn('[ReviewGate] FYI email failed:', fyiErr.message); }
                console.log(`[ReviewGate] ${parsed.table}/${parsed.id} confirmed via ${instEmail} — auto-approved (${intel.tier})`);
            }
            return res.send(guestConfirmedPage(instEmail));
        } catch (e) {
            console.error('[ReviewGate] institutional confirm failed:', e.message);
            return res.status(500).send(guestLinkNotRightPage());
        }
    });

    console.log('[ReviewGate] review routes mounted (/api/review/:token/{approve|reject|verify} + /verify-registration)');
}

module.exports = {
    REVIEW_TO,
    looksRandom,
    stripCredentials,
    suspicionScore,
    normalizeCountry,
    isSafeCountry,
    countryCode,
    coherenceHold,
    isFreeMailDomain,
    isInstitutionalDomain,
    croatianNameSignal,
    checkInstitutionalEmail,
    SAFE_COUNTRIES,
    reviewToken,
    verifyReviewToken,
    reviewUrls,
    verifyPageToken,
    parseVerifyPageToken,
    instConfirmSig,
    getMarker,
    upsertMarker,
    buildReviewEmail,
    isAcademicishDomain,
    institutionNameMatch,
    domainVerdict,
    checkCompanyDomain,
    buildVerifyAskEmail,
    buildInstConfirmEmail,
    registerReviewHandlers,
    mountReviewRoutes
};
