'use strict';

/**
 * shared/ai.js — one AI drafting primitive shared by both MedX portals.
 *
 *   aiDraft({ purpose, context, maxTokens, schema, timeoutMs }) -> Promise<{ text, json, mock, mock_reason }>
 *
 * With `schema` (a JSON Schema) the reply is constrained by structured outputs
 * (output_config.format) and also returned parsed as `json`. Without it the
 * reply is plain text.
 *
 * When ANTHROPIC_API_KEY is set it calls the Anthropic Messages API
 * (claude-haiku-4-5 by default — cheap) via fetch. When the key is absent
 * (dev) OR the call fails/times out OR the in-process rate limit is hit, it
 * returns { text: '', mock: true, mock_reason } with an EMPTY body, so every
 * caller falls through to its own clean deterministic fallback instead of
 * printing an internal placeholder. mock_reason (no_key, rate_limited,
 * http_error, timeout, empty, and with a schema incomplete or bad_json) lets a
 * UI badge template mode without a body.
 *
 * Contract for callers: aiDraft NEVER throws and NEVER blocks longer than its
 * timeout (8s default, caller-overridable via timeoutMs) — it always resolves
 * to { text, mock }. Drafts are advisory text
 * only; nothing here sends an email or mutates data.
 *
 * Adding RESEND_API_KEY does not affect this module — it only reads
 * ANTHROPIC_API_KEY. To make the live path real in prod, set ANTHROPIC_API_KEY
 * (and optionally AI_DRAFT_MODEL) in the environment; no code change needed.
 */

const AI_ENDPOINT = 'https://api.anthropic.com/v1/messages';
// claude-haiku (cheap) default; env-overridable so a newer Haiku can be adopted
// without a code change. Calls that pass `schema` need a model that supports
// structured outputs (claude-haiku-4-5 does). On other models they fall back.
const DEFAULT_MODEL = process.env.AI_DRAFT_MODEL || 'claude-haiku-4-5';
const ANTHROPIC_VERSION = '2023-06-01';
const TIMEOUT_MS = 8000;

// In-process rate limit: cap live-API calls per rolling minute so a runaway
// loop can't burn Anthropic spend. Over the limit we fall back to the
// deterministic mock (never an error).
const RATE_MAX = Number(process.env.AI_DRAFT_RATE_MAX || 30);
const RATE_WINDOW_MS = 60 * 1000;
let _calls = [];

function _rateOk() {
    const now = Date.now();
    _calls = _calls.filter((t) => now - t < RATE_WINDOW_MS);
    if (_calls.length >= RATE_MAX) return false;
    _calls.push(now);
    return true;
}

function _humanizeKey(k) {
    return String(k).replace(/[_\-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function _contextLines(context) {
    if (context === undefined || context === null) return '';
    if (typeof context === 'string') return context.trim();
    if (Array.isArray(context)) {
        return context.map((v) => '- ' + (typeof v === 'object' ? JSON.stringify(v) : String(v))).join('\n');
    }
    if (typeof context === 'object') {
        return Object.entries(context)
            .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
            .map(([k, v]) => `${_humanizeKey(k)}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
            .join('\n');
    }
    return String(context);
}

/**
 * Offline draft body. Returns an EMPTY string by design: callers pair aiDraft
 * with their own clean deterministic fallback (an `if (!text)` or `!r.mock`
 * guard), and a non-empty mock here would shadow that fallback and leak an
 * internal dump into owner-facing or member-facing text. The mock signal
 * travels on { mock, mock_reason } instead, so a UI can badge template mode
 * without ever printing a placeholder body.
 */
function mockDraft() {
    return '';
}

// Standard mock result: no body text, plus a machine-readable reason for the fallback.
function _mock(reason) {
    return { text: '', mock: true, mock_reason: reason };
}

async function aiDraft({ purpose, context, maxTokens, schema, timeoutMs } = {}) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    const max_tokens = Math.max(64, Math.min(Number(maxTokens) || 600, 8192));

    // No key (dev) OR over the rate limit -> empty mock so the caller's clean fallback fires.
    if (!apiKey || !_rateOk()) {
        return _mock(apiKey ? 'rate_limited' : 'no_key');
    }

    const controller = new AbortController();
    // a first call on a new or cold schema compiles it server-side (measured > 8 s), so schema calls get 20 s
    const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || (schema ? 20000 : TIMEOUT_MS)));
    try {
        const system =
            'You are drafting content for Med&X, a Croatian biomedical NGO. ' +
            'Write a clear, ready-to-send draft in American English unless the purpose or context names another language. No emojis. ' +
            'No semicolons. Return only the draft text with no preamble.';
        const user =
            `Purpose: ${purpose || 'Write a short draft.'}\n\n` +
            `Context:\n${_contextLines(context) || '(none provided)'}`;
        const resp = await fetch(AI_ENDPOINT, {
            method: 'POST',
            headers: {
                'x-api-key': apiKey,
                'anthropic-version': ANTHROPIC_VERSION,
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                model: DEFAULT_MODEL,
                max_tokens,
                system,
                messages: [{ role: 'user', content: user }],
                // Structured outputs: with a schema the API constrains the reply to it.
                ...(schema ? { output_config: { format: { type: 'json_schema', schema } } } : {}),
            }),
            signal: controller.signal,
        });
        if (!resp.ok) {
            return _mock('http_error');
        }
        const data = await resp.json();
        // Token accounting per call. The first 40 characters of the purpose identify the surface
        // without reaching the names some callers interpolate later in the purpose.
        const usage = (data && data.usage) || {};
        const stop_reason = (data && data.stop_reason) || '';
        console.log(`[aiDraft] model=${DEFAULT_MODEL} stop=${stop_reason} in=${usage.input_tokens || 0} out=${usage.output_tokens || 0} purpose="${String(purpose || '').slice(0, 40)}"`);
        const text = (data && Array.isArray(data.content) ? data.content : [])
            .filter((b) => b && b.type === 'text')
            .map((b) => b.text)
            .join('\n')
            .trim();
        if (!text) return _mock('empty');
        if (schema) {
            // A refusal or a max_tokens cut can end the reply before the JSON is complete.
            if (stop_reason !== 'end_turn') return _mock('incomplete');
            try { return { text, json: JSON.parse(text), mock: false, stop_reason, usage }; } catch (e) { return _mock('bad_json'); }
        }
        return { text, mock: false, stop_reason, usage };
    } catch (e) {
        // Timeout, network error, bad JSON — anything: fall back, never throw.
        return _mock(e && e.name === 'AbortError' ? 'timeout' : 'http_error');
    } finally {
        clearTimeout(timer);
    }
}

module.exports = { aiDraft, mockDraft };
