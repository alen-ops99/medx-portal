// Source: Med&X Home.dc.html
// Blocks (artboard order): "YOUR NEXT EVENT" (hero + GETTING STARTED card) › "NEXT EVENT"
// (ink countdown band) › "01 · OUR PROJECTS" › "02 · LATEST FROM MED&X" (+ "KEY DATES") ›
// "MED&X NEWSLETTER" › "FROM THE FORUM" › "03 · GROW YOUR NETWORK".
// The chrome (top bar, stats strip, banner, drawer) is NOT in this file — js/chrome.js.
// Data: every number/label is a live read (see load()); FACTS only fills gaps and wording.
import { api } from '../api.js';
import { session, state } from '../state.js';
import { ui, esc, fmt } from '../ui.js';
import { FACTS, routeFor, CTA, trueDateFor, reconcileEarlyBird, galaPriceNow, setLiveGalaPrice, plexusStartsAt } from '../facts.js';
import { chrome } from '../chrome.js';
import { profileCompletion } from '../member.js';
import router from '../router.js';
import { projectCard } from './projects.js';

export const SOURCE = 'Med&X Home.dc.html';

// ---- COPY: every string that may change in a revision lives here (dates/prices via FACTS) ----
export const COPY = {
  hero: {
    eyebrow: 'YOUR NEXT EVENT',
    greetings: ['Good morning', 'Good afternoon', 'Good evening'],   // time-of-day; text easter eggs removed by decision
    open: (name, city) => `${name} is open for registration — two days in ${city}, this December. Discover what's next.`,
    // the status feed says PRE-REGISTRATION OPEN: the hero says the same thing, not "open for registration"
    preOpen: (name, city) => `Pre-registration for ${name} is open — two days in ${city}, this December. Discover what's next.`,
    soon: (name, city) => `${name} opens for registration soon — two days in ${city}, this December. Discover what's next.`,
    // UX audit 2026-09-02 › item 2: under "…is open for registration", the hero's own buttons could
    // not start that task — two of the three opened an empty wallet and the third was a status
    // dressed as a button. One CTA now: register when they hold nothing, their tickets when they do.
    // Check-in is a date, so it reads as a date until the doors open (item 6: never a third verb).
    register: `${CTA.register} →`, tickets: 'EVENT TICKETS →', checkIn: 'CHECK IN',
    checkInSoon: `CHECK-IN OPENS ${fmt.upper(fmt.shortDate(FACTS.plexus.start))}`
  },
  start: {
    title: 'GETTING STARTED', left: n => (n === 1 ? '1 STEP LEFT' : n + ' STEPS LEFT'),
    confirm: 'Confirm your email · ', resend: 'RESEND LINK',
    profile: pct => `Complete your profile — <strong style="color:#191512">${pct}%</strong> done · `, edit: 'EDIT PROFILE →',
    resent: 'Link sent — check your inbox (and spam).',
    // the one-row nudge (phone calm pass)
    confirmT: 'Confirm your email', resendT: 'Resend',
    profileT: 'Complete your profile'
  },
  next: { eyebrow: 'NEXT EVENT', free: 'Free entry', schedule: 'View schedule →', mySchedule: 'My schedule →', register: CTA.register, mine: 'MY TICKET', units: ['days', 'hrs', 'min'], begins: 'Begins in' },
  projects: {
    title: 'Projects', all: 'All →', sub: 'Apply, register, and follow every Med&amp;X project from here.',
    cards: {
      // the card carries the conference (its status, 4–5 December, free entry) — Plexus Week itself runs 3–6 December
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
      bridges: { status_label: 'Zagreb · December 2026', detail_line: 'Building Bridges Zagreb · during Plexus Week · Free to attend', cta_label: 'Learn more', cta_target: 'bridges' }
    }
  },
  latest: {
    n: '02', title: 'LATEST FROM MED&amp;X', seeAll: 'SEE ALL →', showLess: 'SHOW LESS', read: 'READ →',
    titleT: 'Latest', seeAllT: 'All →', showLessT: 'Less', forum: 'Forum',
    emptyLine: 'Quiet week at Med&amp;X.',
    emptyWhy: 'When news breaks — calls, dates, announcements — it appears here first. Follow a project to be notified the moment it does.',
    emptyCta: 'EXPLORE THE PROJECTS →'
  },
  keyDates: {
    title: 'KEY DATES', add: 'Add →', file: 'medx-key-dates.ics', titleT: 'Key dates', until: 'Deadline',
    added: 'Calendar file downloaded — open it to add the dates.', none: 'No dates could be exported yet.',
    // shown only when GET /api/plexus/settings carries no key_dates
    fallback: [
      { label: `Gala seats — €${FACTS.gala.priceEarly}`, date: FACTS.gala.dateLabel },
      { label: 'Building Bridges Zagreb — during Plexus Week', date: 'December 2026' },
      { label: 'Donor Night — during Plexus Week', date: 'December 2026' },
      { label: 'Accelerator applications open', date: FACTS.accelerator.opensLabel },
      { label: 'Plexus Conference & Gala', date: FACTS.plexus.dateRange }
    ]
  },
  newsletter: {
    title: 'MED&amp;X NEWSLETTER', sub: 'Project news in your inbox — pick topics.',
    topics: ['ALL MED&X', 'PLEXUS', 'GALA EVENING', 'ACCELERATOR', 'BUILDING BRIDGES', 'BIOMEDICAL FORUM'],
    subscribe: 'SUBSCRIBE', subscribed: n => `SUBSCRIBED · ${n} ${n === 1 ? 'TOPIC' : 'TOPICS'} · MANAGE IN SETTINGS`,
    rowT: 'Newsletter', rowDone: n => `Subscribed · ${n} ${n === 1 ? 'topic' : 'topics'}`,
    sheetEyebrow: 'NEWSLETTER', sheetTitle: 'Project news in your inbox', emailL: 'Email',
    topicName: l => (l === 'ALL MED&X' ? 'All of Med&X' : l.charAt(0) + l.slice(1).toLowerCase().replace(/\b(evening|forum|bridges)\b/g, w => w.charAt(0).toUpperCase() + w.slice(1))),
    done: n => `Subscribed to ${n} topic${n === 1 ? '' : 's'} — manage them in Profile & settings.`, pick: 'Pick at least one topic.'
  },
  forum: { label: 'FROM THE FORUM', open: 'OPEN FEED →', tag: 'FORUM UPDATE', spotlightTag: 'MEMBER SPOTLIGHT' },
  network: {
    eyebrow: '03 · GROW YOUR NETWORK',
    line: 'Med&amp;X is a community <i style="color:#c9a962">first</i>. Meet the people behind the programs.',
    stats: { registrations: 'GUESTS SO FAR', members: 'MEMBERS', countries: 'COUNTRIES', speakers: 'SPEAKERS HOSTED' },
    cta: 'OPEN THE NETWORK →',
    titleT: 'Network', openT: 'Open',
    tiles: { members: 'Members', countries: 'Countries', registrations: 'Guests' }
  }
};
// the view's own look (the glass chips on the next-event photo) lives in css/views/home.css, injected once
function ensureCss() {
  if (document.querySelector('link[data-view-css="home"]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = '/css/views/home.css'; l.setAttribute('data-view-css', 'home');
  document.head.appendChild(l);
}
const TOPIC_KEY = { 'PLEXUS': 'plexus', 'GALA EVENING': 'gala', 'ACCELERATOR': 'accelerator', 'BUILDING BRIDGES': 'bridges', 'BIOMEDICAL FORUM': 'forum' };
const ALL_TOPIC = 'ALL MED&X';
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
    netSummary: api.get('/api/v2/network/summary'),
    live: api.get('/api/live/events', { noAuth: true })   // the conference's real start (the countdown target)
  });
  if (r.me) session.update(Object.assign({}, r.me, { email_verified: (session.user || {}).email_verified }));
  const me = session.user || r.me || {};
  const conf = (r.site && r.site.conference) || null;
  const projects = {}; ((r.status && r.status.projects) || []).forEach(p => { projects[p.project_key] = p; });
  const feed = (r.feed && r.feed.items) || [];
  let keyDates = (r.plexus && Array.isArray(r.plexus.key_dates) && r.plexus.key_dates.length) ? r.plexus.key_dates : null;
  const directoryMembers = r.netSummary && Number.isFinite(Number(r.netSummary.members)) ? Number(r.netSummary.members) : null;
  // The server's price block and early-bird deadline become the portal's truth for this session —
  // the KEY DATES rail and every "€150 through …" line downstream read it (facts.js › setLiveGalaPrice).
  if (r.site && r.site.price) setLiveGalaPrice(Object.assign({}, r.site.price, { flip_date: (r.site.deadline || {}).early_bird || null }));
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
    countdownTo: plexusStartsAt(r.live, conf && conf.start_date),
    shortName: ((r.next && r.next.event_name) || (conf && conf.name) || FACTS.plexus.name).replace(/\s*Conference\s*/i, ' ').trim(),
    forumTop: feed.find(i => i.source === 'forum') || null
  };
}

