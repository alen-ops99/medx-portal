// js/router.js — History-API router. Routes are a TABLE (js/routes.js) of
//   { path: '/projects/plexus/:tab?', view: () => import('./views/plexus.js'), auth: true,
//     layout: 'portal' | 'signin', active: 'Projects', title: 'Plexus Week', sections: ['plexus'] }
// A view module exports default { title, render(root, ctx), destroy() } (see ARCHITECTURE.md).
// Guards: auth routes bounce to /signin?next=…; the sign-in screen bounces a signed-in admin to
// Today; `sections` (ANY of the permission ids) renders views/locked.js when the admin lacks them
// (IMPLEMENTATION_CONTRACT §3.4 — the server still 403s every call). Unknown paths render
// views/notfound.js. Scroll position is restored on back/forward and reset to top on forward
// navigation. Server-rendered paths (cfg.serverPaths) are never intercepted.
import cfg from './config.js';
import { session, state } from './state.js';
import { perms } from './perms.js';

const routes = [];
let current = { module: null, root: null, path: null };
let notFoundLoader = null, lockedLoader = null;
const hooks = { beforeRender: null, afterRender: null, title: t => t ? t + ' · Med&X Admin' : 'Med&X Admin' };
// ---- the hand-off between two screens ------------------------------------------------------------
// Every view awaits its data, then writes `root.innerHTML`. Until that first write the screen that is
// leaving STAYS: inert at once, dimmed after ~100 ms (css §8 #view.mx-pending). Past ~450 ms a gold
// hairline creeps along the top edge (css §7 .mx-loadbar); only a real change of screen, and only once the
// wait passes ~650 ms, swaps the dimmed screen for a skeleton shaped like the one that is coming. A
// switch inside one view (Inbox tabs, hub sub-tabs) never shows one — its strip stays put. The live
// backend answers most screens in ~400 ms, so both thresholds sit clear of it: a skeleton that shows
// only for a blink is worse than none. All delays are timers, not CSS delays, so prefers-reduced-motion
// (which zeroes every CSS delay) keeps them.
const NATIVE_HTML = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
const reduceMotion = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
const EASE = 'cubic-bezier(.22,1,.36,1)';   // var(--ease) — Web Animations cannot read a css variable
const rows = n => Array.from({ length: n }, () => '<span><i></i><i></i></span>').join('');
const SK = {
  title: '<div class="mx-skel-title"><i></i><i></i></div>',
  band: `<div class="mx-skel-band">${rows(4)}</div>`,
  card: `<div class="mx-skel-card">${rows(5)}</div>`,
  tabs: '<div class="mx-skel-tabs"><i></i><i></i><i></i><i></i></div>',
  board: `<div class="mx-skel-board">${'<span><i></i><b></b><b></b></span>'.repeat(4)}</div>`,
  grid: `<div class="mx-skel-grid">${'<span><i></i><i></i><i></i></span>'.repeat(6)}</div>`
};
// which outline the coming screen has (first path segment; anything unlisted is a titled list)
const SHAPES = { today: 'band', registrations: 'band', money: 'band', projects: 'band', gala: 'band', tasks: 'board', speakers: 'board', inbox: 'tabs', studio: 'grid' };
function skeleton(pathname) {
  const seg = pathname.split('/').filter(Boolean);
  const shape = seg[0] === 'people' && seg[1] === 'speakers' ? 'board' : (SHAPES[seg[0]] || 'list');
  const body = { band: SK.band + SK.card, board: SK.board, tabs: SK.tabs + SK.card, grid: SK.grid, list: SK.card }[shape];
  return `<div class="mx-skel" data-shape="${shape}" aria-busy="true"><span class="mx-sr">Loading…</span>${SK.title}${body}</div>`;
}
// the slow-load hairline (css §7 .mx-loadbar — the member portal's): gold, it creeps across the top edge
// while the wait lasts, and when the screen lands it sweeps home and fades (.home), then resets unseen
let loadbar = null, barTimer = null;
function bar(on) {
  if (on) {
    if (!loadbar) { loadbar = document.createElement('div'); loadbar.className = 'mx-loadbar'; loadbar.setAttribute('aria-hidden', 'true'); document.body.appendChild(loadbar); }
    clearTimeout(barTimer);
    if (loadbar.classList.contains('on')) return;
    loadbar.classList.remove('home'); void loadbar.offsetWidth;   // back to zero width before the creep starts
    loadbar.classList.add('on');
    return;
  }
  if (!loadbar || !loadbar.classList.contains('on')) return;
  loadbar.classList.remove('on'); loadbar.classList.add('home');
  clearTimeout(barTimer);
  barTimer = setTimeout(() => { if (loadbar) loadbar.classList.remove('home'); }, 700);
}
let handoff = null;
function endHandoff() { const h = handoff; handoff = null; if (h) h.end(); }
// Holds the leaving screen until the view's first write, then calls onWrite(opacity the screen was at)
// just BEFORE that write lands — so the scroll reset and the arrival classes are in place when the new
// markup paints, and a view that scrolls to its own section during render keeps that position.
function beginHandoff(root, { same, pathname, onSkeleton, onWrite }) {
  endHandoff();
  const old = Array.from(root.childNodes);
  const empty = !root.firstElementChild;
  const timers = [];
  const later = (ms, fn) => timers.push(setTimeout(fn, ms));
  const h = { fire: null, end: null };
  root.inert = true;
  if (!empty) later(100, () => root.classList.add('mx-pending'));
  later(450, () => bar(true));
  if (!same) later(empty ? 160 : 650, () => {
    NATIVE_HTML.set.call(root, skeleton(pathname)); mo.takeRecords();
    root.classList.remove('mx-pending');
    onSkeleton();
  });
  const mo = new MutationObserver(() => h.fire());
  h.end = () => { timers.forEach(clearTimeout); mo.disconnect(); delete root.innerHTML; root.inert = false; root.classList.remove('mx-pending'); bar(false); };
  h.fire = () => {
    if (handoff !== h) return;
    const o = parseFloat(getComputedStyle(root).opacity);
    endHandoff();
    old.forEach(n => { if (n.parentNode === root) root.removeChild(n); });   // a view that appended instead of replacing
    onWrite(isNaN(o) ? 1 : o, empty);
  };
  Object.defineProperty(root, 'innerHTML', { configurable: true, get() { return NATIVE_HTML.get.call(this); }, set(v) { h.fire(); NATIVE_HTML.set.call(this, v); } });
  mo.observe(root, { childList: true });
  handoff = h;
  return h;
}
let arriveTimer = null, arriveAnim = null;
// a KEYBOARD press on a link inside the view (an Inbox tab, a hub sub-tab) — the leaving screen goes
// inert, which drops focus to <body>; when the same view redraws, focus returns to the same link
let refocus = null;

