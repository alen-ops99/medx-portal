// js/app.js — BOOT: legacy-hash contracts (#section-id from the v1 admin SPA), session restore,
// chrome mount, router start, health pill refresh, service-worker-free PWA (manifest only for now).
import cfg from './config.js';
import { session, state } from './state.js';
import { api } from './api.js';
import { ui } from './ui.js';
import router from './router.js';
import { ROUTES, NOT_FOUND, LOCKED } from './routes.js';
import { chrome } from './chrome.js';
import { health } from './health.js';
import { routeForSection } from './facts.js';
import { perms } from './perms.js';

// Consumes entry params/hashes once and cleans the URL. `#<section-id>` deep links from the v1 admin
// SPA (contract §3.3: keep `#<section-id>` URLs working) map to v2 routes; `#scanner` → Event Day.
function handleEntry() {
  const url = new URL(location.href), q = url.searchParams, after = [];
  let changed = false, pathOverride = null;
  const take = k => { const v = q.get(k); if (v !== null) { q.delete(k); changed = true; } return v; };
  if (take('logout') === 'true') { session.clear(); pathOverride = '/signin'; }
  take('app');
  if (take('track') !== null) after.push(() => router.replace('/event-day'));
  if (location.hash.length > 1 && (location.pathname === '/' || location.pathname === '/today')) {
    const raw = location.hash.slice(1).replace(/^section-/, '');
    const key = raw.split(/[?&=/]/)[0].toLowerCase();
    const to = routeForSection(key, null);
    if (to) { pathOverride = pathOverride || to; changed = true; }
  }
  if (changed || pathOverride) {
    const qs = q.toString();
    try { history.replaceState(null, '', (pathOverride || url.pathname) + (qs ? '?' + qs : '') + (pathOverride ? '' : url.hash)); } catch (e) {}
  }
  return after;
}

// On a cold load the router's permission guard runs against the CACHED user (localStorage medx_user).
// A session restored with a token but no/stale user data would therefore pass a guarded route it should
// not — so once /api/auth/me lands with the authoritative allowed_sections, re-resolve the current route
// if the locked verdict changed (either direction). The server 403s regardless; this keeps the UI honest.
function reResolveIfLockChanged() {
  const hit = router.match(location.pathname);
  const route = hit && hit.route;
  const shouldLock = !!(route && route.sections && !perms.canAny(route.sections));
  const isLocked = !!document.querySelector('#view [data-screen-label="Locked"]');
  if (shouldLock !== isLocked) router.resolve({ popped: true });
}

async function refreshMe() {
  if (!session.isAuthed) return;
  try {
    const me = await api.get('/api/auth/me');
    session.update(me);
    if (me && me.must_change_password) return router.replace('/signin?step=password');
    reResolveIfLockChanged();
    chrome.refresh();
    health.refresh();
  } catch (e) { /* 401 handled by api.js; network errors keep the cached user */ }
}

function boot() {
  ui.installDelegates();
  session.restore();
  const after = handleEntry();
  document.addEventListener('medx:unauthorized', () => {
    const next = location.pathname + location.search;
    if (location.pathname !== '/signin') router.replace('/signin' + (next && next !== '/' && next !== '/today' ? '?next=' + encodeURIComponent(next) : ''));
    else state.set({ user: null });
  });
  router.addAll(ROUTES).notFound(NOT_FOUND).locked(LOCKED)
    .hook('beforeRender', ({ route }) => { state.set({ viewTitle: (route && route.title) || '' }); chrome.closePopover(); document.body.classList.remove('menu-open'); })
    .hook('afterRender', ({ title }) => { if (title) state.set({ viewTitle: title }); });
  chrome.mount();
  router.start().then(() => { after.forEach(fn => { try { fn(); } catch (e) { console.error('[boot] entry handler failed', e); } }); });
  refreshMe();
  if (cfg.isStaging) console.info('[Med&X admin v2] staging build → API', cfg.apiBase || location.origin, '· member probe via', cfg.memberBase || '(same origin)');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
export { boot };