// ---------------------------------------------------------------- blocks
// Phone calm pass (2026-09-25, DESIGN-RULES §11 › /app/home): one focal point. A date line and the greeting; ONE
// next-event card (photo, title, date · city, the countdown as a line, one primary, the schedule as a text link);
// the profile nudge as one row; the projects as a shelf; key dates as a timeline; the latest news as rows; the
// newsletter as one row that opens a sheet; the network as three numbers. No scattered marks, no second button.
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const sentence = s => { const t = String(s || '').trim(); return t && t === t.toUpperCase() ? t.charAt(0) + t.slice(1).toLowerCase() : t; };

function blockHead() {
  const me = D.me;
  const hour = new Date().getHours();
  const greeting = COPY.hero.greetings[hour < 12 ? 0 : hour < 18 ? 1 : 2];
  return `
  <!-- dc: Med&X Home.dc.html › "YOUR NEXT EVENT" (greeting) -->
  <header class="mx-home-head">
    <h1 class="mx-lt">${esc(greeting)}, <i>${esc((me.first_name || '').trim() || session.displayName())}</i>.</h1>
  </header>`;
}

function blockNextEvent() {
  const c = D.conf; const p = D.projects.plexus || COPY.projects.fallback.plexus;
  const name = ((c && c.name) || FACTS.plexus.name);
  const m = name.match(/^(.*?)(\s+\d{4})$/);
  const titleHtml = m ? esc(m[1]) + ' <i>' + esc(m[2].trim()) + '</i>' : esc(name);
  const date = (() => { const a = fmt.toDate(FACTS.plexus.start), b = fmt.toDate(FACTS.plexus.end); return a && b ? `${a.getDate()}–${b.getDate()} ${MON3[a.getMonth()]}` : FACTS.plexus.dateShort; })();
  const city = (c && c.venue_city) || FACTS.plexus.city;
  const holdsTicket = !!D.next.registered;
  const checkInOpen = new Date() >= new Date(FACTS.plexus.start + 'T00:00:00');
  // ONE primary: register when they hold nothing, their ticket when they do, check-in once the doors are open
  // (the same three destinations the hero and the band used to split between two filled buttons)
  const primary = holdsTicket && checkInOpen
    ? `<a href="/app/me?open=qr" class="btn-primary btn-block">${COPY.hero.checkIn}</a>`
    : holdsTicket
      ? `<a href="/app/plexus/mine" class="btn-primary btn-block">${COPY.next.mine}</a>`
      : `<a href="/app/plexus/mine" class="btn-primary btn-block">${COPY.next.register}</a>`;
  const cell = (id, unit) => `<span class="mx-cd-cell mx-cd-cell--${id}"><b class="mx-cd-num" data-cd="${id}">—</b><i class="mx-cd-unit">${unit}</i></span>`;
  const status = sentence(fmt.detail(p.status_label || ''));
  // Glass Quiet (GLASS-RULES §3.6 Home): the status and the countdown ride on the photo as glass chips; the chip
  // shows "69 days" (the label and the hrs / min cells stay in the DOM, hidden, so the timer keeps its cells)
  return `
  <!-- dc: Med&X Home.dc.html › "NEXT EVENT" (one card) -->
  <article class="mx-next" aria-label="Your next event">
    <a class="mx-next-media mx-media r-16x9" href="/app/plexus">
      <img src="/assets/photo-hall.jpg" alt="" style="object-position:50% 62%">
      <div class="mx-scrim"></div>
      ${status ? `<span class="mx-tag mx-tag--glass">${esc(status)}</span>` : ''}
      <span class="mx-glass mx-glass--chip mx-next-cd" role="timer" aria-label="Countdown to the conference">${ui.icon('clock', 16)}<span class="mx-cd-label">${COPY.next.begins}</span>${cell('days', COPY.next.units[0])}${cell('hrs', COPY.next.units[1])}${cell('min', COPY.next.units[2])}</span>
      <span class="mx-next-over"><span class="mx-next-title">${titleHtml}</span><span class="mx-next-date">${esc(date)} · ${esc(city)}</span></span>
    </a>
    <div class="mx-next-body">
      ${primary}
      <a class="mx-next-link" href="${holdsTicket ? '/app/live' : '/app/plexus/program'}">${holdsTicket ? COPY.next.mySchedule : COPY.next.schedule}</a>
    </div>
  </article>
  <!-- /dc -->`;
}

