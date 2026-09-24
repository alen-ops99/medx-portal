// Source: Building Bridges.dc.html
// Blocks (artboard order): "Breadcrumb" › "Hero" › "Stats band" › "01 · THE MISSION" ›
// "02 · NEXT EVENT" › "03 · WHERE WE'VE BEEN" › "Questions".
// Data: next event = the soonest upcoming published row of GET /api/bridges/events (admin-run
// table; REGISTER posts to /api/bridges/events/:id/register — open to every signed-in member, no
// application); past-edition recap cards (admin-editable guests / new-connections + photo
// galleries) from GET /api/v2/bridges/editions (backend/v2/bridges.js); follow via /api/notify-topics.
// Boston copy rule — SUPERSEDED 2026-09-02 (UX audit item 1). The August rule ("exact date & venue
// announced later, no Harvard branding") outlived the announcement: the date, time and room are
// confirmed and public, while this screen still said "announced soon" beside a hero that named a
// date and a Home rail that named a different one. Boston now reads from FACTS.bridges.next —
// Monday, September 21, 2026 · 18:00, Waterhouse Room, Gordon Hall — everywhere on the page.
import { api } from '../api.js';
import { session } from '../state.js';
import { ui, esc, fmt } from '../ui.js';
import { FACTS, CTA } from '../facts.js';
import { chrome } from '../chrome.js';

export const SOURCE = 'Building Bridges.dc.html';

const NUM_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];

// ---- COPY: every string that may change in a revision (dates/venues via FACTS/API) ----
export const COPY = {
  crumb: { left: 'PROJECTS', right: 'BUILDING BRIDGES' },
  live: 'EVENT APP →',                   // Plexus Week Live (/app/live): the evening's program, my schedule, speakers
  hero: {
    eyebrow: (city, dateLabel) => `NEXT EDITION · ${city} · ${dateLabel}`,
    eyebrowNone: 'NEXT EDITION · TO BE ANNOUNCED',
    eyebrowHome: 'NEXT EDITION · ZAGREB · DURING PLEXUS WEEK',
    title: 'Building Bridges <i style="color:#c9a962">in Biomedicine</i>',
    lede: per => `Connecting Croatian medicine and science with international medicine and science — intimate evenings of ${per}, built for collaboration that outlasts the night.`,
    register: `${CTA.register} →`,
    follow: on => `GET UPDATES FROM BUILDING BRIDGES · ${on ? 'ON' : 'OFF'}`,
    followSub: 'Email + portal alerts · manage topics in Profile &amp; settings'
  },
  band: { cities: 'CITIES WORLDWIDE', guests: 'GUESTS HOSTED', events: 'EVENTS COMPLETED', per: 'GUESTS PER EVENING', perEvening: '40–50' },
  mission: {
    n: '01', title: 'THE MISSION',
    body: 'Building Bridges connects Croatian biomedical professionals across the globe and their respective affiliated institutions with the biomedical community in Croatia through diplomatic events and institutional initiatives. Each evening gathers 40–50 guests.',
    whoLabel: "WHO IT'S FOR", whoSub: 'Registration is open to everyone — the evenings are made for:',
    chips: ['RESEARCHERS', 'PHYSICIANS', 'LEADERS IN BIOMEDICINE'],
    bringsLabel: 'EVERY EVENING BRINGS',
    brings: [
      { text: "Keynotes from the host city's leading institutions", gold: false },
      { text: 'Structured networking, professionally facilitated', gold: false },
      { text: 'Prestigious venues, dinner and drinks', gold: false },
      { text: '40–50 guests, so every conversation counts', gold: true }
    ]
  },
  home: {
    when: 'During Plexus Week · December',
    title: year => `Building Bridges — Zagreb ${year}`,
    desc: 'The home edition: Croatian medicine and science and the colleagues who work abroad, in one room during Plexus Week.',
    how: 'Free to attend — register with the Plexus Week form and tick Building Bridges; one form covers the conference and the Gala too.',
    side: 'FREE TO ATTEND', chip: 'PART OF PLEXUS WEEK'
  },
  next: {
    n: '02', title: 'NEXT EVENT',
    venueLabel: venue => (venue || '').toUpperCase(),
    cardTitle: (city, year) => `Building Bridges — ${city} ${year}`,
    // Generic line for any city the admin adds; the confirmed edition prints the admin's own description
    // (the Boston evening is a panel + five-minute presentations + reception, not keynotes).
    desc: city => `An evening connecting the Croatian biomedical community of greater ${city} with colleagues at the city's leading institutions. Short presentations, a panel, and a shared table.`,
    goal: '<strong style="color:#191512">The goal:</strong> every guest leaves with at least one collaboration worth continuing — a co-author, a mentor, a clinical exchange.',
    spots: n => `ONLY ${n} SPOTS`, full: 'FULLY BOOKED',
    chip2: 'PRESENTATIONS · PANEL · RECEPTION',
    starts: 'EVENT STARTS IN', units: ['DAYS', 'HOURS', 'MINS'],
    register: `${CTA.register} →`, registered: 'REGISTERED ✓ · MY TICKET →',
    closed: 'Registration opens soon — follow Building Bridges above and we tell you first.',
    fullToast: 'This evening is fully booked — follow Building Bridges above and we tell you if a seat opens.',
    emptyLine: 'The next evening is being planned.',
    emptyWhy: 'Follow Building Bridges and we tell you the moment the next city and date are confirmed.',
    emptyCta: 'GET UPDATES →'
  },
  form: {
    eyebrow: city => `BUILDING BRIDGES · ${city.toUpperCase()}`,
    title: city => `Reserve your place in ${city}.`,
    note: 'Open to everyone — no application, no fee. Check your details and register.',
    first: 'FIRST NAME', last: 'LAST NAME', email: 'EMAIL', inst: 'INSTITUTION', role: 'ROLE / TITLE',
    motivation: 'WHAT WOULD YOU LIKE OUT OF THE EVENING? (OPTIONAL)',
    cancel: 'NOT NOW', submit: `${CTA.register} →`,
    needName: 'Please fill in your first and last name.', needEmail: 'Please enter a valid email address.',
    done: city => `You're registered for ${city} — your entry QR is in My Med&X.`,
    already: city => `You're already registered for ${city} — your entry QR is in My Med&X.`
  },
  been: {
    n: '03', title: "WHERE WE'VE BEEN",
    sub: n => `${NUM_WORDS[n] || n} evenings so far — each one, a room full of new collaborations.`,
    edition: (no, isLatest, isFirst) => `EDITION ${String(no).padStart(2, '0')}${isLatest ? ' · MOST RECENT' : isFirst ? ' · THE FIRST' : ''}`,
    // Audit C5: no invented figures and no placeholder captions on a member page. A missing
    // guest/connection count hides its row instead of printing "— GUESTS", and an edition with no
    // photo yet gets a plain city plate, not the literal "PHOTO · ZÜRICH EVENING".
    photoLabel: city => String(city || '').toUpperCase(),
    guests: 'GUESTS', conns: 'NEW CONNECTIONS',
    gallerySoon: city => `Photos from the ${city} evening are being added — check back soon.`,
    galleryEyebrow: city => `BUILDING BRIDGES · ${city.toUpperCase()}`,
    galleryTitle: city => `The ${city} evening`, close: 'CLOSE'
  },
  followed: 'You follow Building Bridges — updates reach your inbox and alerts.',
  unfollowed: 'Building Bridges updates are off.',
  footer: {
    line: 'Want Building Bridges in your city, or a seat at the next evening?',
    sub: 'Message us · replies land right here in your portal inbox.',
    cta: 'MESSAGE US →'
  }
};

