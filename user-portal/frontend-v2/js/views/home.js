// Source: Med&X Home.dc.html
// Blocks (artboard order): "YOUR NEXT EVENT" (hero + GETTING STARTED card) › "NEXT EVENT"
// (ink countdown band) › "01 · OUR PROJECTS" › "02 · LATEST FROM MED&X" (+ "KEY DATES") ›
// "MED&X NEWSLETTER" › "FROM THE FORUM" › "03 · GROW YOUR NETWORK".
// The chrome (top bar, stats strip, banner, drawer) is NOT in this file — js/chrome.js.
// Data: every number/label is a live read (see load()); FACTS only fills gaps and wording.
import { api } from '../api.js';
import { session, state } from '../state.js';
import { ui, esc, fmt } from '../ui.js';
import { FACTS, routeFor, CTA, trueDateFor, reconcileEarlyBird, galaPriceNow } from '../facts.js';
import { chrome } from '../chrome.js';
import { profileCompletion } from '../member.js';
import router from '../router.js';

export const SOURCE = 'Med&X Home.dc.html';

// ---- COPY: every string that may change in a revision lives here (dates/prices via FACTS) ----
export const COPY = {
  hero: {
    eyebrow: 'YOUR NEXT EVENT',
    greetings: ['Good morning', 'Good afternoon', 'Good evening'],   // time-of-day; text easter eggs removed by decision
    open: (name, city) => `${name} is open for registration — two days in ${city}, this December. Discover what's next.`,
    soon: (name, city) => `${name} opens for registration soon — two days in ${city}, this December. Discover what's next.`,
    // UX audit 2026-09-02 › item 2: under "…is open for registration", the hero's own buttons could
    // not start that task — two of the three opened an empty wallet and the third was a status
    // dressed as a button. One CTA now: register when they hold nothing, their tickets when they do.
    // Check-in is a date, so it reads as a date until the doors open (item 6: never a third verb).
    register: `${CTA.register} →`, tickets: 'EVENT TICKETS →', checkIn: 'CHECK IN →',
    checkInSoon: `CHECK-IN OPENS ${fmt.upper(fmt.shortDate(FACTS.plexus.start))}`
  },
  start: {
    title: 'GETTING STARTED', left: n => (n === 1 ? '1 STEP LEFT' : n + ' STEPS LEFT'),
    confirm: 'Confirm your email · ', resend: 'RESEND LINK',
    profile: pct => `Complete your profile — <strong style="color:#191512">${pct}%</strong> done · `, edit: 'EDIT PROFILE →',
    resent: 'Link sent — check your inbox (and spam).'
  },
  next: { eyebrow: 'NEXT EVENT', free: 'Free entry', schedule: 'VIEW SCHEDULE', register: `${CTA.register} →`, mine: 'MY TICKET →', units: ['DAYS', 'HOURS', 'MINUTES'] },
  projects: {
    n: '01', title: 'OUR PROJECTS', sub: 'Apply, register, and follow every Med&amp;X project from here.',
    cards: {
      plexus: { title: 'Plexus Conference 2026', photo: 'photo-stage.jpg' },
      gala: { title: 'Gala <i style="color:#c9a962">Evening</i>', photo: 'photo-gala.jpg' },
      accelerator: { title: 'The Accelerator', photo: 'photo-candlelit.jpg' },
      forum: { title: 'Biomedical Forum', photo: 'photo-ballroom.jpg' },
      bridges: { title: 'Building Bridges', photo: 'photo-hall.jpg' }
    },
    // used only when GET /api/public/status is unavailable (wording from the artboard, facts from FACTS)
    fallback: {
      plexus: { status_label: 'Registration open', detail_line: `${FACTS.plexus.dateRange} · ${FACTS.plexus.city} · Free entry`, cta_label: CTA.register, cta_target: 'plexus' },
      gala: { status_label: 'Seats limited', detail_line: `${FACTS.gala.dateLabel} · ${FACTS.gala.venue} · €${FACTS.gala.priceEarly} through ${FACTS.gala.priceFlipLabel}`, cta_label: CTA.reserve(`€${FACTS.gala.priceEarly}`), cta_target: 'gala' },
      accelerator: { status_label: 'Opens November 15', detail_line: `Partner labs and clinics · ${FACTS.accelerator.opensLabel}`, cta_label: 'Learn more', cta_target: 'accelerator' },
      forum: { status_label: 'By invitation', detail_line: `Forum gathering · ${FACTS.forum.gathering.label}`, cta_label: 'Enter code', cta_target: 'forum' },
      bridges: { status_label: `${FACTS.bridges.next.city} · ${FACTS.bridges.next.short}`, detail_line: `${FACTS.bridges.next.city} · ${FACTS.bridges.next.label}`, cta_label: 'View program', cta_target: 'bridges' }
    }
  },
  latest: {
    n: '02', title: 'LATEST FROM MED&amp;X', seeAll: 'SEE ALL →', showLess: 'SHOW LESS', read: 'READ →',
    emptyLine: 'Quiet week at Med&amp;X.',
    emptyWhy: 'When news breaks — calls, dates, announcements — it appears here first. Follow a project to be notified the moment it does.',
    emptyCta: 'EXPLORE THE PROJECTS →'
  },
  keyDates: {
    title: 'KEY DATES', add: 'ADD →', file: 'medx-key-dates.ics',
    added: 'Calendar file downloaded — open it to add the dates.', none: 'No dates could be exported yet.',
    // shown only when GET /api/plexus/settings carries no key_dates
    fallback: [
      { label: `Gala seats — €${FACTS.gala.priceEarly}`, date: FACTS.gala.dateLabel },
      { label: 'Building Bridges — Boston', date: FACTS.bridges.next.label },
      { label: 'Donor Night — during Plexus Week', date: 'December 2026' },
      { label: 'Accelerator applications open', date: FACTS.accelerator.opensLabel },
      { label: 'Plexus Conference & Gala', date: FACTS.plexus.dateRange }
    ]
  },
  newsletter: {
    title: 'MED&amp;X NEWSLETTER', sub: 'Project news in your inbox — pick topics.',
    topics: ['ALL MED&X', 'PLEXUS', 'GALA EVENING', 'ACCELERATOR', 'BUILDING BRIDGES', 'BIOMEDICAL FORUM'],
    subscribe: 'SUBSCRIBE →', subscribed: n => `SUBSCRIBED · ${n} ${n === 1 ? 'TOPIC' : 'TOPICS'} · MANAGE IN SETTINGS`,
    done: n => `Subscribed to ${n} topic${n === 1 ? '' : 's'} — manage them in Profile & settings.`, pick: 'Pick at least one topic.'
  },
  forum: { label: 'FROM THE FORUM', open: 'OPEN FEED →', tag: 'FORUM UPDATE', spotlightTag: 'MEMBER SPOTLIGHT' },
  network: {
    eyebrow: '03 · GROW YOUR NETWORK',
    line: 'Med&amp;X is a community <i style="color:#c9a962">first</i>. Meet the people behind the programs.',
    stats: { registrations: 'GUESTS SO FAR', members: 'MEMBERS', countries: 'COUNTRIES', speakers: 'SPEAKERS HOSTED' },
    cta: 'OPEN THE NETWORK →'
  }
};
const TOPIC_KEY = { 'PLEXUS': 'plexus', 'GALA EVENING': 'gala', 'ACCELERATOR': 'accelerator', 'BUILDING BRIDGES': 'bridges', 'BIOMEDICAL FORUM': 'forum' };
const ALL_TOPIC = 'ALL MED&X';
const PHOTOS = ['photo-candlelit.jpg', 'photo-ballroom.jpg', 'photo-gala.jpg', 'photo-hall.jpg', 'photo-stage.jpg', 'photo-bridges.jpg'];
// per-project card treatment — from the artboard (gala = ink card with gold)
const CARD = {
  plexus: { wrap: 'border:1px solid rgba(25,21,18,.16);border-top:2px solid #9b1b22;background:#fdfaf3;display:flex;flex-direction:column;box-sizing:border-box', img: 'width:100%;height:110px;object-fit:cover;display:block', status: '#9b1b22', detail: '#4a4239', cta: '#9b1b22' },
  gala: { wrap: 'border:1px solid rgba(201,169,98,.55);background:#191512;color:#f7f1e6;display:flex;flex-direction:column;box-sizing:border-box', img: 'width:100%;height:110px;object-fit:cover;object-position:top;display:block', status: '#c9a962', detail: 'rgba(247,241,230,.65)', cta: '#c9a962' },
  accelerator: { wrap: 'border:1px solid rgba(25,21,18,.16);background:#fdfaf3;display:flex;flex-direction:column;box-sizing:border-box', img: 'width:100%;height:110px;object-fit:cover;display:block', status: '#4a4239', detail: '#4a4239', cta: '#9b1b22' },
  forum: { wrap: 'border:1px solid rgba(25,21,18,.16);background:#fdfaf3;display:flex;flex-direction:column;box-sizing:border-box', img: 'width:100%;height:110px;object-fit:cover;display:block', status: '#6e5626', detail: '#4a4239', cta: '#9b1b22' },
  bridges: { wrap: 'border:1px solid rgba(25,21,18,.16);background:#fdfaf3;display:flex;flex-direction:column;box-sizing:border-box', img: 'width:100%;height:110px;object-fit:cover;display:block', status: '#4a4239', detail: '#4a4239', cta: '#9b1b22' }
};
const DOTS = ['#c9a962', '#9b1b22', '#191512'];

