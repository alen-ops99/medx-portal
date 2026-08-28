// js/router.js — History-API router. Routes are a TABLE (js/routes.js) of
//   { path: '/app/plexus/:tab?', view: () => import('./views/plexus.js'), auth: true,
//     layout: 'portal' | 'auth' | 'bare', active: 'Plexus', title: 'Plexus Conference' }
// A view module exports default { title, render(root, ctx), destroy() } (see ARCHITECTURE.md).
// Guards: auth routes bounce to /app/auth/signin?next=…; the auth screens bounce a signed-in
// member to Home. Unknown paths render views/notfound.js (System Pages 404). Scroll position is
// restored on back/forward and reset to top on forward navigation. Server-rendered paths
// (cfg.serverPaths) are never intercepted — a full page load reaches the Express server.
import cfg from './config.js';
import { session, state } from './state.js';

const routes = [];
let current = { module: null, root: null, path: null };
let notFoundLoader = null;
let hooks = { beforeRender: null, afterRender: null, title: t => t ? t + ' · Med&X' : 'Med&X Member Portal' };

function compile(path) {
  const keys = [];
  const re = '^' + path
    .replace(/\/:([a-zA-Z_]+)\?/g, (_, k) => { keys.push(k); return '(?:/([^/]+))?'; })
    .replace(/:([a-zA-Z_]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })
    .replace(/\*/g, '.*') + '/?$';
  return { regex: new RegExp(re), keys };
}
export function parseQuery(search) {
  const q = {}; new URLSearchParams(search || '').forEach((v, k) => { q[k] = v; }); return q;
}
function isServerPath(pathname) {
  return cfg.serverPaths.some(p => pathname === p || pathname.startsWith(p + '/'));
}

export const router = {
  add(def) { const c = compile(def.path); routes.push(Object.assign({}, def, c)); return this; },
  addAll(list) { list.forEach(d => this.add(d)); return this; },
  notFound(loader) { notFoundLoader = loader; return this; },
  hook(name, fn) { hooks[name] = fn; return this; },
  match(pathname) {
    for (const r of routes) {
      const m = r.regex.exec(pathname);
      if (!m) continue;
      const params = {}; r.keys.forEach((k, i) => { params[k] = m[i + 1] ? decodeURIComponent(m[i + 1]) : undefined; });
      return { route: r, params };
    }
    return null;
  },
  navigate(to, { replace = false, state: st = null } = {}) {
    if (/^https?:\/\//i.test(to)) { window.location.assign(to); return; }
    const url = new URL(to, window.location.origin);
    if (isServerPath(url.pathname)) { window.location.assign(url.href); return; }
    // remember where the current entry was scrolled before leaving it
    try { history.replaceState(Object.assign({}, history.state || {}, { scrollY: window.scrollY }), '', location.href); } catch (e) {}
    const entry = Object.assign({ scrollY: 0 }, st || {});
    try { history[replace ? 'replaceState' : 'pushState'](entry, '', url.pathname + url.search + url.hash); } catch (e) { window.location.assign(url.href); return; }
    return this.resolve({ popped: false });
  },
  replace(to) { return this.navigate(to, { replace: true }); },
  back() { history.back(); },
  get path() { return location.pathname; },
  async resolve({ popped = false } = {}) {
    const pathname = location.pathname;
    const query = parseQuery(location.search);
    let hit = this.match(pathname);
    let route = hit ? hit.route : null, params = hit ? hit.params : {};
    // guards
    if (route && route.auth && !session.isAuthed) {
      if (route.guestTo) return this.navigate(route.guestTo, { replace: true });
      const next = pathname + location.search;
      return this.navigate('/app/auth/signin' + (next && next !== '/' && next !== '/app' && next !== '/app/home' ? '?next=' + encodeURIComponent(next) : ''), { replace: true });
    }
    if (route && route.guestOnly && session.isAuthed) return this.navigate(query.next && query.next.startsWith('/app') ? query.next : '/app/home', { replace: true });
    const loader = route ? route.view : notFoundLoader;
    if (!loader) { console.error('[router] no view for', pathname); return; }
    const seq = (this._seq = (this._seq || 0) + 1);
    let mod;
    try { mod = await loader(); } catch (e) { console.error('[router] failed to load view for ' + pathname, e); mod = notFoundLoader ? await notFoundLoader() : null; }
    if (seq !== this._seq || !mod) return; // superseded by a newer navigation
    const view = mod.default || mod;
    const ctx = { params, query, path: pathname, route, navigate: (to, o) => this.navigate(to, o), user: session.user, popped };
    // tear down the previous view
    if (current.module && typeof current.module.destroy === 'function') { try { current.module.destroy(); } catch (e) { console.error('[router] destroy failed', e); } }
    const layout = (route && route.layout) || (mod.layout) || 'portal';
    const active = (route && route.active) || null;
    state.set({ layout, active });
    if (hooks.beforeRender) hooks.beforeRender({ route, params, query, layout, active, view });
    const root = document.getElementById('view');
    root.innerHTML = '';
    root.scrollTop = 0;
    current = { module: view, root, path: pathname };
    const title = typeof view.title === 'function' ? view.title(ctx) : (view.title || (route && route.title) || '');
    document.title = hooks.title(title);
    try { await view.render(root, ctx); } catch (e) { console.error('[router] render failed for ' + pathname, e); root.innerHTML = renderError(e); }
    if (seq !== this._seq) return;
    if (hooks.afterRender) hooks.afterRender({ route, params, query, layout, active, view, title });
    // scroll: restore on back/forward, top on forward navigation, hash targets when present
    const st = history.state || {};
    if (location.hash && document.querySelector(location.hash)) { document.querySelector(location.hash).scrollIntoView(); }
    else window.scrollTo(0, popped ? (st.scrollY || 0) : 0);
  },
  start() {
    window.addEventListener('popstate', () => this.resolve({ popped: true }));
    // link delegate: <a href="/app/…"> and [data-nav="/app/…"] go through the router; server paths and
    // external links fall through to the browser (full load).
    document.addEventListener('click', e => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const nav = e.target.closest && e.target.closest('[data-nav]');
      if (nav) { e.preventDefault(); this.navigate(nav.getAttribute('data-nav')); return; }
      const a = e.target.closest && e.target.closest('a[href]');
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      const href = a.getAttribute('href');
      if (!href || href.startsWith('#') || /^(https?:|mailto:|tel:)/i.test(href)) return;
      const url = new URL(href, location.origin);
      if (url.origin !== location.origin || isServerPath(url.pathname)) return;
      e.preventDefault();
      this.navigate(url.pathname + url.search + url.hash);
    });
    return this.resolve({ popped: false });
  },
  get current() { return current; }
};

function renderError(e) {
  return `<div style="padding:54px 36px;text-align:center"><span style="display:inline-block;width:28px;height:1px;background:#c9a962"></span>
    <div style="font-family:Fraunces,serif;font-size:30px;line-height:1.15;margin-top:14px">This page didn't <i style="color:#9b1b22">load</i>.</div>
    <div style="font-size:13.5px;color:#4a4239;line-height:1.6;max-width:420px;margin:12px auto 0">Something went wrong while drawing this screen. Reload, or head back home.</div>
    <div style="display:flex;gap:12px;margin-top:24px;justify-content:center"><a href="/app/home" style="padding:13px 24px;background:#9b1b22;color:#f7f1e6;font:600 10.5px Inter,sans-serif;letter-spacing:.16em">BACK TO HOME →</a></div></div>`;
}
export default router;
