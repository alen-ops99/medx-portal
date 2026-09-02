// Source: Admin Home.dc.html (header: stacked logo lockup + ADMIN · top nav · TEAM CHAT pill ·
//         search-or-task field · profile avatar + menu) — the same header sits on all 17 artboards.
//         ONE implementation, mounted once by app.js; every view renders below it. Markup and inline
//         styles are the artboard's; only the bound props ({{ q }}, {{ avatarInitials }} …) became data.
// v2 additions (no artboard): PROJECTS dropdown (Plexus · Accelerator · Forum · Bridges + Review Room ·
// What members see · Event Day Room), EVENT DAY nav item on event dates, locked nav items, the ≤760px
// MENU collapse (note 0a), assistant rows in the search field (note 14).
// Audit 2026-09-02 #10: "/" and ⌘K/Ctrl+K focus the search box ("/" steps aside while a field has
// focus); the results popover right-aligns and clamps inside the viewport; the palette carries
// HR/EN operator vocabulary (`syn`) with diacritic folding, so "invoice", "račun"/"racun",
// "putni nalog", "scan" or "badge" find their screens instead of "No matches".
//
//   import { chrome } from './chrome.js';
//   chrome.mount();                 // once (app.js)
//   chrome.refresh();               // re-read badges (INBOX = outbox batches + unread member messages · TEAM CHAT) + event-day flag
//   chrome.closePopover();
import cfg from './config.js';
import { api } from './api.js';
import { session, state } from './state.js';
import { ui, esc, fmt } from './ui.js';
import { FACTS, routeForSection } from './facts.js';
import { perms } from './perms.js';
import router from './router.js';

export const COPY = {
  admin: 'ADMIN',
  nav: { today: 'TODAY', projects: 'PROJECTS', inbox: 'INBOX', people: 'PEOPLE', money: 'MONEY', calendar: 'CALENDAR', eventDay: 'EVENT DAY', studio: 'STUDIO', settings: 'SETTINGS', menu: 'MENU' },
  chat: { label: 'TEAM CHAT', title: 'Team chat — straight to the chat tab' },
  search: { placeholder: 'Search or type a task…', none: 'No matches — try a screen, a person, or a project.', hint: 'Type a name, a screen, or an instruction — Enter asks the assistant.', asking: 'Asking the assistant…', ask: 'ASK', confirm: 'CONFIRM', done: 'Done.', gated: 'The do-it-for-me assistant needs ANTHROPIC_API_KEY on the admin service — search and live numbers still work.' },
  menu: { displayName: 'DISPLAY NAME', save: 'SAVE', saved: '✓ SAVED', team: 'TEAM ACCESS →', signOut: 'SIGN OUT', profileTitle: 'Your profile', locked: 'Locked — ask Alen, he grants access per section' },
  projects: { plexus: 'Plexus Week 2026', accelerator: 'Accelerator', forum: 'Biomedical Forum', bridges: 'Building Bridges', review: 'Review Room', pages: 'What members see', eventDay: 'Event Day Room', links: 'Links', gala: 'Gala Evening' },
  signedOut: 'Signed out.'
};

