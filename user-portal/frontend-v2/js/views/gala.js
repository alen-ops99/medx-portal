// Source: Gala Evening.dc.html, redrawn to the phone calm rules (DESIGN-RULES.md 2026-09-25).
// Blocks, top to bottom: "Breadcrumb" (desktop) › "Hero" (eyebrow · title · date · ONE action) ›
// "Begins in" (the countdown alone) › "Facts" (date · venue · dress · seat · your seat · calendar · updates,
// each said once) › "01 · On stage that night" (one card, one circle) › "02 · The evening" (a statement,
// two facts, the long copy folded away) › "Moments" (a shelf) › "03 · The evening at a glance" (timeline) ›
// "Good to know" (accordions + one message row).
// Data: gala_settings via GET /api/gala/settings (admin-edited in the admin portal),
// performers flag + effective price via GET /api/v2/gala/meta (backend/v2/gala.js),
// my seat state via GET /api/gala/my-status + /api/gala/my-seat, follow via /api/notify-topics.
// The price NEVER comes from this file's clock — server price block first, FACTS as last fallback.
// FROZEN (DESIGN-RULES §8): the gold CTA and the reserve URL builder keep every href, data-act and handler; only their look moved
// to the house button classes.
import { api } from '../api.js';
import { session } from '../state.js';
import { ui, esc, fmt } from '../ui.js';
import { FACTS, galaPriceNow, CTA, setLiveGalaPrice } from '../facts.js';
import { chrome } from '../chrome.js';
import { portraitSrc } from './_portraits.js';

export const SOURCE = 'Gala Evening.dc.html';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ---- COPY: every string that may change in a revision (dates/prices/venues via FACTS/API) ----
export const COPY = {
  crumb: { left: 'PROJECTS', right: 'MED&amp;X GALA EVENING' },
  hero: {
    eyebrow: 'Med&amp;X Annual Awards',
    title: 'Gala <i>Evening</i>',
    // one verb for this action, priced (UX audit 2026-09-02 › item 6)
    reserve: price => `${CTA.reserve(price)} →`,
    closedNote: 'Seat reservations are paused right now — message us and we will help.'
  },
  status: {
    pending: 'Seat requested', pendingSub: 'Our team reviews it and replies by email.',
    pay: 'Seat approved', paySub: 'Complete the payment to confirm it.',
    paid: 'Seat confirmed', paidSub: 'Your ticket is in My Med&amp;X.',
    table: label => ` · ${label}`,
    ctaPending: 'MY PLEXUS →', ctaPay: 'PAY FOR YOUR SEAT →', ctaPaid: 'MY TICKET →',
    redirect: 'Taking you to the secure payment page…',
    payFail: 'The payment page could not be opened — please try again.',
    none: 'No seat request found — reserve a seat first.'
  },
  countdown: { label: 'Begins in', units: ['days', 'hours', 'min'] },
  facts: {
    when: t => `${t} to midnight`,
    venueSub: 'Emerald Ballroom, Zagreb', map: 'Map',
    dress: 'Black tie', dressSub: 'Formal evening attire',
    priceEarly: (cur, flip, next) => `${cur} until ${flip}, ${next} after`,
    priceRegular: cur => `${cur} per seat`,
    priceSub: 'One form covers the conference and the Gala',
    calendar: 'Add to calendar', calendarSub: 'Timed for the evening, with the venue',
    follow: 'Gala updates', followSub: on => on ? 'On · email and portal alerts' : 'Off · email and portal alerts'
  },
  stage: {
    n: '01', title: 'On stage that night', all: 'All →',
    bioEyebrow: 'ON STAGE THAT NIGHT', bioPending: 'Bio to follow.',
    emptyLine: 'Speakers are being confirmed.',
    emptyWhy: 'Names appear here the moment they are confirmed.'
  },
  performers: {
    title: 'Live music',
    // until the names are entered in the admin portal, the music row of the schedule says it once
    tbaLine: 'Two performers confirmed · names announced this autumn'
  },
  why: {
    n: '02', title: 'The evening',
    line: 'Accelerating Croatian medicine and science through <i>international collaboration</i>.',
    facts: [
      { icon: 'users', v: 'Seating limited by design', s: 'Every seat is placed to build a bridge' },
      { icon: 'mic', v: 'Leadership panels', s: 'On high-performance leadership' }
    ],
    more: 'About the evening',
    body: 'This is the night Croatian medicine and science meet the world. Over dinner and a shared table, the evening turns to the challenges and opportunities of international biomedical collaboration, with panels on high-performance leadership. The Awards honour those who did the most to internationalise Croatian medicine and science this year. The detailed program follows soon.'
  },
  moments: {
    title: 'Moments', all: 'All photos →',
    modalEyebrow: 'GALA · MOMENTS', modalTitle: 'Moments from previous Galas',
    modalNote: 'Galleries from each Gala land here as our team publishes them.',
    photos: ['photo-candlelit.jpg', 'photo-ballroom.jpg', 'photo-stage.jpg', 'photo-forum.jpg'],
    alts: ['Guests in conversation at a previous Gala', 'The Emerald Ballroom set for dinner', 'A panel on the Gala stage', 'The ballroom during the evening']
  },
  glance: {
    n: '03', title: 'The evening at a glance',
    // fallback only — shown when gala_settings carries no schedule rows
    fallback: [
      { time: '19:00', title: 'Doors open', description: 'Welcome reception and networking' },
      { time: '', title: 'Dinner, keynotes and the Med&X Annual Awards', description: 'Through the evening, until midnight', gold: true }
    ]
  },
  know: {
    title: 'Good to know',
    policy: 'Seat policy',
    policyLine: 'Seats are non-refundable. You can transfer your seat to a colleague up to the day of the event.',
    transfer: 'Transfer your seat →',
    ask: 'Message us', askSub: 'Seats, tables, dietary needs'
  },
  ics: { file: `medx-gala-${FACTS.year}.ics`, added: 'Calendar file downloaded — open it to add the Gala.' },
  followed: 'You follow the Gala — updates reach your inbox and alerts.',
  unfollowed: 'Gala updates are off.'
};

