// js/app.js — BOOT: entry-URL contracts (legacy hashes, ?mxt=, ?verified=, Stripe returns,
// PWA shortcuts), session restore, chrome mount, router start, service worker.
import cfg from './config.js';
import { session, state } from './state.js';
import { api } from './api.js';
import { ui } from './ui.js';
import router from './router.js';
import { ROUTES, NOT_FOUND } from './routes.js';
import { chrome } from './chrome.js';

// Legacy hash routes (user-portal/frontend/index.html `#up-section-<id>` / staff `#section-<id>` / plain
// `#<id>`) → v2 routes. Anything not listed keeps the current path.
const HASH_MAP = {
  dashboard: '/app/home', home: '/app/home', plexus: '/app/plexus', gala: '/app/gala', accelerator: '/app/accelerator',
  forum: '/app/forum', af26: '/app/forum', bridges: '/app/bridges', 'building-bridges': '/app/bridges', network: '/app/network',
  messages: '/app/messages', communications: '/app/messages', profile: '/app/profile', settings: '/app/profile',
  mymedx: '/app/me', wallet: '/app/me', me: '/app/me', rewards: '/app/me', talks: '/app/home', speaker: '/app/home',
  scanner: '/app/home', admin: '/app/home'
};

// Stripe return (audit §3.4): `?payment=success|cancelled` + `type=accelerator&app=` | `type=forum&reg=` |
// `reg=` (Plexus) | `gala=`. Producer lines: server.js :15075 :17513 :20201 :27817 :27889.
function paymentReturn(q) {
  const pay = q.get('payment'); if (pay !== 'success' && pay !== 'cancelled') return null;
  const ok = pay === 'success', type = q.get('type') || (q.get('gala') ? 'gala' : 'plexus');
  const to = type === 'gala' ? '/app/me' : type === 'accelerator' ? '/app/accelerator' : type === 'forum' ? '/app/forum' : '/app/plexus/mine';
  const msg = {
    gala: ok ? 'Payment received — your Gala seat is confirmed. The ticket is in My Med&X.' : 'Payment cancelled — nothing was charged. Your seat request is unchanged.',
    accelerator: ok ? 'Payment received — thank you. Your application is updated.' : 'Payment cancelled — nothing was charged.',
    forum: ok ? 'Payment received — your Forum registration is confirmed.' : 'Payment cancelled — nothing was charged.',
    plexus: ok ? 'Payment received — your Plexus ticket is on its way.' : 'Payment cancelled — nothing was charged. Your registration stays reserved.'
  }[type] || (ok ? 'Payment received.' : 'Payment cancelled — nothing was charged.');
  return { to, msg, ok };
}

// Consumes the entry params once, cleans the URL, returns callbacks to run after the router starts.
function handleEntry() {
  const url = new URL(location.href), q = url.searchParams, after = [];
  let changed = false, pathOverride = null;
  const take = k => { const v = q.get(k); if (v !== null) { q.delete(k); changed = true; } return v; };
  const mxt = take('mxt'); if (mxt) session.set(mxt, null);
  if (take('logout') === 'true') { session.clear(); pathOverride = '/app/auth/welcome'; }
  const verified = take('verified');
  if (verified) after.push(() => {
    if (verified === 'true' || verified === 'already') {
      if (session.isAuthed) { session.update({ email_verified: 1 }); try { sessionStorage.removeItem('medx_verify_dismissed'); } catch (e) {} }
      ui.toast(verified === 'already' ? 'Your email is already confirmed.' : 'Email confirmed — you are all set.');
      if (!session.isAuthed) router.replace('/app/auth/signin?notice=verified');
    } else {
      ui.toast(verified === 'expired' ? 'That confirmation link has expired — resend a new one from the banner.' : 'That confirmation link is not valid.', { kind: 'error' });
    }
  });
  const pay = paymentReturn(q);
  if (pay) { ['payment', 'type', 'reg', 'app', 'gala', 'session_id'].forEach(take); after.push(() => { ui.toast(pay.msg, { kind: pay.ok ? 'ok' : 'error', ms: 5000 }); router.replace(pay.to); }); }
  const view = take('view'); take('app');
  if (view) after.push(() => router.replace(view === 'ticket' ? '/app/me' : view === 'schedule' ? '/app/plexus/program' : '/app/home'));
  if (take('login') === 'true') after.push(() => { if (!session.isAuthed) router.replace('/app/auth/signin'); });
  if (take('register')) after.push(() => ui.toast('Direct registration links open the Plexus form — use the link from your email.', { ms: 5000 }));
  // hashes
  if (location.hash.length > 1) {
    const raw = location.hash.slice(1).replace(/^up-section-/, '').replace(/^section-/, '');
    const key = raw.split(/[?&=/]/)[0].toLowerCase();
    if (HASH_MAP[key]) { pathOverride = pathOverride || HASH_MAP[key]; changed = true; }
  }
  if (changed || pathOverride) {
    const qs = q.toString();
    const target = (pathOverride || url.pathname) + (qs ? '?' + qs : '');
    try { history.replaceState(null, '', target); } catch (e) {}
  }
  return after;
}

async function refreshMe() {
  if (!session.isAuthed) return;
  try {
    const me = await api.get('/api/auth/me');
    const prev = session.user || {};
    // Prefer the server's email_verified (added to /api/auth/me on this branch); keep ours when absent
    session.update(Object.assign({}, me, me.email_verified === undefined ? { email_verified: prev.email_verified } : {}));
    chrome.refresh();
  } catch (e) { /* 401 handled by api.js; network errors keep the cached user */ }
}

function registerSw() {
  if (!('serviceWorker' in navigator)) return;
  const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  if (local && !/[?&]sw=1/.test(location.search)) return; // dev: no cache-first JS unless asked (?sw=1)
  navigator.serviceWorker.register('/sw.js').catch(e => console.warn('[sw] register failed', e.message));
}

function boot() {
  ui.installDelegates();
  session.restore();
  const after = handleEntry();
  document.addEventListener('medx:unauthorized', () => {
    const next = location.pathname + location.search;
    if (!location.pathname.startsWith('/app/auth')) router.replace('/app/auth/signin' + (next && next !== '/' ? '?next=' + encodeURIComponent(next) : ''));
    else state.set({ user: null });
  });
  router.addAll(ROUTES).notFound(NOT_FOUND)
    .hook('beforeRender', ({ route, title }) => { state.set({ viewTitle: (route && route.title) || '' }); chrome.closeDrawer(); chrome.closePopover(); })
    .hook('afterRender', ({ title }) => { if (title) state.set({ viewTitle: title }); });
  chrome.mount();
  router.start().then(() => { after.forEach(fn => { try { fn(); } catch (e) { console.error('[boot] entry handler failed', e); } }); });
  refreshMe();
  registerSw();
  if (cfg.isStaging) console.info('[Med&X v2] staging build → API', cfg.apiBase);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
export { boot };
