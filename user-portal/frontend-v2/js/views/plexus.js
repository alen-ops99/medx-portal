// Source: Plexus Conference.dc.html · Plexus Program.dc.html · Plexus Zagreb.dc.html · My Plexus.dc.html,
// redrawn to the phone calm rules (DESIGN-RULES.md 2026-09-25).
// Route /app/plexus/:tab? — '' (overview) · program · zagreb · mine. One module, one screen per tab, one
// segmented control between them. Every number, date, price and list is a live read (see load()); FACTS fills
// gaps and wording only.
// Registration NEVER happens here: REGISTER / RESERVE / RSVP open the ONE server-rendered form at
// /plexus (server path → full page load; ?pick= preselect is a requested server change, harmless today).
// FROZEN (DESIGN-RULES §8): every registration-form href, the Gala pay action and its handler are unchanged —
// moved and restyled only.
import { api } from '../api.js';
import { session } from '../state.js';
import { ui, esc, fmt } from '../ui.js';
import { FACTS, galaPriceNow, CTA, routeFor, setLiveGalaPrice, plexusStartsAt, plexusStartTime } from '../facts.js';
import { chrome } from '../chrome.js';
import router from '../router.js';
import { portraitSrc, portraitKey } from './_portraits.js';

export const SOURCE = 'Plexus Conference.dc.html · Plexus Program.dc.html · Plexus Zagreb.dc.html · My Plexus.dc.html';

const TABS = [
  { key: '', label: 'Overview', to: '/app/plexus', title: 'Plexus Week' },
  { key: 'program', label: 'Program', to: '/app/plexus/program', title: 'Program & Speakers' },
  { key: 'zagreb', label: 'Zagreb', to: '/app/plexus/zagreb', title: 'Explore Zagreb' },
  { key: 'mine', label: 'My Plexus', to: '/app/plexus/mine', title: 'My Plexus' }
];
const FORM = '/plexus';                      // the ONE server-rendered registration form (README: never rebuild)
const formUrl = pick => `${FORM}?pick=${encodeURIComponent(pick)}&src=portal`; // ?pick is the requested preselect param; ignored harmlessly until server.js adds it
const EXPORT_PHOTOS = ['photo-hall.jpg', 'photo-ballroom.jpg', 'photo-candlelit.jpg', 'photo-stage.jpg', 'photo-gala.jpg', 'photo-bridges.jpg'];
const MOMENT_ALTS = ['The Plexus hall during a keynote', 'The Emerald Ballroom set for the Gala', 'Guests in conversation', 'A panel on the Plexus stage', 'The Gala Evening', 'A Building Bridges evening'];
const WD3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ---- COPY: every string that may change in a revision (dates/prices/venues live via API + FACTS) --
export const COPY = {
  crumb: { projects: 'PROJECTS', plexus: 'PLEXUS WEEK', program: 'PROGRAM &amp; SPEAKERS', zagreb: 'EXPLORE ZAGREB', mine: 'MY PLEXUS &amp; REGISTRATION' },
  live: 'PLEXUS WEEK LIVE →',            // the event app (/app/live) — the phone-first program + my schedule
  liveRow: { title: 'Plexus Week Live' },   // the event app row: Overview only, no sub-line (GLASS-RULES §3.6)
  // The four blocks of one edition (design/MEETUPS-SPEC.md §1) — fed by GET /api/v2/plexus-week/overview
  week: {
    title: 'Plexus Week',
    edition: year => `${year}`, past: 'Past edition',
    archived: 'A past edition — read-only.',
    modalEyebrow: 'PLEXUS WEEK · EDITIONS', modalTitle: 'Past editions',
    modalBody: 'Every Plexus Week is kept. Pick a year to read it back exactly as it stood.',
    current: 'This year', close: 'CLOSE',
    none: 'Only this year exists so far.', noneWhy: 'Each December, the week just gone is archived and the next one opens in its place.',
    soon: 'Opening soon'
  },
  hero: {
    title: 'Plexus <i>Conference</i>',
    // "PRE-REGISTER" sat beside "REGISTER — FREE" on one page while registration was open
    // (UX audit 2026-09-02 › item 6). One verb, and it is the true one.
    register: `${CTA.register} →`, mine: 'MY PLEXUS →'
  },
  countdown: { label: 'Begins in', units: ['days', 'hours', 'min'] },
  facts: {
    firstSession: t => `First session at ${t}`,
    map: 'Map',
    free: 'Free entry', cap: n => `Capped at ${n} seats`,
    add: 'Add',                          // the date row's trailing calendar link (data-act dlIcs, both days and the Gala)
    follow: 'Updates', followSub: on => on ? 'On · email and portal alerts' : 'Off · email and portal alerts'
  },
  band: { icsFile: 'medx-plexus-2026.ics', icsDone: 'Calendar file downloaded — open it to add Plexus to your calendar.' },
  // the stage is a shelf of names (the roles live in the bio sheet and on the Program tab)
  stage: { title: 'Speakers', all: 'All →', emptyLine: 'Speakers are announced as they confirm.' },
  threads: {
    title: 'Threads',
    items: [
      { title: 'Artificial intelligence <i>in medicine</i>' },
      { title: 'The career paths of <i>biomedical leaders</i>' }
    ]
  },
  glance: {
    dayTitles: ['Opening, keynotes &amp; workshops', 'Research, panels &amp; closing keynote'],
    dayGeneric: i => `Conference day ${i}`,
    from: t => `From ${t}`,
    galaTitle: 'Gala Evening &amp; Annual Awards', free: 'Free'
  },
  // the Gala promo card went (it repeated the Gala page): its reserve link moved into the Gala row of the week
  galaBlock: { reserve: price => `${CTA.reserve(price)} →` },
  connect: { title: 'Meet the room' },
  photos: {
    title: 'Moments', all: 'All →', modalEyebrow: 'PLEXUS · PHOTO GALLERY', modalTitle: 'Moments from past conferences',
    pending: 'The team’s full gallery lands here as photos are uploaded — these are moments from past editions.'
  },
  help: { ask: 'Message us' },
  bio: { pending: 'Bio to follow.', sessions: 'Sessions', none: 'No session published for this speaker yet.', add: '＋ Add to my schedule', added: '✓ In my schedule' },
  prog: {
    lede: dates => `${dates} · Novinarski dom, Zagreb`,
    daysTitle: 'The days',
    ics: 'Add to calendar', pdf: 'Program PDF',
    timesNote: 'Final session times are published closer to the event.',
    register: 'Register — free', mine: 'My Plexus', mineSub: 'You are registered · your pass and schedule',
    sessions: n => `${n} session${n === 1 ? '' : 's'}`,
    add: 'Add', added: 'Added',
    spTitle: 'Speakers',
    spEmpty: 'No speakers announced yet.'
  },
  // Glass Quiet (GLASS-RULES §3.6 Zagreb): the ink hero is the title and the one action; notes of five words or fewer
  zagreb: {
    title: 'Dobrodošli u <i>Zagreb</i>',
    guide: 'DOWNLOAD THE GUIDE',
    stopsTitle: 'Six stops',
    stops: [
      { name: 'Ban Jelačić Square', note: 'Five minutes from the venue' },
      { name: 'St. Mark’s Church', note: 'The famous tiled roof' },
      { name: 'Zagreb Cathedral', note: 'Being rebuilt after the 2020 earthquake' },
      { name: 'Dolac Market', note: 'Red umbrellas, morning buzz' },
      { name: 'Upper Town', note: 'Stone Gate, hand-lit gas lamps' },
      { name: 'Tkalčićeva Street', note: 'Café-lined and lively till late' }
    ],
    bonus: { title: 'Advent in Zagreb', note: 'Europe’s best Christmas market, three years running' },
    tasteTitle: 'Taste Zagreb',
    taste: [
      { name: 'Štrukli', note: 'Dough, fresh cheese, sour cream' },
      { name: 'Ćevapi', note: 'Flatbread, onion, ajvar' },
      { name: 'Croatian wine', note: 'Graševina, then Plavac Mali' },
      { name: 'Craft beer', note: 'The Garden, Zmajska, Nova Runda' }
    ],
    aroundTitle: 'Getting around',
    around: [
      { icon: 'user', v: 'On foot · the centre is compact' },
      { icon: 'globe', v: 'Blue trams · ZET app' },
      { icon: 'pin', v: 'Bolt &amp; Uber · also from the airport' }
    ],
    guideDone: 'The welcome guide opened in a new tab — save it for December.'
  },
  mine: {
    // the seat states only (the seg says My Plexus, the facts rows say the dates and prices)
    lede: {
      galaPending: 'Seat requested. A payment link follows.',
      galaApproved: 'Seat approved. Pay to confirm it.',
      galaPaid: 'All set.'
    },
    register: `${CTA.register} →`, addGala: 'ADD THE GALA →', pay: 'PAY FOR YOUR SEAT →', tickets: 'MY TICKETS →',
    ctaSub: { pay: 'Secure card payment · Stripe' },
    facts: { conference: 'Conference', confSub: 'Free entry', gala: 'Gala Evening', galaSub: (p, l, p2) => `${p} until ${l}, ${p2} after` },
    includedTitle: "What's included",
    confCard: {
      title: 'Plexus Conference', tag: 'Free', tagDone: 'Registered',
      items: ['Keynotes, panels and research sessions', 'Certificate of attendance'],
      cta: `${CTA.register} →`, ctaDone: 'VIEW TICKET →'
    },
    galaCard: {
      title: 'Gala Evening <i>&amp;</i> Awards', price: p => `${p} per guest`, tagPaid: 'Seat paid', tagPending: 'SEAT REQUESTED', tagApproved: 'Approved · pay now',
      items: ['Five-course dinner with wine pairing', 'The Med&amp;X Annual Awards', 'Live music', 'Black tie'],
      cta: price => `${CTA.reserve(price)} →`, ctaPay: 'PAY FOR YOUR SEAT →', ctaPaid: 'VIEW TICKET →'
    },
    knowTitle: 'Good to know',
    know: [
      { title: 'Seats are capped', note: (p, l, p2) => `Book by ${l} for ${p}. After that, ${p2}. Gala seats go first.` },
      // UX audit 2026-09-02 › item 15: the transfer control is offered only to a member who holds something.
      { title: 'Transfer to a colleague',
        note: (p, l, p2, holds) => (holds
          ? 'Seats are non-refundable. You can transfer your seat to a colleague up to the day of the event.'
          : 'Seats are non-refundable. Once you hold one, you can transfer it to a colleague up to the day of the event.'),
        act: 'transfer', actLabel: 'Transfer →', actLabelSeat: 'Transfer your seat →' }
    ],
    passTitle: 'My pass',
    passEmptyLine: 'No pass yet.',
    passNote: 'One QR for everything you registered for, also in <a href="/app/me">My Med&amp;X</a> and your phone wallet.',
    whoTitle: 'Attendees', attending: n => `${n} attending`,
    whoEmptyLine: 'No public attendees yet.',
    message: 'Message', findMore: 'Find attendees',
    transfer: {
      eyebrow: 'PLEXUS · TICKET TRANSFER', title: 'Transfer to a colleague',
      body: 'The team approves every transfer. Your colleague takes over the registration exactly as it stands.',
      name: 'COLLEAGUE’S FULL NAME', email: 'COLLEAGUE’S EMAIL', reason: 'REASON (OPTIONAL)',
      ok: 'REQUEST TRANSFER', cancel: 'KEEP MY TICKET',
      sent: 'Transfer requested — the team confirms it by email.', need: 'A full name and a valid email are needed.',
      noReg: 'Register first — a transfer needs a ticket to pass on.',
      // Gala seat — self-serve, immediate (POST /api/v2/transfer/gala, backend/v2/transfer.js)
      policy: 'Seats are non-refundable. You can transfer yours to a colleague up to the day of the event.',
      galaEyebrow: 'GALA · SEAT TRANSFER', galaTitle: 'Transfer your seat',
      galaBody: 'Your Gala seat — same registration, same QR — moves to your colleague the moment you confirm.',
      galaOk: 'TRANSFER MY SEAT →', galaCancel: 'KEEP MY SEAT',
      galaConfirmEyebrow: 'GALA · FINAL CHECK', galaConfirmTitle: 'Transfer your seat?',
      galaConfirmBody: (name, email) => `<p style="margin:0 0 10px">You are transferring your Gala seat to <strong>${name}</strong> (${email}).</p>
        <ul style="margin:0 0 12px;padding-left:18px;line-height:1.7">
          <li>The QR code moves to ${name} — same seat, now under their name.</li>
          <li>Your ticket stops working the moment you confirm.</li>
          <li>This cannot be undone by you — only the Med&amp;X team can step in.</li>
        </ul>`,
      galaSure: 'YES — TRANSFER IT', galaKeep: 'KEEP MY SEAT',
      galaDone: name => `Your seat now belongs to ${name} — confirmation emails go to you both.`,
      confInstead: 'TRANSFER MY CONFERENCE REGISTRATION INSTEAD →'
    },
    payPending: 'Your seat request is with the team — you get a payment link the moment it is approved.',
    payStripeGone: 'Card payment is not available right now — message us and we send a secure payment link.'
  },
  toasts: {
    followed: 'You follow Plexus now — updates land in your inbox and alerts.',
    unfollowed: 'Plexus updates are off. Turn them back on any time.',
    sessionAdded: t => `Added to your schedule — ${t}.`, sessionRemoved: t => `Removed from your schedule — ${t}.`,
    pdfOpen: 'The program PDF opened in a new tab.',
    icsNone: 'No dates could be exported yet.'
  }
};

