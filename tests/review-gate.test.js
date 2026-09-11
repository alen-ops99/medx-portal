/**
 * tests/review-gate.test.js — the shared registration review gate
 * (user-portal/backend/review-gate.js): gibberish heuristics, safe-country matcher,
 * country-claim coherence, institutional-email vetting, HMAC tokens, the review email,
 * notes markers, and the route dispatcher over stub handlers.
 *
 * Hermetic: no DB, no express, no network (global fetch disabled), emails captured by a stub.
 * The end-to-end wiring (held rows, approve/reject/verify against a real schema) lives in
 * tests/boston.test.js.
 *
 * Run:  node tests/review-gate.test.js
 */
'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');

delete process.env.RENDER_EXTERNAL_URL;                 // deterministic base URL in links
delete process.env.REVIEW_EMAIL;                        // default recipient must be Alen
global.fetch = () => { throw new Error('NETWORK DISABLED IN TESTS'); };

const gate = require('../user-portal/backend/review-gate.js');

// ---------------------------------------------------------------- tiny harness
let passed = 0, failed = 0;
async function t(name, fn) {
    try { await fn(); passed++; console.log('  ok    ' + name); }
    catch (e) { failed++; console.error('  FAIL  ' + name + '\n        ' + (e && e.message)); }
}

// ---------------------------------------------------------------- fixtures
// Six REAL-PATTERN bot rows (the first is the actual September 2026 registration verbatim).
const BOT_ROWS = [
    { name: 'RQstQeTGKseNqJzmVHMmE', institution: 'Ugakeu LLC', position: 'cCzNfiIdNITvvnWjrBf' },
    { name: 'XbWqTrzKlmPvvGhstNqR', institution: 'Qwkzrt LLC', position: 'ZnRqWtBvvKlpMhhDsFg' },
    { name: 'hJkWQzXcvBnmLpRtYsQw', institution: 'Vbnmkl Inc', position: 'TgbNhyUjmKikRfvTgbY' },
    { name: 'qWxCvBnMzLkJhGfDsApQ', institution: 'Xkwzpr LLC', position: 'PmnBvcXzLkjHgfDsaQw' },
    { name: 'KsldjfWQpxmznTRqbvNc', institution: 'Rtyupz LLC', position: 'WqazxSwedcVfrtGbnhY' },
    { name: 'NqZxKvWpRtLmBcDfGhJs', institution: 'Mklopq LLC', position: 'HjqWzxTkvBnpRsdFglM' }
];
// Six REAL registrants (actual Building Bridges Boston names) — none may score >= 2.
const REAL_ROWS = [
    { name: 'Ana Jaklenec, Ph.D.', institution: 'Massachusetts Institute of Technology', position: 'Principal Research Scientist' },
    { name: 'Mladen-Roko Rasin', institution: 'Rutgers Robert Wood Johnson Medical School', position: 'Professor of Neuroscience and Cell Biology' },
    { name: 'Tanja Petnicki-Ocwieja, PhD', institution: 'Tufts University School of Medicine', position: 'Research Assistant Professor' },
    { name: 'J Michael Gaziano', institution: "Brigham and Women's Hospital", position: 'Professor of Medicine' },
    { name: 'Katarina Ruscic', institution: 'Massachusetts General Hospital', position: 'Assistant Professor of Anaesthesia, Department of Anesthesia, Critical Care and Pain Medicine, Harvard Medical School' },
    { name: 'Nikitha Chauhan Palthyavath', institution: 'Harvard T.H. Chan School of Public Health', position: 'Research Fellow' }
];