// ---- view state ----
let D = null;               // loaded data
let st = null;              // ui state
let timers = [];
let unbind = null;
let rootEl = null;

function startDismissKey() { return 'medx_v2_start_dismissed:' + ((session.user || {}).id || 'anon'); }
function ago(v) {
  const d = fmt.toDate(v); if (!d) return '';
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 3600) return Math.max(1, Math.round(s / 60)) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  const days = Math.round(s / 86400); return days === 1 ? 'yesterday' : days < 30 ? days + ' days ago' : fmt.shortDate(d);
}

// ---------------------------------------------------------------- data
async function load() {
  const r = await api.settle({
    me: api.get('/api/auth/me'),
    site: api.get('/api/public/site', { noAuth: true }),
    status: api.get('/api/public/status', { noAuth: true }),
    feed: api.get('/api/feed/home'),
    plexus: api.get('/api/plexus/settings', { noAuth: true }),
    impact: api.get('/api/public/impact', { noAuth: true }),
    topics: api.get('/api/notify-topics'),
    next: api.get('/api/me/next-event'),
    net: api.get('/api/networking/profile'),
    comp: api.get('/api/v2/profile/completion'),
    nl: api.get('/api/v2/newsletter/preferences'),
    // one directory, one count (audit small notes): this band said 59 MEMBERS while the Network
    // screen offered "BROWSE ALL 48 MEMBERS" — /api/public/impact counts every row in `users`,
    // the directory counts the members you can actually open. The directory number is the true one.
    netSummary: api.get('/api/v2/network/summary')
  });
  if (r.me) session.update(Object.assign({}, r.me, { email_verified: (session.user || {}).email_verified }));
  const me = session.user || r.me || {};
  const conf = (r.site && r.site.conference) || null;
  const projects = {}; ((r.status && r.status.projects) || []).forEach(p => { projects[p.project_key] = p; });
  const feed = (r.feed && r.feed.items) || [];
  let keyDates = (r.plexus && Array.isArray(r.plexus.key_dates) && r.plexus.key_dates.length) ? r.plexus.key_dates : null;
  const directoryMembers = r.netSummary && Number.isFinite(Number(r.netSummary.members)) ? Number(r.netSummary.members) : null;
  const sitePrice = r.site && r.site.price && Number(r.site.price.current);
  return {
    me, conf, projects, feed,
    impact: r.impact ? Object.assign({}, r.impact, directoryMembers == null ? {} : { members: directoryMembers }) : null,
    galaPrice: Number.isFinite(sitePrice) && sitePrice > 0 ? sitePrice : galaPriceNow(),
    followed: (r.topics && r.topics.projects) || [],
    next: r.next || {},
    completion: r.comp && Array.isArray(r.comp.items)
      ? { pct: r.comp.percent, done: r.comp.done, total: r.comp.total, items: r.comp.items, complete: !!r.comp.complete }
      : profileCompletion(me, r.net), // fallback while the server formula is unavailable
    nl: r.nl || null,
    keyDates: keyDates || COPY.keyDates.fallback, keyDatesFromApi: !!keyDates,
    countdownTo: conf && conf.start_date ? String(conf.start_date).slice(0, 10) + 'T09:00:00+01:00' : FACTS.plexus.startAt,
    shortName: ((r.next && r.next.event_name) || (conf && conf.name) || FACTS.plexus.name).replace(/\s*Conference\s*/i, ' ').trim(),
    forumTop: feed.find(i => i.source === 'forum') || null
  };
}