// ---------------------------------------------------------------- module state
let D = null, st = null, rootEl = null, unbind = null, timers = [], tab = '', edition = null;
let bioTrap = null;                               // releases the bio sheet's focus trap (ui.trapFocus)
const CACHE = new Map();                          // public reads, 60 s — snappy tab switches
function cget(path, opts) {
  const hit = CACHE.get(path);
  if (hit && Date.now() - hit.at < 60000) return Promise.resolve(hit.v);
  return api.get(path, opts).then(v => { CACHE.set(path, { at: Date.now(), v }); return v; });
}
function ensureCss() {
  if (document.querySelector('link[data-view-css="plexus"]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = '/css/views/plexus.css'; l.setAttribute('data-view-css', 'plexus');
  document.head.appendChild(l);
}

// ---------------------------------------------------------------- date/price helpers
// '4–5 Dec 2026' · '5 Dec 2026' · '30 Nov – 2 Dec 2026'
function shortRange(a, b) {
  const x = fmt.toDate(a), y = fmt.toDate(b);
  if (!x) return '';
  if (!y || x.getTime() === y.getTime()) return `${x.getDate()} ${MON3[x.getMonth()]} ${x.getFullYear()}`;
  if (x.getMonth() === y.getMonth()) return `${x.getDate()}–${y.getDate()} ${MON3[x.getMonth()]} ${x.getFullYear()}`;
  return `${x.getDate()} ${MON3[x.getMonth()]} – ${y.getDate()} ${MON3[y.getMonth()]} ${y.getFullYear()}`;
}
function dayMon(iso) { const d = fmt.toDate(iso); return d ? `${d.getDate()} ${MON3[d.getMonth()]}` : ''; }
function hhmm(t) { const m = String(t || '').match(/(\d{1,2}):(\d{2})/); return m ? `${m[1].padStart(2, '0')}:${m[2]}` : ''; }
function eachDay(a, b) {
  const out = []; const x = fmt.toDate(a), y = fmt.toDate(b) || x;
  if (!x) return out;
  for (let d = new Date(x); d <= y && out.length < 6; d.setDate(d.getDate() + 1)) out.push(new Date(d));
  return out;
}
function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z]/g, ''); }
const mapUrl = q => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;

// ---------------------------------------------------------------- data
async function load(t) {
  const want = {
    site: cget('/api/public/site', { noAuth: true }),
    status: cget('/api/public/status', { noAuth: true }),
    conf: cget('/api/plexus/conference', { noAuth: true }),
    gala: cget('/api/gala/settings', { noAuth: true }),
    speakers: cget('/api/plexus/speakers', { noAuth: true }),
    schedule: cget('/api/plexus/schedule', { noAuth: true }),
    meta: cget('/api/v2/plexus/speaker-meta', { noAuth: true }),
    topics: api.get('/api/notify-topics'),
    next: api.get('/api/me/next-event'),
    live: cget('/api/live/events', { noAuth: true })          // the conference's first session: countdown + copy
  };
  if (t === '' || t === 'program') { want.mySched = api.get('/api/plexus/my-schedule'); }
  if (t === '') {
    want.impact = cget('/api/public/impact', { noAuth: true }); want.photos = cget('/api/plexus/photos', { noAuth: true });
    // The week itself: edition + the four blocks, member-scoped (it counts the meetups you hold), so
    // never cached. ?edition=<id> reads a past one back, read-only.
    want.week = edition
      ? api.get(`/api/v2/plexus-week/overview?edition=${encodeURIComponent(edition)}`)
      : api.get('/api/v2/plexus-week/overview');
  }
  if (t === 'zagreb') { want.resources = cget('/api/plexus/resources', { noAuth: true }); }
  if (t === 'mine') {
    want.myReg = api.get('/api/plexus/my-registration');
    want.galaMine = api.get('/api/gala/my-status');
    want.events = api.get('/api/my/events');
    want.attendees = api.get('/api/plexus/attendees');
  }
  const r = await api.settle(want);
  // One price truth for the whole portal: the week overview carries the gala block the /plexus form
  // actually charges by, deadline included (facts.js › setLiveGalaPrice).
  if (r.week && r.week.gala_price) setLiveGalaPrice(r.week.gala_price);

  const conf = (r.site && r.site.conference) || {};
  const confFull = r.conf || {};
  const projects = {}; ((r.status && r.status.projects) || []).forEach(p => { projects[p.project_key] = p; });
  const gala = r.gala || {};
  const galaEbDeadline = gala.early_bird_deadline || FACTS.gala.priceFlip;
  const today = new Date().toISOString().slice(0, 10);
  const ebActive = today <= String(galaEbDeadline).slice(0, 10);
  const sitePrice = r.site && r.site.price && Number(r.site.price.current);
  const galaPrice = Number.isFinite(sitePrice) && sitePrice > 0 ? sitePrice
    : (ebActive ? Number(gala.price_gala_early_bird) : Number(gala.price_gala_regular)) || galaPriceNow();
  const galaRegular = Number(gala.price_gala_regular) || FACTS.gala.priceRegular;
  const galaVenueFull = String(gala.venue || `${FACTS.gala.venue} ${FACTS.gala.city}`).replace(/;/g, ',');
  const galaVenueShort = galaVenueFull.split(',')[0].replace(/emerald ballroom/i, '').trim() || FACTS.gala.venue;
  const sessions = ((r.schedule && r.schedule.sessions) || []).slice();
  const speakers = (Array.isArray(r.speakers) ? r.speakers : []).slice();
  const galaSpeakerNames = (Array.isArray(gala.speakers) ? gala.speakers : []).map(g => norm(g.name));
  const liveConf = ((r.live && r.live.events) || []).find(e => e && e.key === 'conference') || null;

  const start = conf.start_date || confFull.start_date || FACTS.plexus.start;
  const end = conf.end_date || confFull.end_date || FACTS.plexus.end;
  return {
    tab: t,
    week: r.week || null,
    conf: {
      name: conf.name || confFull.name || FACTS.plexus.name,
      year: conf.year || confFull.year || FACTS.year,
      start, end,
      range: conf.date_range || fmt.longRange(start, end),
      venue: conf.venue_name || confFull.venue_name || FACTS.plexus.venue,
      city: conf.venue_city || confFull.venue_city || FACTS.plexus.city,
      address: (liveConf && liveConf.address) || '',
      open: conf.registration_open !== undefined ? !!conf.registration_open : true,
      cap: Number(confFull.max_capacity) || null,
      spotsLeft: Number.isFinite(Number(confFull.spots_remaining)) ? Number(confFull.spots_remaining) : null,
      startTime: plexusStartTime(r.live)
    },
    countdownTo: plexusStartsAt(r.live, start),
    statusLabel: fmt.detail((projects.plexus || {}).status_label || 'Pre-registration open'),
    gala: {
      title: gala.title || `Plexus Gala Evening ${FACTS.year}`,
      date: gala.date || FACTS.gala.date, time: hhmm(gala.time) || FACTS.gala.time,
      venueFull: galaVenueFull, venueShort: galaVenueShort,
      price: galaPrice, priceRegular: galaRegular, ebDeadline: galaEbDeadline, ebActive,
      speakers: galaSpeakerNames,
      people: Array.isArray(gala.speakers) ? gala.speakers.filter(g => g && g.name) : []
    },
    sessions, speakers,
    meta: (r.meta && r.meta.meta) || {},
    followed: ((r.topics && r.topics.projects) || []).includes('plexus'),
    next: r.next || {},
    mySched: new Set(((Array.isArray(r.mySched) ? r.mySched : []).map(s => s.id))),
    impact: r.impact || null,
    photos: Array.isArray(r.photos) ? r.photos : [],
    resources: Array.isArray(r.resources) ? r.resources : [],
    myReg: r.myReg && r.myReg.id && r.myReg.status !== 'cancelled' ? r.myReg : null,
    galaReg: (() => {
      const g = r.galaMine && r.galaMine.registered && r.galaMine.registration;
      if (!g || ['declined', 'rejected', 'cancelled'].includes(String(g.status || '').toLowerCase())) return null;
      return g;
    })(),
    events: (r.events && r.events.upcoming) || [],
    attendees: (Array.isArray(r.attendees) ? r.attendees : []).filter(a => a.id !== (session.user || {}).id)
  };
}

