/**
 * tests/ai-draft-schema.test.js — shared/ai.js aiDraft() after the 2026-09-25 prompt audit (F01, F15, F16, F17).
 *   - without `schema` the request is unchanged (no output_config) and the reply is plain text
 *   - with `schema` the request carries output_config.format = { type: 'json_schema', schema } and the reply
 *     comes back parsed as `json`
 *   - a non-end_turn stop (max_tokens, refusal) with a schema is mock_reason 'incomplete'; unparseable text is
 *     'bad_json'; both leave the caller's deterministic fallback in charge (mock: true, empty text)
 *   - max_tokens clamps to 64..8192, timeoutMs overrides the 8 s default, no key means no network call
 *   - the per-call usage log line carries the model, stop reason, token counts and only the first 40
 *     characters of the purpose (a guest name interpolated later in a purpose never reaches the log)
 *   - the system line keeps American English as the default and lets a caller name another language
 * Stubbed fetch, no network, no key.   Run:  node tests/ai-draft-schema.test.js
 */
'use strict';
const assert = require('node:assert');

process.env.AI_DRAFT_RATE_MAX = '200';
delete process.env.AI_DRAFT_MODEL;
const { aiDraft } = require('../shared/ai.js');

let passed = 0, failed = 0;
async function t(name, fn) {
    try { await fn(); passed++; console.log('  ok    ' + name); }
    catch (e) { failed++; console.error('  FAIL  ' + name + '\n        ' + (e && e.stack || e)); }
}

// Fake Anthropic endpoint: records every request and answers with the next queued reply.
let calls = [];
let reply = null;
global.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, headers: init.headers, body, signal: init.signal });
    const r = typeof reply === 'function' ? await reply(body, init) : reply;
    return { ok: r.status ? r.status < 400 : true, status: r.status || 200, json: async () => r.data, text: async () => JSON.stringify(r.data) };
};
const msg = (text, stop_reason = 'end_turn', usage = { input_tokens: 120, output_tokens: 9 }) =>
    ({ data: { content: text == null ? [] : [{ type: 'text', text }], stop_reason, usage } });

const KIND_SCHEMA = { type: 'object', properties: { kind: { type: 'string', enum: ['simple', 'complex'] } }, required: ['kind'], additionalProperties: false };

// Capture console.log so the usage line can be checked.
const logged = [];
const realLog = console.log;
function captureLog(fn) {
    return async () => {
        console.log = (...a) => { logged.push(a.join(' ')); };
        try { await fn(); } finally { console.log = realLog; }
    };
}

