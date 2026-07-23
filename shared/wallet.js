/**
 * shared/wallet.js — event-ticket wallet pass providers (Google implemented, Apple stubbed).
 *
 * ONE ticket record → many pass formats. The single source of truth for admission is the
 * per-registration crypto `checkin_token` (see registrations.checkin_token). Every pass format
 * (Google Wallet EventTicketObject, a future Apple .pkpass, printed/email QR) encodes that SAME
 * token in its barcode, and the door scanner resolves the token to one registration + one
 * per-(ticket,event) check-in row. Adding Apple later is additive: implement `providers.apple`
 * against the identical field bag — no schema change.
 *
 * Google Wallet is fully automatic and server-side only:
 *   - classes are get-or-created per conference via the walletobjects REST API (no console visit);
 *   - objects are get-or-created per registration;
 *   - revoke PATCHes the object state to INACTIVE;
 *   - the signed "Add to Google Wallet" link is an RS256 `savetowallet` JWT.
 * The service-account JSON lives ONLY in env (GOOGLE_WALLET_SA_KEY) — never sent to the browser.
 *
 * Everything degrades gracefully: when the env is unconfigured, isConfigured() is false and the
 * callers return {configured:false} instead of erroring, so registration/check-in never break.
 *
 * Node 18+ global fetch is used (no HTTP dep). RS256 signing uses Node's built-in `crypto` — the
 * module is dependency-free on purpose (like shared/db.js), so it resolves the same from either
 * backend's node_modules regardless of where it is required from.
 */
'use strict';

const crypto = require('crypto');

// --- minimal RS256 JWT signer (built-in crypto; no jsonwebtoken dependency) ---
function b64url(input) {
    return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function signRS256(claims, privateKeyPem) {
    const header = { alg: 'RS256', typ: 'JWT' };
    const signingInput = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(claims));
    const sig = crypto.sign('RSA-SHA256', Buffer.from(signingInput), privateKeyPem);
    return signingInput + '.' + b64url(sig);
}

// Base URLs are env-overridable so tests can stay hermetic (point at a black-hole) and the owner
// could route through a proxy if ever needed. Defaults are the real Google endpoints.
const OBJECTS_BASE = process.env.GOOGLE_WALLET_OBJECTS_BASE || 'https://walletobjects.googleapis.com/walletobjects/v1';
const OAUTH_TOKEN_URL = process.env.GOOGLE_WALLET_OAUTH_URL || 'https://oauth2.googleapis.com/token';
const SAVE_URL_PREFIX = 'https://pay.google.com/gp/v/save/';
const ISSUER_SCOPE = 'https://www.googleapis.com/auth/wallet_object.issuer';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
function getConfig(env) {
    env = env || process.env;
    const issuerId = String(env.GOOGLE_WALLET_ISSUER_ID || '').trim();
    const saKeyRaw = env.GOOGLE_WALLET_SA_KEY || '';
    let sa = null, saError = null;
    if (saKeyRaw) {
        try { sa = typeof saKeyRaw === 'string' ? JSON.parse(saKeyRaw) : saKeyRaw; }
        catch (e) { saError = 'GOOGLE_WALLET_SA_KEY is not valid JSON'; }
    }
    const configured = !!(issuerId && sa && sa.client_email && sa.private_key);
    return { issuerId, sa, saError, configured };
}

function isConfigured(env) { return getConfig(env).configured; }

// Wallet ids allow [A-Za-z0-9._-]; collapse anything else to underscore.
function safeSeg(s) { return String(s == null ? '' : s).replace(/[^A-Za-z0-9_.-]/g, '_'); }

/**
 * Deterministic class id for a conference slug. The owner's already-approved Plexus Week 2026
 * class id (doubled-issuer-prefix form) is reused verbatim via env; any other conference mints
 * `<ISSUER>.<slug>`. Idempotent — safe to call every time.
 */
function classIdFor(slug, env) {
    env = env || process.env;
    const { issuerId } = getConfig(env);
    if (!issuerId) return '';
    const approved = env.GOOGLE_WALLET_EVENT_CLASS_ID || env.GOOGLE_WALLET_TICKET_CLASS_ID || '';
    if (approved && (slug === 'plexus-2026' || slug === 'plexus_week_2026' || slug === 'plexus-week-2026')) {
        return approved;
    }
    return issuerId + '.' + safeSeg(slug || 'event');
}

/** Deterministic, unique object id for one registration (idempotent get-or-create key). */
function objectIdFor(regId, env) {
    const { issuerId } = getConfig(env);
    return issuerId + '.tkt_' + safeSeg(regId);
}

