// Source: Admin Home.dc.html (header: stacked logo lockup + ADMIN · top nav · TEAM CHAT pill ·
//         search-or-task field · profile avatar + menu) — the same header sits on all 17 artboards.
//         ONE implementation, mounted once by app.js; every view renders below it. Markup and inline
//         styles are the artboard's; only the bound props ({{ q }}, {{ avatarInitials }} …) became data.
// v2 additions (no artboard): the SIX-item nav with dropdown groups (2026-09-22 — TODAY · PROJECTS ▾ ·
// TEAM ▾ · PEOPLE ▾ · MONEY · MORE ▾, red EVENT DAY on event dates; see NAV / MENUS), locked items,
// the ≤960px MENU drawer (the same six groups as an accordion), assistant rows in the search field (note 14).
// Audit 2026-09-02 #10: "/" and ⌘K/Ctrl+K focus the search box ("/" steps aside while a field has
// focus); the results popover right-aligns and clamps inside the viewport; the palette carries
// HR/EN operator vocabulary (`syn`) with diacritic folding, so "invoice", "račun"/"racun",
// "putni nalog", "scan" or "badge" find their screens instead of "No matches".
//
//   import { chrome } from './chrome.js';
//   chrome.mount();                 // once (app.js)
//   chrome.refresh();               // re-read badges (INBOX = outbox batches + unread member messages · TEAM CHAT · PEOPLE = open member reports) + event-day flag
//   chrome.closePopover();
import cfg from './config.js';
import { api } from './api.js';
import { session, state } from './state.js';
import { ui, esc, fmt } from './ui.js';
import { FACTS, routeForSection } from './facts.js';
import { perms } from './perms.js';
import router from './router.js';

// ONE rule for what a TEAM CHAT unread is (audit 2026-09-17 B): the header pill, the Inbox tab badge
// and the chat tab's own count all sum the SAME list — real channels (legacy 'dm:…' channel rows are
// the pre-DM era's private threads and never render anywhere) plus MY dms. Summing the unfiltered
// channel list counted unread that no screen could ever clear.
export function chatChannelsOf(overview) {
  return overview && Array.isArray(overview.channels) ? overview.channels.filter(c => String(c.name || '').indexOf('dm:') !== 0) : [];
}
export function chatUnreadOf(overview) {
  if (!overview) return 0;
  return [...chatChannelsOf(overview), ...(Array.isArray(overview.dms) ? overview.dms : [])].reduce((n, c) => n + Number(c.unread || 0), 0);
}

export const COPY = {
  admin: 'ADMIN',
  nav: { today: 'TODAY', projects: 'PROJECTS', team: 'TEAM', bigIdeas: 'BIG IDEAS', inbox: 'INBOX', tasks: 'TASKS', notes: 'NOTES', people: 'PEOPLE', registrations: 'REGISTRATIONS', speakers: 'SPEAKER PIPELINE', money: 'MONEY', calendar: 'CALENDAR', eventDay: 'EVENT DAY', studio: 'STUDIO', settings: 'SETTINGS', more: 'MORE', menu: 'MENU' },
  tasksBadge: { red: 'Finished tasks waiting for you to see', grey: 'Your open tasks' },
  reportsBadge: 'Open reports from members — answer within 24 hours',
  teamBadge: { red: 'Waiting for you — finished tasks to see and inbox items to answer', grey: 'Your open tasks' },
  chat: { label: 'TEAM CHAT', title: 'Team chat — straight to the chat tab' },
  search: { placeholder: 'Search or type a task…', none: 'No matches — try a screen, a person, or a project.', hint: 'Type a name, a screen, or an instruction — Enter asks the assistant.', asking: 'Asking the assistant…', ask: 'ASK', confirm: 'CONFIRM', done: 'Done.', gated: 'The do-it-for-me assistant needs ANTHROPIC_API_KEY on the admin service — search and live numbers still work.' },
  menu: { displayName: 'DISPLAY NAME', save: 'SAVE', saved: '✓ SAVED', team: 'TEAM ACCESS →', signOut: 'SIGN OUT', profileTitle: 'Your profile', locked: 'Locked — ask Alen, he grants access per section' },
  projects: { plexus: 'Plexus Week 2026', accelerator: 'Accelerator', forum: 'Biomedical Forum', bridges: 'Building Bridges', review: 'Review Room', pages: 'What members see', eventDay: 'Event Day Room', links: 'Links', gala: 'Gala Evening', meetups: 'Plexus Meetups' },
  meetups: { sub: 'coffee · lunch · tables', screen: 'Plexus Meetups — tables, hosts, waitlists', action: 'Create a meetup — coffee, lunch or a walk' },
  signedOut: 'Signed out.'
};