function galaState() {
  const g = D.galaReg;
  if (!g) return 'none';
  const s = String(g.status || '').toLowerCase();
  if (g.payment_status === 'paid' || s === 'confirmed' || s === 'vip-comp') return 'paid';
  if (s === 'approved') return 'approved';
  return 'pending';                                          // pending / awaiting_payment / …
}
function speakerRole(sp) {
  const t = String(sp.title || '').trim(), inst = String(sp.institution || '').trim();
  const joined = t && inst && !norm(t).includes(norm(inst)) ? `${t}, ${inst}` : (t || inst);
  return joined.replace(/\s*;\s*/g, ' · ');
}
function speakerSessions(sp) {
  return D.sessions.filter(s => String(s.speaker_ids || '').split(',').map(x => x.trim()).includes(sp.id));
}
function icsEvents() {
  const evs = [];
  eachDay(D.conf.start, D.conf.end).forEach((d, i, arr) => {
    const next = new Date(d); next.setDate(d.getDate() + 1);
    evs.push({ uid: `plexus-${D.conf.year}-day${i + 1}`, start: fmt.ymd(d), end: fmt.ymd(next), summary: arr.length > 1 ? `${D.conf.name} — Day ${i + 1}` : D.conf.name, location: `${D.conf.venue}, ${D.conf.city}` });
  });
  const g = fmt.toDate(D.gala.date);
  if (g) { const gn = new Date(g); gn.setDate(g.getDate() + 1); evs.push({ uid: `plexus-gala-${D.conf.year}`, start: fmt.ymd(g), end: fmt.ymd(gn), summary: D.gala.title, location: D.gala.venueFull, description: `From ${D.gala.time} · Black tie` }); }
  return evs;
}

// ---------------------------------------------------------------- kit helpers (DESIGN-RULES §10)
const icon = (n, s) => ui.icon(n, s || 20);
const chev = () => ui.icon('chevron-right', 18);
// a section head: the title (at most three words) and an optional right link. No numerals (GLASS-RULES Q2).
function sectionHead(title, right) {
  return `<div class="mx-sh"><h2 class="mx-sh-t">${title}</h2>${right || ''}</div>`;
}
// a trailing text action inside a facts row (the date row's "Add" to calendar), the same data-act as the old row
function factAct(act, label) {
  return `<span class="mx-fact-go" data-act="${act}" role="button" tabindex="0">${label}</span>`;
}
// Q9: a person shows a name and ONE short line, the institution when the role holds one, else the role. The full
// title lives in the bio sheet.
function shortRole(sp) {
  const inst = String(sp.institution || '').trim();
  if (inst) return inst;
  const role = speakerRole(sp);
  return role.includes(',') ? role.slice(role.lastIndexOf(',') + 1).trim() : role;
}
function fact({ ic, v, s, go, act, attrs }) {
  const open = act ? `<li class="mx-fact" data-act="${act}"${attrs || ''}>` : '<li class="mx-fact">';
  return `${open}${icon(ic)}<div class="mx-fact-body"><span class="mx-fact-v">${v}</span>${s ? `<span class="mx-fact-s">${s}</span>` : ''}</div>${go || ''}</li>`;
}
function listRow({ href, act, ic, l, s, attrs }) {
  const inner = `${icon(ic)}<span class="mx-row-l">${l}${s ? `<span class="mx-row-s">${s}</span>` : ''}</span>${chev()}`;
  return href ? `<a class="mx-row" href="${href}"${attrs || ''}>${inner}</a>` : `<span class="mx-row" data-act="${act}" role="button"${attrs || ''}>${inner}</span>`;
}
// Q5: one row, "Updates", with the switch (the switch shows the state, so no sub-line)
function followFact(label) {
  return `<li class="mx-fact" data-block="follow">${icon('bell')}<div class="mx-fact-body"><span class="mx-fact-v">${COPY.facts.follow}</span></div><span data-act="tgFollow" role="switch" aria-checked="${D.followed}" aria-label="${esc(label)}" class="mx-switch"><span></span></span></li>`;
}

// ---------------------------------------------------------------- shared blocks
function crumb(items) {
  const sep = '<span style="color:rgba(25,21,18,.35);font-size:12px">→</span>';
  return `
  <!-- dc: Plexus Conference.dc.html › "Breadcrumb" (desktop; phones carry back in the top bar) -->
  <div class="mx-crumbs mx-gutter" style="display:flex;align-items:center;gap:13px;padding:10px 36px;border-bottom:1px solid rgba(25,21,18,.16);flex-wrap:wrap">
    ${items.map((it, i) => (i ? sep + '\n    ' : '') + (it.to
      ? `<a href="${it.to}" data-dir="back" style="font:600 12px Inter,sans-serif;letter-spacing:.12em;color:#4a4239" data-hover="color:#191512">${it.label}</a>`
      : `<span style="font:600 12px Inter,sans-serif;letter-spacing:.12em;color:${i ? '#191512' : '#4a4239'}">${it.label}</span>`)).join('\n    ')}
    <div style="flex:1"></div>
  </div>
  <!-- /dc -->`;
}
// the four tabs as one segmented control (data-tabs keeps it lit and still while a tab changes). The event app row
// sits under it on the Overview only (GLASS-RULES §3.6)
function tabStrip(withLive) {
  return `
  <section class="mx-sec mx-sec--tight mx-px-nav">
    <nav class="mx-seg mx-px-seg" data-tabs="plexus" aria-label="Plexus">
      ${TABS.map(t => t.key === tab
        ? `<span class="is-on" aria-current="page">${t.label}</span>`
        : `<a href="${t.to}">${t.label}</a>`).join('\n      ')}
    </nav>
    ${withLive ? `<a href="/app/live" class="mx-linkcard mx-px-live" data-v2="Plexus Week Live — the event app (docs/EVENT-APP-BRIEF.md)" aria-label="${esc(COPY.live.replace(' →', ''))}">${icon('sparkle')}<span class="mx-row-l">${COPY.liveRow.title}</span>${chev()}</a>` : ''}
  </section>`;
}
function blockHelp() {
  return `
  <!-- dc: Plexus Conference.dc.html › "Message us" -->
  <section class="mx-sec">
    <div class="mx-list">${listRow({ href: '/app/messages?about=plexus', ic: 'mail', l: COPY.help.ask })}</div>
  </section>
  <!-- /dc -->`;
}
function blockBio() {
  if (!st.bio) return '';
  const sp = D.speakers.find(s => s.id === st.bio);
  if (!sp) return '';
  const sess = speakerSessions(sp);
  const name = fmt.person(sp.name);
  // the program's speaker rows carry no bio yet; the Gala's roster does for the same people — use it rather than "bio to follow"
  const key = portraitKey(sp);
  const twin = !sp.bio && D.gala.people.find(g => (key && portraitKey(g) === key) || norm(g.name) === norm(sp.name));
  const bio = sp.bio || (twin && twin.bio) || '';
  return `
  <!-- dc: Plexus Conference.dc.html › "Bio modal" -->
  <div data-role="bio-scrim" role="dialog" aria-modal="true" aria-label="Speaker bio" class="mx-bio-scrim">
    <div class="mx-bio-sheet mx-glass mx-glass--sheet">
      <span data-act="bioClose" role="button" tabindex="0" aria-label="Close" class="mx-gbtn mx-bio-x">${icon('x')}</span>
      <div class="mx-bio-scroll">
      <div class="mx-bio-head">
        ${ui.portrait({ name, src: portraitSrc(sp), size: 96, alt: '' })}
        <div class="mx-bio-name">${esc(name)}</div>
        <div class="mx-bio-role">${esc(speakerRole(sp))}</div>
      </div>
      <p class="mx-bio-text">${bio ? esc(bio) : `<i>${esc(COPY.bio.pending)}</i>`}</p>
      <div data-v2="speaker sessions + add-to-my-schedule (Program page wiring map)" class="mx-bio-sess">
        <div class="mx-bio-sess-h">${COPY.bio.sessions}</div>
        ${sess.length ? `<ol class="mx-timeline">${sess.map(s => `
          <li class="mx-tl-row"><time class="mx-tl-time">${esc(hhmm(s.start_time))}</time><div class="mx-tl-body"><span class="mx-tl-title">${esc(s.title || 'Session')}</span>
            <span data-act="tgSession" data-id="${esc(s.id)}" class="mx-px-add${D.mySched.has(s.id) ? ' is-on' : ''}">${D.mySched.has(s.id) ? COPY.bio.added : COPY.bio.add}</span></div></li>`).join('')}</ol>`
          : `<p class="mx-bio-none">${esc(COPY.bio.none)}</p>`}
      </div>
      </div>
    </div>
  </div>
  <!-- /dc -->`;
}
// the stage's speaker: a 96 circle from the bundled crop and the name (the role is in the bio sheet it opens)
function speakerCard(sp) {
  const name = fmt.person(sp.name);
  return `
      <div class="mx-person" data-act="vb" data-id="${esc(sp.id)}" aria-label="${esc(name)}, biography">
        ${ui.portrait({ name, src: portraitSrc(sp), size: 96, alt: '' })}
        <span class="mx-person-name">${esc(name)}</span>
      </div>`;
}

