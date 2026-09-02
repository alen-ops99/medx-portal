// js/facts.js — CANONICAL FACTS shared by every view (ONE source of truth).
// Source: README "Admin review round — decisions" + implementation note 6 (member export
// 2026-08-28). Dates/prices/venues that appear in copy come from here — never inline them in a
// view. Live server values (e.g. /api/public/site) override these at render time where a view
// says so; FACTS is the fallback and the wording reference.
export const FACTS = Object.freeze({
  year: 2026,
  plexus: Object.freeze({
    name: 'Plexus Conference 2026', short: 'Plexus 2026', edition: 9,
    start: '2026-12-04', end: '2026-12-05',
    startAt: '2026-12-04T09:00:00+01:00',           // countdown target (README "Interactions")
    dateRange: 'December 4–5, 2026', dateShort: 'Dec 4–5',
    venue: 'Novinarski dom', city: 'Zagreb', country: 'Croatia',
    free: true, cap: 100, abstracts: false
  }),
  gala: Object.freeze({
    name: 'Gala Evening', date: '2026-12-05', weekday: 'Sat', dateLabel: 'Sat, December 5', time: '19:00',
    venue: 'Hotel Esplanade', city: 'Zagreb',
    priceEarly: 150, priceRegular: 175, priceFlip: '2026-09-15', priceFlipLabel: '15 Sep',
    dress: 'Black tie', refundable: false, seating: 'limited seating'
  }),
  accelerator: Object.freeze({
    name: 'The Accelerator', opens: '2026-11-15', opensLabel: 'November 15, 2026', opensShort: 'Nov 15',
    hosts: Object.freeze(['Cleveland Clinic', 'Mayo Clinic', 'Columbia', 'University of Zurich']),
    fellows: 18, codeFormat: /^AX26-[A-Z0-9]{4}$/
  }),
  forum: Object.freeze({
    name: 'Biomedical Forum', cap: 200, membership: 'annual, renewable',
    gathering: Object.freeze({ start: '2027-05-28', end: '2027-05-29', label: 'May 28–29, 2027', where: 'Split or Zagreb' }),
    codeFormat: /^FRM-[A-Z0-9]{4}-[A-Z0-9]{4}$/i
  }),
  bridges: Object.freeze({
    name: 'Building Bridges', longName: 'Building Bridges in Biomedicine',
    next: Object.freeze({ city: 'Boston', start: '2026-09-21', end: '2026-09-21', label: 'Monday, September 21, 2026 · 18:00', short: 'Sep 21', venue: 'Waterhouse Room, Gordon Hall — Harvard Medical School' }),
    perEvening: '40–50',
    editions: Object.freeze([
      { n: '01', city: 'Washington', host: 'NIH' }, { n: '02', city: 'London', host: 'Embassy' },
      { n: '03', city: 'New York', host: 'Consulate' }, { n: '04', city: 'Zürich', host: 'ETH' }
    ]),
    guests: '150+'
  }),
  org: Object.freeze({ name: 'Med&X', site: 'https://medx.hr', city: 'Split', est: 2018, copyright: '© Med&X 2026 · Split, Croatia' }),
  // project keys in hub order — matches GET /api/public/status ordering and notify_topics keys
  projectOrder: Object.freeze(['plexus', 'gala', 'accelerator', 'forum', 'bridges'])
});

// Gala price by the clock (flips on FACTS.gala.priceFlip). Production reads server config
// (/api/public/site price.current) first; this is the fallback.
export function galaPriceNow(now = new Date()) {
  return now < new Date(FACTS.gala.priceFlip + 'T00:00:00+02:00') ? FACTS.gala.priceEarly : FACTS.gala.priceRegular;
}

// ---------------------------------------------------------------------------------------------
// TWO VERBS, EVERYWHERE (UX audit 2026-09-02 › item 6).
// The portal offers exactly two registration actions, and every screen says them the same way:
// the conference (and Building Bridges) are free to register for, the Gala is a seat you reserve
// at the price of the day. No view invents a third wording — import these, never retype them.
export const CTA = Object.freeze({
  register: 'REGISTER — FREE',
  reserve: price => `RESERVE A SEAT · ${price}`
});

// ---------------------------------------------------------------------------------------------
// ONE DATE TRUTH (UX audit 2026-09-02 › item 1).
// Admin-edited free text (plexus settings `key_dates`, the /api/public/status detail lines) has
// drifted from these facts before — Home quoted a gala early bird ending 1 Sep while the Gala,
// Plexus and the form all said 15 Sep, and Boston appeared as three different dates on one screen.
// A row whose LABEL names a fact we hold is re-dated from FACTS here, so no two screens can quote
// different dates for the same thing. Labels, order and any row we don't recognise stay untouched.
// Order matters, and each test names its subject exactly: "Plexus Conference & Gala" is the
// conference range, "Gala seats" is the gala night, and a row like "Donor Night — during Plexus
// Week" names neither, so it keeps whatever date the admin gave it.
const DATE_TRUTH = [
  { test: /early.?bird|price\s*(flip|change)/i, date: () => `Until ${FACTS.gala.priceFlipLabel}` },
  { test: /building bridges|boston/i, date: () => FACTS.bridges.next.label },
  { test: /accelerator/i, date: () => FACTS.accelerator.opensLabel },
  { test: /plexus conference|conference\s*(&|and)\s*gala|plexus\s*20\d{2}/i, date: () => FACTS.plexus.dateRange },
  { test: /\bgala\b/i, date: () => FACTS.gala.dateLabel }
];
export function trueDateFor(label) {
  const s = String(label == null ? '' : label);
  if (!s) return null;
  const hit = DATE_TRUTH.find(r => r.test.test(s));
  return hit ? hit.date() : null;
}

// Repairs a stale early-bird deadline inside admin prose ("€150 through 1 Sep", "until Sep 1").
// Only fires on a sentence that is actually about the price, and only rewrites the date token that
// follows through/until/till/before — everything else the admin wrote survives verbatim.
const EB_DEADLINE = /\b(through|until|till|before)\s+((?:\d{1,2}\s*(?:st|nd|rd|th)?\s*)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s*\d{1,2})?)/i;
export function reconcileEarlyBird(text) {
  const s = String(text == null ? '' : text);
  if (!s || !/early.?bird|€|\bEUR\b/i.test(s)) return s;
  return s.replace(EB_DEADLINE, (_, lead) => `${lead} ${FACTS.gala.priceFlipLabel}`);
}

// v2 client routes per project key (cta_target from /api/public/status → route)
export const PROJECT_ROUTES = Object.freeze({
  plexus: '/app/plexus', gala: '/app/gala', accelerator: '/app/accelerator', forum: '/app/forum', bridges: '/app/bridges',
  network: '/app/network', messages: '/app/messages', mymedx: '/app/me', me: '/app/me', profile: '/app/profile',
  af26: '/app/forum', 'building-bridges': '/app/bridges', 'donor-night': '/app/bridges', talks: '/app/home', home: '/app/home', dashboard: '/app/home'
});
export function routeFor(key, fallback = '/app/home') {
  const k = String(key || '').trim().toLowerCase().replace(/^#/, '').replace(/^(app:|site:)/, '');
  if (/^https?:\/\//.test(k) || k.startsWith('/')) return String(key);
  return PROJECT_ROUTES[k] || fallback;
}
