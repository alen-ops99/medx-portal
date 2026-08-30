// js/facts.js — CANONICAL FACTS shared by every view (ONE source of truth) + the legacy-section → v2
// route map. Source: README "Admin review round — decisions" (2026-08-28). Dates/prices/venues that
// appear in copy come from here — never inline them in a view. Live server values (conference row,
// gala settings, calendar entries) override these at render time where a view says so; FACTS is the
// fallback and the wording reference.
export const FACTS = Object.freeze({
  year: 2026,
  plexus: Object.freeze({
    name: 'Plexus Conference 2026', week: 'Plexus Week 2026', short: 'Plexus 2026', edition: 9, slug: 'plexus-2026',
    start: '2026-12-04', end: '2026-12-05', startAt: '2026-12-04T09:00:00+01:00',
    dateRange: 'December 4–5, 2026', dateShort: 'Dec 4–5',
    venue: 'Novinarski dom', city: 'Zagreb', country: 'Croatia',
    free: true, cap: 100, abstracts: false,
    parts: 'Conference + Gala + Donor Night'
  }),
  gala: Object.freeze({
    name: 'Gala Evening', date: '2026-12-05', dateLabel: 'Sat, December 5', time: '19:00',
    venue: 'Hotel Esplanade', city: 'Zagreb',
    priceEarly: 150, priceRegular: 175, priceFlip: '2026-09-01', priceFlipLabel: 'Sep 1',
    refundable: false, seating: 'limited seating'
  }),
  accelerator: Object.freeze({
    name: 'The Accelerator', short: 'Accelerator', opens: '2026-12-08', opensLabel: 'December 8, 2026', opensShort: 'Dec 8, 2026',
    hosts: Object.freeze(['Cleveland Clinic', 'Mayo Clinic', 'Columbia', 'University of Zurich']), fellows: 18
  }),
  forum: Object.freeze({
    name: 'Biomedical Forum', cap: 200, membership: 'annual, renewable',
    gathering: Object.freeze({ start: '2027-05-28', end: '2027-05-29', label: 'May 28–29, 2027', where: 'Split or Zagreb' })
  }),
  bridges: Object.freeze({
    name: 'Building Bridges', longName: 'Building Bridges in Biomedicine',
    next: Object.freeze({ city: 'Boston', start: '2026-09-18', end: '2026-09-21', label: 'September 18–21, 2026', short: 'Sep 2026', venue: null, note: 'exact date & venue announced soon' }),
    editions: Object.freeze([{ n: '01', city: 'Washington', host: 'NIH' }, { n: '02', city: 'London', host: 'Embassy' }, { n: '03', city: 'New York', host: 'Consulate' }, { n: '04', city: 'Zürich', host: 'ETH' }]),
    guests: '150+'
  }),
  org: Object.freeze({ name: 'Med&X', site: 'https://medx.hr', city: 'Zagreb', copyright: '© Med&X 2026 · Zagreb' }),
  projectOrder: Object.freeze(['plexus', 'accelerator', 'forum', 'bridges'])
});

// Gala price by the clock (README: flips automatically on Sep 1). Views prefer the server's
// gala settings (price_gala_early_bird / price_gala_regular / early_bird_deadline) and fall back here.
export function galaPriceNow(settings, now = new Date()) {
  const s = settings || {};
  const early = Number(s.price_gala_early_bird) || FACTS.gala.priceEarly;
  const regular = Number(s.price_gala_regular) || FACTS.gala.priceRegular;
  const deadline = (s.early_bird_deadline || FACTS.gala.priceFlip).slice(0, 10);
  return now.toISOString().slice(0, 10) <= deadline ? early : regular;
}

// ---- Legacy admin section ids (SECTION_ROUTE_MAP / SPA data-section / nag open_section /
// advisor link_section / assistant deepLink.target) → v2 client routes. Unknown ids → fallback.
export const SECTION_ROUTES = Object.freeze({
  dashboard: '/today', today: '/today', 'action-center': '/today', discover: '/today',
  plexus: '/projects/plexus', conferences: '/projects/plexus', editions: '/projects/plexus', cme: '/projects/plexus',
  speakers: '/projects/plexus', 'speaker-itineraries': '/projects/plexus', sessions: '/projects/plexus', postevent: '/projects/plexus', 'post-event': '/projects/plexus',
  gala: '/gala', auctions: '/gala', 'donor-night': '/gala', seating: '/gala',
  accelerator: '/projects/accelerator', review: '/accelerator-review', evaluation: '/accelerator-review', ranking: '/accelerator-review', interviews: '/accelerator-review',
  forum: '/projects/forum', members: '/projects/forum', candidates: '/projects/forum', council: '/projects/forum',
  bridges: '/projects/bridges', 'croatians-abroad': '/projects/bridges',
  inbox: '/inbox', outbox: '/inbox/outbox', messages: '/inbox/messages', announce: '/inbox/announcements', announcements: '/inbox/announcements',
  'user-notifications': '/inbox/announcements', 'email-blast': '/inbox/email', 'registrant-emails': '/inbox/email', newsletter: '/inbox/newsletter', 'team-chat': '/inbox/chat', chat: '/inbox/chat',
  'member-ops': '/people', people: '/people', users: '/people', 'guest-passes': '/people', team: '/settings/team', contacts: '/people', network: '/people', rewards: '/people',
  finances: '/money', money: '/money', transparency: '/money', reconcile: '/money', sponsors: '/money',
  'year-calendar': '/calendar', calendar: '/calendar', tasks: '/calendar/tasks',
  gameday: '/event-day', 'gameday-settings': '/event-day', scanner: '/event-day', 'event-tracking': '/event-day', 'event-day': '/event-day',
  settings: '/settings', health: '/settings/health', 'system-health': '/settings/health', audit: '/settings/audit', tech: '/settings/tech', files: '/settings/library', resources: '/settings/library',
  'pr-media': '/studio', 'content-studio': '/studio', 'merch-studio': '/studio', print: '/studio', studio: '/studio',
  'portal-content': '/member-pages', 'website-content': '/member-pages', 'member-feed': '/member-pages', 'member-pages': '/member-pages',
  'signup-forms': '/links', 'registration-links': '/links', 'event-invites': '/links', links: '/links',
  registrations: '/registrations'
});
export function routeForSection(id, fallback = '/today') {
  const k = String(id || '').trim().toLowerCase().replace(/^#/, '').replace(/^(section-|up-section-)/, '');
  if (k.startsWith('/')) return k;
  return SECTION_ROUTES[k] || fallback;
}

// Nav destination → the permission sections that unlock it (ANY of). Unlisted = every signed-in
// admin (unmapped routes on the server: tasks, chat, prefs, dashboard, notifications…).
export const DEST_SECTIONS = Object.freeze({
  plexus: ['plexus'], accelerator: ['accelerator'], forum: ['forum'], bridges: ['bridges'],
  inbox: ['member-ops', 'pr-media'], people: ['member-ops', 'guest-passes', 'team', 'contacts'], money: ['finances'],
  eventday: ['gameday', 'plexus'], studio: ['pr-media', 'plexus', 'signup-forms'], gala: ['plexus'],
  registrations: ['plexus', 'forum', 'bridges', 'signup-forms'], links: ['plexus', 'bridges', 'signup-forms'],
  memberpages: ['pr-media', 'plexus', 'accelerator'], acceleratorreview: ['accelerator']
});
