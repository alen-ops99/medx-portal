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
import { ui } from './ui.js';

const routes = [];
let current = { module: null, root: null, path: null };
let notFoundLoader = null;
let hooks = { beforeRender: null, afterRender: null, title: t => t ? t + ' · Med&X' : 'Med&X Member Portal' };
let tabFrom = null;   // the active section tab's box when a sibling tab was clicked — the new underline slides from it
let enterTimer = null, heldTimer = null, slowTimer = null;
const SLOW_MS = 250;  // a wait past this dims the leaving screen and runs the gold hairline (app.css › body.mx-slow)
// A KEYBOARD press on a link inside the view (a section tab, a breadcrumb): the new view's innerHTML replaces
// the pressed link, which drops focus to <body>; when the same view redraws, focus returns to the link with
// the same target. Ported from the admin router (same name, same rule). One member difference: the artboards
// draw the CURRENT tab as a <span aria-current>, so a pressed tab that became current has no link to return
// to — focus then lands on that current tab itself (focusable by script only, never a Tab stop).
let refocus = null;
const ENTER_CLASSES = ['mx-enter', 'mx-enter-tab'];

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

// The element a '#…' points at, or null. Never throws: the hash arrives from emails, medx.hr and
// pasted URLs ('#mymedx', but also '#2026' or '#gala:seating'), and a hash that is not a valid
// CSS selector used to throw a SyntaxError out of resolve(). Mirrors the admin router.
function hashTarget(hash) {
  const id = String(hash || '').replace(/^#/, '');
  if (!id) return null;
  try { return document.getElementById(decodeURIComponent(id)) || document.querySelector('#' + CSS.escape(id)); }
  catch (e) { try { return document.getElementById(id); } catch (e2) { return null; } }
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
    // alias rows (UX audit 2026-09-02, small notes): a bare /signin is a path people type — send it
    // to the real screen instead of the 404, keeping any ?next=… they arrived with.
    if (route && route.redirect) return this.navigate(route.redirect + location.search, { replace: true });
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
    const rf = refocus; refocus = null;
    let mod;
    try { mod = await loader(); } catch (e) { console.error('[router] failed to load view for ' + pathname, e); mod = notFoundLoader ? await notFoundLoader() : null; }
    if (seq !== this._seq || !mod) return; // superseded by a newer navigation
    const view = mod.default || mod;
    const ctx = { params, query, path: pathname, route, navigate: (to, o) => this.navigate(to, o), user: session.user, popped };
    // tear down the previous view
    if (current.module && typeof current.module.destroy === 'function') { try { current.module.destroy(); } catch (e) { console.error('[router] destroy failed', e); } }
    const layout = (route && route.layout) || (mod.layout) || 'portal';
    const active = (route && route.active) || null;
    const prevLayout = state.get().layout;
    state.set({ layout, active });
    if (hooks.beforeRender) hooks.beforeRender({ route, params, query, layout, active, view });
    const root = document.getElementById('view');
    // The screen being left stays on view (inert, dimmed if the wait drags) until the next one draws
    // over it — portal to portal only; the auth and bare layouts start from a clean slate as before.
    const hold = prevLayout === 'portal' && layout === 'portal' && root.firstElementChild;
    const sameView = current.module === view;
    const tabKey = hold ? holdLeaving(root, sameView) : (root.innerHTML = '', null);
    const body = document.body;                                      // the progress hairline (app.css › body.mx-holding)
    clearTimeout(heldTimer); clearTimeout(slowTimer); body.classList.remove('mx-held', 'mx-slow'); body.classList.toggle('mx-holding', !!hold);
    // a timer, not a css delay, so reduced motion (which zeroes every css delay) keeps the threshold
    if (hold) slowTimer = setTimeout(() => { if (seq === this._seq) body.classList.add('mx-slow'); }, SLOW_MS);
    root.scrollTop = 0;
    current = { module: view, root, path: pathname };
    const title = typeof view.title === 'function' ? view.title(ctx) : (view.title || (route && route.title) || '');
    document.title = hooks.title(title);
    root.classList.remove(...ENTER_CLASSES); clearTimeout(enterTimer); ui.revealOnScroll(null);
    try { await view.render(root, ctx); } catch (e) { console.error('[router] render failed for ' + pathname, e); root.innerHTML = renderError(e); }
    if (seq !== this._seq) return;
    clearTimeout(slowTimer);
    root.querySelectorAll('.mx-leaving').forEach(n => n.remove());     // a view that appended instead of replacing
    if (body.classList.contains('mx-holding')) {                        // the top hairline sweeps home and fades
      body.classList.remove('mx-holding'); body.classList.add('mx-held');
      heldTimer = setTimeout(() => body.classList.remove('mx-held', 'mx-slow'), 700);
    }
    // The screen's entrance starts once the view has drawn its content, in the same task, so the page
    // never paints un-faded first; and it runs once: later partial re-renders inside the view stay still.
    // A new screen: #view.mx-enter (a soft fade, the card grids cascading in, the hero photo settling).
    // Another tab of the same section: #view.mx-enter-tab — the breadcrumb and the strip stay put and
    // only the content around them rises in, so a tab change reads as a tab change, not a page load.
    const strip = tabKey ? root.querySelector(`[data-tabs="${cssAttr(tabKey)}"]`) : null;
    if (strip) markAround(root, strip, 'mx-tab-in');
    void root.offsetWidth; root.classList.add(strip ? 'mx-enter-tab' : 'mx-enter');
    enterTimer = setTimeout(() => root.classList.remove(...ENTER_CLASSES), 1000);
    settleTabs(root);
    if (rf && current.module === view && sameView && (!document.activeElement || document.activeElement === document.body)) {
      let back = [...root.querySelectorAll(rf.attr === 'href' ? 'a[href]' : '[data-nav]')].find(el => el.getAttribute(rf.attr) === rf.to);
      if (!back && rf.strip) {
        back = root.querySelector(`[data-tabs="${cssAttr(rf.strip)}"] .mx-tab.is-on`);
        if (back && !back.hasAttribute('tabindex')) back.setAttribute('tabindex', '-1');
      }
      if (back) { try { back.focus({ preventScroll: true }); } catch (e) {} }
    }
    if (hooks.afterRender) hooks.afterRender({ route, params, query, layout, active, view, title });
    // scroll: restore on back/forward, top on forward navigation, hash targets when present
    const st = history.state || {};
    const target = hashTarget(location.hash);
    if (target) target.scrollIntoView();
    else window.scrollTo(0, popped ? (st.scrollY || 0) : 0);
    // sections below the fold rise in as they scroll into view — for the screens that ask for it
    const reveal = typeof view.reveal === 'function' ? view.reveal(ctx) : view.reveal;
    if (reveal && layout === 'portal') ui.revealOnScroll(root);
  },
  start() {
    window.addEventListener('popstate', () => this.resolve({ popped: true }));
    // link delegate: <a href="/app/…"> and [data-nav="/app/…"] go through the router; server paths and
    // external links fall through to the browser (full load).
    document.addEventListener('click', e => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const view = document.getElementById('view');
      const kbd = el => e.detail === 0 && !!view && view.contains(el);   // Enter on a focused control (a mouse click has detail ≥ 1)
      const nav = e.target.closest && e.target.closest('[data-nav]');
      if (nav) { e.preventDefault(); refocus = kbd(nav) ? { attr: 'data-nav', to: nav.getAttribute('data-nav') } : null; this.navigate(nav.getAttribute('data-nav')); return; }
      const a = e.target.closest && e.target.closest('a[href]');
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      const href = a.getAttribute('href');
      if (!href || href.startsWith('#') || /^(https?:|mailto:|tel:)/i.test(href)) return;
      const url = new URL(href, location.origin);
      if (url.origin !== location.origin || isServerPath(url.pathname)) return;
      e.preventDefault();
      refocus = kbd(a) ? { attr: 'href', to: href, strip: a.closest('[data-tabs]') ? a.closest('[data-tabs]').getAttribute('data-tabs') : null } : null;
      rememberTab(a);
      this.navigate(url.pathname + url.search + url.hash);
    });
    return this.resolve({ popped: false });
  },
  get current() { return current; }
};