// ---------------------------------------------------------------- OVERVIEW (Plexus Conference.dc.html)
// UX audit 2026-09-02 › item 12: the follow control is one labelled switch — now a row in the facts.
// Glass Quiet (GLASS-RULES §1.9.3, §3.6): on the photo only the title, one line of facts and the one action; the
// countdown rides on the photo as the kit's glass chip ("69 days"), the eyebrow went (the title is the identity cue).
function ovHero() {
  const d1 = fmt.toDate(D.conf.start), d2 = fmt.toDate(D.conf.end);
  const date = d1 ? `${d1.getDate()}${d2 && d2.getTime() !== d1.getTime() ? '–' + d2.getDate() : ''} ${MON3[d1.getMonth()]} · ${D.conf.city}` : D.conf.city;
  return `
  <!-- dc: Plexus Conference.dc.html › "Hero" -->
  <section class="mx-hero mx-ink mx-px-hero">
    <img class="mx-hero-photo mx-px-heroimg" src="/assets/photo-keynote.jpg" alt="">
    <div class="mx-scrim"></div>
    ${ovCountdown()}
    <div class="mx-hero-body">
      <h1 class="mx-hero-title">${COPY.hero.title}</h1>
      <p class="mx-hero-date">${esc(date)}</p>
      <div class="mx-hero-cta">
        ${D.next.registered
          ? `<a href="/app/plexus/mine" class="btn-gold btn-block">${COPY.hero.mine}</a>`
          : `<a href="${formUrl('conference')}" class="btn-gold btn-block">${COPY.hero.register}</a>`}
      </div>
    </div>
  </section>
  <!-- /dc -->`;
}
// the kit draws it as a dark glass chip on the photo at phone width and as the band under the hero from 501px; the
// label and the hours and minutes cells stay in the DOM for the timer (startCountdown adds .is-final on the last day)
function ovCountdown() {
  const cell = (id, unit) => `<span class="mx-cd-cell"><b class="mx-cd-num" data-cd="${id}">—</b><i class="mx-cd-unit">${unit}</i></span>`;
  return `<div class="mx-countdown mx-countdown--chip" role="timer" aria-label="Time until Plexus begins">
      <span class="mx-cd-label">${COPY.countdown.label}</span>
      ${cell('days', COPY.countdown.units[0])}${cell('hrs', COPY.countdown.units[1])}${cell('min', COPY.countdown.units[2])}
    </div>`;
}
function ovFacts() {
  const d1 = fmt.toDate(D.conf.start), d2 = fmt.toDate(D.conf.end);
  const long = d1 ? `${WD3[d1.getDay()]} ${d1.getDate()}${d2 && d2.getTime() !== d1.getTime() ? ` – ${WD3[d2.getDay()]} ${d2.getDate()}` : ''} ${d1.toLocaleDateString('en-GB', { month: 'long' })} ${d1.getFullYear()}` : D.conf.range;
  const where = `${D.conf.venue}, ${D.conf.city}`;
  return `
  <section class="mx-sec" data-block="facts">
    <ul class="mx-facts">
      ${fact({ ic: 'calendar', v: esc(long), s: esc(COPY.facts.firstSession(D.conf.startTime)), go: factAct('dlIcs', COPY.facts.add) })}
      ${fact({ ic: 'pin', v: esc(D.conf.venue), s: esc(D.conf.address ? D.conf.address : D.conf.city), go: `<a class="mx-fact-go" href="${esc(mapUrl(D.conf.address || where))}" target="_blank" rel="noopener">${COPY.facts.map}</a>` })}
      ${fact({ ic: 'ticket', v: COPY.facts.free, s: D.conf.cap ? esc(COPY.facts.cap(fmt.num(D.conf.cap))) : '' })}
      ${followFact('Get updates from Plexus')}
    </ul>
  </section>`;
}
// ---- PLEXUS WEEK: the four blocks of one edition (design/MEETUPS-SPEC.md §1), as a timeline ----------------
// Each row opens that event's own page. Where the old card's action opened the registration form, that same link
// (same href) is the small button in the row; nothing else about it changed.
function weekCta(b) {
  if (b.key === 'conference') return D.next.registered ? 'MY TICKET' : CTA.register;   // registered: never asked again
  if (b.key === 'gala' && D.next.has_gala) return 'YOUR SEAT';
  if (b.key === 'bridges' && b.status_kind === 'open') return CTA.register;
  if (b.key === 'gala') {
    const p = b.price && Number(b.price.current);
    return CTA.reserve(fmt.eur(Number.isFinite(p) && p > 0 ? p : galaPriceNow()));
  }
  return fmt.upper(b.cta_label || 'Open');
}
const WEEK_PAGE = { conference: '/app/plexus/program', gala: '/app/gala', bridges: '/app/bridges', meetups: '/app/plexus/meetups' };
function weekRow(b) {
  // an open sign-up goes straight to the form with that event ticked — the server's targets were the
  // program page (conference: nothing to register there) and /app/bridges (Zagreb isn't listed there)
  const to = b.key === 'conference' && D.next.registered ? '/app/plexus/mine'
    : (b.status_kind === 'open' && (b.key === 'conference' || b.key === 'bridges')) ? formUrl(b.key) : routeFor(b.cta_target || 'plexus', '/app/plexus');
  const page = WEEK_PAGE[b.key] || routeFor(b.cta_target || 'plexus', '/app/plexus');
  const status = b.key === 'conference' && D.statusLabel ? D.statusLabel : b.status;
  const when = b.starts_on ? dayMon(b.starts_on) : (b.key === 'bridges' ? 'Dec' : '');
  const range = String(b.date_label || '').match(/^(\d{1,2})\s*[–-]\s*(\d{1,2})\s+([A-Za-z]{3})/);
  const time = range ? `${range[1]}–${range[2]} ${range[3]}` : when;
  const own = !D.week.archived && to !== page && (to.startsWith(FORM) || to === '/app/plexus/mine')
    ? `<a href="${esc(to)}" class="btn-ghost btn-sm mx-px-weekbtn">${esc(weekCta(b))} →</a>` : '';
  // the Gala row carries the reserve link the removed Gala promo card held (same href, same label, GLASS-RULES §3.5)
  const act = own || (b.key === 'gala' && !D.week.archived
    ? `<a href="${formUrl('gala')}" class="btn-ghost btn-sm mx-px-weekbtn">${COPY.galaBlock.reserve(fmt.eur(D.gala.price))}</a>` : '');
  // say it once: a row whose button already reads "Register — free" drops the "Free to attend" price line
  const priceLine = b.key === 'gala' || (act && /free/i.test(weekCta(b)) && /free/i.test(b.price_label || '')) ? '' : fmt.detail(b.price_label || '');
  // the sub-line keeps a fact only (the Gala's price line). A status the row's own button already says goes
  // ("Pre-registration open", "Registration open"), and "Tables opening soon" is "Opening soon"
  const statusTxt = fmt.detail(status || '');
  const sub = b.key === 'gala' ? statusTxt
    : own ? ''
    : (b.status_kind === 'soon' || /\bsoon\b/i.test(statusTxt)) ? COPY.week.soon
    : [statusTxt, priceLine].filter(Boolean).join(' · ');
  if (D.week.archived) return `<li class="mx-tl-row"><time class="mx-tl-time">${esc(time)}</time><div class="mx-tl-body"><span class="mx-tl-title">${esc(b.title || '')}</span><span class="mx-tl-sub">${COPY.week.past}</span></div></li>`;
  return `
      <li class="mx-tl-row mx-px-weekrow"><time class="mx-tl-time">${esc(time)}</time>
        <div class="mx-tl-body"><a class="mx-tl-title mx-px-weeklink" href="${esc(page)}">${esc(b.title || '')}</a>${sub ? `<span class="mx-tl-sub">${esc(sub)}</span>` : ''}${act}</div>
        ${chev()}
      </li>`;
}
function ovWeek() {
  const w = D.week;
  const blocks = w && Array.isArray(w.blocks) ? w.blocks : [];
  if (!w || !blocks.length) return '';
  const year = (w.edition && w.edition.year) || FACTS.year;
  return `
  <!-- v2: Plexus Week — the four blocks of one edition (design/MEETUPS-SPEC.md §1) -->
  <section class="mx-sec" data-block="week" data-v2="plexus-week band, no artboard counterpart">
    ${sectionHead(COPY.week.title, `<span data-act="editions" aria-haspopup="dialog" class="mx-sh-ctl mx-px-year" role="button">${esc(COPY.week.edition(year))} ${icon('chevron-down', 14)}</span>`)}
    ${w.archived ? `<p class="mx-sh-sub">${COPY.week.archived}</p>` : ''}
    <ol class="mx-timeline mx-timeline--wide mx-px-week">${blocks.map(weekRow).join('')}</ol>
  </section>`;
}
// a shelf of 96 circles with names (Q8: never more than a screen of cards; the roles live in the bio sheet)
function ovStage() {
  return `
  <!-- dc: Plexus Conference.dc.html › "01 · ON THE PLEXUS STAGE" -->
  <section class="mx-sec" data-block="stage">
    ${sectionHead(COPY.stage.title, `<a class="mx-sh-a" href="/app/plexus/program">${COPY.stage.all}</a>`)}
    ${D.speakers.length
      ? `<div class="mx-shelf mx-px-stage" style="--w:120px">${D.speakers.map(sp => speakerCard(sp)).join('')}</div>`
      : `<div class="empty"><span class="empty-line">${esc(COPY.stage.emptyLine)}</span></div>`}
  </section>
  <!-- /dc -->`;
}
function ovThreads() {
  return `
  <!-- dc: Plexus Conference.dc.html › "02 · THIS YEAR'S THREADS" -->
  <section class="mx-sec" data-block="threads">
    ${sectionHead(COPY.threads.title)}
    <div class="mx-px-threads">
      ${COPY.threads.items.map(t => `
      <div class="mx-px-thread"><span class="mx-px-thread-t">${t.title}</span></div>`).join('')}
    </div>
  </section>
  <!-- /dc -->`;
}
function ovConnect() {
  return `
  <!-- dc: Plexus Conference.dc.html › "04 · CONNECT WITH PARTICIPANTS" -->
  <section class="mx-sec mx-sec--tight" data-block="connect">
    <a href="/app/network" class="mx-linkcard">${icon('users')}<span class="mx-row-l">${COPY.connect.title}</span>${chev()}</a>
  </section>
  <!-- /dc -->`;
}
function ovPhotos() {
  const pics = [0, 1, 2, 3];
  return `
  <!-- dc: Plexus Conference.dc.html › "MOMENTS FROM PAST CONFERENCES" -->
  <section class="mx-sec" data-block="photos">
    ${sectionHead(COPY.photos.title, `<span class="mx-sh-a" data-act="gallery" data-i="0">${COPY.photos.all}</span>`)}
    <div class="mx-shelf mx-px-shelf" style="--w:240px">
      ${pics.map(i => `<div class="mx-shelf-item"><div class="mx-media r-4x3 mx-ph" data-act="gallery" data-i="${i}" role="button" aria-label="Open photo ${i + 1}"><img src="/assets/${EXPORT_PHOTOS[i]}" alt="${esc(MOMENT_ALTS[i])}" loading="lazy"></div></div>`).join('')}
    </div>
  </section>
  <!-- /dc -->`;
}
function overviewTpl() {
  return `
<div data-screen-label="Plexus Week" class="mx-px">
  ${crumb([{ label: COPY.crumb.projects, to: '/app/projects' }, { label: COPY.crumb.plexus, current: true }])}
  <div data-block="hero">${ovHero()}</div>
  <div class="mx-p">
    ${tabStrip(true)}
    ${ovFacts()}
    ${ovWeek()}
    ${ovStage()}
    ${ovThreads()}
    ${ovConnect()}
    ${ovPhotos()}
    ${blockHelp()}
  </div>
  <div data-block="bio">${blockBio()}</div>
</div>`;
}