// ---- view state ----
let D = null, st = null, timers = [], unbind = null, rootEl = null, openModal = null;

function ensureCss() {
  if (!document.querySelector('link[href="/css/views/bridges.css"]')) {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/css/views/bridges.css'; document.head.appendChild(l);
  }
}

// ---------------------------------------------------------------- data
function factsEditions() {
  // last-resort fallback (canonical editions from FACTS) when GET /api/v2/bridges/editions fails
  return FACTS.bridges.editions.map(e => ({
    // guests/connections stay null on purpose: the card now hides a figure nobody has entered
    // rather than printing a dash beside its label (audit C5).
    id: 'facts-' + e.n, edition_no: Number(e.n), city: e.city, venue: e.host, note: null,
    guests: null, connections: null, photos: []
  })).reverse();
}

async function load() {
  const r = await api.settle({
    events: api.get('/api/bridges/events'),
    editions: api.get('/api/v2/bridges/editions', { noAuth: true }),
    topics: api.get('/api/notify-topics'),
    week: api.get('/api/v2/plexus-week/overview')   // the Zagreb home edition lives inside Plexus Week
  });
  const today = new Date().toISOString().slice(0, 10);
  const events = Array.isArray(r.events) ? r.events : [];
  const upcoming = events.filter(e => e && e.event_date && String(e.event_date).slice(0, 10) >= today)
    .sort((a, b) => String(a.event_date).localeCompare(String(b.event_date)));
  const nextEv = upcoming[0] || null;
  let next = null;
  if (nextEv) {
    const date = String(nextEv.event_date).slice(0, 10);
    const f = FACTS.bridges.next;
    // The confirmed edition (city + date inside the FACTS window) is described by FACTS: one date,
    // one time, one room, matching the Home rail and the invitation. Any other event the admin adds
    // is shown exactly as the admin entered it.
    const isNext = String(nextEv.city || '').toLowerCase().includes(f.city.toLowerCase()) && date >= f.start && date <= f.end;
    const capacity = Number(nextEv.capacity) || 0;
    const spots = capacity ? Math.max(0, capacity - (Number(nextEv.registration_count) || 0)) : null;
    let mine = null;
    try { mine = await api.get(`/api/bridges/events/${encodeURIComponent(nextEv.id)}/my-registration`); } catch (e) { mine = null; }
    next = {
      ev: nextEv, id: nextEv.id, city: nextEv.city || f.city, date, isNext,
      year: date.slice(0, 4),
      dateLabel: isNext ? f.label : fmt.longRange(date),
      venue: isNext ? f.venue : (nextEv.venue || ''),
      open: nextEv.registration_open === undefined ? true : !!Number(nextEv.registration_open),
      spots,
      startAt: `${date}T${(String(nextEv.event_time || '').match(/\d{1,2}:\d{2}/) || ['18:00'])[0]}:00`,
      registered: !!(mine && mine.registered)
    };
  }
  // No dated evening ahead, but Plexus Week's Building Bridges Zagreb is open: show THAT as the next
  // evening (registration = the Plexus Week form with Bridges ticked). The page used to say "the next
  // evening is being planned" while the Plexus page and the Home card said "Zagreb · registration open".
  let home = null;
  const hb = !next && r.week && Array.isArray(r.week.blocks) ? r.week.blocks.find(b => b && b.key === 'bridges') : null;
  if (hb && hb.status_kind === 'open') {
    const venue = hb.venue && !/to be announced/i.test(hb.venue) ? hb.venue : '';
    home = { city: r.week.city || 'Zagreb', year: String((r.week.date_label || '').match(/\d{4}/) || FACTS.year),
      dateLabel: hb.date_label || COPY.home.when, venue };
  }
  const editions = (r.editions && Array.isArray(r.editions.editions) && r.editions.editions.length)
    ? r.editions.editions : factsEditions();
  const totals = (r.editions && r.editions.totals) || {};
  const cities = totals.cities || new Set(editions.map(e => e.city)).size;
  const guests = totals.guests != null ? fmt.num(totals.guests) : FACTS.bridges.guests;
  return {
    next, home, editions,
    stats: { cities, guests, events: totals.events || editions.length },
    follow: !!(r.topics && Array.isArray(r.topics.projects) && r.topics.projects.includes('bridges'))
  };
}