function blockStart() {
  const c = D.completion;
  const emailOk = session.emailConfirmed();
  let dismissed = false; try { dismissed = localStorage.getItem(startDismissKey()) === '1'; } catch (e) {}
  // the phone bar's email line already asks for the confirmation — Home says it only where that line was dismissed
  let bannerGone = false; try { bannerGone = sessionStorage.getItem('medx_verify_dismissed') === 'true'; } catch (e) {}
  const askEmail = !emailOk && bannerGone;
  if (dismissed || ((c.complete || c.pct == null) && !askEmail)) return '<div data-block="start"></div>';
  const pct = Math.max(0, Math.min(100, Number(c.pct) || 0));
  return `
  <!-- dc: Med&X Home.dc.html › "GETTING STARTED" (one row) -->
  <div data-block="start" class="mx-start">
    ${askEmail ? `<div class="mx-start-row"><span class="mx-start-ic">${ui.icon('mail', 20)}</span><span class="mx-start-text"><span class="mx-start-t">${COPY.start.confirmT}</span></span><span data-act="resend" role="button" tabindex="0" class="mx-start-go">${COPY.start.resendT}</span></div>` : ''}
    ${c.complete ? '' : `<a class="mx-start-row" href="/app/profile">
      <span class="mx-start-ic">${ui.icon('user', 20)}</span>
      <span class="mx-start-text"><span class="mx-start-t">${COPY.start.profileT}</span><span class="mx-start-bar" aria-hidden="true"><i style="width:${pct}%"></i></span><span class="mx-start-s">${pct}%</span></span>
      ${ui.icon('chevron-right', 18)}
    </a>`}
    <span data-act="hideStart" role="button" tabindex="0" aria-label="Dismiss" class="mx-iconbtn mx-start-x">${ui.icon('x', 18)}</span>
  </div>`;
}

