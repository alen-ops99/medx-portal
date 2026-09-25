// js/router.js — History-API router. Routes are a TABLE (js/routes.js) of
//   { path: '/app/plexus/:tab?', view: () => import('./views/plexus.js'), auth: true,
//     layout: 'portal' | 'auth' | 'bare', active: 'Plexus', title: 'Plexus Conference' }
// A view module exports default { title, render(root, ctx), destroy() } (see ARCHITECTURE.md); render()
// loads its data, then `if (!(await ctx.ready())) return;` right before its first write to root (the
// screen change happens there — see ctx.ready below).
// Guards: auth routes bounce to /app/auth/signin?next=…; the auth screens bounce a signed-in
// member to Home. Unknown paths render views/notfound.js (System Pages 404). Scroll position is
// restored on back/forward, kept when the same screen is read again, and reset to top on forward
// navigation. Server-rendered paths
// (cfg.serverPaths) are never intercepted — a full page load reaches the Express server.
import cfg from './config.js';
import { session, state } from './state.js';
import { ui } from './ui.js';

const routes = [];
let current = { module: null, root: null, path: null };
let notFoundLoader = null;
let hooks = { leave: null, settle: null, beforeRender: null, afterRender: null, placed: null, title: t => t ? t + ' · Med&X' : 'Med&X Member Portal' };
// Screen changes (View Transitions, where the browser has them: Safari / WKWebView 18+, Chrome 111+). The screen
// being left stays on view until the next one has its data; then ctx.ready() (called by the view just before its
// first write) snapshots it and the two screens cross over — forward slides in from the right, back from the left
// (phones: the native push; wider screens: a drifting dissolve), a tab bar / menu jump or another tab cross-fades —
// while the tab bar holds still, and the top bar too when both screens are at their top (css app.css › SCREEN
// CHANGES). A tap during a crossing ends it and reaches the new screen: it never holds a tap back. A re-read of the
// same screen updates in place. Without the API, or before the first screen, the #view fade (.mx-enter) remains.
// A Back the browser animated itself (an edge swipe) gets neither: the new screen simply appears.
let navIdx = 0;       // this history entry's place in the session (history.state.idx): back vs forward on popstate
let nextDir = null;   // 'forward' | 'back' | 'fade' | 'none' (the browser animated it) — set by navigate() / popstate
let navHint = null;   // 'fade' when the tab bar, the menu or the logo started the navigation (a jump, not a step)
let vtNow = null;     // the view transition under way, if any
const waitedSheets = new WeakSet();   // a view stylesheet is waited for once at most (a 404 must not slow every screen)
let tabFrom = null;   // the active section tab's box when a sibling tab was clicked — the new underline slides from it
let segFrom = null;   // the same for a segmented control (.mx-seg[data-tabs]): the raised capsule slides from the item left
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
  // `jump`: a tab bar jump (the native bar's mx:navigate, chrome.js › tabGo) cross-fades like a tap on the web tab bar
  navigate(to, { replace = false, state: st = null, back = false, jump = false } = {}) {
    if (/^https?:\/\//i.test(to)) { window.location.assign(to); return; }
    const url = new URL(to, window.location.origin);
    if (isServerPath(url.pathname)) { window.location.assign(url.href); return; }
    const here = location.pathname + location.search + location.hash, there = url.pathname + url.search + url.hash;
    // the screen already open (a tap on its own tab or link): a navigation like any other, but it replaces this
    // history entry instead of stacking a second copy of it (Back then leaves the screen, never shows it again)
    if (!replace && there === here) replace = true;
    // a link that means Back ('← PORTAL', a breadcrumb's parent — data-dir="back") to the screen this one was opened
    // from IS Back: the browser's own step, so history never loops and that screen returns where it was left. To
    // anywhere else it is a new entry that still moves back (it comes in from the left)
    if (back && !replace && navIdx > 0 && history.state && history.state.from === there) { history.back(); return; }
    // remember where the current entry was scrolled before leaving it
    try { history.replaceState(Object.assign({}, history.state || {}, { scrollY: window.scrollY, idx: navIdx }), '', location.href); } catch (e) {}
    const idx = replace ? navIdx : navIdx + 1;
    const entry = Object.assign({ scrollY: 0, idx, from: replace ? (history.state || {}).from : here }, st || {});
    try { history[replace ? 'replaceState' : 'pushState'](entry, '', there); } catch (e) { window.location.assign(url.href); return; }
    navIdx = idx;
    nextDir = replace ? 'fade' : back ? 'back' : 'forward';
    if (jump) navHint = 'fade';
    return this.resolve({ popped: false });
  },
  replace(to) { return this.navigate(to, { replace: true }); },
  back() { history.back(); },
  get path() { return location.pathname; },
  async resolve({ popped = false } = {}) {
    const pathname = location.pathname;
    const query = parseQuery(location.search);
    const bare = !nextDir;                                   // a bare resolve() (pull to refresh, resume) is a re-read
    const dir = nextDir || (popped ? 'fade' : 'forward');
    const appear = dir === 'none';                           // the browser already animated this Back: no motion of ours
    const hint = navHint; nextDir = null; navHint = null;
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
    const first = !current.module;
    // the same screen read again (pull to refresh, back from an in-app browser, a long pause — a bare resolve()): it
    // repaints where the member left it, never a jump to the top or to a scroll position saved the last time they left
    // it; even after the view rewrote its own query (the event app's ?tab=). A tap on the tab or link of the screen
    // already open is a navigation like any other (back to its start, crossing over), the way a native tab bar does
    const reread = !first && bare && current.module === view && current.path === pathname;
    const keepY = reread ? window.scrollY : null;
    // tear down the previous view
    if (current.module && typeof current.module.destroy === 'function') { try { current.module.destroy(); } catch (e) { console.error('[router] destroy failed', e); } }
    const layout = (route && route.layout) || (mod.layout) || 'portal';
    const active = (route && route.active) || null;
    const prevLayout = state.get().layout;
    const root = document.getElementById('view');
    // The screen being left stays on view (inert, dimmed if the wait drags) until the next one draws over it —
    // across layouts too (sign-in → Home, Home → the event app): the layout switches over with the new screen,
    // at ctx.ready(), so the page never shows a bare background, a chrome without content, or a white frame.
    const hold = !first && !!root.firstElementChild;
    const deferLayout = hold && prevLayout !== layout;
    state.set(deferLayout ? { active } : { layout, active });   // the tab bar and the menu light the new place at once
    if (hooks.leave) hooks.leave({ route, layout, active });   // the menu and the popovers close right away
    const sameView = current.module === view;
    const tabKey = hold ? holdLeaving(root, sameView) : (root.innerHTML = '', null);
    const body = document.body;                                      // the progress hairline (app.css › body.mx-holding)
    // a re-read (pull to refresh, a return from Safari, a long pause) keeps the screen as it is while it reads —
    // no dim, no hairline (the app's pull spinner, or nothing, says it is working) — and then updates in place
    const wait = hold && !reread;
    clearTimeout(heldTimer); clearTimeout(slowTimer); body.classList.remove('mx-held', 'mx-slow'); body.classList.toggle('mx-holding', wait);
    // a timer, not a css delay, so reduced motion (which zeroes every css delay) keeps the threshold
    if (wait) slowTimer = setTimeout(() => { if (seq === this._seq) body.classList.add('mx-slow'); }, SLOW_MS);
    root.scrollTop = 0;
    current = { module: view, root, path: pathname };
    const title = typeof view.title === 'function' ? view.title(ctx) : (view.title || (route && route.title) || '');
    document.title = hooks.title(title);
    root.classList.remove(...ENTER_CLASSES, 'mx-vt'); clearTimeout(enterTimer); ui.revealOnScroll(null);

    // ---- the switch-over. stage(): the layout and the bar title change with the screen, once. place(): the scroll
    // position of the new screen — kept on a re-read, restored on back / forward, the top otherwise, or a #target.
    let staged = false, placed = false, crossed = false, commit = null;
    const committed = new Promise(r => { commit = r; });
    const stage = () => {
      if (staged) return; staged = true;
      clearTimeout(slowTimer);                     // the screen is switching now: no "still waiting" dim or hairline
      if (deferLayout) state.set({ layout });
      if (hooks.beforeRender) hooks.beforeRender({ route, params, query, layout, active, view });
    };
    const place = () => {
      if (placed) return; placed = true;
      // a re-read leaves the page where the member has it. It is only put back if the new content moved it (never
      // during a pull: WebKit reports the pull as a negative scroll, and a scrollTo there cut the bounce off in one
      // frame)
      if (keepY != null) {
        if (keepY > 0 && window.scrollY >= 0 && Math.abs(window.scrollY - keepY) > 1) window.scrollTo(0, keepY);
      } else {
        const st = history.state || {};
        const target = hashTarget(location.hash);
        if (target) target.scrollIntoView();
        else window.scrollTo(0, keepY != null ? keepY : popped ? (st.scrollY || 0) : 0);
      }
      // the bars take the new screen's place at once (chrome.js › viewChanged: the top bar's mode, both tones), inside the
      // crossing, before the new screen is captured
      if (hooks.placed) { try { hooks.placed(); } catch (e) {} }
    };
    let kind = reread ? 'fade' : tabKey ? 'tab' : (hint || dir);
    // ctx.ready(): the view calls it once its data is in, right before its first write (`if (!(await ctx.ready()))
    // return` — false: a newer navigation took over). It waits for a view stylesheet still loading (a screen never
    // paints unstyled), switches the stage and, where the browser can, snapshots the old screen first so the two
    // cross over. The view's write happens inside the transition's update, so the old snapshot is always the old
    // screen and nothing paints half-drawn.
    let readyP = null;
    ctx.ready = () => readyP || (readyP = (async () => {
      await sheetsSettled();
      // the side menu finishes sliding shut before the old screen is snapshot (caught mid-slide, it jumped)
      if (hooks.settle) { try { await hooks.settle(); } catch (e) {} }
      if (seq !== this._seq) return false;
      // a re-read updates in place: what did not change stays pixel-still, what did simply shows its new state.
      // (A snapshot cross-fade here ghosted: the page is often still moving — the pull's bounce — when data lands)
      // After a Back the browser animated (iPhone Safari's edge swipe, Android's back gesture) the screen simply
      // appears too: a crossing of our own would replay the step the finger just made
      if (!hold || reread || appear || !canCross()) { stage(); return true; }
      return new Promise(resolve => {
        const html = document.documentElement;
        let t = null;
        const done = () => { if (vtNow === t) { vtNow = null; html.removeAttribute('data-mx-nav'); html.classList.remove('mx-vt-chrome', 'mx-vt-bars'); } nameTabs(root, null); };
        // the bars are layers of their own (they hold still) only when both screens have them; a bar on one side
        // only (the event app has none) stays part of its screen and travels with it, under the screen on top
        const bars = prevLayout === 'portal' && layout === 'portal';
        // the "one moment" overlay still fading out: the screens dissolve and carry it away with the old one (a
        // slide would drag it sideways; left alone, it ghosted over the new screen)
        const waking = document.querySelector('body > .mx-waking.is-leaving');
        if (waking && kind !== 'tab') kind = 'fade';
        html.setAttribute('data-mx-nav', kind);
        html.classList.toggle('mx-vt-bars', bars);
        html.classList.toggle('mx-vt-chrome', bars && chromeStill());
        const stripAt = nameTabs(root, tabKey);
        try {
          t = vtNow = document.startViewTransition(async () => {
            if (seq !== this._seq) { resolve(false); return; }
            stage(); crossed = true; resolve(true);
            if (waking) waking.remove();
            // the view writes in the microtasks that follow and the router's own finish (scroll, tabs) lands with it;
            // a view that awaits more after its first write (Messages opening a thread) is not waited for
            await Promise.race([committed, new Promise(r => setTimeout(r, 0))]);
            // the crossing is the entrance: the new screen's own entrances (a hero rising, cards fading in) are
            // finished before it is snapshot, so it slides in whole — never pale, half-empty or with a doubled heading
            settleEntrances(root);
            place();
            // the app's own photos on view are decoded (off the main thread) before the new screen is captured: a
            // first visit to a photo screen used to stall the crossing's first frames on a 2000 px JPEG. The old
            // screen holds still meanwhile; never more than 250 ms
            await photosDecoded(root, 250);
            nameTabs(root, tabKey, stripAt);
            if (!chromeStill()) html.classList.remove('mx-vt-chrome');
          });
        } catch (e) { t = null; done(); stage(); resolve(true); return; }
        t.finished.then(done, done);
        if (t.ready) t.ready.catch(() => {});                       // skipped (a newer screen change): nothing to undo
        // the update normally runs on the next frame; if it never does, the screen still changes
        setTimeout(() => { stage(); resolve(true); }, 900);
      });
    })());
    try { await view.render(root, ctx); } catch (e) { console.error('[router] render failed for ' + pathname, e); stage(); root.innerHTML = renderError(e); }
    if (seq !== this._seq) { commit(); return; }
    stage();                                                            // a view that never called ctx.ready()
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
    // Crossed over by a view transition (.mx-vt): the crossing is the entrance, so only the tab rule and the
    // photo settle run inside it (app.css › SCREEN CHANGES).
    // A re-read, and a Back the browser animated, have no entrance (see ctx.ready).
    const strip = tabKey && !reread && !appear ? root.querySelector(`[data-tabs="${cssAttr(tabKey)}"]`) : null;
    if (strip) markAround(root, strip, 'mx-tab-in');
    if (!reread && !appear) {
      void root.offsetWidth; root.classList.add(strip ? 'mx-enter-tab' : 'mx-enter');
      if (crossed) root.classList.add('mx-vt');
      enterTimer = setTimeout(() => root.classList.remove(...ENTER_CLASSES, 'mx-vt'), 1000);
    }
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
    place();
    // a segmented control too wide for a small phone scrolls sideways: its current item is brought into view
    root.querySelectorAll('.mx-seg').forEach(seg => {
      const on = seg.querySelector('.is-on, [aria-current="page"]');
      if (!on || seg.scrollWidth <= seg.clientWidth + 1) return;
      seg.scrollLeft += (on.getBoundingClientRect().left - seg.getBoundingClientRect().left) - (seg.clientWidth - on.offsetWidth) / 2;
    });
    // sections below the fold rise in as they scroll into view — for the screens that ask for it
    const reveal = typeof view.reveal === 'function' ? view.reveal(ctx) : view.reveal;
    if (reveal && layout === 'portal' && !reread) ui.revealOnScroll(root);
    commit();
  },
  start() {
    // the router places every screen itself (restored on back / forward, kept on a re-read): the browser's own
    // restoration would scroll the OLD screen to the new position a frame before the switch
    try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; } catch (e) {}
    navIdx = history.state && typeof history.state.idx === 'number' ? history.state.idx : 0;
    try { history.replaceState(Object.assign({}, history.state || {}, { idx: navIdx }), '', location.href); } catch (e) {}
    // A crossing never holds a tap back. While one runs the browser hit-tests the whole page as <html> (the snapshots
    // cover it; pointer-events on them change nothing), so a tap or a click made during it is handed on here: it ends
    // the crossing (the new screen is already in place underneath) and goes to what is under the finger or the
    // pointer — a field takes focus first (a click made by script never focuses one, and the typing went nowhere),
    // and the modifier keys travel with it (a ⌘-clicked link still opens a new tab). A mouse is handed on at its
    // click, which lands on <html>. A finger is handed on as it lifts: iOS picks a tap's target as the finger lands
    // (<html> here) and may then make no click at all; where the browser does make one, it lands after ours and is
    // dropped. A finger that moves (a scroll starting) lets the crossing run to its end: snapped into place
    // mid-slide, the new screen jumped
    let press = null, handed = null;
    const handOn = e => {
      if (vtNow) { try { vtNow.skipTransition(); } catch (err) {} }
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || el === document.documentElement || el === document.body) return false;
      if (el.closest(':disabled')) return true;
      // a link clicked with ⌘ / Ctrl / Shift opens in a new tab (Safari followed a click made by script in this one)
      const link = el.closest('a[href]');
      if (link && (e.metaKey || e.ctrlKey || e.shiftKey)) { try { window.open(link.href, '_blank', 'noopener'); } catch (err) {} return true; }
      const label = el.closest('label');
      const field = el.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') || (label && label.control);
      if (field) { try { field.focus({ preventScroll: true }); } catch (err) {} }
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, view: window, detail: e.detail || 1,
        screenX: e.screenX, screenY: e.screenY, clientX: e.clientX, clientY: e.clientY, button: 0,
        ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey }));
      return true;
    };
    document.addEventListener('pointerdown', e => {
      handed = null;                                 // a new press: whatever the last tap left behind is not its click
      press = vtNow && e.isPrimary ? { id: e.pointerId, x: e.clientX, y: e.clientY, at: performance.now(), mouse: e.pointerType === 'mouse' } : null;
    }, true);
    const lift = e => {
      const p = press;
      if (!p || p.mouse || e.pointerId !== p.id) return;
      if (e.type === 'pointermove') { if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) press = null; return; }
      press = null;
      if (e.type === 'pointerup' && performance.now() - p.at < 1500 && handOn(e)) handed = { at: performance.now(), x: e.clientX, y: e.clientY };
    };
    ['pointermove', 'pointerup', 'pointercancel'].forEach(t => document.addEventListener(t, lift, true));
    document.addEventListener('click', e => {
      const h = handed, p = press;
      if (h && e.isTrusted) {                        // the browser's own click of a tap already handed on
        handed = null;
        if (performance.now() - h.at < 800 && Math.hypot(e.clientX - h.x, e.clientY - h.y) < 30) { e.stopImmediatePropagation(); e.preventDefault(); return; }
      }
      if (!p || !p.mouse || !e.isTrusted) return;
      press = null;
      if (performance.now() - p.at < 1500 && e.target === document.documentElement && handOn(e)) { e.stopImmediatePropagation(); e.preventDefault(); }
    }, true);
    window.addEventListener('popstate', e => {
      const idx = history.state && typeof history.state.idx === 'number' ? history.state.idx : null;
      // the browser already animated this step (iPhone Safari's edge swipe, Android's back gesture): 'none'
      nextDir = e.hasUAVisualTransition ? 'none' : idx == null || idx === navIdx ? 'fade' : idx < navIdx ? 'back' : 'forward';
      if (idx != null) navIdx = idx;
      this.resolve({ popped: true });
    });
    // link delegate: <a href="/app/…"> and [data-nav="/app/…"] go through the router; server paths and
    // external links fall through to the browser (full load).
    document.addEventListener('click', e => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const view = document.getElementById('view');
      const kbd = el => e.detail === 0 && !!view && view.contains(el);   // Enter on a focused control (a mouse click has detail ≥ 1)
      // the tab bar, the menu and the logo jump between places: those screens cross-fade instead of sliding
      const jump = el => !!(el.closest && el.closest('#mx-tabbar, #mx-drawer, .mx-brand'));
      // a link that means Back ('← PORTAL', a breadcrumb's parent) says so: data-dir="back" (see navigate)
      const back = el => el.getAttribute('data-dir') === 'back';
      const nav = e.target.closest && e.target.closest('[data-nav]');
      if (nav) { e.preventDefault(); refocus = kbd(nav) ? { attr: 'data-nav', to: nav.getAttribute('data-nav') } : null; navHint = jump(nav) ? 'fade' : null; this.navigate(nav.getAttribute('data-nav'), { back: back(nav) }); return; }
      const a = e.target.closest && e.target.closest('a[href]');
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      const href = a.getAttribute('href');
      if (!href || href.startsWith('#') || /^(https?:|mailto:|tel:)/i.test(href)) return;
      const url = new URL(href, location.origin);
      if (url.origin !== location.origin || isServerPath(url.pathname)) return;
      e.preventDefault();
      refocus = kbd(a) ? { attr: 'href', to: href, strip: a.closest('[data-tabs]') ? a.closest('[data-tabs]').getAttribute('data-tabs') : null } : null;
      rememberTab(a);
      navHint = jump(a) ? 'fade' : null;
      this.navigate(url.pathname + url.search + url.hash, { back: back(a) });
    });
    return this.resolve({ popped: false });
  },
  get current() { return current; }
};