// ---------------------------------------------------------------- blocks
function blockCrumb() {
  return `
  <!-- dc: Building Bridges.dc.html › "Breadcrumb" -->
  <div class="mx-crumbs mx-gutter" style="display:flex;align-items:center;gap:13px;padding:10px 36px;border-bottom:1px solid rgba(25,21,18,.16)">
    <a href="/app/projects" data-dir="back" style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#4a4239" data-hover="color:#191512">${COPY.crumb.left}</a>
    <span style="color:rgba(25,21,18,.35);font-size:10px">→</span>
    <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#191512">${COPY.crumb.right}</span>
    <div style="flex:1"></div>
    <a href="/app/live" data-v2="Plexus Week Live — the event app (docs/EVENT-APP-BRIEF.md)" style="display:inline-flex;align-items:center;gap:7px;min-height:24px;font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#9b1b22;text-decoration:none;white-space:nowrap" data-hover="color:#7e151b"><span style="width:6px;height:6px;background:#9b1b22;display:inline-block"></span>${COPY.live}</a>
  </div>
  <!-- /dc -->`;
}

function followToggle() {
  return `
      <div data-block="follow" style="display:flex;align-items:center;gap:10px;margin-top:20px">
        <span data-act="tgFollow" role="switch" aria-checked="${st.follow}" aria-label="Get updates from Building Bridges" class="mx-switch"><span></span></span>
        <span style="display:flex;flex-direction:column;gap:3px"><span data-role="follow-label" style="font:600 10px Inter,sans-serif;letter-spacing:.16em;color:rgba(247,241,230,.8)">${COPY.hero.follow(st.follow)}</span><span style="font-size:10.5px;color:rgba(247,241,230,.5)">${COPY.hero.followSub}</span></span>
      </div>`;
}

