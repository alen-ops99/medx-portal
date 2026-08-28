// js/api.js — the ONE fetch wrapper. JSON in/out, Bearer token from the session,
// 401 → session cleared + `medx:unauthorized` event (app.js routes to sign-in with ?next=),
// 503 {waking:true} → full-screen "waking up" overlay + retry with backoff (staging backend
// boots two servers for up to ~2 min), 429 → ApiError with the server's message.
//
//   import { api } from './api.js';
//   const me = await api.get('/api/auth/me');
//   await api.post('/api/auth/login', { email, password }, { noAuth: true });
//   try { … } catch (e) { if (e instanceof api.ApiError && e.status === 429) toast(e.message) }
//
// Always pass literal '/api/…' paths (scripts/check-api-contract.js greps for them).
import cfg from './config.js';
import { session } from './state.js';

export class ApiError extends Error {
  constructor(status, message, data) { super(message || 'Request failed'); this.name = 'ApiError'; this.status = status; this.data = data || null; }
  get isNetwork() { return this.status === 0; }
  get isRateLimit() { return this.status === 429; }
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
        <img src="/assets/logo-white.png" alt="med&amp;X" style="height:26px;display:block">
        <div class="line">One moment.</div>
        <p class="why">The review portal is waking up — about a minute after a quiet spell. Your session is safe; this page continues by itself.</p>
        <div class="bar"></div>
        <div class="status" data-role="wake-status">WAKING UP</div>
      </div>`;
    document.body.appendChild(wakeOverlay);
  }
  const st = wakeOverlay.querySelector('[data-role="wake-status"]');
  if (st && payload) {
    const bits = [];
    if ('member' in payload) bits.push('MEMBER ' + (payload.member ? 'READY' : 'STARTING'));
    if ('admin' in payload) bits.push('ADMIN ' + (payload.admin ? 'READY' : 'STARTING'));
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
  // absolute URL for API-hosted resources referenced by relative path in responses (e.g. /qr/<id>.png)
  url: buildUrl,
  ApiError,
  // Promise.allSettled helper: returns values (null on failure) so a Home block never kills the page
  settle: async (map) => {
    const keys = Object.keys(map);
    const results = await Promise.allSettled(keys.map(k => map[k]));
    const out = {};
    results.forEach((r, i) => { out[keys[i]] = r.status === 'fulfilled' ? r.value : null; if (r.status === 'rejected' && !(r.reason instanceof ApiError && r.reason.status === 401)) console.warn('[api] ' + keys[i] + ' failed:', r.reason && r.reason.message); });
    return out;
  }
};
export default api;
