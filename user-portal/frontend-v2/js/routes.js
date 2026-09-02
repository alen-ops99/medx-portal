// js/routes.js — THE ROUTE TABLE. Client routes live under /app/… so they never collide with
// the server-rendered paths (cfg.serverPaths). Add a screen = add one row + one view module.
//   path     — pattern; ':name' segment, ':name?' optional
//   view     — dynamic import of the view module (default export { title, render, destroy })
//   redirect — instead of a view: replace the URL with this path (typed-path aliases)
//   auth     — true → guests bounce to /app/auth/signin?next=…; guestTo overrides the bounce target
//   layout   — 'portal' (chrome) | 'auth' (ink ground, no chrome) | 'bare' (cream, no chrome)
//   active   — drawer highlight key: Home · Plexus · Gala · Accelerator · Forum · Bridges · Network · My Med&X
//   title    — document/mobile-bar title (a view may override with its own `title`)
const home = () => import('./views/home.js');
export const ROUTES = [
  { path: '/',          view: home, auth: true, guestTo: '/app/auth/welcome', active: 'Home', title: 'Home' },
  { path: '/app',       view: home, auth: true, guestTo: '/app/auth/welcome', active: 'Home', title: 'Home' },
  { path: '/app/home',  view: home, auth: true, guestTo: '/app/auth/welcome', active: 'Home', title: 'Home' },
  { path: '/app/auth/:view?', view: () => import('./views/auth.js'), layout: 'auth', title: 'Member Portal' },   // welcome|signin|signup|verify|reset|forum-code
  { path: '/signin',    redirect: '/app/auth/signin' },   // typed-path alias (audit small notes) — /signin used to 404
  { path: '/app/plexus/:tab?', view: () => import('./views/plexus.js'), auth: true, active: 'Plexus', title: 'Plexus Conference' }, // program|zagreb|mine
  { path: '/app/gala',  view: () => import('./views/gala.js'), auth: true, active: 'Gala', title: 'Gala Evening' },
  { path: '/app/accelerator/:tab?', view: () => import('./views/accelerator.js'), auth: true, active: 'Accelerator', title: 'The Accelerator' }, // apply
  { path: '/app/forum', view: () => import('./views/forum.js'), auth: true, active: 'Forum', title: 'Biomedical Forum' },
  { path: '/app/bridges', view: () => import('./views/bridges.js'), auth: true, active: 'Bridges', title: 'Building Bridges' },
  { path: '/app/network', view: () => import('./views/network.js'), auth: true, active: 'Network', title: 'Network' },
  { path: '/app/messages', view: () => import('./views/messages.js'), auth: true, active: 'Network', title: 'Messages' },
  { path: '/app/profile', view: () => import('./views/profile.js'), auth: true, active: 'My Med&X', title: 'Profile & settings' },
  { path: '/app/me/:tab?', view: () => import('./views/me.js'), auth: true, active: 'My Med&X', title: 'My Med&X' }, // certificates
  { path: '/app/mentorship', view: () => import('./views/mentorship.js'), auth: true, title: 'Mentorship' },
  { path: '/app/opportunities', view: () => import('./views/opportunities.js'), auth: true, title: 'Opportunity board' },
  { path: '/app/projects', view: () => import('./views/projects.js'), auth: true, title: 'Projects' },           // mobile PROJECTS tab
  { path: '/app/maintenance', view: () => import('./views/maintenance.js'), layout: 'bare', title: 'Back shortly' }
];
export const NOT_FOUND = () => import('./views/notfound.js');
