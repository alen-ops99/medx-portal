// js/state.js — session + tiny pub/sub store.
// localStorage keys are the LEGACY names on purpose: `medx_user_token` / `medx_user_data` are
// shared with the live portal, the website (?mxt= hand-off) and the server-rendered /plexus form.
const KEYS = Object.freeze({ token: 'medx_user_token', user: 'medx_user_data' });

const store = {
  token: null,
  user: null,            // { id, email, first_name, last_name, institution, country, bio, photo_url, is_admin, quiet, email_verified }
  stats: null,           // chrome strip: { points, registrations, following, since, quiet }
  unread: 0,             // ALERTS dot
  active: 'Home',        // drawer highlight key
  layout: 'portal'       // 'portal' | 'bare' | 'auth'
};
const listeners = new Set();
function emit(keys) { listeners.forEach(fn => { try { fn(store, keys); } catch (e) { console.error('[state] listener failed', e); } }); }

export const state = {
  get: () => store,
  set(patch) { Object.assign(store, patch); emit(Object.keys(patch)); },
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  KEYS
};

function readJSON(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } }

export const session = {
  get token() { return store.token; },
  get user() { return store.user; },
  get isAuthed() { return !!store.token; },
  restore() {
    let token = null, user = null;
    try { token = localStorage.getItem(KEYS.token) || null; user = readJSON(KEYS.user); } catch (e) { /* storage blocked */ }
    if (token && typeof token === 'string' && token.startsWith('demo_token_')) { token = null; user = null; } // legacy demo sessions never authenticate
    store.token = token; store.user = user && typeof user === 'object' ? user : null;
    emit(['token', 'user']);
    return session.isAuthed;
  },
  set(token, user) {
    store.token = token || null;
    store.user = user ? Object.assign({}, store.user && store.user.id === user.id ? store.user : {}, user) : store.user;
    try { if (token) localStorage.setItem(KEYS.token, token); if (store.user) localStorage.setItem(KEYS.user, JSON.stringify(store.user)); } catch (e) {}
    emit(['token', 'user']);
  },
  update(patch) {
    store.user = Object.assign({}, store.user || {}, patch || {});
    try { localStorage.setItem(KEYS.user, JSON.stringify(store.user)); } catch (e) {}
    emit(['user']);
  },
  clear() {
    store.token = null; store.user = null; store.stats = null; store.unread = 0;
    try { localStorage.removeItem(KEYS.token); localStorage.removeItem(KEYS.user); } catch (e) {}
    emit(['token', 'user', 'stats', 'unread']);
  },
  displayName() { const u = store.user || {}; return [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email || 'Member'; },
  initials() { const u = store.user || {}; const a = (u.first_name || '').trim()[0], b = (u.last_name || '').trim()[0]; return ((a || '') + (b || '')).toUpperCase() || (u.email || 'M')[0].toUpperCase(); },
  emailConfirmed() { const u = store.user || {}; return u.email_verified === undefined || u.email_verified === null ? true : !!Number(u.email_verified); }
};