// ---------------------------------------------------------------- blocks
function blockHero() {
  const me = D.me; const c = D.completion;
  const emailOk = session.emailConfirmed();
  let dismissed = false; try { dismissed = localStorage.getItem(startDismissKey()) === '1'; } catch (e) {}
  const showStart = !dismissed && (!emailOk || !c.complete);
  const steps = (emailOk ? 0 : 1) + (c.complete ? 0 : 1);
  const hour = new Date().getHours();
  const greeting = COPY.hero.greetings[hour < 12 ? 0 : hour < 18 ? 1 : 2];
  const open = D.conf ? !!D.conf.registration_open : true;
  const city = (D.conf && D.conf.venue_city) || FACTS.plexus.city;
  const holdsTicket = !!D.next.registered;
  const checkInOpen = new Date() >= new Date(FACTS.plexus.start + 'T00:00:00');
  return `
  <!-- dc: Med&X Home.dc.html › "YOUR NEXT EVENT" -->
  <div style="border-bottom:1px solid rgba(25,21,18,.16);position:relative;overflow:hidden">
    <div class="mx-grid-hero" style="display:grid;grid-template-columns:minmax(240px,300px) 1fr minmax(240px,300px);align-items:start;position:relative">
    <div data-block="start" style="display:flex;flex-direction:column;gap:8px;padding:16px 20px 0 0;order:3">
      ${showStart ? `
        <div style="display:flex;flex-direction:column;background:#fdfaf3;border:1px solid rgba(25,21,18,.16)">
          <div style="display:flex;align-items:center;gap:10px;padding:9px 12px 7px">
            <span style="width:6px;height:6px;background:#c9a962;flex:none"></span>
            <span style="font:600 9px Inter,sans-serif;letter-spacing:.16em;color:#6e5626">${COPY.start.title} · ${COPY.start.left(steps)}</span>
            <div style="flex:1"></div>
            <span data-act="hideStart" aria-label="Dismiss" style="color:#4a4239;cursor:pointer;line-height:1">×</span>
          </div>
          ${emailOk ? '' : `
            <div style="display:flex;align-items:flex-start;gap:9px;padding:7px 12px;border-top:1px solid rgba(25,21,18,.08)">
              <span style="width:11px;height:11px;border:1px solid rgba(25,21,18,.35);flex:none;margin-top:2px"></span>
              <span style="font-size:12px;line-height:1.5;color:#4a4239;flex:1">${COPY.start.confirm}<span data-act="resend" style="font:600 9.5px Inter,sans-serif;letter-spacing:.14em;color:#9b1b22;cursor:pointer;white-space:nowrap">${COPY.start.resend}</span></span>
            </div>`}
          ${c.complete ? '' : `
            <div style="display:flex;align-items:flex-start;gap:9px;padding:7px 12px 10px;border-top:1px solid rgba(25,21,18,.08)">
              <span style="width:11px;height:11px;border:1px solid rgba(25,21,18,.35);flex:none;margin-top:2px"></span>
              <span style="font-size:12px;line-height:1.5;color:#4a4239;flex:1">${COPY.start.profile(c.pct)}<a href="/app/profile" style="font:600 9.5px Inter,sans-serif;letter-spacing:.14em;white-space:nowrap">${COPY.start.edit}</a></span>
            </div>`}
        </div>` : ''}
    </div>
    <img src="/assets/mark-x.png" alt="" style="position:absolute;left:6%;top:24%;width:52px;opacity:.13;transform:rotate(-12deg);pointer-events:none;user-select:none">
    <img src="/assets/mark-x.png" alt="" style="position:absolute;left:3%;bottom:16%;width:80px;opacity:.09;transform:rotate(7deg);pointer-events:none;user-select:none">
    <img src="/assets/mark-x.png" alt="" style="position:absolute;left:14%;bottom:38%;width:34px;opacity:.11;transform:rotate(-4deg);pointer-events:none;user-select:none">
    <img src="/assets/mark-x.png" alt="" style="position:absolute;right:6%;top:20%;width:66px;opacity:.11;transform:rotate(9deg) scaleX(-1);pointer-events:none;user-select:none">
    <img src="/assets/mark-x.png" alt="" style="position:absolute;right:12%;bottom:20%;width:44px;opacity:.13;transform:rotate(-8deg);pointer-events:none;user-select:none">
    <img src="/assets/mark-x.png" alt="" style="position:absolute;right:2.5%;bottom:44%;width:30px;opacity:.1;transform:rotate(14deg) scaleX(-1);pointer-events:none;user-select:none">
    <div class="mx-pad-hero" style="padding:54px 12px 46px;display:flex;flex-direction:column;align-items:center;text-align:center;position:relative;order:2">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
        <span style="width:28px;height:1px;background:#c9a962"></span>
        <span style="font:600 11px Inter,sans-serif;letter-spacing:.18em;color:#9b1b22">${COPY.hero.eyebrow} · ${esc(fmt.upper(D.shortName))}</span>
        <span style="width:28px;height:1px;background:#c9a962"></span>
      </div>
      <div class="mx-display-46" style="font-family:Fraunces,serif;font-size:46px;line-height:1.08">${esc(greeting)}, <i>${esc((me.first_name || '').trim() || session.displayName())}</i>.</div>
      <div style="font-size:15px;line-height:1.6;color:#4a4239;max-width:460px;margin-top:14px">${esc((open ? COPY.hero.open : COPY.hero.soon)(D.shortName, city))}</div>
      <div class="mx-wrap-center" style="display:flex;gap:12px;margin-top:26px;flex-wrap:wrap;justify-content:center">
        ${holdsTicket
          ? `<a href="/app/me" style="padding:12px 20px;background:#9b1b22;color:#f7f1e6;font:600 10.5px Inter,sans-serif;letter-spacing:.16em;text-decoration:none;white-space:nowrap" data-hover="background:#7e151b;color:#f7f1e6">${COPY.hero.tickets}</a>`
          : `<a href="/app/plexus/mine" style="padding:12px 20px;background:#9b1b22;color:#f7f1e6;font:600 10.5px Inter,sans-serif;letter-spacing:.16em;text-decoration:none;white-space:nowrap" data-hover="background:#7e151b;color:#f7f1e6">${COPY.hero.register}</a>`}
        ${holdsTicket && checkInOpen
          ? `<a href="/app/me?open=qr" style="padding:12px 20px;border:1px solid rgba(25,21,18,.35);font:600 10.5px Inter,sans-serif;letter-spacing:.16em;color:#191512;text-decoration:none;white-space:nowrap" data-hover="border-color:#191512;color:#191512">${COPY.hero.checkIn}</a>`
          : ''}
      </div>
      ${checkInOpen ? '' : `<div style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#4a4239;margin-top:12px">${COPY.hero.checkInSoon}</div>`}
    </div>
    <span style="order:1"></span>
    </div>
  </div>
  <!-- /dc -->`;
}

function blockNextEvent() {
  const c = D.conf; const p = D.projects.plexus || COPY.projects.fallback.plexus;
  const name = (c && c.name) || FACTS.plexus.name;
  const m = name.match(/^(.*?)(\s+\d{4})$/);
  const titleHtml = m ? esc(m[1]) + ' <i style="color:#c9a962">' + esc(m[2].trim()) + '</i>' : esc(name);
  const line = [(c && c.date_range) || FACTS.plexus.dateRange, [(c && c.venue_city) || FACTS.plexus.city, (c && c.venue_country) || FACTS.plexus.country].join(', '), COPY.next.free].join(' · ');
  const cell = (id, unit) => `<span style="display:flex;align-items:baseline;gap:7px"><span data-cd="${id}" style="font-family:Fraunces,serif;font-size:30px;color:#c9a962">—</span><span style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:rgba(247,241,230,.65)">${unit}</span></span>`;
  return `
  <!-- dc: Med&X Home.dc.html › "NEXT EVENT" -->
  <div class="mx-next-event mx-pad-band" style="background:#191512;color:#f7f1e6;padding:20px 36px;display:flex;align-items:center;gap:34px;border-bottom:1px solid rgba(25,21,18,.16);box-sizing:border-box">
      <span style="display:flex;flex-direction:column;gap:4px;flex:none">
        <span style="font:600 9px Inter,sans-serif;letter-spacing:.18em;color:#c9a962">${COPY.next.eyebrow} · ${esc(fmt.upper(fmt.detail(p.status_label || '')))}</span>
        <span style="font-family:Fraunces,serif;font-size:23px;line-height:1.15">${titleHtml}</span>
        <span style="font-size:12px;color:rgba(247,241,230,.65)">${esc(fmt.dash(line))}</span>
      </span>
      <span class="mx-vrule" style="width:1px;align-self:stretch;background:rgba(247,241,230,.18)"></span>
      <span style="display:flex;align-items:baseline;gap:20px">
        ${cell('days', COPY.next.units[0])}
        ${cell('hrs', COPY.next.units[1])}
        ${cell('min', COPY.next.units[2])}
      </span>
      <span class="mx-cta-row" style="margin-left:auto;display:flex;gap:12px">
        <a href="/app/plexus/program" style="padding:12px 18px;border:1px solid rgba(247,241,230,.35);font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#f7f1e6;white-space:nowrap" data-hover="border-color:#f7f1e6;color:#f7f1e6">${COPY.next.schedule}</a>
        <a href="/app/plexus/mine" style="padding:12px 18px;background:#c9a962;color:#191512;font:600 10px Inter,sans-serif;letter-spacing:.16em;white-space:nowrap" data-hover="background:#b8994f;color:#191512">${D.next.registered ? COPY.next.mine : COPY.next.register}</a>
      </span>
    </div>
  <!-- /dc -->`;
}