// top nav — order and labels exactly as the artboards (EVENT DAY inserted before STUDIO on event dates)
const NAV = [
  { key: 'Today', label: COPY.nav.today, to: '/today' },
  { key: 'Projects', label: COPY.nav.projects, to: '/projects/plexus', dropdown: true, sections: ['plexus', 'accelerator', 'forum', 'bridges'] },
  { key: 'Inbox', label: COPY.nav.inbox, to: '/inbox', badge: 'inbox', sections: ['member-ops', 'pr-media'] },
  { key: 'People', label: COPY.nav.people, to: '/people', sections: ['member-ops', 'guest-passes', 'team', 'contacts'] },
  { key: 'Money', label: COPY.nav.money, to: '/money', sections: ['finances'] },
  { key: 'Calendar', label: COPY.nav.calendar, to: '/calendar' },
  { key: 'Event Day', label: COPY.nav.eventDay, to: '/event-day', eventDayOnly: true, sections: ['gameday', 'plexus'] },
  { key: 'Studio', label: COPY.nav.studio, to: '/studio', sections: ['pr-media', 'plexus', 'signup-forms'] },
  { key: 'Settings', label: COPY.nav.settings, to: '/settings' }
];
const PROJECTS = [
  { k: 'PLEXUS', label: COPY.projects.plexus, to: '/projects/plexus', sub: FACTS.plexus.dateShort, sections: ['plexus'] },
  { k: 'ACCEL', label: COPY.projects.accelerator, to: '/projects/accelerator', sub: 'opens ' + FACTS.accelerator.opensShort, sections: ['accelerator'] },
  { k: 'FORUM', label: COPY.projects.forum, to: '/projects/forum', sub: 'by invitation', sections: ['forum'] },
  { k: 'BRIDGES', label: COPY.projects.bridges, to: '/projects/bridges', sub: FACTS.bridges.next.city + ' · ' + FACTS.bridges.next.short, sections: ['bridges'] },
  { divider: true },
  { k: 'ROOM', label: COPY.projects.review, to: '/accelerator-review', sub: 'applications', sections: ['accelerator'] },
  { k: 'GALA', label: COPY.projects.gala, to: '/gala', sub: 'seats · chase', sections: ['plexus'] },
  { k: 'PAGES', label: COPY.projects.pages, to: '/member-pages', sub: 'publish', sections: ['pr-media', 'plexus', 'accelerator'] },
  { k: 'LINKS', label: COPY.projects.links, to: '/links', sub: 'invitation links', sections: ['plexus', 'bridges'] },
  { k: 'LIVE', label: COPY.projects.eventDay, to: '/event-day', sub: 'always reachable', sections: ['gameday', 'plexus'] }
];
// search palette — SCREEN / ACTION entries (Admin Home.dc.html `palette`, retargeted to v2 routes).
// Audit #10: `syn` carries the operator vocabulary — HR/EN synonyms ("invoice/račun",
// "putni nalog", "scan", "badge") so the words people actually type find the screen; matching
// folds diacritics both ways (see fold()), so "racun" finds "račun" and vice versa.
const PALETTE = [
  { kind: 'SCREEN', label: 'Today', href: '/today' },
  { kind: 'SCREEN', label: 'Plexus Week hub', href: '/projects/plexus' },
  { kind: 'SCREEN', label: 'Accelerator hub', href: '/projects/accelerator' },
  { kind: 'SCREEN', label: 'Accelerator — Review Room', href: '/accelerator-review' },
  { kind: 'SCREEN', label: 'Biomedical Forum hub', href: '/projects/forum' },
  { kind: 'SCREEN', label: 'Building Bridges hub', href: '/projects/bridges' },
  { kind: 'SCREEN', label: 'Gala Evening — guests, seating, chase', syn: 'seating stol stolovi raspored sjedenja meal menu večera kitchen gosti naplata', href: '/gala' },
  { kind: 'SCREEN', label: 'Inbox — email, outbox, chat', syn: 'poruke pošta mail', href: '/inbox' },
  { kind: 'SCREEN', label: 'People', syn: 'ljudi članovi members kontakti directory imenik', href: '/people' },
  { kind: 'SCREEN', label: 'Registrations — all events', syn: 'prijave registracije sign-ups sudionici attendees', href: '/registrations' },
  { kind: 'SCREEN', label: 'Money', syn: 'novac finance financije knjige računi bookkeeping', href: '/money' },
  { kind: 'SCREEN', label: 'Calendar & tasks', syn: 'kalendar zadaci rokovi deadlines', href: '/calendar' },
  { kind: 'SCREEN', label: 'Studio', href: '/studio' },
  { kind: 'SCREEN', label: 'Settings', syn: 'postavke team tim pristup access', href: '/settings' },
  { kind: 'SCREEN', label: 'System health', syn: 'env keys zdravlje provjere checks', href: '/settings/health' },
  { kind: 'SCREEN', label: 'Event Day room', syn: 'door vrata check-in kontrola live', href: '/event-day' },
  { kind: 'SCREEN', label: 'What members see', syn: 'member pages publish objavi', href: '/member-pages' },
  { kind: 'SCREEN', label: 'Invitation links', syn: 'qr link poveznica invite pozivnica registration', href: '/links' },
  { kind: 'ACTION', label: 'New task', syn: 'zadatak todo', href: '/calendar/tasks' },
  { kind: 'ACTION', label: 'Open the check-in scanner', syn: 'scan qr skener skeniraj check in door vrata ulaz', href: '/event-day' },
  { kind: 'ACTION', label: 'Email registrants', syn: 'send mail pošalji poruka bulk', href: '/inbox/email' },
  { kind: 'ACTION', label: 'Post news to members', syn: 'announcement obavijest novosti', href: '/inbox/announcements' },
  { kind: 'ACTION', label: 'Create a guest pass', syn: 'vip pass propusnica gost', href: '/people' },
  { kind: 'ACTION', label: 'Change my display name', syn: 'profile profil ime', href: '#profile' },
  // ---- operator vocabulary → destinations (audit #10: "invoice" used to return "No matches") ----
  { kind: 'ACTION', label: 'Upiši račun — Money · Knjiga ulaznih računa', syn: 'invoice račun incoming ulazni trošak expense bill supplier dobavljač enter', href: '/money/ulazni' },
  { kind: 'ACTION', label: 'Izlazni računi — Money · Knjiga izlaznih računa', syn: 'invoice račun outgoing izlazni fira fiskalizirani naplata kupac customer', href: '/money/izlazni' },
  { kind: 'ACTION', label: 'Putni nalog — Money · Putni nalozi', syn: 'travel order putni nalog trip put reimbursement', href: '/money/putni' },
  { kind: 'ACTION', label: 'Nalog za plaćanje — Money', syn: 'payment order nalog plaćanje pay wire transfer', href: '/money/nalozi' },
  { kind: 'ACTION', label: 'Radne jedinice — Money', syn: 'work unit radna jedinica grant budget proračun', href: '/money/jedinice' },
  { kind: 'ACTION', label: 'Izvještaji — Money reports', syn: 'report izvještaj export csv presjek po projektu osobi', href: '/money/izvjestaji' },
  { kind: 'ACTION', label: 'Otvorena potraživanja — still owed', syn: 'owed potraživanja refund chase unpaid dug naplata receivables', href: '/money/owed' },
  { kind: 'ACTION', label: 'Chase a Gala payment', syn: 'chase refund unpaid reminder podsjetnik dug gala seat mjesto', href: '/gala' },
  { kind: 'ACTION', label: 'Gala seating board', syn: 'seat seating stol table raspored sjedenja assign', href: '/gala' },
  { kind: 'ACTION', label: 'Kitchen sheet — Gala meals', syn: 'kitchen meal menu večera jelovnik hrana dietary kuhinja', href: '/gala' },
  { kind: 'ACTION', label: 'Approve & send — Outbox', syn: 'approve outbox odobri pošalji queue batch waiting ok', href: '/inbox' },
  { kind: 'ACTION', label: 'Badges & QR — Event Day room', syn: 'badge bedž qr ticket ulaznica akreditacija door scan', href: '/event-day' }
];
// diacritic folding for the palette — "racun" ⇄ "račun", "bedz" ⇄ "bedž"
const fold = s => String(s || "").toLowerCase().replace(/\u0111/g, "d").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
function paletteMatches(q) {
  const toks = fold(q).split(/\s+/).filter(Boolean);
  if (!toks.length) return [];
  return PALETTE.filter(p => { const hay = fold(p.label + ' ' + (p.syn || '')); return toks.every(t => hay.includes(t)); });
}
const IMPERATIVE = /^(email|send|add|create|make|chase|remind|invite|schedule|publish|post|change|update|set|open|show|how|what|who|list|find|count|which|when|where|draft|queue|approve|cancel|delete|remove|rename|move|export|generate|book|tell|give|explain|can)\b/i;

