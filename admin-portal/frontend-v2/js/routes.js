// js/routes.js — THE ROUTE TABLE. Client routes live at ROOT paths (/today, /projects/plexus …);
// they never collide with the server-rendered paths (cfg.serverPaths). Add a destination = add
// one row + one view module (see ARCHITECTURE.md §4).
//   path      — pattern; ':name' segment, ':name?' optional
//   view      — dynamic import of the view module (default export { title, render, destroy })
//   auth      — default true → guests bounce to /signin?next=…; false = public; guestOnly = signed-in admins bounce to Today
//   layout    — 'portal' (chrome) | 'signin' (paper, no chrome)
//   active    — the destination key; chrome.js maps it to its top-nav GROUP (Today · Projects · Team · People ·
//               Money · Event Day · More) and highlights the matching dropdown row
//   title     — document title (a view may override with its own `title`)
//   sections  — permission ids (ANY of) that unlock the destination; missing → views/locked.js (contract §3.4)
import { DEST_SECTIONS as S } from './facts.js';
const today = () => import('./views/today.js');
export const ROUTES = [
  { path: '/',        view: today, active: 'Today', title: 'Today' },
  { path: '/today',   view: today, active: 'Today', title: 'Today' },
  { path: '/signin',  view: () => import('./views/signin.js'), auth: false, guestOnly: true, layout: 'signin', title: 'Sign in' },
  { path: '/projects', redirect: '/projects/plexus' },
  { path: '/projects/plexus/:tab?',      view: () => import('./views/plexus.js'),      active: 'Projects', title: 'Plexus Week 2026',  sections: S.plexus },
  { path: '/projects/accelerator/:tab?', view: () => import('./views/accelerator.js'), active: 'Projects', title: 'Accelerator',       sections: S.accelerator },
  { path: '/projects/forum/:tab?',       view: () => import('./views/forum.js'),       active: 'Projects', title: 'Biomedical Forum',  sections: S.forum },
  { path: '/projects/bridges/:tab?',     view: () => import('./views/bridges.js'),     active: 'Projects', title: 'Building Bridges',  sections: S.bridges },
  // BIG IDEAS — a primary destination of its own (never a tab inside PROJECTS): the long-term
  // projects book. '/big-ideas' is the list, '/big-ideas/<id>' the detail.
  { path: '/big-ideas/:id?',   view: () => import('./views/big-ideas.js'),   active: 'Big Ideas', title: 'Big Ideas',    sections: S.bigideas },
  // TASKS — the board (2026-09-20): '/tasks' is the board, '/tasks/<id>' opens that card's
  // drawer. Unmapped on the server (every admin has a board; each card is seen only by its creator
  // and its assignee, 25 Sept 2026) → no `sections`.
  { path: '/tasks/:id?',       view: () => import('./views/tasks.js'),       active: 'Tasks',     title: 'Tasks' },
  // NOTES — event & day notes (2026-09-22): '/notes' is the stream + composer, '/notes/<id>' scrolls
  // to that note, '/notes?event=<key>' is one event's page. Unmapped on the server (whole team) → no `sections`.
  { path: '/notes/:id?',       view: () => import('./views/notes.js'),       active: 'Notes',     title: 'Notes' },
  { path: '/program/:eventKey?', view: () => import('./views/program.js'),   active: 'Projects',  title: 'Program' },                              // the event app's PROGRAM EDITOR (2026-09-22) — unmapped on the server → every admin
  { path: '/inbox/:tab?',      view: () => import('./views/inbox.js'),       active: 'Inbox',     title: 'Inbox',        sections: S.inbox },      // outbox|email|messages|announcements|newsletter|chat
  // SPEAKER PIPELINE (2026-09-22) — potential speakers for 2027 under PEOPLE ▾. '/people/speakers' is
  // the board, '/people/speakers/<id>' opens that prospect's drawer; '/speakers' is the short alias.
  // MUST sit above '/people/:tab?' (first match wins). Unmapped on the server (whole team) → no `sections`.
  { path: '/people/speakers/:id?', view: () => import('./views/speaker-pipeline.js'), active: 'Speakers', title: 'Speaker pipeline' },
  { path: '/speakers/:id?',    view: () => import('./views/speaker-pipeline.js'), active: 'Speakers', title: 'Speaker pipeline' },
  { path: '/people/:tab?',     view: () => import('./views/people.js'),      active: 'People',    title: 'People',       sections: S.people },
  { path: '/money/:tab?',      view: () => import('./views/money.js'),       active: 'Money',     title: 'Money',        sections: S.money },
  { path: '/calendar/:tab?',   view: () => import('./views/calendar.js'),    active: 'Calendar',  title: 'Calendar' },                             // tasks are unmapped on the server → every admin
  { path: '/event-day',        view: () => import('./views/eventday.js'),    active: 'Event Day', title: 'Event Day',    sections: S.eventday },
  { path: '/settings/:tab?',   view: () => import('./views/settings.js'),    active: 'Settings',  title: 'Settings & tools' },                     // health|team|audit|library|org — blocks lock individually
  { path: '/studio/:tab?',     view: () => import('./views/studio.js'),      active: 'Studio',    title: 'Studio',       sections: S.studio },
  { path: '/gala/:tab?',       view: () => import('./views/gala.js'),        active: 'Projects',  title: 'Gala Evening', sections: S.gala },
  { path: '/registrations',    view: () => import('./views/registrations.js'), active: 'People', title: 'Registrations', sections: S.registrations },
  { path: '/links',            view: () => import('./views/links.js'),       active: 'Projects',  title: 'Links',        sections: S.links },
  { path: '/member-pages/:tab?', view: () => import('./views/member-pages.js'), active: 'Projects', title: 'What members see', sections: S.memberpages },
  { path: '/accelerator-review/:tab?', view: () => import('./views/accelerator-review.js'), active: 'Projects', title: 'Review Room', sections: S.acceleratorreview }
];
export const NOT_FOUND = () => import('./views/notfound.js');
export const LOCKED = () => import('./views/locked.js');