function blockHero() {
  const n = D.next;
  return `
  <!-- dc: Building Bridges.dc.html › "Hero" -->
  <div class="mx-ink" style="position:relative;overflow:hidden">
    <img class="mx-hero-photo" src="/assets/photo-bridges.jpg" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 45%">
    <div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(25,21,18,.72) 0%,rgba(25,21,18,.55) 55%,rgba(25,21,18,.85) 100%)"></div>
    <div class="mx-pad-hero" style="position:relative;padding:54px 36px 44px;display:flex;flex-direction:column;align-items:center;text-align:center">
      <span style="padding:6px 12px;border:1px solid rgba(201,169,98,.7);color:#c9a962;font:600 10px Inter,sans-serif;letter-spacing:.18em">${n ? COPY.hero.eyebrow(esc(fmt.upper(n.city)), esc(fmt.upper(n.dateLabel))) : D.home ? COPY.hero.eyebrowHome : COPY.hero.eyebrowNone}</span>
      <div class="mx-display-46" style="font-family:Fraunces,serif;font-size:48px;line-height:1.1;color:#f7f1e6;margin-top:20px">${COPY.hero.title}</div>
      <div style="font-size:15px;color:rgba(247,241,230,.85);margin-top:10px;max-width:600px">${COPY.hero.lede(COPY.band.perEvening)}</div>
      ${n || D.home ? `
      <div style="display:flex;gap:13px;margin-top:26px;justify-content:center;flex-wrap:wrap">
        <a href="#bb-next" style="padding:13px 22px;background:#9b1b22;color:#f7f1e6;font:600 10.5px Inter,sans-serif;letter-spacing:.16em;white-space:nowrap" data-hover="background:#7e151b">${COPY.hero.register}</a>
      </div>` : ''}
      ${followToggle()}
    </div>
  </div>
  <!-- /dc -->`;
}

function blockBand() {
  const s = D.stats;
  const stat = (v, label, gold) => `<span style="display:flex;align-items:baseline;gap:6px"><span style="font-family:Fraunces,serif;font-size:24px${gold ? ';color:#c9a962' : ''}">${esc(v)}</span><span style="font:600 8.5px Inter,sans-serif;letter-spacing:.14em;color:rgba(247,241,230,.65)">${label}</span></span>`;
  const rule = '<span style="width:1px;height:18px;background:rgba(247,241,230,.25)"></span>';
  return `
  <!-- dc: Building Bridges.dc.html › "Stats band" -->
  <div class="mx-pad-band mx-bb-band" style="display:flex;align-items:center;justify-content:center;gap:26px;padding:13px 36px;background:#191512;color:#f7f1e6;flex-wrap:wrap">
    ${stat(s.cities, COPY.band.cities)}
    ${rule}
    ${stat(s.guests, COPY.band.guests)}
    ${rule}
    ${stat(s.events, COPY.band.events)}
    ${rule}
    ${stat(COPY.band.perEvening, COPY.band.per, true)}
  </div>
  <!-- /dc -->`;
}

function blockMission() {
  return `
    <!-- dc: Building Bridges.dc.html › "01 · THE MISSION" -->
    <div style="display:flex;align-items:baseline;gap:14px;padding:26px 0 10px">
      <span style="font-family:Fraunces,serif;font-weight:600;font-size:14px;color:#9b1b22">${COPY.mission.n}</span>
      <span style="font:600 14px Inter,sans-serif;letter-spacing:.14em">${COPY.mission.title}</span>
    </div>
    <div class="mx-grid-side" style="display:grid;grid-template-columns:1fr 340px;gap:44px;align-items:start;padding-bottom:20px">
      <div>
        <div style="font-size:13.5px;color:#4a4239;line-height:1.65">${COPY.mission.body}</div>
        <div class="mx-wrap-row" style="display:flex;align-items:baseline;gap:14px;padding:16px 0 8px"><span style="font:600 11px Inter,sans-serif;letter-spacing:.16em;color:#c9a962">${COPY.mission.whoLabel}</span><span style="font-size:12px;color:#4a4239">${COPY.mission.whoSub}</span></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${COPY.mission.chips.map(c => `<span style="padding:6px 11px;border:1px solid rgba(25,21,18,.22);font:600 9.5px Inter,sans-serif;letter-spacing:.14em">${c}</span>`).join('\n          ')}
        </div>
      </div>
      <div style="border-left:1px solid rgba(25,21,18,.16);padding-left:32px;display:flex;flex-direction:column;gap:11px">
        <span style="font:600 11px Inter,sans-serif;letter-spacing:.16em;color:#c9a962">${COPY.mission.bringsLabel}</span>
        ${COPY.mission.brings.map(b => `<span style="display:flex;gap:10px;align-items:baseline;font-size:13px"><span style="width:6px;height:6px;background:${b.gold ? '#c9a962' : '#9b1b22'};flex:none;align-self:center"></span>${b.text}</span>`).join('\n        ')}
      </div>
    </div>
    <!-- /dc -->`;
}

function registerButton() {
  const n = D.next;
  if (n.registered) return `<a href="/app/me" style="padding:11px 0;background:#9b1b22;color:#f7f1e6;font:600 10px Inter,sans-serif;letter-spacing:.16em;text-align:center;display:block;white-space:nowrap" data-hover="background:#7e151b">${COPY.next.registered}</a>`;
  // A full room is closed too: the chip beside the card already says FULLY BOOKED, so the button
  // must not open the form for a seat the server will refuse (audit 2026-09-17, item 1).
  if (n.spots === 0) return `<span data-act="regFull" aria-disabled="true" style="padding:11px 0;border:1px solid rgba(247,241,230,.35);color:rgba(247,241,230,.7);font:600 10px Inter,sans-serif;letter-spacing:.16em;cursor:default;white-space:nowrap">${COPY.next.full}</span>`;
  if (!n.open) return `<span data-act="regClosed" style="padding:11px 0;background:#9b1b22;font:600 10px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;white-space:nowrap" data-hover="background:#7e151b">${COPY.next.register}</span>`;
  return `<span data-act="register" style="padding:11px 0;background:#9b1b22;font:600 10px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;white-space:nowrap" data-hover="background:#7e151b">${COPY.next.register}</span>`;
}