// ---- view state ----
let D = null, st = null, timers = [], unbind = null, rootEl = null, openModal = null;

function ensureCss() {
  if (!document.querySelector('link[href="/css/views/gala.css"]')) {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/css/views/gala.css'; document.head.appendChild(l);
  }
}

// ---------------------------------------------------------------- data
function resolvePrice(meta, s) {
  if (meta && meta.price && Number.isFinite(Number(meta.price.current))) return meta.price;
  if (s && (s.price_gala_early_bird != null || s.price_gala_regular != null)) {
    const early = Number(s.price_gala_early_bird) || Number(s.price_gala_only) || FACTS.gala.priceEarly;
    const regular = Number(s.price_gala_regular) || FACTS.gala.priceRegular;
    const flip = s.early_bird_deadline || FACTS.gala.priceFlip;
    const isEarly = new Date().toISOString().slice(0, 10) <= flip;
    return { current: isEarly ? early : regular, next: isEarly ? regular : null, early, regular, flip_date: flip, phase: isEarly ? 'early_bird' : 'regular' };
  }
  const isEarly = galaPriceNow() === FACTS.gala.priceEarly;
  return { current: galaPriceNow(), next: isEarly ? FACTS.gala.priceRegular : null, early: FACTS.gala.priceEarly, regular: FACTS.gala.priceRegular, flip_date: FACTS.gala.priceFlip, phase: isEarly ? 'early_bird' : 'regular' };
}

function regState(mine) {
  if (!mine || !mine.registered || !mine.registration) return { key: 'none', reg: null };
  const r = mine.registration;
  const status = String(r.status || '').toLowerCase();
  if (['rejected', 'declined', 'cancelled'].includes(status)) return { key: 'none', reg: null };
  if (String(r.payment_status || '').toLowerCase() === 'paid' || status === 'confirmed') return { key: 'paid', reg: r };
  if (status === 'approved' || status === 'awaiting_payment') return { key: 'pay', reg: r };
  return { key: 'pending', reg: r };
}