// ---------------------------------------------------------------- PROGRAM (Plexus Program.dc.html)
function progDays() {
  const days = eachDay(D.conf.start, D.conf.end);
  const anySessions = D.sessions.length > 0;
  const parts = [];
  days.forEach((d, i) => {
    const sess = D.sessions.filter(s => Number(s.day || 1) === i + 1);
    const open = !!st.dayOpen[i];
    const first = sess.length ? hhmm(sess[0].start_time) : '';
    const last = sess.length ? hhmm(sess[sess.length - 1].end_time || sess[sess.length - 1].start_time) : '';
    // a day with no published session shows its title only ("In preparation" said nothing the empty row does not)
    const right = sess.length ? (first && last && first !== last ? `${first} – ${last}` : (first ? COPY.glance.from(first) : '')) : '';
    const sub = sess.length ? [right, COPY.prog.sessions(sess.length)].filter(Boolean).join(' · ') : '';
    parts.push(`
        <li ${sess.length ? `data-act="tgDay" data-day="${i}" aria-expanded="${open}"` : ''} class="mx-tl-row mx-day-row">
          <time class="mx-tl-time">${esc(`${WD3[d.getDay()]} ${d.getDate()}`)}</time>
          <div class="mx-tl-body"><span class="mx-tl-title">${COPY.glance.dayTitles[i] || COPY.glance.dayGeneric(i + 1)}</span>${sub ? `<span class="mx-tl-sub">${esc(sub)}</span>` : ''}</div>
          ${sess.length ? icon(open ? 'chevron-down' : 'chevron-right', 18) : ''}
        </li>`);
    if (sess.length && open) parts.push(`
        <li class="mx-px-sessions">
          <ol class="mx-timeline">
          ${sess.map(s => `
            <li class="mx-tl-row"><time class="mx-tl-time">${esc(hhmm(s.start_time))}</time><div class="mx-tl-body"><span class="mx-tl-title">${esc(s.title || 'Session')}</span>${s.room ? `<span class="mx-tl-sub">${esc(s.room)}</span>` : ''}
              <span data-act="tgSession" data-id="${esc(s.id)}" data-v2="add-to-my-schedule" class="mx-px-add${D.mySched.has(s.id) ? ' is-on' : ''}">${D.mySched.has(s.id) ? COPY.prog.added : COPY.prog.add}</span></div></li>`).join('')}
          </ol>
          <p class="mx-px-note">${COPY.prog.timesNote}</p>
        </li>`);
    // Welcome-reception interstitial row after day 1 — only from a published session
    if (i === 0) {
      const rec = D.sessions.find(s => /reception|networking|social/i.test(`${s.session_type} ${s.title}`));
      if (rec) parts.push(`
        <li class="mx-tl-row"><time class="mx-tl-time">${esc(`${WD3[d.getDay()]} ${d.getDate()}`)}</time><div class="mx-tl-body"><span class="mx-tl-title">${esc(rec.title)}</span><span class="mx-tl-sub">${esc(`${hhmm(rec.start_time) || '18:00'} · ${COPY.glance.free}`)}</span></div></li>`);
    }
  });
  const gd = fmt.toDate(D.gala.date);
  parts.push(`
        <li class="mx-tl-row is-gold"><time class="mx-tl-time">${esc(gd ? `${WD3[gd.getDay()]} ${gd.getDate()}` : 'Sat')}</time><div class="mx-tl-body"><span class="mx-tl-title">${COPY.glance.galaTitle}</span><span class="mx-tl-sub">${esc(`${D.gala.time} · ${D.gala.venueShort}`)}</span></div></li>`);
  return { html: parts.join(''), anySessions };
}
function daysBlock() {
  const { html } = progDays();
  return `<div data-block="days"><ol class="mx-timeline mx-timeline--wide mx-px-days">${html}</ol></div>`;
}
function progSpeakers() {
  return D.speakers.length
    ? `<div class="mx-person-rows">${D.speakers.map(sp => {
        const name = fmt.person(sp.name);
        return `<div class="mx-person-row" data-act="vb" data-id="${esc(sp.id)}" aria-label="${esc(name)}, biography">${ui.portrait({ name, src: portraitSrc(sp), size: 64, alt: '' })}<span class="mx-person-text"><span class="mx-person-name">${esc(name)}</span><span class="mx-person-role">${esc(shortRole(sp))}</span></span>${chev()}</div>`;
      }).join('')}</div>`
    : `<div class="empty"><span class="empty-line">${esc(COPY.prog.spEmpty)}</span></div>`;
}
function programTpl() {
  return `
<div data-screen-label="Plexus Program" class="mx-px">
  ${crumb([{ label: COPY.crumb.projects, to: '/app/projects' }, { label: COPY.crumb.plexus, to: '/app/plexus' }, { label: COPY.crumb.program }])}
  <div class="mx-p">
    ${tabStrip(false)}
    <!-- the seg says Program: the page opens on its facts line, then the days -->
    <p class="mx-lede mx-px-lede">${esc(COPY.prog.lede(shortRange(D.conf.start, D.conf.end)))}</p>
    <!-- dc: Plexus Program.dc.html › "01 · THE PROGRAM" -->
    <section class="mx-sec" data-block="program">
      ${sectionHead(COPY.prog.daysTitle)}
      ${daysBlock()}
      <div class="mx-list mx-px-actions">
        ${listRow({ act: 'dlIcs', ic: 'calendar', l: COPY.prog.ics })}
        ${listRow({ act: 'pdf', ic: 'download', l: COPY.prog.pdf })}
        ${D.next.registered
          ? listRow({ href: '/app/plexus/mine', ic: 'ticket', l: COPY.prog.mine, s: COPY.prog.mineSub })
          : listRow({ href: formUrl('conference'), ic: 'ticket', l: COPY.prog.register })}
      </div>
    </section>
    <!-- /dc -->
    <!-- dc: Plexus Program.dc.html › "02 · SPEAKERS" -->
    <section class="mx-sec" data-block="speakers">
      ${sectionHead(COPY.prog.spTitle)}
      ${progSpeakers()}
    </section>
    <!-- /dc -->
    ${blockHelp()}
  </div>
  <div data-block="bio">${blockBio()}</div>
</div>`;
}