function blockProjects() {
  const held = { plexus: !!D.next.registered, gala: !!D.next.has_gala };
  const item = key => {
    const f = projectCard(key, D.projects[key] || COPY.projects.fallback[key], held);
    return `
      <a href="${f.to}" class="mx-shelf-item mx-home-proj">
        <span class="mx-media r-4x3"><img src="${esc(f.img)}" alt="" style="object-position:${f.pos}">${f.tag.text ? `<span class="mx-tag mx-tag--glass">${esc(f.tag.text)}</span>` : ''}</span>
        <span class="mx-shelf-title">${esc(f.name)}</span>
      </a>`;
  };
  return `
    <!-- dc: Med&X Home.dc.html › "01 · OUR PROJECTS" (a shelf of the other four: the conference is the card above) -->
    <section class="mx-sec" id="projects">
      <div class="mx-sh"><h2 class="mx-sh-t">${COPY.projects.title}</h2><a class="mx-sh-a" href="/app/projects">${COPY.projects.all}</a></div>
      <div class="mx-shelf" style="--w:236px">${FACTS.projectOrder.filter(k => k !== 'plexus').map(item).join('')}</div>
    </section>
    <!-- /dc -->`;
}

// a key date: the day in the time column ('4–5 Dec', 'Sat 5 Dec' → '5 Dec', 'December 2026' → 'Dec'), "until" on the sub-line
function keyDate(r) {
  const raw = String(trueDateFor(r.label) || r.date || '');
  const until = /^\s*until\b/i.test(raw);
  const year = (D.conf && D.conf.year) || FACTS.year;
  const dmy = raw.match(/\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i);   // '1 Oct' (day first)
  const d = dmy ? new Date(year, MON3.findIndex(x => x.toLowerCase() === dmy[2].slice(0, 3).toLowerCase()), +dmy[1]) : fmt.parseLooseDate(raw, year);
  const rg = raw.match(/(\d{1,2})\s?[-–]\s?(\d{1,2})/);
  const when = d ? (rg ? `${rg[1]}–${rg[2]} ${MON3[d.getMonth()]}` : /\b\d{1,2}\b(?!\d)/.test(raw.replace(/\b20\d{2}\b/, '')) ? `${d.getDate()} ${MON3[d.getMonth()]}` : MON3[d.getMonth()])
    : (() => { const mm = MONTHS_LONG.findIndex(mo => new RegExp('\\b' + mo + '\\b', 'i').test(raw)); return mm >= 0 ? MON3[mm] : fmt.keyDateLabel(raw); })();
  return { when, sub: until ? COPY.keyDates.until : '' };
}
function blockKeyDates() {
  const rows = D.keyDates;
  return `
    <!-- dc: Med&X Home.dc.html › "KEY DATES" (a timeline) -->
    <section class="mx-sec">
      <div class="mx-sh"><h2 class="mx-sh-t">${COPY.keyDates.titleT}</h2><span class="mx-sh-a" data-act="dlIcs" role="button" tabindex="0">${COPY.keyDates.add}</span></div>
      <ol class="mx-timeline mx-timeline--wide">
        ${rows.map(r => { const k = keyDate(r); const label = fmt.detail(r.label).split(' — '); return `<li class="mx-tl-row"><time class="mx-tl-time">${esc(k.when)}</time><div class="mx-tl-body"><span class="mx-tl-title">${esc(label[0])}</span>${label[1] || k.sub ? `<span class="mx-tl-sub">${esc([label.slice(1).join(' — '), k.sub].filter(Boolean).join(' · '))}</span>` : ''}</div></li>`; }).join('')}
      </ol>
    </section>
    <!-- /dc -->`;
}

