// js/config.js — runtime configuration.
// index.html sets window.MEDX_CONFIG in a tiny inline script (between the
// /* MEDX_CONFIG:start */ … /* MEDX_CONFIG:end */ markers). The deploy picks
// config.staging.js or config.production.js and stamps it into that block
// (scripts/apply-config.js). Nothing else in the app reads window.MEDX_CONFIG.
//
//   apiBase : ''  → same-origin (production: the Express server serves both)
//             'https://<staging>.onrender.com' → direct cross-origin calls (Netlify)
//   env     : 'production' | 'staging'
const raw = (typeof window !== 'undefined' && window.MEDX_CONFIG) || {};
const cfg = {
  apiBase: String(raw.apiBase || '').replace(/\/+$/, ''),
  env: raw.env === 'staging' ? 'staging' : 'production',
  get isStaging() { return this.env === 'staging'; },
  // Server-rendered paths that must NEVER be handled by the client router (they belong to
  // user-portal/backend/server.js: public forms, pay links, passes, reset pages…). Kept here so
  // router.js, dev-server.js and _redirects agree on one list.
  // '/meetups' is the backend's token surface (/meetups/manage/:t, /meetups/invite/:t/accept|decline,
  // /meetups/host/:t) — NOT the client route, which is '/app/plexus/meetups'.
  serverPaths: [
    // '/awards' is the public Plexus Gala awards surface (design/AWARDS-SPEC.md): the landing
    // page, the four criteria pages with their forms, the nominee's manage/withdraw page, the
    // reviewer's reading room and a laureate's slides page. Every one of them must work with NO
    // login, so they are server-rendered by user-portal/backend/v2/awards.js and the SPA router
    // never intercepts them (a /awards link is a full page load, like /plexus and /meetups).
    // '/boston' is the Building Bridges Boston event page plus the emailed speaker upload link
    // (/boston/upload/:token) and the admin presentations list — all server-rendered, so the SPA
    // router must let them through as full page loads (matching _redirects on the Netlify host).
    '/api', '/plexus', '/meetups', '/awards', '/forum', '/apply', '/evaluate', '/pay', '/pass', '/invite', '/invite-success',
    '/invite-cancelled', '/reset-password', '/qr', '/calendar', '/verify-certificate', '/verify', '/r',
    '/unsubscribe', '/email-prefs', '/donate', '/uploads', '/f', '/speaker', '/boston', '/building-bridges',
    '/donor-night', '/terms', '/privacy', '/health', '/__staging', '/__admin', '/gala/ticket', '/plexus.ics'
  ]
};
export default cfg;