const NAV_ON = 'font:600 11px Inter,sans-serif;letter-spacing:.14em;color:#201b16;border-bottom:2px solid #9b1b22;height:100%;display:flex;align-items:center;box-sizing:border-box';
const NAV_OFF = 'font:600 11px Inter,sans-serif;letter-spacing:.14em;color:#6d6459;height:100%;display:flex;align-items:center';

let els = {};
let popover = null;          // 'search' | 'menu' | 'projects' | null
let searchTimer = null;
let searchState = { q: '', people: [], assistant: null, busy: false };
let nameSaved = false;

// ---------------------------------------------------------------- templates
function navItem(n) {
  const s = state.get();
  if (n.eventDayOnly && !s.eventDay) return '';
  const on = s.active === n.key;
  const locked = n.sections && !perms.canAny(n.sections);
  const badge = n.badge ? (s.badges[n.badge] || 0) : 0;
  const inner = `${n.label}${n.badge ? `<span data-role="badge-${n.badge}" style="min-width:16px;height:16px;padding:0 4px;background:#9b1b22;color:#fff;font:600 10px Inter,sans-serif;display:${badge > 0 ? 'inline-flex' : 'none'};align-items:center;justify-content:center;box-sizing:border-box">${badge}</span>` : ''}${n.dropdown ? `<span style="font-size:8px;margin-left:5px;opacity:.7">▾</span>` : ''}`;
  const style = (on ? NAV_ON : NAV_OFF) + (n.badge ? ';gap:6px' : '');
  const title = locked ? ` title="${esc(COPY.menu.locked)}"` : (n.eventDayOnly ? ' title="Event Day — the control room is live today"' : '');
  if (n.dropdown) return `<span class="mx-nav-item${locked ? ' locked' : ''}${on ? ' active' : ''}" style="height:100%;display:flex;align-items:stretch"><a href="${n.to}" data-act="projects" data-nav-key="${esc(n.key)}" aria-haspopup="true" aria-expanded="${popover === 'projects'}" style="${style}"${title} data-hover="color:#201b16">${inner}</a><div data-role="projects-pop"></div></span>`;
  return `<a href="${n.to}" class="mx-nav-item${locked ? ' locked' : ''}${on ? ' active' : ''}" style="${style}"${title} data-hover="color:#201b16">${inner}</a>`;
}
function projectsPanel() {
  return `<div class="mx-projects" data-v2="PROJECTS dropdown — no artboard; hub sub-nav lives on each hub" role="menu">
    ${PROJECTS.map(p => p.divider ? `<div style="height:1px;background:rgba(32,27,22,.08);margin:6px 0"></div>` : `<a href="${p.to}" role="menuitem"${p.sections && !perms.canAny(p.sections) ? ` style="opacity:.45" title="${esc(COPY.menu.locked)}"` : ''}><span class="k">${p.k}</span><span>${esc(p.label)}</span><span class="sub">${esc(p.sub)}</span></a>`).join('')}
  </div>`;
}
function searchResults() {
  const q = searchState.q.trim(), qv = q.toLowerCase();
  if (!qv) return '';
  const rows = [];
  paletteMatches(q).slice(0, 6).forEach(p => rows.push({ kind: p.kind, label: p.label, href: p.href }));
  searchState.people.slice(0, 6).forEach(p => rows.push({ kind: 'PERSON', label: `${p.name} — ${p.event || p.type}${p.status ? ', ' + p.status : ''}`, href: routeForSection(p.section || 'people', '/people') }));
  const a = searchState.assistant;
  let assist = '';
  if (searchState.busy) assist = `<div class="mx-pop-note">${COPY.search.asking}</div>`;
  else if (a) {
    assist = `<div style="padding:10px 12px;border-top:1px solid rgba(32,27,22,.08)">
      <div style="font:600 8px Inter,sans-serif;letter-spacing:.12em;color:#9b1b22;margin-bottom:4px">ASSISTANT</div>
      <div style="font-size:12.5px;line-height:1.5;color:#201b16">${esc(a.answer || '')}</div>
      ${(a.pending || []).map((p, i) => `<div style="display:flex;gap:10px;align-items:center;margin-top:8px"><span style="font-size:12px;color:#6d6459;flex:1">${esc(p.description || p.tool)}</span><span data-act="execute" data-i="${i}" style="padding:6px 10px;background:#9b1b22;color:#fff;font:600 9px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap">${COPY.search.confirm}</span></div>`).join('')}
      ${a.deepLink && a.deepLink.target ? `<a href="${routeForSection(a.deepLink.target, '/today')}" style="display:inline-block;margin-top:8px;font:600 9px Inter,sans-serif;letter-spacing:.13em">${esc((a.deepLink.label || 'OPEN').toUpperCase())} →</a>` : ''}
      ${a.gated ? `<div style="font-size:11px;color:#6d6459;margin-top:6px">${COPY.search.gated}</div>` : ''}
    </div>`;
  }
  const askRow = !a && !searchState.busy ? `<div class="mx-pop-row" data-act="ask"><span class="mx-pop-kind">ASK</span><span style="flex:1;min-width:0">“${esc(q)}” — ask the assistant ↵</span></div>` : '';
  return `<div class="mx-pop" role="listbox" data-stop="1" style="left:auto;right:0;width:min(320px,calc(100vw - 32px))">
    ${rows.map(r => `<a href="${esc(r.href)}" class="mx-pop-row" data-act="result" data-href="${esc(r.href)}"><span class="mx-pop-kind">${r.kind}</span><span style="flex:1;min-width:0">${esc(r.label)}</span></a>`).join('')}
    ${!rows.length && !a && !searchState.busy ? `<div class="mx-pop-note">${COPY.search.none}</div>` : ''}
    ${askRow}${assist}
  </div>`;
}
function profileMenu() {
  const name = session.displayName();
  return `<div class="mx-menu" data-stop="1" role="dialog" aria-label="Your profile">
    <span style="font-family:Fraunces,serif;font-size:17px">${esc(name)}</span>
    <span style="font:600 8.5px Inter,sans-serif;letter-spacing:.15em;color:#6d6459;margin-top:-4px">${esc(session.roleLabel())}</span>
    <span style="font:600 8.5px Inter,sans-serif;letter-spacing:.14em;color:#6d6459;margin-top:4px">${COPY.menu.displayName}</span>
    <input data-role="nameDraft" value="${esc(name)}" aria-label="Display name" style="border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:8px 10px;font:400 13px Inter,sans-serif;color:#201b16;width:100%;box-sizing:border-box">
    <span data-act="saveName" style="padding:9px 12px;background:${nameSaved ? '#1e6e42' : '#9b1b22'};color:#fff;font:600 9.5px Inter,sans-serif;letter-spacing:.14em;cursor:pointer;text-align:center">${nameSaved ? COPY.menu.saved : COPY.menu.save}</span>
    <div style="display:flex;gap:14px;border-top:1px solid rgba(32,27,22,.1);padding-top:10px">
      <a href="/settings/team" style="font:600 9px Inter,sans-serif;letter-spacing:.13em">${COPY.menu.team}</a>
      <span data-act="signOut" style="font:600 9px Inter,sans-serif;letter-spacing:.13em;color:#9b1b22;cursor:pointer">${COPY.menu.signOut}</span>
    </div>
  </div>`;
}
function header() {
  const s = state.get();
  return `
  <!-- dc: Admin Home.dc.html › "Header" -->
  <div style="background:#fff;border-bottom:1px solid rgba(32,27,22,.14);position:relative;z-index:50">
    <div class="mx-topbar mx-gutter" style="max-width:1180px;margin:0 auto;padding:0 28px;height:58px;display:flex;align-items:center;gap:26px;position:relative">
      <a href="/today" style="display:flex;flex-direction:column;align-items:flex-end;gap:2px;color:#201b16"><img src="/assets/logo.png" alt="med&amp;X" style="height:18px;display:block"><span style="font:600 8px Inter,sans-serif;letter-spacing:.3em;color:#9b1b22">${COPY.admin}</span></a>
      <span id="mx-menu-btn" data-act="menu" aria-label="Menu" style="align-items:center;gap:8px;font:600 10.5px Inter,sans-serif;letter-spacing:.18em;cursor:pointer"><span style="display:flex;flex-direction:column;gap:4px"><span style="width:18px;height:2px;background:#201b16"></span><span style="width:18px;height:2px;background:#201b16"></span><span style="width:12px;height:2px;background:#201b16"></span></span>${COPY.nav.menu}</span>
      <div class="mx-nav" style="display:flex;gap:22px;align-items:center;height:100%">
        ${NAV.map(navItem).join('\n        ')}
      </div>
      <div style="flex:1"></div>
      <a href="/inbox/chat" title="${esc(COPY.chat.title)}" style="display:flex;align-items:center;gap:7px;border:1px solid rgba(32,27,22,.18);background:#fff;padding:7px 11px;font:600 9.5px Inter,sans-serif;letter-spacing:.12em;color:#201b16;white-space:nowrap;flex:none" data-hover="border-color:#201b16;color:#201b16"><span style="width:6px;height:6px;border-radius:50%;background:#2f7d4f"></span>${COPY.chat.label}<span data-role="badge-chat" style="min-width:15px;height:15px;padding:0 4px;background:#9b1b22;color:#fff;font:600 9px Inter,sans-serif;display:${s.badges.chat > 0 ? 'inline-flex' : 'none'};align-items:center;justify-content:center">${s.badges.chat || 0}</span></a>
      <span class="mx-search" style="position:relative;flex:0 1 200px;min-width:70px">
        <span style="display:flex;align-items:center;gap:8px;border:1px solid rgba(32,27,22,.18);background:#f6f2ea;padding:7px 12px;box-sizing:border-box"><span style="color:#6d6459">⌕</span><input data-role="q" value="${esc(searchState.q)}" placeholder="${esc(COPY.search.placeholder)}" aria-label="Search or type a task" autocomplete="off" style="border:none;background:transparent;font-size:12px;color:#201b16;width:100%;padding:0"></span>
        <div data-role="search-pop">${popover === 'search' ? searchResults() : ''}</div>
      </span>
      <span style="position:relative;flex:none">
        <span data-act="profile" title="${esc(COPY.menu.profileTitle)}" aria-haspopup="true" aria-expanded="${popover === 'menu'}" style="width:30px;height:30px;background:#201b16;color:#f6f2ea;display:inline-flex;align-items:center;justify-content:center;font:600 12px Fraunces,serif;cursor:pointer" data-hover="background:#9b1b22">${esc(session.initials())}</span>
        <div data-role="menu-pop">${popover === 'menu' ? profileMenu() : ''}</div>
      </span>
    </div>
  </div>
  <!-- /dc -->`;
}