// ---------------------------------------------------------------- ZAGREB (Plexus Zagreb.dc.html)
// No Zagreb landmark or food photography exists in frontend-v2/assets/ or the medx.hr mirror (UX audit
// 2026-09-02 › item 7), so this tab is type and rows only: an ink hero, numbered stops, taste tiles, getting around.
function zagrebTpl() {
  const Z = COPY.zagreb;
  return `
<div data-screen-label="Explore Zagreb" class="mx-px">
  ${crumb([{ label: COPY.crumb.projects, to: '/app/projects' }, { label: COPY.crumb.plexus, to: '/app/plexus' }, { label: COPY.crumb.zagreb }])}
  <div class="mx-p">
    ${tabStrip(false)}
  </div>
  <!-- dc: Plexus Zagreb.dc.html › "Hero" (the title and the one action) -->
  <section class="mx-hero mx-hero--ink mx-ink mx-px-zghero">
    <div class="mx-hero-body">
      <h1 class="mx-hero-title">${Z.title}</h1>
      <div class="mx-hero-cta"><span data-act="guide" role="button" class="btn-gold btn-block">${Z.guide}</span></div>
    </div>
  </section>
  <!-- /dc -->
  <div class="mx-p">
    <!-- dc: Plexus Zagreb.dc.html › "01 · SIX STOPS BEFORE DINNER" (no numerals: a list of places, not steps) -->
    <section class="mx-sec" data-block="stops">
      ${sectionHead(Z.stopsTitle)}
      <ol class="mx-timeline mx-px-stops">${Z.stops.map(s => `<li class="mx-tl-row"><div class="mx-tl-body"><span class="mx-tl-title">${esc(s.name)}</span><span class="mx-tl-sub">${esc(s.note)}</span></div></li>`).join('')}</ol>
      <ul class="mx-facts mx-px-advent">${fact({ ic: 'star', v: esc(Z.bonus.title), s: esc(Z.bonus.note) })}</ul>
    </section>
    <!-- /dc -->
    <!-- dc: Plexus Zagreb.dc.html › "02 · TASTE ZAGREB" -->
    <section class="mx-sec" data-block="taste">
      ${sectionHead(Z.tasteTitle)}
      <div class="mx-px-taste">${Z.taste.map(t => `<div class="mx-px-tile"><span class="mx-px-tile-t">${esc(t.name)}</span><span class="mx-px-tile-b">${esc(t.note)}</span></div>`).join('')}</div>
    </section>
    <!-- /dc -->
    <!-- dc: Plexus Zagreb.dc.html › "03 · GETTING AROUND" -->
    <section class="mx-sec" data-block="around">
      ${sectionHead(Z.aroundTitle)}
      <ul class="mx-facts">${Z.around.map(a => fact({ ic: a.icon, v: a.v })).join('')}</ul>
    </section>
    <!-- /dc -->
    ${blockHelp()}
  </div>
</div>`;
}

// ---------------------------------------------------------------- MY PLEXUS (My Plexus.dc.html)
function mineState() {
  const reg = !!D.myReg || !!D.next.registered;
  const g = galaState();
  if (g === 'paid') return 'galaPaid';
  if (g === 'approved') return 'galaApproved';
  if (g === 'pending') return 'galaPending';
  return reg ? 'registered' : 'none';
}
// the seat state (only while a Gala seat is in play) · ONE action (the same hrefs and data-act as before) · the facts.
// The seg says My Plexus, so no title; the only sub-line under the action is the pay one (it says where the card goes).
function mineHero() {
  const s = mineState();
  const lede = COPY.mine.lede[s] || '';
  let cta, sub = '';
  if (s === 'none') cta = `<a href="${formUrl('conference,gala')}" class="btn-primary btn-block">${COPY.mine.register}</a>`;
  else if (s === 'registered') cta = `<a href="${formUrl('gala')}" class="btn-primary btn-block">${COPY.mine.addGala}</a>`;
  else if (s === 'galaApproved') cta = `<span data-act="payGala" role="button" class="btn-gold btn-block mx-px-pay">${COPY.mine.pay}</span>`, sub = COPY.mine.ctaSub.pay;
  else cta = `<a href="/app/me" class="btn-primary btn-block">${COPY.mine.tickets}</a>`;
  return `
  <!-- dc: My Plexus.dc.html › "MY PLEXUS · REGISTRATION" -->
  <section class="mx-sec mx-sec--tight" data-block="mine-hero">
    ${lede ? `<p class="mx-lede mx-px-minelede">${lede}</p>` : ''}
    <div class="mx-px-minecta">${cta}${sub ? `<span class="mx-px-minesub">${sub}</span>` : ''}</div>
    <ul class="mx-facts mx-px-minefacts">
      ${fact({ ic: 'calendar', v: `${COPY.mine.facts.conference} · ${esc(shortRange(D.conf.start, D.conf.end))}`, s: COPY.mine.facts.confSub })}
      ${fact({ ic: 'ticket', v: `${COPY.mine.facts.gala} · ${esc(shortRange(D.gala.date, D.gala.date))}`, s: esc(D.gala.ebActive ? COPY.mine.facts.galaSub(fmt.eur(D.gala.price), dayMon(D.gala.ebDeadline), fmt.eur(D.gala.priceRegular)) : fmt.eur(D.gala.price)) })}
    </ul>
  </section>
  <!-- /dc -->`;
}
function mineIncluded() {
  const g = galaState();
  const registered = !!D.myReg || !!D.next.registered;
  const checks = items => `<ul class="mx-checks">${items.map(t => `<li>${icon('check')}<span>${t}</span></li>`).join('')}</ul>`;
  const confCta = registered
    ? `<a href="/app/me" class="btn-ghost btn-sm">${COPY.mine.confCard.ctaDone}</a>`
    : `<a href="${formUrl('conference')}" class="btn-ghost btn-sm">${COPY.mine.confCard.cta}</a>`;
  const galaCta = g === 'paid'
    ? `<a href="/app/me" class="btn-ghost btn-sm">${COPY.mine.galaCard.ctaPaid}</a>`
    : g === 'approved'
    ? `<span data-act="payGala" role="button" class="btn-ghost btn-sm">${COPY.mine.galaCard.ctaPay}</span>`
    : g === 'pending'
    ? `<span data-act="galaPendingInfo" role="button" class="btn-ghost btn-sm">${COPY.mine.galaCard.tagPending}</span>`
    : `<a href="${formUrl('gala')}" class="btn-ghost btn-sm">${COPY.mine.galaCard.cta(fmt.eur(D.gala.price))}</a>`;
  // a state chip only (the price is on the card's own link and in the facts above)
  const galaTag = g === 'paid' ? COPY.mine.galaCard.tagPaid : g === 'approved' ? COPY.mine.galaCard.tagApproved : '';
  return `
  <!-- dc: My Plexus.dc.html › "01 · WHAT'S INCLUDED" -->
  <section class="mx-sec" data-block="included">
    ${sectionHead(COPY.mine.includedTitle)}
    <div class="mx-px-incl">
      <div class="mx-px-inclcard">
        <div class="mx-px-inclhead"><span class="mx-px-incltitle">${COPY.mine.confCard.title}</span>${registered ? `<span class="mx-tag mx-tag--ink">${COPY.mine.confCard.tagDone}</span>` : ''}</div>
        ${checks(COPY.mine.confCard.items)}
        ${confCta}
      </div>
      <div class="mx-px-inclcard">
        <div class="mx-px-inclhead"><span class="mx-px-incltitle">${COPY.mine.galaCard.title}</span>${galaTag ? `<span class="mx-tag ${g === 'paid' ? 'mx-tag--ink' : 'mx-tag--gold'}">${galaTag}</span>` : ''}</div>
        ${checks(COPY.mine.galaCard.items)}
        ${galaCta}
      </div>
    </div>
  </section>
  <!-- /dc -->`;
}
function mineKnow() {
  const registered = !!D.myReg;
  const holdsSomething = registered || !!D.galaReg;
  return `
  <!-- dc: My Plexus.dc.html › "02 · GOOD TO KNOW" -->
  <section class="mx-sec" data-block="know">
    ${sectionHead(COPY.mine.knowTitle)}
    <div class="mx-accs">
      ${COPY.mine.know.map(k => `
      <details class="mx-acc"><summary>${k.title}</summary><div class="mx-acc-a">
        ${esc(k.note(fmt.eur(D.gala.price), fmt.longRange(D.gala.ebDeadline, D.gala.ebDeadline).replace(/, \d{4}$/, ''), fmt.eur(D.gala.priceRegular), holdsSomething))}
        ${k.act === 'transfer' && holdsSomething ? `<br><span data-act="transfer" role="button" class="mx-px-textbtn" data-v2="${D.galaReg ? 'gala seat transfer (POST /api/v2/transfer/gala)' : 'transfer request (POST /api/plexus/registration/:id/transfer)'}">${D.galaReg ? k.actLabelSeat : k.actLabel}</span>` : ''}
      </div></details>`).join('')}
    </div>
  </section>
  <!-- /dc -->`;
}
function minePass() {
  const tickets = D.events.filter(ev => ev.ticket && ['plexus', 'gala'].includes(ev.evt));
  return `
  <!-- dc: My Plexus.dc.html › "03 · MY PASS" -->
  <section class="mx-sec" data-block="pass">
    ${sectionHead(COPY.mine.passTitle)}
    ${tickets.length ? `
    <div class="mx-px-pass">
      ${tickets.map(ev => `
      <div class="mx-px-passitem">
        <img class="mx-qr" src="${esc(api.url(ev.ticket))}" alt="QR pass — ${esc(ev.title)}" loading="lazy">
        <span class="mx-px-passlabel">${ev.evt === 'gala' ? 'Gala Evening' : 'Conference'}${ev.checked_in ? ' · checked in' : ''}</span>
      </div>`).join('')}
    </div>
    <p class="mx-px-note">${COPY.mine.passNote}</p>` : `
    <div class="empty mx-px-passempty">${icon('ticket', 28)}<span class="empty-line">${esc(COPY.mine.passEmptyLine)}</span></div>`}
  </section>
  <!-- /dc -->`;
}
function mineWho() {
  const att = D.attendees;
  return `
  <!-- dc: My Plexus.dc.html › "04 · WHO FROM YOUR NETWORK ATTENDS" -->
  <section class="mx-sec" data-block="who">
    ${sectionHead(COPY.mine.whoTitle, att.length ? `<span class="mx-tag mx-tag--soft">${esc(COPY.mine.attending(att.length))}</span>` : '')}
    ${att.length ? `<div class="mx-person-rows">${att.slice(0, 5).map(a => {
      const name = [a.first_name, a.last_name].filter(Boolean).join(' ');
      return `<div class="mx-person-row">${ui.portrait({ name, src: a.photo_url ? api.url(a.photo_url) : '', size: 64, alt: '' })}<span class="mx-person-text"><span class="mx-person-name">${esc(name)}</span><span class="mx-person-role">${esc(a.institution || a.country || '')}</span></span><span class="mx-person-act"><a href="/app/messages?to=${encodeURIComponent(a.id)}" class="btn-ghost btn-sm">${COPY.mine.message}</a></span></div>`;
    }).join('')}</div>` : `
    <div class="empty"><span class="empty-line">${esc(COPY.mine.whoEmptyLine)}</span></div>`}
    <div class="mx-list mx-px-find">${listRow({ href: '/app/network', ic: 'users', l: COPY.mine.findMore })}</div>
  </section>
  <!-- /dc -->`;
}
function mineTpl() {
  return `
<div data-screen-label="My Plexus" class="mx-px">
  ${crumb([{ label: COPY.crumb.projects, to: '/app/projects' }, { label: COPY.crumb.plexus, to: '/app/plexus' }, { label: COPY.crumb.mine }])}
  <div class="mx-p">
    ${tabStrip(false)}
    ${mineHero()}
    ${mineIncluded()}
    ${mineKnow()}
    ${minePass()}
    ${mineWho()}
    ${blockHelp()}
  </div>
</div>`;
}

