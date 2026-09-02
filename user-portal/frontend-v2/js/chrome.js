// Source: Portal Chrome.dc.html (desktop chrome: top bar · member-stats strip · email-confirm
//         banner · scrim · 300px ink drawer) + Mobile Portal.dc.html (≤430px: sticky compact
//         top bar + ink bottom tab bar). ONE implementation, mounted once by app.js; every
//         view renders below it. Markup and inline styles are the artboard's; only the bound
//         props ({{ todayLabel }}, {{ navHome }}, {{ dx }} …) became data.
//
//   import { chrome } from './chrome.js';
//   chrome.mount();                 // once (app.js)
//   chrome.refresh();               // re-fetch stats strip + unread count (after login / an action)
//   chrome.openDrawer(); chrome.closeDrawer();
//   state.set({ active: 'Plexus' }) // drawer highlight — the router sets it from the route table
import { api } from './api.js';
import { session, state } from './state.js';
import { ui, esc, fmt } from './ui.js';
import { FACTS, routeFor } from './facts.js';
import router from './router.js';

export const COPY = {
  menu: 'MENU', search: 'SEARCH', alerts: 'ALERTS', en: 'EN', hr: 'HR',
  memberLabel: 'Med&amp;X Member',
  banner: { lead: 'Confirm your email to unlock everything. Link sent to ', leadShort: 'Confirm your email to unlock everything.', resend: 'RESEND LINK', resendShort: 'RESEND', sent: 'Link sent — check your inbox (and spam).' },
  hrSoon: 'Croatian (HR) arrives with the translations — English for now.',
  stats: { registrations: 'REGISTRATIONS', following: 'FOLLOWING', since: 'MEMBER SINCE' },
  drawer: { portal: 'PORTAL', projects: 'Projects', quick: 'QUICK LINKS', website: 'Website ↗' },
  searchPanel: { placeholder: 'Search events, people, tickets…', hint: 'Type at least two characters.', none: 'Nothing matched — try a name, a city or an event.', groups: { events: 'EVENTS', members: 'PEOPLE', talks: 'TALKS', mine: 'MINE' } },
  alertsPanel: { title: 'ALERTS', markAll: 'MARK ALL READ', emptyLine: 'All quiet.', emptyWhy: 'Announcements and replies land here the moment they arrive.' },
  mobile: { title: 'MEMBER PORTAL', tabs: ['HOME', 'PROJECTS', 'PEOPLE', 'INBOX', 'MY M&X'] },
  talksRetired: 'The Talk Library was retired — recordings return when real Plexus talks exist.'
};

// drawer PORTAL group — order and labels exactly as Portal Chrome.dc.html
const NAV = [
  { key: 'Home', label: 'Home', to: '/app/home' },
  { label: COPY.drawer.projects, group: true },
  { key: 'Plexus', label: 'Plexus Conference', to: '/app/plexus', sub: true },
  { key: 'Gala', label: 'Gala Evening', to: '/app/gala', sub: true },
  { key: 'Accelerator', label: 'The Accelerator', to: '/app/accelerator', sub: true },
  { key: 'Forum', label: 'Biomedical Forum', to: '/app/forum', sub: true },
  { key: 'Bridges', label: 'Building Bridges', to: '/app/bridges', sub: true },
  { key: 'Network', label: 'Network', to: '/app/network' },
  { key: 'My Med&X', label: 'My Med&amp;X', to: '/app/me' }
];
// QUICK LINKS — as the artboard; "Messages" is a v2 addition (the Messages screen has no drawer entry in the export)
// UX audit 2026-09-02 › item 14: "Mentorship" and "Opportunity board" opened _stub screens that say
// the wiring is on its way — construction tape inside the front door — so they are out of the menu
// until those screens ship (the routes stay for direct URLs). "Event tickets" was a third name for
// My Med&X sitting in the same list as My Med&X; it is "My wallet" now, which is what it opens.
const QUICK = [
  { label: 'Profile &amp; settings', to: '/app/profile' },
  { label: 'Member directory', to: '/app/network' },
  { label: 'My wallet', to: '/app/me' },
  { label: 'Certificates', to: '/app/me/certificates' },
  { label: 'Forum eligibility', to: '/app/forum' },
  { label: 'Messages', to: '/app/messages', v2: true }
];
// nav styles — verbatim from the artboard's renderVals()
const NAV_BASE = 'display:block;padding:9px 26px;font-size:14px;color:rgba(247,241,230,.72);text-decoration:none';
const NAV_ACT = 'display:block;padding:9px 24px;border-left:2px solid #c9a962;background:rgba(201,169,98,.08);font-size:14px;font-weight:600;color:#f7f1e6;text-decoration:none';
const NAV_SUB = 'display:block;padding:5px 26px 5px 42px;font-size:12.5px;color:rgba(247,241,230,.55);text-decoration:none';
const NAV_SUB_ACT = 'display:block;padding:5px 26px 5px 40px;border-left:2px solid #c9a962;background:rgba(201,169,98,.08);font-size:12.5px;font-weight:600;color:#f7f1e6;text-decoration:none';