// ---------------------------------------------------------------- render + behaviour
function renderAll() {
  const s = state.get();
  document.body.setAttribute('data-layout', s.layout || 'portal');
  document.body.classList.toggle('authed', session.isAuthed);
  document.body.classList.remove('menu-open');
  if (s.layout !== 'portal' || !session.isAuthed) { els.chrome.innerHTML = ''; return; }
  const active = document.activeElement;
  const hadFocus = active && active.matches && active.matches('[data-role="q"]');
  const caret = hadFocus ? active.selectionStart : null;
  els.chrome.innerHTML = header();
  if (popover === 'projects') renderProjectsPop();
  const q = els.chrome.querySelector('[data-role="q"]');
  if (q) { q.addEventListener('input', onSearchInput); q.addEventListener('keydown', onSearchKey); q.addEventListener('focus', () => { if (searchState.q.trim()) { popover = 'search'; renderSearchPop(); } }); if (hadFocus) { q.focus(); try { q.setSelectionRange(caret, caret); } catch (e) {} } }
}
function renderSearchPop() { const host = els.chrome.querySelector('[data-role="search-pop"]'); if (host) host.innerHTML = popover === 'search' ? searchResults() : ''; }
function renderMenuPop() { const host = els.chrome.querySelector('[data-role="menu-pop"]'); if (host) host.innerHTML = popover === 'menu' ? profileMenu() : ''; const p = els.chrome.querySelector('[data-act="profile"]'); if (p) p.setAttribute('aria-expanded', String(popover === 'menu')); }
function renderProjectsPop() { const host = els.chrome.querySelector('[data-role="projects-pop"]'); if (host) host.innerHTML = popover === 'projects' ? projectsPanel() : ''; const a = els.chrome.querySelector('[data-act="projects"]'); if (a) a.setAttribute('aria-expanded', String(popover === 'projects')); }
function closePopover() { if (!popover) return; popover = null; renderSearchPop(); renderMenuPop(); renderProjectsPop(); }