function nextCard() {
  const n = D.next;
  // The confirmed edition carries its real photo (the Boston hero); any other event the admin adds
  // keeps the striped venue plate until it has a picture of its own.
  const plate = n.isNext
    ? `<div style="position:relative;overflow:hidden;min-height:150px"><img src="/assets/bb-boston-hero-wide.jpg" alt="${esc(COPY.next.cardTitle(n.city, n.year))}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block"></div>`
    : `<div style="position:relative;background:repeating-linear-gradient(45deg,rgba(25,21,18,.08) 0 10px,rgba(25,21,18,.03) 10px 20px);display:flex;align-items:center;justify-content:center;font:600 8.5px Inter,sans-serif;font-variant-numeric:tabular-nums;color:#4a4239;text-align:center;padding:0 14px">${esc(COPY.next.venueLabel(n.venue) || fmt.upper(n.city))}</div>`;
  return `<div data-block="next" data-eid="${esc(n.id)}" class="mx-bb-next" style="border:1px solid rgba(25,21,18,.16);background:#fdfaf3;display:grid;grid-template-columns:230px 1fr 260px;align-items:stretch">
      ${plate}
      <div style="padding:24px 28px;display:flex;flex-direction:column;gap:8px">
        <span style="font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#c9a962">${esc(fmt.upper(n.city))} · ${esc(fmt.upper(n.dateLabel))}</span>
        ${n.venue ? `<span style="font-size:12.5px;color:#4a4239">${esc(n.venue)}</span>` : ''}
        <span style="font-family:Fraunces,serif;font-size:26px;line-height:1.15">${esc(COPY.next.cardTitle(n.city, n.year))}</span>
        <span style="font-size:12.5px;color:#4a4239;line-height:1.55;max-width:520px">${esc((n.ev && n.ev.description) || COPY.next.desc(n.city))}</span>
        <span style="font-size:12.5px;color:#4a4239;line-height:1.55;max-width:520px">${COPY.next.goal}</span>
        <span style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">
          ${n.spots !== null ? `<span style="padding:4px 9px;border:1px solid rgba(201,169,98,.65);color:#6e5626;font:600 8.5px Inter,sans-serif;letter-spacing:.14em">${n.spots > 0 ? esc(COPY.next.spots(n.spots)) : COPY.next.full}</span>` : ''}
          <span style="padding:4px 9px;border:1px solid rgba(25,21,18,.22);color:#4a4239;font:600 8.5px Inter,sans-serif;letter-spacing:.14em">${COPY.next.chip2}</span>
        </span>
      </div>
      <div style="background:#191512;color:#f7f1e6;padding:22px 24px;display:flex;flex-direction:column;justify-content:center;gap:10px;text-align:center">
        <span style="font:600 9px Inter,sans-serif;letter-spacing:.18em;color:#c9a962">${COPY.next.starts}</span>
        <span style="display:flex;justify-content:center;gap:14px">
          ${['days', 'hrs', 'min'].map((k, i) => `<span style="display:flex;flex-direction:column"><span data-cd="${k}" style="font-family:Fraunces,serif;font-size:26px">—</span><span style="font:600 8px Inter,sans-serif;letter-spacing:.14em;color:rgba(247,241,230,.6)">${COPY.next.units[i]}</span></span>`).join('')}
        </span>
        ${registerButton()}
      </div>
    </div>`;
}

function homeCard() {
  const h = D.home, c = COPY.home;
  return `<div data-block="next" class="mx-bb-next" style="border:1px solid rgba(25,21,18,.16);background:#fdfaf3;display:grid;grid-template-columns:230px 1fr 260px;align-items:stretch">
      <div style="position:relative;overflow:hidden;min-height:150px"><img src="/assets/photo-stage.jpg" alt="Plexus Week in Zagreb" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 60%;display:block"></div>
      <div style="padding:24px 28px;display:flex;flex-direction:column;gap:8px">
        <span style="font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#c9a962">${esc(fmt.upper(h.city))} · ${esc(fmt.upper(h.dateLabel))}</span>
        ${h.venue ? `<span style="font-size:12.5px;color:#4a4239">${esc(h.venue)}</span>` : ''}
        <span style="font-family:Fraunces,serif;font-size:26px;line-height:1.15">${esc(c.title(h.year))}</span>
        <span style="font-size:12.5px;color:#4a4239;line-height:1.55;max-width:520px">${esc(c.desc)}</span>
        <span style="font-size:12.5px;color:#4a4239;line-height:1.55;max-width:520px">${esc(c.how)}</span>
        <span style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px"><span style="padding:4px 9px;border:1px solid rgba(201,169,98,.65);color:#6e5626;font:600 8.5px Inter,sans-serif;letter-spacing:.14em">${c.chip}</span></span>
      </div>
      <div style="background:#191512;color:#f7f1e6;padding:22px 24px;display:flex;flex-direction:column;justify-content:center;gap:12px;text-align:center">
        <span style="font:600 9px Inter,sans-serif;letter-spacing:.18em;color:#c9a962">${c.side}</span>
        <a href="/plexus?pick=bridges&amp;src=portal" style="padding:11px 0;background:#9b1b22;color:#f7f1e6;font:600 10px Inter,sans-serif;letter-spacing:.16em;white-space:nowrap;text-decoration:none" data-hover="background:#7e151b;color:#f7f1e6">${COPY.next.register}</a>
      </div>
    </div>`;
}

