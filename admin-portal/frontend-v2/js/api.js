// js/api.js — the ONE fetch wrapper. JSON in/out, Bearer token from the session (localStorage
// `medx_token`), 401 → session cleared + `medx:unauthorized` event (app.js routes to /signin?next=),
// 403 { section } → ApiError with .section (the permission lock — NEVER clears the session),
// 503 { waking:true } → full-screen "waking up" overlay + retry with backoff (the staging launcher
// boots both backends for up to ~2 min), 429 → ApiError with the server's message.
//
//   import { api } from './api.js';
//   const me = await api.get('/api/auth/me');
//   await api.post('/api/auth/login', { email, password }, { noAuth: true });
//   const r = await api.settle({ tasks: api.get('/api/admin/tasks'), gala: api.get('/api/admin/gala/registrations') });
//   r.tasks /* value or null */   r.$errors.gala /* ApiError or undefined → e.status === 403 → locked block */
//
// Always pass literal '/api/…' paths (scripts/check-api-contract.js greps for them).
import cfg from './config.js';
import { session } from './state.js';

export class ApiError extends Error {
  constructor(status, message, data) { super(message || 'Request failed'); this.name = 'ApiError'; this.status = status; this.data = data || null; this.section = data && data.section ? String(data.section) : null; }
  get isNetwork() { return this.status === 0; }
  get isRateLimit() { return this.status === 429; }
  get isLocked() { return this.status === 403 && !!this.section; }
}

const BACKOFF_MS = [2000, 3000, 5000, 8000, 10000];
const WAKE_MAX_MS = 4 * 60 * 1000;
let wakeOverlay = null;
let wakeStartedAt = 0;

function showWaking(payload) {
  if (!wakeOverlay) {
    wakeOverlay = document.createElement('div');
    wakeOverlay.className = 'mx-waking';
    wakeOverlay.setAttribute('role', 'status');
    wakeOverlay.setAttribute('aria-live', 'polite');
    wakeOverlay.innerHTML = `
      <div class="mx-waking-inner">
        <span style="display:flex;flex-direction:column;align-items:flex-end;gap:2px"><img src="/assets/logo-white.png" alt="med&amp;X" style="height:22px;display:block"><span style="font:600 8px Inter,sans-serif;letter-spacing:.3em;color:#c9a962">ADMIN</span></span>
        <div class="line">One moment.</div>
        <p class="why">The admin portal is waking up — about a minute after a quiet spell. Your session is safe; this page continues by itself.</p>
        <div class="bar"></div>
        <div class="status" data-role="wake-status">WAKING UP</div>
      </div>`;
    document.body.appendChild(wakeOverlay);
  }
  const st = wakeOverlay.querySelector('[data-role="wake-status"]');
  if (st && payload) {
    const bits = [];
    if ('admin' in payload) bits.push('ADMIN ' + (payload.admin ? 'READY' : 'STARTING'));
    if ('member' in payload) bits.push('MEMBER ' + (payload.member ? 'READY' : 'STARTING'));
    if (payload.uptime_s != null) bits.push(payload.uptime_s + ' S');
    st.textContent = (cfg.isStaging ? 'STAGING · ' : '') + (bits.join(' · ') || 'WAKING UP');
  }
}
function hideWaking() { if (wakeOverlay) { wakeOverlay.remove(); wakeOverlay = null; } wakeStartedAt = 0; }
const sleep = ms => new Promise(r => setTimeout(r, ms));

function buildUrl(path) {
  if (/^https?:\/\//i.test(path)) return path;
  return cfg.apiBase + (path.startsWith('/') ? path : '/' + path);
}

async function request(method, path, body, opts = {}) {
  const url = buildUrl(path);
  const headers = Object.assign({ Accept: 'application/json' }, opts.headers || {});
  let payload = body;
  if (body !== undefined && body !== null && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  if (!opts.noAuth && session.token) headers.Authorization = 'Bearer ' + session.token;
  let attempt = 0;
  for (;;) {
    let res;
    try {
      res = await fetch(url, { method, headers, body: payload, credentials: 'omit', signal: opts.signal });
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      throw new ApiError(0, 'You appear to be offline — check the connection and try again.', null);
    }
    const text = await res.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch (e) { data = { raw: text }; } }

    if (res.status === 503 && data && data.waking) {
      if (!wakeStartedAt) wakeStartedAt = Date.now();
      showWaking(data);
      if (Date.now() - wakeStartedAt > WAKE_MAX_MS) { hideWaking(); throw new ApiError(503, 'The portal is taking longer than usual to wake up. Please try again in a minute.', data); }
      await sleep(BACKOFF_MS[Math.min(attempt++, BACKOFF_MS.length - 1)]);
      continue;
    }
    if (wakeOverlay) hideWaking();

    if (res.status === 401 && !opts.noAuth && !opts.keepSession) {
      session.clear();
      document.dispatchEvent(new CustomEvent('medx:unauthorized', { detail: { path } }));
      throw new ApiError(401, 'Your session has expired — please sign in again.', data);
    }
    if (!res.ok) {
      const msg = (data && (data.error || data.message)) ||
        (res.status === 429 ? 'Too many attempts — please wait a few minutes and try again.' :
         res.status === 403 ? 'You do not have access to that.' :
         res.status === 404 ? 'That endpoint is not available yet.' : (res.statusText || 'Request failed'));
      const err = new ApiError(res.status, msg, data);
      err.retryAfter = res.headers.get('Retry-After');
      throw err;
    }
    return data;
  }
}

export const api = {
  get: (path, opts) => request('GET', path, undefined, opts),
  post: (path, body, opts) => request('POST', path, body === undefined ? {} : body, opts),
  put: (path, body, opts) => request('PUT', path, body === undefined ? {} : body, opts),
  patch: (path, body, opts) => request('PATCH', path, body === undefined ? {} : body, opts),
  del: (path, opts) => request('DELETE', path, undefined, opts),
  url: buildUrl,
  ApiError,
  // Promise.allSettled helper: values (null on failure) + `$errors` (ApiError per failed key) so one
  // failing/locked call never kills the page and a block can render its own locked mini-state.
  settle: async (map) => {
    const keys = Object.keys(map);
    const results = await Promise.allSettled(keys.map(k => map[k]));
    const out = { $errors: {} };
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') { out[keys[i]] = r.value; return; }
      out[keys[i]] = null; out.$errors[keys[i]] = r.reason;
      const e = r.reason;
      if (!(e instanceof ApiError && (e.status === 401 || e.status === 403))) console.warn('[api] ' + keys[i] + ' failed:', e && e.message);
    });
    return out;
  }
};
export default api;