function latestRows() {
  const items = D.feed.slice(0, st.expanded ? 14 : 4);
  if (!items.length) return `
        <div class="empty">
          <span class="empty-line">${COPY.latest.emptyLine}</span>
        </div>`;
  // a row opens the announcement itself when it has text (the sheet then offers the project link)
  return `<div class="mx-list mx-list--plain">${items.map((it, i) => `
        <a class="mx-row mx-news" href="${it.source === 'forum' ? '/app/forum' : routeFor(it.link_url, '/app/home')}"${it.source !== 'forum' && String(it.body || '').trim() ? ` data-act="readNews" data-i="${i}"` : ''}>
          <span class="mx-row-l"><span class="mx-news-t">${esc(fmt.euro(it.title))}</span><span class="mx-row-s">${esc([fmt.shortDate(it.posted_at).replace(/^([A-Z])([A-Z]+)/, (x, a, b) => a + b.toLowerCase()), it.source === 'forum' ? COPY.latest.forum : ''].filter(Boolean).join(' · '))}</span></span>
          ${ui.icon('chevron-right', 18)}
        </a>`).join('')}</div>`;
}

function blockLatest() {
  return `
    <!-- dc: Med&X Home.dc.html › "02 · LATEST FROM MED&X" (rows) -->
    <section class="mx-sec">
      <div class="mx-sh"><h2 class="mx-sh-t">${COPY.latest.titleT}</h2>${D.feed.length > 4 ? `<span class="mx-sh-a" data-act="seeAll" role="button" tabindex="0">${st.expanded ? COPY.latest.showLessT : COPY.latest.seeAllT}</span>` : ''}</div>
      <div data-block="latest">${latestRows()}</div>
    </section>
    <!-- /dc -->`;
}