// ---------------------------------------------------------------- behaviour
function rerender(sel, html) { const el = rootEl && rootEl.querySelector(sel); if (el) el.outerHTML = html; }
// the bio sheet closes like every modal (app.css › .mx-modal.is-leaving): the scrim and sheet fade out over
// the exit timing, then the block is redrawn empty; focus returns to the card that opened it
function closeBio() {
  if (!st || !st.bio) return;
  const id = st.bio; st.bio = null;
  if (bioTrap) { bioTrap(); bioTrap = null; }
  const scrim = rootEl && rootEl.querySelector('[data-role="bio-scrim"]');
  const done = () => {
    if (!rootEl || st.bio) return;                                   // re-opened meanwhile: leave the new sheet alone
    rerender('[data-block="bio"]', '<div data-block="bio"></div>');
    const back = rootEl.querySelector(`[data-act="vb"][data-id="${CSS.escape(id)}"]`);
    const a = document.activeElement;
    if (back && (!a || a === document.body)) { try { back.focus({ preventScroll: true }); } catch (e) {} }
  };
  if (!scrim || ui.reducedMotion()) return done();
  scrim.classList.remove('mx-bio-in'); scrim.classList.add('is-leaving');
  setTimeout(done, 230);   // the exit (--t-exit) and a frame
}
function openBioFocus() {
  const scrim = rootEl.querySelector('[data-role="bio-scrim"]');
  if (!scrim) return;
  scrim.addEventListener('mousedown', e => { if (e.target === scrim) closeBio(); });
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); closeBio(); document.removeEventListener('keydown', onKey, true); } };
  document.addEventListener('keydown', onKey, true);
  timers.push(() => document.removeEventListener('keydown', onKey, true));
  // Tab and Shift+Tab stay in the sheet (aria-modal alone let focus walk into the page behind); the sheet is
  // re-drawn when a session is added, so the trap looks it up each time
  if (!bioTrap) bioTrap = ui.trapFocus(() => rootEl && rootEl.querySelector('.mx-bio-sheet'));
  const x = scrim.querySelector('[data-act="bioClose"]');
  if (x) x.focus();
}