// A step inside a screen that reads as a screen change (a conversation opened from the inbox on a phone, and
// back): the same crossing as between screens — 'forward' pushes, 'back' pops, 'fade' dissolves — around a
// synchronous DOM update. Without the API, or while another crossing runs, the update just happens.
export function step(kind, update) {
  if (!canCross() || vtNow) { update(); return; }
  const html = document.documentElement;
  const done = () => { if (vtNow === t) { vtNow = null; html.removeAttribute('data-mx-nav'); html.classList.remove('mx-vt-bars', 'mx-vt-chrome'); } };
  html.setAttribute('data-mx-nav', kind);
  html.classList.add('mx-vt-bars');
  html.classList.toggle('mx-vt-chrome', chromeStill());
  let t = null;
  try { t = vtNow = document.startViewTransition(() => { update(); }); }
  catch (e) { t = null; vtNow = null; html.removeAttribute('data-mx-nav'); html.classList.remove('mx-vt-bars', 'mx-vt-chrome'); update(); return; }
  t.finished.then(done, done);
  if (t.ready) t.ready.catch(() => {});
}

// Resolves once the screen change under way (if any) has finished: a view that opens the keyboard on arrival
// (Messages with ?to=) waits for it, so the keyboard rises after the new screen has settled, not across the slide.
export function settled() {
  const t = vtNow;
  return t && t.finished ? t.finished.then(() => {}, () => {}) : Promise.resolve();
}

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