// The two registration cards say the two verbs (item 6) whatever wording the status feed carries;
// every other card keeps the admin's own label. Detail lines pass through the early-bird repair so
// a stale "€150 through 1 Sep" can't outrank the Gala page (item 1).
function cardCta(key, p) {
  if (key === 'plexus') return CTA.register;
  if (key === 'gala') return CTA.reserve(fmt.eur(D.galaPrice));
  return fmt.upper(p.cta_label || 'Open');
}
function blockProjects() {
  const card = key => {
    const p = D.projects[key] || COPY.projects.fallback[key]; const c = CARD[key]; const meta = COPY.projects.cards[key];
    const to = routeFor(p.cta_target || key, routeFor(key));
    return `
      <div style="${c.wrap}">
        <img src="/assets/${meta.photo}" alt="" style="${c.img}">
        <div style="padding:16px;display:flex;flex-direction:column;gap:8px;flex:1">
          <span style="font:600 10px Inter,sans-serif;letter-spacing:.14em;color:${c.status}">${esc(fmt.upper(fmt.detail(p.status_label || '')))}</span>
          <span style="font-family:Fraunces,serif;font-size:19px;line-height:1.15">${meta.title}</span>
          <span style="font-size:12px;color:${c.detail};line-height:1.5">${esc(fmt.detail(reconcileEarlyBird(p.detail_line || '')))}</span>
          <a href="${to}" style="font:600 10px Inter,sans-serif;letter-spacing:.16em;color:${c.cta};margin-top:auto;white-space:nowrap">${esc(cardCta(key, p))} →</a>
        </div>
      </div>`;
  };
  return `
    <!-- dc: Med&X Home.dc.html › "01 · OUR PROJECTS" -->
    <div id="projects" class="mx-wrap-row" style="display:flex;align-items:baseline;gap:14px;padding:24px 0 18px">
      <span style="font-family:Fraunces,serif;font-weight:600;font-size:14px;color:#9b1b22">${COPY.projects.n}</span>
      <span style="font:600 14px Inter,sans-serif;letter-spacing:.14em">${COPY.projects.title}</span>
      <span style="font-size:12.5px;color:#4a4239">${COPY.projects.sub}</span>
    </div>
    <div class="mx-grid-5" style="display:grid;grid-template-columns:repeat(5,1fr);gap:16px;padding-bottom:30px">
      ${FACTS.projectOrder.map(card).join('')}
    </div>
    <!-- /dc -->`;
}