function onSearchInput(e) {
  searchState.q = e.target.value; searchState.assistant = null; searchState.busy = false;
  const q = searchState.q.trim();
  clearTimeout(searchTimer);
  if (!q) { popover = null; renderSearchPop(); return; }
  popover = 'search'; renderSearchPop();
  if (q.length < 2) return;
  searchTimer = setTimeout(async () => {
    try { const r = await api.get('/api/admin/search?q=' + encodeURIComponent(q)); searchState.people = (r && r.results) || []; }
    catch (err) { searchState.people = []; }
    if (popover === 'search' && searchState.q.trim() === q) renderSearchPop();
  }, 250);
}
function onSearchKey(e) {
  if (e.key === 'Escape') { closePopover(); e.target.blur(); return; }
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const q = searchState.q.trim(); if (!q) return;
  const first = els.chrome.querySelector('[data-act="result"]');
  // a matching screen/person wins unless the phrase is an instruction (note 14: intent detection)
  if (first && !IMPERATIVE.test(q)) { handlers.result(first); return; }
  handlers.ask();
}

const handlers = {
  menu: () => document.body.classList.toggle('menu-open'),
  projects: (el, e) => {
    // desktop: first click opens the dropdown, second click (or Enter on a link inside) navigates
    if (document.body.classList.contains('menu-open')) { if (popover !== 'projects') { e.preventDefault(); popover = 'projects'; renderProjectsPop(); } return; }
    e.preventDefault();
    popover = popover === 'projects' ? null : 'projects'; renderProjectsPop(); renderMenuPop(); renderSearchPop();
  },
  profile: () => { nameSaved = false; popover = popover === 'menu' ? null : 'menu'; renderMenuPop(); renderSearchPop(); renderProjectsPop(); if (popover === 'menu') { const i = els.chrome.querySelector('[data-role="nameDraft"]'); if (i) i.focus(); } },
  saveName: () => {
    const i = els.chrome.querySelector('[data-role="nameDraft"]');
    const v = i ? i.value : '';
    session.setDisplayName(v);
    nameSaved = true; renderAll(); popover = 'menu'; renderMenuPop();
  },
  signOut: () => { closePopover(); session.clear(); ui.toast(COPY.signedOut); router.replace('/signin'); },
  result: (el) => { const href = el.dataset.href; closePopover(); searchState = { q: '', people: [], assistant: null, busy: false }; renderAll(); if (href === '#profile') { handlers.profile(); return; } router.navigate(href); },
  ask: async () => {
    const q = searchState.q.trim(); if (!q) return;
    searchState.busy = true; searchState.assistant = null; renderSearchPop();
    try { const r = await api.post('/api/admin/assistant', { message: q }); searchState.assistant = r || { answer: COPY.search.done }; }
    catch (e) { searchState.assistant = { answer: e.message, pending: [] }; }
    searchState.busy = false; popover = 'search'; renderSearchPop();
  },
  execute: async (el) => {
    const a = searchState.assistant; const p = a && a.pending && a.pending[Number(el.dataset.i)]; if (!p) return;
    el.setAttribute('aria-disabled', 'true');
    try { const r = await api.post('/api/admin/assistant/execute', { tool: p.tool, args: p.args }); ui.toast((r && (r.message || r.answer)) || COPY.search.done); searchState.assistant = Object.assign({}, a, { pending: a.pending.filter(x => x !== p) }); renderSearchPop(); chrome.refresh(); }
    catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  }
};