// ---- screen changes (css app.css › SCREEN CHANGES) ----
// A view's stylesheet is injected when the view first opens (views/*.js ensureCss) and never awaited there: the
// new screen waits for it here, at most 400 ms, once per stylesheet (a failed one never slows another screen).
function sheetsSettled(max = 400) {
  const wait = [...document.querySelectorAll('link[rel="stylesheet"]')].filter(l => {
    if (l.sheet || waitedSheets.has(l)) return false;
    try { return new URL(l.href, location.href).origin === location.origin; } catch (e) { return false; }
  });
  if (!wait.length) return Promise.resolve();
  wait.forEach(l => waitedSheets.add(l));
  const loaded = l => new Promise(r => { l.addEventListener('load', r, { once: true }); l.addEventListener('error', r, { once: true }); });
  return Promise.race([Promise.all(wait.map(loaded)), new Promise(r => setTimeout(r, max))]);
}
function canCross() {
  return typeof document.startViewTransition === 'function' && document.visibilityState === 'visible';
}
// The top bar is a layer of its own (it holds still) only while the page is at its top, before and after the switch:
// on wider screens it scrolls away with the page; on phones it sticks, but WebKit captures a named sticky bar where
// it sits in the flow, not where it is stuck, so from or to a scrolled page the bar vanished for the whole slide and
// popped back at the end. Scrolled, it travels with its own screen instead.
function chromeStill() {
  const c = document.getElementById('chrome');
  if (!c || !c.firstElementChild || document.body.getAttribute('data-layout') !== 'portal') return false;
  return window.scrollY <= 2;
}
// The bundled photos (same origin, not a backend image fetched through the app's proxy) in or near the viewport,
// decoded; resolves when they are, or after `max` ms. A backend photo still arriving fades in on its own (ui.js).
function photosDecoded(root, max) {
  const vh = window.innerHeight || 800;
  const list = [...root.querySelectorAll('img')].filter(img => {
    let u; try { u = new URL(img.currentSrc || img.src, location.href); } catch (e) { return false; }
    if (u.origin !== location.origin || u.pathname.startsWith('/_capacitor')) return false;
    const r = img.getBoundingClientRect();
    return r.width > 0 && r.bottom > -vh * 0.25 && r.top < vh * 1.25;
  });
  if (!list.length || typeof list[0].decode !== 'function') return Promise.resolve();
  return Promise.race([Promise.all(list.map(img => img.decode().catch(() => {}))), new Promise(r => setTimeout(r, max))]);
}
// The view's entrance animations already under way on the new screen (its first write) run to their end at once: the
// crossing carries the screen in. Both kinds: the css ones and those a view plays itself (sign-in, the 404 and
// maintenance screens, through element.animate). What keeps going: loops (a live dot, a skeleton), the photo's slow
// settle (css, or an animate() with that id) and the tab rule sliding over (app.css › SCREEN CHANGES), transitions,
// and anything the view starts later.
const KEEP_RUNNING = new Set(['mx-settle', 'mx-draw', 'mx-tab-slide', 'mx-knob']);
function settleEntrances(root) {
  let list = [];
  try { list = root.getAnimations({ subtree: true }); } catch (e) { return; }
  list.forEach(a => {
    if (typeof CSSTransition !== 'undefined' && a instanceof CSSTransition) return;
    if (KEEP_RUNNING.has(a.animationName || a.id)) return;
    let end = Infinity;
    try { end = a.effect.getComputedTiming().endTime; } catch (e) {}
    if (!isFinite(end)) return;
    try { a.finish(); } catch (e) {}
  });
}
// Another tab of the same section: its strip (the rule sliding over to the new tab) is its own layer, so it
// neither fades nor ghosts while the content around it crosses over. A class, never the artboard's inline style.
// Returns where the strip sits on screen. Called again for the new screen with that place (`was`): a strip drawn
// in the same spot keeps the layer (it holds perfectly still); one that lands elsewhere (the tab above it is
// shorter, the page went back to its top) takes a layer of its own and fades in there while the old one fades out
// where it was — a strip never glides across the content.
function nameTabs(root, key, was) {
  root.querySelectorAll('.mx-vt-tabs, .mx-vt-tabs-in').forEach(n => n.classList.remove('mx-vt-tabs', 'mx-vt-tabs-in'));
  if (!key) return null;
  const strips = root.querySelectorAll(`[data-tabs="${cssAttr(key)}"]`);
  const s = strips[strips.length - 1];
  if (!s) return null;
  const r = s.getBoundingClientRect();
  const still = was === undefined || (was && Math.abs(was.top - r.top) < 1.5 && Math.abs(was.left - r.left) < 1.5);
  s.classList.add(still ? 'mx-vt-tabs' : 'mx-vt-tabs-in');
  return { top: r.top, left: r.left };
}