async function load() {
  const r = await api.settle({
    settings: api.get('/api/gala/settings', { noAuth: true }),
    meta: api.get('/api/v2/gala/meta', { noAuth: true }),
    mine: api.get('/api/gala/my-status'),
    seat: api.get('/api/gala/my-seat'),
    topics: api.get('/api/notify-topics')
  });
  const s = r.settings || {};
  const date = (s.date && String(s.date).slice(0, 10)) || FACTS.gala.date;
  const time = (String(s.time || '').match(/\d{1,2}:\d{2}/) || [FACTS.gala.time])[0];
  const d = fmt.toDate(date);
  const venueLong = String(s.venue || `Grand Ballroom, ${FACTS.gala.venue} ${FACTS.gala.city}`).replace(/;\s*/g, ', ');
  const price = resolvePrice(r.meta, s);
  // This page holds the most authoritative price the portal can read. Hand it to facts.js so every
  // other screen quotes the same number and the same deadline (never FACTS' hard-coded 15 Sep).
  if ((r.meta && r.meta.price) || s.price_gala_early_bird != null || s.price_gala_regular != null) setLiveGalaPrice(price);
  const dress = String(s.dress_code || FACTS.gala.dress).split('/')[0].trim();
  return {
    s, date, time, d,
    startAt: `${date}T${time}:00+01:00`,                       // Zagreb is CET (+01:00) in December
    // hero: "Sat 5 Dec 2026 · 19:00"; facts: "Saturday, 5 December 2026"
    heroDate: d ? `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()} · ${time}` : '',
    longDate: d ? `${d.toLocaleDateString('en-GB', { weekday: 'long' })}, ${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'long' })} ${d.getFullYear()}` : '',
    venueLong,
    venueName: venueLong.split(',')[0].replace(/\s*emerald ballroom\s*/i, '').trim() || FACTS.gala.venue,
    dress: dress ? dress.charAt(0).toUpperCase() + dress.slice(1).toLowerCase() : COPY.facts.dress,
    open: s.is_registration_open === undefined ? true : !!Number(s.is_registration_open),
    price,
    speakers: Array.isArray(s.speakers) ? s.speakers.filter(x => x && x.name) : [],
    schedule: Array.isArray(s.schedule) ? s.schedule.filter(x => x && (x.title || x.time)) : [],
    performers: r.meta && r.meta.performers_announced && Array.isArray(r.meta.performers) && r.meta.performers.length
      ? { announced: true, list: r.meta.performers }
      : { announced: false, list: [] },
    state: regState(r.mine), mine: r.mine,
    seat: r.seat && r.seat.assigned ? r.seat : null,
    follow: !!(r.topics && Array.isArray(r.topics.projects) && r.topics.projects.includes('gala'))
  };
}

function reserveUrl() {
  const u = session.user || {};
  const q = new URLSearchParams();
  q.set('pick', 'gala'); q.set('src', 'portal');
  if (u.first_name) q.set('fn', u.first_name);
  if (u.last_name) q.set('ln', u.last_name);
  if (u.email) q.set('email', u.email);
  if (u.institution) q.set('inst', u.institution);
  return '/plexus?' + q.toString();
}

// gold CTA for the current seat state — the hero's one action. Same hrefs and data-acts as before;
// the look is the house gold button (full width on a phone, css/views/gala.css)
function goldCta(label) {
  const cls = 'class="btn-gold btn-block mx-gala-cta"';
  switch (D.state.key) {
    case 'paid': return `<a href="/app/me" ${cls}>${COPY.status.ctaPaid}</a>`;
    case 'pay': return `<span data-act="pay" ${cls} role="button">${COPY.status.ctaPay}</span>`;
    case 'pending': return `<a href="/app/plexus/mine" ${cls}>${COPY.status.ctaPending}</a>`;
    default:
      if (!D.open) return `<span data-act="closed" ${cls} role="button">${label}</span>`;
      return `<a href="${esc(reserveUrl())}" ${cls}>${label}</a>`;
  }
}