// top nav — SIX items (Alen, 2026-09-22: "the top bar has too many items"). TODAY · PROJECTS ▾ ·
// TEAM ▾ · PEOPLE ▾ · MONEY · MORE ▾, plus a red EVENT DAY between MONEY and MORE on an event date.
// A group (`menu`) opens a dropdown — hover on a desktop, tap on a phone (the ≤960px MENU drawer
// renders the same six groups as an accordion). Every former top-level destination lives in one
// group; the ⌘K palette (PALETTE below) still reaches all of them directly.
//   sections on a ROW  → perms gate per destination: a locked row is hidden from the dropdown
//   a group with no visible row reads as locked (opacity .45, title tells), like any locked item
//   badge / badge2      → red / grey counts (TEAM rolls up: red = tasks done-unseen + inbox items
//                         waiting; grey = my open tasks; the rows carry their own counts)
//   drop                → the route `active` keys this group highlights for (router → state.active)
const NAV = [
  { key: 'Today', label: COPY.nav.today, to: '/today' },
  { key: 'Projects', label: COPY.nav.projects, to: '/projects/plexus', menu: true, drop: ['Projects', 'Big Ideas'] },
  // TEAM — the shared board, the notes, the inbox and the calendar: everything the team does
  // together. TASKS and NOTES are unmapped on the server (every admin) → no `sections`.
  { key: 'Team', label: COPY.nav.team, to: '/tasks', menu: true, badge: 'team', badge2: 'tasksOpen', drop: ['Tasks', 'Notes', 'Inbox', 'Calendar'] },
  // PEOPLE carries the open member REPORTS count (App Store 1.2 — answered within 24 hours); the badge opens the queue
  { key: 'People', label: COPY.nav.people, to: '/people', menu: true, badge: 'reports', drop: ['People', 'Speakers'] },
  { key: 'Money', label: COPY.nav.money, to: '/money', sections: ['finances'] },
  // EVENT DAY — top-level (and red) only while an event is on; every other day it waits under MORE
  { key: 'Event Day', label: COPY.nav.eventDay, to: '/event-day', eventDayOnly: true, red: true, sections: ['gameday', 'plexus'] },
  { key: 'More', label: COPY.nav.more, to: '/settings', menu: true, drop: ['Studio', 'Settings', 'Event Day'] }
];
// dropdown rows per group. `k` = the 8px crimson key, `sub` = the muted right-hand note.
// Rows whose `to` matches the current path highlight (the longest match wins — /people/speakers
// lights SPEAKERS, not PEOPLE).
const MENUS = {
  Projects: [
    { k: 'PLEXUS', label: COPY.projects.plexus, to: '/projects/plexus', sub: FACTS.plexus.dateShort, sections: ['plexus'] },
    { k: 'ACCEL', label: COPY.projects.accelerator, to: '/projects/accelerator', sub: 'opens ' + FACTS.accelerator.opensShort, sections: ['accelerator'] },
    { k: 'FORUM', label: COPY.projects.forum, to: '/projects/forum', sub: 'by invitation', sections: ['forum'] },
    { k: 'BRIDGES', label: COPY.projects.bridges, to: '/projects/bridges', sub: 'next · Zagreb · Dec', sections: ['bridges'] },
    // BIG IDEAS — the long game; a primary row of PROJECTS, never buried below the divider
    { k: 'IDEAS', label: 'Big Ideas', to: '/big-ideas', sub: 'the long game', sections: ['big-ideas'] },
    { divider: true },
    { k: 'GALA', label: COPY.projects.gala, to: '/gala', sub: 'seats · chase', sections: ['plexus'] },
    { k: 'MEETUPS', label: COPY.projects.meetups, to: '/projects/plexus/meetups', sub: COPY.meetups.sub, sections: ['plexus-meetups'] },
    { k: 'PROGRAM', label: 'Program — event app', to: '/program/conference', sub: 'sessions · attending' },
    { k: 'ROOM', label: COPY.projects.review, to: '/accelerator-review', sub: 'applications', sections: ['accelerator'] },
    { k: 'PAGES', label: COPY.projects.pages, to: '/member-pages', sub: 'publish', sections: ['pr-media', 'plexus', 'accelerator'] },
    { k: 'LINKS', label: COPY.projects.links, to: '/links', sub: 'invitation links', sections: ['plexus', 'bridges'] }
  ],
  Team: [
    // TASKS — red = tasks I gave that are done and waiting for me to see; grey = my open tasks
    { k: 'TASKS', key: 'Tasks', label: 'Tasks', to: '/tasks', sub: 'the shared board', badge: 'tasks', badge2: 'tasksOpen' },
    // NOTES — event & day notes (2026-09-22): what happened, who we met, what was agreed
    { k: 'NOTES', key: 'Notes', label: 'Notes', to: '/notes', sub: 'what happened' },
    { k: 'INBOX', key: 'Inbox', label: 'Inbox', to: '/inbox', sub: 'email · outbox · chat', badge: 'inbox', sections: ['member-ops', 'pr-media'] },
    { k: 'CAL', key: 'Calendar', label: 'Calendar', to: '/calendar', sub: 'key dates' }
  ],
  People: [
    { k: 'PEOPLE', label: 'People', to: '/people', sub: 'members · contacts', sections: ['member-ops', 'guest-passes', 'team', 'contacts'] },
    // REPORTS — what members flagged (a profile or a message); the red count = open reports
    { k: 'REPORTS', key: 'Reports', label: 'Reports from members', to: '/people?reports=1', sub: 'answer within 24 h', badge: 'reports', sections: ['member-ops'] },
    { k: 'REGS', label: 'Registrations', to: '/registrations', sub: 'all events', sections: ['plexus', 'forum', 'bridges', 'signup-forms'] },
    // SPEAKER PIPELINE (2026-09-22) — potential speakers for 2027 so nobody is forgotten; every admin
    { k: 'SPEAKERS', key: 'Speakers', label: 'Speaker pipeline', to: '/people/speakers', sub: '2027 · who we met' }
  ],
  More: [
    { k: 'LIVE', label: 'Event Day', to: '/event-day', sub: 'door · check-in · live', sections: ['gameday', 'plexus'], hideOnEventDay: true },
    { k: 'STUDIO', label: 'Studio', to: '/studio', sub: 'content · pages', sections: ['pr-media', 'plexus', 'signup-forms'] },
    { k: 'SETUP', label: 'Settings', to: '/settings', sub: 'team · health · tools' }
  ]
};
// the ⌘K hint in the search field names the chord this keyboard actually has
const KBD = (() => { try { return /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '') ? '⌘K' : 'Ctrl K'; } catch (e) { return '⌘K'; } })();
// a panel that OPENS (its host was empty) gets the short fade-and-settle; a redraw of an open panel
// (typing in the search field, a badge refresh) never replays it; a panel that CLOSES fades out
// (css .mx-pop-out, --t-exit — the member portal's popover exit) and is removed after it. `instant`
// skips both: moving from one open nav group to the next swaps the panels at once (menubar mode), and
// the phone drawer's accordion folds at once (a fading panel would hold its space).
function fill(host, html, instant) {
  if (!host) return;
  const cur = host.firstElementChild;
  const leaving = !!cur && cur.classList.contains('mx-pop-out');
  clearTimeout(host._popOut);
  if (!html && cur && !leaving && !instant && !inDrawer() && !reduceMotion()) {
    cur.classList.remove('mx-pop-in'); cur.classList.add('mx-pop-out');
    host._popOut = setTimeout(() => { if (cur.parentNode === host) host.innerHTML = ''; }, 170);
    return;
  }
  if (!html && leaving) return;
  host.innerHTML = html;
  if ((!cur || leaving) && host.firstElementChild && !instant) host.firstElementChild.classList.add('mx-pop-in');
}
const isHoverDevice = () => { try { return window.matchMedia('(hover: hover) and (pointer: fine)').matches; } catch (e) { return true; } };
const inDrawer = () => document.body.classList.contains('menu-open');
// which group the current screen belongs to (router sets state.active to the route's key)
function groupOf(s) {
  if (s.active === 'Event Day') return s.eventDay ? 'Event Day' : 'More';
  const g = NAV.find(n => n.key === s.active || (n.drop || []).includes(s.active));
  return g ? g.key : s.active;
}
// the rows an admin may see (perms per destination; EVENT DAY leaves MORE while it is top-level)
function rowsOf(key, s) {
  const rows = (MENUS[key] || []).filter(r => r.divider || ((!r.sections || perms.canAny(r.sections)) && !(r.hideOnEventDay && s.eventDay)));
  // no divider at either end, none doubled
  return rows.filter((r, i) => !r.divider || (i > 0 && i < rows.length - 1 && !rows[i - 1].divider));
}
function rowOnPath(rows) {
  const p = location.pathname.replace(/\/+$/, '') || '/';
  let best = null;
  rows.forEach(r => { if (r.divider) return; const to = r.to.replace(/\/+$/, ''); if ((p === to || p.startsWith(to + '/')) && (!best || to.length > best.to.length)) best = r; });
  return best;
}
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
  { kind: 'SCREEN', label: 'Program editor — the event app (Plexus Week Live)', syn: 'program programme raspored agenda sessions sesije schedule event app live plexus week satnica', href: '/program/conference' },
  { kind: 'SCREEN', label: 'Gala Evening — guests, seating, chase', syn: 'seating stol stolovi raspored sjedenja meal menu večera kitchen gosti naplata', href: '/gala' },
  { kind: 'SCREEN', label: COPY.meetups.screen, syn: 'meetup meetups kava coffee ručak lunch dinner večera walk šetnja stol table host domaćin waitlist lista čekanja plexus week', href: '/projects/plexus/meetups' },
  { kind: 'ACTION', label: COPY.meetups.action, syn: 'meetup meetups new napravi kava coffee ručak lunch stol table host domaćin capacity kapacitet waitlist lista čekanja invite pozovi', href: '/projects/plexus/meetups' },
  { kind: 'SCREEN', label: 'Big Ideas — the long-term projects book', syn: 'big idea ideje ideja dugoročno long term phd programme program suradnja collaboration ministarstvo ministry partnership sveučilište university yale', href: '/big-ideas' },
  { kind: 'ACTION', label: 'Add a big idea', syn: 'new big idea nova ideja dodaj add long term projekt project partnership programme', href: '/big-ideas?new=1' },
  { kind: 'ACTION', label: 'Portfolio briefing — before a ministry meeting', syn: 'briefing ministarstvo ministry portfolio print sastanak meeting sve ideje one pager', href: '/big-ideas' },
  { kind: 'SCREEN', label: 'Inbox — email, outbox, chat', syn: 'poruke pošta mail', href: '/inbox' },
  { kind: 'SCREEN', label: 'People', syn: 'ljudi članovi members kontakti directory imenik', href: '/people' },
  { kind: 'SCREEN', label: 'Reports from members — the moderation queue', syn: 'reports report prijave prijava moderation moderacija abuse block suspend suspendiraj remove message ukloni poruku', href: '/people?reports=1' },
  { kind: 'SCREEN', label: 'Registrations — all events', syn: 'prijave registracije sign-ups sudionici attendees', href: '/registrations' },
  { kind: 'SCREEN', label: 'Speaker pipeline — potential speakers for 2027', syn: 'speaker speakers predavač predavači govornik pipeline 2027 prospect kandidat invite pozvati contacted kontaktiran keynote', href: '/people/speakers' },
  { kind: 'ACTION', label: 'Add a potential speaker — so we do not forget them', syn: 'speaker predavač govornik new novi add dodaj prospect met upoznao invite 2027 pipeline', href: '/people/speakers?new=1' },
  { kind: 'SCREEN', label: 'Money', syn: 'novac finance financije knjige računi bookkeeping', href: '/money' },
  { kind: 'SCREEN', label: 'Tasks — the shared board', syn: 'task tasks zadatak zadaci board ploča laura result rezultat todo done seen', href: '/tasks' },
  { kind: 'SCREEN', label: 'Notes — what happened at each event', syn: 'note notes bilješke bilješka zapis event događaj met upoznao people ljudi boston gala conference day dnevnik whatsapp', href: '/notes' },
  { kind: 'SCREEN', label: 'Calendar & key dates', syn: 'kalendar rokovi deadlines', href: '/calendar' },
  { kind: 'SCREEN', label: 'Studio', href: '/studio' },
  { kind: 'SCREEN', label: 'Settings', syn: 'postavke team tim pristup access', href: '/settings' },
  { kind: 'SCREEN', label: 'System health', syn: 'env keys zdravlje provjere checks', href: '/settings/health' },
  { kind: 'SCREEN', label: 'Event Day room', syn: 'door vrata check-in kontrola live', href: '/event-day' },
  { kind: 'SCREEN', label: 'What members see', syn: 'member pages publish objavi', href: '/member-pages' },
  { kind: 'SCREEN', label: 'Invitation links', syn: 'qr link poveznica invite pozivnica registration', href: '/links' },
  { kind: 'ACTION', label: 'New task — on the board', syn: 'zadatak todo add dodaj new novi task laura', href: '/tasks?new=1' },
  { kind: 'ACTION', label: 'Add a note — who you met, what was agreed', syn: 'note notes bilješka zapiši add dodaj new nova met upoznao event boston gala follow up', href: '/notes?new=1' },
  { kind: 'ACTION', label: 'Open the check-in scanner', syn: 'scan qr skener skeniraj check in door vrata ulaz', href: '/event-day' },
  { kind: 'ACTION', label: 'Email registrants', syn: 'send mail pošalji poruka bulk', href: '/inbox/email' },
  { kind: 'ACTION', label: 'Post news to members', syn: 'announcement obavijest novosti', href: '/inbox/announcements' },
  { kind: 'ACTION', label: 'Create a guest pass', syn: 'vip pass propusnica gost', href: '/people' },
  { kind: 'ACTION', label: 'Change my display name', syn: 'profile profil ime', href: '#profile' },
  // ---- operator vocabulary → destinations (audit #10: "invoice" used to return "No matches") ----
  { kind: 'ACTION', label: 'Record an invoice — Money · Incoming invoice book', syn: 'invoice račun incoming ulazni trošak expense bill supplier dobavljač enter', href: '/money/ulazni' },
  { kind: 'ACTION', label: 'Outgoing invoices — Money · Outgoing invoice book', syn: 'invoice račun outgoing izlazni fira fiskalizirani naplata kupac customer', href: '/money/izlazni' },
  { kind: 'ACTION', label: 'Travel order — Money · Travel orders', syn: 'travel order putni nalog trip put reimbursement', href: '/money/putni' },
  { kind: 'ACTION', label: 'Payment order — Money', syn: 'payment order nalog plaćanje pay wire transfer', href: '/money/nalozi' },
  { kind: 'ACTION', label: 'Work units — Money', syn: 'work unit radna jedinica grant budget proračun', href: '/money/jedinice' },
  { kind: 'ACTION', label: 'Reports — Money', syn: 'report izvještaj export csv presjek po projektu osobi', href: '/money/izvjestaji' },
  { kind: 'ACTION', label: 'Still owed to us — Money', syn: 'owed potraživanja refund chase unpaid dug naplata receivables', href: '/money/owed' },
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

