// Source: Plexus Conference.dc.html · Plexus Program.dc.html · Plexus Zagreb.dc.html · My Plexus.dc.html
// Route /app/plexus/:tab? — '' (overview) · program · zagreb · mine. One module, one artboard per
// tab; blocks are the <!-- dc: <file> › "<label>" --> markers, in artboard order. Every number,
// date, price and list is a live read (see load()); FACTS fills gaps and wording only.
// Registration NEVER happens here: REGISTER / RESERVE / RSVP open the ONE server-rendered form at
// /plexus (server path → full page load; ?pick= preselect is a requested server change, harmless today).
import { api } from '../api.js';
import { session } from '../state.js';
import { ui, esc, fmt } from '../ui.js';
import { FACTS, galaPriceNow } from '../facts.js';
import { chrome } from '../chrome.js';
import router from '../router.js';

export const SOURCE = 'Plexus Conference.dc.html · Plexus Program.dc.html · Plexus Zagreb.dc.html · My Plexus.dc.html';

const TABS = [
  { key: '', label: 'OVERVIEW', to: '/app/plexus', title: 'Plexus Conference' },
  { key: 'mine', label: 'MY PLEXUS &amp; REGISTER', to: '/app/plexus/mine', title: 'My Plexus' },
  { key: 'program', label: 'PROGRAM &amp; SPEAKERS', to: '/app/plexus/program', title: 'Program & Speakers' },
  { key: 'zagreb', label: 'EXPLORE ZAGREB', to: '/app/plexus/zagreb', title: 'Explore Zagreb' }
];
const FORM = '/plexus';                      // the ONE server-rendered registration form (README: never rebuild)
const formUrl = pick => `${FORM}?pick=${encodeURIComponent(pick)}&src=portal`; // ?pick is the requested preselect param; ignored harmlessly until server.js adds it
const EXPORT_PHOTOS = ['photo-hall.jpg', 'photo-ballroom.jpg', 'photo-candlelit.jpg', 'photo-stage.jpg', 'photo-gala.jpg', 'photo-bridges.jpg'];
const WD3 = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MON3 = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// ---- COPY: every string that may change in a revision (dates/prices/venues live via API + FACTS) --
export const COPY = {
  crumb: { projects: 'PROJECTS', plexus: 'PLEXUS CONFERENCE', program: 'PROGRAM &amp; SPEAKERS', zagreb: 'EXPLORE ZAGREB', mine: 'MY PLEXUS &amp; REGISTRATION' },
  hero: {
    eyebrow: (status, cap) => `${status || 'PRE-REGISTRATION OPEN'} · FREE · ${FACTS.plexus.edition}TH YEAR${cap ? ` · CAPPED AT ${cap} SEATS` : ''}`,
    title: 'Plexus Conference', line: (range, venue) => `${range} · ${venue} — keynotes, research, and the Gala Evening.`,
    register: 'PRE-REGISTER NOW →', mine: 'MY PLEXUS →', schedule: 'VIEW SCHEDULE',
    interested: "I'M INTERESTED", noted: '✓ NOTED — UPDATES ON',
    follow: on => `GET UPDATES FROM PLEXUS · ${on ? 'ON' : 'OFF'}`,
    followSub: 'Email + portal alerts · manage topics in Profile &amp; settings'
  },
  band: {
    startsIn: 'STARTS IN', units: ['DAYS', 'HOURS', 'MINUTES'],
    eb: label => `GALA EARLY BIRD UNTIL ${label}`, ebPast: 'GALA · REGULAR PRICE',
    ics: 'ADD TO CALENDAR →', icsFile: 'medx-plexus-2026.ics',
    icsDone: 'Calendar file downloaded — open it to add Plexus to your calendar.'
  },
  stage: {
    n: '01', title: 'ON THE PLEXUS STAGE', all: 'ALL SPEAKERS →',
    sub: 'Global hospital and university leaders headline Plexus 2026, alongside the full conference speaker programme.',
    confirmed: 'CONFIRMED', viewBio: 'VIEW BIO →',
    emptyLine: 'Speakers are announced as they confirm.', emptyWhy: 'The team is confirming this year’s speakers now — follow Plexus and hear the moment names go up.'
  },
  threads: {
    n: '02', title: "THIS YEAR'S THREADS", sub: 'Two conversations run through everything on the program.',
    items: [
      { n: 'THREAD 01', color: '#9b1b22', accent: '#9b1b22', title: 'Artificial intelligence <i style="color:#9b1b22">in medicine</i>', body: 'Where AI is already changing diagnosis, research, and hospital practice — and what it means for clinicians here.' },
      { n: 'THREAD 02', color: '#6e5626', accent: '#c9a962', title: 'The career paths of <i style="color:#6e5626">biomedical leaders</i>', body: 'How the people running the world’s leading hospitals and universities built their careers — told first-hand.' }
    ]
  },
  glance: {
    n: '03', title: 'THE PROGRAM', full: 'FULL PROGRAM →',
    dayTitles: ['Opening, keynotes &amp; workshops', 'Research, panels &amp; closing keynote'],
    dayGeneric: i => `Conference day ${i}`,
    inPrep: 'IN PREPARATION', from: t => `FROM ${t}`,
    galaTitle: 'Gala Evening <i style="color:#c9a962">&amp;</i> Annual Awards', reception: 'Welcome Reception', free: 'FREE'
  },
  galaBlock: {
    eyebrow: 'EXCLUSIVE EVENING EVENT · THE JEWEL OF PLEXUS',
    title: 'Gala Evening <i style="color:#c9a962">&amp;</i> Awards Ceremony',
    body: (when, venue) => `${when} — ${venue}. Five courses, keynote addresses, live music — seating limited to keep the room personal.`,
    rsvp: price => `RSVP · ${price} →`, note: 'Same form as Plexus — pick the conference, the Gala, or both.'
  },
  connect: {
    n: '04', title: 'CONNECT WITH PARTICIPANTS', pts: '+10 PTS PER CONNECTION',
    line: 'Meet the room before you walk into it.',
    body: 'Find attendees, send messages, and schedule 1-on-1 meetings — across Plexus and the Gala.',
    cta: 'OPEN THE NETWORK →'
  },
  photos: {
    label: 'MOMENTS FROM PAST CONFERENCES',
    line: n => `${n ? fmt.num(n) + '+' : '2,500+'} researchers and clinicians, built across our Plexus conferences.`,
    all: 'ALL PHOTOS →', modalEyebrow: 'PLEXUS · PHOTO GALLERY', modalTitle: 'Moments from past conferences',
    pending: 'The team’s full gallery lands here as photos are uploaded — these are moments from past editions.'
  },
  help: {
    overview: 'Questions about Plexus — attending, speaking, sponsoring?',
    program: 'Questions about the program?', zagreb: 'Planning your trip and need a hand?', mine: 'Questions about your registration?',
    sub: 'Message us — you’re signed in, so replies land right here in your portal inbox.',
    subShort: 'Message us — replies land right here in your portal inbox.', cta: 'MESSAGE US →'
  },
  bio: { pending: 'Bio to follow — the team is preparing it. Follow Plexus and hear when the full profiles go up.', sessions: 'SESSIONS', none: 'No session published for this speaker yet — it appears here the moment the program is out.', add: '＋ ADD TO MY SCHEDULE', added: '✓ IN MY SCHEDULE' },
  prog: {
    n: '01', title: 'THE PROGRAM', ics: 'ADD TO CALENDAR →', pdf: 'DOWNLOAD PROGRAM · PDF', hint: 'Tap a day to expand its sessions.',
    expand: '▼ EXPAND', collapse: '▲ COLLAPSE',
    prepLine: 'The detailed program is in preparation — session times appear here as they are published, and registered members hear first.',
    timesNote: 'Final session times are published closer to the event.',
    register: 'REGISTER — FREE →', mine: 'MY PLEXUS →',
    daySummary: (n, first) => `${n} session${n === 1 ? '' : 's'} · ${first}${n > 1 ? ' …' : ''}`,
    add: '＋ ADD', added: '✓ ADDED',
    spN: '02', spTitle: 'SPEAKERS', spFilters: ['ALL', 'PLEXUS', 'GALA'], spSearch: 'Search speakers…',
    spHint: 'Click a speaker to view their full bio and add their session to your schedule.',
    bioAdd: 'BIO + ADD SESSION →',
    spEmpty: q => q ? `No speaker matches “${q}”.` : 'No speakers announced for this filter yet.',
    spEmptyWhy: 'Names go up here as the team confirms them — follow Plexus to hear first.'
  },
  zagreb: {
    eyebrow: 'PLEXUS 2026 · YOUR DECEMBER IN CROATIA’S CAPITAL', title: 'Dobrodošli u Zagreb.',
    line: 'Austro-Hungarian elegance, Mediterranean warmth, and Europe’s best advent season — compact, walkable, and at its most magical in December.',
    guide: 'DOWNLOAD THE WELCOME GUIDE', myPlexus: 'MY PLEXUS →',
    stopsN: '01', stopsTitle: 'SIX STOPS BEFORE DINNER', stopsSub: 'All in the walkable centre, an easy stroll from the venue.',
    stops: [
      { n: '01', name: 'Ban Jelačić Square', note: 'The city’s beating heart — cafés on every side, advent stalls in December. 5 minutes from the venue.', ph: 'PHOTO · BAN JELAČIĆ SQUARE', wide: true },
      { n: '02', name: 'St. Mark’s Church', note: 'The famous tiled roof, coats of arms and all.', ph: 'PHOTO · ST. MARK’S CHURCH' },
      { n: '03', name: 'Zagreb Cathedral', note: 'Zagreb’s grand dame over Kaptol — rising again, stone by stone, after the 2020 earthquake.', ph: 'PHOTO · ZAGREB CATHEDRAL' },
      { n: '04', name: 'Dolac Market', note: 'The “Belly of Zagreb” — red umbrellas, morning buzz.', ph: 'PHOTO · DOLAC MARKET' },
      { n: '05', name: 'Upper Town at dusk', note: 'Cobblestones, the Stone Gate, gas lamps lit by hand.', ph: 'PHOTO · UPPER TOWN LANTERNS' },
      { n: '06', name: 'Tkalčićeva Street', note: 'Café-lined and lively till late — end the night here.', ph: 'PHOTO · TKALČIĆEVA STREET' }
    ],
    bonus: { title: 'December bonus: Advent in Zagreb', note: 'Voted Europe’s best Christmas market three years running — mulled wine, lights, and music on every square.' },
    tasteN: '02', tasteTitle: 'TASTE ZAGREB', tasteSub: 'Come hungry.',
    taste: [
      { name: 'Štrukli', note: 'Baked dough, fresh cheese, sour cream — the city’s signature comfort.', ph: 'PHOTO · ŠTRUKLI' },
      { name: 'Ćevapi', note: 'The Balkan classic — flatbread, raw onion, ajvar. No cutlery required.', ph: 'PHOTO · ĆEVAPI' },
      { name: 'Croatian wine', note: '130+ native grapes — start with a Graševina, stay for the Plavac Mali.', ph: 'PHOTO · CROATIAN WINE' },
      { name: 'Craft beer', note: 'The Garden, Zmajska, Nova Runda — a scene in full swing.', ph: 'PHOTO · CRAFT BEER' }
    ],
    aroundTitle: '03 · GETTING AROUND',
    around: [
      { b: 'On foot', t: '&nbsp;— the centre is compact and walkable' },
      { b: 'Blue trams', t: '&nbsp;— Zagreb’s classic way around · ZET app' },
      { b: 'Bolt &amp; Uber', t: '&nbsp;— available across the city and from the airport' }
    ],
    closing: 'December in Zagreb: advent stalls, mulled wine, and the season’s best conversations.',
    heroPh: 'PHOTO · ZAGREB ADVENT, UPPER TOWN AT DUSK',
    guideDone: 'The welcome guide opened in a new tab — save it for December.'
  },
  mine: {
    eyebrow: { open: 'MY PLEXUS · PRE-REGISTRATION OPEN', closed: 'MY PLEXUS · PRE-REGISTRATION OPENS SOON', registered: 'MY PLEXUS · YOU ARE REGISTERED', galaPending: 'MY PLEXUS · GALA SEAT REQUESTED', galaApproved: 'MY PLEXUS · GALA SEAT APPROVED — PAYMENT OPEN', galaPaid: 'MY PLEXUS · REGISTERED · GALA SEAT PAID' },
    title: 'Your Plexus <i>2026</i>.',
    lead: {
      none: 'The conference is <strong style="color:#191512">free</strong> — two full days, keynotes, workshops, and the welcome reception. The Gala Evening seat is the only thing with a price. One form covers both.',
      registered: 'You are in — two full days, keynotes, workshops, and the welcome reception, <strong style="color:#191512">free</strong>. The Gala Evening seat is the only thing left with a price.',
      galaPending: 'Your Gala seat request is with the team. Once it is approved you get a payment link — and your conference registration stays free either way.',
      galaApproved: 'Your Gala seat is approved — settle the payment and the seat is yours. Everything else about your Plexus stays free.',
      galaPaid: 'Everything is set: conference registered, Gala seat paid. Your QR pass below opens every door you registered for.'
    },
    register: 'PRE-REGISTER NOW →', addGala: 'ADD THE GALA →', pay: 'PAY FOR YOUR SEAT →', tickets: 'MY TICKETS →',
    ctaSub: { none: 'OPENS THE REGISTRATION FORM · PICK EITHER OR BOTH', gala: 'OPENS THE SAME FORM · GALA PRESELECTED', pay: 'SECURE CARD PAYMENT · STRIPE', done: 'TICKETS, RECEIPTS &amp; WALLET PASSES LIVE IN MY MED&amp;X' },
    facts: { conference: 'Conference', gala: 'Gala Evening', eb: 'Gala early bird', until: l => `UNTIL ${l}` },
    includedN: '01', includedTitle: "WHAT'S INCLUDED",
    confCard: {
      title: 'Plexus Conference', tag: 'FREE ENTRY', tagDone: '✓ REGISTERED',
      items: (d, first) => [`Both conference days — ${d}`, 'All keynotes, panels, and research sessions', 'Workshops and poster sessions', `Welcome Reception — ${first}, 18:00`, 'Certificate of attendance'],
      cta: 'REGISTER — FREE →', ctaDone: 'VIEW TICKET →'
    },
    galaCard: {
      title: 'Gala Evening <i style="color:#c9a962">&amp;</i> Awards', price: p => `${p} PER GUEST`, tagPaid: '✓ SEAT PAID', tagPending: 'SEAT REQUESTED', tagApproved: 'APPROVED · PAY NOW',
      items: ['Five-course gala dinner with wine pairing', 'Med&amp;X Annual Awards ceremony', 'Live music and entertainment', 'Keynote speaker meet &amp; greet', 'Black tie / formal evening attire'],
      cta: 'RESERVE A SEAT →', ctaPay: 'PAY FOR YOUR SEAT →', ctaPaid: 'VIEW TICKET →'
    },
    knowN: '02', knowTitle: 'GOOD TO KNOW',
    know: [
      { tag: 'EARLY BIRD', title: 'Seats are capped', note: (p, l, p2) => `Book your Gala seat by ${l} for ${p} — the room is kept intentionally small, and Gala seats go first. After that the seat is ${p2}.` },
      { tag: 'CAN’T MAKE IT?', title: 'Transfer to a colleague', note: () => 'Pass your registration or Gala seat to a colleague any time before the event, from this page.', act: 'transfer', actLabel: 'TRANSFER →' },
      { tag: 'QUESTIONS?', title: 'We’re one message away', note: () => 'Anything about your registration or Gala seat — message us and replies land in your portal inbox.', href: '/app/messages', actLabel: 'OPEN MESSAGES →' }
    ],
    passN: '03', passTitle: 'MY PASS',
    passEmptyLine: 'Your QR pass appears here once you register.',
    passEmptyWhy: 'One QR for everything you registered for — also in <a href="/app/me">My Med&amp;X</a> and your phone wallet.',
    passNote: 'One QR for everything you registered for — also in <a href="/app/me">My Med&amp;X</a> and your phone wallet.',
    passPending: 'Awaiting payment — the QR appears the moment the seat is settled.',
    whoN: '04', whoTitle: 'WHO FROM YOUR NETWORK ATTENDS', attending: n => `${n} ATTENDING`,
    whoEmptyLine: 'No attendees on the public list yet.', whoEmptyWhy: 'Members who register and share their profile show up here — say hello before December.',
    message: 'MESSAGE →', findMore: 'FIND MORE ATTENDEES · OPEN MEMBER DIRECTORY →',
    transfer: {
      eyebrow: 'PLEXUS · TICKET TRANSFER', title: 'Transfer to a colleague',
      body: 'The team approves every transfer. Your colleague takes over the registration exactly as it stands.',
      name: 'COLLEAGUE’S FULL NAME', email: 'COLLEAGUE’S EMAIL', reason: 'REASON (OPTIONAL)',
      ok: 'REQUEST TRANSFER', cancel: 'KEEP MY TICKET',
      sent: 'Transfer requested — the team confirms it by email.', need: 'A full name and a valid email are needed.',
      noReg: 'Register first — a transfer needs a ticket to pass on.', gala: 'Gala seats are transferred by the team — message us and it is done in a day.'
    },
    payPending: 'Your seat request is with the team — you get a payment link the moment it is approved.',
    payStripeGone: 'Card payment is not available right now — message us and we send a secure payment link.'
  },
  toasts: {
    followed: 'You follow Plexus now — updates land in your inbox and alerts.',
    unfollowed: 'Plexus updates are off. Turn them back on any time.',
    interested: 'Noted — Plexus updates are on. See you in December.',
    sessionAdded: t => `Added to your schedule — ${t}.`, sessionRemoved: t => `Removed from your schedule — ${t}.`,
    pdfOpen: 'The program PDF opened in a new tab.',
    icsNone: 'No dates could be exported yet.'
  }
};