(async () => {
    console.log('review-gate.test.js — hermetic (no DB, no network, stub handlers)\n');

    // ==================== gibberish heuristics ====================
    await t('all six real bot rows score >= 2 (held)', () => {
        for (const row of BOT_ROWS) {
            const s = gate.suspicionScore(row);
            assert.ok(s >= 2, `bot row must hold (got ${s}): ${row.name}`);
        }
    });

    await t('all six real registrants score < 2 (pass) — credentials and Title Case never trip it', () => {
        for (const row of REAL_ROWS) {
            const s = gate.suspicionScore(row);
            assert.ok(s < 2, `real registrant must pass (got ${s}): ${row.name}`);
        }
    });

    await t('looksRandom on the individual bot strings; institution "Ugakeu LLC" alone is not enough', () => {
        assert.strictEqual(gate.looksRandom('RQstQeTGKseNqJzmVHMmE'), true, 'bot name');
        assert.strictEqual(gate.looksRandom('cCzNfiIdNITvvnWjrBf'), true, 'bot position');
        assert.strictEqual(gate.looksRandom('Ana Jaklenec'), false, 'real name');
        assert.strictEqual(gate.looksRandom('Massachusetts General Hospital'), false, 'real institution');
        // A short pronounceable fake with an LLC suffix scores 0 on its own — by design the
        // name is the primary signal (2 points); institutions only ever add 1.
        assert.strictEqual(gate.suspicionScore({ name: 'Ana Horvat', institution: 'Ugakeu LLC', position: '' }), 0);
    });

    await t('stripCredentials cleans degree suffixes before scoring', () => {
        assert.strictEqual(gate.stripCredentials('Ana Jaklenec, Ph.D.'), 'Ana Jaklenec');
        assert.strictEqual(gate.stripCredentials('Tanja Petnicki-Ocwieja, PhD'), 'Tanja Petnicki-Ocwieja');
        assert.strictEqual(gate.stripCredentials('John Smith MD'), 'John Smith');
        assert.strictEqual(gate.stripCredentials('Mladen-Roko Rasin'), 'Mladen-Roko Rasin');
    });

    // ==================== safe-country matcher ====================
    await t('safe: Croatia/Hrvatska, US variants, UK variants, Germany variants (trim/case/diacritics)', () => {
        for (const c of ['Croatia', 'Hrvatska', ' hrvatska ', 'HRVATSKA', 'Republic of Croatia',
                         'US', 'USA', 'U.S.', 'U.S.A.', 'United States', 'United States of America',
                         'Sjedinjene Američke Države', 'SAD',
                         'UK', 'U.K.', 'United Kingdom', 'Great Britain', 'Britain', 'England',
                         'Germany', 'Deutschland', 'Njemačka', 'njemacka',
                         'Canada', 'Australia', 'New Zealand', 'NZ',
                         'Serbia', 'Srbija', 'Bosnia and Herzegovina', 'Bosna i Hercegovina', 'BiH',
                         'Switzerland', 'Norway', 'Ireland', 'the Netherlands', 'España', 'Mađarska',
                         'Slovenia', 'Austria', 'France', 'Italy', 'Poland', 'Kosovo', 'Montenegro', 'Ukraine']) {
            assert.strictEqual(gate.isSafeCountry(c), true, 'should be safe: ' + JSON.stringify(c));
        }
    });

    await t('hold: Ghana/Bangladesh/India/Venezuela/China + blank/unknown and the rest of the world', () => {
        for (const c of ['Ghana', 'Bangladesh', 'India', 'Venezuela', 'China', '', '   ', null, undefined,
                         'Nigeria', 'Pakistan', 'United Arab Emirates', 'Saudi Arabia', 'Qatar', 'Egypt',
                         'Brazil', 'Mexico', 'Argentina', 'Colombia', 'Indonesia', 'Philippines', 'Vietnam',
                         'Kenya', 'Ethiopia', 'Dominican Republic', 'Ruritania', 'planet earth']) {
            assert.strictEqual(gate.isSafeCountry(c), false, 'should hold: ' + JSON.stringify(String(c)));
        }
    });

    await t('countryCode returns ccTLD-style codes', () => {
        assert.strictEqual(gate.countryCode('Hrvatska'), 'hr');
        assert.strictEqual(gate.countryCode('U.S.A.'), 'us');
        assert.strictEqual(gate.countryCode('Great Britain'), 'uk');
        assert.strictEqual(gate.countryCode('Deutschland'), 'de');
        assert.strictEqual(gate.countryCode('Ghana'), null);
        assert.strictEqual(gate.countryCode(''), null);
    });

    // ==================== country-claim coherence ====================
    await t('coherence HOLD: foreign-pattern name + free-mail + unrelated company, claiming Croatia', () => {
        assert.strictEqual(gate.coherenceHold({
            country: 'Croatia', name: 'Mohamed Hassan', email: 'mh8842x@gmail.com', institution: 'TradeLink LLC'
        }), true, 'the real fraud pattern must hold');
        assert.strictEqual(gate.coherenceHold({
            country: 'United States', name: 'Adebayo Okafor', email: 'ao9931@gmail.com', institution: 'Global Trade Ltd'
        }), true, 'same pattern against a US claim');
    });

    await t('coherence PASS: any single aligning signal suffices', () => {
        const passes = [
            { country: 'Croatia', name: 'Ivana Horvat', email: 'ivana.horvat@gmail.com', institution: '' },          // Croatian given name
            { country: 'Croatia', name: 'John Smith', email: 'jsmith@kbc-zagreb.hr', institution: 'KBC Zagreb' },    // .hr + institution
            { country: 'Croatia', name: 'Marko Kovačić', email: 'marko.k@yahoo.com', institution: 'Some Company' },  // diacritics
            { country: 'Croatia', name: 'Petra Babic', email: 'pb@gmail.com', institution: '' },                     // -ic surname (ASCII)
            { country: 'Croatia', name: 'Wei Zhang', email: 'wz@fer.unizg.hr', institution: 'FER' },                 // ccTLD
            { country: 'Croatia', name: 'Jane Doe', email: 'jd@gmail.com', institution: 'Sveučilište u Zagrebu' },   // institution token
            { country: 'Croatia', name: 'Jane Doe', email: 'jd@gmail.com', institution: 'Marex d.o.o.' },            // d.o.o.
            { country: 'United States', name: 'John Miller', email: 'jm@bwh.harvard.edu', institution: 'BWH' },      // .edu
            { country: 'Germany', name: 'Hans Weber', email: 'hw@charite.de', institution: 'Charité' }               // .de
        ];
        for (const p of passes) {
            assert.strictEqual(gate.coherenceHold(p), false, 'must pass: ' + JSON.stringify(p));
        }
    });

    await t('coherence never holds a corporate (non-free-mail) domain or a non-safe claim', () => {
        assert.strictEqual(gate.coherenceHold({
            country: 'Croatia', name: 'Jane Doe', email: 'jd@marexglobal.com', institution: 'Marex Global'
        }), false, 'unknown corporate domain alone never holds');
        assert.strictEqual(gate.coherenceHold({
            country: 'Ghana', name: 'Kofi Annan', email: 'ka@gmail.com', institution: 'UN'
        }), false, 'non-safe countries are the country gate\'s job');
    });

    // ==================== institutional-email vetting (verify flow) ====================
    await t('free-mail and disposable domains are rejected; institutional accepted (incl. uni.rs)', () => {
        for (const bad of ['someone@gmail.com', 'x@googlemail.com', 'x@yahoo.com', 'x@yahoo.co.in',
                           'x@hotmail.com', 'x@outlook.com', 'x@outlook.de', 'x@live.com', 'x@msn.com',
                           'x@proton.me', 'x@protonmail.com', 'x@aol.com', 'x@icloud.com', 'x@mail.ru',
                           'x@gmx.de', 'x@web.de', 'x@yandex.ru', 'x@qq.com', 'x@163.com',
                           'x@mailinator.com', 'x@10minutemail.net', 'x@yopmail.com', 'not-an-email']) {
            assert.strictEqual(gate.checkInstitutionalEmail(bad).ok, false, 'must reject: ' + bad);
        }
        for (const good of ['ana@med.uni.rs', 'x@kg.ac.rs', 'a@harvard.edu', 'j@kbc-zagreb.hr',
                            'a@mef.unizg.hr', 'a@charite.de', 'x@novartis.com', 'x@mail.harvard.edu',
                            'x@ox.ac.uk', 'x@pliva.hr']) {
            const r = gate.checkInstitutionalEmail(good);
            assert.strictEqual(r.ok, true, 'must accept: ' + good);
            assert.ok(r.domain, 'domain recorded for ' + good);
        }
    });

    // ==================== HMAC tokens ====================
    await t('review token: roundtrip both tables, tamper/forgery -> null', () => {
        const id = crypto.randomUUID();
        for (const table of ['bridges_registrations', 'croatians_abroad_registrations']) {
            const tok = gate.reviewToken('secret-1', table, id);
            assert.deepStrictEqual(gate.verifyReviewToken('secret-1', tok), { table, id });
            assert.strictEqual(gate.verifyReviewToken('secret-2', tok), null, 'wrong secret');
            assert.strictEqual(gate.verifyReviewToken('secret-1', 'f'.repeat(32) + '.' + table + '.' + id), null, 'forged sig');
        }
        const tok = gate.reviewToken('secret-1', 'bridges_registrations', id);
        assert.strictEqual(gate.verifyReviewToken('secret-1', tok.replace('bridges_registrations', 'croatians_abroad_registrations')), null, 'table swap');
        assert.strictEqual(gate.verifyReviewToken('secret-1', tok.replace('bridges_registrations', 'users')), null, 'unknown table');
        assert.strictEqual(gate.verifyReviewToken('secret-1', 'garbage'), null);
        assert.throws(() => gate.reviewToken('s', 'users', id), /unknown table/);
    });

    await t('verification tokens live in separate HMAC contexts (never interchangeable)', () => {
        const id = crypto.randomUUID();
        const rev = gate.reviewToken('s', 'bridges_registrations', id);
        const ver = gate.verifyPageToken('s', 'bridges_registrations', id);
        assert.notStrictEqual(rev, ver);
        assert.strictEqual(gate.parseVerifyPageToken('s', rev), null, 'review token must not open the verify page');
        assert.strictEqual(gate.verifyReviewToken('s', ver), null, 'verify token must not drive decisions');
        assert.deepStrictEqual(gate.parseVerifyPageToken('s', ver), { table: 'bridges_registrations', id });
        const sig2a = gate.instConfirmSig('s', 'bridges_registrations', id, 'A@Uni.HR');
        const sig2b = gate.instConfirmSig('s', 'bridges_registrations', id, 'a@uni.hr');
        assert.strictEqual(sig2a, sig2b, 'sig2 is case-insensitive over the address');
        assert.notStrictEqual(sig2a, gate.instConfirmSig('s', 'bridges_registrations', id, 'b@uni.hr'), 'sig2 binds the address');
    });

    await t('reviewUrls carries approve + reject + verify on the portal base URL', () => {
        const u = gate.reviewUrls('s', 'bridges_registrations', 'abc-123-def-456');
        for (const k of ['approveUrl', 'rejectUrl', 'verifyUrl']) {
            assert.ok(u[k].startsWith('https://medx-user-portal.onrender.com/api/review/'), k);
        }
        assert.ok(u.approveUrl.endsWith('/approve') && u.rejectUrl.endsWith('/reject') && u.verifyUrl.endsWith('/verify'));
    });

    // ==================== the review email ====================
    await t('buildReviewEmail: headline, reason, three actions, fields verbatim-ESCAPED', () => {
        const html = gate.buildReviewEmail({
            kind: 'Zagreb form',
            reason: 'Country requires manual approval: Ghana',
            fields: { 'First name': '<script>alert(1)</script>', 'Email': 'x@y.example', 'Country': 'Ghana', 'Empty': '' },
            approveUrl: 'https://x.example/a', rejectUrl: 'https://x.example/r', verifyUrl: 'https://x.example/v'
        });
        assert.ok(html.includes('A registration needs your review'), 'headline');
        assert.ok(html.includes('Zagreb form'), 'kind');
        assert.ok(html.includes('Country requires manual approval: Ghana'), 'reason');
        assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'field values must be escaped');
        assert.ok(!html.includes('<script>alert(1)</script>'), 'raw injection must not survive');
        assert.ok(html.includes('https://x.example/a') && html.includes('https://x.example/r') && html.includes('https://x.example/v'), 'all three links');
        assert.ok(/Approve/.test(html) && /Reject/.test(html) && /institutional confirmation/i.test(html), 'three buttons');
        assert.ok(!html.includes('undefined'), 'no leaked undefined');
    });

    await t('registrant-facing emails are polite and never mention review/holds', () => {
        const ask = gate.buildVerifyAskEmail({ firstName: 'Mohamed', confirmUrl: 'https://x.example/verify-registration/tok' });
        assert.ok(ask.includes('institutional email address'), 'ask copy');
        assert.ok(ask.includes('https://x.example/verify-registration/tok'), 'ask link');
        assert.ok(/Confirm my registration/i.test(ask), 'ask button');
        const conf = gate.buildInstConfirmEmail({ firstName: 'Mohamed', confirmUrl: 'https://x.example/c' });
        assert.ok(/Confirm my registration/i.test(conf), 'confirm button');
        for (const html of [ask, conf]) {
            assert.ok(!/review|held|hold|fraud|suspic/i.test(html), 'unsuspicious wording required');
        }
    });

    // ==================== notes markers ====================
    await t('markers: upsert preserves user notes, replaces same-key, survives parsing', () => {
        let notes = '5-minute presentation requested | HELD — review';
        notes = gate.upsertMarker(notes, 'VERIFY-REQUESTED', '2026-09-06T10:00:00.000Z');
        assert.ok(notes.startsWith('5-minute presentation requested | HELD — review | '), 'existing content kept');
        assert.strictEqual(gate.getMarker(notes, 'VERIFY-REQUESTED'), '2026-09-06T10:00:00.000Z');
        notes = gate.upsertMarker(notes, 'VERIFY-SENT', 'a@uni.hr 2026-09-06T10:05:00.000Z');
        notes = gate.upsertMarker(notes, 'VERIFY-SENT', 'b@uni.hr 2026-09-06T10:20:00.000Z');
        assert.strictEqual(gate.getMarker(notes, 'VERIFY-SENT'), 'b@uni.hr 2026-09-06T10:20:00.000Z', 'same key replaced');
        assert.strictEqual(notes.split('VERIFY-SENT').length, 2, 'only one VERIFY-SENT segment');
        notes = gate.upsertMarker(notes, 'verified via', 'b@uni.hr');
        assert.strictEqual(gate.getMarker(notes, 'verified via'), 'b@uni.hr');
        assert.strictEqual(gate.getMarker('', 'VERIFY-SENT'), null);
        assert.strictEqual(gate.getMarker(null, 'VERIFY-SENT'), null);
    });

    // ==================== route dispatcher over stub handlers ====================
    await t('mountReviewRoutes dispatch: done/already/notfound/forged + verify ask on stub handlers', async () => {
        // stub express
        const routes = {};
        const appStub = { get: (p, h) => { routes['GET ' + p] = h; }, post: (p, h) => { routes['POST ' + p] = h; } };
        const sent = [];
        gate.mountReviewRoutes(appStub, { JWT_SECRET: 'unit-secret', sendEmail: async (to, subject, html) => { sent.push({ to, subject, html }); return { success: true }; } });
        assert.ok(routes['GET /api/review/:token/approve'] && routes['GET /api/review/:token/reject']
            && routes['GET /api/review/:token/verify'] && routes['GET /verify-registration/:vtoken']
            && routes['POST /verify-registration/:vtoken'] && routes['GET /verify-registration/:vtoken/confirm/:sig2'], 'all six routes');

        const calls = [];
        let rowNotes = '';
        const knownId = crypto.randomUUID();
        const unknownId = crypto.randomUUID();
        gate.registerReviewHandlers('croatians_abroad_registrations', {
            approve: async (id) => { calls.push('approve:' + id); return id === knownId ? { status: 'done', headline: 'Approved.', message: 'ok' } : { status: 'notfound' }; },
            reject: async (id) => { calls.push('reject:' + id); return { status: 'already', headline: 'Already rejected.', message: 'earlier' }; },
            getRow: (id) => id === knownId ? { id, name: 'Stub Person', email: 'stub@row.example', notes: rowNotes, state: 'pending' } : null,
            setNotes: (id, n) => { rowNotes = n; }
        });
        const run = async (key, params, body) => {
            const r = { statusCode: 200, body: undefined };
            const res = { status(c) { r.statusCode = c; return res; }, send(x) { r.body = x; return res; }, json(o) { r.body = o; return res; }, set() { return res; } };
            await routes[key]({ params, body: body || {} }, res);
            return r;
        };

        const id = knownId;
        const tok = gate.reviewToken('unit-secret', 'croatians_abroad_registrations', id);
        const ok = await run('GET /api/review/:token/approve', { token: tok });
        assert.strictEqual(ok.statusCode, 200);
        assert.ok(String(ok.body).includes('Approved'), 'done page');
        const already = await run('GET /api/review/:token/reject', { token: tok });
        assert.ok(String(already.body).includes('Already rejected'), 'already page');
        const ghost = await run('GET /api/review/:token/approve', { token: gate.reviewToken('unit-secret', 'croatians_abroad_registrations', unknownId) });
        assert.strictEqual(ghost.statusCode, 404, 'handler notfound -> 404');
        const forged = await run('GET /api/review/:token/approve', { token: 'f'.repeat(32) + '.croatians_abroad_registrations.' + id });
        assert.strictEqual(forged.statusCode, 404, 'forged -> 404');
        assert.deepStrictEqual(calls, ['approve:' + id, 'reject:' + id, 'approve:' + unknownId]);

        // verify ask on the stub: sends the polite email + stamps the marker
        const ask = await run('GET /api/review/:token/verify', { token: tok });
        assert.strictEqual(ask.statusCode, 200);
        assert.ok(String(ask.body).includes('Confirmation request sent'), 'ask page');
        assert.strictEqual(sent.length, 1);
        assert.strictEqual(sent[0].to, 'stub@row.example');
        assert.ok(/One more step/.test(sent[0].subject));
        assert.ok(gate.getMarker(rowNotes, 'VERIFY-REQUESTED'), 'marker stamped through setNotes');
        // idempotent inside the window
        const ask2 = await run('GET /api/review/:token/verify', { token: tok });
        assert.ok(String(ask2.body).includes('Confirmation request sent'));
        assert.strictEqual(sent.length, 1, 'no duplicate ask email');
    });

    await t('domain intel: academic classifier, name match, verdict combiner', () => {
        assert.ok(gate.isAcademicishDomain('hms.harvard.edu'));
        assert.ok(gate.isAcademicishDomain('med.uni.rs'));
        assert.ok(gate.isAcademicishDomain('kbc-zagreb.hr'));
        assert.ok(gate.isAcademicishDomain('ucl.ac.uk'));
        assert.ok(!gate.isAcademicishDomain('tradelink-global.com'));
        assert.ok(!gate.isAcademicishDomain('medx.hr'));
        assert.ok(gate.institutionNameMatch('TradeLink LLC', 'tradelink.com'));
        assert.ok(gate.institutionNameMatch('Boston Medical Consulting', 'bmc.com'), 'acronym');
        assert.ok(!gate.institutionNameMatch('Xvqzwbnk LLC', 'medx.hr'));
        assert.ok(!gate.institutionNameMatch('', 'tradelink.com'));
        assert.strictEqual(gate.domainVerdict({ academic: true }).pass, true);
        assert.strictEqual(gate.domainVerdict({ academic: false, ageDays: 4000, alive: true, nameMatch: true }).pass, true);
        assert.strictEqual(gate.domainVerdict({ academic: false, ageDays: 30, alive: true, nameMatch: true }).pass, false);
        assert.strictEqual(gate.domainVerdict({ academic: false, ageDays: null, alive: true, nameMatch: true }).pass, false, 'unverifiable age is not a pass');
        assert.strictEqual(gate.domainVerdict({ academic: false, ageDays: 4000, alive: false, nameMatch: true }).pass, false);
        assert.strictEqual(gate.domainVerdict({ academic: false, ageDays: 4000, alive: true, nameMatch: false }).pass, false);
    });

    await t('shaky company domain: no auto-approve — Alen gets findings, guest sees warm page', async () => {
        const routes = {};
        const sent = [];
        const appStub = { get: (p, h) => { routes['GET ' + p] = h; }, post: (p, h) => { routes['POST ' + p] = h; } };
        gate.mountReviewRoutes(appStub, {
            JWT_SECRET: 'unit-secret-2',
            sendEmail: async (to, subject, html) => { sent.push({ to, subject, html }); return { success: true }; },
            checkDomain: async (domain, institution) => ({
                pass: false, tier: 'corporate',
                reasons: ['the domain was registered only 12 days ago'],
                evidence: [['Domain', domain], ['Registered', '12 days ago \u26a0']]
            })
        });
        let notes = 'HELD — review';
        let approved = 0; let rowEmail = 'shady@gmail.com';
        gate.registerReviewHandlers('bridges_registrations', {
            approve: async () => { approved++; return { status: 'done', headline: 'Approved.', message: 'ok' }; },
            reject: async () => ({ status: 'done', headline: 'Rejected.', message: 'ok' }),
            getRow: () => ({ id: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6', name: 'Shady Person', email: rowEmail, institution: 'FreshCo LLC', notes, state: 'pending' }),
            setNotes: (id, n) => { notes = n; },
            setEmail: (id, e) => { rowEmail = e; },
            eventLabel: 'Building Bridges in Biomedicine — Boston'
        });
        const run = async (key, params, body) => {
            const req = { params: params || {}, body: body || {} };
            let out = { statusCode: 200, body: null };
            const res = {
                status(c) { out.statusCode = c; return this; },
                send(b) { out.body = b; return this; },
                json(b) { out.body = b; return this; }
            };
            await routes[key](req, res);
            return out;
        };
        // organizer asks for institutional confirmation
        const tok = gate.reviewToken('unit-secret-2', 'bridges_registrations', 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6');
        await run('GET /api/review/:token/verify', { token: tok });
        // registrant submits a corporate address
        const vtoken = gate.verifyPageToken('unit-secret-2', 'bridges_registrations', 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6');
        const sub = await run('POST /verify-registration/:vtoken', { vtoken }, { email: 'ceo@freshco-global.com' });
        assert.strictEqual(sub.statusCode, 200);
        // click from the corporate inbox
        const sig2 = gate.instConfirmSig('unit-secret-2', 'bridges_registrations', 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6', 'ceo@freshco-global.com');
        const click = await run('GET /verify-registration/:vtoken/confirm/:sig2', { vtoken, sig2 });
        assert.strictEqual(click.statusCode, 200);
        assert.ok(String(click.body).includes('All set'), 'guest sees the warm finalizing page');
        assert.ok(!String(click.body).includes('You are confirmed'), 'guest is NOT told they are confirmed');
        assert.strictEqual(approved, 0, 'NOT auto-approved');
        assert.strictEqual(rowEmail, 'ceo@freshco-global.com', 'row re-pointed at the verified inbox for a later approve');
        assert.ok(gate.getMarker(notes, 'DOMAIN-FLAGGED'), 'flag marker stamped');
        const flagMail = sent[sent.length - 1];
        assert.strictEqual(flagMail.to, gate.REVIEW_TO, 'findings go to Alen');
        assert.ok(/Company domain needs your OK/.test(flagMail.subject));
        assert.ok(flagMail.html.includes('12 days'), 'evidence in the email');
        // idempotent second click: same warm page, no duplicate email to Alen
        const before = sent.length;
        const click2 = await run('GET /verify-registration/:vtoken/confirm/:sig2', { vtoken, sig2 });
        assert.ok(String(click2.body).includes('All set'));
        assert.strictEqual(sent.length, before, 'no duplicate findings email');
    });

    await t('default review recipient is Alen', () => {
        assert.strictEqual(gate.REVIEW_TO, 'juginovic.alen@gmail.com');
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
})();