function compile(path) {
  const keys = [];
  const re = '^' + path
    .replace(/\/:([a-zA-Z_]+)\?/g, (_, k) => { keys.push(k); return '(?:/([^/]+))?'; })
    .replace(/:([a-zA-Z_]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })
    .replace(/\*/g, '.*') + '/?$';
  return { regex: new RegExp(re), keys };
}
export function parseQuery(search) { const q = {}; new URLSearchParams(search || '').forEach((v, k) => { q[k] = v; }); return q; }
function isServerPath(pathname) { return cfg.serverPaths.some(p => pathname === p || pathname.startsWith(p + '/')); }

// The element a '#…' points at, or null. Never throws: a hash is free text (an email deep link,
// a pasted URL, '#2026'), and CSS.escape + try/catch is what stands between that and a
// SyntaxError that aborts the rest of resolve().
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
  locked(loader) { lockedLoader = loader; return this; },
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
    const hit = this.match(pathname);
    const route = hit ? hit.route : null, params = hit ? hit.params : {};
    if (route && route.redirect) return this.navigate(typeof route.redirect === 'function' ? route.redirect(params, query) : route.redirect, { replace: true });
    // guards
    if (route && route.auth !== false && !session.isAuthed) {
      const next = pathname + location.search;
      return this.navigate('/signin' + (next && next !== '/' && next !== '/today' ? '?next=' + encodeURIComponent(next) : ''), { replace: true });
    }
    if (route && route.guestOnly && session.isAuthed) return this.navigate(query.next && query.next.startsWith('/') && !query.next.startsWith('//') ? query.next : '/today', { replace: true });
    const lockedSection = route && route.sections && !perms.canAny(route.sections) ? route.sections[0] : null;
    const loader = lockedSection ? lockedLoader : (route ? route.view : notFoundLoader);
    if (!loader) { console.error('[router] no view for', pathname); return; }
    const seq = (this._seq = (this._seq || 0) + 1);
    const rf = refocus; refocus = null;
    let mod;
    try { mod = await loader(); } catch (e) { console.error('[router] failed to load view for ' + pathname, e); mod = notFoundLoader ? await notFoundLoader() : null; }
    if (seq !== this._seq || !mod) return; // superseded by a newer navigation
    const view = mod.default || mod;
    const ctx = { params, query, path: pathname, route, navigate: (to, o) => this.navigate(to, o), user: session.user, popped, lockedSection };
    if (current.module && typeof current.module.destroy === 'function') { try { current.module.destroy(); } catch (e) { console.error('[router] destroy failed', e); } }
    const layout = (route && route.layout) || mod.layout || 'portal';
    const active = (route && route.active) || null;
    state.set({ layout, active });
    if (hooks.beforeRender) hooks.beforeRender({ route, params, query, layout, active, view });
    const root = document.getElementById('view');
    const same = !!current.module && current.module === view;
    current = { module: view, root, path: pathname };
    const title = typeof view.title === 'function' ? view.title(ctx) : (view.title || (route && route.title) || '');
    document.title = hooks.title(title);
    clearTimeout(arriveTimer);
    if (arriveAnim) { try { arriveAnim.cancel(); } catch (e) {} arriveAnim = null; }
    root.classList.remove('mx-arrive');
    // forward navigation starts at the top when the NEW screen lands (its first write, or the skeleton)
    // and before the view scrolls itself — a view that jumps to its own section during render
    // (Settings › /settings/team, Inbox › /inbox/email …) keeps that position
    const toTop = () => { root.scrollTop = 0; if (!popped && !location.hash) window.scrollTo(0, 0); };
    const h = beginHandoff(root, {
      same, pathname,
      onSkeleton: toTop,
      onWrite: (o, empty) => {
        toTop();
        // the finished screen fades up from where the leaving one rested (dimmed .55, a skeleton, or a
        // quick swap from full); a new screen also lets its first KPI cells / cards settle in one after
        // another (css §8 .mx-arrive — removed before anything re-renders, never replayed)
        const from = same ? o : (empty ? 0 : Math.min(o, .7));
        if (from < .98 && !reduceMotion() && root.animate) {
          try { arriveAnim = root.animate([{ opacity: from }, { opacity: 1 }], { duration: same ? 180 : 340, easing: EASE }); } catch (e) {}
        }
        if (!same) { root.classList.add('mx-arrive'); arriveTimer = setTimeout(() => root.classList.remove('mx-arrive'), 800); }
      }
    });
    try { await view.render(root, ctx); } catch (e) { console.error('[router] render failed for ' + pathname, e); root.innerHTML = renderError(e); }
    if (seq !== this._seq) return;
    if (handoff === h) h.fire();   // a view that drew nothing still releases the leaving screen
    if (same && rf && (!document.activeElement || document.activeElement === document.body)) {
      const back = Array.from(root.querySelectorAll(rf.attr === 'href' ? 'a[href]' : '[data-nav]')).find(el => el.getAttribute(rf.attr) === rf.to);
      if (back) { try { back.focus({ preventScroll: true }); } catch (e) {} }
    }
    if (hooks.afterRender) hooks.afterRender({ route, params, query, layout, active, view, title });
    const st = history.state || {};
    // A hash is arbitrary user text, not a selector: '#2026', '#a b', '#gala:seating' all throw
    // out of querySelector and killed the scroll restore (and everything after it). Escape the
    // id and swallow anything the engine still refuses.
    const target = hashTarget(location.hash);
    if (target) target.scrollIntoView();
    else if (popped) window.scrollTo(0, st.scrollY || 0);
  },
  start() {
    window.addEventListener('popstate', () => this.resolve({ popped: true }));
    // link delegate: <a href="/…"> and [data-nav="/…"] go through the router; server paths and external links fall through
    document.addEventListener('click', e => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const view = document.getElementById('view');
      const kbd = el => (e.detail === 0 && view && view.contains(el));
      const nav = e.target.closest && e.target.closest('[data-nav]');
      if (nav) { e.preventDefault(); refocus = kbd(nav) ? { attr: 'data-nav', to: nav.getAttribute('data-nav') } : null; this.navigate(nav.getAttribute('data-nav')); return; }
      const a = e.target.closest && e.target.closest('a[href]');
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      const href = a.getAttribute('href');
      if (!href || href.startsWith('#') || /^(https?:|mailto:|tel:)/i.test(href)) return;
      const url = new URL(href, location.origin);
      if (url.origin !== location.origin || isServerPath(url.pathname)) return;
      e.preventDefault();
      refocus = kbd(a) ? { attr: 'href', to: href } : null;
      this.navigate(url.pathname + url.search + url.hash);
    });
    return this.resolve({ popped: false });
  },
  get current() { return current; }
};

function renderError(e) {
  return `<div style="max-width:1180px;margin:0 auto;padding:54px 28px;text-align:center"><span style="display:inline-block;width:28px;height:1px;background:#c9a962"></span>
    <div style="font-family:Fraunces,serif;font-size:30px;line-height:1.15;margin-top:14px">This page didn't <i style="color:#9b1b22">load</i>.</div>
    <div style="font-size:13px;color:#6d6459;line-height:1.6;max-width:420px;margin:12px auto 0">Something went wrong while drawing this screen. Reload, or head back to Today.</div>
    <div style="display:flex;gap:12px;margin-top:24px;justify-content:center"><a href="/today" style="padding:10px 16px;background:#9b1b22;color:#fff;font:600 10px Inter,sans-serif;letter-spacing:.14em">BACK TO TODAY →</a></div></div>`;
}
export default router;