const TAB_ROOTS = { HOME: '/app/home', PROJECTS: '/app/projects', PEOPLE: '/app/network', INBOX: '/app/messages', 'MY M&X': '/app/me' };
const VERIFY_DISMISS_KEY = 'medx_verify_dismissed'; // legacy sessionStorage key, kept

let els = {};
let popover = null; // 'alerts' | 'search' | null
let searchTimer = null;

// ---------------------------------------------------------------- templates
function topBar() {
  const s = state.get(); const u = s.user || {};
  return `
  <!-- dc: Portal Chrome.dc.html › "Top bar" -->
  <div class="mx-topbar" style="display:flex;align-items:center;gap:20px;padding:0 36px;height:60px;border-bottom:1px solid rgba(25,21,18,.16);position:relative">
    <span data-act="tg" aria-label="Open menu" style="display:flex;align-items:center;gap:10px;cursor:pointer">
      <span style="display:flex;flex-direction:column;gap:4px"><span style="width:18px;height:2px;background:#191512"></span><span style="width:18px;height:2px;background:#191512"></span><span style="width:12px;height:2px;background:#191512"></span></span>
      <span style="font:600 10.5px Inter,sans-serif;letter-spacing:.18em">${COPY.menu}</span>
    </span>
    <a href="/app/home" style="display:block"><img src="/assets/logo.png" alt="med&amp;X" style="height:22px;display:block"></a>
    <div style="flex:1"></div>
    <span data-act="search" aria-label="Search" style="font:600 10.5px Inter,sans-serif;letter-spacing:.16em;color:#4a4239;cursor:pointer">${COPY.search}</span>
    <span data-act="alerts" aria-label="Alerts" style="display:flex;align-items:center;gap:6px;font:600 10.5px Inter,sans-serif;letter-spacing:.16em;color:#4a4239;cursor:pointer">${COPY.alerts}<span data-role="unread-dot" style="width:6px;height:6px;background:#c9a962;display:${s.unread > 0 ? 'inline-block' : 'none'}"></span></span>
    <span style="width:1px;height:18px;background:rgba(25,21,18,.16)"></span>
    <span style="font:600 10.5px Inter,sans-serif;letter-spacing:.14em"><span style="color:#191512">${COPY.en}</span><span data-act="hr" title="${esc(COPY.hrSoon)}" style="color:#4a4239;opacity:.55;cursor:pointer"> · ${COPY.hr}</span></span>
    <a href="/app/me" style="display:flex;align-items:center;gap:10px;text-decoration:none;color:#191512" data-hover="color:#191512">
      <span style="width:30px;height:30px;background:#191512;color:#f7f1e6;display:inline-flex;align-items:center;justify-content:center;font:600 12px Fraunces,serif">${esc(session.initials())}</span>
      <span class="mx-identity-text" style="display:flex;flex-direction:column;line-height:1.25"><span style="font-size:12.5px;font-weight:600">${esc(session.displayName())}</span><span style="font-size:10.5px;color:#4a4239">${COPY.memberLabel}</span></span>
    </a>
    <div data-role="popover"></div>
  </div>
  <!-- /dc -->`;
}
function statsStrip() {
  const st = state.get().stats || {};
  // A stat is shown once it has something to say (UX audit 2026-09-02 › item 5). A row of zeros
  // above every screen told each new member four times that they were nothing; a zero now simply
  // waits its turn. MEMBER SINCE reads label-first — it is a date, not a score.
  const stat = (v, l) => (Number(v) > 0
    ? `<span style="display:flex;align-items:baseline;gap:7px"><span style="font-family:Fraunces,serif;font-size:17px">${esc(v)}</span><span style="font:600 9px Inter,sans-serif;letter-spacing:.15em;color:#4a4239">${l}</span></span>`
    : '');
  const since = st.since
    ? `<span style="display:flex;align-items:baseline;gap:7px"><span style="font:600 9px Inter,sans-serif;letter-spacing:.15em;color:#4a4239">${COPY.stats.since}</span><span style="font-family:Fraunces,serif;font-size:17px">${esc(st.since)}</span></span>`
    : '';
  return `
  <!-- dc: Portal Chrome.dc.html › "Member stats strip" -->
  <div class="mx-stats" style="display:flex;align-items:center;gap:24px;padding:10px 36px;border-bottom:1px solid rgba(25,21,18,.16)">
    <span style="font:600 10px Inter,sans-serif;letter-spacing:.18em;color:#4a4239">${fmt.todayLabel()}</span>
    <div style="flex:1"></div>
    ${stat(st.registrations, COPY.stats.registrations)}
    ${stat(st.following, COPY.stats.following)}
    ${since}
  </div>
  <!-- /dc -->`;
}
function banner() {
  const u = state.get().user || {};
  let dismissed = false; try { dismissed = sessionStorage.getItem(VERIFY_DISMISS_KEY) === 'true'; } catch (e) {}
  if (session.emailConfirmed() || dismissed) return '';
  return `
  <!-- dc: Portal Chrome.dc.html › "Email-confirm banner" -->
  <div data-role="banner" style="display:flex;align-items:center;gap:14px;padding:9px 36px;background:#f1e8d3;border-bottom:1px solid rgba(25,21,18,.16)">
    <span style="width:6px;height:6px;background:#c9a962;flex:none"></span>
    <span style="font-size:12.5px;color:#4a4239">${COPY.banner.lead}<strong style="color:#191512">${esc(u.email || '')}</strong>.</span>
    <div style="flex:1"></div>
    <span data-act="resend" style="font:600 10.5px Inter,sans-serif;letter-spacing:.16em;color:#9b1b22;cursor:pointer;white-space:nowrap">${COPY.banner.resend}</span>
    <span data-act="hideBanner" aria-label="Dismiss" style="color:#4a4239;cursor:pointer">×</span>
  </div>
  <!-- /dc -->`;
}
function drawer() {
  const a = state.get().active || '';
  const nav = (k, isSub) => a === k ? (isSub ? NAV_SUB_ACT : NAV_ACT) : (isSub ? NAV_SUB : NAV_BASE);
  return `
  <!-- dc: Portal Chrome.dc.html › "Drawer" -->
  <div id="mx-scrim" data-act="cl" aria-hidden="true"></div>
  <div id="mx-drawer" role="navigation" aria-label="Portal menu">
    <div style="display:flex;align-items:center;padding:0 26px"><img src="/assets/logo-white.png" alt="med&amp;X" style="height:20px;display:block"><div style="flex:1"></div><span data-act="cl" aria-label="Close menu" style="font-size:20px;color:rgba(247,241,230,.7);cursor:pointer" data-hover="color:#f7f1e6">×</span></div>
    <div style="font:600 10px Inter,sans-serif;letter-spacing:.2em;color:rgba(201,169,98,.9);padding:0 26px;margin:30px 0 8px">${COPY.drawer.portal}</div>
    <div style="display:flex;flex-direction:column">
      ${NAV.map(n => n.group
        ? `<span style="display:block;padding:9px 26px;font-size:14px;color:rgba(247,241,230,.72)">${n.label}</span>`
        : `<a href="${n.to}" style="${nav(n.key, n.sub)}" data-hover="color:#f7f1e6">${n.label}</a>`).join('\n      ')}
    </div>
    <div style="height:1px;background:rgba(247,241,230,.14);margin:14px 26px"></div>
    <div style="font:600 10px Inter,sans-serif;letter-spacing:.2em;color:rgba(201,169,98,.9);padding:0 26px;margin-bottom:8px">${COPY.drawer.quick}</div>
    <div style="display:flex;flex-direction:column">
      ${QUICK.map(q => `<a href="${q.to}" style="display:block;padding:6px 26px;font-size:12.5px;color:rgba(247,241,230,.6);text-decoration:none" data-hover="color:#f7f1e6"${q.v2 ? ' data-v2="quick-link not in Portal Chrome.dc.html"' : ''}>${q.label}</a>`).join('\n      ')}
    </div>
    <div style="height:1px;background:rgba(247,241,230,.14);margin:14px 26px"></div>
    <a href="${FACTS.org.site}" target="_blank" rel="noopener" style="display:block;padding:0 26px;font-size:13px;color:rgba(247,241,230,.6);text-decoration:none" data-hover="color:#f7f1e6">${COPY.drawer.website}</a>
  </div>
  <!-- /dc -->`;
}
function mobileTop() {
  const s = state.get(); const path = router.path;
  const isRoot = Object.values(TAB_ROOTS).includes(path.replace(/\/$/, '')) || path === '/' || path === '/app';
  const title = path === '/app/home' || path === '/' || path === '/app' ? COPY.mobile.title : fmt.upper(s.viewTitle || '');
  return `
  <!-- dc: Mobile Portal.dc.html › "Top bar" -->
  <div id="mx-mobile-top" style="display:flex;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid rgba(25,21,18,.16);position:sticky;top:0;background:#f7f1e6;z-index:20">
    ${isRoot
      ? `<a href="/app/home" style="display:block"><img src="/assets/logo.png" alt="med&amp;X" style="height:17px;display:block"></a>`
      : `<span data-act="back" aria-label="Back" style="font-size:17px;cursor:pointer;color:#9b1b22;min-width:44px;min-height:24px;display:inline-flex;align-items:center">←</span>`}
    <span style="font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#4a4239">${esc(title)}</span>
    <div style="flex:1"></div>
    <span style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#4a4239;white-space:nowrap">EN · <span data-act="hr" style="color:rgba(25,21,18,.4)">HR</span></span>
    <a href="/app/me" aria-label="My Med&X" style="width:30px;height:30px;background:#191512;color:#f7f1e6;display:inline-flex;align-items:center;justify-content:center;font:600 10.5px Fraunces,serif;text-decoration:none">${esc(session.initials())}</a>
  </div>
  <!-- /dc -->
  ${mobileBanner()}`;
}
function mobileBanner() {
  let dismissed = false; try { dismissed = sessionStorage.getItem(VERIFY_DISMISS_KEY) === 'true'; } catch (e) {}
  if (session.emailConfirmed() || dismissed) return '';
  return `
  <!-- dc: Mobile Portal.dc.html › "Email-confirm banner" -->
  <div class="mx-mobile-only" data-role="banner-m" style="display:flex;align-items:center;gap:10px;padding:8px 18px;background:#f1e8d3;border-bottom:1px solid rgba(25,21,18,.16)">
    <span style="width:5px;height:5px;background:#c9a962;flex:none"></span>
    <span style="font-size:11px;color:#4a4239;line-height:1.4">${COPY.banner.leadShort}</span>
    <div style="flex:1"></div>
    <span data-act="resend" style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:#9b1b22;white-space:nowrap;cursor:pointer">${COPY.banner.resendShort}</span>
  </div>
  <!-- /dc -->`;
}
function tabBar() {
  const path = router.path;
  const on = label => { const root = TAB_ROOTS[label]; return path === root || path.startsWith(root + '/') || (label === 'HOME' && (path === '/' || path === '/app')); };
  return `
  <!-- dc: Mobile Portal.dc.html › "Tab bar" -->
  <div id="mx-tabbar" role="tablist" style="position:fixed;bottom:0;left:0;right:0;max-width:430px;margin:0 auto;background:#191512;display:flex;z-index:30">
    ${COPY.mobile.tabs.map(label => { const a = on(label); return `<a href="${TAB_ROOTS[label]}" role="tab" aria-selected="${a}" style="flex:1;display:flex;flex-direction:column;align-items:center;gap:5px;padding:13px 0 16px;cursor:pointer;border-top:2px solid ${a ? '#c9a962' : 'transparent'};min-height:44px;box-sizing:border-box;text-decoration:none">
        <span style="width:5px;height:5px;background:${a ? '#c9a962' : 'rgba(247,241,230,.28)'};transform:rotate(45deg)"></span>
        <span style="font:600 8px Inter,sans-serif;letter-spacing:.14em;color:${a ? '#f7f1e6' : 'rgba(247,241,230,.55)'};white-space:nowrap">${label}</span>
      </a>`; }).join('')}
  </div>
  <!-- /dc -->`;
}