// ---------------------------------------------------------------- small parts
const icon = (n, s) => ui.icon(n, s || 20);
function sectionHead(n, title, link) {
  return `<div class="mx-sh">${n ? `<span class="mx-sh-n">${n}</span>` : ''}<h2 class="mx-sh-t">${title}</h2>${link || ''}</div>`;
}
function fact({ ic, v, s, go, act, attrs }) {
  const tag = act ? `li class="mx-fact" data-act="${act}"${attrs || ''}` : 'li class="mx-fact"';
  return `<${tag}>${icon(ic)}<div class="mx-fact-body"><span class="mx-fact-v">${v}</span>${s ? `<span class="mx-fact-s">${s}</span>` : ''}</div>${go || ''}</li>`;
}
function flipLabel(iso) {
  const d = fmt.toDate(String(iso || '').slice(0, 10));
  return d ? `${d.getDate()} ${MON[d.getMonth()]}` : '';
}
const mapUrl = q => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;

// ---------------------------------------------------------------- blocks
function blockCrumb() {
  return `
  <!-- dc: Gala Evening.dc.html › "Breadcrumb" (desktop; hidden on phones, where the top bar carries back) -->
  <div class="mx-crumbs mx-gutter" style="display:flex;align-items:center;gap:13px;padding:10px 36px;border-bottom:1px solid rgba(25,21,18,.16)">
    <a href="/app/projects" data-dir="back" style="font:600 12px Inter,sans-serif;letter-spacing:.12em;color:#4a4239" data-hover="color:#191512">${COPY.crumb.left}</a>
    <span style="color:rgba(25,21,18,.35);font-size:12px">→</span>
    <span style="font:600 12px Inter,sans-serif;letter-spacing:.12em;color:#191512">${COPY.crumb.right}</span>
  </div>
  <!-- /dc -->`;
}

// §6: eyebrow · title · one date line · ONE action, over the photo's bottom scrim. Nothing else.
function blockHero() {
  return `
  <!-- dc: Gala Evening.dc.html › "Hero" -->
  <section class="mx-hero mx-ink mx-gala-hero">
    <img class="mx-hero-photo" src="/assets/photo-gala.jpg" alt="" style="object-position:50% 30%">
    <div class="mx-scrim"></div>
    <div class="mx-hero-body">
      <span class="mx-hero-eyebrow">${COPY.hero.eyebrow}</span>
      <h1 class="mx-hero-title">${COPY.hero.title}</h1>
      <p class="mx-hero-date">${esc(D.heroDate)}</p>
      <div class="mx-hero-cta">${goldCta(COPY.hero.reserve(fmt.eur(D.price.current)))}</div>
    </div>
  </section>
  <!-- /dc -->`;
}

// the countdown and nothing else — the facts it used to carry live once, in the facts block
function blockCountdown() {
  const cell = (id, unit) => `<span class="mx-cd-cell"><b class="mx-cd-num" data-cd="${id}">—</b><i class="mx-cd-unit">${unit}</i></span>`;
  return `
  <div class="mx-countdown" role="timer" aria-label="Time until the Gala">
    <span class="mx-cd-label">${COPY.countdown.label}</span>
    ${cell('days', COPY.countdown.units[0])}${cell('hrs', COPY.countdown.units[1])}${cell('min', COPY.countdown.units[2])}
  </div>`;
}

function seatRow() {
  const k = D.state.key;
  if (k === 'none') return '';
  const v = { pending: COPY.status.pending, pay: COPY.status.pay, paid: COPY.status.paid }[k]
    + (k === 'paid' && D.seat && D.seat.table_label ? esc(COPY.status.table(D.seat.table_label)) : '');
  const s = { pending: COPY.status.pendingSub, pay: COPY.status.paySub, paid: COPY.status.paidSub }[k];
  return fact({ ic: 'check', v, s });
}

