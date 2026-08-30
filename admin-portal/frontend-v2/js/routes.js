// js/routes.js — THE ROUTE TABLE. Client routes live at ROOT paths (/today, /projects/plexus …);
// they never collide with the server-rendered paths (cfg.serverPaths). Add a destination = add
// one row + one view module (see ARCHITECTURE.md §4).
//   path      — pattern; ':name' segment, ':name?' optional
//   view      — dynamic import of the view module (default export { title, render, destroy })
//   auth      — default true → guests bounce to /signin?next=…; false = public; guestOnly = signed-in admins bounce to Today
//   layout    — 'portal' (chrome) | 'signin' (paper, no chrome)
//   active    — top-nav highlight key: Today · Projects · Inbox · People · Money · Calendar · Event Day · Studio · Settings
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
  { path: '/inbox/:tab?',      view: () => import('./views/inbox.js'),       active: 'Inbox',     title: 'Inbox',        sections: S.inbox },      // outbox|email|messages|announcements|newsletter|chat
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