// ---------------------------------------------------------------- popovers (no artboard — brand vocabulary)
function alertsPanel() {
  const s = state.get(); const list = s.notifications || [];
  const row = n => `<div class="mx-pop-row" data-act="openAlert" data-id="${esc(n.id)}" data-link="${esc(n.link || '')}">
      <span style="width:7px;height:7px;flex:none;margin-top:5px;background:${n.is_read ? 'transparent' : '#9b1b22'};border:1px solid ${n.is_read ? 'rgba(25,21,18,.25)' : '#9b1b22'}"></span>
      <span style="flex:1;min-width:0"><span style="display:block;font-size:13px;font-weight:600;line-height:1.3">${esc(n.title || 'Update')}</span>${n.message ? `<span style="display:block;font-size:12px;color:#4a4239;line-height:1.5;margin-top:2px">${esc(n.message)}</span>` : ''}</span>
      <span style="font:600 8px Inter,sans-serif;letter-spacing:.12em;color:#9b8f80;white-space:nowrap">${fmt.shortDate(n.created_at)}</span>
    </div>`;
  return `<div class="mx-pop" role="dialog" aria-label="Alerts">
    <div class="mx-pop-head"><span style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#9b1b22">${COPY.alertsPanel.title}${s.unread ? ' · ' + s.unread + ' NEW' : ''}</span><div style="flex:1"></div>${list.length ? `<span data-act="markAll" style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:#9b1b22;cursor:pointer">${COPY.alertsPanel.markAll}</span>` : ''}<span data-act="closePop" aria-label="Close" style="margin-left:14px;color:#4a4239;cursor:pointer">×</span></div>
    <div class="mx-pop-list">${list.length ? list.map(row).join('') : `<div class="empty"><span class="rule-gold" style="margin-bottom:6px"></span><span class="empty-line">${COPY.alertsPanel.emptyLine}</span><span class="empty-why">${COPY.alertsPanel.emptyWhy}</span></div>`}</div>
  </div>`;
}
function searchOverlay() {
  return `<div class="mx-search" data-act="closePop" role="dialog" aria-label="Search">
    <div class="mx-search-panel" data-stop="1">
      <input data-role="q" type="search" placeholder="${esc(COPY.searchPanel.placeholder)}" aria-label="Search" autocomplete="off">
      <div data-role="results" class="mx-pop-list"><div style="padding:14px 20px;font-size:12px;color:#4a4239">${COPY.searchPanel.hint}</div></div>
    </div>
  </div>`;
}
function searchResults(res) {
  const groups = ['events', 'members', 'talks', 'mine'].filter(g => res[g] && res[g].length);
  if (!groups.length) return `<div class="empty"><span class="empty-line">${COPY.searchPanel.none}</span></div>`;
  return groups.map(g => `<div class="mx-search-group">${COPY.searchPanel.groups[g]}</div>` + res[g].map(it => `<div class="mx-pop-row" data-act="openResult" data-section="${esc(it.section || '')}" data-kind="${esc(it.kind || '')}">
      <span style="flex:1;min-width:0"><span style="display:block;font-family:Fraunces,serif;font-size:15px;line-height:1.25">${esc(it.title)}</span><span style="display:block;font-size:11.5px;color:#4a4239;margin-top:2px">${esc(it.detail || '')}</span></span>
      <span style="font:600 9px Inter,sans-serif;letter-spacing:.16em;color:#9b1b22;white-space:nowrap">OPEN →</span></div>`).join('')).join('');
}

// ---------------------------------------------------------------- render + behaviour
function renderAll() {
  const s = state.get();
  const portal = s.layout === 'portal';
  document.body.setAttribute('data-layout', s.layout || 'portal');
  document.body.classList.toggle('authed', session.isAuthed);
  els.chrome.innerHTML = portal ? `<div id="mx-desktop-chrome">${topBar()}${statsStrip()}${banner()}</div>${mobileTop()}` : '';
  els.overlays.innerHTML = portal ? drawer() + tabBar() : '';
  if (popover) renderPopover();
}
function renderPopover() {
  const host = els.chrome.querySelector('[data-role="popover"]');
  if (!host) return;
  host.innerHTML = popover === 'alerts' ? alertsPanel() : popover === 'search' ? searchOverlay() : '';
  if (popover === 'search') { const q = host.querySelector('[data-role="q"]'); if (q) { q.focus(); q.addEventListener('input', onSearchInput); } }
}
function closePopover() { popover = null; renderPopover(); }
function onSearchInput(e) {
  const q = e.target.value.trim();
  clearTimeout(searchTimer);
  const box = els.chrome.querySelector('[data-role="results"]');
  if (q.length < 2) { if (box) box.innerHTML = `<div style="padding:14px 20px;font-size:12px;color:#4a4239">${COPY.searchPanel.hint}</div>`; return; }
  searchTimer = setTimeout(async () => {
    try { const res = await api.get('/api/member/search?q=' + encodeURIComponent(q)); if (box && popover === 'search') box.innerHTML = searchResults(res); }
    catch (err) { if (box) box.innerHTML = `<div style="padding:14px 20px;font-size:12px;color:#9b1b22">${esc(err.message)}</div>`; }
  }, 250);
}

const handlers = {
  tg: () => chrome.toggleDrawer(),
  cl: () => chrome.closeDrawer(),
  back: () => (history.length > 1 ? history.back() : router.navigate('/app/home')),
  hr: () => ui.toast(COPY.hrSoon),
  search: () => { popover = popover === 'search' ? null : 'search'; renderPopover(); },
  alerts: async () => { popover = popover === 'alerts' ? null : 'alerts'; renderPopover(); if (popover === 'alerts') { await chrome.refresh({ only: 'notifications' }); renderPopover(); } },
  closePop: (el, e) => { if (e && e.target.closest && e.target.closest('[data-stop]')) return; closePopover(); },
  markAll: async () => { try { await api.put('/api/user-notifications/mark-all-read'); await chrome.refresh({ only: 'notifications' }); renderPopover(); ui.toast('All alerts marked as read.'); } catch (e) { ui.toast(e.message, { kind: 'error' }); } },
  openAlert: async (el) => {
    const id = el.dataset.id, link = el.dataset.link;
    try { await api.put('/api/user-notifications/' + encodeURIComponent(id) + '/read'); } catch (e) { /* best-effort */ }
    closePopover(); chrome.refresh({ only: 'notifications' });
    if (link) router.navigate(routeFor(link, '/app/home'));
  },
  openResult: (el) => {
    const sec = el.dataset.section; closePopover();
    if (sec === 'talks') return ui.toast(COPY.talksRetired);
    router.navigate(routeFor(sec, '/app/home'));
  },
  resend: async (el) => {
    const email = (state.get().user || {}).email; if (!email) return ui.toast('No email on this session — sign in again.', { kind: 'error' });
    el.setAttribute('aria-disabled', 'true');
    try { const r = await api.post('/api/auth/request-verification', { email }); ui.toast(r.message || COPY.banner.sent); if (r.devVerifyUrl) console.info('[dev] verification link:', r.devVerifyUrl); }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
    setTimeout(() => el.removeAttribute('aria-disabled'), 30000);
  },
  hideBanner: () => { try { sessionStorage.setItem(VERIFY_DISMISS_KEY, 'true'); } catch (e) {} renderAll(); }
};

export const chrome = {
  mount() {
    els.chrome = document.getElementById('chrome');
    els.overlays = document.getElementById('chrome-overlays') || (() => { const d = document.createElement('div'); d.id = 'chrome-overlays'; document.body.appendChild(d); return d; })();
    ui.bind(els.chrome, handlers);
    ui.bind(els.overlays, handlers);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (popover) closePopover(); else chrome.closeDrawer(); } });
    document.addEventListener('click', e => { if (popover === 'alerts' && !e.target.closest('.mx-pop') && !e.target.closest('[data-act="alerts"]')) closePopover(); });
    state.subscribe((s, keys) => { if (keys.some(k => ['user', 'stats', 'unread', 'active', 'layout', 'viewTitle', 'notifications'].includes(k))) renderAll(); });
    renderAll();
  },
  toggleDrawer() { document.body.classList.contains('drawer-open') ? chrome.closeDrawer() : chrome.openDrawer(); },
  openDrawer() { document.body.classList.add('drawer-open'); const s = els.overlays.querySelector('#mx-scrim'); if (s) s.setAttribute('aria-hidden', 'false'); const first = els.overlays.querySelector('#mx-drawer a'); if (first) first.focus(); },
  closeDrawer() { document.body.classList.remove('drawer-open'); const s = els.overlays.querySelector('#mx-scrim'); if (s) s.setAttribute('aria-hidden', 'true'); },
  closePopover,
  // stats strip + unread dot — all live reads, never hardcoded
  async refresh({ only } = {}) {
    if (!session.isAuthed) return;
    if (only === 'notifications') {
      try {
        const [n, inb] = await Promise.all([
          api.get('/api/user-notifications?limit=10'),
          api.get('/api/v2/messages/unread-count').catch(() => null)
        ]);
        state.set({ unread: (n.unreadCount || 0) + ((inb && inb.unread) || 0), notifications: n.notifications || [] });
      } catch (e) {}
      return;
    }
    const r = await api.settle({
      events: api.get('/api/my/events'),
      topics: api.get('/api/notify-topics'),
      meta: api.get('/api/member/meta'),
      notifs: api.get('/api/user-notifications?limit=10'),
      inbox: api.get('/api/v2/messages/unread-count')
    });
    const u = state.get().user || {};
    const stats = {
      quiet: !!u.quiet,
      registrations: r.events ? Number(r.events.count || 0) : null,
      following: r.topics ? (r.topics.projects || []).length : null,
      since: r.meta && r.meta.member_since ? String(r.meta.member_since).slice(0, 4) : null
    };
    state.set({ stats, unread: (r.notifs ? (r.notifs.unreadCount || 0) : 0) + (r.inbox ? (r.inbox.unread || 0) : 0), notifications: r.notifs ? (r.notifs.notifications || []) : [] });
  }
};
export default chrome;