// ---------------------------------------------------------------------------
// Pure builders (no network) — unit-testable with a mock SA key
// ---------------------------------------------------------------------------
function buildEventTicketClass(opts) {
    opts = opts || {};
    const cls = {
        id: opts.classId,
        issuerName: opts.issuerName || 'Med&X',
        reviewStatus: opts.reviewStatus || 'UNDER_REVIEW',
        eventName: { defaultValue: { language: 'en', value: opts.eventName || 'Med&X Event' } }
    };
    if (opts.venue) {
        cls.venue = {
            name: { defaultValue: { language: 'en', value: opts.venue } },
            address: { defaultValue: { language: 'en', value: opts.venueAddress || opts.venue } }
        };
    }
    if (opts.startISO) cls.dateTime = { start: opts.startISO, end: opts.endISO || undefined };
    if (opts.logoUri) cls.logo = { sourceUri: { uri: opts.logoUri } };
    if (opts.hexBackgroundColor) cls.hexBackgroundColor = opts.hexBackgroundColor;
    if (opts.homepageUri) cls.homepageUri = { uri: opts.homepageUri, description: 'Med&X' };
    return cls;
}

/**
 * Build an EventTicketObject from the shared field bag. `token` is the crypto checkin_token and
 * becomes barcode.value — the single admission credential. Apple's future builder reads the same bag.
 */
function buildEventTicketObject(f) {
    f = f || {};
    const text = [];
    if (f.category) text.push({ id: 'category', header: 'Access', body: String(f.category) });
    if (f.events && f.events.length) text.push({ id: 'events', header: 'Included events', body: f.events.join(' · ') });
    if (f.galaTable) text.push({ id: 'gala_table', header: 'Gala table', body: String(f.galaTable) });
    if (f.statusLabel) text.push({ id: 'status', header: 'Status', body: String(f.statusLabel) });
    if (f.registrationNumber) text.push({ id: 'reg_no', header: 'Registration', body: String(f.registrationNumber) });
    const obj = {
        id: f.objectId,
        classId: f.classId,
        state: f.state || 'ACTIVE',
        hexBackgroundColor: f.hexBackgroundColor || '#14100d',
        barcode: { type: 'QR_CODE', value: f.token, alternateText: f.ticketNumberAlt || (f.registrationNumber || '') },
        ticketHolderName: f.name || 'Med&X Guest',
        textModulesData: text
    };
    if (f.registrationNumber) obj.ticketNumber = String(f.registrationNumber);
    if (f.logoUri) obj.logo = { sourceUri: { uri: f.logoUri } };
    if (f.seatLabel || f.galaTable) {
        obj.seatInfo = { seat: { defaultValue: { language: 'en', value: String(f.seatLabel || f.galaTable) } } };
    }
    return obj;
}

/** RS256 `savetowallet` JWT + the pay.google.com save link (client-openable, no secrets in it). */
function buildSaveUrl(input, env) {
    const cfg = getConfig(env);
    if (!cfg.configured) throw new Error('wallet_not_configured');
    const payload = {};
    if (input.classes && input.classes.length) payload.eventTicketClasses = input.classes;
    if (input.objects && input.objects.length) payload.eventTicketObjects = input.objects;
    const claims = {
        iss: cfg.sa.client_email,
        aud: 'google',
        typ: 'savetowallet',
        iat: Math.floor(Date.now() / 1000),
        origins: input.origins || [],
        payload
    };
    const token = signRS256(claims, cfg.sa.private_key);
    return { jwt: token, saveUrl: SAVE_URL_PREFIX + token };
}

// ---------------------------------------------------------------------------
// Network (REST) — only reached when isConfigured()
// ---------------------------------------------------------------------------
async function fetchWithTimeout(url, opts, ms) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms || 10000);
    try { return await fetch(url, Object.assign({}, opts, { signal: ctl.signal })); }
    finally { clearTimeout(t); }
}

let _tokenCache = { token: null, exp: 0 };
async function getAccessToken(env) {
    const cfg = getConfig(env);
    if (!cfg.configured) throw new Error('wallet_not_configured');
    const now = Math.floor(Date.now() / 1000);
    if (_tokenCache.token && _tokenCache.exp - 60 > now) return _tokenCache.token;
    const assertion = signRS256(
        { iss: cfg.sa.client_email, scope: ISSUER_SCOPE, aud: OAUTH_TOKEN_URL, iat: now, exp: now + 3600 },
        cfg.sa.private_key
    );
    const body = new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion
    });
    const r = await fetchWithTimeout(OAUTH_TOKEN_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) throw new Error('wallet_oauth_failed: ' + (j.error_description || j.error || r.status));
    _tokenCache = { token: j.access_token, exp: now + (j.expires_in || 3600) };
    return _tokenCache.token;
}