function blockFacts() {
  const p = D.price;
  const priceV = p.phase === 'early_bird' && p.next
    ? COPY.facts.priceEarly(fmt.eur(p.current), esc(flipLabel(p.flip_date)), fmt.eur(p.next))
    : COPY.facts.priceRegular(fmt.eur(p.current));
  const priceS = D.state.key === 'none' && !D.open ? COPY.hero.closedNote : COPY.facts.priceSub;
  return `
  <section class="mx-sec mx-sec--tight" data-block="facts">
    <ul class="mx-facts">
      ${fact({ ic: 'calendar', v: esc(D.longDate), s: esc(COPY.facts.when(D.time)) })}
      ${fact({ ic: 'pin', v: esc(D.venueName), s: COPY.facts.venueSub, go: `<a class="mx-fact-go" href="${esc(mapUrl(D.venueLong))}" target="_blank" rel="noopener">${COPY.facts.map}</a>` })}
      ${fact({ ic: 'tie', v: esc(D.dress), s: COPY.facts.dressSub })}
      ${fact({ ic: 'ticket', v: priceV, s: priceS })}
      ${seatRow()}
      ${fact({ ic: 'plus', v: COPY.facts.calendar, s: COPY.facts.calendarSub, act: 'dlIcs', go: icon('chevron-right', 18) })}
      <li class="mx-fact" data-block="follow">${icon('bell')}<div class="mx-fact-body"><span class="mx-fact-v">${COPY.facts.follow}</span><span class="mx-fact-s" data-role="follow-label">${COPY.facts.followSub(st.follow)}</span></div><span data-act="tgFollow" role="switch" aria-checked="${st.follow}" aria-label="Get updates from the Gala" class="mx-switch"><span></span></span></li>
    </ul>
  </section>`;
}

// ONE card for every speaker: a 96 circle from the bundled crop (_portraits.js), name, role on two lines at most.
// The card opens the bio sheet.
function speakerCard(sp, i) {
  const name = fmt.person(sp.name);
  return `
      <div class="mx-person" data-act="bio" data-i="${i}" aria-label="${esc(name)}, biography">
        ${ui.portrait({ name, src: portraitSrc(sp, api.url), size: 96, alt: '' })}
        <span class="mx-person-name">${esc(name)}</span>
        <span class="mx-person-role">${esc(sp.title || sp.role || '')}</span>
      </div>`;
}
function blockStage() {
  const body = D.speakers.length
    ? `<div class="mx-grid2 mx-gala-stage">${D.speakers.map(speakerCard).join('')}</div>`
    : `<div class="empty"><span class="empty-line">${COPY.stage.emptyLine}</span><span class="empty-why">${COPY.stage.emptyWhy}</span></div>`;
  return `
  <!-- dc: Gala Evening.dc.html › "01 · ON STAGE THAT NIGHT" -->
  <section class="mx-sec" data-block="stage">
    ${sectionHead(COPY.stage.n, COPY.stage.title, `<a class="mx-sh-a" href="/app/plexus/program">${COPY.stage.all}</a>`)}
    ${body}
  </section>
  <!-- /dc -->`;
}

// the statement once, two facts, and the long copy folded away
function blockWhy() {
  return `
  <!-- dc: Gala Evening.dc.html › "02 · WHY WE GATHER" -->
  <section class="mx-sec" data-block="why">
    ${sectionHead(COPY.why.n, COPY.why.title)}
    <p class="mx-gala-statement">${COPY.why.line}</p>
    <ul class="mx-facts">${COPY.why.facts.map(f => fact({ ic: f.icon, v: f.v, s: f.s })).join('')}</ul>
    <div class="mx-accs"><details class="mx-acc"><summary>${COPY.why.more}</summary><div class="mx-acc-a">${COPY.why.body}</div></details></div>
  </section>
  <!-- /dc -->`;
}

function blockMoments() {
  return `
  <!-- dc: Gala Evening.dc.html › "MOMENTS FROM PREVIOUS GALAS" -->
  <section class="mx-sec" data-block="moments">
    ${sectionHead('', COPY.moments.title, `<span class="mx-sh-a" data-act="allPhotos" data-i="0">${COPY.moments.all}</span>`)}
    <div class="mx-shelf mx-gala-shelf" style="--w:240px">
      ${COPY.moments.photos.map((p, i) => `<div class="mx-shelf-item"><div class="mx-media r-4x3 mx-ph" data-act="allPhotos" data-i="${i}" role="button" aria-label="Open photo ${i + 1} of ${COPY.moments.photos.length}"><img src="/assets/${p}" alt="${esc(COPY.moments.alts[i] || '')}" loading="lazy"></div></div>`).join('')}
    </div>
  </section>
  <!-- /dc -->`;
}

