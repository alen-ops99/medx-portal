// js/member.js — member-level derived state shared by Home, Profile and My Med&X.
// ONE source of truth for profile completion (README note 2: the Home nudge and the Profile
// checklist must agree). The backend has no completion % (GET /api/member/profile-nudge only
// says photo/institution missing) — see ARCHITECTURE.md › gaps — so the five Profile.dc.html
// checklist items are computed here from GET /api/auth/me + GET /api/networking/profile.
import { api } from './api.js';

export const COMPLETION_ITEMS = [
  { key: 'name', label: 'Name added', done: (me) => !!((me.first_name || '').trim() && (me.last_name || '').trim()) },
  { key: 'institution', label: 'Institution added', done: (me) => !!(me.institution || '').trim() },
  { key: 'photo', label: 'Portrait uploaded', done: (me) => !!(me.photo_url || '').trim() },
  { key: 'specialty', label: 'Specialty selected', done: (me, net) => !!(net && Array.isArray(net.research_interests) ? net.research_interests.length : (net && net.research_interests)) },
  { key: 'bio', label: 'Short bio written', done: (me) => !!(me.bio || '').trim() }
];

export function profileCompletion(me, networkingProfile) {
  const m = me || {};
  const items = COMPLETION_ITEMS.map(i => ({ key: i.key, label: i.label, done: !!i.done(m, networkingProfile) }));
  const n = items.filter(i => i.done).length;
  return { pct: Math.round((n / items.length) * 100), done: n, total: items.length, items, complete: n === items.length };
}

export async function loadProfileCompletion() {
  const r = await api.settle({ me: api.get('/api/auth/me'), net: api.get('/api/networking/profile') });
  return profileCompletion(r.me || {}, r.net);
}