function latestRows() {
  const items = D.feed.slice(0, st.expanded ? 14 : 4);
  if (!items.length) return `
        <div class="empty" style="padding:26px 0 18px">
          <span style="width:28px;height:1px;background:#c9a962;margin-bottom:6px"></span>
          <span style="font-family:Fraunces,serif;font-style:italic;font-size:17px">${COPY.latest.emptyLine}</span>
          <span style="font-size:12.5px;color:#4a4239;max-width:400px;line-height:1.55">${COPY.latest.emptyWhy}</span>
          <span data-act="explore" style="margin-top:8px;padding:11px 20px;border:1px solid rgba(25,21,18,.3);font:600 10px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;color:#191512;white-space:nowrap">${COPY.latest.emptyCta}</span>
        </div>`;
  return items.map((it, i) => `
        <a href="${it.source === 'forum' ? '/app/forum' : routeFor(it.link_url, '/app/home')}" style="display:flex;gap:16px;align-items:baseline;padding:14px 0;${i < items.length - 1 ? 'border-bottom:1px solid rgba(25,21,18,.1);' : ''}color:#191512" data-hover="color:#9b1b22">
          <span style="font:600 10px Inter,sans-serif;letter-spacing:.12em;color:#9b8f80;flex:none;width:52px">${esc(fmt.shortDate(it.posted_at))}</span>
          <span style="font-family:Fraunces,serif;font-size:16.5px;line-height:1.25;flex:1;min-width:0">${esc(fmt.euro(it.title))}</span>
          <span style="font:600 9px Inter,sans-serif;letter-spacing:.16em;color:#9b1b22;flex:none">${COPY.latest.read}</span>
        </a>`).join('');
}