const handlers = {
  // flips in place at once (ui.toggleSwitch) — the POST runs behind it and a failure flips it back
  tgFollow: (el) => ui.toggleSwitch(el, async on => {
    await api.post('/api/notify-topics', { project: 'plexus', on });
    if (D) D.followed = on;
    ui.toast(on ? COPY.toasts.followed : COPY.toasts.unfollowed);
    chrome.refresh();
  }, on => { const l = el.parentElement && el.parentElement.querySelector('[data-role="follow-label"]'); if (l) l.innerHTML = COPY.facts.followSub(on); }),
  dlIcs: () => {
    const events = icsEvents();
    if (!events.length) return ui.toast(COPY.toasts.icsNone, { kind: 'error' });
    ui.downloadIcs(COPY.band.icsFile, events);
    ui.toast(COPY.band.icsDone);
  },
  // Editions: "in general Plexus Week and then we can choose 2026, and once it passes we archive it"
  // (design/MEETUPS-SPEC.md §1). The year control lists every edition; picking one re-reads this page with
  // ?edition=<id>, and an archived one comes back read-only.
  editions: () => {
    const w = D.week || {};
    const list = Array.isArray(w.editions) ? w.editions : [];
    const currentId = w.edition ? w.edition.id : null;
    const activeId = (list.find(e => e.status === 'active') || {}).id || null;
    const m = ui.modal({
      eyebrow: COPY.week.modalEyebrow, title: COPY.week.modalTitle,
      body: `<p style="margin:0 0 14px">${esc(COPY.week.modalBody)}</p>` + (list.length ? `<div class="mx-list mx-list--plain">${list.map(e => `
        <span class="mx-row" data-act="pickEdition" data-id="${esc(e.id)}" data-active="${e.id === activeId}" role="button">
          <span class="mx-row-l">${esc(e.label || String(e.year || ''))}<span class="mx-row-s">${esc(fmt.longRange(e.starts_on, e.ends_on))}</span></span>
          <span class="mx-row-v"${e.id === currentId ? ' style="color:#9b1b22"' : ''}>${esc(e.status === 'active' ? COPY.week.current : e.status)}</span>
        </span>`).join('')}</div>` : `
        <div class="empty"><span class="empty-line">${esc(COPY.week.none)}</span><span class="empty-why">${esc(COPY.week.noneWhy)}</span></div>`),
      actions: [{ label: COPY.week.close }]
    });
    ui.bind(m.el, { pickEdition: (el) => { m.close(); const id = el.dataset.id; router.navigate(el.dataset.active === 'true' ? '/app/plexus' : `/app/plexus?edition=${encodeURIComponent(id)}`); } });
  },
  vb: (el) => { st.bio = el.dataset.id; rerender('[data-block="bio"]', `<div data-block="bio">${blockBio()}</div>`); const sc = rootEl.querySelector('[data-role="bio-scrim"]'); if (sc) sc.classList.add('mx-bio-in'); openBioFocus(); },
  bioClose: () => closeBio(),
  // the gallery: one photo at a time at full size (ui.lightbox — ← / →, arrow keys, Esc); a tile on the page
  // opens on its own photo while the export's pictures stand in for the team's gallery
  gallery: (el) => {
    const apiPhotos = D.photos || [];
    const list = apiPhotos.length
      ? apiPhotos.map(p => ({ src: api.url(p.file_path), alt: p.title || 'Plexus photo', caption: p.title || '' }))
      : EXPORT_PHOTOS.map((p, i) => ({ src: '/assets/' + p, alt: MOMENT_ALTS[i] || '' }));
    ui.lightbox(list, { start: apiPhotos.length ? 0 : el && el.dataset.i, eyebrow: COPY.photos.modalEyebrow, title: COPY.photos.modalTitle, note: apiPhotos.length ? '' : esc(COPY.photos.pending) });
  },
  pdf: () => { window.open(api.url('/api/v2/plexus/program.pdf'), '_blank', 'noopener'); ui.toast(COPY.toasts.pdfOpen); },
  guide: () => {
    const res = (D.resources || []).find(r => /guide|zagreb|welcome/i.test(`${r.title} ${r.category}`) && (r.file_url || r.file_path || r.url));
    const url = res ? (res.file_url || res.file_path || res.url) : '/api/v2/plexus/welcome-guide.pdf';
    window.open(api.url(url), '_blank', 'noopener');
    ui.toast(COPY.zagreb.guideDone);
  },
  tgDay: (el) => { const i = Number(el.dataset.day); st.dayOpen[i] = !st.dayOpen[i]; rerender('[data-block="days"]', daysBlock()); },
  tgSession: async (el) => {
    const id = el.dataset.id;
    const s = D.sessions.find(x => x.id === id);
    const had = D.mySched.has(id);
    el.setAttribute('aria-disabled', 'true');
    try {
      if (had) { await api.del('/api/plexus/my-schedule/' + encodeURIComponent(id)); D.mySched.delete(id); }
      else { await api.post('/api/plexus/my-schedule/' + encodeURIComponent(id)); D.mySched.add(id); }
      const days = rootEl.querySelector('[data-block="days"]');
      if (days) rerender('[data-block="days"]', daysBlock());
      if (st.bio) { rerender('[data-block="bio"]', `<div data-block="bio">${blockBio()}</div>`); openBioFocus(); }
      ui.toast(had ? COPY.toasts.sessionRemoved((s && s.title) || 'session') : COPY.toasts.sessionAdded((s && s.title) || 'session'));
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  payGala: async (el) => {
    const g = D.galaReg;
    if (!g) return;
    el.setAttribute('aria-disabled', 'true');
    try {
      const r = await api.post('/api/gala/checkout-session', { registration_id: g.id });
      const url = r && (r.url || r.checkout_url);
      if (url) { window.location.assign(url); return; }
      ui.toast(COPY.mine.payStripeGone, { kind: 'error', ms: 6000 });
    } catch (e) {
      ui.toast(/stripe/i.test(e.message || '') ? COPY.mine.payStripeGone : e.message, { kind: 'error', ms: 6000 });
    }
    el.removeAttribute('aria-disabled');
  },
  galaPendingInfo: () => ui.toast(COPY.mine.payPending, { ms: 5000 }),
  transfer: () => {
    if (D.galaReg) return openSeatTransfer();          // gala seat → self-serve, immediate
    if (!D.myReg) return ui.toast(COPY.mine.transfer.noReg, { kind: 'error' });
    openConfTransfer();                                // conference ticket → team-approved request
  }
};
// ---- My Plexus › "Transfer to a colleague" flows (the know-card action above) ----
// Conference ticket: the legacy team-approved REQUEST (unchanged behaviour).
function openConfTransfer() {
  const T = COPY.mine.transfer;
  let m = null;
  m = ui.modal({
    eyebrow: T.eyebrow, title: T.title,
    body: `<p style="margin:0 0 14px">${esc(T.body)}</p>
      <label class="label" style="display:block;margin-bottom:4px">${T.name}</label>
      <input class="input" data-role="tfName" maxlength="120" style="margin-bottom:10px">
      <label class="label" style="display:block;margin-bottom:4px">${T.email}</label>
      <input class="input" data-role="tfEmail" type="email" maxlength="160" style="margin-bottom:10px">
      <label class="label" style="display:block;margin-bottom:4px">${T.reason}</label>
      <input class="input" data-role="tfWhy" maxlength="200">`,
    actions: [
      { label: T.cancel },
      { label: T.ok, kind: 'primary', onClick: () => {
        const name = (m.el.querySelector('[data-role="tfName"]') || {}).value || '';
        const email = (m.el.querySelector('[data-role="tfEmail"]') || {}).value || '';
        const why = (m.el.querySelector('[data-role="tfWhy"]') || {}).value || '';
        if (name.trim().length < 2 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { ui.toast(T.need, { kind: 'error' }); return false; }
        api.post(`/api/plexus/registration/${encodeURIComponent(D.myReg.id)}/transfer`, { new_user_name: name.trim(), new_user_email: email.trim(), reason: why.trim() })
          .then(() => ui.toast(T.sent, { ms: 5000 }))
          .catch(e => ui.toast(e.message, { kind: 'error', ms: 6000 }));
      } }
    ]
  });
}
// Gala seat: TRANSFER YOUR SEAT — immediate, in place (same registration id, same QR),
// confirmed in a dialog that spells the consequences out. POST /api/v2/transfer/gala.
function openSeatTransfer() {
  const T = COPY.mine.transfer;
  let m = null;
  m = ui.modal({
    eyebrow: T.galaEyebrow, title: T.galaTitle,
    body: `<p style="margin:0 0 8px">${esc(T.galaBody)}</p>
      <p style="margin:0 0 14px;font-size:12.5px;color:#4a4239">${esc(T.policy)}</p>
      <label class="label" style="display:block;margin-bottom:4px">${T.name}</label>
      <input class="input" data-role="tfName" maxlength="120" style="margin-bottom:10px">
      <label class="label" style="display:block;margin-bottom:4px">${T.email}</label>
      <input class="input" data-role="tfEmail" type="email" maxlength="160">
      ${D.myReg ? `<span data-act="confTransferInstead" style="display:inline-block;font:600 9px Inter,sans-serif;letter-spacing:.14em;color:#9b1b22;cursor:pointer;margin-top:12px">${T.confInstead}</span>` : ''}`,
    actions: [
      { label: T.galaCancel },
      { label: T.galaOk, kind: 'gold', onClick: () => {
        const name = ((m.el.querySelector('[data-role="tfName"]') || {}).value || '').trim().replace(/\s+/g, ' ');
        const email = ((m.el.querySelector('[data-role="tfEmail"]') || {}).value || '').trim().toLowerCase();
        if (name.length < 2 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { ui.toast(T.need, { kind: 'error' }); return false; }
        confirmSeatTransfer(name, email);              // closes this modal, opens the final check
      } }
    ]
  });
  ui.bind(m.el, { confTransferInstead: () => { m.close(); openConfTransfer(); } });
}
async function confirmSeatTransfer(name, email) {
  const T = COPY.mine.transfer;
  const sure = await ui.confirm({
    eyebrow: T.galaConfirmEyebrow, title: T.galaConfirmTitle,
    body: T.galaConfirmBody(esc(name), esc(email)), ok: T.galaSure, cancel: T.galaKeep, danger: true
  });
  if (!sure) return;
  try {
    await api.post('/api/v2/transfer/gala', { to_name: name, to_email: email });
    ui.toast(T.galaDone(name), { ms: 7000 });
    D = await load('mine');                            // the seat is gone from this account — reload live
    if (rootEl && tab === 'mine') rootEl.innerHTML = mineTpl();
  } catch (e) { ui.toast(e.message, { kind: 'error', ms: 7000 }); }
}
function startCountdown() {
  if (!rootEl.querySelector('[data-cd="days"]')) return;
  timers.push(ui.countdown(D.countdownTo, ({ days, hrs, min }) => {
    const set = (k, v) => ui.tick(rootEl && rootEl.querySelector(`[data-cd="${k}"]`), v);
    set('days', days); set('hrs', hrs); set('min', min);
    // the last day: the hero chip shows hours and minutes instead of "0 days" (GLASS-RULES §1.9.3)
    const cd = rootEl && rootEl.querySelector('.mx-countdown--chip'); if (cd) cd.classList.toggle('is-final', Number(days) === 0);
  }, 30000));
}

// ---------------------------------------------------------------- module
export default {
  reveal: true,        // sections below the fold rise in on scroll (router › ui.revealOnScroll)
  title: (ctx) => (TABS.find(t => t.key === ((ctx.params && ctx.params.tab) || '')) || TABS[0]).title,
  async render(root, ctx) {
    ensureCss();
    tab = (ctx.params && ctx.params.tab) || '';
    edition = (ctx.query && ctx.query.edition) || null;      // ?edition=<id> → read a past week back
    if (!TABS.some(t => t.key === tab)) { router.replace('/app/plexus'); return; }
    rootEl = root;
    D = await load(tab);
    if (rootEl !== root || (ctx.ready && !(await ctx.ready()))) return; // navigated away while loading, or the router moved on
    st = { bio: null, dayOpen: { 0: true } };
    root.innerHTML = tab === '' ? overviewTpl() : tab === 'program' ? programTpl() : tab === 'zagreb' ? zagrebTpl() : mineTpl();
    unbind = ui.bind(root, handlers);
    startCountdown();
    chrome.refresh();
  },
  destroy() {
    timers.forEach(stop => { try { stop(); } catch (e) {} }); timers = [];
    if (unbind) unbind(); unbind = null;
    if (bioTrap) { bioTrap(); bioTrap = null; }
    rootEl = null; D = null; st = null; edition = null;
  }
};
