// Source: Building Bridges.dc.html, redrawn to the phone calm rules (DESIGN-RULES.md) and the Glass Quiet pass
// (GLASS-RULES.md 2026-09-25: say less, let the photo speak).
// Blocks, top to bottom: "Breadcrumb" (desktop) › "Hero" (title · one line · ONE action) › "Stats" (three tiles) ›
// the mission (one statement + what every evening brings, values only) › "Next event" (one card, its register
// button the card's one action) › "Event app" + "Updates" rows › "Past editions" (a shelf) › "Message us".
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

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ---- COPY: every string that may change in a revision (dates/venues via FACTS/API) ----
export const COPY = {
  crumb: { left: 'PROJECTS', right: 'BUILDING BRIDGES' },
  liveRow: { title: 'Event app' },
  hero: {
    title: 'Building <i>Bridges</i>',
    // the one line on the photo: where and when. The Zagreb evening has no date of its own yet (the Plexus Week
    // block's date_label is empty), so it says when in words; a date entered in the admin portal replaces them.
    line: (city, when) => `${city} · ${when}`,
    homeWhen: 'during Plexus Week',
    register: `${CTA.register} →`
  },
  band: { cities: 'Cities', guests: 'Guests', per: 'Per evening', perEvening: '40–50' },
  mission: {
    line: 'Evenings that connect Croatian biomedicine abroad with the <i>community at home</i>.',
    brings: [
      { icon: 'mic', v: 'Keynotes' },
      { icon: 'users', v: 'Structured networking' },
      { icon: 'star', v: 'Prestigious venues' },
      { icon: 'user', v: 'Open to everyone' }
    ]
  },
  // the frozen register label already says FREE, so the card prints no second price line (GLASS-RULES Q7)
  home: {
    title: year => `Building Bridges — Zagreb ${year}`
  },
  next: {
    title: 'Next event',
    cardTitle: (city, year) => `Building Bridges — ${city} ${year}`,
    spots: n => `Only ${n} spots`, full: 'FULLY BOOKED',
    register: `${CTA.register} →`, registered: 'REGISTERED ✓ · MY TICKET →',
    closed: 'Registration opens soon — follow Building Bridges above and we tell you first.',
    fullToast: 'This evening is fully booked — follow Building Bridges above and we tell you if a seat opens.',
    emptyLine: 'The next evening is being planned.',
    emptyCta: 'Get updates'
  },
  follow: { title: 'Updates' },
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
    title: 'Past editions',
    gallerySoon: city => `Photos from the ${city} evening are being added — check back soon.`,
    galleryEyebrow: city => `BUILDING BRIDGES · ${city.toUpperCase()}`,
    galleryTitle: city => `The ${city} evening`, close: 'CLOSE'
  },
  followed: 'You follow Building Bridges — updates reach your inbox and alerts.',
  unfollowed: 'Building Bridges updates are off.',
  footer: { ask: 'Message us' }
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
    // the hero's one line: "Mon 21 Sep · 18:00" (the confirmed edition's time is the one FACTS prints everywhere)
    const d = fmt.toDate(date);
    const time = ((isNext ? f.label : String(nextEv.event_time || '')).match(/\d{1,2}:\d{2}/) || [''])[0];
    next = {
      ev: nextEv, id: nextEv.id, city: nextEv.city || f.city, date, isNext,
      year: date.slice(0, 4),
      dateLabel: isNext ? f.label : fmt.longRange(date),
      heroWhen: d ? `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${d.getDate()} ${MON[d.getMonth()]}${time ? ' · ' + time : ''}` : fmt.longRange(date),
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
      dateLabel: hb.date_label || '', venue };
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
function sectionHead(title, right) {
  return `<div class="mx-sh"><h2 class="mx-sh-t">${title}</h2>${right || ''}</div>`;
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
  return `<a href="/app/live" class="mx-row" data-v2="Plexus Week Live — the event app (docs/EVENT-APP-BRIEF.md)">${icon('sparkle')}<span class="mx-row-l">${COPY.liveRow.title}</span>${chev()}</a>`;
}