function blockNext() {
  const head = `
    <div id="bb-next" style="display:flex;align-items:baseline;gap:14px;padding:16px 0 12px;border-top:1px solid rgba(25,21,18,.16)">
      <span style="font-family:Fraunces,serif;font-weight:600;font-size:14px;color:#9b1b22">${COPY.next.n}</span>
      <span style="font:600 14px Inter,sans-serif;letter-spacing:.14em">${COPY.next.title}</span>
    </div>`;
  if (!D.next && D.home) return `${head}${homeCard()}`;
  if (!D.next) return `
    <!-- dc: Building Bridges.dc.html › "02 · NEXT EVENT" -->
    ${head}
    <div style="border:1px solid rgba(25,21,18,.16);background:#fdfaf3">
      <div class="empty">
        <span style="width:28px;height:1px;background:#c9a962;margin-bottom:6px"></span>
        <span style="font-family:Fraunces,serif;font-style:italic;font-size:17px">${COPY.next.emptyLine}</span>
        <span style="font-size:12.5px;color:#4a4239;max-width:400px;line-height:1.55">${COPY.next.emptyWhy}</span>
        <span data-act="tgFollow" style="margin-top:8px;padding:11px 20px;border:1px solid rgba(25,21,18,.3);font:600 10px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;color:#191512;white-space:nowrap" data-hover="border-color:#191512">${COPY.next.emptyCta}</span>
      </div>
    </div>
    <!-- /dc -->`;
  return `
    <!-- dc: Building Bridges.dc.html › "02 · NEXT EVENT" -->
    ${head}
    ${nextCard()}
    <!-- /dc -->`;
}

function editionCard(e, isLatest) {
  const first = Number(e.edition_no) === Math.min(...D.editions.map(x => Number(x.edition_no)));
  const photo = (Array.isArray(e.photos) && e.photos[0] && e.photos[0].url)
    ? `<span class="mx-ph"><img src="${esc(api.url(e.photos[0].url))}" alt="" style="width:100%;height:130px;object-fit:cover;display:block"></span>`
    : `<div style="height:130px;background:repeating-linear-gradient(45deg,rgba(25,21,18,.08) 0 10px,rgba(25,21,18,.03) 10px 20px);display:flex;align-items:center;justify-content:center;font:600 10px Inter,sans-serif;letter-spacing:.2em;color:#4a4239;text-align:center;padding:0 12px">${esc(COPY.been.photoLabel(e.city))}</div>`;
  // A figure nobody has entered is left out — never shown as a dash beside its label.
  const has = v => v !== null && v !== undefined && v !== '';
  const stat = (v, label) => has(v)
    ? `<span style="display:flex;align-items:baseline;gap:5px"><span style="font-family:Fraunces,serif;font-size:16px;color:#9b1b22">${esc(fmt.num(v))}</span><span style="font:600 8.5px Inter,sans-serif;letter-spacing:.13em;color:#4a4239">${label}</span></span>`
    : '';
  const stats = stat(e.guests, COPY.been.guests) + stat(e.connections, COPY.been.conns);
  return `
        <div data-act="gallery" data-id="${esc(e.id)}" aria-label="${esc(e.city)} photos" class="mx-card-link" style="border:1px solid rgba(25,21,18,.16);background:#fdfaf3;display:flex;flex-direction:column;cursor:pointer;text-align:left">
          ${photo}
          <div style="padding:14px 16px 16px;display:flex;flex-direction:column;gap:5px;flex:1">
            <span style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:#4a4239">${esc(COPY.been.edition(e.edition_no, isLatest, first))}</span>
            <span style="font-family:Fraunces,serif;font-size:19px;line-height:1.15">${esc(e.city)}</span>
            <span style="font-size:11.5px;color:#4a4239">${esc(e.venue || '')}</span>
            <span style="font-size:11.5px;color:#4a4239;line-height:1.5;font-style:italic">${esc(e.note || '')}</span>
            ${stats ? `<span style="display:flex;gap:14px;border-top:1px solid rgba(25,21,18,.1);padding-top:9px;margin-top:auto">${stats}</span>` : ''}
          </div>
        </div>`;
}