// ---------------------------------------------------------------- module state
let D = null, st = null, rootEl = null, unbind = null, timers = [], tab = '', qUnbind = null;
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
function d3(iso) { const d = fmt.toDate(iso); return d ? `${WD3[d.getDay()]}, ${MON3[d.getMonth()]} ${d.getDate()}` : ''; }
function shortRange(a, b) {
  const x = fmt.toDate(a), y = fmt.toDate(b);
  if (!x) return '';
  if (!y || x.getTime() === y.getTime()) return `${MON3[x.getMonth()]} ${x.getDate()}, ${x.getFullYear()}`;
  if (x.getMonth() === y.getMonth()) return `${MON3[x.getMonth()]} ${x.getDate()}–${y.getDate()}, ${x.getFullYear()}`;
  return `${MON3[x.getMonth()]} ${x.getDate()} – ${MON3[y.getMonth()]} ${y.getDate()}, ${y.getFullYear()}`;
}
function monthDay(iso) { const d = fmt.toDate(iso); return d ? `${MON3[d.getMonth()]} ${d.getDate()}` : ''; }
function hhmm(t) { const m = String(t || '').match(/(\d{1,2}):(\d{2})/); return m ? `${m[1].padStart(2, '0')}:${m[2]}` : ''; }
function eachDay(a, b) {
  const out = []; const x = fmt.toDate(a), y = fmt.toDate(b) || x;
  if (!x) return out;
  for (let d = new Date(x); d <= y && out.length < 6; d.setDate(d.getDate() + 1)) out.push(new Date(d));
  return out;
}
function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z]/g, ''); }

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
    next: api.get('/api/me/next-event')
  };
  if (t === '' || t === 'program') { want.mySched = api.get('/api/plexus/my-schedule'); }
  if (t === '') { want.impact = cget('/api/public/impact', { noAuth: true }); want.photos = cget('/api/plexus/photos', { noAuth: true }); }
  if (t === 'zagreb') { want.resources = cget('/api/plexus/resources', { noAuth: true }); }
  if (t === 'mine') {
    want.myReg = api.get('/api/plexus/my-registration');
    want.galaMine = api.get('/api/gala/my-status');
    want.events = api.get('/api/my/events');
    want.attendees = api.get('/api/plexus/attendees');
  }
  const r = await api.settle(want);

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

  const start = conf.start_date || confFull.start_date || FACTS.plexus.start;
  const end = conf.end_date || confFull.end_date || FACTS.plexus.end;
  return {
    tab: t,
    conf: {
      name: conf.name || confFull.name || FACTS.plexus.name,
      year: conf.year || confFull.year || FACTS.year,
      start, end,
      range: conf.date_range || fmt.longRange(start, end),
      venue: conf.venue_name || confFull.venue_name || FACTS.plexus.venue,
      city: conf.venue_city || confFull.venue_city || FACTS.plexus.city,
      open: conf.registration_open !== undefined ? !!conf.registration_open : true,
      cap: Number(confFull.max_capacity) || null,
      spotsLeft: Number.isFinite(Number(confFull.spots_remaining)) ? Number(confFull.spots_remaining) : null
    },
    countdownTo: `${String(start).slice(0, 10)}T09:00:00+01:00`,
    statusLabel: fmt.upper(fmt.detail((projects.plexus || {}).status_label || 'Pre-registration open')),
    gala: {
      title: gala.title || `Plexus Gala Evening ${FACTS.year}`,
      date: gala.date || FACTS.gala.date, time: hhmm(gala.time) || FACTS.gala.time,
      venueFull: galaVenueFull, venueShort: galaVenueShort,
      price: galaPrice, priceRegular: galaRegular, ebDeadline: galaEbDeadline, ebActive,
      speakers: galaSpeakerNames
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
function instShort(sp) {
  const s = String(sp.institution || '').trim();
  if (!s) return 'INSTITUTION';
  if (s.length <= 16) return s.toUpperCase();
  return s.split(/\s+/).filter(w => !/^(of|the|and|for|de)$/i.test(w)).map(w => w[0]).join('').toUpperCase();
}
function speakerSessions(sp) {
  return D.sessions.filter(s => String(s.speaker_ids || '').split(',').map(x => x.trim()).includes(sp.id));
}
function speakerTag(sp) {
  const meta = D.meta[sp.id] || {};
  if (meta.event_tag) return meta.event_tag === 'both' ? 'PLEXUS · GALA' : meta.event_tag.toUpperCase();
  const atGala = D.gala.speakers.includes(norm(sp.name));
  const atPlexus = !!sp.talk_title || speakerSessions(sp).length > 0;
  // Alen 2026-08-31: the four headliners speak at BOTH the conference and the Gala
  if (atGala) return 'PLEXUS · GALA';
  return 'PLEXUS';
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

// ---------------------------------------------------------------- shared blocks
function crumb(items) {
  const sep = '<span style="color:rgba(25,21,18,.35);font-size:10px">→</span>';
  return `
  <!-- dc: Plexus Conference.dc.html › "Breadcrumb" -->
  <div class="mx-gutter" style="display:flex;align-items:center;gap:13px;padding:10px 36px;border-bottom:1px solid rgba(25,21,18,.16);flex-wrap:wrap">
    ${items.map((it, i) => (i ? sep + '\n    ' : '') + (it.to
      ? `<a href="${it.to}" style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#4a4239" data-hover="color:#191512">${it.label}</a>`
      : `<span style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:${i ? '#191512' : '#4a4239'}">${it.label}</span>`)).join('\n    ')}
    <div style="flex:1"></div>
  </div>
  <!-- /dc -->`;
}
function tabStrip() {
  return `
  <!-- dc: Plexus Conference.dc.html › "Section tabs" -->
  <div class="mx-plexus-tabs mx-gutter" style="display:flex;align-items:center;justify-content:center;gap:26px;padding:13px 36px;border-bottom:1px solid rgba(25,21,18,.16);flex-wrap:wrap">
    ${TABS.map(t => t.key === tab
      ? `<span aria-current="page" style="font:600 10px Inter,sans-serif;letter-spacing:.15em;color:#9b1b22;border-bottom:2px solid #9b1b22;padding-bottom:3px">${t.label}</span>`
      : `<a href="${t.to}" style="font:600 10px Inter,sans-serif;letter-spacing:.15em;color:#4a4239;text-decoration:none" data-hover="color:#191512">${t.label}</a>`).join('\n    ')}
  </div>
  <!-- /dc -->`;
}
function blockHelp(line, sub, border) {
  return `
  <!-- dc: Plexus Conference.dc.html › "Message us" -->
  <div class="mx-gutter" style="display:flex;align-items:center;gap:20px;${border ? 'border-top:1px solid rgba(25,21,18,.16);' : ''}padding:18px 36px 30px;flex-wrap:wrap">
    <span style="font-family:Fraunces,serif;font-style:italic;font-size:16px;color:#4a4239">${line}</span>
    <span style="font-size:12px;color:#4a4239">${sub}</span>
    <div style="flex:1"></div>
    <a href="/app/messages" style="padding:10px 16px;background:#9b1b22;color:#f7f1e6;font:600 10px Inter,sans-serif;letter-spacing:.16em;white-space:nowrap" data-hover="background:#7e151b;color:#f7f1e6">${COPY.help.cta}</a>
  </div>
  <!-- /dc -->`;
}
function blockBio() {
  if (!st.bio) return '';
  const sp = D.speakers.find(s => s.id === st.bio);
  if (!sp) return '';
  const sess = speakerSessions(sp);
  return `
  <!-- dc: Plexus Conference.dc.html › "Bio modal" -->
  <div data-role="bio-scrim" role="dialog" aria-modal="true" aria-label="Speaker bio" style="position:fixed;inset:0;background:rgba(25,21,18,.55);z-index:70;display:flex;align-items:center;justify-content:center;padding:30px">
    <div class="mx-bio-sheet" style="background:#fdfaf3;max-width:520px;width:100%;padding:26px 30px;border-top:3px solid #9b1b22">
      <div style="display:flex;align-items:baseline;gap:12px"><span style="font-family:Fraunces,serif;font-size:24px;flex:1">${esc(sp.name)}</span><span data-act="bioClose" role="button" tabindex="0" aria-label="Close" style="cursor:pointer;color:#4a4239;font-size:18px">×</span></div>
      <div style="font:600 10px Inter,sans-serif;letter-spacing:.15em;color:#9b1b22;margin-top:4px">${esc(fmt.upper(speakerRole(sp)))}</div>
      <div style="font-size:13px;color:#4a4239;line-height:1.65;margin-top:12px">${sp.bio ? esc(sp.bio) : `<i>${esc(COPY.bio.pending)}</i>`}</div>
      <div data-v2="speaker sessions + add-to-my-schedule (Program page wiring map)" style="margin-top:16px;border-top:1px solid rgba(25,21,18,.12);padding-top:12px">
        <div style="font:600 9px Inter,sans-serif;letter-spacing:.16em;color:#6e5626;margin-bottom:8px">${COPY.bio.sessions}</div>
        ${sess.length ? sess.map(s => `
        <div style="display:flex;gap:12px;align-items:baseline;padding:6px 0">
          <span style="font:600 10px Inter,sans-serif;color:#9b1b22;flex:none">${esc(hhmm(s.start_time))}</span>
          <span style="font-size:12.5px;color:#191512;flex:1">${esc(s.title || 'Session')}</span>
          <span data-act="tgSession" data-id="${esc(s.id)}" style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:${D.mySched.has(s.id) ? '#6e5626' : '#9b1b22'};cursor:pointer;white-space:nowrap">${D.mySched.has(s.id) ? COPY.bio.added : COPY.bio.add}</span>
        </div>`).join('') : `<div style="font-size:12px;color:#4a4239;font-style:italic">${esc(COPY.bio.none)}</div>`}
      </div>
    </div>
  </div>
  <!-- /dc -->`;
}

// ---------------------------------------------------------------- OVERVIEW (Plexus Conference.dc.html)
function ovHero() {
  const on = D.followed;
  const capBit = D.conf.cap ? `CAPPED AT ${fmt.num(D.conf.cap)} SEATS` : '';
  return `
  <!-- dc: Plexus Conference.dc.html › "Hero" -->
  <div style="position:relative;overflow:hidden">
    <img src="/assets/photo-stage.jpg" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">
    <div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(25,21,18,.66) 0%,rgba(25,21,18,.5) 55%,rgba(25,21,18,.82) 100%)"></div>
    <div class="mx-pad-hero" style="position:relative;padding:54px 36px 44px;display:flex;flex-direction:column;align-items:center;text-align:center">
      <span style="padding:6px 12px;border:1px solid rgba(201,169,98,.7);color:#c9a962;font:600 10px Inter,sans-serif;letter-spacing:.18em">${esc(D.statusLabel)} · FREE · ${FACTS.plexus.edition}TH YEAR${capBit ? ' · ' + esc(capBit) : ''}</span>
      <div class="mx-display-52" style="font-family:Fraunces,serif;font-size:52px;line-height:1.08;color:#f7f1e6;margin-top:20px">${esc(D.conf.name.replace(/\s*\d{4}$/, ''))} <i style="color:#c9a962">${esc(String(D.conf.year))}</i></div>
      <div style="font-size:15px;color:rgba(247,241,230,.85);margin-top:10px">${esc(COPY.hero.line(D.conf.range, `${D.conf.venue}, ${D.conf.city}`))}</div>
      <div style="display:flex;gap:13px;margin-top:26px;justify-content:center;flex-wrap:wrap">
        ${D.next.registered
          ? `<a href="/app/plexus/mine" style="padding:13px 22px;background:#9b1b22;color:#f7f1e6;font:600 10.5px Inter,sans-serif;letter-spacing:.16em;text-decoration:none;white-space:nowrap" data-hover="background:#7e151b;color:#f7f1e6">${COPY.hero.mine}</a>`
          : `<a href="${formUrl('conference')}" style="padding:13px 22px;background:#9b1b22;color:#f7f1e6;font:600 10.5px Inter,sans-serif;letter-spacing:.16em;text-decoration:none;white-space:nowrap" data-hover="background:#7e151b;color:#f7f1e6">${COPY.hero.register}</a>`}
        <a href="/app/plexus/program" style="padding:13px 22px;border:1px solid rgba(247,241,230,.45);color:#f7f1e6;font:600 10.5px Inter,sans-serif;letter-spacing:.16em;text-decoration:none;white-space:nowrap" data-hover="border-color:#f7f1e6;color:#f7f1e6">${COPY.hero.schedule}</a>
        <span data-act="interested" style="padding:13px 22px;border:1px solid rgba(247,241,230,.45);color:#f7f1e6;font:600 10.5px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;white-space:nowrap" data-hover="border-color:#f7f1e6">${st.interested || on ? COPY.hero.noted : COPY.hero.interested}</span>
      </div>
      <div style="display:flex;align-items:center;gap:10px;margin-top:20px">
        <span data-act="tgFollow" role="switch" aria-checked="${on}" aria-label="Get updates from Plexus" style="width:34px;height:18px;flex:none;cursor:pointer;background:${on ? '#9b1b22' : 'rgba(247,241,230,.3)'};position:relative;transition:background .3s"><span style="position:absolute;top:2px;width:14px;height:14px;background:#f7f1e6;transition:left .3s;left:${on ? '18px' : '2px'}"></span></span>
        <span style="display:flex;flex-direction:column;gap:3px;text-align:left"><span style="font:600 10px Inter,sans-serif;letter-spacing:.16em;color:rgba(247,241,230,.8)">${COPY.hero.follow(on)}</span><span style="font-size:10.5px;color:rgba(247,241,230,.5)">${COPY.hero.followSub}</span></span>
      </div>
    </div>
  </div>
  <!-- /dc -->`;
}
function ovBand() {
  const cell = (id, unit) => `<span style="display:flex;align-items:baseline;gap:6px"><span data-cd="${id}" style="font-family:Fraunces,serif;font-size:24px">—</span><span style="font:600 8.5px Inter,sans-serif;letter-spacing:.14em;color:rgba(247,241,230,.65)">${unit}</span></span>`;
  const vr = '<span style="width:1px;height:18px;background:rgba(247,241,230,.25)"></span>';
  const ebLabel = D.gala.ebActive ? COPY.band.eb(fmt.upper(monthDay(D.gala.ebDeadline))) : COPY.band.ebPast;
  return `
  <!-- dc: Plexus Conference.dc.html › "Countdown band" -->
  <div class="mx-pad-band" style="display:flex;align-items:center;justify-content:center;gap:26px;padding:13px 36px;background:#191512;color:#f7f1e6;flex-wrap:wrap">
    <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.18em;color:#c9a962">${COPY.band.startsIn}</span>
    ${cell('days', COPY.band.units[0])}
    ${cell('hrs', COPY.band.units[1])}
    ${cell('min', COPY.band.units[2])}
    ${vr}
    <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:rgba(247,241,230,.9)">${esc(ebLabel)}</span>
    ${vr}
    <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:rgba(247,241,230,.9)">${esc(fmt.upper(`${shortRange(D.conf.start, D.conf.end).replace(/, \d{4}$/, '')} · ${D.conf.venue}, ${D.conf.city}`))}</span>
    ${vr}
    <span data-act="dlIcs" style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#c9a962;cursor:pointer;white-space:nowrap">${COPY.band.ics}</span>
  </div>
  <!-- /dc -->`;
}
function speakerCard(sp, { program } = {}) {
  const meta = D.meta[sp.id] || {};
  const portrait = sp.photo_url
    ? `<img class="mx-portrait" src="${esc(sp.photo_url)}" alt="${esc(sp.name)}" loading="lazy">`
    : `PORTRAIT · ${esc(fmt.upper(sp.name))}`;
  const logo = meta.institution_logo_url
    ? `<img class="mx-logo" src="${esc(meta.institution_logo_url)}" alt="${esc(sp.institution || '')}" loading="lazy">`
    : `<div style="height:24px;width:130px;background:repeating-linear-gradient(45deg,rgba(25,21,18,.07) 0 6px,transparent 6px 12px);display:flex;align-items:center;justify-content:center;font:600 8px ui-monospace,Menlo,monospace;color:#4a4239;margin-top:2px">${esc(instShort(sp))} LOGO</div>`;
  if (program) return `
      <div style="border:1px solid rgba(25,21,18,.16);background:#fdfaf3;display:flex;flex-direction:column">
        <div style="aspect-ratio:1/1;background:repeating-linear-gradient(45deg,rgba(25,21,18,.07) 0 10px,rgba(25,21,18,.03) 10px 20px);display:flex;align-items:center;justify-content:center;font:600 9.5px ui-monospace,Menlo,monospace;color:#4a4239;position:relative;overflow:hidden">${portrait}<span style="position:absolute;top:10px;left:10px;padding:2px 7px;border:1px solid rgba(201,169,98,.65);background:#fdfaf3;color:#6e5626;font:600 8.5px Inter,sans-serif;letter-spacing:.14em">${esc(speakerTag(sp))}</span></div>
        <div style="padding:14px 16px;display:flex;flex-direction:column;gap:6px;flex:1">
          <span style="font-family:Fraunces,serif;font-size:16px;line-height:1.2">${esc(sp.name)}</span>
          <span style="font-size:11.5px;color:#4a4239">${esc(speakerRole(sp))}</span>
          <span data-act="vb" data-id="${esc(sp.id)}" style="font:600 9.5px Inter,sans-serif;letter-spacing:.15em;color:#9b1b22;margin-top:auto;cursor:pointer;white-space:nowrap">${COPY.prog.bioAdd}</span>
        </div>
      </div>`;
  return `
      <div style="border:1px solid rgba(25,21,18,.16);background:#fdfaf3;display:flex;flex-direction:column">
        <div style="aspect-ratio:1/1;background:repeating-linear-gradient(45deg,rgba(25,21,18,.07) 0 10px,rgba(25,21,18,.03) 10px 20px);display:flex;align-items:center;justify-content:center;font:600 9.5px ui-monospace,Menlo,monospace;color:#4a4239;position:relative;overflow:hidden">${portrait}</div>
        <div style="padding:16px;display:flex;flex-direction:column;gap:7px;flex:1">
          <span style="align-self:flex-start;padding:3px 7px;border:1px solid rgba(201,169,98,.65);color:#6e5626;font:600 8.5px Inter,sans-serif;letter-spacing:.14em">${COPY.stage.confirmed}</span>
          <span style="font-family:Fraunces,serif;font-size:17px;line-height:1.2">${esc(sp.name)}</span>
          <span style="font-size:12px;color:#4a4239">${esc(speakerRole(sp))}</span>
          ${logo}
          <span data-act="vb" data-id="${esc(sp.id)}" style="font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#9b1b22;margin-top:auto;cursor:pointer;white-space:nowrap">${COPY.stage.viewBio}</span>
        </div>
      </div>`;
}
function ovStage() {
  const four = D.speakers.slice(0, 4);
  return `
    <!-- dc: Plexus Conference.dc.html › "01 · ON THE PLEXUS STAGE" -->
    <div class="mx-wrap-row" style="display:flex;align-items:baseline;gap:14px;padding:24px 0 4px">
      <span style="font-family:Fraunces,serif;font-weight:600;font-size:14px;color:#9b1b22">${COPY.stage.n}</span>
      <span style="font:600 14px Inter,sans-serif;letter-spacing:.14em">${COPY.stage.title}</span>
      <a href="/app/plexus/program" style="font:600 10.5px Inter,sans-serif;letter-spacing:.16em;color:#9b1b22;margin-left:10px;white-space:nowrap">${COPY.stage.all}</a>
    </div>
    <div style="font-size:13px;color:#4a4239;max-width:640px;line-height:1.55">${esc(COPY.stage.sub)}</div>
    ${four.length ? `
    <div class="mx-grid-4" style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:16px;padding:18px 0 24px">
      ${four.map(sp => speakerCard(sp)).join('')}
    </div>` : `
    <div class="empty" style="padding:26px 0 24px">
      <span class="rule-gold" style="margin-bottom:6px"></span>
      <span class="empty-line">${esc(COPY.stage.emptyLine)}</span>
      <span class="empty-why">${esc(COPY.stage.emptyWhy)}</span>
      <span data-act="interested" style="margin-top:8px;padding:11px 20px;border:1px solid rgba(25,21,18,.3);font:600 10px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;color:#191512;white-space:nowrap">${st.interested || D.followed ? COPY.hero.noted : COPY.hero.interested}</span>
    </div>`}
    <!-- /dc -->`;
}
function ovThreads() {
  return `
    <!-- dc: Plexus Conference.dc.html › "02 · THIS YEAR'S THREADS" -->
    <div style="border-top:1px solid rgba(25,21,18,.16)">
      <div class="mx-wrap-row" style="display:flex;align-items:baseline;gap:14px;padding:24px 0 12px">
        <span style="font-family:Fraunces,serif;font-weight:600;font-size:14px;color:#9b1b22">${COPY.threads.n}</span>
        <span style="font:600 14px Inter,sans-serif;letter-spacing:.14em">${COPY.threads.title}</span>
        <span style="font-size:12px;color:#4a4239">${COPY.threads.sub}</span>
      </div>
      <div class="mx-grid-2" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;padding-bottom:26px">
        ${COPY.threads.items.map(t => `
        <div style="border:1px solid rgba(25,21,18,.16);border-top:2px solid ${t.accent};background:#fdfaf3;padding:20px 22px;display:flex;flex-direction:column;gap:8px">
          <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:${t.color}">${t.n}</span>
          <span style="font-family:Fraunces,serif;font-size:21px;line-height:1.2">${t.title}</span>
          <span style="font-size:12.5px;color:#4a4239;line-height:1.6">${t.body}</span>
        </div>`).join('')}
      </div>
    </div>
    <!-- /dc -->`;
}
function glanceRows() {
  const rows = [];
  const days = eachDay(D.conf.start, D.conf.end);
  days.forEach((d, i) => {
    const sess = D.sessions.filter(s => Number(s.day || 1) === i + 1);
    const label = i === 0 ? d3(d) : `${WD3[d.getDay()]}, ${MON3[d.getMonth()]} ${d.getDate()}`;
    if (sess.length) {
      const first = hhmm(sess[0].start_time), last = hhmm(sess[sess.length - 1].end_time || sess[sess.length - 1].start_time);
      rows.push({ left: label, title: COPY.glance.dayTitles[i] || COPY.glance.dayGeneric(i + 1), right: first && last && first !== last ? `${first} – ${last}` : (first ? COPY.glance.from(first) : COPY.glance.inPrep) });
    } else {
      rows.push({ left: label, title: COPY.glance.dayTitles[i] || COPY.glance.dayGeneric(i + 1), right: COPY.glance.inPrep });
    }
  });
  const rec = D.sessions.find(s => /reception|networking|social/i.test(`${s.session_type} ${s.title}`));
  if (rec) rows.splice(1, 0, { left: `${WD3[(fmt.toDate(D.conf.start) || new Date()).getDay()]}, ${hhmm(rec.start_time) || '18:00'}`, title: esc(rec.title || COPY.glance.reception), right: COPY.glance.free });
  const gd = fmt.toDate(D.gala.date);
  rows.push({ left: `${gd ? WD3[gd.getDay()] : 'SAT'}, ${D.gala.time}`, title: COPY.glance.galaTitle, right: fmt.upper(D.gala.venueShort), gala: true });
  return rows;
}
function ovProgramInk() {
  const rows = glanceRows();
  const when = `${(fmt.toDate(D.gala.date) ? ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][fmt.toDate(D.gala.date).getDay()] : 'Saturday')}, ${fmt.longRange(D.gala.date, D.gala.date).replace(/, \d{4}$/, '')}, ${D.gala.time}`;
  return `
  <!-- dc: Plexus Conference.dc.html › "03 · THE PROGRAM" (+ Gala + "04 · CONNECT WITH PARTICIPANTS") -->
  <div class="mx-pad-ink" style="background:#191512;color:#f7f1e6;padding:32px 36px 34px">
    <div class="mx-grid-side" style="display:grid;grid-template-columns:1fr 1.1fr;gap:48px">
      <div>
        <div class="mx-wrap-row" style="display:flex;align-items:baseline;gap:14px;padding-bottom:12px">
          <span style="font-family:Fraunces,serif;font-weight:600;font-size:14px;color:#c9a962">${COPY.glance.n}</span>
          <span style="font:600 14px Inter,sans-serif;letter-spacing:.14em">${COPY.glance.title}</span>
          <a href="/app/plexus/program" style="font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#c9a962;margin-left:10px;text-decoration:none;white-space:nowrap">${COPY.glance.full}</a>
        </div>
        ${rows.map((r, i) => `
        <div class="mx-glance-row" style="display:flex;gap:16px;align-items:baseline;padding:11px 0;${i < rows.length - 1 ? 'border-bottom:1px solid rgba(247,241,230,.14)' : ''}">
          <span style="font:600 10px Inter,sans-serif;letter-spacing:.14em;color:#c9a962;width:88px;flex:none">${esc(fmt.upper(r.left))}</span>
          <span style="font-family:Fraunces,serif;font-size:16px;flex:1">${r.title}</span>
          <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.14em;color:rgba(247,241,230,.55);white-space:nowrap">${esc(r.right)}</span>
        </div>`).join('')}
      </div>
      <div class="mx-grid-photo" style="display:grid;grid-template-columns:200px 1fr;gap:20px;align-items:center">
        <div style="position:relative;min-height:210px"><img src="/assets/photo-gala.jpg" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:top;border:1px solid rgba(201,169,98,.5)"></div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.2em;color:#c9a962">${COPY.galaBlock.eyebrow}</span>
          <span style="font-family:Fraunces,serif;font-size:23px;line-height:1.15">${COPY.galaBlock.title}</span>
          <span style="font-size:12px;color:rgba(247,241,230,.7);line-height:1.55">${esc(COPY.galaBlock.body(when, D.gala.venueFull))}</span>
          <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">
            <a href="${formUrl('gala')}" style="padding:10px 16px;background:#c9a962;color:#191512;font:600 9.5px Inter,sans-serif;letter-spacing:.15em;text-decoration:none;white-space:nowrap">${COPY.galaBlock.rsvp(fmt.eur(D.gala.price))}</a>
            <span style="font-size:11px;color:rgba(247,241,230,.55)">${COPY.galaBlock.note}</span>
          </div>
        </div>
      </div>
    </div>
    <div class="mx-wrap-row" style="display:flex;align-items:center;gap:26px;margin-top:26px;border:1px solid rgba(201,169,98,.45);padding:18px 22px;flex-wrap:wrap">
      <span class="mx-min-420" style="display:flex;flex-direction:column;gap:5px;flex:1;min-width:300px">
        <span style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap">
          <span style="font-family:Fraunces,serif;font-weight:600;font-size:14px;color:#c9a962">${COPY.connect.n}</span>
          <span style="font:600 12px Inter,sans-serif;letter-spacing:.16em">${COPY.connect.title}</span>
          ${(session.user || {}).quiet ? '' : `<span style="padding:2px 7px;border:1px solid rgba(201,169,98,.5);color:#c9a962;font:600 8.5px Inter,sans-serif;letter-spacing:.14em;white-space:nowrap">${COPY.connect.pts}</span>`}
        </span>
        <span style="font-family:Fraunces,serif;font-style:italic;font-size:17px">${COPY.connect.line}</span>
        <span style="font-size:12px;color:rgba(247,241,230,.65);line-height:1.5">${COPY.connect.body}</span>
      </span>
      <a href="/app/network" style="padding:13px 20px;background:#9b1b22;color:#f7f1e6;font:600 10px Inter,sans-serif;letter-spacing:.15em;flex:none;white-space:nowrap" data-hover="background:#7e151b;color:#f7f1e6">${COPY.connect.cta}</a>
    </div>
  </div>
  <!-- /dc -->`;
}
function ovPhotos() {
  const n = D.impact && D.impact.registrations;
  return `
    <!-- dc: Plexus Conference.dc.html › "MOMENTS FROM PAST CONFERENCES" -->
    <div class="mx-grid-4 mx-photo-strip" style="display:grid;grid-template-columns:repeat(4,1fr);grid-auto-rows:150px;gap:12px;padding:34px 0 24px">
      <img src="/assets/photo-hall.jpg" alt="" style="width:100%;height:100%;object-fit:cover;display:block">
      <img src="/assets/photo-ballroom.jpg" alt="" style="width:100%;height:100%;object-fit:cover;display:block">
      <img src="/assets/photo-candlelit.jpg" alt="" style="width:100%;height:100%;object-fit:cover;display:block">
      <div style="background:#efe7d8;color:#191512;padding:18px 20px;display:flex;flex-direction:column;justify-content:center;gap:8px">
        <span style="font:600 9px Inter,sans-serif;letter-spacing:.2em;color:#9b1b22">${COPY.photos.label}</span>
        <span style="font-family:Fraunces,serif;font-style:italic;font-size:16px;line-height:1.35">${esc(COPY.photos.line(n))}</span>
        <span data-act="gallery" style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#9b1b22;cursor:pointer;white-space:nowrap">${COPY.photos.all}</span>
      </div>
    </div>
    <!-- /dc -->`;
}
function overviewTpl() {
  return `
