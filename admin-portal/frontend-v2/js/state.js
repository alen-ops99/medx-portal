// js/state.js — session + tiny pub/sub store.
// localStorage keys are the LEGACY admin names on purpose: `medx_token` / `medx_user` are what the
// live admin SPA (admin-portal/frontend/index.html) reads, so a session survives the v1 ↔ v2 switch.
// `medx_admin_display_name` is the per-admin display name from the design (README review round).
const KEYS = Object.freeze({ token: 'medx_token', user: 'medx_user', displayName: 'medx_admin_display_name' });

const store = {
  token: null,
  user: null,            // { id, email, first_name, last_name, institution, is_admin, is_staff, is_founder, allowed_sections (array|null), must_change_password }
  badges: { inbox: 0, chat: 0 },   // top-nav INBOX badge (outbox batches + unread member messages) · TEAM CHAT pill
  health: null,          // { state:'ok'|'warn'|'fail'|'unknown', ok, warn, fail, label, probes } — see js/health.js
  eventDay: false,       // true on an event date → EVENT DAY appears in the top nav
  active: 'Today',       // top-nav highlight key
  layout: 'portal',      // 'portal' (chrome) | 'signin' (paper, no chrome)
  viewTitle: ''
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
  get isFounder() { return !!(store.user && Number(store.user.is_founder)); },
  // allowed sections: null = full access (founder or NULL column); [] = Today only; array = section ids
  get allowed() { const u = store.user; if (!u) return null; if (Number(u.is_founder)) return null; return Array.isArray(u.allowed_sections) ? u.allowed_sections : (u.allowed_sections == null ? null : []); },
  restore() {
    let token = null, user = null;
    try { token = localStorage.getItem(KEYS.token) || null; user = readJSON(KEYS.user); } catch (e) { /* storage blocked */ }
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
    store.token = null; store.user = null; store.badges = { inbox: 0, chat: 0 }; store.health = null;
    try { localStorage.removeItem(KEYS.token); localStorage.removeItem(KEYS.user); } catch (e) {}
    emit(['token', 'user', 'badges', 'health']);
  },
  // Display name: the per-admin editable name (profile menu) → drives greeting + avatar initials (README).
  displayName() {
    let n = ''; try { n = (localStorage.getItem(KEYS.displayName) || '').trim(); } catch (e) {}
    if (n) return n;
    const u = store.user || {}; return [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email || 'Admin';
  },
  setDisplayName(v) { const n = String(v || '').trim(); try { if (n) localStorage.setItem(KEYS.displayName, n); else localStorage.removeItem(KEYS.displayName); } catch (e) {} emit(['user']); return session.displayName(); },
  firstName() { return session.displayName().split(/\s+/)[0]; },
  initials() { return session.displayName().split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || 'A'; },
  roleLabel() { const u = store.user || {}; if (Number(u.is_founder)) return 'FOUNDER · FULL ACCESS'; if (session.allowed === null) return 'ADMIN · FULL ACCESS'; if (Number(u.is_staff) && !Number(u.is_admin)) return 'SCANNER STAFF · EVENT DAY'; const n = session.allowed.length; return 'ADMIN · ' + (n ? n + ' SECTION' + (n === 1 ? '' : 'S') : 'TODAY ONLY'); }
};