(async () => {
    await t('no key: empty mock, no_key, and no network call', async () => {
        delete process.env.ANTHROPIC_API_KEY;
        calls = [];
        const r = await aiDraft({ purpose: 'x', schema: KIND_SCHEMA });
        assert.deepStrictEqual(r, { text: '', mock: true, mock_reason: 'no_key' });
        assert.strictEqual(calls.length, 0);
    });

    process.env.ANTHROPIC_API_KEY = 'sk-test-not-a-real-key';

    await t('text mode: request has no output_config, reply is text with stop_reason and usage', async () => {
        calls = []; reply = msg('A short draft.');
        const r = await aiDraft({ purpose: 'Write a note.', context: { a: 1 }, maxTokens: 300 });
        assert.strictEqual(calls.length, 1);
        const b = calls[0].body;
        assert.strictEqual(calls[0].url, 'https://api.anthropic.com/v1/messages');
        assert.strictEqual(b.model, 'claude-haiku-4-5');
        assert.strictEqual(b.max_tokens, 300);
        assert.ok(!('output_config' in b), 'no output_config without a schema');
        assert.ok(!('thinking' in b) && !('tools' in b), 'request shape otherwise unchanged');
        assert.strictEqual(r.text, 'A short draft.');
        assert.strictEqual(r.mock, false);
        assert.strictEqual(r.json, undefined);
        assert.strictEqual(r.stop_reason, 'end_turn');
        assert.deepStrictEqual(r.usage, { input_tokens: 120, output_tokens: 9 });
    });

    await t('schema mode: output_config.format carries the schema, reply parsed as json', async () => {
        calls = []; reply = msg('{"kind":"complex"}');
        const r = await aiDraft({ purpose: 'Classify a reply.', context: { reply: 'I have conditions.' }, maxTokens: 64, schema: KIND_SCHEMA });
        const b = calls[0].body;
        assert.deepStrictEqual(b.output_config, { format: { type: 'json_schema', schema: KIND_SCHEMA } });
        assert.strictEqual(r.mock, false);
        assert.deepStrictEqual(r.json, { kind: 'complex' });
        assert.strictEqual(r.text, '{"kind":"complex"}');
    });

    await t('schema mode: a max_tokens stop is mock_reason incomplete (no half JSON reaches a caller)', async () => {
        reply = msg('{"kind":"sim', 'max_tokens');
        const r = await aiDraft({ purpose: 'Classify.', schema: KIND_SCHEMA });
        assert.deepStrictEqual(r, { text: '', mock: true, mock_reason: 'incomplete' });
    });

    await t('schema mode: a refusal stop is mock_reason incomplete', async () => {
        reply = msg('I can not help with that.', 'refusal');
        const r = await aiDraft({ purpose: 'Classify.', schema: KIND_SCHEMA });
        assert.strictEqual(r.mock, true);
        assert.strictEqual(r.mock_reason, 'incomplete');
    });

    await t('schema mode: unparseable text is mock_reason bad_json', async () => {
        reply = msg('simple');
        const r = await aiDraft({ purpose: 'Classify.', schema: KIND_SCHEMA });
        assert.deepStrictEqual(r, { text: '', mock: true, mock_reason: 'bad_json' });
    });

    await t('text mode: a max_tokens stop still returns the text (unchanged behavior) and reports the stop', async () => {
        reply = msg('A draft that was cut', 'max_tokens');
        const r = await aiDraft({ purpose: 'Write.' });
        assert.strictEqual(r.mock, false);
        assert.strictEqual(r.text, 'A draft that was cut');
        assert.strictEqual(r.stop_reason, 'max_tokens');
    });

    await t('empty content is mock_reason empty; an HTTP error is http_error', async () => {
        reply = msg(null);
        assert.strictEqual((await aiDraft({ purpose: 'x', schema: KIND_SCHEMA })).mock_reason, 'empty');
        reply = { status: 400, data: { type: 'error', error: { type: 'invalid_request_error', message: 'bad schema' } } };
        const r = await aiDraft({ purpose: 'x', schema: KIND_SCHEMA });
        assert.deepStrictEqual(r, { text: '', mock: true, mock_reason: 'http_error' });
    });

    await t('max_tokens clamps to 64..8192 (the planner asks for 8192)', async () => {
        reply = msg('ok');
        calls = [];
        await aiDraft({ purpose: 'x', maxTokens: 8 });
        await aiDraft({ purpose: 'x', maxTokens: 8192 });
        await aiDraft({ purpose: 'x', maxTokens: 50000 });
        await aiDraft({ purpose: 'x' });
        assert.deepStrictEqual(calls.map(c => c.body.max_tokens), [64, 8192, 8192, 600]);
    });

    await t('timeoutMs overrides the 8 s default (and the default still aborts a hung call)', async () => {
        reply = (body, init) => new Promise((resolve, reject) => {
            init.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
        });
        const t0 = Date.now();
        const r = await aiDraft({ purpose: 'x', timeoutMs: 1200, schema: KIND_SCHEMA });
        const took = Date.now() - t0;
        assert.deepStrictEqual(r, { text: '', mock: true, mock_reason: 'timeout' });
        assert.ok(took >= 1100 && took < 4000, 'aborted at ~1.2 s, took ' + took + ' ms');
    });

    await t('usage log line: model, stop, tokens, and only the first 40 characters of the purpose', captureLog(async () => {
        logged.length = 0;
        reply = msg('Dear guest, welcome.', 'end_turn', { input_tokens: 321, output_tokens: 45 });
        await aiDraft({ purpose: 'Write a short warm welcome message to the Gala guest Ivana Testić about the evening.' });
        const line = logged.find(l => l.startsWith('[aiDraft]'));
        assert.ok(line, 'one [aiDraft] line');
        assert.ok(/model=claude-haiku-4-5 stop=end_turn in=321 out=45 /.test(line), line);
        assert.ok(line.includes('purpose="Write a short warm welcome message to th"'), line);
        assert.ok(!line.includes('Ivana') && !line.includes('Testić'), 'no guest name in the log');
        assert.ok(!line.includes('sk-test'), 'no key in the log');
    }));

    await t('system line: American English by default, a caller-named language may override, house rules kept', async () => {
        calls = []; reply = msg('ok');
        await aiDraft({ purpose: 'x' });
        const s = calls[0].body.system;
        assert.ok(s.includes('in American English unless the purpose or context names another language.'), s);
        assert.ok(s.includes('No emojis.') && s.includes('No semicolons.') && s.includes('Return only the draft text with no preamble.'), s);
    });

    await t('the user turn is still Purpose + Context, one message, no prefill', async () => {
        calls = []; reply = msg('{"kind":"simple"}');
        await aiDraft({ purpose: 'Classify a reply.', context: { reply: 'When is it?' }, schema: KIND_SCHEMA });
        const m = calls[0].body.messages;
        assert.strictEqual(m.length, 1);
        assert.strictEqual(m[0].role, 'user');
        assert.strictEqual(m[0].content, 'Purpose: Classify a reply.\n\nContext:\nReply: When is it?');
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
})();