// ---- section tabs ([data-tabs] strip of .mx-tab, the current one .is-on — css app.css › .mx-tab) ----
// Clicking a sibling tab records where the current underline is; after the next screen draws, its
// underline slides over from there instead of drawing in from the centre. Meanwhile the pressed tab
// shows its hover underline (.is-pending), so the press is answered before the data arrives.
function rememberTab(a) {
  tabFrom = null; segFrom = null;
  const seg = a.closest && a.closest('.mx-seg[data-tabs]');
  if (seg && a.parentElement === seg) {
    const cur = seg.querySelector(':scope > .is-on, :scope > [aria-current="page"]');
    if (cur && cur !== a) { const r = cur.getBoundingClientRect(); segFrom = { key: seg.getAttribute('data-tabs'), left: r.left, width: r.width, at: Date.now() }; }
    return;
  }
  const strip = a.closest && a.closest('[data-tabs]');
  const on = strip && strip.querySelector('.mx-tab.is-on');
  if (!on || !a.classList.contains('mx-tab')) return;
  const r = on.getBoundingClientRect();
  tabFrom = { key: strip.getAttribute('data-tabs'), left: r.left, width: r.width, at: Date.now() };
  strip.querySelectorAll('.mx-tab.is-pending').forEach(t => t.classList.remove('is-pending'));
  a.classList.add('is-pending');
}
function settleTabs(root) {
  // a segmented control: its current item is brought into view first (a strip that scrolls sideways), then the raised
  // capsule slides over from where the item you left was (app.css › .mx-seg .is-sliding; reduced motion: it appears)
  const sf = segFrom; segFrom = null;
  root.querySelectorAll('.mx-seg[data-tabs]').forEach(seg => {
    const on = seg.querySelector(':scope > .is-on, :scope > [aria-current="page"]');
    if (!on) return;
    if (seg.scrollWidth > seg.clientWidth + 1) {
      const want = on.offsetLeft - (seg.clientWidth - on.offsetWidth) / 2;
      seg.scrollLeft = Math.max(0, Math.min(want, seg.scrollWidth - seg.clientWidth));
    }
    if (!sf || sf.key !== seg.getAttribute('data-tabs') || Date.now() - sf.at > 4000) return;
    const r = on.getBoundingClientRect();
    if (!r.width || Math.abs(sf.left - r.left) < 1) return;
    on.style.setProperty('--seg-dx', (sf.left - r.left).toFixed(1) + 'px');
    on.style.setProperty('--seg-sx', (sf.width / r.width).toFixed(3));
    on.classList.add('is-sliding');
  });
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