function isEventDay(conf, bridges) {
  const today = fmt.ymd(new Date());
  const days = [];
  const c = conf || {}; if (c.start_date) { let d = fmt.midnight(c.start_date); const end = fmt.midnight(c.end_date || c.start_date); while (d && end && d <= end) { days.push(fmt.ymd(d)); d = new Date(d.getTime() + 86400000); } }
  else days.push(FACTS.plexus.start, FACTS.plexus.end);
  days.push(FACTS.gala.date);
  (bridges || []).forEach(b => { if (b && b.event_date) days.push(String(b.event_date).slice(0, 10)); });
  return days.includes(today) || /[?&]eventday=1/.test(location.search);
}

export const chrome = {
  mount() {
    els.chrome = document.getElementById('chrome');
    els.overlays = document.getElementById('chrome-overlays');
    ui.bind(els.chrome, handlers);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { closePopover(); document.body.classList.remove('menu-open'); return; }
      // audit #10: "/" and ⌘K / Ctrl+K land the cursor in the search box. "/" steps aside
      // while any field has focus (people type slashes); the chord works from anywhere.
      const cmdK = (e.metaKey || e.ctrlKey) && !e.altKey && String(e.key).toLowerCase() === 'k';
      const slash = e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey;
      if (!cmdK && !slash) return;
      const t = e.target;
      const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''));
      if (slash && typing) return;
      const q = els.chrome && els.chrome.querySelector('[data-role="q"]');
      if (!q) return;
      e.preventDefault();
      q.focus();
      try { q.select(); } catch (err) {}
    });
    document.addEventListener('click', e => {
      if (!popover) return;
      if (e.target.closest('[data-stop]') || e.target.closest('[data-act="profile"]') || e.target.closest('[data-act="projects"]') || e.target.closest('[data-role="q"]') || e.target.closest('.mx-projects')) return;
      closePopover();
    });
    state.subscribe((s, keys) => { if (keys.some(k => ['user', 'badges', 'active', 'layout', 'eventDay', 'token'].includes(k))) renderAll(); });
    renderAll();
  },
  closePopover,
  // badges + event-day flag — all live reads, never hardcoded. INBOX = pending outbox batches + unread
  // member messages (note 2: "the top-nav INBOX badge = items waiting"); TEAM CHAT = unread across channels + DMs.
  async refresh() {
    if (!session.isAuthed) return;
    const r = await api.settle({
      outbox: api.get('/api/admin/outbox?status=pending_approval'),
      pstats: api.get('/api/dashboard/portal-stats'),
      chat: api.get('/api/teamchat/overview'),
      conf: api.get('/api/conferences/active', { noAuth: true }),
      bridges: api.get('/api/bridges/events')
    });
    const batches = r.outbox && Array.isArray(r.outbox.batches) ? r.outbox.batches.length : 0;
    const unread = r.pstats && r.pstats.pending ? Number(r.pstats.pending.unreadMessages || 0) : 0;
    const chatUnread = r.chat ? [...(r.chat.channels || []), ...(r.chat.dms || [])].reduce((n, c) => n + Number(c.unread || 0), 0) : 0;
    state.set({ badges: { inbox: batches + unread, chat: chatUnread, outboxBatches: batches, unreadMessages: unread }, eventDay: isEventDay(r.conf, r.bridges) });
    return r;
  }
};
export default chrome;
