'use strict';

/**
 * shared/ai.js — one AI drafting primitive shared by both MedX portals.
 *
 *   aiDraft({ purpose, context, maxTokens }) -> Promise<{ text, mock }>
 *
 * When ANTHROPIC_API_KEY is set it calls the Anthropic Messages API
 * (claude-haiku-4-5 by default — cheap) via fetch. When the key is absent
 * (dev) OR the call fails/times out OR the in-process rate limit is hit, it
 * returns a deterministic mock draft clearly prefixed '[Draft]', built from the
 * context fields, so downstream flows stay testable with zero live sends.
 *
 * Contract for callers: aiDraft NEVER throws and NEVER blocks longer than the
 * 8s timeout — it always resolves to { text, mock }. Drafts are advisory text
 * only; nothing here sends an email or mutates data.
 *
 * Adding RESEND_API_KEY does not affect this module — it only reads
 * ANTHROPIC_API_KEY. To make the live path real in prod, set ANTHROPIC_API_KEY
 * (and optionally AI_DRAFT_MODEL) in the environment; no code change needed.
 */

const AI_ENDPOINT = 'https://api.anthropic.com/v1/messages';
// claude-haiku (cheap) default; env-overridable so a newer Haiku can be adopted
// without a code change.
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

/** Deterministic offline draft. Always prefixed '[Draft]'. */
function mockDraft(purpose, context) {
    const head = '[Draft] ' + (purpose ? String(purpose).trim() : 'Draft');
    const lines = _contextLines(context);
    return lines ? `${head}\n\n${lines}` : head;
}

async function aiDraft({ purpose, context, maxTokens } = {}) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    const max_tokens = Math.max(64, Math.min(Number(maxTokens) || 600, 4096));

    // No key (dev) OR over the rate limit -> deterministic mock, clearly prefixed.
    if (!apiKey || !_rateOk()) {
        return { text: mockDraft(purpose, context), mock: true };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const system =
            'You are drafting content for Med&X, a Croatian biomedical NGO. ' +
            'Write a clear, ready-to-send draft in American English. No emojis. ' +
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
            }),
            signal: controller.signal,
        });
        if (!resp.ok) {
            return { text: mockDraft(purpose, context), mock: true };
        }
        const data = await resp.json();
        const text = (data && Array.isArray(data.content) ? data.content : [])
            .filter((b) => b && b.type === 'text')
            .map((b) => b.text)
            .join('\n')
            .trim();
        if (!text) return { text: mockDraft(purpose, context), mock: true };
        return { text, mock: false };
    } catch (e) {
        // Timeout, network error, bad JSON — anything: fall back, never throw.
        return { text: mockDraft(purpose, context), mock: true };
    } finally {
        clearTimeout(timer);
    }
}

module.exports = { aiDraft, mockDraft };