// the switch shows the state (GLASS-RULES Q5): one row, "Updates"
function followToggle() {
  return `<div class="mx-row" data-block="follow">${icon('bell')}<span class="mx-row-l">${COPY.follow.title}</span><span data-act="tgFollow" role="switch" aria-checked="${st.follow}" aria-label="Get updates from Building Bridges" class="mx-switch"><span></span></span></div>`;
}

// GLASS-RULES Q1: title · one line (where and when) · ONE action (the same #bb-next link as before). No eyebrow.
function blockHero() {
  const n = D.next;
  const date = n ? COPY.hero.line(n.city, n.heroWhen) : D.home ? COPY.hero.line(D.home.city, D.home.dateLabel || COPY.hero.homeWhen) : '';
  return `
  <!-- dc: Building Bridges.dc.html › "Hero" -->
  <section class="mx-hero mx-ink mx-bb-hero">
    <img class="mx-hero-photo" src="/assets/photo-bridges.jpg" alt="" style="object-position:62% 50%">
    <div class="mx-scrim"></div>
    <div class="mx-hero-body">
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

// three tiles: the evenings tile went (the same five as the cities)
function blockStats() {
  const s = D.stats;
  const tile = (v, label) => `<div class="mx-tile"><span class="mx-tile-n">${esc(v)}</span><span class="mx-tile-l">${label}</span></div>`;
  return `
  <!-- dc: Building Bridges.dc.html › "Stats band" -->
  <section class="mx-sec mx-sec--tight" data-block="stats">
    <div class="mx-tiles mx-tiles--3">
      ${tile(s.cities, COPY.band.cities)}${tile(s.guests, COPY.band.guests)}${tile(COPY.band.perEvening, COPY.band.per)}
    </div>
  </section>
  <!-- /dc -->`;
}

function blockMission() {
  return `
  <!-- dc: Building Bridges.dc.html › "THE MISSION" (the statement needs no head) -->
  <section class="mx-sec" data-block="mission">
    <p class="mx-bb-statement">${COPY.mission.line}</p>
    <ul class="mx-facts">${COPY.mission.brings.map(b => fact({ ic: b.icon, v: b.v })).join('')}</ul>
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

// One card: the title, the venue when it is known (the hero line holds the date) and the register button.
// The confirmed edition carries its real photo (the Boston hero); any other city gets the ink tile with the X
// until it has a picture of its own. A seat count is a state the member acts on: a glass tag on the photo.
function nextCard() {
  const n = D.next;
  const media = n.isNext
    ? `<img src="/assets/bb-boston-hero-wide.jpg" alt="" loading="lazy">`
    : `<img class="mx-media-mark" src="/assets/mark-x.png" alt="">`;
  const tag = n.spots ? `<span class="mx-tag mx-tag--glass">${esc(COPY.next.spots(n.spots))}</span>` : '';
  return `<article data-block="next" data-eid="${esc(n.id)}" class="mx-pcard mx-bb-card">
      <div class="mx-media r-16x9">${media}<div class="mx-scrim"></div>${tag}<h3 class="mx-pcard-title">${esc(COPY.next.cardTitle(n.city, n.year))}</h3></div>
      <div class="mx-pcard-body">
        ${n.venue ? `<ul class="mx-facts mx-bb-cardfacts">${fact({ ic: 'pin', v: esc(n.venue) })}</ul>` : ''}
        ${registerButton()}
      </div>
    </article>`;
}

function homeCard() {
  const h = D.home, c = COPY.home;
  return `<article data-block="next" class="mx-pcard mx-bb-card">
      <div class="mx-media r-16x9"><img src="/assets/photo-stage.jpg" alt="Plexus Week in Zagreb" loading="lazy" style="object-position:88% 50%"><div class="mx-scrim"></div><h3 class="mx-pcard-title">${esc(c.title(h.year))}</h3></div>
      <div class="mx-pcard-body">
        ${h.venue ? `<ul class="mx-facts mx-bb-cardfacts">${fact({ ic: 'pin', v: esc(h.venue) })}</ul>` : ''}
        <a href="/plexus?pick=bridges&amp;src=portal" class="btn-primary btn-block">${COPY.next.register}</a>
      </div>
    </article>`;
}

function blockNext() {
  const head = sectionHead(COPY.next.title);
  const body = D.next ? nextCard() : D.home ? homeCard() : `
    <div class="empty">
      <span class="empty-line">${COPY.next.emptyLine}</span>
      <span data-act="tgFollow" role="button" class="btn-ghost btn-sm">${COPY.next.emptyCta}</span>
    </div>`;
  return `
  <!-- dc: Building Bridges.dc.html › "NEXT EVENT" -->
  <section class="mx-sec" id="bb-next" data-block="next-sec">
    ${head}
    ${body}
    <div class="mx-list mx-bb-rows">${blockEventApp()}${followToggle()}</div>
  </section>
  <!-- /dc -->`;
}

// a card: the photo, the city and the venue
function editionCard(e) {
  const own = Array.isArray(e.photos) && e.photos[0] && e.photos[0].url;
  // Boston has its real photo in the bundle; any edition without one is the ink tile with the X — never a striped wireframe
  const src = own ? api.url(e.photos[0].url) : (/boston/i.test(String(e.city || '')) ? '/assets/bb-boston-hero-wide.jpg' : '');
  const media = src ? `<img src="${esc(src)}" alt="" loading="lazy">` : `<img class="mx-media-mark" src="/assets/mark-x.png" alt="">`;
  return `
      <div class="mx-shelf-item mx-bb-edition" data-act="gallery" data-id="${esc(e.id)}" role="button" aria-label="${esc(e.city)} photos">
        <div class="mx-media r-4x3 mx-ph">${media}</div>
        <span class="mx-shelf-title">${esc(e.city)}</span>
        ${e.venue ? `<span class="mx-shelf-sub">${esc(e.venue)}</span>` : ''}
      </div>`;
}

function blockBeen() {
  return `
  <!-- dc: Building Bridges.dc.html › "WHERE WE'VE BEEN" -->
  <section class="mx-sec" id="bb-schedule" data-block="been">
    ${sectionHead(COPY.been.title)}
    <div class="mx-shelf mx-bb-shelf" style="--w:200px">
      ${D.editions.map(editionCard).join('')}
    </div>
  </section>
  <!-- /dc -->`;
}

function blockFooter() {
  return `
  <!-- dc: Building Bridges.dc.html › "Questions" -->
  <section class="mx-sec">
    <div class="mx-list"><a class="mx-row" href="/app/messages?about=bridges">${icon('mail')}<span class="mx-row-l">${COPY.footer.ask}</span>${chev()}</a></div>
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
    ui.toast(r && r.already_registered ? COPY.form.already(n.city) : COPY.form.done(n.city));
    chrome.refresh();
  } catch (e) {
    if (btn) btn.removeAttribute('aria-disabled');
    showErr(e.message);
    ui.toast(e.message, { kind: 'error' });
  }
}

const handlers = {
  // flips in place at once (ui.toggleSwitch) — the POST runs behind it and a failure flips it back; the switch
  // shows the state. The empty-state "GET UPDATES" button shares this act; it is not a switch, so it flips the row's.
  tgFollow: async (el) => {
    const save = async on => {
      await api.post('/api/notify-topics', { project: 'bridges', on });
      if (st) st.follow = on;
      ui.toast(on ? COPY.followed : COPY.unfollowed);
      chrome.refresh();
    };
    if (el.getAttribute('role') === 'switch') return ui.toggleSwitch(el, save);
    const sw = rootEl && rootEl.querySelector('[data-block="follow"] [role="switch"]');
    if (sw) return ui.toggleSwitch(sw, save);
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
    chrome.refresh();
  },
  destroy() {
    timers.forEach(stop => { try { stop(); } catch (e) {} }); timers = [];
    if (unbind) unbind(); unbind = null;
    if (openModal) { try { openModal.close(); } catch (e) {} openModal = null; }
    rootEl = null; D = null; st = null;
  }
};
