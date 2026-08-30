// js/perms.js — the permission vocabulary (IMPLEMENTATION_CONTRACT §3). Enforcement is SERVER-side
// (403 { error, section } from auth() → sectionDenied()); everything here is UX: which nav items
// read as locked, and which route renders the locked screen instead of a broken page (§3.4).
//   import { perms } from './perms.js';
//   perms.canAny(['finances'])        // founder / NULL allowed_sections → true; [] → false; array → includes
//   perms.label('member-ops')         // 'Member Ops & Comms'
import { session } from './state.js';

// admin-portal/backend/server.js:1153 PERMISSION_SECTIONS (ids are stored in users.allowed_sections)
export const PERMISSION_SECTIONS = Object.freeze([
  { id: 'plexus', label: 'Plexus Week 2026', group: 'Projects' },
  { id: 'accelerator', label: 'Med&X Accelerator', group: 'Projects' },
  { id: 'forum', label: 'Biomedical Forum', group: 'Projects' },
  { id: 'bridges', label: 'Building Bridges', group: 'Projects' },
  { id: 'gameday', label: 'Game Day', group: 'Events & access' },
  { id: 'conferences', label: 'Conferences', group: 'Events & access' },
  { id: 'editions', label: 'Editions', group: 'Events & access' },
  { id: 'signup-forms', label: 'Sign-up Forms', group: 'Events & access' },
  { id: 'guest-passes', label: 'Guest Passes', group: 'Events & access' },
  { id: 'year-calendar', label: 'Year Calendar', group: 'Events & access' },
  { id: 'cme', label: 'CME / HLK', group: 'Events & access' },
  { id: 'pr-media', label: 'Marketing & Content', group: 'Marketing' },
  { id: 'member-ops', label: 'Member Ops & Comms', group: 'Communications' },
  { id: 'finances', label: 'Finance', group: 'Finance' },
  { id: 'contacts', label: 'My Network', group: 'Network' },
  { id: 'advisors', label: 'Executive Suite', group: 'Leadership' },
  { id: 'files', label: 'Files & Resources', group: 'System' },
  { id: 'team', label: 'Team Access', group: 'System' },
  { id: 'tech', label: 'System & Tech', group: 'System' }
]);

export const perms = {
  canAny(sections) {
    if (!sections || !sections.length) return true;
    const allowed = session.allowed;
    if (allowed === null) return true;
    return sections.some(s => allowed.includes(s));
  },
  can(section) { return perms.canAny([section]); },
  label(id) { const s = PERMISSION_SECTIONS.find(x => x.id === id); return s ? s.label : String(id || 'this section'); },
  // the locked-state copy (contract §3.4): clean state, names the section, points at the founder
  lockedCopy(section) { return { line: 'This area is locked for you.', why: `${perms.label(section)} needs access — ask Alen, he grants it per section.`, cta: 'BACK TO TODAY' }; }
};
export default perms;