// the newsletter is one row; its topics, the address and SUBSCRIBE open in a sheet (the same handlers)
function blockNewsletterRow() {
  return `
    <!-- dc: Med&X Home.dc.html › "MED&X NEWSLETTER" (one row) -->
    <section class="mx-sec mx-sec--tight" data-block="nl-row">
      <div class="mx-list">
        <span class="mx-row" data-act="nlOpen" role="button" tabindex="0">${ui.icon('mail')}<span class="mx-row-l">${COPY.newsletter.rowT}${st.nlDone ? `<span class="mx-row-s">${COPY.newsletter.rowDone(st.nlCount)}</span>` : ''}</span>${ui.icon('chevron-right', 18)}</span>
      </div>
    </section>
    <!-- /dc -->`;
}
function blockNewsletter() {
  const picked = st.nlTopics;
  const chip = label => { const on = picked.includes(label); return `<span data-act="nlTg" data-topic="${esc(label)}" role="checkbox" aria-checked="${on}" class="chip${on ? ' on' : ''}">${esc(COPY.newsletter.topicName(label))}</span>`; };
  return `
    <div data-block="newsletter" class="mx-nl-sheet">
      <div class="mx-nl-chips">${COPY.newsletter.topics.map(chip).join('')}</div>
      ${st.nlDone ? `<p class="mx-nl-done">${ui.icon('check', 18)}<span>${COPY.newsletter.done(st.nlCount)}</span></p>` : `
      <label class="label" for="mx-nl-email">${COPY.newsletter.emailL}</label>
      <input id="mx-nl-email" data-role="nlEmail" type="email" class="input" aria-label="Email for the newsletter" value="${esc(D.me.email || '')}" placeholder="${esc(D.me.email || 'you@institution.edu')}">
      <span data-act="nlSub" role="button" tabindex="0" class="btn-primary btn-block">${COPY.newsletter.subscribe}</span>`}
    </div>`;
}

function blockNetwork() {
  const im = D.impact;
  // a headline number under 10 undersells the band it sits in — leave it out
  const tile = (n, l) => (n == null || Number(n) < 10) ? '' : `<div class="mx-tile"><span class="mx-tile-n">${esc(fmt.num(n))}</span><span class="mx-tile-l">${l}</span></div>`;
  const tiles = im ? [tile(im.members, COPY.network.tiles.members), tile(im.countries, COPY.network.tiles.countries), tile(im.registrations, COPY.network.tiles.registrations)].filter(Boolean) : [];
  return `
  <!-- dc: Med&X Home.dc.html › "03 · GROW YOUR NETWORK" (three numbers) -->
  <section class="mx-sec">
    <div class="mx-sh"><h2 class="mx-sh-t">${COPY.network.titleT}</h2><a class="mx-sh-a" href="/app/network">${COPY.network.openT}</a></div>
    ${tiles.length ? `<div class="mx-tiles${tiles.length === 3 ? ' mx-tiles--3' : ''}">${tiles.join('')}</div>` : ''}
  </section>
  <!-- /dc -->`;
}

function template() {
  return `
<div data-screen-label="Home" class="mx-home" style="position:relative;font-family:Inter,sans-serif;color:#191512;background:#f7f1e6;min-height:100vh">
  <div class="mx-p">
    ${blockHead()}
    <div class="mx-home-top">
      ${blockNextEvent()}
      ${blockStart()}
    </div>
    ${blockProjects()}
    <div class="mx-home-cols">
      ${blockKeyDates()}
      ${blockLatest()}
    </div>
    ${blockNewsletterRow()}
    ${blockNetwork()}
  </div>
</div>`;
}

// ---------------------------------------------------------------- behaviour
function rerender(sel, html) { const el = rootEl && rootEl.querySelector(sel); if (el) el.outerHTML = html; }
// the newsletter sheet lives outside the screen root: its block is re-drawn in the sheet
let nlSheet = null;
function rerenderNl() {
  const host = nlSheet && nlSheet.el && nlSheet.el.isConnected ? nlSheet.el : null;
  const el = host && host.querySelector('[data-block="newsletter"]'); if (el) el.outerHTML = blockNewsletter();
  rerender('[data-block="nl-row"]', blockNewsletterRow());
}