function blockBeen() {
  const maxNo = Math.max(...D.editions.map(x => Number(x.edition_no)));
  return `
    <!-- dc: Building Bridges.dc.html › "03 · WHERE WE'VE BEEN" -->
    <div id="bb-schedule" class="mx-wrap-row" style="display:flex;align-items:baseline;gap:14px;padding:26px 0 6px">
      <span style="font-family:Fraunces,serif;font-weight:600;font-size:14px;color:#9b1b22">${COPY.been.n}</span>
      <span style="font:600 14px Inter,sans-serif;letter-spacing:.14em">${COPY.been.title}</span>
      <span style="font-size:12px;color:#4a4239">${esc(COPY.been.sub(D.editions.length))}</span>
    </div>
    <div class="mx-grid-3 mx-bb-cities" style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;padding-bottom:26px">
      ${D.editions.map(e => editionCard(e, Number(e.edition_no) === maxNo)).join('')}
    </div>
    <!-- /dc -->`;
}

function blockFooter() {
  return `
  <!-- dc: Building Bridges.dc.html › "Questions" -->
  <div class="mx-gutter mx-wrap-row" style="display:flex;align-items:center;gap:20px;padding:18px 36px 30px;border-top:1px solid rgba(25,21,18,.16);flex-wrap:wrap">
    <span style="font-family:Fraunces,serif;font-style:italic;font-size:16px;color:#4a4239">${COPY.footer.line}</span>
    <span style="font-size:12px;color:#4a4239">${COPY.footer.sub}</span>
    <div style="flex:1"></div>
    <a href="/app/messages?about=bridges" style="padding:10px 16px;background:#9b1b22;color:#f7f1e6;font:600 10px Inter,sans-serif;letter-spacing:.16em;white-space:nowrap" data-hover="background:#7e151b;color:#f7f1e6">${COPY.footer.cta}</a>
  </div>
  <!-- /dc -->`;
}

function template() {
  return `
<div data-screen-label="Building Bridges" style="font-family:Inter,sans-serif;color:#191512;background:#f7f1e6;min-height:100vh">
  ${blockCrumb()}
  ${blockHero()}
  ${blockBand()}
  <div class="mx-gutter" style="padding:0 36px">
    ${blockMission()}
    ${blockNext()}
    ${blockBeen()}
  </div>
  ${blockFooter()}
</div>`;
}

// ---------------------------------------------------------------- behaviour
function field(name, label, value, type) {
  return `<div style="display:flex;flex-direction:column;gap:5px"><label class="label" for="bb-${name}">${label}</label><input class="input" id="bb-${name}" name="${name}" type="${type || 'text'}" value="${esc(value || '')}"></div>`;
}

function openRegisterModal() {
  const n = D.next, u = session.user || {};
  const body = `
    <form data-role="bbForm" style="display:flex;flex-direction:column;gap:12px">
      <p style="margin:0 0 2px;font-size:12.5px;color:#4a4239">${COPY.form.note}</p>
      <div class="mx-grid-2" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        ${field('first_name', COPY.form.first, u.first_name)}
        ${field('last_name', COPY.form.last, u.last_name)}
      </div>
      ${field('email', COPY.form.email, u.email, 'email')}
      ${field('institution', COPY.form.inst, u.institution)}
      ${field('title', COPY.form.role, u.title)}
      <div style="display:flex;flex-direction:column;gap:5px"><label class="label" for="bb-motivation">${COPY.form.motivation}</label><textarea class="input" id="bb-motivation" name="motivation" rows="2" style="resize:vertical;font-family:Inter,sans-serif"></textarea></div>
      <div data-role="bbError" style="display:none;font-size:12px;color:#9b1b22"></div>
      <button type="submit" style="display:none"></button>
    </form>`;
  const m = ui.modal({
    eyebrow: COPY.form.eyebrow(n.city), title: esc(COPY.form.title(n.city)), body,
    actions: [
      { label: COPY.form.cancel },
      { label: COPY.form.submit, kind: 'primary', onClick: () => { submitRegistration(m); return false; } }
    ]
  });
  openModal = m;
  m.onClose(() => { openModal = null; });
  const form = m.el.querySelector('[data-role="bbForm"]');
  if (form) form.addEventListener('submit', e => { e.preventDefault(); submitRegistration(m); });
  const first = m.el.querySelector('#bb-first_name');
  if (first) first.focus();
}