function blockLatest() {
  const rows = D.keyDates;
  return `
    <!-- dc: Med&X Home.dc.html › "02 · LATEST FROM MED&X" -->
    <div class="mx-grid-latest" style="display:grid;grid-template-columns:1.6fr 1fr;gap:34px;border-top:1px solid rgba(25,21,18,.16);padding:22px 0 10px;align-items:start">
      <div>
        <div class="mx-wrap-row" style="display:flex;align-items:baseline;gap:12px;padding-bottom:4px">
          <span style="font-family:Fraunces,serif;font-weight:600;font-size:14px;color:#9b1b22">${COPY.latest.n}</span>
          <span style="font:600 14px Inter,sans-serif;letter-spacing:.14em">${COPY.latest.title}</span>
          <div style="flex:1"></div>
          ${D.feed.length > 4 ? `<span data-act="seeAll" style="font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#9b1b22;cursor:pointer">${st.expanded ? COPY.latest.showLess : COPY.latest.seeAll}</span>` : ''}
        </div>
        <div data-block="latest">${latestRows()}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:20px">
        <!-- dc: Med&X Home.dc.html › "KEY DATES" -->
        <div style="border:1px solid rgba(25,21,18,.16);background:#fdfaf3;padding:15px 18px 8px">
          <div style="display:flex;align-items:baseline;gap:10px;padding-bottom:4px">
            <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em;color:#6e5626">${COPY.keyDates.title}</span>
            <div style="flex:1"></div>
            <span data-act="dlIcs" style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:#9b1b22;cursor:pointer">${COPY.keyDates.add}</span>
          </div>
          ${rows.map((r, i) => `
          <div style="display:flex;gap:12px;align-items:center;padding:9px 0;${i < rows.length - 1 ? 'border-bottom:1px solid rgba(25,21,18,.1)' : ''}">
            <span style="width:7px;height:7px;background:${DOTS[i % DOTS.length]};flex:none"></span>
            <span style="font-size:13px;color:#191512;flex:1;line-height:1.3">${esc(fmt.detail(r.label))}</span>
            <span style="font:600 9px Inter,sans-serif;letter-spacing:.1em;color:#9b8f80;white-space:nowrap">${esc(fmt.keyDateLabel(trueDateFor(r.label) || r.date))}</span>
          </div>`).join('')}
        </div>
        <!-- /dc -->
      </div>
    </div>
    <!-- /dc -->`;
}

function blockNewsletter() {
  const picked = st.nlTopics;
  const chip = label => { const on = picked.includes(label); return `<span data-act="nlTg" data-topic="${esc(label)}" role="checkbox" aria-checked="${on}" style="padding:5px 9px;border:1px solid ${on ? '#9b1b22' : 'rgba(25,21,18,.22)'};background:${on ? '#9b1b22' : 'transparent'};color:${on ? '#f7f1e6' : '#191512'};font:600 8.5px Inter,sans-serif;letter-spacing:.12em;cursor:pointer;white-space:nowrap">${esc(label)}</span>`; };
  return `
    <!-- dc: Med&X Home.dc.html › "MED&X NEWSLETTER" -->
    <div data-block="newsletter" style="display:flex;align-items:center;gap:18px;flex-wrap:wrap;border:1px solid rgba(25,21,18,.16);border-left:3px solid #c9a962;background:#fdfaf3;padding:14px 18px;margin-bottom:28px">
      <span style="font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#9b1b22;flex:none">${COPY.newsletter.title}</span>
      <span style="font-size:12px;color:#4a4239;flex:none">${COPY.newsletter.sub}</span>
      <div style="display:flex;gap:6px;flex-wrap:wrap;flex:1;min-width:220px">
        ${COPY.newsletter.topics.map(chip).join('\n        ')}
      </div>
      ${st.nlDone ? `
      <span style="padding:6px 10px;border:1px solid rgba(201,169,98,.65);color:#6e5626;font:600 8.5px Inter,sans-serif;letter-spacing:.13em;flex:none">${COPY.newsletter.subscribed(st.nlCount)}</span>` : `
      <input data-role="nlEmail" type="email" aria-label="Email for the newsletter" value="${esc(D.me.email || '')}" placeholder="${esc(D.me.email || 'you@institution.edu')}" class="mx-w250" style="border:1px solid rgba(25,21,18,.25);background:#fff;padding:9px 12px;font:13px Inter,sans-serif;color:#191512;width:250px;flex:none">
      <span data-act="nlSub" style="padding:10px 16px;background:#9b1b22;color:#f7f1e6;font:600 9.5px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;white-space:nowrap;flex:none" data-hover="background:#7e151b">${COPY.newsletter.subscribe}</span>`}
    </div>
    <!-- /dc -->`;
}

