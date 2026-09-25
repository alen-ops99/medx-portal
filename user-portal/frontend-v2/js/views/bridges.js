// Source: Building Bridges.dc.html, redrawn to the phone calm rules (DESIGN-RULES.md 2026-09-25).
// Blocks, top to bottom: "Breadcrumb" (desktop) › "Hero" (eyebrow · title · date · ONE action) › "Stats" (2×2 tiles) ›
// "01 · The mission" (one statement + what every evening brings, as facts) › "02 · Next event" (one card, its
// register button the card's one action) › "Event app" + "Updates" rows › "03 · Where we've been" (a shelf) ›
// "Message us".
// Data: next event = the soonest upcoming published row of GET /api/bridges/events (admin-run
// table; REGISTER posts to /api/bridges/events/:id/register — open to every signed-in member, no
// application); past-edition recap cards (admin-editable guests / new-connections + photo
// galleries) from GET /api/v2/bridges/editions (backend/v2/bridges.js); follow via /api/notify-topics.
// Boston reads from FACTS.bridges.next (UX audit 2026-09-02 item 1) — one date, one time, one room everywhere.
// FROZEN (DESIGN-RULES §8): the register controls (hero link, the button function and the Plexus Week form link)
// keep every href, data-act and handler; only their look and place changed.
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
  liveRow: { title: 'Event app', sub: 'Program and your schedule' },
  hero: {
    eyebrow: city => `Next edition · ${city}`,
    eyebrowNone: 'Building Bridges in Biomedicine',
    eyebrowHome: 'Zagreb · Plexus Week',
    title: 'Building <i>Bridges</i>',
    homeDate: 'During Plexus Week · December',
    register: `${CTA.register} →`
  },
  band: { cities: 'Cities', guests: 'Guests hosted', events: 'Evenings', per: 'Per evening', perEvening: '40–50' },
  mission: {
    n: '01', title: 'The mission',
    line: 'Evenings that connect Croatian biomedicine abroad with the <i>community at home</i>.',
    brings: [
      { icon: 'mic', v: 'Keynotes', s: 'From the host city’s leading institutions' },
      { icon: 'users', v: 'Structured networking', s: 'Professionally facilitated' },
      { icon: 'star', v: 'Prestigious venues', s: 'Dinner and drinks' },
      { icon: 'user', v: 'Open to everyone', s: 'Researchers, physicians, leaders in biomedicine' }
    ]
  },
  home: {
    title: year => `Building Bridges — Zagreb ${year}`,
    desc: 'Croatian medicine and science, and the colleagues who work abroad, in one room.',
    how: 'Free · one Plexus Week form for every evening', tag: 'Part of Plexus Week'
  },
  next: {
    n: '02', title: 'Next event',
    cardTitle: (city, year) => `Building Bridges — ${city} ${year}`,
    // Generic line for any city the admin adds; the confirmed edition prints the admin's own description
    desc: city => `The Croatian biomedical community of greater ${city}, with colleagues at the city's leading institutions.`,
    spots: n => `Only ${n} spots`, full: 'FULLY BOOKED', fullTag: 'Fully booked',
    starts: 'Starts in', units: ['days', 'hours', 'min'],
    register: `${CTA.register} →`, registered: 'REGISTERED ✓ · MY TICKET →',
    closed: 'Registration opens soon — follow Building Bridges above and we tell you first.',
    fullToast: 'This evening is fully booked — follow Building Bridges above and we tell you if a seat opens.',
    emptyLine: 'The next evening is being planned.',
    emptyWhy: 'Follow Building Bridges and hear the moment the next city is confirmed.',
    emptyCta: 'Get updates'
  },
  follow: { title: 'Building Bridges updates', sub: on => on ? 'On · email and portal alerts' : 'Off · email and portal alerts' },
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
    n: '03', title: "Where we've been",
    sub: n => `${NUM_WORDS[n] || n} evenings so far`,
    edition: (no, isLatest, isFirst) => `Edition ${String(no).padStart(2, '0')}${isLatest ? ' · most recent' : isFirst ? ' · the first' : ''}`,
    guests: n => `${n} guests`,
    gallerySoon: city => `Photos from the ${city} evening are being added — check back soon.`,
    galleryEyebrow: city => `BUILDING BRIDGES · ${city.toUpperCase()}`,
    galleryTitle: city => `The ${city} evening`, close: 'CLOSE'
  },
  followed: 'You follow Building Bridges — updates reach your inbox and alerts.',
  unfollowed: 'Building Bridges updates are off.',
  footer: { ask: 'Message us', sub: 'Building Bridges in your city' }
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
    // guests/connections stay null on purpose: the card hides a figure nobody has entered (audit C5)
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
  // evening (registration = the Plexus Week form with Bridges ticked).
  let home = null;
  const hb = !next && r.week && Array.isArray(r.week.blocks) ? r.week.blocks.find(b => b && b.key === 'bridges') : null;
  if (hb && hb.status_kind === 'open') {
    const venue = hb.venue && !/to be announced/i.test(hb.venue) ? hb.venue : '';
    home = { city: r.week.city || 'Zagreb', year: String((r.week.date_label || '').match(/\d{4}/) || FACTS.year),
      dateLabel: hb.date_label || COPY.hero.homeDate, venue };
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

// ---------------------------------------------------------------- kit helpers
const icon = (n, s) => ui.icon(n, s || 20);
const chev = () => ui.icon('chevron-right', 18);
function sectionHead(n, title, right) {
  return `<div class="mx-sh">${n ? `<span class="mx-sh-n">${n}</span>` : ''}<h2 class="mx-sh-t">${title}</h2>${right || ''}</div>`;
}
function fact({ ic, v, s }) {
  return `<li class="mx-fact">${icon(ic)}<div class="mx-fact-body"><span class="mx-fact-v">${v}</span>${s ? `<span class="mx-fact-s">${s}</span>` : ''}</div></li>`;
}

// ---------------------------------------------------------------- blocks
function blockCrumb() {
  return `
  <!-- dc: Building Bridges.dc.html › "Breadcrumb" (desktop; phones carry back in the top bar) -->
  <div class="mx-crumbs mx-gutter" style="display:flex;align-items:center;gap:13px;padding:10px 36px;border-bottom:1px solid rgba(25,21,18,.16)">
    <a href="/app/projects" data-dir="back" style="font:600 12px Inter,sans-serif;letter-spacing:.12em;color:#4a4239" data-hover="color:#191512">${COPY.crumb.left}</a>
    <span style="color:rgba(25,21,18,.35);font-size:12px">→</span>
    <span style="font:600 12px Inter,sans-serif;letter-spacing:.12em;color:#191512">${COPY.crumb.right}</span>
  </div>
  <!-- /dc -->`;
}

// The event app (Plexus Week Live) — it lived in the breadcrumb row, which phones no longer show: now a row of its
// own under the next event, on every width.
function blockEventApp() {
  return `<a href="/app/live" class="mx-row" data-v2="Plexus Week Live — the event app (docs/EVENT-APP-BRIEF.md)" aria-label="${esc(COPY.live.replace(' →', ''))}">${icon('sparkle')}<span class="mx-row-l">${COPY.liveRow.title}<span class="mx-row-s">${COPY.liveRow.sub}</span></span>${chev()}</a>`;
}

function followToggle() {
  return `<div class="mx-row" data-block="follow">${icon('bell')}<span class="mx-row-l">${COPY.follow.title}<span class="mx-row-s" data-role="follow-label">${COPY.follow.sub(st.follow)}</span></span><span data-act="tgFollow" role="switch" aria-checked="${st.follow}" aria-label="Get updates from Building Bridges" class="mx-switch"><span></span></span></div>`;
}

// §6: eyebrow · title · one date line · ONE action (the same #bb-next link as before)
function blockHero() {
  const n = D.next;
  const eyebrow = n ? COPY.hero.eyebrow(esc(n.city)) : D.home ? COPY.hero.eyebrowHome : COPY.hero.eyebrowNone;
  const date = n ? n.dateLabel : D.home ? (D.home.dateLabel || COPY.hero.homeDate) : '';
  return `
  <!-- dc: Building Bridges.dc.html › "Hero" -->
  <section class="mx-hero mx-ink mx-bb-hero">
    <img class="mx-hero-photo" src="/assets/photo-bridges.jpg" alt="" style="object-position:62% 50%">
    <div class="mx-scrim"></div>
    <div class="mx-hero-body">
      <span class="mx-hero-eyebrow">${eyebrow}</span>
      <h1 class="mx-hero-title">${COPY.hero.title}</h1>
      ${date ? `<p class="mx-hero-date">${esc(date)}</p>` : ''}
      ${n || D.home ? `
      <div class="mx-hero-cta">
        <a href="#bb-next" class="btn-gold btn-block">${COPY.hero.register}</a>
      </div>` : ''}
    </div>
  </section>
  <!-- /dc -->`;
}

function blockStats() {
  const s = D.stats;
  const tile = (v, label) => `<div class="mx-tile"><span class="mx-tile-n">${esc(v)}</span><span class="mx-tile-l">${label}</span></div>`;
  return `
  <!-- dc: Building Bridges.dc.html › "Stats band" -->
  <section class="mx-sec mx-sec--tight" data-block="stats">
    <div class="mx-tiles">
      ${tile(s.cities, COPY.band.cities)}${tile(s.guests, COPY.band.guests)}${tile(s.events, COPY.band.events)}${tile(COPY.band.perEvening, COPY.band.per)}
    </div>
  </section>
  <!-- /dc -->`;
}

function blockMission() {
  return `
  <!-- dc: Building Bridges.dc.html › "01 · THE MISSION" -->
  <section class="mx-sec" data-block="mission">
    ${sectionHead(COPY.mission.n, COPY.mission.title)}
    <p class="mx-bb-statement">${COPY.mission.line}</p>
    <ul class="mx-facts">${COPY.mission.brings.map(b => fact({ ic: b.icon, v: b.v, s: b.s })).join('')}</ul>
  </section>
  <!-- /dc -->`;
}

// FROZEN: every href and data-act here is the one the card had; the look is the house button
function registerButton() {
  const n = D.next;
  if (n.registered) return `<a href="/app/me" class="btn-primary btn-block">${COPY.next.registered}</a>`;
  // A full room is closed too: the tag on the card already says fully booked, so the button
  // must not open the form for a seat the server will refuse (audit 2026-09-17, item 1).
  if (n.spots === 0) return `<span data-act="regFull" aria-disabled="true" class="btn-ghost btn-block">${COPY.next.full}</span>`;
  if (!n.open) return `<span data-act="regClosed" role="button" class="btn-primary btn-block">${COPY.next.register}</span>`;
  return `<span data-act="register" role="button" class="btn-primary btn-block">${COPY.next.register}</span>`;
}

function nextCard() {
  const n = D.next;
  // The confirmed edition carries its real photo (the Boston hero); any other city gets the ink tile with the X
  // until it has a picture of its own.
  const media = n.isNext
    ? `<img src="/assets/bb-boston-hero-wide.jpg" alt="" loading="lazy">`
    : `<img class="mx-media-mark" src="/assets/mark-x.png" alt="">`;
  const tag = n.spots !== null ? `<span class="mx-tag ${n.spots > 0 ? 'mx-tag--gold' : 'mx-tag--cream'}">${esc(n.spots > 0 ? COPY.next.spots(n.spots) : COPY.next.fullTag)}</span>` : '';
  const cell = (id, unit) => `<span class="mx-cd-cell"><b class="mx-cd-num" data-cd="${id}">—</b><i class="mx-cd-unit">${unit}</i></span>`;
  return `<article data-block="next" data-eid="${esc(n.id)}" class="mx-pcard mx-bb-card">
      <div class="mx-media r-16x9">${media}<div class="mx-scrim"></div>${tag}<h3 class="mx-pcard-title">${esc(COPY.next.cardTitle(n.city, n.year))}</h3></div>
      <div class="mx-pcard-body">
        <ul class="mx-facts mx-bb-cardfacts">
          ${fact({ ic: 'calendar', v: esc(n.dateLabel) })}
          ${n.venue ? fact({ ic: 'pin', v: esc(n.venue) }) : ''}
        </ul>
        <p class="mx-pcard-line">${esc((n.ev && n.ev.description) || COPY.next.desc(n.city))}</p>
        <div class="mx-countdown mx-countdown--line mx-bb-cd"><span class="mx-cd-label">${COPY.next.starts}</span>${cell('days', COPY.next.units[0])}${cell('hrs', COPY.next.units[1])}${cell('min', COPY.next.units[2])}</div>
        ${registerButton()}
      </div>
    </article>`;
}

function homeCard() {
  const h = D.home, c = COPY.home;
  return `<article data-block="next" class="mx-pcard mx-bb-card">
      <div class="mx-media r-16x9"><img src="/assets/photo-stage.jpg" alt="Plexus Week in Zagreb" loading="lazy" style="object-position:88% 50%"><div class="mx-scrim"></div><span class="mx-tag mx-tag--gold">${c.tag}</span><h3 class="mx-pcard-title">${esc(c.title(h.year))}</h3></div>
      <div class="mx-pcard-body">
        <ul class="mx-facts mx-bb-cardfacts">
          ${fact({ ic: 'calendar', v: esc(h.dateLabel) })}
          ${h.venue ? fact({ ic: 'pin', v: esc(h.venue) }) : ''}
        </ul>
        <p class="mx-pcard-line">${esc(c.desc)}</p>
        <a href="/plexus?pick=bridges&amp;src=portal" class="btn-primary btn-block">${COPY.next.register}</a>
        <span class="mx-bb-how">${esc(c.how)}</span>
      </div>
    </article>`;
}

function blockNext() {
  const head = sectionHead(COPY.next.n, COPY.next.title);
  const body = D.next ? nextCard() : D.home ? homeCard() : `
    <div class="empty">
      <span class="empty-line">${COPY.next.emptyLine}</span>
      <span class="empty-why">${COPY.next.emptyWhy}</span>
      <span data-act="tgFollow" role="button" class="btn-ghost btn-sm">${COPY.next.emptyCta}</span>
    </div>`;
  return `
  <!-- dc: Building Bridges.dc.html › "02 · NEXT EVENT" -->
  <section class="mx-sec" id="bb-next" data-block="next-sec">
    ${head}
    ${body}
    <div class="mx-list mx-bb-rows">${blockEventApp()}${followToggle()}</div>
  </section>
  <!-- /dc -->`;
}

function editionCard(e, isLatest) {
  const first = Number(e.edition_no) === Math.min(...D.editions.map(x => Number(x.edition_no)));
  const own = Array.isArray(e.photos) && e.photos[0] && e.photos[0].url;
  // Boston has its real photo in the bundle; any edition without one is the ink tile with the X — never a striped wireframe
  const src = own ? api.url(e.photos[0].url) : (/boston/i.test(String(e.city || '')) ? '/assets/bb-boston-hero-wide.jpg' : '');
  const media = src ? `<img src="${esc(src)}" alt="" loading="lazy">` : `<img class="mx-media-mark" src="/assets/mark-x.png" alt="">`;
  const has = v => v !== null && v !== undefined && v !== '';
  const sub = [e.venue || '', has(e.guests) ? COPY.been.guests(fmt.num(e.guests)) : ''].filter(Boolean).join(' · ');
  return `
      <div class="mx-shelf-item mx-bb-edition" data-act="gallery" data-id="${esc(e.id)}" role="button" aria-label="${esc(e.city)} photos">
        <div class="mx-media r-4x3 mx-ph">${media}</div>
        <span class="mx-bb-ed-label">${esc(COPY.been.edition(e.edition_no, isLatest, first))}</span>
        <span class="mx-shelf-title">${esc(e.city)}</span>
        ${sub ? `<span class="mx-shelf-sub">${esc(sub)}</span>` : ''}
      </div>`;
}

function blockBeen() {
  const maxNo = Math.max(...D.editions.map(x => Number(x.edition_no)));
  return `
  <!-- dc: Building Bridges.dc.html › "03 · WHERE WE'VE BEEN" -->
  <section class="mx-sec" id="bb-schedule" data-block="been">
    ${sectionHead(COPY.been.n, COPY.been.title)}
    <p class="mx-sh-sub">${esc(COPY.been.sub(D.editions.length))}</p>
    <div class="mx-shelf mx-bb-shelf" style="--w:200px">
      ${D.editions.map(e => editionCard(e, Number(e.edition_no) === maxNo)).join('')}
    </div>
  </section>
  <!-- /dc -->`;
}

function blockFooter() {
  return `
  <!-- dc: Building Bridges.dc.html › "Questions" -->
  <section class="mx-sec">
    <div class="mx-list"><a class="mx-row" href="/app/messages?about=bridges">${icon('mail')}<span class="mx-row-l">${COPY.footer.ask}<span class="mx-row-s">${COPY.footer.sub}</span></span>${chev()}</a></div>
  </section>
  <!-- /dc -->`;
}

function template() {
  return `
<div data-screen-label="Building Bridges" class="mx-bb">
  ${blockCrumb()}
  ${blockHero()}
  <div class="mx-p">
    ${blockStats()}
    ${blockMission()}
    ${blockNext()}
    ${blockBeen()}
    ${blockFooter()}
  </div>
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
    const paint = on => { const l = rootEl && rootEl.querySelector('[data-block="follow"] [data-role="follow-label"]'); if (l) l.innerHTML = COPY.follow.sub(on); };
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
          ${p.caption ? `<figcaption style="font-size:12px;color:#4a4239;margin-top:4px">${esc(p.caption)}</figcaption>` : ''}
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
