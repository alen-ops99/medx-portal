// js/config.js — runtime configuration.
// index.html sets window.MEDX_CONFIG in a tiny inline script (between the
// /* MEDX_CONFIG:start */ … /* MEDX_CONFIG:end */ markers). The deploy picks
// config.staging.js or config.production.js and stamps it into that block
// (scripts/apply-config.js). Nothing else in the app reads window.MEDX_CONFIG.
//
//   apiBase         : ''  → same-origin. Production: the admin Express server serves this folder + the API.
//                     Staging (Netlify): ALSO '' — netlify/_redirects proxies /api/* to
//                     https://medx-staging.onrender.com/__admin/api/* (the launcher strips /__admin), so
//                     every literal '/api/…' path just works and no CORS is involved.
//   memberBase      : prefix for MEMBER-portal reads (health probe of GET /api/public/status, note 0b).
//                     Staging: '/__member' (proxied by _redirects / dev-server.js). Production: '' means
//                     "same origin" — see ARCHITECTURE.md §12 for the production caveat.
//   memberPortalUrl : where "VIEW MEMBER PORTAL ↗" goes.
//   env             : 'production' | 'staging'
const raw = (typeof window !== 'undefined' && window.MEDX_CONFIG) || {};
const cfg = {
  apiBase: String(raw.apiBase || '').replace(/\/+$/, ''),
  memberBase: String(raw.memberBase || '').replace(/\/+$/, ''),
  memberPortalUrl: String(raw.memberPortalUrl || '').replace(/\/+$/, ''),
  env: raw.env === 'staging' ? 'staging' : 'production',
  get isStaging() { return this.env === 'staging'; },
  // Server-rendered / proxied paths that must NEVER be handled by the client router (they belong to
  // admin-portal/backend/server.js: applicant + reviewer pages, invite links, uploads…). Kept here so
  // router.js, dev-server.js and netlify/_redirects agree on one list.
  serverPaths: ['/api', '/uploads', '/photo-library', '/health', '/newsletter', '/review', '/evaluate', '/apply', '/e', '/a', '/__staging', '/__admin', '/__member']
};
export default cfg;
