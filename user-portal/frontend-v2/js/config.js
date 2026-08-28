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
  serverPaths: [
    '/api', '/plexus', '/forum', '/apply', '/evaluate', '/pay', '/pass', '/invite', '/invite-success',
    '/invite-cancelled', '/reset-password', '/qr', '/calendar', '/verify-certificate', '/verify', '/r',
    '/unsubscribe', '/email-prefs', '/donate', '/uploads', '/f', '/speaker', '/building-bridges',
    '/donor-night', '/terms', '/privacy', '/health', '/__staging', '/__admin'
  ]
};
export default cfg;