async function apiCall(method, apiPath, body, token) {
    const r = await fetchWithTimeout(OBJECTS_BASE + apiPath, {
        method,
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
    });
    let json = null;
    try { json = await r.json(); } catch (e) { /* 404s can be empty */ }
    return { status: r.status, json };
}

/** Idempotent get-or-create of an EventTicketClass. Returns {created, classId}. */
async function ensureEventClass(classBody, env) {
    const token = await getAccessToken(env);
    const id = classBody.id;
    const got = await apiCall('GET', '/eventTicketClass/' + encodeURIComponent(id), null, token);
    if (got.status === 200) return { created: false, classId: id };
    if (got.status === 404) {
        const made = await apiCall('POST', '/eventTicketClass', classBody, token);
        if (made.status === 200 || made.status === 201) return { created: true, classId: id };
        throw new Error('wallet_class_insert_failed: ' + made.status + ' ' + JSON.stringify(made.json));
    }
    throw new Error('wallet_class_get_failed: ' + got.status);
}

/** Idempotent get-or-create of an EventTicketObject. Returns {created, objectId, object}. */
async function ensureEventObject(objectBody, env) {
    const token = await getAccessToken(env);
    const id = objectBody.id;
    const got = await apiCall('GET', '/eventTicketObject/' + encodeURIComponent(id), null, token);
    if (got.status === 200) return { created: false, objectId: id, object: got.json };
    if (got.status === 404) {
        const made = await apiCall('POST', '/eventTicketObject', objectBody, token);
        if (made.status === 200 || made.status === 201) return { created: true, objectId: id, object: made.json };
        throw new Error('wallet_object_insert_failed: ' + made.status + ' ' + JSON.stringify(made.json));
    }
    throw new Error('wallet_object_get_failed: ' + got.status);
}

/** PATCH an object's state (e.g. 'INACTIVE' on revoke, 'ACTIVE' on restore). No-op if absent. */
async function patchObjectState(objectId, state, env) {
    const token = await getAccessToken(env);
    const res = await apiCall('PATCH', '/eventTicketObject/' + encodeURIComponent(objectId), { state }, token);
    if (res.status === 200) return { ok: true, state };
    if (res.status === 404) return { ok: false, reason: 'object_not_found' };
    throw new Error('wallet_object_patch_failed: ' + res.status);
}

// ---------------------------------------------------------------------------
// Providers registry — google implemented, apple documented stub
// ---------------------------------------------------------------------------
const providers = {
    google: {
        key: 'google',
        isConfigured,
        classIdFor,
        objectIdFor,
        buildEventTicketClass,
        buildEventTicketObject,
        buildSaveUrl,
        getAccessToken,
        ensureEventClass,
        ensureEventObject,
        patchObjectState
    },
    apple: {
        key: 'apple',
        // Reads the SAME env family the dormant /api/member/wallet/apple/* route already checks.
        isConfigured(env) {
            env = env || process.env;
            return !!(env.APPLE_WALLET_CERT_PEM && env.APPLE_WALLET_KEY_PEM
                && env.APPLE_WALLET_TEAM_ID && env.APPLE_WALLET_PASS_TYPE_ID);
        },
        // TODO(apple): implement .pkpass generation once an Apple Pass Type ID cert exists.
        // It must consume the IDENTICAL field bag as buildEventTicketObject (name, registrationNumber,
        // category, events, galaTable, statusLabel, token) and set the barcode message to `token`,
        // then zip pass.json + manifest.json + a PKCS#7 detached signature and return a Buffer
        // (application/vnd.apple.pkpass). No DB/schema change is required — the token is the anchor.
        buildPass() { throw new Error('apple_pkpass_not_implemented'); }
    }
};

module.exports = {
    // config + ids
    getConfig, isConfigured, classIdFor, objectIdFor, safeSeg,
    // pure builders
    buildEventTicketClass, buildEventTicketObject, buildSaveUrl,
    // network
    getAccessToken, ensureEventClass, ensureEventObject, patchObjectState,
    // registry
    providers,
    // constants (for tests / callers)
    OBJECTS_BASE, OAUTH_TOKEN_URL, SAVE_URL_PREFIX, ISSUER_SCOPE
};
