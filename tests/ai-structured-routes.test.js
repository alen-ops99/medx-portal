/**
 * tests/ai-structured-routes.test.js — the admin routes the 2026-09-25 prompt audit moved to structured outputs,
 * a strict tool and adaptive thinking, run end to end against a FAKE Anthropic endpoint.
 *
 *  D  Design assistant (POST /api/admin/design-assist): aiDraft sends output_config with DS_ASSIST_SCHEMA (preset,
 *     accent and scale enums) and applies the parsed object (source 'ai').
 *  T  Task extraction (POST /api/admin/tasks/extract): TASK_EXTRACT_SCHEMA (anyOf null, format date); the
 *     parsed items replace the deterministic list.
 *  R  Web research (POST /api/admin/research): web_search plus the strict report_findings tool; the tool input
 *     is sanitized (a "listed" email with no cited URL drops to "inferred"); a run that never calls the tool is
 *     a clean 502; the Haiku default sends no thinking and keeps max_tokens 3000.
 *  A  Assistant (POST /api/admin/assistant): an action-shaped ask goes to claude-opus-4-8 with thinking adaptive
 *     and max_tokens 8192, a plain ask stays on Haiku with the old shape, a refusal stop never reads as "Done.".
 *  B  Advisor board: the router asks for a seat enum (max_tokens 256), Ask gets its verdict/reasoning/next_steps
 *     schema and returns the parsed answer, and the weekly review sends the observations schema.
 *
 * Boots both portals against one throwaway SQLite file. The preload blocks every non-local connection and answers
 * https://api.anthropic.com/v1/messages from canned replies, recording each request body (never headers).
 * Made-up data only. No email, no real API call, no key.   Run: node tests/ai-structured-routes.test.js
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const USER = 'http://127.0.0.1:3296';
const ADMIN = 'http://127.0.0.1:3297';

const FAKE_ANTHROPIC = (logPath) => `
const net = require('net');
const fs = require('fs');
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
    const o = args[0] && typeof args[0] === 'object' ? args[0] : { port: args[0], host: typeof args[1] === 'string' ? args[1] : 'localhost' };
    if (o && o.path) return connect.apply(this, args);
    const h = String((o && (o.host || o.hostname)) || 'localhost');
    if (!/^(localhost|127\\.0\\.0\\.1|::1|::ffff:127\\.0\\.0\\.1)$/.test(h)) {
        const e = new Error('NETWORK DISABLED IN TESTS (' + h + ')');
        process.nextTick(() => this.destroy(e));
        return this;
    }
    return connect.apply(this, args);
};
const LOG = ${JSON.stringify(logPath)};
const lastUser = (b) => { const m = (b.messages || []).filter(x => x.role === 'user').pop(); return m ? (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)) : ''; };
const text = (t, stop = 'end_turn') => ({ content: [{ type: 'text', text: t }], stop_reason: stop, usage: { input_tokens: 100, output_tokens: 20 } });
function answer(b) {
    const schema = b.output_config && b.output_config.format && b.output_config.format.schema;
    const props = (schema && schema.properties) || {};
    if (props.preset) return text(JSON.stringify({ preset: 'cream_crimson', accent: '#9B1B22', font_scale: 1.12, logo_scale: 1, frame_style: 'hairline', show: { badge: true, date: false, venue: true }, headline: 'Fake headline', sub: 'Fake sub' }));
    if (props.items && JSON.stringify(props.items).includes('assignee')) return text(JSON.stringify({ items: [{ title: 'Send the sponsor deck', assignee: null, due_date: '2099-01-15' }] }));
    if (props.seat) return text(JSON.stringify({ seat: 'CFO' }));
    if (props.verdict) return text(JSON.stringify({ verdict: 'Fake verdict.', reasoning: 'Fake reasoning.', next_steps: ['Step one', 'Step two'] }));
    if (props.observations) return text(JSON.stringify({ observations: [] }));
    const tools = (b.tools || []).map(t => t.name);
    if (tools.includes('report_findings')) {
        if (/NOCALL/.test(lastUser(b))) return text('I searched but will not call the tool.');
        return { content: [
            { type: 'text', text: 'Reporting now.' },
            { type: 'tool_use', id: 'toolu_fake_1', name: 'report_findings', input: { query: 'q', summary: 'One person found.', findings: [
                { name: 'Ana Test', role_or_desc: 'Chair of Neurology', organization: 'QA Org', email: 'ana@qa.example', email_confidence: 'listed', evidence: [], location: 'Zagreb' },
                { name: 'Ivo Test', role_or_desc: 'Dean', organization: 'QA Org', email: 'ivo@qa.example', email_confidence: 'listed', evidence: [{ url: 'https://qa.example/staff', note: 'staff page' }], location: 'Split' }
            ] } }
        ], stop_reason: 'tool_use', usage: { input_tokens: 900, output_tokens: 80, server_tool_use: { web_search_requests: 2 } } };
    }
    if (tools.includes('list_events')) {
        if (/REFUSE/.test(lastUser(b))) return { content: [], stop_reason: 'refusal', usage: { input_tokens: 10, output_tokens: 0 } };
        return text('Fake assistant reply.');
    }
    return text('Fake draft.');
}
global.fetch = async (u, init) => {
    const url = String(u);
    if (!url.startsWith('https://api.anthropic.com/v1/messages')) throw new Error('NETWORK DISABLED IN TESTS ' + url.slice(0, 80));
    const b = JSON.parse(init.body);
    fs.appendFileSync(LOG, JSON.stringify(b) + '\\n');
    const d = answer(b);
    return { ok: true, status: 200, json: async () => d, text: async () => JSON.stringify(d) };
};
`;

const results = [];
const check = (name, cond, detail = '') => {
    results.push([name, !!cond]);
    console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + String(detail).slice(0, 240) : ''));
};
const api = async (base, p, { method = 'GET', body, token } = {}) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = await fetch(base + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let d = null; try { d = await r.json(); } catch (e) {}
    return { status: r.status, d };
};
const waitUp = async (base, ms = 120000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        try { const r = await fetch(base + '/health'); if (r.ok) return; } catch (e) {}
        await new Promise(r => setTimeout(r, 500));
    }
    throw new Error('server at ' + base + ' did not come up');
};

(async () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'medx-ai-structured-'));
    const dbPath = path.join(scratch, 'scratch.db');
    const logPath = path.join(scratch, 'anthropic-requests.jsonl');
    const preload = path.join(scratch, 'fake-anthropic.js');
    fs.writeFileSync(preload, FAKE_ANTHROPIC(logPath));
    fs.writeFileSync(logPath, '');
    const env = {
        ...process.env,
        DATABASE_PATH: dbPath, TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: '',
        RESEND_API_KEY: '', SMTP_USER: '', SMTP_PASS: '', BREVO_API_KEY: '', STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '',
        FIRA_API_KEY: '', GOOGLE_SHEETS_WEBHOOK: '', VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '',
        ANTHROPIC_API_KEY: 'sk-test-fake-not-a-key', AI_DRAFT_MODEL: '', ASSISTANT_MODEL: '', ASSISTANT_MODEL_COMPLEX: '',
        JWT_SECRET: 'ai-structured-test-secret', NODE_ENV: 'test',
    };
    const procs = [];
    const boot = (dir, port) => {
        const p = spawn('node', ['-r', preload, 'server.js'], { cwd: path.join(ROOT, dir), env: { ...env, PORT: String(port) }, stdio: ['ignore', 'ignore', 'pipe'] });
        let errbuf = '';
        p.stderr.on('data', (d) => { errbuf += d.toString(); if (errbuf.length > 4000) errbuf = errbuf.slice(-4000); });
        p._errbuf = () => errbuf;
        procs.push(p);
    };
    const cleanup = () => {
        procs.forEach(p => { try { p.kill('SIGKILL'); } catch (e) {} });
        try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) {}
    };
    process.on('exit', cleanup);
    // Requests recorded since `mark` (one JSON body per line).
    const reqs = () => fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    let mark = 0;
    const since = () => { const all = reqs(); const out = all.slice(mark); mark = all.length; return out; };

    try {
        boot('user-portal/backend', 3296);
        await waitUp(USER);
        boot('admin-portal/backend', 3297);
        await waitUp(ADMIN);
        let r = await api(ADMIN, '/api/auth/login', { method: 'POST', body: { email: 'vp@medx.hr', password: 'admin123' } });
        const tok = r.d && r.d.token;
        check('scratch boot: seeded admin login works', !!tok, r.status);
        since();

        // ------------------------------------------------------------ D · design assistant
        r = await api(ADMIN, '/api/admin/design-assist', { method: 'POST', token: tok, body: { artifact: 'banner', brief: 'light cream with crimson, elegant' } });
        let q = since();
        const ds = q.find(b => b.output_config);
        const dsSchema = ds && ds.output_config.format.schema;
        check('design: one structured-output request (json_schema)', q.length === 1 && ds && ds.output_config.format.type === 'json_schema', JSON.stringify(q.map(b => Object.keys(b))));
        check('design: preset enum = the factory presets, accent enum = the curated palette, numeric scale enums',
            dsSchema && dsSchema.properties.preset.enum.includes('heritage') && dsSchema.properties.preset.enum.includes('gala_gold')
            && dsSchema.properties.accent.enum.includes('#9B1B22') && JSON.stringify(dsSchema.properties.font_scale.enum) === '[0.9,1,1.12]'
            && dsSchema.additionalProperties === false && dsSchema.properties.show.additionalProperties === false, JSON.stringify(dsSchema && dsSchema.properties.preset));
        check('design: the purpose no longer asks for "ONLY strict JSON"', ds && !/Return ONLY|strict JSON/.test(ds.messages[0].content));
        check('design: the parsed object is applied (source ai, suggested copy kept)', r.status === 200 && r.d && r.d.source === 'ai' && r.d.copy && r.d.copy.headline === 'Fake headline', JSON.stringify(r.d).slice(0, 300));

        // ------------------------------------------------------------ T · task extraction
        r = await api(ADMIN, '/api/admin/tasks/extract', { method: 'POST', token: tok, body: { notes: 'Ana will send the sponsor deck by Friday. Marko books the venue.' } });
        q = since();
        const te = q[0];
        const teItem = te && te.output_config && te.output_config.format.schema.properties.items.items;
        check('tasks: TASK_EXTRACT_SCHEMA sent (assignee anyOf null, due_date format date)', teItem && JSON.stringify(teItem.properties.assignee) === '{"anyOf":[{"type":"string"},{"type":"null"}]}'
            && JSON.stringify(teItem.properties.due_date).includes('"format":"date"'), JSON.stringify(teItem));
        check('tasks: model items replace the deterministic list (mock false)', r.status === 200 && r.d && r.d.mock === false && r.d.items.length === 1 && r.d.items[0].title === 'Send the sponsor deck' && r.d.items[0].due_date === '2099-01-15', JSON.stringify(r.d));

        // ------------------------------------------------------------ R · web research, strict tool
        r = await api(ADMIN, '/api/admin/research', { method: 'POST', token: tok, body: { query: 'Find the chair of neurology at QA Org' } });
        q = since();
        const rs = q[0] || {};
        const rt = (rs.tools || []);
        const rep = rt.find(t => t.name === 'report_findings');
        check('research: web_search_20250305 plus a strict report_findings tool', rt.length === 2 && rt[0].type === 'web_search_20250305' && rep && rep.strict === true
            && rep.input_schema.additionalProperties === false && rep.input_schema.properties.findings.items.additionalProperties === false, JSON.stringify(rt.map(t => t.name || t.type)));
        check('research: Haiku default keeps its shape (claude-haiku-4-5, max_tokens 3000, no thinking, no output_config)', rs.model === 'claude-haiku-4-5' && rs.max_tokens === 3000 && !rs.thinking && !rs.output_config, JSON.stringify({ model: rs.model, max: rs.max_tokens }));
        check('research: the system prompt asks for report_findings and no longer says "ONLY one JSON object"', /call report_findings once/.test(rs.system || '') && !/ONLY one JSON object/.test(rs.system || ''));
        const f = (r.d && r.d.findings) || [];
        check('research: tool input parsed into findings (200)', r.status === 200 && f.length === 2 && r.d.summary === 'One person found.', JSON.stringify(r.d).slice(0, 300));
        check('research: a "listed" email with no cited URL drops to "inferred"; one with a URL stays listed', f[0] && f[0].email_confidence === 'inferred' && f[1] && f[1].email_confidence === 'listed', JSON.stringify(f.map(x => x.email_confidence)));
        r = await api(ADMIN, '/api/admin/research', { method: 'POST', token: tok, body: { query: 'NOCALL find anyone' } });
        since();
        check('research: a run that never calls report_findings is a clean 502 with a plain message', r.status === 502 && /finished without a result/.test((r.d && r.d.error) || ''), JSON.stringify(r.d));

        // ------------------------------------------------------------ A · assistant: Opus route thinks, Haiku route unchanged
        r = await api(ADMIN, '/api/admin/assistant', { method: 'POST', token: tok, body: { message: 'Please change the gala start time to 19:30' } });
        q = since();
        const op = q.find(b => (b.tools || []).some(t => t.name === 'list_events'));
        check('assistant: an action ask goes to claude-opus-4-8 with thinking adaptive and max_tokens 8192', op && op.model === 'claude-opus-4-8' && op.thinking && op.thinking.type === 'adaptive' && op.max_tokens === 8192, JSON.stringify(op && { model: op.model, thinking: op.thinking, max: op.max_tokens }));
        check('assistant: …and its reply comes back', r.status === 200 && r.d && r.d.answer === 'Fake assistant reply.', JSON.stringify(r.d));
        const tools = (op && op.tools) || [];
        const coupon = tools.find(t => t.name === 'create_coupon');
        const create = tools.find(t => t.name === 'create_event');
        check('assistant tools: create_coupon event_type is the enum Confirm accepts', coupon && JSON.stringify(coupon.input_schema.properties.event_type.enum) === '["gala","plexus","forum","bridges","croatians-abroad"]');
        check('assistant tools: create_event names the Bridges city requirement', create && /bridges_event needs name, city, and event_date/.test(create.description) && JSON.stringify(create.input_schema.properties.kind.enum) === '["bridges_event","forum_event"]');
        check('assistant tools: no shouted ALWAYS / ANY / DO NOT left in the tool descriptions', tools.every(t => !/\b(ALWAYS|ANY|DO NOT|DOES NOT)\b/.test(t.description)));
        r = await api(ADMIN, '/api/admin/assistant', { method: 'POST', token: tok, body: { message: 'Please update the gala venue REFUSE' } });
        since();
        check('assistant: a refusal stop is a short apology, never "Done."', r.status === 200 && r.d && /can't help with that request/.test(r.d.answer || ''), JSON.stringify(r.d));
        r = await api(ADMIN, '/api/admin/assistant', { method: 'POST', token: tok, body: { message: 'What do you think about the mood of our volunteers lately?' } });
        q = since();
        const hk = q.find(b => (b.tools || []).some(t => t.name === 'list_events'));
        check('assistant: a plain ask stays on Haiku with the old shape (max_tokens 1024, no thinking)', hk && /^claude-haiku-4-5/.test(hk.model) && hk.max_tokens === 1024 && !hk.thinking, JSON.stringify(hk && { model: hk.model, max: hk.max_tokens }));

        // ------------------------------------------------------------ B · advisor board
        r = await api(ADMIN, '/api/admin/advisors/ask', { method: 'POST', token: tok, body: { question: 'Is our gala budget on track this month?' } });
        q = since();
        const router = q.find(b => b.output_config && b.output_config.format.schema.properties.seat);
        const ask = q.find(b => b.output_config && b.output_config.format.schema.properties.verdict);
        check('advisors: router asks for a seat enum (max_tokens 256) and no "exactly one word"', router && JSON.stringify(router.output_config.format.schema.properties.seat.enum) === '["CMO","CFO","COO","CLO"]' && router.max_tokens === 256 && !/exactly one word/.test(router.system), JSON.stringify(router && router.output_config));
        check('advisors: Ask sends its verdict / reasoning / next_steps schema', ask && JSON.stringify(ask.output_config.format.schema.required) === '["verdict","reasoning","next_steps"]' && !/Return ONLY/.test(ask.system + ask.messages[0].content));
        check('advisors: the parsed answer is returned (seat CFO, routed by ai, not a mock)', r.status === 200 && r.d && r.d.seat === 'CFO' && r.d.answer.routed_by === 'ai' && r.d.answer.is_mock === 0 && r.d.answer.verdict === 'Fake verdict.', JSON.stringify(r.d).slice(0, 300));
        r = await api(ADMIN, '/api/admin/advisors/run/CFO', { method: 'POST', token: tok, body: {} });
        q = since();
        const rev = q.find(b => b.output_config && b.output_config.format.schema.properties.observations);
        check('advisors: the weekly review sends the observations schema and no "JSON array" instruction', rev && rev.output_config.format.schema.properties.observations.items.additionalProperties === false && !/JSON array/.test(rev.system + rev.messages[0].content), JSON.stringify(q.map(b => b.output_config ? Object.keys(b.output_config.format.schema.properties) : 'text')));
        check('advisors: an empty observation list falls back cleanly (ok, review present)', r.status === 200 && r.d && r.d.ok === true && r.d.review, JSON.stringify(r.d).slice(0, 200));

        // ------------------------------------------------------------ every recorded request
        const all = reqs();
        check('every structured request sets additionalProperties false on every object', all.filter(b => b.output_config).every(b => {
            const walk = (s) => !s || typeof s !== 'object' ? true : (s.type === 'object' && s.additionalProperties !== false ? false : Object.values(s).every(walk));
            return walk(b.output_config.format.schema);
        }));
        check('no request carries a prefill (every request ends on a user turn)', all.every(b => (b.messages || []).slice(-1)[0].role === 'user'));
    } catch (e) {
        check('unexpected error: ' + e.message, false);
        procs.forEach(p => console.error(p._errbuf && p._errbuf()));
    }
    const failed = results.filter(([, ok]) => !ok).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    process.exit(failed ? 1 : 0);
})();
