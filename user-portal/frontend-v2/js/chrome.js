// Source: Portal Chrome.dc.html (desktop chrome: top bar · member-stats strip · email-confirm
//         banner · scrim · 300px ink drawer) + Mobile Portal.dc.html (≤500px: sticky compact
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
import { knownBlocks, loadBlocks, isKnownBlocked } from './views/_safety.js';

export const COPY = {
  menu: 'MENU', search: 'SEARCH', alerts: 'ALERTS',
  memberLabel: 'Med&amp;X Member',
  banner: { lead: 'Confirm your email to unlock everything. Link sent to ', leadShort: 'Confirm your email to unlock everything.', resend: 'RESEND LINK', resendShort: 'RESEND', sent: 'Link sent — check your inbox (and spam).' },
  stats: { registrations: 'REGISTRATIONS', following: 'FOLLOWING', since: 'MEMBER SINCE' },
  drawer: { portal: 'PORTAL', projects: 'Projects', quick: 'QUICK LINKS', website: 'Website ↗' },
  searchPanel: { placeholder: 'Search events, people, tickets…', hint: 'Type at least two characters.', none: 'Nothing matched — try a name, a city or an event.', groups: { projects: 'PROJECTS', events: 'EVENTS', members: 'PEOPLE', mine: 'MINE' } },
  alertsPanel: { title: 'ALERTS', markAll: 'MARK ALL READ', emptyLine: 'All quiet.', emptyWhy: 'Announcements and replies land here the moment they arrive.' },
  // title: the artboard's label for Home. At 390 px it ran out of room beside the logo ('MEMBER PORT…'),
  // so Home shows `home` — the logo already names the portal, and every other root tab shows its own name
  mobile: { title: 'MEMBER PORTAL', home: 'HOME', tabs: ['HOME', 'PROJECTS', 'PEOPLE', 'INBOX', 'MY M&X'] },
  talksRetired: 'The Talk Library was retired — recordings return when real Plexus talks exist.'
};

// drawer PORTAL group — order and labels exactly as Portal Chrome.dc.html
const NAV = [
  { key: 'Home', label: 'Home', to: '/app/home' },
  // Projects opens the five project cards (/app/projects) — it used to be an inert span dressed exactly like
  // the links above and below it, so a tap did nothing
  { key: 'Projects', label: COPY.drawer.projects, to: '/app/projects' },
  // "Plexus Week" is the umbrella (conference · gala · Building Bridges Zagreb · meetups) —
  // design/MEETUPS-SPEC.md §1. The key stays 'Plexus': it is the router's `active` value.
  { key: 'Plexus', label: 'Plexus Week', to: '/app/plexus', sub: true },
  // Meetups has its own key because the meetup routes carry active:'Meetups' — standing on the
  // board lights this entry, the way a sub-entry should.
  { key: 'Meetups', label: 'Meetups', to: '/app/plexus/meetups', sub: true, v2: true },
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
  { label: 'Messages', to: '/app/messages', v2: true }
];
// nav styles — verbatim from the artboard's renderVals()
const NAV_BASE = 'display:block;padding:9px 26px;font-size:14px;color:rgba(247,241,230,.72);text-decoration:none';
const NAV_ACT = 'display:block;padding:9px 24px;border-left:2px solid #c9a962;background:rgba(201,169,98,.08);font-size:14px;font-weight:600;color:#f7f1e6;text-decoration:none';
const NAV_SUB = 'display:block;padding:5px 26px 5px 42px;font-size:12.5px;color:rgba(247,241,230,.55);text-decoration:none';
const NAV_SUB_ACT = 'display:block;padding:5px 26px 5px 40px;border-left:2px solid #c9a962;background:rgba(201,169,98,.08);font-size:12.5px;font-weight:600;color:#f7f1e6;text-decoration:none';