<div data-screen-label="Plexus Conference" style="font-family:Inter,sans-serif;color:#191512;background:#f7f1e6;min-height:100vh">
  ${crumb([{ label: COPY.crumb.projects }, { label: COPY.crumb.plexus, current: true }])}
  <div data-block="hero">${ovHero()}</div>
  ${ovBand()}
  ${tabStrip()}
  <div class="mx-gutter" style="padding:0 36px">
    <div data-block="stage">${ovStage()}</div>
    ${ovThreads()}
  </div>
  ${ovProgramInk()}
  <div class="mx-gutter" style="padding:0 36px">
    ${ovPhotos()}
  </div>
  ${blockHelp(COPY.help.overview, COPY.help.sub, true)}
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
    const right = sess.length ? (first && last && first !== last ? `${first} – ${last}` : (first ? COPY.glance.from(first) : COPY.glance.inPrep)) : COPY.glance.inPrep;
    parts.push(`
        <div ${sess.length ? `data-act="tgDay" data-day="${i}"` : ''} class="mx-day-row" style="display:flex;gap:16px;align-items:baseline;padding:12px 0;border-bottom:1px solid rgba(25,21,18,.12);${sess.length ? 'cursor:pointer' : ''}">
          <span style="font:600 10px Inter,sans-serif;letter-spacing:.14em;color:#9b1b22;width:100px;flex:none">${esc(fmt.upper(d3(d)))}</span>
          <span style="font-family:Fraunces,serif;font-size:16px;flex:1">${COPY.glance.dayTitles[i] || COPY.glance.dayGeneric(i + 1)}</span>
          <span style="font:600 10px Inter,sans-serif;letter-spacing:.14em;color:#4a4239;white-space:nowrap">${esc(right)}</span>
          ${sess.length ? `<span style="font-size:11px;color:#9b1b22;white-space:nowrap">${open ? COPY.prog.collapse : COPY.prog.expand}</span>` : ''}
        </div>`);
    if (sess.length && open) parts.push(`
        <div class="mx-session-indent" style="padding:8px 0 14px 116px;display:flex;flex-direction:column;gap:7px;border-bottom:1px solid rgba(25,21,18,.12)">
          ${sess.map(s => `
          <span style="display:flex;gap:14px;align-items:baseline;font-size:12.5px;color:#4a4239"><span style="font:600 10px Inter,sans-serif;color:#9b1b22;width:44px;flex:none">${esc(hhmm(s.start_time))}</span><span style="flex:1">${esc(s.title || 'Session')}${s.room ? ` <span style="color:#9b8f80">· ${esc(s.room)}</span>` : ''}</span><span data-act="tgSession" data-id="${esc(s.id)}" data-v2="add-to-my-schedule" style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:${D.mySched.has(s.id) ? '#6e5626' : '#9b1b22'};cursor:pointer;white-space:nowrap">${D.mySched.has(s.id) ? COPY.prog.added : COPY.prog.add}</span></span>`).join('')}
          <span style="font-size:11px;color:#4a4239;font-style:italic">${COPY.prog.timesNote}</span>
        </div>`);
    // Welcome-reception interstitial row after day 1 — only from a published session
    if (i === 0) {
      const rec = D.sessions.find(s => /reception|networking|social/i.test(`${s.session_type} ${s.title}`));
      if (rec) parts.push(`
        <div class="mx-day-row" style="display:flex;gap:16px;align-items:baseline;padding:12px 0;border-bottom:1px solid rgba(25,21,18,.12)">
          <span style="font:600 10px Inter,sans-serif;letter-spacing:.14em;color:#9b1b22;width:100px;flex:none">${esc(fmt.upper(`${WD3[d.getDay()]}, ${hhmm(rec.start_time) || '18:00'}`))}</span>
          <span style="font-family:Fraunces,serif;font-size:16px;flex:1">${esc(rec.title)}</span>
          <span style="font:600 10px Inter,sans-serif;letter-spacing:.14em;color:#4a4239">${COPY.glance.free}</span>
        </div>`);
    }
  });
  const gd = fmt.toDate(D.gala.date);
  parts.push(`
        <div class="mx-day-row" style="display:flex;gap:16px;align-items:baseline;padding:12px 0">
          <span style="font:600 10px Inter,sans-serif;letter-spacing:.14em;color:#6e5626;width:100px;flex:none">${esc(fmt.upper(`${gd ? WD3[gd.getDay()] : 'SAT'}, ${D.gala.time}`))}</span>
          <span style="font-family:Fraunces,serif;font-size:16px;flex:1">${COPY.glance.galaTitle.replace('#c9a962', '#9b1b22')}</span>
          <span style="font:600 10px Inter,sans-serif;letter-spacing:.14em;color:#6e5626;white-space:nowrap">${esc(fmt.upper(D.gala.venueShort))}</span>
        </div>`);
  return { html: parts.join(''), anySessions };
}
function progSpeakers() {
  const q = norm(st.q);
  const list = D.speakers.filter(sp => {
    const tag = speakerTag(sp);
    if (st.spf !== 'ALL' && !tag.includes(st.spf)) return false;
    if (!q) return true;
    return norm(`${sp.name} ${sp.title} ${sp.institution} ${sp.talk_title}`).includes(q);
  });
  return list.length ? `
    <div class="mx-grid-4" style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:16px;padding-bottom:10px">
      ${list.map(sp => speakerCard(sp, { program: true })).join('')}
    </div>` : `
    <div class="empty" style="padding:20px 0 14px">
      <span class="rule-gold" style="margin-bottom:6px"></span>
      <span class="empty-line">${esc(COPY.prog.spEmpty(st.q.trim()))}</span>
      <span class="empty-why">${esc(COPY.prog.spEmptyWhy)}</span>
    </div>`;
}
function programTpl() {
  const { html: dayHtml, anySessions } = progDays();
  return `
<div data-screen-label="Plexus Program" style="font-family:Inter,sans-serif;color:#191512;background:#f7f1e6;min-height:100vh">
  ${crumb([{ label: COPY.crumb.projects }, { label: COPY.crumb.plexus, to: '/app/plexus' }, { label: COPY.crumb.program }])}
  ${tabStrip()}
  <div class="mx-gutter" style="padding:0 36px">
    <!-- dc: Plexus Program.dc.html › "01 · THE PROGRAM" -->
    <div class="mx-prog-head" style="display:flex;align-items:baseline;gap:14px;padding:26px 0 12px">
      <span style="font-family:Fraunces,serif;font-weight:600;font-size:14px;color:#9b1b22">${COPY.prog.n}</span>
      <span style="font:600 14px Inter,sans-serif;letter-spacing:.14em">${COPY.prog.title}</span>
      <span data-act="dlIcs" style="font:600 10.5px Inter,sans-serif;letter-spacing:.16em;color:#9b1b22;cursor:pointer;margin-left:10px;white-space:nowrap">${COPY.prog.ics}</span>
      <span data-act="pdf" style="padding:8px 14px;border:1px solid rgba(25,21,18,.3);font:600 9.5px Inter,sans-serif;letter-spacing:.15em;cursor:pointer;margin-left:6px;white-space:nowrap" data-hover="border-color:#191512">${COPY.prog.pdf}</span>
      <span class="mx-hint" style="font-size:11.5px;color:#4a4239;margin-left:auto">${anySessions ? COPY.prog.hint : ''}</span>
    </div>
    <div data-block="days" style="display:grid;grid-template-columns:1fr;gap:0;padding-bottom:6px;max-width:960px">
      <div>${dayHtml}</div>
    </div>
    <div style="display:flex;align-items:baseline;gap:12px;padding:10px 0 24px;flex-wrap:wrap">
      ${anySessions ? '' : `<span style="font-size:12px;font-style:italic;color:#4a4239">${COPY.prog.prepLine}</span>`}
      ${D.next.registered
        ? `<a href="/app/plexus/mine" style="font:600 9.5px Inter,sans-serif;letter-spacing:.15em;white-space:nowrap">${COPY.prog.mine}</a>`
        : `<a href="${formUrl('conference')}" style="font:600 9.5px Inter,sans-serif;letter-spacing:.15em;white-space:nowrap">${COPY.prog.register}</a>`}
    </div>
    <!-- /dc -->
    <!-- dc: Plexus Program.dc.html › "02 · SPEAKERS" -->
    <div class="mx-speakers-head" style="display:flex;align-items:baseline;gap:14px;border-top:1px solid rgba(25,21,18,.16);padding:24px 0 12px">
      <span style="font-family:Fraunces,serif;font-weight:600;font-size:14px;color:#9b1b22">${COPY.prog.spN}</span>
      <span style="font:600 14px Inter,sans-serif;letter-spacing:.14em">${COPY.prog.spTitle}</span>
      <div class="mx-speaker-filters" style="display:flex;margin-left:14px;gap:6px" role="group" aria-label="Filter speakers">
        ${COPY.prog.spFilters.map(f => { const on = st.spf === f; return `<span data-act="spf" data-f="${f}" role="radio" aria-checked="${on}" style="padding:7px 12px;border:1px solid ${on ? '#191512' : 'rgba(25,21,18,.3)'};background:${on ? '#191512' : 'transparent'};color:${on ? '#f7f1e6' : '#4a4239'};font:600 9px Inter,sans-serif;letter-spacing:.15em;cursor:pointer">${f}</span>`; }).join('')}
      </div>
      <input data-role="speakerQ" type="search" class="mx-speaker-q mx-w220" placeholder="${COPY.prog.spSearch}" aria-label="Search speakers" autocomplete="off" value="${esc(st.q)}" style="margin-left:auto;border:1px solid rgba(25,21,18,.22);padding:8px 14px;font-size:12px;color:#4a4239;width:220px">
    </div>
    <div data-block="speakers">${progSpeakers()}</div>
    <div style="font-size:12px;color:#4a4239;padding-bottom:24px">${COPY.prog.spHint}</div>
    <!-- /dc -->
  </div>
  ${blockHelp(COPY.help.program, COPY.help.subShort, true)}
  <div data-block="bio">${blockBio()}</div>
</div>`;
}

// ---------------------------------------------------------------- ZAGREB (Plexus Zagreb.dc.html)
function zagrebTpl() {
  const Z = COPY.zagreb;
  const stopCard = (s) => `
      <div ${s.wide ? 'class="mx-span-2" style="position:relative;overflow:hidden;grid-column:span 2"' : 'style="position:relative;overflow:hidden"'}>
        <div style="position:absolute;inset:0;background:repeating-linear-gradient(45deg,rgba(25,21,18,.09) 0 12px,rgba(25,21,18,.04) 12px 24px)"></div>
        <span style="position:absolute;left:14px;top:12px;font:600 8.5px ui-monospace,Menlo,monospace;color:#4a4239">${esc(s.ph)}</span>
        <div style="position:absolute;left:0;right:0;bottom:0;padding:${s.wide ? '44px 18px 16px' : '36px 18px 14px'};background:linear-gradient(180deg,rgba(25,21,18,0) 0%,rgba(25,21,18,.85) 70%)">
          <span style="font-family:Fraunces,serif;font-weight:600;font-size:${s.wide ? '15px' : '14px'};color:#c9a962">${s.n}</span>
          <span style="display:block;font-family:Fraunces,serif;font-size:${s.wide ? '21px' : '18px'};color:#f7f1e6${s.wide ? ';margin-top:2px' : ''}">${esc(s.name)}</span>
          <span style="display:block;font-size:${s.wide ? '12px' : '11.5px'};color:rgba(247,241,230,.75);margin-top:${s.wide ? '3px' : '2px'}">${esc(s.note)}</span>
        </div>
      </div>`;
  return `
<div data-screen-label="Explore Zagreb" style="font-family:Inter,sans-serif;color:#191512;background:#f7f1e6;min-height:100vh">
  ${crumb([{ label: COPY.crumb.projects }, { label: COPY.crumb.plexus, to: '/app/plexus' }, { label: COPY.crumb.zagreb }])}
  ${tabStrip()}
  <!-- dc: Plexus Zagreb.dc.html › "Hero" -->
  <div style="position:relative;overflow:hidden">
    <div style="position:absolute;inset:0;background:repeating-linear-gradient(45deg,rgba(25,21,18,.1) 0 14px,rgba(25,21,18,.05) 14px 28px)"></div>
    <div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(25,21,18,.5) 0%,rgba(25,21,18,.68) 100%)"></div>
    <span style="position:absolute;right:16px;bottom:12px;font:600 8.5px ui-monospace,Menlo,monospace;color:rgba(247,241,230,.6)">${esc(Z.heroPh)}</span>
    <div class="mx-pad-hero-z" style="position:relative;padding:84px 36px 72px;display:flex;flex-direction:column;align-items:center;text-align:center">
      <span style="padding:6px 12px;border:1px solid rgba(201,169,98,.7);color:#c9a962;font:600 10px Inter,sans-serif;letter-spacing:.18em">${esc(Z.eyebrow)}</span>
      <div class="mx-display-54" style="font-family:Fraunces,serif;font-style:italic;font-size:54px;line-height:1.05;color:#f7f1e6;margin-top:20px">${esc(Z.title)}</div>
      <div style="font-size:15px;color:rgba(247,241,230,.85);margin-top:12px;max-width:560px;line-height:1.6">${esc(Z.line)}</div>
      <div style="display:flex;gap:13px;margin-top:26px;flex-wrap:wrap;justify-content:center">
        <span data-act="guide" style="padding:13px 22px;background:#c9a962;color:#191512;font:600 10.5px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;white-space:nowrap" data-hover="background:#b8994f">${Z.guide}</span>
        <a href="/app/plexus/mine" style="padding:13px 22px;border:1px solid rgba(247,241,230,.45);color:#f7f1e6;font:600 10.5px Inter,sans-serif;letter-spacing:.16em;text-decoration:none;white-space:nowrap" data-hover="border-color:#f7f1e6;color:#f7f1e6">${Z.myPlexus}</a>
      </div>
    </div>
  </div>
  <!-- /dc -->
  <div class="mx-gutter" style="padding:0 36px">
    <!-- dc: Plexus Zagreb.dc.html › "01 · SIX STOPS BEFORE DINNER" -->
    <div class="mx-wrap-row" style="display:flex;align-items:baseline;gap:14px;padding:26px 0 14px">
      <span style="font-family:Fraunces,serif;font-weight:600;font-size:14px;color:#9b1b22">${Z.stopsN}</span>
      <span style="font:600 14px Inter,sans-serif;letter-spacing:.14em">${Z.stopsTitle}</span>
      <span style="font-size:12.5px;color:#4a4239">${esc(Z.stopsSub)}</span>
    </div>
    <div class="mx-grid-4 mx-zagreb-grid" style="display:grid;grid-template-columns:repeat(4,1fr);grid-auto-rows:210px;gap:14px;padding-bottom:26px">
      ${Z.stops.map(stopCard).join('')}
      <div style="background:#191512;color:#f7f1e6;padding:20px 22px;display:flex;flex-direction:column;justify-content:center;gap:8px">
        <span style="font-family:Fraunces,serif;font-weight:600;font-size:15px;color:#c9a962">+</span>
        <span style="font-family:Fraunces,serif;font-style:italic;font-size:18px;line-height:1.3">${esc(Z.bonus.title)}</span>
        <span style="font-size:11.5px;color:rgba(247,241,230,.7);line-height:1.5">${esc(Z.bonus.note)}</span>
      </div>
    </div>
    <!-- /dc -->
    <!-- dc: Plexus Zagreb.dc.html › "02 · TASTE ZAGREB" -->
    <div class="mx-wrap-row" style="display:flex;align-items:baseline;gap:14px;border-top:1px solid rgba(25,21,18,.16);padding:24px 0 14px">
      <span style="font-family:Fraunces,serif;font-weight:600;font-size:14px;color:#9b1b22">${Z.tasteN}</span>
      <span style="font:600 14px Inter,sans-serif;letter-spacing:.14em">${Z.tasteTitle}</span>
      <span style="font-family:Fraunces,serif;font-style:italic;font-size:14px;color:#4a4239">${esc(Z.tasteSub)}</span>
    </div>
    <div class="mx-grid-4" style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:16px;padding-bottom:26px">
      ${Z.taste.map(t => `
      <div style="border:1px solid rgba(25,21,18,.16);background:#fdfaf3;display:flex;flex-direction:column">
        <div style="height:120px;background:repeating-linear-gradient(45deg,rgba(25,21,18,.08) 0 10px,rgba(25,21,18,.03) 10px 20px);display:flex;align-items:center;justify-content:center;font:600 8.5px ui-monospace,Menlo,monospace;color:#4a4239">${esc(t.ph)}</div>
        <div style="padding:14px 16px;display:flex;flex-direction:column;gap:4px"><span style="font-family:Fraunces,serif;font-size:16px">${esc(t.name)}</span><span style="font-size:12px;color:#4a4239;line-height:1.5">${esc(t.note)}</span></div>
      </div>`).join('')}
    </div>
    <!-- /dc -->
    <!-- dc: Plexus Zagreb.dc.html › "03 · GETTING AROUND" -->
    <div class="mx-wrap-row" style="background:#191512;color:#f7f1e6;padding:18px 24px;display:flex;align-items:center;gap:30px;flex-wrap:wrap;margin-bottom:24px">
      <span style="font:600 10px Inter,sans-serif;letter-spacing:.18em;color:#c9a962">${Z.aroundTitle}</span>
      ${Z.around.map(a => `<span style="display:flex;gap:9px;align-items:center;font-size:12.5px"><span style="width:6px;height:6px;background:#c9a962;flex:none"></span><strong>${a.b}</strong>${a.t}</span>`).join('\n      ')}
    </div>
    <div style="border-top:1px solid rgba(25,21,18,.16);padding:20px 0 8px;text-align:center">
      <span style="font-family:Fraunces,serif;font-style:italic;font-size:19px;color:#4a4239">${esc(Z.closing)}</span>
    </div>
    <!-- /dc -->
  </div>
  ${blockHelp(COPY.help.zagreb, COPY.help.subShort, false)}
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
function mineHero() {
  const s = mineState();
  const eyebrow = s === 'none' ? (D.conf.open ? COPY.mine.eyebrow.open : COPY.mine.eyebrow.closed)
    : s === 'registered' ? COPY.mine.eyebrow.registered
    : s === 'galaPending' ? COPY.mine.eyebrow.galaPending
    : s === 'galaApproved' ? COPY.mine.eyebrow.galaApproved : COPY.mine.eyebrow.galaPaid;
  const lead = COPY.mine.lead[s === 'registered' ? 'registered' : s === 'none' ? 'none' : s];
  let cta, sub;
  if (s === 'none') cta = `<a href="${formUrl('conference,gala')}" style="padding:15px 28px;background:#9b1b22;color:#f7f1e6;font:600 11px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;white-space:nowrap;text-decoration:none" data-hover="background:#7e151b">${COPY.mine.register}</a>`, sub = COPY.mine.ctaSub.none;
  else if (s === 'registered') cta = `<a href="${formUrl('gala')}" style="padding:15px 28px;background:#9b1b22;color:#f7f1e6;font:600 11px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;white-space:nowrap;text-decoration:none" data-hover="background:#7e151b">${COPY.mine.addGala}</a>`, sub = COPY.mine.ctaSub.gala;
  else if (s === 'galaApproved') cta = `<span data-act="payGala" style="padding:15px 28px;background:#c9a962;color:#191512;font:600 11px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;white-space:nowrap" data-hover="background:#d9bd7f">${COPY.mine.pay}</span>`, sub = COPY.mine.ctaSub.pay;
  else cta = `<a href="/app/me" style="padding:15px 28px;background:#9b1b22;color:#f7f1e6;font:600 11px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;white-space:nowrap;text-decoration:none" data-hover="background:#7e151b">${COPY.mine.tickets}</a>`, sub = s === 'galaPending' ? esc(COPY.mine.payPending) : COPY.mine.ctaSub.done;
  return `
  <!-- dc: My Plexus.dc.html › "MY PLEXUS · REGISTRATION" (hero) -->
  <div class="mx-pad-mine" style="border-bottom:1px solid rgba(25,21,18,.16);padding:44px 36px 34px">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
      <span style="width:28px;height:1px;background:#c9a962"></span>
      <span style="font:600 11px Inter,sans-serif;letter-spacing:.18em;color:#9b1b22">${eyebrow}</span>
    </div>
    <div class="mx-wrap-row" style="display:flex;align-items:center;gap:44px;flex-wrap:wrap">
      <div class="mx-min-420" style="flex:1;min-width:420px">
        <div class="mx-display-42" style="font-family:Fraunces,serif;font-size:42px;line-height:1.1">${COPY.mine.title.replace('2026', String(D.conf.year))}</div>
        <div style="font-size:14.5px;line-height:1.6;color:#4a4239;max-width:520px;margin-top:14px">${lead}</div>
        <div style="display:flex;align-items:center;gap:14px;margin-top:22px;flex-wrap:wrap">
          ${cta}
          <span style="font:600 8.5px Inter,sans-serif;letter-spacing:.16em;color:#4a4239">${sub}</span>
        </div>
      </div>
      <div class="mx-mine-facts" style="display:grid;grid-template-columns:auto auto;gap:12px 18px;align-items:baseline;border-left:1px solid rgba(25,21,18,.16);padding-left:34px">
        <span style="font-family:Fraunces,serif;font-size:15.5px">${COPY.mine.facts.conference}</span><span style="font:600 9.5px Inter,sans-serif;letter-spacing:.14em;color:#4a4239">${esc(shortRange(D.conf.start, D.conf.end))}</span>
        <span style="font-family:Fraunces,serif;font-size:15.5px">${COPY.mine.facts.gala}</span><span style="font:600 9.5px Inter,sans-serif;letter-spacing:.14em;color:#4a4239">${esc(shortRange(D.gala.date, D.gala.date))}</span>
        <span style="font-family:Fraunces,serif;font-size:15.5px">${COPY.mine.facts.eb}</span><span style="font:600 9.5px Inter,sans-serif;letter-spacing:.14em;color:#4a4239">${esc(COPY.mine.facts.until(fmt.upper(monthDay(D.gala.ebDeadline))))}</span>
      </div>
    </div>
  </div>
  <!-- /dc -->`;
}
function mineIncluded() {
  const s = mineState();
  const g = galaState();
  const registered = !!D.myReg || !!D.next.registered;
  const bullets = (items, dark) => items.map(t => `
          <span style="display:flex;gap:10px;align-items:center"><span style="width:6px;height:6px;background:#c9a962;flex:none"></span>${t}</span>`).join('');
  const confDays = `${fmt.longRange(D.conf.start, D.conf.end).replace(/, \d{4}$/, '').replace('–', ' & ').replace(/^(\w+) /, '$1 ')}`;
  const confCta = registered
    ? `<span style="margin-top:auto;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span style="padding:6px 10px;border:1px solid rgba(201,169,98,.65);color:#6e5626;font:600 8.5px Inter,sans-serif;letter-spacing:.14em;white-space:nowrap">${COPY.mine.confCard.tagDone}</span><a href="/app/me" style="padding:12px 20px;background:#9b1b22;color:#f7f1e6;font:600 10px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;white-space:nowrap;text-decoration:none" data-hover="background:#7e151b">${COPY.mine.confCard.ctaDone}</a></span>`
    : `<a href="${formUrl('conference')}" style="margin-top:auto;align-self:flex-start;padding:12px 20px;background:#9b1b22;color:#f7f1e6;font:600 10px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;white-space:nowrap;text-decoration:none" data-hover="background:#7e151b">${COPY.mine.confCard.cta}</a>`;
  const galaCta = g === 'paid'
    ? `<span style="margin-top:auto;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span style="padding:6px 10px;border:1px solid rgba(201,169,98,.65);color:#c9a962;font:600 8.5px Inter,sans-serif;letter-spacing:.14em;white-space:nowrap">${COPY.mine.galaCard.tagPaid}</span><a href="/app/me" style="padding:12px 20px;background:#c9a962;color:#191512;font:600 10px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;white-space:nowrap;text-decoration:none" data-hover="background:#d9bd7f">${COPY.mine.galaCard.ctaPaid}</a></span>`
    : g === 'approved'
    ? `<span data-act="payGala" style="margin-top:auto;align-self:flex-start;padding:12px 20px;background:#c9a962;color:#191512;font:600 10px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;white-space:nowrap" data-hover="background:#d9bd7f">${COPY.mine.galaCard.ctaPay}</span>`
    : g === 'pending'
    ? `<span data-act="galaPendingInfo" style="margin-top:auto;align-self:flex-start;padding:12px 20px;border:1px solid rgba(201,169,98,.65);color:#c9a962;font:600 10px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;white-space:nowrap">${COPY.mine.galaCard.tagPending}</span>`
    : `<a href="${formUrl('gala')}" style="margin-top:auto;align-self:flex-start;padding:12px 20px;background:#c9a962;color:#191512;font:600 10px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;white-space:nowrap;text-decoration:none" data-hover="background:#d9bd7f">${COPY.mine.galaCard.cta}</a>`;
  return `
    <!-- dc: My Plexus.dc.html › "01 · WHAT'S INCLUDED" -->
    <div class="mx-wrap-row" style="display:flex;align-items:baseline;gap:14px;padding:24px 0 14px">
      <span style="font-family:Fraunces,serif;font-weight:600;font-size:14px;color:#9b1b22">${COPY.mine.includedN}</span>
      <span style="font:600 14px Inter,sans-serif;letter-spacing:.14em">${COPY.mine.includedTitle}</span>
    </div>
    <div class="mx-grid-2" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;padding-bottom:26px">
      <div style="border:1px solid rgba(25,21,18,.16);border-top:2px solid #9b1b22;background:#fdfaf3;padding:24px;display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;align-items:baseline;gap:12px"><span style="font-family:Fraunces,serif;font-size:20px">${COPY.mine.confCard.title}</span><span style="font:600 10px Inter,sans-serif;letter-spacing:.15em;color:#9b1b22;margin-left:auto;white-space:nowrap">${COPY.mine.confCard.tag}</span></div>
        <div style="display:flex;flex-direction:column;gap:8px;font-size:13px;color:#4a4239">${bullets(COPY.mine.confCard.items(esc(confDays), esc(fmt.longRange(D.conf.start, D.conf.start).replace(/, \d{4}$/, ''))))}
        </div>
        ${confCta}
      </div>
      <div style="border:1px solid rgba(201,169,98,.55);background:#191512;color:#f7f1e6;padding:24px;display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap"><span style="font-family:Fraunces,serif;font-size:20px;white-space:nowrap">${COPY.mine.galaCard.title}</span><span style="font:600 10px Inter,sans-serif;letter-spacing:.15em;color:#c9a962;margin-left:auto;white-space:nowrap">${esc(COPY.mine.galaCard.price(fmt.eur(D.gala.price)))}</span></div>
        <div style="display:flex;flex-direction:column;gap:8px;font-size:13px;color:rgba(247,241,230,.75)">${bullets(COPY.mine.galaCard.items)}
        </div>
        ${galaCta}
      </div>
    </div>
    <!-- /dc -->`;
}
function mineKnow() {
  const registered = !!D.myReg;
  return `
    <!-- dc: My Plexus.dc.html › "02 · GOOD TO KNOW" -->
    <div class="mx-wrap-row" style="display:flex;align-items:baseline;gap:14px;border-top:1px solid rgba(25,21,18,.16);padding:24px 0 14px">
      <span style="font-family:Fraunces,serif;font-weight:600;font-size:14px;color:#9b1b22">${COPY.mine.knowN}</span>
      <span style="font:600 14px Inter,sans-serif;letter-spacing:.14em">${COPY.mine.knowTitle}</span>
    </div>
    <div class="mx-grid-3" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;padding-bottom:26px">
      ${COPY.mine.know.map(k => `
      <div style="border:1px solid rgba(25,21,18,.16);background:#fdfaf3;padding:18px;display:flex;flex-direction:column;gap:6px">
        <span style="font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#c9a962">${k.tag}</span>
        <span style="font-family:Fraunces,serif;font-size:16px">${k.title}</span>
        <span style="font-size:12.5px;color:#4a4239;line-height:1.5">${esc(k.note(fmt.eur(D.gala.price), fmt.longRange(D.gala.ebDeadline, D.gala.ebDeadline).replace(/, \d{4}$/, ''), fmt.eur(D.gala.priceRegular)))}</span>
        ${k.act === 'transfer' && registered ? `<span data-act="transfer" data-v2="transfer request (POST /api/plexus/registration/:id/transfer)" style="font:600 9.5px Inter,sans-serif;letter-spacing:.15em;color:#9b1b22;cursor:pointer;margin-top:4px;white-space:nowrap">${k.actLabel}</span>` : ''}
        ${k.href ? `<a href="${k.href}" style="font:600 9.5px Inter,sans-serif;letter-spacing:.15em;color:#9b1b22;margin-top:4px;white-space:nowrap">${k.actLabel}</a>` : ''}
      </div>`).join('')}
    </div>
    <!-- /dc -->`;
}
function minePassAndWho() {
  const tickets = D.events.filter(ev => ev.ticket && ['plexus', 'gala'].includes(ev.evt));
  const pendingGala = galaState() === 'pending' || galaState() === 'approved';
  const att = D.attendees;
  const AV = [['#191512', '#f7f1e6'], ['#9b1b22', '#f7f1e6'], ['#c9a962', '#191512']];
  return `
    <div class="mx-grid-side" style="display:grid;grid-template-columns:1fr 1fr;gap:44px;border-top:1px solid rgba(25,21,18,.16);padding-bottom:8px">
      <div>
        <!-- dc: My Plexus.dc.html › "03 · MY PASS" -->
        <div style="display:flex;align-items:baseline;gap:14px;padding:24px 0 12px">
          <span style="font-family:Fraunces,serif;font-weight:600;font-size:14px;color:#9b1b22">${COPY.mine.passN}</span>
          <span style="font:600 14px Inter,sans-serif;letter-spacing:.14em">${COPY.mine.passTitle}</span>
        </div>
        <div style="border:1px solid rgba(25,21,18,.16);background:#fdfaf3;padding:26px;display:flex;flex-direction:column;align-items:center;gap:9px;text-align:center">
          ${tickets.length ? `
          <div style="display:flex;gap:22px;flex-wrap:wrap;justify-content:center">
            ${tickets.map(ev => `
            <span style="display:flex;flex-direction:column;align-items:center;gap:7px">
              <img class="mx-qr" src="${esc(api.url(ev.ticket))}" alt="QR pass — ${esc(ev.title)}" loading="lazy">
              <span style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:#4a4239">${esc(fmt.upper(ev.evt === 'gala' ? 'GALA EVENING' : 'CONFERENCE'))}${ev.checked_in ? ' · ✓ CHECKED IN' : ''}</span>
            </span>`).join('')}
          </div>
          <span style="font-size:12.5px;color:#4a4239;max-width:360px">${COPY.mine.passNote}</span>` : `
          <div style="width:58px;height:58px;border:1px dashed rgba(25,21,18,.35);display:flex;align-items:center;justify-content:center;font:600 9px ui-monospace,Menlo,monospace;color:#4a4239;background:repeating-linear-gradient(90deg,rgba(25,21,18,.06) 0 3px,transparent 3px 6px)">QR</div>
          <span style="font-family:Fraunces,serif;font-style:italic;font-size:16.5px;color:#4a4239">${pendingGala ? esc(COPY.mine.passPending) : esc(COPY.mine.passEmptyLine)}</span>
          <span style="font-size:12.5px;color:#4a4239;max-width:360px">${COPY.mine.passEmptyWhy}</span>`}
        </div>
        <!-- /dc -->
      </div>
      <div>
        <!-- dc: My Plexus.dc.html › "04 · WHO FROM YOUR NETWORK ATTENDS" -->
        <div class="mx-wrap-row" style="display:flex;align-items:baseline;gap:14px;padding:24px 0 8px">
          <span style="font-family:Fraunces,serif;font-weight:600;font-size:14px;color:#9b1b22">${COPY.mine.whoN}</span>
          <span style="font:600 14px Inter,sans-serif;letter-spacing:.14em">${COPY.mine.whoTitle}</span>
          ${att.length ? `<span style="padding:2px 6px;border:1px solid rgba(25,21,18,.22);font:600 8.5px Inter,sans-serif;letter-spacing:.14em;color:#4a4239;white-space:nowrap">${esc(COPY.mine.attending(att.length))}</span>` : ''}
        </div>
        ${att.length ? att.slice(0, 5).map((a, i) => `
        <div style="display:flex;gap:16px;align-items:center;padding:9px 0;${i < Math.min(att.length, 5) - 1 ? 'border-bottom:1px solid rgba(25,21,18,.12)' : ''}">
          <span style="width:32px;height:32px;background:${AV[i % 3][0]};color:${AV[i % 3][1]};display:inline-flex;align-items:center;justify-content:center;font:600 11px Fraunces,serif;flex:none">${esc(fmt.initials(a.first_name, a.last_name))}</span>
          <span style="flex:1;min-width:0"><span style="display:block;font-size:13px;font-weight:600">${esc([a.first_name, a.last_name].filter(Boolean).join(' '))}</span><span style="display:block;font-size:11.5px;color:#4a4239">${esc(a.institution || a.country || '')}</span></span>
          <a href="/app/messages?to=${encodeURIComponent(a.id)}" style="font:600 9.5px Inter,sans-serif;letter-spacing:.14em;color:#9b1b22;white-space:nowrap">${COPY.mine.message}</a>
        </div>`).join('') : `
        <div class="empty" style="padding:18px 0 8px;align-items:flex-start;text-align:left">
          <span class="rule-gold" style="margin-bottom:4px"></span>
          <span class="empty-line">${esc(COPY.mine.whoEmptyLine)}</span>
          <span class="empty-why" style="max-width:380px">${esc(COPY.mine.whoEmptyWhy)}</span>
        </div>`}
        <a href="/app/network" style="display:block;font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#9b1b22;padding:10px 0 20px">${COPY.mine.findMore}</a>
        <!-- /dc -->
      </div>
    </div>`;
}
function mineTpl() {
  return `
<div data-screen-label="My Plexus" style="font-family:Inter,sans-serif;color:#191512;background:#f7f1e6;min-height:100vh">
  ${crumb([{ label: COPY.crumb.projects }, { label: COPY.crumb.plexus, to: '/app/plexus' }, { label: COPY.crumb.mine }])}
  ${tabStrip()}
  <div data-block="mine-hero">${mineHero()}</div>
  <div class="mx-gutter" style="padding:0 36px">
    ${mineIncluded()}
    ${mineKnow()}
    ${minePassAndWho()}
  </div>
  ${blockHelp(COPY.help.mine, COPY.help.sub, true)}
</div>`;
}