async function submitRegistration(m) {
  const n = D.next;
  const val = id => { const el = m.el.querySelector('#bb-' + id); return el ? el.value.trim() : ''; };
  const err = m.el.querySelector('[data-role="bbError"]');
  const showErr = t => { if (err) { err.style.display = 'block'; err.textContent = t; } };
  const first = val('first_name'), last = val('last_name'), email = val('email');
  if (!first || !last) return showErr(COPY.form.needName);
  if (!email || !email.includes('@')) return showErr(COPY.form.needEmail);
  const btn = m.el.querySelector('.mx-modal-foot [data-act="a1"]');
  if (btn) btn.setAttribute('aria-disabled', 'true');
  try {
    const r = await api.post(`/api/bridges/events/${encodeURIComponent(n.id)}/register`, {
      name: `${first} ${last}`, email, institution: val('institution'), title: val('title'), motivation: val('motivation')
    });
    m.close(); openModal = null;
    D.next.registered = true;
    const block = rootEl.querySelector('[data-block="next"]');
    if (block) block.outerHTML = nextCard();
    timers.forEach(stop => { try { stop(); } catch (e2) {} }); timers = [];
    startCountdown(); // re-tick immediately so the re-rendered cells never sit on "—"
    ui.toast(r && r.already_registered ? COPY.form.already(n.city) : COPY.form.done(n.city));
    chrome.refresh();
  } catch (e) {
    if (btn) btn.removeAttribute('aria-disabled');
    showErr(e.message);
    ui.toast(e.message, { kind: 'error' });
  }
}

const handlers = {
  // flips in place at once (ui.toggleSwitch) — the POST runs behind it and a failure flips it back.
  // The empty-state "GET UPDATES" button shares this act; it is not a switch, so it keeps the old path.
  tgFollow: async (el) => {
    const paint = on => { const l = rootEl && rootEl.querySelector('[data-block="follow"] [data-role="follow-label"]'); if (l) l.innerHTML = COPY.hero.follow(on); };
    const save = async on => {
      await api.post('/api/notify-topics', { project: 'bridges', on });
      if (st) st.follow = on;
      ui.toast(on ? COPY.followed : COPY.unfollowed);
      chrome.refresh();
    };
    if (el.getAttribute('role') === 'switch') return ui.toggleSwitch(el, save, paint);
    const sw = rootEl && rootEl.querySelector('[data-block="follow"] [role="switch"]');
    if (sw) return ui.toggleSwitch(sw, save, paint);
    el.setAttribute('aria-disabled', 'true');
    try { await save(!st.follow); } catch (e) { ui.toast(e.message, { kind: 'error' }); }
    el.removeAttribute('aria-disabled');
  },
  register: () => { if (D.next) openRegisterModal(); },
  regClosed: () => ui.toast(COPY.next.closed),
  regFull: () => ui.toast(COPY.next.fullToast),
  gallery: (el) => {
    const e = D.editions.find(x => String(x.id) === el.dataset.id);
    if (!e) return;
    if (!Array.isArray(e.photos) || !e.photos.length) return ui.toast(COPY.been.gallerySoon(e.city));
    openModal = ui.modal({
      eyebrow: COPY.been.galleryEyebrow(e.city), title: esc(COPY.been.galleryTitle(e.city)),
      // one photo takes the full width (it sat at half width beside an empty column)
      body: `<div style="display:grid;grid-template-columns:${e.photos.length === 1 ? '1fr' : '1fr 1fr'};gap:10px">${e.photos.map(p => `
        <figure style="margin:0">
          <img src="${esc(api.url(p.url))}" alt="${esc(p.caption || e.city)}" style="width:100%;height:${e.photos.length === 1 ? '260px' : '150px'};object-fit:cover;display:block">
          ${p.caption ? `<figcaption style="font-size:11px;color:#4a4239;margin-top:4px">${esc(p.caption)}</figcaption>` : ''}
        </figure>`).join('')}</div>`,
      actions: [{ label: COPY.been.close }]
    });
    openModal.onClose(() => { openModal = null; });
  }
};

function startCountdown() {
  if (!D.next) return;
  timers.push(ui.countdown(D.next.startAt, ({ days, hrs, min }) => {
    const set = (k, v) => ui.tick(rootEl && rootEl.querySelector(`[data-cd="${k}"]`), v);
    set('days', days); set('hrs', hrs); set('min', min);
  }, 30000));
}

export default {
  title: 'Building Bridges',
  reveal: true,        // sections below the fold rise in on scroll (router › ui.revealOnScroll)
  async render(root, ctx) {
    ensureCss();
    rootEl = root;
    D = await load();
    if (rootEl !== root || (ctx.ready && !(await ctx.ready()))) return; // navigated away while loading, or the router moved on
    st = { follow: D.follow };
    root.innerHTML = template();
    unbind = ui.bind(root, handlers);
    startCountdown();
    chrome.refresh();
  },
  destroy() {
    timers.forEach(stop => { try { stop(); } catch (e) {} }); timers = [];
    if (unbind) unbind(); unbind = null;
    if (openModal) { try { openModal.close(); } catch (e) {} openModal = null; }
    rootEl = null; D = null; st = null;
  }
};
