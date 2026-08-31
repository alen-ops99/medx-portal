// Source: Gala Evening.dc.html
// Blocks (artboard order): "Breadcrumb" › "Hero" › "THE EVENING BEGINS IN" (ink band) ›
// "01 · ON STAGE THAT NIGHT" › "FEATURED PERFORMERS" › "02 · WHY WE GATHER" ›
// "MOMENTS FROM PREVIOUS GALAS" › "03 · THE EVENING AT A GLANCE" › "Questions".
// Data: gala_settings via GET /api/gala/settings (admin-edited in the admin portal),
// performers flag + effective price via GET /api/v2/gala/meta (backend/v2/gala.js),
// my seat state via GET /api/gala/my-status + /api/gala/my-seat, follow via /api/notify-topics.
// The price NEVER comes from this file's clock — server price block first, FACTS as last fallback.
import { api } from '../api.js';
import { session } from '../state.js';
import { ui, esc, fmt } from '../ui.js';
import { FACTS, galaPriceNow } from '../facts.js';
import { chrome } from '../chrome.js';

export const SOURCE = 'Gala Evening.dc.html';

// ---- COPY: every string that may change in a revision (dates/prices/venues via FACTS/API) ----
export const COPY = {
  crumb: { left: 'PROJECTS', right: 'MED&amp;X GALA EVENING' },
  hero: {
    eyebrow: 'MED&amp;X ANNUAL AWARDS · BLACK TIE · SEATS LIMITED',
    title: 'Med&amp;X Gala <i style="color:#c9a962">Evening</i>',
    tagline: 'Where Croatian medicine and science meet the world',
    reserve: 'RESERVE YOUR SEAT →', calendar: 'ADD TO CALENDAR',
    note: 'One form covers the conference and the Gala — RESERVE YOUR SEAT opens My Plexus &amp; Register.',
    closedNote: 'Seat reservations are paused right now — message us and we will help.',
    follow: on => `GET UPDATES FROM THE GALA · ${on ? 'ON' : 'OFF'}`,
    followSub: 'Email + portal alerts · manage topics in Profile &amp; settings'
  },
  status: {
    pending: 'Seat request received — our team reviews it and replies by email.',
    pay: 'Your seat is approved — complete the payment to confirm it.',
    paid: 'Your seat is confirmed — the ticket is in My Med&amp;X.',
    table: label => ` · ${label}`,
    ctaPending: 'MY PLEXUS →', ctaPay: 'PAY FOR YOUR SEAT →', ctaPaid: 'MY TICKET →',
    redirect: 'Taking you to the secure payment page…',
    payFail: 'The payment page could not be opened — please try again.',
    none: 'No seat request found — reserve a seat first.'
  },
  band: {
    begins: 'THE EVENING BEGINS IN', units: ['DAYS', 'HOURS', 'MINUTES'],
    when: (month, day, time, venue) => `${month} ${day}, ${time} · ${venue}`,
    priceEarly: (cur, flip, next) => `SEATS LIMITED · ${cur} UNTIL ${flip} · ${next} AFTER`,
    priceRegular: cur => `SEATS LIMITED · ${cur}`
  },
  stage: {
    n: '01', title: 'ON STAGE THAT NIGHT', all: 'ALL SPEAKERS →',
    sub: "The heads of the world's foremost hospitals and universities, in Zagreb, in person, for one evening.",
    portrait: name => `PORTRAIT · ${name.toUpperCase()}`,
    emptyLine: 'Speakers are being confirmed.',
    emptyWhy: 'The evening hosts the heads of the world’s foremost hospitals and universities — names appear here the moment they are confirmed.'
  },
  performers: {
    label: 'FEATURED PERFORMERS',
    badgeTba: 'TWO PERFORMERS CONFIRMED · NAMES ANNOUNCED CLOSER TO DECEMBER',
    badgeNamed: 'ICONIC CROATIAN MUSICIANS',
    tba: [
      { init: '♪', name: 'Headline performer — announced this autumn', role: 'Iconic Croatian vocalist · confirmed' },
      { init: '♪', name: 'Second performer — announced this autumn', role: 'Acclaimed Croatian instrumentalist · confirmed' }
    ]
  },
  why: {
    eyebrow: '02 · WHY WE GATHER',
    line: 'Accelerating Croatian medicine and science through <i style="color:#c9a962">international collaboration</i>.',
    body: 'This is the night Croatian medicine and science meet the world. Over dinner and a shared table, the evening turns to the challenges and opportunities of international biomedical collaboration, with panels on high-performance leadership. Every seat is placed to build a bridge.',
    chips: ['SEATING LIMITED BY DESIGN', 'HIGH-PERFORMANCE LEADERSHIP PANELS'],
    rsvp: price => `RSVP · ${price} →`
  },
  moments: {
    label: 'MOMENTS FROM PREVIOUS GALAS',
    line: 'World-class speakers, bridge-building at one table.',
    all: 'ALL PHOTOS →',
    modalEyebrow: 'GALA · MOMENTS', modalTitle: 'Moments from previous Galas',
    modalNote: 'Galleries from each Gala land here as our team publishes them.',
    close: 'CLOSE', photos: ['photo-candlelit.jpg', 'photo-ballroom.jpg', 'photo-hall.jpg']
  },
  glance: {
    n: '03', title: 'THE EVENING AT A GLANCE',
    // fallback only — shown when gala_settings carries no schedule rows
    fallback: [
      { time: '19:00', title: 'Doors open — welcome reception &amp; networking' },
      { time: '', title: 'Dinner, keynotes and the Med&amp;X Annual Awards follow through the evening', right: 'UNTIL 23:30', gold: true }
    ],
    note: 'Panels with our speakers on high-performance leadership and the challenges and opportunities of international biomedical collaboration. The Awards honor those who did the most to internationalize Croatian medicine and science this year. Detailed program follows soon.',
    photoCaption: 'GALA 2025 · HOTEL ESPLANADE'
  },
  ics: { file: `medx-gala-${FACTS.year}.ics`, added: 'Calendar file downloaded — open it to add the Gala.' },
  followed: 'You follow the Gala — updates reach your inbox and alerts.',
  unfollowed: 'Gala updates are off.',
  footer: {
    line: 'Questions about the Gala · seats, tables, dietary needs?',
    sub: 'Message us · we reply by email to your account address.',
    cta: 'MESSAGE US →'
  }
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
  return {
    s, date, time, d,
    startAt: `${date}T${time}:00+01:00`,                       // Zagreb is CET (+01:00) in December
    heroDate: d ? `${d.toLocaleDateString('en-GB', { weekday: 'long' })}, ${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'long' })} ${d.getFullYear()} · ${time}` : '',
    bandMonth: d ? d.toLocaleDateString('en-GB', { month: 'long' }).toUpperCase() : '', bandDay: d ? d.getDate() : '',
    venueLong,
    venueShort: FACTS.gala.venue.toUpperCase(),
    dress: String(s.dress_code || `${FACTS.gala.dress} / Formal attire`).toUpperCase(),
    open: s.is_registration_open === undefined ? true : !!Number(s.is_registration_open),
    price: resolvePrice(r.meta, s),
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

// gold CTA for the current seat state — used in the hero and mirrored in "WHY WE GATHER"
function goldCta(label, { pad = '13px 22px', size = '10.5px' } = {}) {
  const style = `padding:${pad};background:#c9a962;color:#191512;font:600 ${size} Inter,sans-serif;letter-spacing:.16em;text-decoration:none;white-space:nowrap`;
  const hover = 'background:#b8994f;color:#191512';
  switch (D.state.key) {
    case 'paid': return `<a href="/app/me" style="${style}" data-hover="${hover}">${COPY.status.ctaPaid}</a>`;
    case 'pay': return `<span data-act="pay" style="${style};cursor:pointer" data-hover="${hover}">${COPY.status.ctaPay}</span>`;
    case 'pending': return `<a href="/app/plexus/mine" style="${style}" data-hover="${hover}">${COPY.status.ctaPending}</a>`;
    default:
      if (!D.open) return `<span data-act="closed" style="${style};cursor:pointer" data-hover="${hover}">${label}</span>`;
      return `<a href="${esc(reserveUrl())}" style="${style}" data-hover="${hover}">${label}</a>`;
  }
}

function statusNote() {
  if (D.state.key === 'none') return D.open ? COPY.hero.note : COPY.hero.closedNote;
  const base = { pending: COPY.status.pending, pay: COPY.status.pay, paid: COPY.status.paid }[D.state.key];
  return base + (D.state.key === 'paid' && D.seat && D.seat.table_label ? esc(COPY.status.table(D.seat.table_label)) : '');
}

// ---------------------------------------------------------------- blocks
function blockCrumb() {
  return `
  <!-- dc: Gala Evening.dc.html › "Breadcrumb" -->
  <div class="mx-gutter" style="display:flex;align-items:center;gap:13px;padding:10px 36px;border-bottom:1px solid rgba(25,21,18,.16)">
    <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#4a4239">${COPY.crumb.left}</span>
    <span style="color:rgba(25,21,18,.35);font-size:10px">→</span>
    <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#191512">${COPY.crumb.right}</span>
  </div>
  <!-- /dc -->`;
}

function followToggle(label) {
  return `
      <div data-block="follow" style="display:flex;align-items:center;gap:10px;margin-top:20px">
        <span data-act="tgFollow" role="switch" aria-checked="${st.follow}" aria-label="${esc(label)}" style="width:34px;height:18px;flex:none;cursor:pointer;background:${st.follow ? '#9b1b22' : 'rgba(247,241,230,.3)'};position:relative;transition:background .3s"><span style="position:absolute;top:2px;width:14px;height:14px;background:#f7f1e6;transition:left .3s;left:${st.follow ? '18px' : '2px'}"></span></span>
        <span style="display:flex;flex-direction:column;gap:3px"><span style="font:600 10px Inter,sans-serif;letter-spacing:.16em;color:rgba(247,241,230,.8)">${COPY.hero.follow(st.follow)}</span><span style="font-size:10.5px;color:rgba(247,241,230,.5)">${COPY.hero.followSub}</span></span>
      </div>`;
}

function blockHero() {
  return `
  <!-- dc: Gala Evening.dc.html › "Hero" -->
  <div style="position:relative;overflow:hidden">
    <img src="/assets/photo-gala.jpg" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 30%">
    <div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(25,21,18,.7) 0%,rgba(25,21,18,.55) 55%,rgba(25,21,18,.85) 100%)"></div>
    <div class="mx-pad-hero" style="position:relative;padding:58px 36px 48px;display:flex;flex-direction:column;align-items:center;text-align:center">
      <span style="padding:6px 12px;border:1px solid rgba(201,169,98,.7);color:#c9a962;font:600 10px Inter,sans-serif;letter-spacing:.18em">${COPY.hero.eyebrow}</span>
      <div class="mx-display-46" style="font-family:Fraunces,serif;font-size:52px;line-height:1.08;color:#f7f1e6;margin-top:20px">${COPY.hero.title}</div>
      <div class="mx-gala-hero-date" style="font-family:Fraunces,serif;font-style:italic;font-size:21px;color:#c9a962;margin-top:14px">${esc(D.heroDate)}</div>
      <div style="font-size:15px;color:rgba(247,241,230,.85);margin-top:8px">${COPY.hero.tagline} · ${esc(D.venueLong)}</div>
      <div style="display:flex;gap:13px;margin-top:26px;justify-content:center;flex-wrap:wrap">
        ${goldCta(COPY.hero.reserve)}
        <span data-act="dlIcs" style="padding:13px 22px;border:1px solid rgba(247,241,230,.45);color:#f7f1e6;font:600 10.5px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;white-space:nowrap" data-hover="border-color:#f7f1e6">${COPY.hero.calendar}</span>
      </div>
      <div data-role="statusNote" style="font-size:11px;color:rgba(247,241,230,.55);margin-top:10px">${statusNote()}</div>
      ${followToggle('Get updates from the Gala')}
    </div>
  </div>
  <!-- /dc -->`;
}

function blockBand() {
  const p = D.price;
  const priceLine = p.phase === 'early_bird' && p.next
    ? COPY.band.priceEarly(fmt.eur(p.current), esc(fmt.shortDate(p.flip_date)), fmt.eur(p.next))
    : COPY.band.priceRegular(fmt.eur(p.current));
  const cell = (id, unit) => `<span style="display:flex;align-items:baseline;gap:6px"><span data-cd="${id}" style="font-family:Fraunces,serif;font-size:24px">—</span><span style="font:600 8.5px Inter,sans-serif;letter-spacing:.14em;color:rgba(247,241,230,.65)">${unit}</span></span>`;
  return `
  <!-- dc: Gala Evening.dc.html › "THE EVENING BEGINS IN" -->
  <div class="mx-pad-band mx-gala-band" style="display:flex;align-items:center;justify-content:center;gap:26px;padding:13px 36px;background:#191512;color:#f7f1e6;flex-wrap:wrap">
    <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.18em;color:#c9a962">${COPY.band.begins}</span>
    ${cell('days', COPY.band.units[0])}
    ${cell('hrs', COPY.band.units[1])}
    ${cell('min', COPY.band.units[2])}
    <span style="width:1px;height:18px;background:rgba(247,241,230,.25)"></span>
    <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:rgba(247,241,230,.9)">${COPY.band.when(esc(D.bandMonth), esc(D.bandDay), esc(D.time), esc(D.venueShort))}</span>
    <span style="width:1px;height:18px;background:rgba(247,241,230,.25)"></span>
    <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#c9a962">${esc(D.dress)}</span>
    <span style="width:1px;height:18px;background:rgba(247,241,230,.25)"></span>
    <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#c9a962">${priceLine}</span>
  </div>
  <!-- /dc -->`;
}

function speakerCard(sp) {
  const img = sp.image ? `<img data-role="portrait" src="${esc(api.url(sp.image))}" alt="${esc(sp.name)}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center top;display:block">` : '';
  return `
      <div style="border:1px solid rgba(25,21,18,.16);background:#fdfaf3;display:flex;flex-direction:column">
        <div style="position:relative;aspect-ratio:1/1;background:repeating-linear-gradient(45deg,rgba(25,21,18,.07) 0 10px,rgba(25,21,18,.03) 10px 20px);display:flex;align-items:center;justify-content:center;font:600 9.5px ui-monospace,Menlo,monospace;color:#4a4239;text-align:center;padding:0 10px">${esc(COPY.stage.portrait(sp.name))}${img}</div>
        <div style="padding:14px 16px;display:flex;flex-direction:column;gap:5px"><span style="font-family:Fraunces,serif;font-size:16px;line-height:1.2">${esc(sp.name)}</span><span style="font-size:11.5px;color:#4a4239">${esc(sp.title || sp.role || '')}</span></div>
      </div>`;
}

function blockStage() {
  const grid = D.speakers.length ? `
    <div class="mx-grid-4" style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;padding:18px 0 10px">
      ${D.speakers.map(speakerCard).join('')}
    </div>` : `
    <div class="empty" style="padding:26px 0 18px">
      <span style="width:28px;height:1px;background:#c9a962;margin-bottom:6px"></span>
      <span style="font-family:Fraunces,serif;font-style:italic;font-size:17px">${COPY.stage.emptyLine}</span>
      <span style="font-size:12.5px;color:#4a4239;max-width:400px;line-height:1.55">${COPY.stage.emptyWhy}</span>
      <a href="/app/plexus/program" style="margin-top:8px;padding:11px 20px;border:1px solid rgba(25,21,18,.3);font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#191512;white-space:nowrap">${COPY.stage.all}</a>
    </div>`;
  return `
    <!-- dc: Gala Evening.dc.html › "01 · ON STAGE THAT NIGHT" -->
    <div class="mx-wrap-row" style="display:flex;align-items:baseline;gap:14px;padding:24px 0 4px">
      <span style="font-family:Fraunces,serif;font-weight:600;font-size:14px;color:#9b1b22">${COPY.stage.n}</span>
      <span style="font:600 14px Inter,sans-serif;letter-spacing:.14em">${COPY.stage.title}</span>
      <a href="/app/plexus/program" style="font:600 10.5px Inter,sans-serif;letter-spacing:.16em;margin-left:10px;white-space:nowrap">${COPY.stage.all}</a>
    </div>
    <div style="font-size:13px;color:#4a4239;max-width:640px;line-height:1.55">${COPY.stage.sub}</div>
    ${grid}
    <!-- /dc -->`;
}

function performerInit(p) {
  const parts = String(p.name || '').replace(/[“”"']/g, '').split(/\s+/).filter(Boolean);
  return fmt.initials(parts[0] || '', parts[parts.length - 1] || '') || '♪';
}

function blockPerformers() {
  const announced = D.performers.announced;
  const list = announced
    ? D.performers.list.map(p => ({ init: performerInit(p), name: p.name, role: p.role || '' }))
    : COPY.performers.tba;
  return `
    <!-- dc: Gala Evening.dc.html › "FEATURED PERFORMERS" -->
    <div class="mx-wrap-row" style="display:flex;align-items:baseline;justify-content:center;gap:14px;padding:16px 0 10px">
      <span style="font:600 11px Inter,sans-serif;letter-spacing:.16em;color:#c9a962">${COPY.performers.label}</span>
      <span style="padding:2px 7px;border:1px solid rgba(201,169,98,.65);color:#6e5626;font:600 8.5px Inter,sans-serif;letter-spacing:.14em">${announced ? COPY.performers.badgeNamed : COPY.performers.badgeTba}</span>
    </div>
    <div class="mx-gala-perf" style="display:flex;gap:16px;justify-content:center;padding-bottom:26px">
      ${list.map(p => `
        <div style="width:260px;border:1px solid rgba(201,169,98,.5);background:#191512;color:#f7f1e6;padding:16px;display:flex;gap:12px;align-items:center">
          <span style="width:44px;height:44px;background:rgba(201,169,98,.16);flex:none;display:flex;align-items:center;justify-content:center;font:600 14px Fraunces,serif;color:#c9a962">${esc(p.init)}</span>
          <span><span style="display:block;font-family:Fraunces,serif;font-size:15px">${esc(p.name)}</span><span style="display:block;font-size:11.5px;color:rgba(247,241,230,.6)">${esc(p.role)}</span></span>
        </div>`).join('')}
    </div>
    <!-- /dc -->`;
}

function blockWhy() {
  return `
  <!-- dc: Gala Evening.dc.html › "02 · WHY WE GATHER" -->
  <div class="mx-pad-36" style="background:#191512;color:#f7f1e6;padding:30px 32px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:11px;margin:2px 0 24px">
      <span style="font:600 11px Inter,sans-serif;letter-spacing:.18em;color:#c9a962">${COPY.why.eyebrow}</span>
      <span class="mx-display-26" style="font-family:Fraunces,serif;font-size:23px;line-height:1.3;max-width:660px">${COPY.why.line}</span>
      <span style="font-size:12.5px;color:rgba(247,241,230,.7);line-height:1.6;max-width:680px">${COPY.why.body}</span>
      <span style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-top:2px">
        ${COPY.why.chips.map(c => `<span style="padding:4px 9px;border:1px solid rgba(201,169,98,.5);color:#c9a962;font:600 8.5px Inter,sans-serif;letter-spacing:.14em">${c}</span>`).join('\n        ')}
      </span>
      <span style="margin-top:6px">${goldCta(COPY.why.rsvp(fmt.eur(D.price.current)), { pad: '12px 20px', size: '10px' })}</span>
    </div>
  <!-- /dc -->`;
}

function blockMoments() {
  return `
    <!-- dc: Gala Evening.dc.html › "MOMENTS FROM PREVIOUS GALAS" -->
    <div class="mx-grid-4 mx-gala-gallery" style="display:grid;grid-template-columns:repeat(4,1fr);grid-auto-rows:150px;gap:12px;padding:24px 0">
      ${COPY.moments.photos.map(p => `<img src="/assets/${p}" alt="" style="width:100%;height:100%;object-fit:cover;display:block">`).join('\n      ')}
      <div style="background:#efe7d8;padding:16px 18px;display:flex;flex-direction:column;justify-content:center;gap:7px">
        <span style="font:600 9px Inter,sans-serif;letter-spacing:.2em;color:#9b1b22">${COPY.moments.label}</span>
        <span style="font-family:Fraunces,serif;font-style:italic;font-size:15px;line-height:1.35;color:#191512">${COPY.moments.line}</span>
        <span data-act="allPhotos" style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#9b1b22;cursor:pointer">${COPY.moments.all}</span>
      </div>
    </div>
    <!-- /dc -->`;
}

function glanceRow(r, i, last) {
  const gold = r.gold || /award/i.test(String(r.title || ''));
  return `
        <div class="mx-gala-glance-row" style="display:flex;gap:18px;align-items:baseline;padding:13px 0;${last ? '' : 'border-bottom:1px solid rgba(25,21,18,.12)'}">
          <span style="font:600 10px Inter,sans-serif;letter-spacing:.14em;color:${gold ? '#6e5626' : '#9b1b22'};width:56px;flex:none">${esc(r.time || '')}</span>
          <span style="font-family:Fraunces,serif;font-size:16.5px;flex:1"${r.description ? ` title="${esc(r.description)}"` : ''}>${r.html || esc(fmt.euro(r.title || ''))}</span>
          ${r.right ? `<span style="font:600 10px Inter,sans-serif;letter-spacing:.14em;color:#4a4239;white-space:nowrap">${esc(r.right)}</span>` : ''}
        </div>`;
}

function blockGlance() {
  const rows = D.schedule.length
    ? D.schedule.map(r => ({ time: r.time, title: r.title, description: r.description }))
    : COPY.glance.fallback.map(r => ({ time: r.time, html: r.title, right: r.right, gold: r.gold }));
  return `
    <!-- dc: Gala Evening.dc.html › "03 · THE EVENING AT A GLANCE" -->
    <div style="border-top:1px solid rgba(25,21,18,.16);padding-bottom:8px">
      <div class="mx-grid-side" style="display:grid;grid-template-columns:1fr 380px;gap:44px;align-items:start">
        <div>
        <div style="display:flex;align-items:baseline;gap:14px;padding:24px 0 12px">
          <span style="font-family:Fraunces,serif;font-weight:600;font-size:14px;color:#9b1b22">${COPY.glance.n}</span>
          <span style="font:600 14px Inter,sans-serif;letter-spacing:.14em">${COPY.glance.title}</span>
        </div>
        ${rows.map((r, i) => glanceRow(r, i, i === rows.length - 1)).join('')}
        <div style="font-family:Fraunces,serif;font-style:italic;font-size:13.5px;color:#4a4239;line-height:1.6;padding:4px 0 14px;max-width:640px">${COPY.glance.note}</div>
        </div>
        <div style="padding-top:24px;display:flex;flex-direction:column;gap:10px">
          <div style="border:1px solid rgba(201,169,98,.8);padding:9px">
            <img src="/assets/photo-candlelit.jpg" alt="" style="width:100%;height:210px;object-fit:cover;display:block">
          </div>
          <div style="display:flex;align-items:center">
            <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.18em;color:#4a4239">${COPY.glance.photoCaption}</span>
          </div>
        </div>
      </div>
    </div>
    <!-- /dc -->`;
}

function blockFooter() {
  return `
  <!-- dc: Gala Evening.dc.html › "Questions" -->
  <div class="mx-gutter mx-wrap-row" style="display:flex;align-items:center;gap:20px;padding:18px 36px 30px;border-top:1px solid rgba(25,21,18,.16);flex-wrap:wrap">
    <span style="font-family:Fraunces,serif;font-style:italic;font-size:16px;color:#4a4239">${COPY.footer.line}</span>
    <span style="font-size:12px;color:#4a4239">${COPY.footer.sub}</span>
    <div style="flex:1"></div>
    <a href="/app/messages?topic=gala" style="padding:10px 16px;background:#9b1b22;color:#f7f1e6;font:600 10px Inter,sans-serif;letter-spacing:.16em;white-space:nowrap" data-hover="background:#7e151b;color:#f7f1e6">${COPY.footer.cta}</a>
  </div>
  <!-- /dc -->`;
}

function template() {
  return `
<div data-screen-label="Gala Evening" style="font-family:Inter,sans-serif;color:#191512;background:#f7f1e6;min-height:100vh">
  ${blockCrumb()}
  ${blockHero()}
  ${blockBand()}
  <div class="mx-gutter" style="padding:0 36px">
    ${blockStage()}
    ${blockPerformers()}
    ${blockWhy()}
    ${blockMoments()}
    ${blockGlance()}
  </div>
  ${blockFooter()}
</div>`;
}

// ---------------------------------------------------------------- behaviour
function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: mime || 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
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
  tgFollow: async (el) => {
    const on = !st.follow;
    el.setAttribute('aria-disabled', 'true');
    try {
      await api.post('/api/notify-topics', { project: 'gala', on });
      st.follow = on;
      const block = rootEl.querySelector('[data-block="follow"]');
      if (block) block.outerHTML = followToggle('Get updates from the Gala');
      ui.toast(on ? COPY.followed : COPY.unfollowed);
      chrome.refresh();
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
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
  allPhotos: () => {
    // v2: no gala gallery endpoint exists yet — show the export's real event photos, full size
    openModal = ui.modal({
      eyebrow: COPY.moments.modalEyebrow,
      title: COPY.moments.modalTitle,
      body: `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          ${COPY.moments.photos.map(p => `<img src="/assets/${p}" alt="" style="width:100%;height:150px;object-fit:cover;display:block">`).join('')}
          <img src="/assets/photo-stage.jpg" alt="" style="width:100%;height:150px;object-fit:cover;display:block">
        </div>
        <p style="margin-top:12px;font-size:12px;color:#4a4239">${COPY.moments.modalNote}</p>`,
      actions: [{ label: COPY.moments.close }]
    });
  }
};

function startTimers() {
  timers.push(ui.countdown(D.startAt, ({ days, hrs, min }) => {
    const set = (k, v) => { const el = rootEl && rootEl.querySelector(`[data-cd="${k}"]`); if (el) el.textContent = v; };
    set('days', days); set('hrs', hrs); set('min', min);
  }, 30000));
}

export default {
  title: 'Gala Evening',
  async render(root, ctx) {
    ensureCss();
    rootEl = root;
    D = await load();
    if (rootEl !== root) return; // navigated away while loading
    st = { follow: D.follow };
    root.innerHTML = template();
    // portrait images fall back to the artboard's striped PORTRAIT placeholder when the
    // admin-entered image path is not served from this origin
    root.querySelectorAll('img[data-role="portrait"]').forEach(img => {
      img.addEventListener('error', () => img.remove(), { once: true });
      if (img.complete && img.naturalWidth === 0) img.remove();
    });
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