function blockForum() {
  const f = D.forumTop; if (!f) return `<!-- dc: Med&X Home.dc.html › "FROM THE FORUM" --><!-- hidden: no forum post in GET /api/feed/home --><!-- /dc -->`;
  const isSpot = f.type === 'spotlight';
  return `
    <!-- dc: Med&X Home.dc.html › "FROM THE FORUM" -->
    <a href="/app/forum" style="display:flex;align-items:center;gap:14px;border:1px solid rgba(25,21,18,.16);border-left:3px solid #c9a962;background:#fdfaf3;padding:14px 18px;margin-bottom:26px;color:#191512" data-hover="background:#f7efdf">
      <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#6e5626;flex:none">${COPY.forum.label}</span>
      <span style="width:1px;height:26px;background:rgba(25,21,18,.15);flex:none"></span>
      ${isSpot && f.init ? `<span style="width:34px;height:34px;flex:none;background:#191512;color:#c9a962;display:inline-flex;align-items:center;justify-content:center;font:600 12px Fraunces,serif">${esc(f.init)}</span>` : ''}
      <span style="flex:1;min-width:0"><span style="display:block;font:600 8px Inter,sans-serif;letter-spacing:.14em;color:#9b1b22">${isSpot ? COPY.forum.spotlightTag : COPY.forum.tag}</span><span style="display:block;font-family:Fraunces,serif;font-size:16px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(f.title)}</span></span>
      <span style="font-size:11px;color:#4a4239;white-space:nowrap;flex:none">${esc(ago(f.posted_at))}</span>
      <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#9b1b22;flex:none;white-space:nowrap">${COPY.forum.open}</span>
    </a>
    <!-- /dc -->`;
}

function blockNetwork() {
  const im = D.impact;
  const stat = (n, l) => `<span style="display:flex;align-items:baseline;gap:7px"><span style="font-family:Fraunces,serif;font-size:24px;color:#c9a962">${esc(fmt.num(n))}</span><span style="font:600 8.5px Inter,sans-serif;letter-spacing:.14em;color:rgba(247,241,230,.7)">${l}</span></span>`;
  return `
  <!-- dc: Med&X Home.dc.html › "03 · GROW YOUR NETWORK" -->
  <div class="mx-rotator" style="position:relative;overflow:hidden">
    <img data-role="rot-a" src="/assets/${PHOTOS[0]}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">
    <img data-role="rot-b" src="/assets/${PHOTOS[1]}" alt="" class="out" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">
    <div style="position:absolute;inset:0;background:rgba(25,21,18,.8)"></div>
    <div class="mx-pad-36" style="position:relative;padding:36px;display:flex;flex-direction:column;align-items:center;gap:14px;text-align:center;color:#f7f1e6">
      <span style="font:600 10.5px Inter,sans-serif;letter-spacing:.18em;color:#c9a962">${COPY.network.eyebrow}</span>
      <span class="mx-display-26" style="font-family:Fraunces,serif;font-size:26px;line-height:1.3;max-width:640px">${COPY.network.line}</span>
      ${im ? `<div style="display:flex;flex-wrap:wrap;gap:12px 30px;align-items:baseline;justify-content:center">
        ${stat(im.registrations, COPY.network.stats.registrations)}
        ${stat(im.members, COPY.network.stats.members)}
        ${stat(im.countries, COPY.network.stats.countries)}
        ${stat(im.speakers, COPY.network.stats.speakers)}
      </div>` : ''}
      <a href="/app/network" style="padding:12px 22px;background:#c9a962;color:#191512;font:600 10.5px Inter,sans-serif;letter-spacing:.16em;white-space:nowrap" data-hover="background:#b8994f;color:#191512">${COPY.network.cta}</a>
    </div>
  </div>
  <!-- /dc -->`;
}

function template() {
  return `
<div data-screen-label="Home" style="position:relative;overflow:hidden;font-family:Inter,sans-serif;color:#191512;background:#f7f1e6;min-height:100vh">
  ${blockHero()}
  ${blockNextEvent()}
  <div class="mx-gutter" style="padding:0 36px">
    ${blockProjects()}
    ${blockLatest()}
    ${blockNewsletter()}
    ${blockForum()}
  </div>
  ${blockNetwork()}
</div>`;
}

// ---------------------------------------------------------------- behaviour
function rerender(sel, html) { const el = rootEl && rootEl.querySelector(sel); if (el) el.outerHTML = html; }