// the schedule as a timeline: time, title, the admin's description as one line under it (it used to hide in a
// tooltip). The Awards row is gold; the music row carries the performers line when the names are not in yet.
function blockGlance() {
  const rows = D.schedule.length
    ? D.schedule.map(r => ({ time: r.time, title: fmt.euro(r.title || ''), sub: r.description || '' }))
    : COPY.glance.fallback.map(r => ({ time: r.time, title: r.title, sub: r.description, gold: r.gold }));
  const musicAt = rows.findIndex(r => /music/i.test(r.title));
  if (!D.performers.announced && musicAt >= 0 && !rows[musicAt].sub) rows[musicAt].sub = COPY.performers.tbaLine;
  const row = r => `<li class="mx-tl-row${r.gold || /award/i.test(r.title) ? ' is-gold' : ''}"><time class="mx-tl-time">${esc(r.time || '')}</time><div class="mx-tl-body"><span class="mx-tl-title">${esc(r.title)}</span>${r.sub ? `<span class="mx-tl-sub">${esc(r.sub)}</span>` : ''}</div></li>`;
  const named = D.performers.announced ? `
    <div class="mx-gala-perf">
      <span class="mx-gala-perf-h">${COPY.performers.title}</span>
      ${D.performers.list.map(p => `<div class="mx-person-row is-static">${ui.portrait({ name: String(p.name || '').replace(/[“”"']/g, ''), src: p.image ? api.url(p.image) : '', size: 64, alt: '' })}<span class="mx-person-text"><span class="mx-person-name">${esc(p.name)}</span><span class="mx-person-role">${esc(p.role || '')}</span></span></div>`).join('')}
    </div>` : '';
  return `
  <!-- dc: Gala Evening.dc.html › "03 · THE EVENING AT A GLANCE" -->
  <section class="mx-sec" data-block="glance">
    ${sectionHead(COPY.glance.n, COPY.glance.title)}
    <ol class="mx-timeline">${rows.map(row).join('')}</ol>
    ${named}
  </section>
  <!-- /dc -->`;
}

// Seat policy (+ the transfer link only for a member who HOLDS a seat — UX audit 2026-09-02 › item 15;
// the transfer itself lives in My Plexus) and one row to message the team.
function blockKnow() {
  const holdsSeat = D.state.key === 'paid';
  return `
  <!-- dc: Gala Evening.dc.html › "Seat policy" + "Questions" -->
  <section class="mx-sec" data-block="know">
    ${sectionHead('', COPY.know.title)}
    <div class="mx-accs">
      <details class="mx-acc"><summary>${COPY.know.policy}</summary><div class="mx-acc-a">${COPY.know.policyLine}${holdsSeat ? `<br><a href="/app/plexus/mine" data-v2="opens My Plexus › Transfer to a colleague">${COPY.know.transfer}</a>` : ''}</div></details>
    </div>
    <div class="mx-list">
      <a class="mx-row" href="/app/messages?about=gala">${icon('mail')}<span class="mx-row-l">${COPY.know.ask}<span class="mx-row-s">${COPY.know.askSub}</span></span>${icon('chevron-right', 18)}</a>
    </div>
  </section>
  <!-- /dc -->`;
}

function template() {
  return `
<div data-screen-label="Gala Evening" class="mx-pg mx-gala">
  ${blockCrumb()}
  ${blockHero()}
  ${blockCountdown()}
  <div class="mx-p">
    ${blockFacts()}
    ${blockStage()}
    ${blockWhy()}
    ${blockMoments()}
    ${blockGlance()}
    ${blockKnow()}
  </div>
</div>`;
}

// ---------------------------------------------------------------- behaviour
function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: mime || 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function openBio(i) {
  const sp = D.speakers[Number(i)];
  if (!sp) return;
  const name = fmt.person(sp.name);
  openModal = ui.modal({
    eyebrow: COPY.stage.bioEyebrow,
    body: `<div class="mx-gala-bio">
      ${ui.portrait({ name, src: portraitSrc(sp, api.url), size: 96, alt: '' })}
      <div class="mx-modal-title">${esc(name)}</div>
      <div class="mx-gala-bio-role">${esc(sp.title || sp.role || '')}</div>
      <p>${sp.bio ? esc(sp.bio) : `<i>${COPY.stage.bioPending}</i>`}</p>
    </div>`
  });
  openModal.onClose(() => { openModal = null; });
}

const handlers = {
  dlIcs: async () => {
    // the server's /calendar/gala.ics is the authoritative TIMED event (admin-edited date/time/venue);
    // the ui helper's all-day event is the offline fallback
    try {
      const r = await api.get('/calendar/gala.ics', { noAuth: true });
      const ics = r && typeof r.raw === 'string' && r.raw.includes('BEGIN:VCALENDAR') ? r.raw : null;
      if (!ics) throw new Error('bad ics');
      downloadText(COPY.ics.file, ics);
    } catch (e) {
      ui.downloadIcs(COPY.ics.file, [{ uid: 'gala' + FACTS.year, start: fmt.ymd(D.date), summary: `Med&X ${FACTS.gala.name} ${FACTS.year}`, location: D.venueLong }]);
    }
    ui.toast(COPY.ics.added);
  },
  // flips in place at once (ui.toggleSwitch) — the POST runs behind it and a failure flips it back
  tgFollow: (el) => ui.toggleSwitch(el, async on => {
    await api.post('/api/notify-topics', { project: 'gala', on });
    if (st) st.follow = on;
    ui.toast(on ? COPY.followed : COPY.unfollowed);
    chrome.refresh();
  }, on => { const l = el.parentElement && el.parentElement.querySelector('[data-role="follow-label"]'); if (l) l.innerHTML = COPY.facts.followSub(on); }),
  pay: async (el) => {
    const reg = D.state.reg;
    if (!reg) return ui.toast(COPY.status.none, { kind: 'error' });
    el.setAttribute('aria-disabled', 'true');
    try {
      const r = await api.post('/api/gala/checkout-session', { registration_id: reg.id });
      if (r && r.url) { ui.toast(COPY.status.redirect); window.location.assign(r.url); return; }
      ui.toast((r && r.error) || COPY.status.payFail, { kind: 'error' });
    } catch (e) { ui.toast(e.message, { kind: 'error', ms: 5000 }); }
    el.removeAttribute('aria-disabled');
  },
  closed: () => ui.toast(COPY.hero.closedNote.replace(/&amp;/g, '&')),
  bio: (el) => openBio(el.dataset.i),
  // v2: no gala gallery endpoint exists yet — the export's real event photos, one at a time at full size
  // (ui.lightbox: ← / →, arrow keys, Esc), opening on the photo that was clicked
  allPhotos: (el) => {
    openModal = ui.lightbox(COPY.moments.photos.map((p, i) => ({ src: '/assets/' + p, alt: COPY.moments.alts[i] || '' })), {
      start: el && el.dataset.i, eyebrow: COPY.moments.modalEyebrow, title: COPY.moments.modalTitle, note: COPY.moments.modalNote
    });
  }
};

function startTimers() {
  timers.push(ui.countdown(D.startAt, ({ days, hrs, min }) => {
    const set = (k, v) => ui.tick(rootEl && rootEl.querySelector(`[data-cd="${k}"]`), v);
    set('days', days); set('hrs', hrs); set('min', min);
  }, 30000));
}

export default {
  title: 'Gala Evening',
  reveal: true,        // sections below the fold rise in on scroll (router › ui.revealOnScroll)
  async render(root, ctx) {
    ensureCss();
    rootEl = root;
    D = await load();
    if (rootEl !== root || (ctx.ready && !(await ctx.ready()))) return; // navigated away while loading, or the router moved on
    st = { follow: D.follow };
    root.innerHTML = template();
    unbind = ui.bind(root, handlers);
    startTimers();
    chrome.refresh();
  },
  destroy() {
    timers.forEach(stop => { try { stop(); } catch (e) {} }); timers = [];
    if (unbind) unbind(); unbind = null;
    if (openModal) { try { openModal.close(); } catch (e) {} openModal = null; }
    rootEl = null; D = null; st = null;
  }
};