// white-space:nowrap — every nav label was one word until BIG IDEAS, which wrapped to two lines
// and pushed the row out of alignment.
const NAV_ON = 'font:600 11px Inter,sans-serif;letter-spacing:.14em;color:#201b16;border-bottom:2px solid #9b1b22;height:100%;display:flex;align-items:center;box-sizing:border-box;white-space:nowrap';
const NAV_OFF = 'font:600 11px Inter,sans-serif;letter-spacing:.14em;color:#6d6459;height:100%;display:flex;align-items:center;white-space:nowrap';

let els = {};
let popover = null;          // 'search' | 'menu' | 'nav:<group key>' | null
let hoverTimer = null;       // the dropdown lingers ~160 ms after the pointer leaves (diagonal moves)
let searchTimer = null;
let menuAnimTimer = null;    // .menu-anim lives only for the drawer's opening slide, .menu-closing for its fold
let lastPointer = null;      // the search highlight follows a pointer that MOVES, never one resting under new rows
let searchState = { q: '', people: [], assistant: null, busy: false, sel: -1 };
let nameSaved = false;

// ---------------------------------------------------------------- templates
// red / grey count pills — the same two on a top item and on a dropdown row
function badgePair(n, s, small) {
  const red = n.badge ? Number(s.badges[n.badge] || 0) : 0;
  const grey = n.badge2 ? Number(s.badges[n.badge2] || 0) : 0;
  const h = small ? 15 : 16;
  const titleRed = n.badge === 'team' ? COPY.teamBadge.red : n.badge === 'tasks' ? COPY.tasksBadge.red : n.badge === 'inbox' ? 'Waiting in the inbox' : n.badge === 'reports' ? COPY.reportsBadge : '';
  return `${n.badge ? `<span data-role="badge-${n.badge}" title="${esc(titleRed)}" style="min-width:${h}px;height:${h}px;padding:0 4px;background:#9b1b22;color:#fff;font:600 10px Inter,sans-serif;display:${red > 0 ? 'inline-flex' : 'none'};align-items:center;justify-content:center;box-sizing:border-box">${red}</span>` : ''}${n.badge2 ? `<span data-role="badge-${n.badge2}" title="${esc(COPY.tasksBadge.grey)}" style="min-width:${h - 1}px;height:${h}px;padding:0 3px;margin-left:-2px;background:#e6e0d4;color:#4a4239;font:600 10px Inter,sans-serif;display:${grey > 0 ? 'inline-flex' : 'none'};align-items:center;justify-content:center;box-sizing:border-box">${grey}</span>` : ''}`;
}
function navItem(n) {
  const s = state.get();
  if (n.eventDayOnly && !s.eventDay) return '';
  const on = groupOf(s) === n.key;
  const rows = n.menu ? rowsOf(n.key, s).filter(r => !r.divider) : null;
  const locked = n.menu ? !rows.length : !!(n.sections && !perms.canAny(n.sections));
  // a group lands on its first visible row when its usual door is locked for this admin
  const to = n.menu && rows.length && !rows.some(r => r.to === n.to) ? rows[0].to : n.to;
  // a group with count pills already has the row's 6 px gap before its caret — it sits as close to its
  // last pill as the other carets sit to their label
  const inner = `${n.red ? '<span style="width:6px;height:6px;border-radius:50%;background:#9b1b22;margin-right:7px;flex:none"></span>' : ''}${n.label}${badgePair(n, s)}${n.menu ? `<span class="mx-caret" style="font-size:8px;margin-left:${n.badge ? '-1px' : '5px'};opacity:.7">▾</span>` : ''}`;
  const style = (on ? NAV_ON : NAV_OFF) + (n.badge ? ';gap:6px' : '') + (n.red ? ';color:#9b1b22' : '');
  const title = locked ? ` title="${esc(COPY.menu.locked)}"` : (n.eventDayOnly ? ' title="Event Day — the control room is live today"' : '');
  if (n.menu) {
    const open = popover === 'nav:' + n.key;
    return `<span class="mx-nav-item has-menu${locked ? ' locked' : ''}${on ? ' active' : ''}${open ? ' open' : ''}" data-menu="${esc(n.key)}" style="height:100%;display:flex;align-items:stretch"><a href="${to}" data-act="navgroup" data-nav-key="${esc(n.key)}" aria-haspopup="true" aria-expanded="${open}" style="${style}"${title} data-hover="color:#201b16">${inner}</a><div data-role="nav-pop" data-key="${esc(n.key)}">${open ? navPanel(n.key) : ''}</div></span>`;
  }
  return `<a href="${to}" class="mx-nav-item${locked ? ' locked' : ''}${on ? ' active' : ''}${n.red ? ' red' : ''}" style="${style}"${title} data-hover="color:${n.red ? '#7e151b' : '#201b16'}">${inner}</a>`;
}
function navPanel(key) {
  const s = state.get();
  const rows = rowsOf(key, s);
  const here = rowOnPath(rows);
  return `<div class="mx-dd" data-v2="${esc(key.toUpperCase())} dropdown — no artboard; hover on desktop, tap on a phone" role="menu" aria-label="${esc(key)}">
    ${rows.map(r => r.divider ? '<div class="mx-dd-rule"></div>' : `<a href="${r.to}" role="menuitem" class="mx-dd-row${here === r ? ' on' : ''}" aria-current="${here === r ? 'page' : 'false'}"><span class="k">${r.k}</span><span class="lbl">${esc(r.label)}</span><span class="sub">${r.badge || r.badge2 ? badgePair(r, s, true) : ''}${r.sub ? `<span class="txt">${esc(r.sub)}</span>` : ''}</span></a>`).join('')}
  </div>`;
}
function searchResults() {
  const q = searchState.q.trim(), qv = q.toLowerCase();
  if (!qv) return '';
  const rows = [];
  paletteMatches(q).slice(0, 6).forEach(p => rows.push({ kind: p.kind, label: p.label, href: p.href }));
  // a person opens THAT person: People (or Registrations for a registrant) filtered to their name — it used
  // to open the whole list with nothing selected
  searchState.people.slice(0, 6).forEach(p => {
    const base = String(routeForSection(p.section || 'people', '/people') || '/people').split(/[?#]/)[0];
    const to = /^\/(registrations|gala)/.test(base) ? '/registrations' : '/people';
    rows.push({ kind: 'PERSON', label: `${p.name} — ${p.event || p.type}${p.status ? ', ' + p.status : ''}`, href: to + '?q=' + encodeURIComponent(p.name || '') });
  });
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
  const askRow = !a && !searchState.busy ? `<div class="mx-pop-row" data-act="ask" role="option" id="mx-sr-ask"><span class="mx-pop-kind">ASK</span><span style="flex:1;min-width:0">“${esc(q)}” — ask the assistant ↵</span></div>` : '';
  // a real listbox: every row is an option with an id, so the field can name the highlighted one
  // (aria-activedescendant, markSelection) and a screen reader follows ↑ / ↓; the typed words stand out
  return `<div class="mx-pop" id="mx-search-list" role="listbox" aria-label="Results" data-stop="1" style="left:auto;right:0;width:min(320px,calc(100vw - 32px))">
    ${rows.map((r, i) => `<a href="${esc(r.href)}" class="mx-pop-row" data-act="result" data-href="${esc(r.href)}" role="option" id="mx-sr-${i}"><span class="mx-pop-kind">${r.kind}</span><span style="flex:1;min-width:0">${hit(r.label, q)}</span></a>`).join('')}
    ${!rows.length && !a && !searchState.busy ? `<div class="mx-pop-note">${COPY.search.none}</div>` : ''}
    ${askRow}${assist}
  </div>`;
}
// the words the admin typed, picked out in a result label (escaped piece by piece)
function hit(label, q) {
  const s = String(label || ''), i = q ? s.toLowerCase().indexOf(String(q).toLowerCase()) : -1;
  return i < 0 ? esc(s) : esc(s.slice(0, i)) + '<b class="mx-pop-hit">' + esc(s.slice(i, i + q.length)) + '</b>' + esc(s.slice(i + q.length));
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
    <div class="mx-topbar mx-gutter${s.eventDay ? ' event-day' : ''}" style="max-width:1180px;margin:0 auto;padding:0 28px;height:58px;display:flex;align-items:center;gap:26px;position:relative">
      <a href="/today" class="mx-brand" style="display:flex;flex-direction:column;align-items:flex-end;gap:2px;color:#201b16"><img src="/assets/logo.png" alt="med&amp;X" style="width:auto;height:18px;display:block"><span style="font:600 8px Inter,sans-serif;letter-spacing:.3em;color:#9b1b22">${COPY.admin}</span></a>
      <span id="mx-menu-btn" data-act="menu" aria-label="Menu" style="align-items:center;gap:8px;font:600 10.5px Inter,sans-serif;letter-spacing:.18em;cursor:pointer"><span class="mx-burger" style="display:flex;flex-direction:column;gap:4px"><span style="width:18px;height:2px;background:#201b16"></span><span style="width:18px;height:2px;background:#201b16"></span><span style="width:12px;height:2px;background:#201b16"></span></span>${COPY.nav.menu}</span>
      <div class="mx-nav" style="display:flex;gap:22px;align-items:center;height:100%">
        ${NAV.map(navItem).join('\n        ')}
      </div>
      <div style="flex:1"></div>
      <a href="/inbox/chat" class="mx-chat" title="${esc(COPY.chat.title)}" style="display:flex;align-items:center;gap:7px;border:1px solid rgba(32,27,22,.18);background:#fff;padding:7px 11px;font:600 9.5px Inter,sans-serif;letter-spacing:.12em;color:#201b16;white-space:nowrap;flex:none" data-hover="border-color:#201b16;color:#201b16"><span style="width:6px;height:6px;border-radius:50%;background:#2f7d4f"></span><span class="mx-chat-label">${COPY.chat.label}</span><span data-role="badge-chat" style="min-width:15px;height:15px;padding:0 4px;background:#9b1b22;color:#fff;font:600 9px Inter,sans-serif;display:${s.badges.chat > 0 ? 'inline-flex' : 'none'};align-items:center;justify-content:center">${s.badges.chat || 0}</span></a>
      <span class="mx-search" style="position:relative;flex:0 1 200px;min-width:70px">
        <span class="mx-search-box${searchState.q ? ' has-q' : ''}"><span class="mx-search-glass" aria-hidden="true">⌕</span><input data-role="q" value="${esc(searchState.q)}" placeholder="${esc(COPY.search.placeholder)}" aria-label="Search or type a task" autocomplete="off" role="combobox" aria-controls="mx-search-list" aria-expanded="${popover === 'search'}" aria-autocomplete="list" style="border:none;background:transparent;font-size:12px;color:#201b16;width:100%;min-width:0;padding:0"><kbd class="mx-kbd" aria-hidden="true">${KBD}</kbd></span>
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
  // the phone MENU drawer survives a redraw (a badge refresh lands a second after load and used to
  // snap it shut mid-tap); navigation closes it in app.js's beforeRender hook, sign-out here
  if (s.layout !== 'portal' || !session.isAuthed) { document.body.classList.remove('menu-open', 'menu-closing'); els.chrome.innerHTML = ''; return; }
  const active = document.activeElement;
  const hadFocus = active && active.matches && active.matches('[data-role="q"]');
  const caret = hadFocus ? active.selectionStart : null;
  els.chrome.innerHTML = header();
  const q = els.chrome.querySelector('[data-role="q"]');
  if (q) { q.addEventListener('input', onSearchInput); q.addEventListener('keydown', onSearchKey); q.addEventListener('focus', () => { if (searchState.q.trim()) { popover = 'search'; renderSearchPop(); } }); if (hadFocus) { q.focus(); try { q.setSelectionRange(caret, caret); } catch (e) {} } }
}
function renderSearchPop() {
  const host = els.chrome.querySelector('[data-role="search-pop"]'); if (!host) return;
  fill(host, popover === 'search' ? searchResults() : '');
  const q = els.chrome.querySelector('[data-role="q"]'); if (q) q.setAttribute('aria-expanded', String(popover === 'search'));
  markSelection();
}
// the keyboard highlight: ↑/↓ move it; with no explicit pick it rests on what Enter would open
// (the first match — or ASK when the phrase reads as an instruction, note 14)
function searchRows() { return Array.from(els.chrome.querySelectorAll('[data-role="search-pop"] .mx-pop:not(.mx-pop-out) .mx-pop-row')); }
function markSelection(scroll) {
  const rows = searchRows();
  if (!rows.length) { const q = els.chrome && els.chrome.querySelector('[data-role="q"]'); if (q) q.removeAttribute('aria-activedescendant'); return; }
  if (searchState.sel >= rows.length) searchState.sel = rows.length - 1;   // the list shrank under the pick
  let i = searchState.sel;
  if (i < 0) {
    const first = rows.findIndex(r => r.dataset.act === 'result');
    const ask = rows.findIndex(r => r.dataset.act === 'ask');
    i = first >= 0 && !IMPERATIVE.test(searchState.q.trim()) ? first : (ask >= 0 ? ask : first);
  }
  rows.forEach((r, n) => r.setAttribute('aria-selected', String(n === i)));
  const on = rows[i];
  const q = els.chrome.querySelector('[data-role="q"]');
  if (q) { if (on && on.id) q.setAttribute('aria-activedescendant', on.id); else q.removeAttribute('aria-activedescendant'); }
  if (on && scroll) { try { on.scrollIntoView({ block: 'nearest' }); } catch (e) {} }
}
function renderMenuPop() { const host = els.chrome.querySelector('[data-role="menu-pop"]'); fill(host, popover === 'menu' ? profileMenu() : ''); const p = els.chrome.querySelector('[data-act="profile"]'); if (p) p.setAttribute('aria-expanded', String(popover === 'menu')); }
// every group's dropdown host is redrawn from `popover` — one open at a time, the rest empty. `swap`:
// another group's panel was already open, so the two trade places at once (no fade out, no drop in)
function renderNavPops(swap) {
  els.chrome.querySelectorAll('[data-role="nav-pop"]').forEach(host => {
    const key = host.dataset.key, open = popover === 'nav:' + key;
    fill(host, open ? navPanel(key) : '', swap);
    const item = host.closest('.mx-nav-item'); if (item) item.classList.toggle('open', open);
    const a = item && item.querySelector('[data-act="navgroup"]'); if (a) a.setAttribute('aria-expanded', String(open));
  });
}
function openNav(key) {
  clearTimeout(hoverTimer); if (popover === 'nav:' + key) return;
  const swap = !inDrawer() && !!popover && popover.indexOf('nav:') === 0;   // the phone drawer's accordion still unfolds with its settle
  popover = 'nav:' + key; renderNavPops(swap); renderMenuPop(); renderSearchPop();
}
function closePopover({ refocus } = {}) {
  clearTimeout(hoverTimer); if (!popover) return;
  const was = popover; popover = null; renderSearchPop(); renderMenuPop(); renderNavPops();
  // keyboard closes (Escape) hand focus back to the trigger that opened the panel — the member portal's rule
  if (!refocus) return;
  const a = document.activeElement;
  if (a && a !== document.body && !(a.closest && a.closest('[data-role="nav-pop"], .mx-pop'))) return;
  const sel = was === 'menu' ? '[data-act="profile"]' : was === 'search' ? '[data-role="q"]' : `[data-act="navgroup"][data-nav-key="${String(was).replace(/^nav:/, '').replace(/"/g, '')}"]`;
  const t = els.chrome && els.chrome.querySelector(sel);
  if (t) { if (!t.hasAttribute('tabindex') && t.tagName === 'SPAN') t.setAttribute('tabindex', '0'); try { t.focus({ preventScroll: true }); } catch (e) { /* fine */ } }
}

function onSearchInput(e) {
  searchState.q = e.target.value; searchState.assistant = null; searchState.busy = false; searchState.sel = -1;
  const box = e.target.closest('.mx-search-box'); if (box) box.classList.toggle('has-q', !!searchState.q);
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
  if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && popover === 'search') {
    const rows = searchRows(); if (!rows.length) return;
    e.preventDefault();
    const cur = rows.findIndex(r => r.getAttribute('aria-selected') === 'true');
    const n = rows.length, step = e.key === 'ArrowDown' ? 1 : -1;
    searchState.sel = cur < 0 ? (step > 0 ? 0 : n - 1) : (cur + step + n) % n;
    markSelection(true);
    return;
  }
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const q = searchState.q.trim(); if (!q) return;
  if (searchState.sel >= 0) {
    const pick = searchRows()[searchState.sel];
    if (pick && pick.dataset.act === 'result') { handlers.result(pick); return; }
    if (pick && pick.dataset.act === 'ask') { handlers.ask(); return; }
  }
  const first = els.chrome.querySelector('[data-act="result"]');
  // a matching screen/person wins unless the phrase is an instruction (note 14: intent detection)
  if (first && !IMPERATIVE.test(q)) { handlers.result(first); return; }
  handlers.ask();
}

// the phone drawer: opens with a slide and the current screen's group unfolded; closes with a short
// fold (css .menu-closing) — a tap on MENU mid-fold reopens it rather than toggling twice
const reduceMotion = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
function openMenu() {
  const b = document.body;
  clearTimeout(menuAnimTimer);
  const fresh = !b.classList.contains('menu-open');
  b.classList.remove('menu-closing');
  b.classList.add('menu-open');
  if (fresh) { b.classList.add('menu-anim'); menuAnimTimer = setTimeout(() => b.classList.remove('menu-anim'), 420); }
  const g = groupOf(state.get()); const n = NAV.find(x => x.key === g); if (n && n.menu) openNav(g); else closePopover();
}
function closeMenu() {
  const b = document.body;
  closePopover();
  if (!b.classList.contains('menu-open') || b.classList.contains('menu-closing')) return;
  clearTimeout(menuAnimTimer);
  b.classList.remove('menu-anim');
  if (reduceMotion()) { b.classList.remove('menu-open'); return; }
  b.classList.add('menu-closing');
  menuAnimTimer = setTimeout(() => b.classList.remove('menu-open', 'menu-closing'), 200);
}
const menuShown = () => document.body.classList.contains('menu-open') && !document.body.classList.contains('menu-closing');

const handlers = {
  menu: () => { if (menuShown()) closeMenu(); else openMenu(); },
  navgroup: (el, e) => {
    const key = el.dataset.navKey;
    const open = popover === 'nav:' + key;
    // phone drawer: the row is an accordion header — tap unfolds, tap again folds
    if (inDrawer()) { if (open) closePopover(); else openNav(key); return; }
    // touch without hover (an iPad at desktop width): first tap unfolds, second tap goes
    if (!isHoverDevice() && !open) { openNav(key); return; }
    // a pointer that hovers has the dropdown open already — the click is the group's own door
    closePopover(); router.navigate(el.getAttribute('href'));
  },
  profile: () => { nameSaved = false; popover = popover === 'menu' ? null : 'menu'; renderMenuPop(); renderSearchPop(); renderNavPops(); if (popover === 'menu') { const i = els.chrome.querySelector('[data-role="nameDraft"]'); if (i) i.focus(); } },
  saveName: () => {
    const i = els.chrome.querySelector('[data-role="nameDraft"]');
    const v = i ? i.value : '';
    session.setDisplayName(v);
    nameSaved = true; renderAll(); popover = 'menu'; renderMenuPop();
  },
  signOut: () => { closePopover(); session.clear(); ui.toast(COPY.signedOut); router.replace('/signin'); },
  result: (el) => { const href = el.dataset.href; closePopover(); searchState = { q: '', people: [], assistant: null, busy: false, sel: -1 }; renderAll(); if (href === '#profile') { handlers.profile(); return; } router.navigate(href); },
  ask: async () => {
    const q = searchState.q.trim(); if (!q) return;
    searchState.busy = true; searchState.assistant = null; searchState.sel = -1; renderSearchPop();
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
      if (e.key === 'Escape') { closePopover({ refocus: true }); closeMenu(); return; }
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
    // the phone drawer's dim is a real element with its own listener (a tap on a bare <body> pseudo-element
    // is not reliably a click on iOS); any other tap outside the bar folds the drawer away too
    if (!els.scrim) { els.scrim = document.createElement('div'); els.scrim.className = 'mx-scrim'; els.scrim.setAttribute('aria-hidden', 'true'); els.scrim.addEventListener('click', closeMenu); document.body.appendChild(els.scrim); }
    document.addEventListener('click', e => {
      if (menuShown() && !(e.target.closest && e.target.closest('#chrome'))) { closeMenu(); return; }
      if (!popover) return;
      if (e.target.closest('[data-stop]') || e.target.closest('[data-act="profile"]') || e.target.closest('[data-act="navgroup"]') || e.target.closest('[data-act="menu"]') || e.target.closest('[data-role="q"]') || e.target.closest('.mx-dd')) return;
      closePopover();
    });
    // dropdowns open on hover (desktop pointer only — the phone drawer and touch use taps) and on
    // keyboard focus of the group; they close ~160 ms after the pointer leaves the item + panel,
    // so a diagonal move onto the panel never snaps it shut
    els.chrome.addEventListener('mouseover', e => {
      if (!isHoverDevice() || inDrawer()) return;
      const item = e.target.closest && e.target.closest('.mx-nav-item.has-menu');
      if (!item) return;
      if (item.classList.contains('locked')) return;
      openNav(item.dataset.menu);
    });
    els.chrome.addEventListener('mouseout', e => {
      if (!isHoverDevice() || inDrawer() || !popover || popover.indexOf('nav:') !== 0) return;
      const item = e.target.closest && e.target.closest('.mx-nav-item.has-menu');
      if (!item || (e.relatedTarget && item.contains(e.relatedTarget))) return;
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => { if (popover && popover.indexOf('nav:') === 0) closePopover(); }, 160);
    });
    // the pointer and the keyboard share ONE highlight in the search results — but only a pointer that
    // actually moves takes it: rows redrawn under a resting cursor (every keystroke) fire mouseover, and
    // Enter then opened whatever sat under the mouse instead of the first match
    // (tracked document-wide, so a pointer that came to rest over the page is known before rows appear under it)
    document.addEventListener('mousemove', e => {
      const moved = !!(e.movementX || e.movementY) || !!(lastPointer && (lastPointer.x !== e.clientX || lastPointer.y !== e.clientY));
      lastPointer = { x: e.clientX, y: e.clientY };
      if (!moved || popover !== 'search') return;
      const row = e.target.closest && e.target.closest('[data-role="search-pop"] .mx-pop-row');
      if (!row) return;
      const i = searchRows().indexOf(row);
      if (i >= 0 && i !== searchState.sel) { searchState.sel = i; markSelection(); }
    });
    els.chrome.addEventListener('focusin', e => {
      const a = e.target.closest && e.target.closest('[data-act="navgroup"]');
      if (a && !inDrawer() && !a.closest('.locked')) openNav(a.dataset.navKey);
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
      bridges: api.get('/api/bridges/events'),
      tasks: api.get('/api/v2/tasks/badge'),   // TASKS: done-unseen (red) · my open (grey)
      // PEOPLE: open member reports (App Store 1.2) — asked only by admins who can open the queue
      reports: perms.canAny(['member-ops']) ? api.get('/api/v2/safety/reports/count') : null
    });
    const batches = r.outbox && Array.isArray(r.outbox.batches) ? r.outbox.batches.length : 0;
    const unread = r.pstats && r.pstats.pending ? Number(r.pstats.pending.unreadMessages || 0) : 0;
    const chatUnread = chatUnreadOf(r.chat);   // filtered channels + my dms — the same list the Inbox chat tab shows
    const tasksDone = r.tasks ? Number(r.tasks.done_unseen || 0) : 0;
    const tasksOpen = r.tasks ? Number(r.tasks.assigned_open || 0) : 0;
    // TEAM rolls the red counts up (finished tasks to see + inbox items waiting); grey stays my open tasks
    const inbox = batches + unread;
    const reports = r.reports ? Number(r.reports.open || 0) : 0;
    state.set({ badges: { inbox, chat: chatUnread, outboxBatches: batches, unreadMessages: unread, tasks: tasksDone, tasksOpen, team: inbox + tasksDone, reports }, eventDay: isEventDay(r.conf, r.bridges) });
    return r;
  }
};
export default chrome;