// ---- leaving a screen (css app.css › .mx-leaving) ----
// Marks what is on screen now as leaving: inert (no clicks, no focus, hidden from assistive tech) and,
// through css, dimmed once the wait passes ~140 ms. The next view's `root.innerHTML = …` replaces it.
// Moving within one view (another tab of the same section), the breadcrumb and the tab strip are spared
// (they stay lit and in place) and the strip's key is returned, so the entrance can treat it as a tab change.
function holdLeaving(root, sameView) {
  const strip = sameView ? root.querySelector('[data-tabs]') : null;
  const key = strip ? strip.getAttribute('data-tabs') : null;
  const marked = strip ? markAround(root, strip, 'mx-leaving') : [...root.children].map(n => { n.classList.add('mx-leaving'); return n; });
  marked.forEach(n => { try { n.inert = true; } catch (e) { n.setAttribute('aria-hidden', 'true'); } });
  return key;
}
// Every block of the screen except the breadcrumb and the given tab strip: the siblings of the strip
// and of each of its ancestors up to the view root. Empty blocks (a closed bio sheet host) are skipped.
function markAround(root, strip, cls) {
  const out = [];
  for (let n = strip; n && n !== root && n.parentElement; n = n.parentElement) {
    for (const sib of n.parentElement.children) {
      if (sib === n || sib.matches('.mx-crumbs, [data-tabs], style, link, script') || (!sib.firstElementChild && !sib.textContent.trim())) continue;
      sib.classList.add(cls); out.push(sib);
    }
    if (n.parentElement === root) break;
  }
  return out;
}
function cssAttr(v) { return String(v).replace(/["\\]/g, '\\$&'); }

// ---- section tabs ([data-tabs] strip of .mx-tab, the current one .is-on — css app.css › .mx-tab) ----
// Clicking a sibling tab records where the current underline is; after the next screen draws, its
// underline slides over from there instead of drawing in from the centre. Meanwhile the pressed tab
// shows its hover underline (.is-pending), so the press is answered before the data arrives.
function rememberTab(a) {
  tabFrom = null;
  const strip = a.closest && a.closest('[data-tabs]');
  const on = strip && strip.querySelector('.mx-tab.is-on');
  if (!on || !a.classList.contains('mx-tab')) return;
  const r = on.getBoundingClientRect();
  tabFrom = { key: strip.getAttribute('data-tabs'), left: r.left, width: r.width, at: Date.now() };
  strip.querySelectorAll('.mx-tab.is-pending').forEach(t => t.classList.remove('is-pending'));
  a.classList.add('is-pending');
}
function settleTabs(root) {
  const from = tabFrom; tabFrom = null;
  root.querySelectorAll('[data-tabs]').forEach(strip => {
    const on = strip.querySelector('.mx-tab.is-on');
    if (!on) return;
    // a strip that scrolls sideways (phones) brings the current tab into view — it used to open at the
    // far left with the tab you were on out of sight
    if (strip.scrollWidth > strip.clientWidth + 1) {
      const want = on.offsetLeft - (strip.clientWidth - on.offsetWidth) / 2;
      strip.scrollLeft = Math.max(0, Math.min(want, strip.scrollWidth - strip.clientWidth));
    }
    if (!from || from.key !== strip.getAttribute('data-tabs') || Date.now() - from.at > 4000) return;
    const r = on.getBoundingClientRect();
    if (!r.width || Math.abs(from.left - r.left) < 1) return;
    on.style.setProperty('--tab-dx', (from.left - r.left).toFixed(1) + 'px');
    on.style.setProperty('--tab-sx', (from.width / r.width).toFixed(3));
    on.classList.add('is-sliding');
  });
}

function renderError(e) {
  return `<div style="padding:54px 36px;text-align:center"><span style="display:inline-block;width:28px;height:1px;background:#c9a962"></span>
    <div style="font-family:Fraunces,serif;font-size:30px;line-height:1.15;margin-top:14px">This page didn't <i style="color:#9b1b22">load</i>.</div>
    <div style="font-size:13.5px;color:#4a4239;line-height:1.6;max-width:420px;margin:12px auto 0">Something went wrong while drawing this screen. Reload, or head back home.</div>
    <div style="display:flex;gap:12px;margin-top:24px;justify-content:center"><a href="/app/home" style="padding:13px 24px;background:#9b1b22;color:#f7f1e6;font:600 10.5px Inter,sans-serif;letter-spacing:.16em">BACK TO HOME →</a></div></div>`;
}
export default router;