const handlers = {
  hideStart: () => {
    try { localStorage.setItem(startDismissKey(), '1'); } catch (e) {}
    api.post('/api/member/profile-nudge/dismiss').catch(() => {});
    const el = rootEl.querySelector('[data-block="start"]'); if (el) el.innerHTML = '';
  },
  resend: async (el) => {
    const email = D.me.email; if (!email) return;
    el.setAttribute('aria-disabled', 'true');
    try { const r = await api.post('/api/auth/request-verification', { email }); ui.toast(r.message || COPY.start.resent); if (r.devVerifyUrl) console.info('[dev] verification link:', r.devVerifyUrl); }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
    setTimeout(() => el.removeAttribute('aria-disabled'), 30000);
  },
  seeAll: () => { st.expanded = !st.expanded; rerender('[data-block="latest"]', `<div data-block="latest">${latestRows()}</div>`); const b = rootEl.querySelector('[data-act="seeAll"]'); if (b) b.textContent = st.expanded ? COPY.latest.showLess : COPY.latest.seeAll; },
  explore: () => { const el = rootEl.querySelector('#projects'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
  dlIcs: () => {
    const year = (D.conf && D.conf.year) || FACTS.year;
    const events = D.keyDates.map((r, i) => {
      const date = trueDateFor(r.label) || r.date;                 // the calendar exports the same date the rail shows
      const d = fmt.parseLooseDate(date, year); if (!d) return null;
      const range = String(date).match(/(\d{1,2})\s?[-–]\s?(\d{1,2})/);
      const end = new Date(d); end.setDate(d.getDate() + (range ? (+range[2] - +range[1]) : 0) + 1);
      return { uid: 'keydate-' + i + '-' + fmt.ymd(d), start: fmt.ymd(d), end: fmt.ymd(end), summary: fmt.detail(r.label), location: /plexus|conference|gala/i.test(r.label) ? `${FACTS.plexus.venue}, ${FACTS.plexus.city}` : '' };
    }).filter(Boolean);
    if (!events.length) return ui.toast(COPY.keyDates.none, { kind: 'error' });
    ui.downloadIcs(COPY.keyDates.file, events);
    ui.toast(COPY.keyDates.added);
  },
  nlTg: (el) => {
    const label = el.dataset.topic; const on = st.nlTopics.includes(label);
    if (on) st.nlTopics = st.nlTopics.filter(x => x !== label);
    else st.nlTopics = label === ALL_TOPIC ? [ALL_TOPIC] : st.nlTopics.filter(x => x !== ALL_TOPIC).concat([label]);
    rerender('[data-block="newsletter"]', blockNewsletter());
  },
  nlSub: async (el) => {
    if (!st.nlTopics.length) return ui.toast(COPY.newsletter.pick, { kind: 'error' });
    const topics = st.nlTopics.includes(ALL_TOPIC) ? ['all'] : st.nlTopics.map(l => TOPIC_KEY[l]).filter(Boolean);
    const typed = ((rootEl.querySelector('[data-role="nlEmail"]') || {}).value || '').trim();
    el.setAttribute('aria-disabled', 'true');
    try {
      const r = await api.post('/api/v2/newsletter/subscribe', typed ? { topics, email: typed } : { topics });
      st.nlDone = true; st.nlCount = st.nlTopics.length;
      rerender('[data-block="newsletter"]', blockNewsletter());
      ui.toast(r && r.pending_confirmation ? 'Check that inbox — one click there confirms the subscription.' : COPY.newsletter.done(st.nlCount));
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  }
};

function startTimers() {
  // countdown ticks every 30 s like the artboard (minutes resolution)
  timers.push(ui.countdown(D.countdownTo, ({ days, hrs, min }) => {
    const set = (k, v) => { const el = rootEl && rootEl.querySelector(`[data-cd="${k}"]`); if (el) el.textContent = v; };
    set('days', days); set('hrs', hrs); set('min', min);
  }, 30000));
  // photo band rotation every 6 s (crossfade); the current artboard's hero has no photo, so the
  // rotation lives on the only photo surface of the screen — see ARCHITECTURE.md
  let idx = 0, front = 'a';
  const rot = setInterval(() => {
    const a = rootEl && rootEl.querySelector('[data-role="rot-a"]'), b = rootEl && rootEl.querySelector('[data-role="rot-b"]');
    if (!a || !b) return;
    idx = (idx + 1) % PHOTOS.length;
    const back = front === 'a' ? b : a, cur = front === 'a' ? a : b;
    back.src = '/assets/' + PHOTOS[idx];
    back.classList.remove('out'); cur.classList.add('out');
    front = front === 'a' ? 'b' : 'a';
  }, 6000);
  timers.push(() => clearInterval(rot));
}

export default {
  title: 'Home',
  async render(root, ctx) {
    rootEl = root;
    D = await load();
    if (rootEl !== root) return; // navigated away while loading
    const followedLabels = D.followed.map(k => Object.keys(TOPIC_KEY).find(l => TOPIC_KEY[l] === k)).filter(Boolean);
    const nlKeys = D.nl && D.nl.subscribed ? D.nl.topics : null;
    const nlLabels = nlKeys ? (nlKeys.includes('all') ? [ALL_TOPIC] : nlKeys.map(k => Object.keys(TOPIC_KEY).find(l => TOPIC_KEY[l] === k)).filter(Boolean)) : null;
    st = { expanded: false, nlTopics: nlLabels || (followedLabels.length ? followedLabels : [ALL_TOPIC]), nlDone: !!nlLabels, nlCount: nlLabels ? nlLabels.length : 0 };
    root.innerHTML = template();
    unbind = ui.bind(root, handlers);
    startTimers();
    chrome.refresh();
  },
  destroy() {
    timers.forEach(stop => { try { stop(); } catch (e) {} }); timers = [];
    if (unbind) unbind(); unbind = null; rootEl = null; D = null; st = null;
  }
};