const TAB_ROOTS = { HOME: '/app/home', PROJECTS: '/app/projects', PEOPLE: '/app/network', INBOX: '/app/messages', 'MY M&X': '/app/me' };
// the five project screens sit under PROJECTS — standing on one used to leave the tab bar with nothing lit
const PROJECT_ROOTS = ['/app/plexus', '/app/gala', '/app/accelerator', '/app/forum', '/app/bridges', '/app/opportunities'];
// …and Profile & settings sits under MY M&X (its breadcrumb reads MY MED&X → PROFILE & SETTINGS), Mentorship under PEOPLE
const TAB_EXTRA = { 'MY M&X': ['/app/profile'], PEOPLE: ['/app/mentorship'] };
const VERIFY_DISMISS_KEY = 'medx_verify_dismissed'; // legacy sessionStorage key, kept

// the side menu's slide shut (app.css › #mx-drawer: --t-reveal 340 ms on --ease): 98 % of the way out by 240 ms. The
// router starts the crossing then (the scrim's last tenth dissolves with the old screen), under its 250 ms "slow" dim
const DRAWER_MS = 240;
let drawerShutAt = 0;
let els = {};
let popover = null; // 'alerts' | 'search' | null
let searchTimer = null;
let popOpenedAt = 0, popCloseTimer = null;   // entrance runs once per opening, exit fades (app.css › .mx-pop-in / .mx-pop-out)
let searchActive = -1;                       // the row ↑ / ↓ has reached in the search results (-1 = none)
let drawerTimer = null;
// keyboard focus stays inside the open overlay (ui.trapFocus); these release it and remember who opened it
let popTrap = null, drawerTrap = null, drawerFrom = null;

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
    <a href="/app/home" class="mx-brand" style="display:block"><img src="/assets/logo.png" alt="med&amp;X" style="width:auto;height:22px;display:block"></a>
    <div style="flex:1"></div>
    <span data-act="search" aria-label="Search" style="font:600 10.5px Inter,sans-serif;letter-spacing:.16em;color:#4a4239;cursor:pointer" data-hover="color:#191512">${COPY.search}</span>
    <span data-act="alerts" aria-label="Alerts" style="display:flex;align-items:center;gap:6px;font:600 10.5px Inter,sans-serif;letter-spacing:.16em;color:#4a4239;cursor:pointer" data-hover="color:#191512">${COPY.alerts}<span data-role="unread-dot" style="width:6px;height:6px;background:#c9a962;display:${s.unread > 0 ? 'inline-block' : 'none'}"></span></span>
    <span style="width:1px;height:18px;background:rgba(25,21,18,.16)"></span>
    <a href="/app/me" style="display:flex;align-items:center;gap:10px;text-decoration:none;color:#191512" data-hover="color:#191512">
      <span class="mx-avatar" style="width:30px;height:30px;background:#191512;color:#f7f1e6;display:inline-flex;align-items:center;justify-content:center;font:600 12px Fraunces,serif">${esc(session.initials())}</span>
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
  <div id="mx-scrim" data-act="cl" aria-hidden="true" tabindex="-1"></div>
  <div id="mx-drawer" role="navigation" aria-label="Portal menu">
    <div style="display:flex;align-items:center;padding:0 26px"><img src="/assets/logo-white.png" alt="med&amp;X" style="height:20px;display:block"><div style="flex:1"></div><span data-act="cl" aria-label="Close menu" style="font-size:20px;color:rgba(247,241,230,.7);cursor:pointer" data-hover="color:#f7f1e6">×</span></div>
    <div style="font:600 10px Inter,sans-serif;letter-spacing:.2em;color:rgba(201,169,98,.9);padding:0 26px;margin:30px 0 8px">${COPY.drawer.portal}</div>
    <div style="display:flex;flex-direction:column">
      ${NAV.map(n => `<a href="${n.to}" style="${nav(n.key, n.sub)}" data-hover="color:#f7f1e6"${n.v2 ? ' data-v2="nav entry not in Portal Chrome.dc.html"' : ''}>${n.label}</a>`).join('\n      ')}
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
  // the bar belongs to the screen on view: its back arrow and title change when the new screen draws (the router's
  // stage, state.shownPath), not at the tap while the screen being left is still up. The tab bar lights at once.
  const s = state.get(); const path = s.shownPath || router.path;
  const isRoot = Object.values(TAB_ROOTS).includes(path.replace(/\/$/, '')) || path === '/' || path === '/app';
  const title = path === '/app/home' || path === '/' || path === '/app' ? COPY.mobile.home : fmt.upper(s.viewTitle || '');
  return `
  <!-- dc: Mobile Portal.dc.html › "Top bar" -->
  <!-- the bar sticks through its host: app.css makes #chrome sticky at phone widths (a sticky bar inside a header
       exactly its own height had no room to stick). Search and alerts are 44 px targets drawn at 36 (-4 px margin) -->
  <div id="mx-mobile-top" style="display:flex;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid rgba(25,21,18,.16);position:relative;background:#f7f1e6">
    ${isRoot
      ? `<a href="/app/home" class="mx-brand" style="display:block"><img src="/assets/logo.png" alt="med&amp;X" style="width:auto;height:17px;display:block"></a>`
      : `<span data-act="back" aria-label="Back" style="font-size:17px;cursor:pointer;color:#9b1b22;min-width:44px;min-height:44px;margin:-10px 0;display:inline-flex;align-items:center">←</span>`}
    <span style="font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#4a4239;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0">${esc(title)}</span>
    <div style="flex:1"></div>
    <span data-act="search" role="button" aria-label="Search" style="width:44px;height:44px;margin:-4px;display:inline-flex;align-items:center;justify-content:center;color:#191512;cursor:pointer"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21" stroke-linecap="square"/></svg></span>
    <span data-act="alerts" role="button" aria-label="Alerts" style="position:relative;width:44px;height:44px;margin:-4px;display:inline-flex;align-items:center;justify-content:center;color:#191512;cursor:pointer"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2H4.5z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg><span style="position:absolute;top:12px;right:12px;width:6px;height:6px;background:#c9a962;display:${s.unread > 0 ? 'block' : 'none'}"></span></span>
    <a href="/app/me" aria-label="My Med&X" style="width:30px;height:30px;background:#191512;color:#f7f1e6;display:inline-flex;align-items:center;justify-content:center;font:600 10.5px Fraunces,serif;text-decoration:none">${esc(session.initials())}</a>
    <div data-role="popover-m"></div>
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
  const under = root => path === root || path.startsWith(root + '/');
  const on = label => under(TAB_ROOTS[label]) || (label === 'HOME' && (path === '/' || path === '/app')) || (label === 'PROJECTS' && PROJECT_ROOTS.some(under)) || (TAB_EXTRA[label] || []).some(under);
  return `
  <!-- dc: Mobile Portal.dc.html › "Tab bar" -->
  <div id="mx-tabbar" role="tablist" style="position:fixed;bottom:0;left:0;right:0;max-width:500px;margin:0 auto;background:#191512;display:flex;z-index:30">
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
    <div class="mx-pop-head"><span style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#9b1b22">${COPY.alertsPanel.title}${s.unread ? ' · ' + s.unread + ' NEW' : ''}</span><div style="flex:1"></div>${list.length ? `<span data-act="markAll" style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:#9b1b22;cursor:pointer">${COPY.alertsPanel.markAll}</span>` : ''}<span data-act="closePop" role="button" tabindex="0" aria-label="Close" style="margin-left:14px;color:#4a4239;cursor:pointer">×</span></div>
    <div class="mx-pop-list">${s.msgUnread > 0 ? `<div class="mx-pop-row" data-act="openInbox"><span style="width:7px;height:7px;flex:none;margin-top:5px;background:#c9a962"></span><span style="flex:1;min-width:0;font-size:13px;font-weight:600;line-height:1.3">${s.msgUnread} unread message${s.msgUnread === 1 ? '' : 's'}</span><span style="font:600 9px Inter,sans-serif;letter-spacing:.16em;color:#9b1b22;white-space:nowrap">OPEN →</span></div>` : ''}${list.length ? list.map(row).join('') : s.msgUnread > 0 ? '' : `<div class="empty"><span class="rule-gold" style="margin-bottom:6px"></span><span class="empty-line">${COPY.alertsPanel.emptyLine}</span><span class="empty-why">${COPY.alertsPanel.emptyWhy}</span></div>`}</div>
  </div>`;
}
function searchOverlay() {
  return `<div class="mx-search" data-act="closePop" tabindex="-1" role="dialog" aria-label="Search">
    <div class="mx-search-panel" data-stop="1">
      <input data-role="q" type="search" placeholder="${esc(COPY.searchPanel.placeholder)}" aria-label="Search" autocomplete="off">
      <div data-role="results" class="mx-pop-list"><div style="padding:14px 20px;font-size:12px;color:#4a4239">${COPY.searchPanel.hint}</div></div>
    </div>
  </div>`;
}
// Projects the search can always name (the server's events group never listed the Gala Evening)
const SEARCH_PROJECTS = [
  { title: 'Plexus Week 2026', detail: 'Conference · Gala · Building Bridges · Meetups', to: '/app/plexus', words: 'plexus week conference zagreb december program speakers' },
  { title: 'Gala Evening', detail: 'Hotel Esplanade · 5 December', to: '/app/gala', words: 'gala evening dinner awards esplanade seat' },
  { title: 'The Accelerator', detail: 'Summer research placements', to: '/app/accelerator', words: 'accelerator internship placement fellowship apply' },
  { title: 'Biomedical Forum', detail: 'By invitation', to: '/app/forum', words: 'forum biomedical invitation code' },
  { title: 'Building Bridges', detail: 'Evenings across the world', to: '/app/bridges', words: 'building bridges boston zagreb diaspora' },
  { title: 'Meetups', detail: 'Small tables during Plexus Week', to: '/app/plexus/meetups', words: 'meetups tables coffee lunch' },
  { title: 'Plexus Week Live', detail: 'The event app — program and your schedule', to: '/app/live', words: 'live event app schedule program' },
  { title: 'Messages', detail: 'Write to the Med&X team', to: '/app/messages', words: 'messages inbox contact team help' },
  { title: 'Profile & settings', detail: 'Name, photo, password, topics · delete account', to: '/app/profile', words: 'profile settings password photo account delete close remove erase my data' }
];
function searchResults(res) {
  const groups = ['projects', 'events', 'members', 'mine'].filter(g => res[g] && res[g].length);
  if (!groups.length) return `<div class="empty"><span class="empty-line">${COPY.searchPanel.none}</span></div>`;
  return groups.map(g => `<div class="mx-search-group">${COPY.searchPanel.groups[g]}</div>` + res[g].map(it => `<div class="mx-pop-row" data-act="openResult" data-section="${esc(it.section || '')}" data-kind="${esc(it.kind || '')}"${it.to ? ` data-to="${esc(it.to)}"` : ''}>
      <span style="flex:1;min-width:0"><span style="display:block;font-family:Fraunces,serif;font-size:15px;line-height:1.25">${esc(it.title)}</span><span style="display:block;font-size:11.5px;color:#4a4239;margin-top:2px">${esc(it.detail || '')}</span></span>
      <span style="font:600 9px Inter,sans-serif;letter-spacing:.16em;color:#9b1b22;white-space:nowrap">OPEN →</span></div>`).join('')).join('');
}

// ---------------------------------------------------------------- render + behaviour
// The chrome re-renders on every state change it shows (a route, the unread count, the stats arriving). Markup that
// did not change is not rewritten (a rewrite re-decodes the logo, drops a press in progress and restarts nothing
// useful); the drawer, its scrim and the tab bar are kept as elements and updated in place, so the drawer's slide
// out is never cut short by a route change and the tab bar's light eases from one tab to the next.
function renderAll() {
  const s = state.get();
  const portal = s.layout === 'portal';
  document.body.setAttribute('data-layout', s.layout || 'portal');
  document.body.classList.toggle('authed', session.isAuthed);
  const html = portal ? `<div id="mx-desktop-chrome">${topBar()}${statsStrip()}${banner()}</div>${mobileTop()}` : '';
  if (html !== els.chrome._html || (portal && !els.chrome.firstElementChild)) { els.chrome.innerHTML = html; els.chrome._html = html; }
  renderOverlays(portal);
  if (popover) renderPopover();
}
function renderOverlays(portal) {
  const o = els.overlays;
  if (!portal) { if (o.firstChild) o.innerHTML = ''; o._drawer = o._tabs = null; return; }
  const d = drawer(), t = tabBar();
  const dr = o.querySelector('#mx-drawer'), tb = o.querySelector('#mx-tabbar');
  if (!dr || !tb || !o.querySelector('#mx-scrim')) { o.innerHTML = d + t; o._drawer = d; o._tabs = t; return; }
  if (o._drawer !== d) { const n = ui.h(`<div>${d}</div>`).querySelector('#mx-drawer'); if (n) dr.innerHTML = n.innerHTML; o._drawer = d; }
  if (o._tabs !== t) { patchTabs(tb, ui.h(t.replace(/<!--[\s\S]*?-->/g, ''))); o._tabs = t; }
}
// the same five tabs, another one lit: attributes and inline styles move over, so the css transitions carry them
function patchTabs(el, next) {
  const now = [...el.querySelectorAll(':scope > a')], want = next ? [...next.querySelectorAll(':scope > a')] : [];
  if (!want.length || now.length !== want.length || now.some((a, i) => a.getAttribute('href') !== want[i].getAttribute('href'))) { el.replaceWith(next); return; }
  now.forEach((a, i) => {
    const b = want[i];
    ['aria-selected', 'style'].forEach(k => { if (a.getAttribute(k) !== b.getAttribute(k)) a.setAttribute(k, b.getAttribute(k)); });
    [...a.children].forEach((c, j) => { const w = b.children[j]; if (w && c.getAttribute('style') !== w.getAttribute('style')) c.setAttribute('style', w.getAttribute('style')); });
  });
}
function renderPopover() {
  clearTimeout(popCloseTimer);
  // the phone bar has its own host — the desktop one sits inside the hidden desktop chrome
  const phone = window.matchMedia && window.matchMedia('(max-width: 500px)').matches;
  els.chrome.querySelectorAll('[data-role="popover"], [data-role="popover-m"]').forEach(h => { h.innerHTML = ''; });
  const host = els.chrome.querySelector(phone ? '[data-role="popover-m"]' : '[data-role="popover"]');
  if (!host) return;
  host.innerHTML = popover === 'alerts' ? alertsPanel() : popover === 'search' ? searchOverlay() : '';
  // The panel is re-drawn whenever its data lands (alerts refresh, chrome re-render). Only the opening
  // pass animates, and a re-draw during it picks the animation up where it was (negative delay).
  const panel = host.firstElementChild;
  const t = performance.now() - popOpenedAt;
  if (panel && t < 360) { panel.classList.add('mx-pop-in'); if (t > 16) panel.style.setProperty('--pop-t', (-t).toFixed(0) + 'ms'); }
  if (popover === 'search') { const q = host.querySelector('[data-role="q"]'); if (q) { q.focus(); q.addEventListener('input', onSearchInput); q.addEventListener('keydown', onSearchKey); searchActive = -1; } }
}
// SEARCH and ALERTS keep keyboard focus inside themselves while open (the panel is re-drawn when its data
// lands, so the trap looks it up each time); ALERTS takes focus on opening — it used to stay on <body>
const popPanel = () => els.chrome && els.chrome.querySelector(popover === 'search' ? '.mx-search-panel' : '.mx-pop');
function openPopover(kind) {
  popover = kind; popOpenedAt = performance.now(); renderPopover();
  if (!popTrap) popTrap = ui.trapFocus(popPanel);
  if (kind === 'alerts') { const x = els.chrome.querySelector('.mx-pop [data-act="closePop"]'); if (x) { try { x.focus({ preventScroll: true }); } catch (e) {} } }
}
// `refocus`: closed by the member (Escape, ×, the scrim) — focus goes back to SEARCH / ALERTS, where it came
// from, instead of dropping to <body> when the panel leaves. A close that navigates passes nothing.
function closePopover({ refocus } = {}) {
  const was = popover;
  popover = null;
  if (popTrap) { popTrap(); popTrap = null; }
  if (refocus && was) {
    const host = els.chrome && els.chrome.querySelector('.mx-pop, .mx-search');
    const a = document.activeElement;
    if (!a || a === document.body || (host && host.contains(a))) {
      const trigger = [...els.chrome.querySelectorAll(`[data-act="${was}"]`)].find(t => t.offsetParent !== null);
      if (trigger) { try { trigger.focus({ preventScroll: true }); } catch (e) {} }
    }
  }
  const live = els.chrome ? els.chrome.querySelectorAll('.mx-pop, .mx-search') : [];
  if (!live.length || ui.reducedMotion()) return renderPopover();
  live.forEach(n => { n.classList.remove('mx-pop-in'); n.classList.add('mx-pop-out'); });
  clearTimeout(popCloseTimer);
  popCloseTimer = setTimeout(() => { if (!popover) renderPopover(); }, 230);   // the exit (--t-exit) and a frame
}
// SEARCH: ↑ / ↓ walk the result rows (a visible active row, kept in view), Enter opens the active one
function onSearchKey(e) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return;
  const rows = [...els.chrome.querySelectorAll('.mx-search [data-role="results"] .mx-pop-row')];
  if (!rows.length) return;
  if (e.key === 'Enter') { if (searchActive >= 0 && rows[searchActive]) { e.preventDefault(); rows[searchActive].click(); } return; }
  e.preventDefault();
  searchActive = e.key === 'ArrowDown' ? Math.min(rows.length - 1, searchActive + 1) : Math.max(-1, searchActive - 1);
  rows.forEach((r, i) => r.classList.toggle('is-active', i === searchActive));
  if (rows[searchActive]) rows[searchActive].scrollIntoView({ block: 'nearest' });
}
function onSearchInput(e) {
  const q = e.target.value.trim();
  clearTimeout(searchTimer);
  const box = els.chrome.querySelector('[data-role="results"]');
  if (q.length < 2) { searchActive = -1; if (box) box.innerHTML = `<div style="padding:14px 20px;font-size:12px;color:#4a4239">${COPY.searchPanel.hint}</div>`; return; }
  searchTimer = setTimeout(async () => {
    try {
      // the server's search only knew confirmed Plexus registrants as people — the member directory
      // (the same list /app/network shows) answers the PEOPLE group, and a hit opens that person there
      const [res, net] = await Promise.all([
        api.get('/api/member/search?q=' + encodeURIComponent(q)),
        api.get('/api/v2/network/search?size=6&q=' + encodeURIComponent(q)).catch(() => null),
        knownBlocks() ? null : loadBlocks()      // the member's own block list, once per sign-in (App Store 1.2)
      ]);
      const ql = q.toLowerCase();
      // every word of the query has to appear ("delete my account" finds Profile & settings)
      const toks = ql.split(/\s+/).filter(Boolean);
      res.projects = SEARCH_PROJECTS.filter(p => { const hay = (p.title + ' ' + p.words).toLowerCase(); return toks.every(w => hay.includes(w)); }).slice(0, 4);
      const seen = new Set();
      const people = ((net && net.results) || []).map(m => ({ kind: 'member', id: m.id, title: m.name, detail: [m.institution, m.city || m.country].filter(Boolean).join(' · ') || 'Med&X member', to: '/app/network?q=' + encodeURIComponent(m.name || q) }));
      // people this member blocked never come back through search (the server filters too — this is the second line).
      // By account id only: a Forum hit's id is its Forum record, so it carries the account as user_id.
      const blocked = m => isKnownBlocked({ id: m.kind === 'forum_member' ? m.user_id : m.id });
      res.members = people.concat(res.members || []).filter(m => !blocked(m)).filter(m => { const k = String(m.title || '').toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 6);
      delete res.talks;   // the Talk Library is retired
      if (box && popover === 'search') { box.innerHTML = searchResults(res); searchActive = -1; }
    }
    catch (err) { if (box) box.innerHTML = `<div style="padding:14px 20px;font-size:12px;color:#9b1b22">${esc(err.message)}</div>`; }
  }, 250);
}

const handlers = {
  tg: () => chrome.toggleDrawer(),
  cl: () => chrome.closeDrawer(),
  back: () => (history.length > 1 ? history.back() : router.navigate('/app/home')),
  search: () => { if (popover === 'search') closePopover({ refocus: true }); else openPopover('search'); },
  alerts: async () => {
    if (popover === 'alerts') return closePopover({ refocus: true });
    openPopover('alerts'); await chrome.refresh({ only: 'notifications' });
    // the refreshed panel is a new node: keep focus in it (on its × unless the member already moved on)
    if (popover === 'alerts') { const a = document.activeElement; renderPopover(); if (!a || a === document.body || !a.isConnected) { const x = els.chrome.querySelector('.mx-pop [data-act="closePop"]'); if (x) { try { x.focus({ preventScroll: true }); } catch (e) {} } } }
  },
  closePop: (el, e) => { if (e && e.target.closest && e.target.closest('[data-stop]')) return; closePopover({ refocus: true }); },
  openInbox: () => { closePopover(); router.navigate('/app/messages'); },
  markAll: async () => { try { await api.put('/api/user-notifications/mark-all-read'); await chrome.refresh({ only: 'notifications' }); renderPopover(); ui.toast('All alerts marked as read.'); } catch (e) { ui.toast(e.message, { kind: 'error' }); } },
  openAlert: async (el) => {
    const id = el.dataset.id, link = el.dataset.link;
    try { await api.put('/api/user-notifications/' + encodeURIComponent(id) + '/read'); } catch (e) { /* best-effort */ }
    closePopover(); chrome.refresh({ only: 'notifications' });
    if (link) router.navigate(routeFor(link, '/app/home'));
  },
  openResult: (el) => {
    const sec = el.dataset.section, to = el.dataset.to; closePopover();
    if (to) return router.navigate(to);
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
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { if (popover) closePopover({ refocus: true }); else chrome.closeDrawer(); return; }
      // the portal's finder from the keyboard: ⌘K / Ctrl+K anywhere, "/" outside a text field. The Mac app binds
      // ⌘K in its own menu (medx-desktop › menu.js), so the page leaves that one to it there.
      if (state.get().layout !== 'portal' || !session.isAuthed || popover === 'search') return;
      const cmdK = (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && String(e.key).toLowerCase() === 'k' && !document.documentElement.classList.contains('mx-desktop');
      const t = e.target, typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      const slash = e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !typing && !document.querySelector('.mx-modal, [role="dialog"][aria-modal="true"]');
      if (!cmdK && !slash) return;
      e.preventDefault();
      if (document.body.classList.contains('drawer-open')) chrome.closeDrawer();
      openPopover('search');
    });
    document.addEventListener('click', e => { if (popover === 'alerts' && !e.target.closest('.mx-pop') && !e.target.closest('[data-act="alerts"]')) closePopover(); });
    state.subscribe((s, keys) => { if (keys.some(k => ['user', 'stats', 'unread', 'msgUnread', 'active', 'layout', 'viewTitle', 'shownPath', 'notifications'].includes(k))) renderAll(); });
    renderAll();
  },
  toggleDrawer() { document.body.classList.contains('drawer-open') ? chrome.closeDrawer() : chrome.openDrawer(); },
  openDrawer() {
    document.body.classList.add('drawer-open'); const s = els.overlays.querySelector('#mx-scrim'); if (s) s.setAttribute('aria-hidden', 'false');
    // one pass of the entries following the panel in (app.css › #mx-drawer.is-entering); a re-drawn drawer stays still
    const d = els.overlays.querySelector('#mx-drawer');
    if (d) {
      // every menu line steps in on its own, 22 ms apart (capped at 160 ms): the headings, each entry of the
      // two lists, the rules, the website link — a list no longer arrives as one slab
      const lines = [];
      for (const c of d.children) { if (c.tagName === 'DIV' && c.querySelector(':scope > a')) lines.push(...c.children); else lines.push(c); }
      lines.forEach((el, i) => { el.classList.add('mx-dr-i'); el.style.setProperty('--dr-d', Math.min(i * 22, 160) + 'ms'); });
      d.classList.remove('is-entering'); void d.offsetWidth; d.classList.add('is-entering');
      clearTimeout(drawerTimer); drawerTimer = setTimeout(() => d.classList.remove('is-entering'), 700);
    }
    // keyboard focus stays in the menu while it is open (Tab used to walk out past "Website ↗" into the page)
    // and goes back to MENU when it closes
    if (!drawerTrap) { const a = document.activeElement; drawerFrom = a && a !== document.body ? a : null; drawerTrap = ui.trapFocus(() => els.overlays.querySelector('#mx-drawer')); }
    const first = els.overlays.querySelector('#mx-drawer a'); if (first) first.focus({ preventScroll: true });
  },
  closeDrawer() {
    const wasOpen = document.body.classList.contains('drawer-open');
    if (wasOpen) drawerShutAt = performance.now();
    document.body.classList.remove('drawer-open'); const s = els.overlays.querySelector('#mx-scrim'); if (s) s.setAttribute('aria-hidden', 'true');
    if (drawerTrap) { drawerTrap(); drawerTrap = null; }
    if (wasOpen) {
      const d = els.overlays.querySelector('#mx-drawer'), a = document.activeElement;
      const menu = drawerFrom && drawerFrom.isConnected ? drawerFrom : [...els.chrome.querySelectorAll('[data-act="tg"]')].find(t => t.offsetParent !== null);
      if (menu && (!a || a === document.body || (d && d.contains(a)))) { try { menu.focus({ preventScroll: true }); } catch (e) {} }
    }
    drawerFrom = null;
  },
  // resolves once the side menu has finished sliding shut (at once when it was not open): the router snapshots the old
  // screen after it (router.js › hooks.settle), so the menu is never caught mid-slide
  drawerSettled() {
    const left = drawerShutAt ? DRAWER_MS - (performance.now() - drawerShutAt) : 0;
    return left > 0 && !ui.reducedMotion() ? new Promise(r => setTimeout(r, left)) : Promise.resolve();
  },
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
        state.set({ unread: (n.unreadCount || 0) + ((inb && inb.unread) || 0), msgUnread: (inb && inb.unread) || 0, notifications: n.notifications || [] });
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
    state.set({ stats, unread: (r.notifs ? (r.notifs.unreadCount || 0) : 0) + (r.inbox ? (r.inbox.unread || 0) : 0), msgUnread: r.inbox ? (r.inbox.unread || 0) : 0, notifications: r.notifs ? (r.notifs.notifications || []) : [] });
  }
};
export default chrome;