// ---------------------------------------------------------------- behaviour
function rerender(sel, html) { const el = rootEl && rootEl.querySelector(sel); if (el) el.outerHTML = html; }
function closeBio() { if (!st || !st.bio) return; st.bio = null; rerender('[data-block="bio"]', `<div data-block="bio">${blockBio()}</div>`); }
function openBioFocus() {
  const scrim = rootEl.querySelector('[data-role="bio-scrim"]');
  if (!scrim) return;
  scrim.addEventListener('mousedown', e => { if (e.target === scrim) closeBio(); });
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); closeBio(); document.removeEventListener('keydown', onKey, true); } };
  document.addEventListener('keydown', onKey, true);
  timers.push(() => document.removeEventListener('keydown', onKey, true));
  const x = scrim.querySelector('[data-act="bioClose"]');
  if (x) x.focus();
}

const handlers = {
  interested: async (el) => {
    el.setAttribute('aria-disabled', 'true');
    try {
      await api.post('/api/notify-topics', { project: 'plexus', on: true });
      st.interested = true; D.followed = true;
      rerender('[data-block="hero"]', `<div data-block="hero">${ovHero()}</div>`);
      const stage = rootEl.querySelector('[data-block="stage"]'); if (stage) rerender('[data-block="stage"]', `<div data-block="stage">${ovStage()}</div>`);
      ui.toast(COPY.toasts.interested);
      chrome.refresh();
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  tgFollow: async () => {
    const on = !D.followed;
    try {
      await api.post('/api/notify-topics', { project: 'plexus', on });
      D.followed = on; if (!on) st.interested = false;
      rerender('[data-block="hero"]', `<div data-block="hero">${ovHero()}</div>`);
      ui.toast(on ? COPY.toasts.followed : COPY.toasts.unfollowed);
      chrome.refresh();
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  dlIcs: () => {
    const events = icsEvents();
    if (!events.length) return ui.toast(COPY.toasts.icsNone, { kind: 'error' });
    ui.downloadIcs(COPY.band.icsFile, events);
    ui.toast(COPY.band.icsDone);
  },
  vb: (el) => { st.bio = el.dataset.id; rerender('[data-block="bio"]', `<div data-block="bio">${blockBio()}</div>`); openBioFocus(); },
  bioClose: () => { st.bio = null; rerender('[data-block="bio"]', `<div data-block="bio">${blockBio()}</div>`); },
  gallery: () => {
    const apiPhotos = D.photos || [];
    const imgs = apiPhotos.length
      ? apiPhotos.map(p => `<figure style="margin:0"><img src="${esc(api.url(p.file_path))}" alt="${esc(p.title || 'Plexus photo')}" style="width:100%;height:150px;object-fit:cover;display:block">${p.title ? `<figcaption style="font-size:10.5px;color:#4a4239;padding-top:4px">${esc(p.title)}</figcaption>` : ''}</figure>`).join('')
      : EXPORT_PHOTOS.map(p => `<img src="/assets/${p}" alt="" style="width:100%;height:150px;object-fit:cover;display:block">`).join('');
    ui.modal({
      eyebrow: COPY.photos.modalEyebrow, title: COPY.photos.modalTitle,
      body: `${apiPhotos.length ? '' : `<p style="margin:0 0 12px">${esc(COPY.photos.pending)}</p>`}<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${imgs}</div>`,
      actions: [{ label: 'CLOSE' }]
    });
  },
  pdf: () => { window.open(api.url('/api/v2/plexus/program.pdf'), '_blank', 'noopener'); ui.toast(COPY.toasts.pdfOpen); },
  guide: () => {
    const res = (D.resources || []).find(r => /guide|zagreb|welcome/i.test(`${r.title} ${r.category}`) && (r.file_url || r.file_path || r.url));
    const url = res ? (res.file_url || res.file_path || res.url) : '/api/v2/plexus/welcome-guide.pdf';
    window.open(api.url(url), '_blank', 'noopener');
    ui.toast(COPY.zagreb.guideDone);
  },
  tgDay: (el) => { const i = Number(el.dataset.day); st.dayOpen[i] = !st.dayOpen[i]; rerender('[data-block="days"]', `<div data-block="days" style="display:grid;grid-template-columns:1fr;gap:0;padding-bottom:6px;max-width:960px"><div>${progDays().html}</div></div>`); },
  tgSession: async (el) => {
    const id = el.dataset.id;
    const s = D.sessions.find(x => x.id === id);
    const had = D.mySched.has(id);
    el.setAttribute('aria-disabled', 'true');
    try {
      if (had) { await api.del('/api/plexus/my-schedule/' + encodeURIComponent(id)); D.mySched.delete(id); }
      else { await api.post('/api/plexus/my-schedule/' + encodeURIComponent(id)); D.mySched.add(id); }
      const days = rootEl.querySelector('[data-block="days"]');
      if (days) rerender('[data-block="days"]', `<div data-block="days" style="display:grid;grid-template-columns:1fr;gap:0;padding-bottom:6px;max-width:960px"><div>${progDays().html}</div></div>`);
      if (st.bio) { rerender('[data-block="bio"]', `<div data-block="bio">${blockBio()}</div>`); openBioFocus(); }
      ui.toast(had ? COPY.toasts.sessionRemoved((s && s.title) || 'session') : COPY.toasts.sessionAdded((s && s.title) || 'session'));
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  spf: (el) => { st.spf = el.dataset.f; rerenderSpeakersHead(); },
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
    if (!D.myReg) return ui.toast(COPY.mine.transfer.noReg, { kind: 'error' });
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
};
function rerenderSpeakersHead() {
  // filters live in the head row; grid below — refresh both, keep the input's focus/value
  const q = rootEl.querySelector('[data-role="speakerQ"]');
  const hadFocus = q && document.activeElement === q;
  rootEl.querySelectorAll('[data-act="spf"]').forEach(el => {
    const on = el.dataset.f === st.spf;
    el.setAttribute('aria-checked', String(on));
    el.style.border = `1px solid ${on ? '#191512' : 'rgba(25,21,18,.3)'}`;
    el.style.background = on ? '#191512' : 'transparent';
    el.style.color = on ? '#f7f1e6' : '#4a4239';
  });
  rerender('[data-block="speakers"]', `<div data-block="speakers">${progSpeakers()}</div>`);
  if (hadFocus) { const q2 = rootEl.querySelector('[data-role="speakerQ"]'); if (q2) q2.focus(); }
}
function bindSpeakerSearch() {
  const q = rootEl.querySelector('[data-role="speakerQ"]');
  if (!q) return;
  const onInput = () => { st.q = q.value; rerender('[data-block="speakers"]', `<div data-block="speakers">${progSpeakers()}</div>`); };
  q.addEventListener('input', onInput);
  qUnbind = () => q.removeEventListener('input', onInput);
}
function startCountdown() {
  if (!rootEl.querySelector('[data-cd="days"]')) return;
  timers.push(ui.countdown(D.countdownTo, ({ days, hrs, min }) => {
    const set = (k, v) => { const el = rootEl && rootEl.querySelector(`[data-cd="${k}"]`); if (el) el.textContent = v; };
    set('days', days); set('hrs', hrs); set('min', min);
  }, 30000));
}

// ---------------------------------------------------------------- module
export default {
  title: (ctx) => (TABS.find(t => t.key === ((ctx.params && ctx.params.tab) || '')) || TABS[0]).title,
  async render(root, ctx) {
    ensureCss();
    tab = (ctx.params && ctx.params.tab) || '';
    if (!TABS.some(t => t.key === tab)) { router.replace('/app/plexus'); return; }
    rootEl = root;
    D = await load(tab);
    if (rootEl !== root) return;                 // navigated away while loading
    st = { bio: null, interested: false, dayOpen: { 0: true }, spf: 'ALL', q: '' };
    root.innerHTML = tab === '' ? overviewTpl() : tab === 'program' ? programTpl() : tab === 'zagreb' ? zagrebTpl() : mineTpl();
    unbind = ui.bind(root, handlers);
    if (tab === 'program') bindSpeakerSearch();
    startCountdown();
    chrome.refresh();
  },
  destroy() {
    timers.forEach(stop => { try { stop(); } catch (e) {} }); timers = [];
    if (unbind) unbind(); unbind = null;
    if (qUnbind) qUnbind(); qUnbind = null;
    rootEl = null; D = null; st = null;
  }
};