const handlers = {
  hideStart: () => {
    try { localStorage.setItem(startDismissKey(), '1'); } catch (e) {}
    api.post('/api/member/profile-nudge/dismiss').catch(() => {});
    const el = rootEl.querySelector('[data-block="start"]'); if (el) { el.innerHTML = ''; el.className = ''; }
  },
  resend: async (el) => {
    const email = D.me.email; if (!email) return;
    el.setAttribute('aria-disabled', 'true');
    try { const r = await api.post('/api/auth/request-verification', { email }); ui.toast(r.message || COPY.start.resent); if (r.devVerifyUrl) console.info('[dev] verification link:', r.devVerifyUrl); }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
    setTimeout(() => el.removeAttribute('aria-disabled'), 30000);
  },
  seeAll: () => { st.expanded = !st.expanded; rerender('[data-block="latest"]', `<div data-block="latest">${latestRows()}</div>`); const b = rootEl.querySelector('[data-act="seeAll"]'); if (b) b.textContent = st.expanded ? COPY.latest.showLessT : COPY.latest.seeAllT; },
  readNews: (el) => {
    const it = D.feed[Number(el.dataset.i)];
    if (!it) return;
    const to = routeFor(it.link_url, '');
    const paras = String(it.body || '').trim().split(/\n{2,}/).map(p => `<p style="margin:0 0 12px;font-size:16px;line-height:1.55;color:#191512">${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
    ui.modal({
      eyebrow: 'LATEST FROM MED&X · ' + fmt.shortDate(it.posted_at),
      title: esc(fmt.euro(it.title)),
      body: paras,
      actions: to && to !== '/app/home' ? [{ label: 'CLOSE' }, { label: fmt.upper(it.link_label || 'Open') + ' →', kind: 'primary', onClick: () => router.navigate(to) }] : [{ label: 'CLOSE' }]
    });
  },
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
    rerenderNl();
  },
  nlOpen: () => {
    nlSheet = ui.modal({ eyebrow: COPY.newsletter.sheetEyebrow, title: COPY.newsletter.sheetTitle, body: blockNewsletter() });
    ui.bind(nlSheet.el, { nlTg: handlers.nlTg, nlSub: handlers.nlSub });
  },
  nlSub: async (el) => {
    if (!st.nlTopics.length) return ui.toast(COPY.newsletter.pick, { kind: 'error' });
    const topics = st.nlTopics.includes(ALL_TOPIC) ? ['all'] : st.nlTopics.map(l => TOPIC_KEY[l]).filter(Boolean);
    const typed = (((nlSheet && nlSheet.el && nlSheet.el.querySelector('[data-role="nlEmail"]')) || rootEl.querySelector('[data-role="nlEmail"]') || {}).value || '').trim();
    el.setAttribute('aria-disabled', 'true');
    try {
      const r = await api.post('/api/v2/newsletter/subscribe', typed ? { topics, email: typed } : { topics });
      st.nlDone = true; st.nlCount = st.nlTopics.length;
      rerenderNl();
      ui.toast(r && r.pending_confirmation ? 'Check that inbox — one click there confirms the subscription.' : COPY.newsletter.done(st.nlCount));
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  }
};

function startTimers() {
  // countdown ticks every 30 s like the artboard (minutes resolution)
  timers.push(ui.countdown(D.countdownTo, ({ days, hrs, min }) => {
    const set = (k, v) => ui.tick(rootEl && rootEl.querySelector(`[data-cd="${k}"]`), v);
    set('days', days); set('hrs', hrs); set('min', min);
    // the last day: the chip shows hours and minutes instead of "0 days" (home.css)
    const cd = rootEl && rootEl.querySelector('.mx-next-cd'); if (cd) cd.classList.toggle('is-final', Number(days) === 0);
  }, 30000));
}

export default {
  title: 'Home',
  reveal: true,        // sections below the fold rise in on scroll (router › ui.revealOnScroll)
  async render(root, ctx) {
    ensureCss();
    rootEl = root;
    D = await load();
    if (rootEl !== root || (ctx.ready && !(await ctx.ready()))) return; // navigated away while loading, or the router moved on
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
    if (unbind) unbind(); unbind = null; rootEl = null; D = null; st = null; nlSheet = null;
  }
};
