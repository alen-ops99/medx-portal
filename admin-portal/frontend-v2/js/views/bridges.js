// Source: Admin Bridges Hub.dc.html
// Blocks (artboard order): "Projects sub-nav" › "Title row" › "Stat band" › "EVENTS" (one row per
// city — upcoming bridges_events + past v2_bridges_editions recaps) › "BOSTON — READY TO RUN" ›
// "FOLLOW-UPS" › "AFTER EACH EVENING" › "STATS FOR MEDIA & SPONSORS" (note 21 — the reusable widget).
// The Boston card carries two sections: the 5-minute presentations, and (2026-09-13) the
// see-you-next-week reminder with the catering answers it collects back.
// Data: /api/v2/bridges/hub (admin v2 — v2_bridges_editions is SHARED with the member portal's
// /app/bridges recap cards) + legacy /api/bridges/events CRUD + POST /api/upload/photos for galleries.
// Invitations · reminders · thank-yous queue as approval-gated batches in the Outbox — nothing sends
// without the OK there (README note 2). No Harvard branding anywhere (canonical decision).
import cfg from '../config.js';
import { api } from '../api.js';
import { ui, esc, fmt } from '../ui.js';
import { FACTS } from '../facts.js';

export const SOURCE = 'Admin Bridges Hub.dc.html';

export const COPY = {
  title: 'Building Bridges',
  sub: 'Evenings connecting Croatian and international biomedicine · open registration, 40–50 guests per city',
  manage: 'WHAT MEMBERS SEE — MANAGE ↗',
  next: (city, range) => `NEXT · ${city.toUpperCase()} · ${range}`, noNext: 'NEXT CITY — NOT SET',
  band: {
    events: (e, c, k) => `EVENTS · ${c} CITIES, ${k} COUNTRIES`, guests: 'GUESTS HOSTED',
    signups: (city, cap) => `${city.toUpperCase()} SIGN-UPS${cap ? ' · OF ' + cap : ''}`,
    days: (city, range) => `DAYS TO ${city.toUpperCase()} · ${range}`
  },
  events: {
    title: 'EVENTS', sub: 'one row per city — recaps publish to the member page',
    newCity: '+ NEW CITY', ncCity: 'City — e.g. Munich', ncWhen: 'When — e.g. Spring 2027', add: 'ADD',
    added: city => `${city.toUpperCase()} ADDED — A DRAFT UNTIL YOU PUBLISH IT`, typeCity: 'TYPE THE CITY FIRST',
    upcoming: 'UPCOMING', draft: 'DRAFT', manage: 'MANAGE →', close: 'CLOSE', recap: 'RECAP', edition: n => `EDITION ${String(n).padStart(2, '0')}`,
    venueTBA: 'Venue announced soon · exact date TBA', planTBA: 'Venue to scout',
    signups: (n, cap) => `${n} sign-up${n === 1 ? '' : 's'}${cap ? ' of ' + cap : ''}`,
    recapMissing: 'guest count — add on recap', recapLine: (g, c) => `${g} guests${c == null ? '' : ' · ' + c + ' connections'}`,
    ev: { lVenue: 'VENUE', lDate: 'DATE', lTime: 'TIME', lCap: 'CAPACITY', lOpen: 'Registration open', lPub: 'Published to members', save: 'SAVE', saved: 'EVENT SAVED — LIVE EVERYWHERE' },
    rc: {
      lGuests: 'GUESTS', lConn: 'NEW CONNECTIONS', lNote: 'NOTE ON THE CITY CARD', lVenue: 'VENUE',
      addPhoto: '+ ADD PHOTO', photoCaption: 'Caption…', removePhoto: 'REMOVE', photos: n => `PHOTOS (${n})`,
      save: 'PUBLISH RECAP', saved: 'RECAP SAVED — LIVE ON THE MEMBER PAGE', uploading: 'UPLOADING…',
      uploadFail: 'UPLOAD FAILED — TRY A SMALLER IMAGE', hide: 'HIDE FROM MEMBERS', show: 'SHOW TO MEMBERS',
      hidden: 'CITY CARD HIDDEN FROM MEMBERS — NEVER DELETED', shown: 'CITY CARD BACK ON THE MEMBER PAGE'
    }
  },
  ready: {
    title: city => `${city.toUpperCase()} — READY TO RUN`,
    rows: {
      dates: (r) => `Dates locked — ${r} window`, datesNo: 'Dates — not locked yet',
      venue: v => `Venue — ${v}`, venueNo: 'Venue — scouting, announced soon',
      form: cap => `Sign-up form live${cap ? ' (' + cap + ' spots)' : ''}`, formNo: 'Sign-up form — not live yet',
      speakers: n => `Speakers confirmed (${n})`, speakersNo: 'Speakers confirmed',
      invites: 'Invitation campaign queued', invitesNo: 'Invitation campaign queued',
      reminders: 'Reminders scheduled', remindersNo: 'Reminders scheduled (7 / 2 days)'
    },
    foot: 'Invitations and reminders queue in the Outbox, as always. Guest counts for past editions live on each recap — fill them once and the member page updates.',
    queueInv: 'QUEUE INVITATIONS', queueRem: 'QUEUE REMINDERS', inOutbox: 'IN THE OUTBOX →', noEvent: 'Add the next city first.'
  },
  fu: {
    title: 'FOLLOW-UPS', hint: 'never lose a good contact again',
    phWho: 'Who — e.g. Dr. Sarah Chen, Harvard', phWhy: 'Why — e.g. wants to mentor an Accelerator fellow', add: 'ADD',
    doneTitle: 'Done — remove', done: 'FOLLOW-UP DONE — WELL CLOSED', added: 'FOLLOW-UP SAVED — IT WILL WAIT HERE',
    typeFirst: 'TYPE WHO TO FOLLOW UP WITH FIRST', whyFallback: 'Follow up',
    empty: 'No open follow-ups.', emptyWhy: 'Add the good contacts from each evening — they wait here until you close them.'
  },
  after: {
    title: 'AFTER EACH EVENING',
    body: 'Upload a few photos, type the guest count, press publish — the city card on the member page updates itself. Thank-you notes go out the next morning.',
    cta: 'PREPARE THANK-YOU EMAIL →', queueThanks: city => `QUEUE THANK-YOUS · ${city.toUpperCase()}`
  },
  // Boston's 5-minute presentations (2026-09-12). The member portal owns the upload links, the
  // files and the invite email (user-portal/backend/boston.js); this card is the organizer's door
  // to them — /api/v2/boston/presenters and friends.
  boston: {
    title: 'BOSTON · 5-MINUTE PRESENTATIONS', sub: 'each presenter gets a personal upload link — send it, then collect the decks',
    sendAll: n => `SEND TO EVERYONE NOT YET INVITED (${n})`, allInvited: 'EVERYONE HAS THEIR LINK',
    zip: n => `DOWNLOAD ALL DECKS (ZIP · ${n})`, zipNone: 'NO DECKS UPLOADED YET',
    add: '+ ADD A PRESENTER', addClose: 'CLOSE',
    phName: 'Full name — e.g. Dr. Ivana Kovač', phEmail: 'Email address', addSend: 'ADD & SEND THE LINK',
    cWho: 'PRESENTER', cInst: 'INSTITUTION', cDeck: 'DECK', cSent: 'LINK SENT',
    send: 'SEND LINK', resend: 'RESEND', busy: 'SENDING…',
    deckYes: 'UPLOADED', deckNo: '–', notSent: 'not sent', byTeam: 'ADDED BY TEAM',
    counts: (r, u, i) => `${r} presenting · ${u} uploaded · ${i} invited`,
    empty: 'Nobody has asked to present yet.',
    emptyWhy: 'Everyone who ticks the 5-minute-presentation box on the Boston form lands here — and you can add someone by hand.',
    down: 'The member portal did not answer, so the presenter list is unavailable right now. Nothing is lost — reload in a minute.',
    cOneTitle: 'Send the upload link?', cOneAgain: 'Send the upload link again?',
    cOneBody: (who, mail) => `<p style="margin:0 0 8px">${who} gets their personal upload page at <b>${mail}</b>, right now.</p><p style="margin:0;color:#6d6459">One email, sent immediately — this is not the Outbox.</p>`,
    cAllTitle: n => `Send ${n} upload link${n === 1 ? '' : 's'}?`,
    cAllBody: n => `<p style="margin:0 0 8px">${n} presenter${n === 1 ? '' : 's'} who ${n === 1 ? 'has' : 'have'} not been invited yet get their personal upload page, right now.</p><p style="margin:0;color:#6d6459">Anyone already invited is skipped. One email each, sent immediately — this is not the Outbox.</p>`,
    cAddTitle: 'Add this presenter and send the link?',
    cAddBody: (who, mail) => `<p style="margin:0 0 8px"><b>${who}</b> is added to the Boston list as a presenter and <b>${mail}</b> gets the upload link, right now.</p><p style="margin:0;color:#6d6459">No ticket, no confirmation email — only the upload link.</p>`,
    goSend: 'SEND IT', goAdd: 'ADD & SEND', keep: 'NOT NOW',
    sent: mail => `UPLOAD LINK SENT TO ${String(mail).toUpperCase()}`,
    sentAll: n => n ? `${n} UPLOAD LINK${n === 1 ? '' : 'S'} SENT` : 'EVERYONE ALREADY HAD THEIR LINK',
    added: mail => `PRESENTER ADDED — LINK SENT TO ${String(mail).toUpperCase()}`,
    addedPending: 'PRESENTER ADDED — THE LINK GOES OUT WITHIN A MINUTE',
    needBoth: 'TYPE A NAME AND AN EMAIL FIRST'
  },
  // The see-you-next-week reminder and what comes back from it (2026-09-13). Same card, second
  // table: everyone holding a seat, their two catering answers, and the reminder button per row.
  cat: {
    title: 'REMINDER & CATERING', sub: 'one email a week out — the food answers come back as one-tap links',
    sendAll: n => `SEND REMINDER TO EVERYONE (${n} NOT YET SENT)`, allSent: 'EVERYONE HAS THEIR REMINDER',
    csv: 'CATERING LIST (CSV)',
    strip: (a, t, al, na) => `${a} of ${t} answered · ${al} with allergies · ${na} still to answer`,
    cWho: 'GUEST', cInst: 'INSTITUTION', cPref: 'PREFERENCE', cAllergy: 'ALLERGIES', cAnswered: 'ANSWERED', cRem: 'REMINDER',
    send: 'SEND', resend: 'RESEND', busy: 'SENDING…',
    noPref: 'not set', noAllergy: 'not set', allergyNone: 'none', notSent: 'not sent',
    empty: 'Nobody is registered yet.',
    emptyWhy: 'Everyone who registers on the Boston form lands here — the reminder and the catering answers follow.',
    down: 'The member portal did not answer, so the catering list is unavailable right now. Nothing is lost — reload in a minute.',
    cOneTitle: 'Send the reminder?', cOneAgain: 'Send the reminder again?',
    cOneBody: (who, mail) => `<p style="margin:0 0 8px">${who} gets the see-you-next-week email at <b>${mail}</b> — their ticket and the two catering questions, right now.</p><p style="margin:0;color:#6d6459">One email, sent immediately — this is not the Outbox.</p>`,
    cAllTitle: n => `Send ${n} reminder${n === 1 ? '' : 's'}?`,
    cAllBody: n => `<p style="margin:0 0 8px">${n} guest${n === 1 ? '' : 's'} who ${n === 1 ? 'has' : 'have'} not had a reminder get${n === 1 ? 's' : ''} it now — their ticket and the two catering questions.</p><p style="margin:0;color:#6d6459">Anyone already reminded is skipped. One email each, sent immediately — this is not the Outbox.</p>`,
    sent: mail => `REMINDER SENT TO ${String(mail).toUpperCase()}`,
    sentAll: n => n ? `${n} REMINDER${n === 1 ? '' : 'S'} SENT` : 'EVERYONE ALREADY HAD THEIR REMINDER'
  },
  stats: {
    title: 'STATS FOR MEDIA & SPONSORS', sub: 'pick a scope, type over any number — then copy the line for a press kit or sponsor deck',
    scopes: { bridges: 'BUILDING BRIDGES', all: 'ALL MED&X', y2026: '2026 ONLY' },
    keys: { guests: 'GUESTS HOSTED', cities: 'CITIES', countries: 'COUNTRIES', speakers: 'SPEAKERS' },
    scopeName: { bridges: 'Building Bridges in Biomedicine', all: 'across all Med&X projects', y2026: 'Med&X in 2026' },
    copy: 'COPY FOR PRESS', copied: '✓ COPIED', copiedToast: 'PRESS LINE COPIED',
    overridden: 'typed over — clear the field to return to the live number', live: 'live from the database — type to override',
    saved: 'NUMBER SAVED', cleared: 'BACK TO THE LIVE NUMBER',
    line: (s, name) => `${s.guests} guests · ${s.cities} cities · ${s.countries} countries · ${s.speakers} speakers — ${name}`
  }
};

let D = null, st = null, unbind = null, rootEl = null, changeHandler = null;

function ensureCss() {
  if (!document.querySelector('link[href="/css/views/bridges-hub.css"]')) {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/css/views/bridges-hub.css'; document.head.appendChild(l);
  }
}
const chip = on => on ? { bg: '#201b16', fg: '#fff', bd: '#201b16' } : { bg: '#f6f2ea', fg: '#6d6459', bd: 'rgba(32,27,22,.25)' };
const isoDate = v => /^\d{4}-\d{2}-\d{2}/.test(String(v || ''));
function dateLabel(e) {
  if (isoDate(e.event_date)) return fmt.rangeLabel(String(e.event_date).slice(0, 10));
  return String(e.event_date || 'TBD').toUpperCase().slice(0, 12);
}
function nextEvent() {
  const today = fmt.ymd(new Date());
  const dated = (D.hub.events || []).filter(e => isoDate(e.event_date) && String(e.event_date).slice(0, 10) >= today);
  dated.sort((a, b) => String(a.event_date).localeCompare(String(b.event_date)));
  return dated[0] || (D.hub.events || []).find(e => (e.status === 'upcoming' || e.status === 'planning')) || null;
}
function nextRange(n) {
  if (n && isoDate(n.event_date)) {
    const end = FACTS.bridges.next.end && n.city === FACTS.bridges.next.city && String(n.event_date).slice(0, 10) === FACTS.bridges.next.start ? FACTS.bridges.next.end : null;
    return end ? fmt.rangeLabel(n.event_date, end) : fmt.rangeLabel(String(n.event_date).slice(0, 10));
  }
  return fmt.rangeLabel(FACTS.bridges.next.start, FACTS.bridges.next.end);
}

// ---------------------------------------------------------------- data
async function load() {
  const r = await api.settle({ hub: api.get('/api/v2/bridges/hub'), pres: api.get('/api/v2/boston/presenters'), cat: api.get('/api/v2/boston/catering') });
  return {
    errors: r.$errors,
    hub: r.hub || { events: [], editions: [], followups: [], stats: null, canonical_guests: FACTS.bridges.guests },
    pres: r.pres && r.pres.ok ? r.pres : null,
    cat: r.cat && r.cat.ok ? r.cat : null
  };
}

// ---------------------------------------------------------------- blocks
function blockSubnav() {
  return `
  <!-- dc: Admin Bridges Hub.dc.html › "Projects sub-nav" -->
  <div style="background:#fff;border-bottom:1px solid rgba(32,27,22,.14)">
    <div class="mx-subnav mx-gutter" style="max-width:1180px;margin:0 auto;padding:0 28px;height:44px;display:flex;align-items:center;gap:20px">
      <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#6d6459">PROJECTS</span>
      <a href="/projects/plexus" style="font:600 11px Inter,sans-serif;letter-spacing:.13em;color:#6d6459;height:100%;display:flex;align-items:center" data-hover="color:#201b16">PLEXUS WEEK 2026</a>
      <a href="/projects/accelerator" style="font:600 11px Inter,sans-serif;letter-spacing:.13em;color:#6d6459;height:100%;display:flex;align-items:center" data-hover="color:#201b16">ACCELERATOR</a>
      <a href="/projects/forum" style="font:600 11px Inter,sans-serif;letter-spacing:.13em;color:#6d6459;height:100%;display:flex;align-items:center" data-hover="color:#201b16">BIOMEDICAL FORUM</a>
      <span style="font:600 11px Inter,sans-serif;letter-spacing:.13em;color:#201b16;border-bottom:2px solid #9b1b22;height:100%;display:flex;align-items:center;box-sizing:border-box">BUILDING BRIDGES</span>
    </div>
  </div>
  <!-- /dc -->`;
}
function blockTitle() {
  const n = nextEvent();
  return `
    <!-- dc: Admin Bridges Hub.dc.html › "Title row" -->
    <div style="display:flex;align-items:flex-end;gap:16px;flex-wrap:wrap">
      <div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <span class="mx-display-30" style="font-family:Fraunces,serif;font-size:30px">Building Bridges <i>in Biomedicine</i></span>
          <span style="font:600 9px Inter,sans-serif;letter-spacing:.15em;background:#e7ecf3;color:#31517e;padding:4px 8px;white-space:nowrap">${esc(n ? COPY.next(n.city, nextRange(n)) : COPY.noNext)}</span>
        </div>
        <div style="font-size:12.5px;color:#6d6459;margin-top:4px">${COPY.sub}</div>
      </div>
      <div style="flex:1"></div>
      <a href="/member-pages/bridges" style="padding:10px 16px;border:2px solid #9b1b22;background:#fff;color:#9b1b22;font:600 10px Inter,sans-serif;letter-spacing:.14em;white-space:nowrap" data-hover="background:#9b1b22;color:#fff">${COPY.manage}</a>
    </div>
    <!-- /dc -->`;
}
function blockBand() {
  const b = COPY.band;
  const eds = (D.hub.editions || []).filter(e => e.is_published);
  const cities = new Set(eds.map(e => e.city)).size;
  const countries = new Set(eds.map(e => e.country).filter(Boolean)).size;
  const stats = D.hub.stats && D.hub.stats.bridges ? D.hub.stats.bridges.effective : null;
  const guests = stats ? stats.guests : (D.hub.canonical_guests || FACTS.bridges.guests);
  const n = nextEvent();
  const days = n && isoDate(n.event_date) ? Math.max(0, fmt.daysUntil(String(n.event_date).slice(0, 10)) || 0) : Math.max(0, fmt.daysUntil(FACTS.bridges.next.start) || 0);
  return `
    <!-- dc: Admin Bridges Hub.dc.html › "Stat band" -->
    <div data-block="band" class="bh-band" style="display:flex;gap:36px;align-items:baseline;border-top:1px solid rgba(32,27,22,.18);border-bottom:1px solid rgba(32,27,22,.18);padding:16px 2px;flex-wrap:wrap">
      <a href="#bridges-events" style="white-space:nowrap;color:#201b16" data-hover="color:#9b1b22"><span style="font-family:Fraunces,serif;font-size:26px">${eds.length}</span> <span style="font:600 10px Inter,sans-serif;letter-spacing:.13em;color:#6d6459">${esc(b.events(eds.length, cities, countries))}</span></a>
      <span style="white-space:nowrap"><span style="font-family:Fraunces,serif;font-size:26px">${esc(guests)}</span> <span style="font:600 10px Inter,sans-serif;letter-spacing:.13em;color:#6d6459">${b.guests}</span></span>
      ${n ? `<a href="/registrations" style="white-space:nowrap;color:#201b16" data-hover="color:#9b1b22"><span style="font-family:Fraunces,serif;font-size:26px">${n.registration_count || 0}</span> <span style="font:600 10px Inter,sans-serif;letter-spacing:.13em;color:#6d6459">${esc(b.signups(n.city, n.capacity))}</span></a>` : ''}
      ${n ? `<span style="white-space:nowrap"><span style="font-family:Fraunces,serif;font-size:26px">${days}</span> <span style="font:600 10px Inter,sans-serif;letter-spacing:.13em;color:#6d6459">${esc(b.days(n.city, nextRange(n)))}</span></span>` : ''}
    </div>
    <!-- /dc -->`;
}
function eventEditor(e) {
  const c = COPY.events.ev;
  return `
          <!-- v2: inline event editor (writes the live bridges_events row) -->
          <div data-v2="event-edit" style="display:flex;flex-direction:column;gap:8px;padding:12px 20px;background:#fdfbf6;border-bottom:1px solid rgba(32,27,22,.08)">
            <label style="font:600 8.5px Inter,sans-serif;letter-spacing:.12em;color:#6d6459">${c.lVenue}<input data-role="evVenue" value="${esc(e.venue_name || '')}" placeholder="${esc(COPY.events.venueTBA)}" style="display:block;width:100%;box-sizing:border-box;border:1px solid rgba(32,27,22,.25);background:#fff;padding:7px 9px;font:400 12.5px Inter,sans-serif;color:#201b16;margin-top:3px"></label>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <label style="font:600 8.5px Inter,sans-serif;letter-spacing:.12em;color:#6d6459;min-width:130px">${c.lDate}<input data-role="evDate" type="date" value="${esc(isoDate(e.event_date) ? String(e.event_date).slice(0, 10) : '')}" style="display:block;width:100%;box-sizing:border-box;border:1px solid rgba(32,27,22,.25);background:#fff;padding:6px 9px;font:400 12.5px Inter,sans-serif;color:#201b16;margin-top:3px"></label>
              <label style="font:600 8.5px Inter,sans-serif;letter-spacing:.12em;color:#6d6459;width:84px">${c.lTime}<input data-role="evTime" value="${esc(e.event_time || '')}" placeholder="18:00" style="display:block;width:100%;box-sizing:border-box;border:1px solid rgba(32,27,22,.25);background:#fff;padding:6px 9px;font:400 12.5px Inter,sans-serif;color:#201b16;margin-top:3px"></label>
              <label style="font:600 8.5px Inter,sans-serif;letter-spacing:.12em;color:#6d6459;width:84px">${c.lCap}<input data-role="evCap" type="number" min="1" value="${esc(e.capacity == null ? '' : e.capacity)}" style="display:block;width:100%;box-sizing:border-box;border:1px solid rgba(32,27,22,.25);background:#fff;padding:6px 9px;font:400 12.5px Inter,sans-serif;color:#201b16;margin-top:3px"></label>
            </div>
            <div style="display:flex;gap:18px;flex-wrap:wrap">
              <label style="display:flex;gap:7px;align-items:center;font-size:12px;cursor:pointer"><input data-role="evOpen" type="checkbox" ${e.registration_open ? 'checked' : ''}>${c.lOpen}</label>
              <label style="display:flex;gap:7px;align-items:center;font-size:12px;cursor:pointer"><input data-role="evPub" type="checkbox" ${e.is_published ? 'checked' : ''}>${c.lPub}</label>
            </div>
            <span data-act="evSave" data-id="${esc(e.id)}" style="padding:8px 13px;background:#9b1b22;color:#fff;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;align-self:flex-start" data-hover="background:#7e151b">${c.save}</span>
          </div>`;
}
function recapEditor(ed) {
  const c = COPY.events.rc;
  return `
          <!-- v2: inline recap editor (writes the SHARED v2_bridges_editions row the member page renders) -->
          <div data-v2="recap-edit" style="display:flex;flex-direction:column;gap:8px;padding:12px 20px;background:#fdfbf6;border-bottom:1px solid rgba(32,27,22,.08)">
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <label style="font:600 8.5px Inter,sans-serif;letter-spacing:.12em;color:#6d6459;width:110px">${c.lGuests}<input data-role="rcGuests" type="number" min="0" value="${esc(ed.guests == null ? '' : ed.guests)}" placeholder="—" style="display:block;width:100%;box-sizing:border-box;border:1px solid rgba(32,27,22,.25);background:#fff;padding:6px 9px;font:400 12.5px Inter,sans-serif;color:#201b16;margin-top:3px"></label>
              <label style="font:600 8.5px Inter,sans-serif;letter-spacing:.12em;color:#6d6459;width:140px">${c.lConn}<input data-role="rcConn" type="number" min="0" value="${esc(ed.connections == null ? '' : ed.connections)}" placeholder="—" style="display:block;width:100%;box-sizing:border-box;border:1px solid rgba(32,27,22,.25);background:#fff;padding:6px 9px;font:400 12.5px Inter,sans-serif;color:#201b16;margin-top:3px"></label>
              <label style="font:600 8.5px Inter,sans-serif;letter-spacing:.12em;color:#6d6459;flex:1;min-width:160px">${c.lVenue}<input data-role="rcVenue" value="${esc(ed.venue || '')}" style="display:block;width:100%;box-sizing:border-box;border:1px solid rgba(32,27,22,.25);background:#fff;padding:6px 9px;font:400 12.5px Inter,sans-serif;color:#201b16;margin-top:3px"></label>
            </div>
            <label style="font:600 8.5px Inter,sans-serif;letter-spacing:.12em;color:#6d6459">${c.lNote}<textarea data-role="rcNote" style="display:block;width:100%;box-sizing:border-box;border:1px solid rgba(32,27,22,.25);background:#fff;padding:7px 9px;font:400 12.5px Inter,sans-serif;color:#201b16;margin-top:3px;min-height:56px;resize:vertical">${esc(ed.note || '')}</textarea></label>
            <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">
              <span style="font:600 8.5px Inter,sans-serif;letter-spacing:.12em;color:#6d6459">${esc(c.photos((ed.photos || []).length))}</span>
              <label style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#9b1b22;cursor:pointer">${c.addPhoto}<input data-role="rcPhotoFile" data-id="${esc(ed.id)}" type="file" accept="image/*" style="display:none"></label>
              ${st.uploading === ed.id ? `<span style="font:600 8.5px Inter,sans-serif;letter-spacing:.12em;color:#b7791f">${c.uploading}</span>` : ''}
            </div>
            ${(ed.photos || []).length ? `<div style="display:flex;gap:8px;flex-wrap:wrap">${ed.photos.map((p, i) => `
              <span style="display:flex;flex-direction:column;gap:3px;width:104px">
                <img src="${esc(p.url)}" alt="${esc(p.caption || ed.city)}" style="width:104px;height:70px;object-fit:cover;border:1px solid rgba(32,27,22,.14);display:block">
                <span style="font-size:9.5px;color:#6d6459;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(p.caption || '')}">${esc(p.caption || '—')}</span>
                <span data-act="rcPhotoRemove" data-id="${esc(ed.id)}" data-i="${i}" style="font:600 8px Inter,sans-serif;letter-spacing:.1em;color:#9a9086;cursor:pointer" data-hover="color:#9b1b22">${c.removePhoto}</span>
              </span>`).join('')}</div>` : ''}
            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
              <span data-act="rcSave" data-id="${esc(ed.id)}" style="padding:8px 13px;background:#9b1b22;color:#fff;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer" data-hover="background:#7e151b">${c.save}</span>
              <span data-act="rcTogglePub" data-id="${esc(ed.id)}" style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#6d6459;cursor:pointer" data-hover="color:#9b1b22">${ed.is_published ? c.hide : c.show}</span>
            </div>
          </div>`;
}
function blockEvents() {
  const c = COPY.events;
  const today = fmt.ymd(new Date());
  const upcoming = (D.hub.events || []).filter(e => !isoDate(e.event_date) || String(e.event_date).slice(0, 10) >= today);
  const editions = D.hub.editions || [];
  return `
      <!-- dc: Admin Bridges Hub.dc.html › "EVENTS" -->
      <div data-block="events" id="bridges-events" style="border:1px solid rgba(32,27,22,.14);background:#fff">
        <div style="display:flex;align-items:center;gap:10px;padding:14px 20px;border-bottom:1px solid rgba(32,27,22,.12)">
          <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${c.title}</span>
          <span style="font-size:11.5px;color:#6d6459">${c.sub}</span>
          <div style="flex:1"></div>
          <span data-act="newCityToggle" style="padding:8px 13px;background:#9b1b22;color:#fff;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap" data-hover="background:#7e151b">${c.newCity}</span>
        </div>
        ${st.newCityOpen ? `
          <div style="display:flex;gap:8px;align-items:center;padding:12px 20px;background:#fdfbf6;border-bottom:1px solid rgba(32,27,22,.08);flex-wrap:wrap">
            <input data-role="ncCity" value="${esc(st.ncCity)}" placeholder="${esc(c.ncCity)}" aria-label="City" style="flex:1;min-width:130px;border:1px solid rgba(32,27,22,.25);background:#fff;padding:8px 10px;font-size:12.5px;color:#201b16">
            <input data-role="ncWhen" value="${esc(st.ncWhen)}" placeholder="${esc(c.ncWhen)}" aria-label="When" style="width:150px;border:1px solid rgba(32,27,22,.25);background:#fff;padding:8px 10px;font-size:12.5px;color:#201b16">
            <span data-act="ncAdd" style="padding:8px 13px;background:#9b1b22;color:#fff;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer">${c.add}</span>
          </div>` : ''}
        ${upcoming.map(e => `
          <div data-row="${esc(e.id)}" style="display:flex;align-items:center;gap:12px;padding:12px 20px;border-bottom:1px solid rgba(32,27,22,.07)">
            <span style="font:600 9px Inter,sans-serif;letter-spacing:.11em;color:#6d6459;width:76px;flex:none">${esc(dateLabel(e))}</span>
            <span style="flex:1;min-width:0"><span style="display:block;font-size:13.5px;font-weight:600">${esc(e.city)}</span><span style="display:block;font-size:11px;color:#6d6459">${esc(e.venue_name || c.venueTBA)}</span></span>
            ${e.is_published ? `<span style="font:600 8.5px Inter,sans-serif;letter-spacing:.1em;background:#e7ecf3;color:#31517e;padding:3px 8px;white-space:nowrap">${c.upcoming}</span>` : `<span style="font:600 8.5px Inter,sans-serif;letter-spacing:.1em;background:#eee9df;color:#4a4239;padding:3px 8px;white-space:nowrap">${c.draft}</span>`}
            <span style="font-size:11.5px;color:#6d6459;white-space:nowrap">${esc(c.signups(e.registration_count || 0, e.capacity))}</span>
            <span data-act="evEdit" data-id="${esc(e.id)}" style="font:600 9.5px Inter,sans-serif;letter-spacing:.12em;color:#9b1b22;white-space:nowrap;cursor:pointer" data-hover="color:#201b16">${st.editEvent === e.id ? c.close : c.manage}</span>
          </div>
          ${st.editEvent === e.id ? eventEditor(e) : ''}`).join('')}
        ${editions.map(ed => `
          <div data-row="${esc(ed.id)}" style="display:flex;align-items:center;gap:12px;padding:12px 20px;border-bottom:1px solid rgba(32,27,22,.07);${ed.is_published ? '' : 'opacity:.55'}">
            <span style="font:600 9px Inter,sans-serif;letter-spacing:.11em;color:#6d6459;width:76px;flex:none">${esc(c.edition(ed.edition_no))}</span>
            <span style="flex:1;min-width:0"><span style="display:block;font-size:13.5px;font-weight:600">${esc(ed.city)}</span><span style="display:block;font-size:11px;color:#6d6459">${esc(ed.venue || '')}</span></span>
            <span style="font-size:11.5px;color:${ed.guests == null ? '#b7791f' : '#6d6459'};white-space:nowrap">${esc(ed.guests == null ? c.recapMissing : c.recapLine(ed.guests, ed.connections))}</span>
            <span data-act="recap" data-id="${esc(ed.id)}" style="font:600 9.5px Inter,sans-serif;letter-spacing:.12em;color:#9b1b22;white-space:nowrap;cursor:pointer" data-hover="color:#201b16">${st.recapEdit === ed.id ? c.close : c.recap}</span>
          </div>
          ${st.recapEdit === ed.id ? recapEditor(ed) : ''}`).join('')}
      </div>
      <!-- /dc -->`;
}
function blockReady() {
  const c = COPY.ready;
  const n = nextEvent();
  const rows = [];
  if (n) {
    const venueReal = n.venue_name && !/tba|announce|scout/i.test(n.venue_name);
    rows.push({ done: isoDate(n.event_date), name: isoDate(n.event_date) ? c.rows.dates(nextRange(n)) : c.rows.datesNo });
    rows.push({ done: !!venueReal, name: venueReal ? c.rows.venue(n.venue_name) : c.rows.venueNo });
    rows.push({ done: !!(n.is_published && n.registration_open), name: n.is_published && n.registration_open ? c.rows.form(n.capacity) : c.rows.formNo });
    rows.push({ done: (n.speakers_count || 0) > 0, name: n.speakers_count ? c.rows.speakers(n.speakers_count) : c.rows.speakersNo });
    rows.push({ done: !!n.invitation_queued, name: n.invitation_queued ? c.rows.invites : c.rows.invitesNo, act: n.invitation_queued ? null : 'queueInv' });
    rows.push({ done: !!n.reminder_queued, name: n.reminder_queued ? c.rows.reminders : c.rows.remindersNo, act: n.reminder_queued ? null : 'queueRem' });
  }
  return `
        <!-- dc: Admin Bridges Hub.dc.html › "BOSTON — READY TO RUN" -->
        <div data-block="ready" style="border:1px solid rgba(32,27,22,.14);border-top:2px solid #3f5f8a;background:#fff">
          <div style="padding:13px 20px;border-bottom:1px solid rgba(32,27,22,.1)"><span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${esc(n ? c.title(n.city) : c.title(FACTS.bridges.next.city))}</span></div>
          <div style="padding:12px 20px 16px;display:flex;flex-direction:column;gap:10px">
          ${rows.map(r => `
            <div style="display:flex;gap:10px;align-items:center;padding:6px 0;border-bottom:1px solid rgba(32,27,22,.06)">
              <span style="width:16px;height:16px;border:1.5px solid ${r.done ? '#2f7d4f' : 'rgba(32,27,22,.35)'};background:${r.done ? '#2f7d4f' : 'transparent'};display:inline-flex;align-items:center;justify-content:center;color:#fff;font:700 10px Inter,sans-serif;flex:none">${r.done ? '✓' : ''}</span>
              <span style="font-size:12.5px;flex:1;color:${r.done ? '#201b16' : '#6d6459'}">${esc(r.name)}</span>
              ${r.done && (r.name === c.rows.invites || r.name === c.rows.reminders) ? `<a href="/inbox/outbox" style="font:600 8.5px Inter,sans-serif;letter-spacing:.1em;color:#7a6432;white-space:nowrap">${c.inOutbox}</a>` : ''}
            </div>`).join('')}
          ${!n ? `<span style="font-size:12.5px;color:#6d6459;font-style:italic">${c.noEvent}</span>` : ''}
          ${n ? `
          <!-- v2: queue the campaigns (approval-gated batches in the Outbox) -->
          <div data-v2="queue-actions" style="display:flex;gap:8px;flex-wrap:wrap;padding-top:2px">
            ${n.invitation_queued ? '' : `<span data-act="queueInv" data-id="${esc(n.id)}" style="padding:8px 12px;border:1px solid rgba(32,27,22,.2);font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#201b16;cursor:pointer;white-space:nowrap" data-hover="border-color:#201b16">${c.queueInv}</span>`}
            ${n.reminder_queued ? '' : `<span data-act="queueRem" data-id="${esc(n.id)}" style="padding:8px 12px;border:1px solid rgba(32,27,22,.2);font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#201b16;cursor:pointer;white-space:nowrap" data-hover="border-color:#201b16">${c.queueRem}</span>`}
          </div>` : ''}
          <span style="font-size:11px;color:#6d6459">${c.foot}</span>
          </div>
        </div>
        <!-- /dc -->`;
}
function blockFollowups() {
  const c = COPY.fu;
  const fu = D.hub.followups || [];
  return `
        <!-- dc: Admin Bridges Hub.dc.html › "FOLLOW-UPS" -->
        <div data-block="fu" style="border:1px solid rgba(32,27,22,.14);border-top:2px solid #c9a962;background:#fff">
          <div style="display:flex;align-items:center;gap:10px;padding:13px 20px;border-bottom:1px solid rgba(32,27,22,.1)"><span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${c.title}</span><div style="flex:1"></div><span style="font-size:11px;color:#6d6459">${c.hint}</span></div>
          <div style="padding:10px 20px 16px;display:flex;flex-direction:column;gap:6px">
            ${fu.map(f => `
              <div data-row="${esc(f.id)}" style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(32,27,22,.07)">
                <span style="flex:1;min-width:0"><span style="display:block;font-size:13px;font-weight:600">${esc(f.name)}</span><span style="display:block;font-size:11.5px;color:#6d6459;margin-top:1px">${esc(f.why || '')}</span></span>
                <span style="font:600 8px Inter,sans-serif;letter-spacing:.11em;background:#eee9df;color:#4a4239;padding:3px 7px;white-space:nowrap">${esc(f.tag || 'FOLLOW UP')}</span>
                <span data-act="fuDone" data-id="${esc(f.id)}" title="${esc(c.doneTitle)}" style="font:600 11px Inter,sans-serif;color:#9a9086;cursor:pointer" data-hover="color:#1e6e42">✓</span>
              </div>`).join('')}
            ${!fu.length ? `<div class="empty" style="padding:10px 0 4px"><span class="empty-line" style="font-family:Fraunces,serif;font-style:italic;font-size:14px">${c.empty}</span><span class="empty-why" style="font-size:11px;color:#6d6459">${c.emptyWhy}</span></div>` : ''}
            <input data-role="fuName" value="${esc(st.fuName)}" placeholder="${esc(c.phWho)}" aria-label="Who to follow up with" style="border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:8px 10px;font:400 12.5px Inter,sans-serif;color:#201b16;margin-top:4px">
            <div style="display:flex;gap:8px">
              <input data-role="fuWhy" value="${esc(st.fuWhy)}" placeholder="${esc(c.phWhy)}" aria-label="Why" style="flex:1;border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:8px 10px;font:400 12.5px Inter,sans-serif;color:#201b16;min-width:0">
              <span data-act="fuAdd" style="padding:8px 13px;background:#9b1b22;color:#fff;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;display:flex;align-items:center" data-hover="background:#7e151b">${c.add}</span>
            </div>
          </div>
        </div>
        <!-- /dc -->`;
}
function blockAfter() {
  const c = COPY.after;
  const today = fmt.ymd(new Date());
  const lastPast = (D.hub.events || []).filter(e => isoDate(e.event_date) && String(e.event_date).slice(0, 10) < today && e.registration_count > 0 && !e.thankyou_queued)
    .sort((a, b) => String(b.event_date).localeCompare(String(a.event_date)))[0] || null;
  return `
        <!-- dc: Admin Bridges Hub.dc.html › "AFTER EACH EVENING" -->
        <div data-block="after" style="border:1px solid rgba(32,27,22,.14);background:#fff;padding:16px 20px;display:flex;flex-direction:column;gap:8px">
          <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${c.title}</span>
          <span style="font-size:12.5px;color:#6d6459;line-height:1.6">${c.body}</span>
          <a href="/inbox" style="font:600 10px Inter,sans-serif;letter-spacing:.14em">${c.cta}</a>
          ${lastPast ? `<!-- v2: one-click thank-you batch for the latest past evening --><span data-act="queueThanks" data-id="${esc(lastPast.id)}" style="font:600 10px Inter,sans-serif;letter-spacing:.14em;color:#9b1b22;cursor:pointer" data-v2="queue-thanks" data-hover="color:#201b16">${esc(c.queueThanks(lastPast.city))}</span>` : ''}
        </div>
        <!-- /dc -->`;
}
// The Boston presentations card — the whole 5-minute-talk workflow in one table: who is presenting,
// who has a deck, who has been sent their personal link, and the three things the organizer does
// (send one, send the rest, add someone who never filled the form).
function blockBoston() {
  const c = COPY.boston;
  const P = D.pres;
  const lockErr = D.errors && D.errors.pres;
  const rows = P ? (P.rows || []) : [];
  const notInvited = P ? Number(P.not_invited) || 0 : 0;
  const uploaded = P ? Number(P.uploaded) || 0 : 0;
  const btn = (act, label, on, extra) => `<span data-act="${act}" ${extra || ''} style="padding:8px 13px;${on ? 'background:#9b1b22;color:#fff;' : 'border:1px solid rgba(32,27,22,.25);background:#fff;color:#6d6459;'}font:600 9.5px Inter,sans-serif;letter-spacing:.13em;white-space:nowrap;${on ? 'cursor:pointer' : 'cursor:default'}" ${on ? `data-hover="background:#7e151b"` : 'aria-disabled="true"'}>${esc(label)}</span>`;
  const cell = 'padding:9px 12px;border-bottom:1px solid rgba(32,27,22,.07);vertical-align:middle';
  const head = 'padding:8px 12px;text-align:left;font:600 8.5px Inter,sans-serif;letter-spacing:.12em;color:#6d6459;border-bottom:1px solid rgba(32,27,22,.12);white-space:nowrap';
  return `
    <!-- v2: BOSTON — 5-minute presentations (member portal owns the links, files and the email) -->
    <div data-block="boston" id="boston-presentations" style="border:1px solid rgba(32,27,22,.14);border-top:2px solid #9b1b22;background:#fff;margin-top:22px">
      <div style="display:flex;align-items:center;gap:10px;padding:14px 20px;border-bottom:1px solid rgba(32,27,22,.1);flex-wrap:wrap">
        <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${c.title}</span>
        <span style="font-size:11.5px;color:#6d6459">${c.sub}</span>
        <div style="flex:1"></div>
        ${P ? `<span style="font-size:11px;color:#6d6459;white-space:nowrap">${esc(c.counts(P.requested || 0, uploaded, P.invited || 0))}</span>` : ''}
        ${P ? btn('bpSendAll', notInvited ? c.sendAll(notInvited) : c.allInvited, notInvited > 0) : ''}
        ${P && uploaded ? `<a href="${esc(P.zip_url)}" style="padding:8px 13px;border:1px solid rgba(32,27,22,.25);background:#fff;color:#201b16;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;white-space:nowrap" data-hover="border-color:#201b16">${esc(c.zip(uploaded))}</a>`
        : P ? `<span style="padding:8px 13px;border:1px solid rgba(32,27,22,.15);color:#9a9086;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;white-space:nowrap" aria-disabled="true">${c.zipNone}</span>` : ''}
        ${P ? `<span data-act="bpAddToggle" style="font:600 9.5px Inter,sans-serif;letter-spacing:.13em;color:#9b1b22;cursor:pointer;white-space:nowrap" data-hover="color:#201b16">${st.bpOpen ? c.addClose : c.add}</span>` : ''}
      </div>
      ${st.bpOpen && P ? `
        <div style="display:flex;gap:8px;align-items:center;padding:12px 20px;background:#fdfbf6;border-bottom:1px solid rgba(32,27,22,.08);flex-wrap:wrap">
          <input data-role="bpName" value="${esc(st.bpName)}" placeholder="${esc(c.phName)}" aria-label="Presenter name" style="flex:1;min-width:160px;border:1px solid rgba(32,27,22,.25);background:#fff;padding:8px 10px;font-size:12.5px;color:#201b16">
          <input data-role="bpEmail" value="${esc(st.bpEmail)}" type="email" placeholder="${esc(c.phEmail)}" aria-label="Presenter email" style="flex:1;min-width:170px;border:1px solid rgba(32,27,22,.25);background:#fff;padding:8px 10px;font-size:12.5px;color:#201b16">
          ${btn('bpAdd', st.bpBusy ? c.busy : c.addSend, !st.bpBusy)}
        </div>` : ''}
      ${lockErr && lockErr.status === 403 ? ui.lockedBlock('Building Bridges') : ''}
      ${!P && !lockErr ? `<div class="empty" style="padding:18px 20px"><span class="empty-line" style="font-family:Fraunces,serif;font-style:italic;font-size:14px">Not right now.</span><span class="empty-why" style="font-size:11.5px;color:#6d6459">${c.down}</span></div>` : ''}
      ${P && !rows.length ? `<div class="empty" style="padding:18px 20px"><span class="empty-line" style="font-family:Fraunces,serif;font-style:italic;font-size:14px">${c.empty}</span><span class="empty-why" style="font-size:11.5px;color:#6d6459">${c.emptyWhy}</span></div>` : ''}
      ${P && rows.length ? `
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:12.5px;min-width:640px">
          <thead><tr><th style="${head}">${c.cWho}</th><th style="${head}">${c.cInst}</th><th style="${head}">${c.cDeck}</th><th style="${head}">${c.cSent}</th><th style="${head}"></th></tr></thead>
          <tbody>
          ${rows.map(r => {
            const busy = st.bpSending === r.registration_id;
            return `
            <tr data-row="${esc(r.registration_id)}">
              <td style="${cell}"><span style="display:block;font-weight:600">${esc(r.name || r.email)}</span><span style="display:block;font-size:11px;color:#6d6459">${esc(r.email)}${r.added_by_team ? ` · <span style="font:600 7.5px Inter,sans-serif;letter-spacing:.1em;color:#7a6432">${c.byTeam}</span>` : ''}</span></td>
              <td style="${cell};color:#6d6459">${esc(r.institution || '—')}</td>
              <td style="${cell};white-space:nowrap">${r.upload
                ? `<a href="${esc(r.upload.download_url)}" title="${esc(r.upload.filename || '')}" style="font:600 8.5px Inter,sans-serif;letter-spacing:.1em;background:#e6efe8;color:#1e6e42;padding:3px 8px" data-hover="background:#1e6e42;color:#fff">✓ ${c.deckYes}</a>`
                : `<span style="color:#9a9086">${c.deckNo}</span>`}</td>
              <td style="${cell};white-space:nowrap;color:${r.invited_at == null ? '#b7791f' : '#6d6459'}">${r.invited_at == null ? c.notSent : esc(r.invited_at || '✓')}</td>
              <td style="${cell};text-align:right;white-space:nowrap">${btn('bpSendOne', busy ? c.busy : (r.invited_at == null ? c.send : c.resend), !busy, `data-id="${esc(r.registration_id)}" data-who="${esc(r.name || r.email)}" data-mail="${esc(r.email)}"`)}</td>
            </tr>`;
          }).join('')}
          </tbody>
        </table>
      </div>` : ''}
      ${sectionCatering(btn, cell, head)}
    </div>`;
}
// Second section of the same card: the see-you-next-week reminder and what it brings back. Every
// guest is here (presenters included) because the reminder — and the food — is for everyone.
function sectionCatering(btn, cell, head) {
  const c = COPY.cat;
  const C = D.cat;
  const lockErr = D.errors && D.errors.cat;
  if (lockErr && lockErr.status === 403) return '';           // the presenters block already shows the lock
  const rows = C ? (C.rows || []) : [];
  const pending = C ? Number(C.reminders_pending) || 0 : 0;
  const prefLine = C ? (C.preferences || []).filter(p => p.count).map(p => `${esc(p.label)} ${p.count}`).join(' · ') : '';
  return `
      <div style="border-top:1px solid rgba(32,27,22,.14)">
        <div style="display:flex;align-items:center;gap:10px;padding:14px 20px;border-bottom:1px solid rgba(32,27,22,.1);flex-wrap:wrap">
          <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${c.title}</span>
          <span style="font-size:11.5px;color:#6d6459">${c.sub}</span>
          <div style="flex:1"></div>
          ${C ? btn('bpRemindAll', pending ? c.sendAll(pending) : c.allSent, pending > 0) : ''}
          ${C ? `<a href="${esc(C.csv_url || '/api/v2/boston/catering.csv')}" style="padding:8px 13px;border:1px solid rgba(32,27,22,.25);background:#fff;color:#201b16;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;white-space:nowrap" data-hover="border-color:#201b16">${c.csv}</a>` : ''}
        </div>
        ${C ? `<div style="display:flex;gap:8px 20px;flex-wrap:wrap;padding:11px 20px;background:#fdfbf6;border-bottom:1px solid rgba(32,27,22,.08);font-size:11.5px;color:#6d6459">
          <span><b style="color:#201b16">${esc(c.strip(C.answered || 0, C.total || 0, C.with_allergies || 0, C.not_answered || 0))}</b></span>
          ${prefLine ? `<span>${prefLine}</span>` : ''}
        </div>` : ''}
        ${!C && !lockErr ? `<div class="empty" style="padding:18px 20px"><span class="empty-line" style="font-family:Fraunces,serif;font-style:italic;font-size:14px">Not right now.</span><span class="empty-why" style="font-size:11.5px;color:#6d6459">${c.down}</span></div>` : ''}
        ${C && !rows.length ? `<div class="empty" style="padding:18px 20px"><span class="empty-line" style="font-family:Fraunces,serif;font-style:italic;font-size:14px">${c.empty}</span><span class="empty-why" style="font-size:11.5px;color:#6d6459">${c.emptyWhy}</span></div>` : ''}
        ${C && rows.length ? `
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:12.5px;min-width:760px">
            <thead><tr><th style="${head}">${c.cWho}</th><th style="${head}">${c.cInst}</th><th style="${head}">${c.cPref}</th><th style="${head}">${c.cAllergy}</th><th style="${head}">${c.cAnswered}</th><th style="${head}">${c.cRem}</th><th style="${head}"></th></tr></thead>
            <tbody>
            ${rows.map(r => {
              const busy = st.bpReminding === r.registration_id;
              const allergy = r.allergy_state === 'yes' ? esc(r.allergies || 'yes')
                : r.allergy_state === 'none' ? c.allergyNone : c.noAllergy;
              return `
              <tr data-row="${esc(r.registration_id)}">
                <td style="${cell}"><span style="display:block;font-weight:600">${esc(r.name || r.email)}</span><span style="display:block;font-size:11px;color:#6d6459">${esc(r.email)}${r.presenter ? ` · <span style="font:600 7.5px Inter,sans-serif;letter-spacing:.1em;color:#7a6432">PRESENTING</span>` : ''}</span></td>
                <td style="${cell};color:#6d6459">${esc(r.institution || '—')}</td>
                <td style="${cell};white-space:nowrap;color:${r.preference ? '#201b16' : '#9a9086'}">${r.preference ? esc(r.preference) : c.noPref}</td>
                <td style="${cell};color:${r.allergy_state === 'yes' ? '#9b1b22' : r.allergy_state === 'none' ? '#6d6459' : '#9a9086'}">${allergy}</td>
                <td style="${cell};white-space:nowrap;color:${r.answered ? '#1e6e42' : '#b7791f'}">${r.answered ? '✓' + (r.answered_at ? ' ' + esc(String(r.answered_at).slice(0, 10)) : '') : '—'}</td>
                <td style="${cell};white-space:nowrap;color:${r.reminder_sent ? '#6d6459' : '#b7791f'}">${r.reminder_sent ? esc(r.reminder_sent_at || '✓') : c.notSent}</td>
                <td style="${cell};text-align:right;white-space:nowrap">${btn('bpRemindOne', busy ? c.busy : (r.reminder_sent ? c.resend : c.send), !busy, `data-id="${esc(r.registration_id)}" data-who="${esc(r.name || r.email)}" data-mail="${esc(r.email)}"`)}</td>
              </tr>`;
            }).join('')}
            </tbody>
          </table>
        </div>` : ''}
      </div>`;
}
function blockStats() {
  const c = COPY.stats;
  const s = D.hub.stats;
  const scope = st.scope;
  const eff = s && s[scope] ? s[scope].effective : { guests: '—', cities: '—', countries: '—', speakers: '—' };
  const ovr = s && s[scope] ? s[scope].overridden : {};
  const line = c.line(eff, c.scopeName[scope]);
  const chips = { bridges: chip(scope === 'bridges'), all: chip(scope === 'all'), y2026: chip(scope === 'y2026') };
  const cell = (key, last) => `
        <div style="padding:16px 20px;${last ? '' : 'border-right:1px solid rgba(32,27,22,.08)'}">
          <div style="font:600 9px Inter,sans-serif;letter-spacing:.15em;color:#6d6459">${c.keys[key]}</div>
          <input data-stat="${key}" value="${esc(eff[key])}" aria-label="${esc(c.keys[key])}" title="${esc(ovr[key] ? c.overridden : c.live)}" style="border:none;border-bottom:1px dashed rgba(32,27,22,.3);background:transparent;font:600 26px Fraunces,serif;color:${ovr[key] ? '#201b16' : '#201b16'};width:100px;padding:2px 0;margin-top:4px">
          ${ovr[key] ? `<div style="font:600 7.5px Inter,sans-serif;letter-spacing:.1em;color:#b7791f;margin-top:2px" data-v2="override-mark">TYPED OVER</div>` : ''}
        </div>`;
  return `
    <!-- dc: Admin Bridges Hub.dc.html › "STATS FOR MEDIA & SPONSORS" -->
    <div data-block="stats" style="border:1px solid rgba(32,27,22,.14);background:#fff;margin-top:22px">
      <div style="display:flex;align-items:center;gap:10px;padding:14px 20px;border-bottom:1px solid rgba(32,27,22,.1);flex-wrap:wrap">
        <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${c.title}</span>
        <span style="font-size:11.5px;color:#6d6459">${c.sub}</span>
        <div style="flex:1"></div>
        <span data-act="scBridges" role="radio" aria-checked="${scope === 'bridges'}" style="padding:6px 11px;font:600 8.5px Inter,sans-serif;letter-spacing:.11em;cursor:pointer;background:${chips.bridges.bg};color:${chips.bridges.fg};border:1px solid ${chips.bridges.bd}">${c.scopes.bridges}</span>
        <span data-act="scAll" role="radio" aria-checked="${scope === 'all'}" style="padding:6px 11px;font:600 8.5px Inter,sans-serif;letter-spacing:.11em;cursor:pointer;background:${chips.all.bg};color:${chips.all.fg};border:1px solid ${chips.all.bd}">${c.scopes.all}</span>
        <span data-act="scYear" role="radio" aria-checked="${scope === 'y2026'}" style="padding:6px 11px;font:600 8.5px Inter,sans-serif;letter-spacing:.11em;cursor:pointer;background:${chips.y2026.bg};color:${chips.y2026.fg};border:1px solid ${chips.y2026.bd}">${c.scopes.y2026}</span>
      </div>
      <div class="bh-stats-grid" style="display:grid;grid-template-columns:repeat(4,1fr)">
        ${cell('guests')}${cell('cities')}${cell('countries')}${cell('speakers', true)}
      </div>
      <div style="display:flex;align-items:center;gap:14px;border-top:1px solid rgba(32,27,22,.1);padding:12px 20px;flex-wrap:wrap">
        <span data-role="statLine" style="font-family:Fraunces,serif;font-size:15px;font-style:italic;flex:1;min-width:240px">“${esc(line)}”</span>
        <span data-act="copyLine" style="padding:9px 14px;background:${st.copied ? '#1e6e42' : '#201b16'};color:#fff;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap">${st.copied ? c.copied : c.copy}</span>
      </div>
    </div>
    <!-- /dc -->`;
}
function template() {
  return `
<div data-screen-label="Admin Bridges Hub" style="min-height:100vh;background:#f6f2ea;color:#201b16;font-family:Inter,sans-serif">
  ${blockSubnav()}
  <div class="mx-gutter" style="max-width:1180px;margin:0 auto;padding:30px 28px 48px;display:flex;flex-direction:column;gap:24px">
    ${blockTitle()}
    ${blockBand()}
    <div class="mx-two" style="display:grid;grid-template-columns:1.5fr 1fr;gap:22px;align-items:start">
      ${blockEvents()}
      <div style="display:flex;flex-direction:column;gap:22px">
        ${blockReady()}
        ${blockFollowups()}
        ${blockAfter()}
      </div>
    </div>
    ${blockBoston()}
    ${blockStats()}
  </div>
</div>`;
}

// ---------------------------------------------------------------- behaviour
function rerender(sel, html) { const el = rootEl && rootEl.querySelector(sel); if (el) el.outerHTML = html; }
function val(role) { const el = rootEl && rootEl.querySelector(`[data-role="${role}"]`); return el ? el.value.trim() : ''; }
function checked(role) { const el = rootEl && rootEl.querySelector(`[data-role="${role}"]`); return !!(el && el.checked); }
async function refreshHub() {
  try { const h = await api.get('/api/v2/bridges/hub'); if (h && h.ok) D.hub = h; } catch (e) { /* keep the last read */ }
}
function rerenderAll() {
  rerender('[data-block="band"]', blockBand());
  rerender('[data-block="events"]', blockEvents());
  rerender('[data-block="ready"]', blockReady());
  rerender('[data-block="fu"]', blockFollowups());
  rerender('[data-block="after"]', blockAfter());
  rerender('[data-block="boston"]', blockBoston());
  rerender('[data-block="stats"]', blockStats());
}
// The presenter list is the member portal's own answer — always re-read it after a send rather
// than patching a row locally, so the invited date on screen is the date in the notes.
async function refreshBoston() {
  try {
    const p = await api.get('/api/v2/boston/presenters');
    if (p && p.ok) { D.pres = p; if (D.errors) delete D.errors.pres; }
  } catch (e) { /* keep the last read on screen */ }
  rerender('[data-block="boston"]', blockBoston());
}
// The catering answers live on the member side too — re-read rather than patch, so the reminder
// date and the two food answers on screen are the ones in the database.
async function refreshCatering() {
  try {
    const c = await api.get('/api/v2/boston/catering');
    if (c && c.ok) { D.cat = c; if (D.errors) delete D.errors.cat; }
  } catch (e) { /* keep the last read on screen */ }
  rerender('[data-block="boston"]', blockBoston());
}
function copyText(t) { try { navigator.clipboard.writeText(t); } catch (e) { /* clipboard blocked — the toast still confirms intent */ } }
async function queueKind(el, id, kind) {
  el.setAttribute('aria-disabled', 'true');
  try {
    const r = await api.post('/api/v2/bridges/events/' + encodeURIComponent(id) + '/queue-email', { kind });
    await refreshHub(); rerenderAll();
    ui.toast(((r && r.message) || 'QUEUED — APPROVE IN THE OUTBOX').toUpperCase());
  } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
}
async function saveStat(input) {
  const key = input.dataset.stat;
  const s = D.hub.stats && D.hub.stats[st.scope];
  const liveVal = s ? s.live[key] : '';
  const raw = input.value.trim();
  const value = raw === '' || raw === liveVal ? '' : raw; // typing the live value back clears the override
  try {
    const r = await api.put('/api/v2/bridges/stats', { scope: st.scope, key, value: value || null });
    if (r && r.stats) D.hub.stats = r.stats;
    st.copied = false;
    rerender('[data-block="stats"]', blockStats());
    ui.toast(value ? COPY.stats.saved : COPY.stats.cleared);
  } catch (e) { ui.toast(e.message, { kind: 'error' }); }
}
async function uploadPhoto(input) {
  const ed = (D.hub.editions || []).find(x => x.id === input.dataset.id);
  const file = input.files && input.files[0];
  if (!ed || !file) return;
  st.uploading = ed.id; rerender('[data-block="events"]', blockEvents());
  try {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/upload/photos', { method: 'POST', headers: { Authorization: 'Bearer ' + (localStorage.getItem('medx_token') || '') }, body: fd });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.file_url) throw new Error(j.error || COPY.events.rc.uploadFail);
    const photos = (ed.photos || []).concat([{ url: j.file_url, caption: file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ') }]);
    const r = await api.put('/api/v2/bridges/editions/' + encodeURIComponent(ed.id), { photos });
    if (r && r.edition) D.hub.editions = D.hub.editions.map(x => x.id === ed.id ? r.edition : x);
    st.uploading = null;
    rerender('[data-block="events"]', blockEvents());
    ui.toast('PHOTO ADDED TO THE ' + ed.city.toUpperCase() + ' GALLERY');
  } catch (e) {
    st.uploading = null; rerender('[data-block="events"]', blockEvents());
    ui.toast(e.message || COPY.events.rc.uploadFail, { kind: 'error' });
  }
}

const handlers = {
  newCityToggle: () => { st.newCityOpen = !st.newCityOpen; st.ncCity = val('ncCity'); st.ncWhen = val('ncWhen'); rerender('[data-block="events"]', blockEvents()); },
  ncAdd: async (el) => {
    const city = val('ncCity'); const when = val('ncWhen');
    if (!city) { ui.toast(COPY.events.typeCity); return; }
    el.setAttribute('aria-disabled', 'true');
    try {
      await api.post('/api/bridges/events', {
        name: 'Building Bridges — ' + city, city,
        event_date: isoDate(when) ? when : (when || 'TBD'),
        description: 'An evening connecting Croatian and international biomedicine.',
        status: 'planning', is_published: 0, capacity: 50
      });
      st.newCityOpen = false; st.ncCity = ''; st.ncWhen = '';
      await refreshHub(); rerenderAll();
      ui.toast(COPY.events.added(city));
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  evEdit: (el) => { st.editEvent = st.editEvent === el.dataset.id ? null : el.dataset.id; st.recapEdit = null; rerender('[data-block="events"]', blockEvents()); },
  evSave: async (el) => {
    const id = el.dataset.id;
    const body = { venue_name: val('evVenue') || null, event_time: val('evTime') || null, registration_open: checked('evOpen') ? 1 : 0, is_published: checked('evPub') ? 1 : 0 };
    const d = val('evDate'); if (d) body.event_date = d;
    const cap = val('evCap'); if (cap) body.capacity = Number(cap);
    el.setAttribute('aria-disabled', 'true');
    try {
      await api.put('/api/bridges/events/' + encodeURIComponent(id), body);
      st.editEvent = null;
      await refreshHub(); rerenderAll();
      ui.toast(COPY.events.ev.saved);
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  recap: (el) => { st.recapEdit = st.recapEdit === el.dataset.id ? null : el.dataset.id; st.editEvent = null; rerender('[data-block="events"]', blockEvents()); },
  rcSave: async (el) => {
    const ed = (D.hub.editions || []).find(x => x.id === el.dataset.id); if (!ed) return;
    const g = val('rcGuests'), cn = val('rcConn');
    const body = { guests: g === '' ? null : Number(g), connections: cn === '' ? null : Number(cn), note: val('rcNote'), venue: val('rcVenue') };
    el.setAttribute('aria-disabled', 'true');
    try {
      const r = await api.put('/api/v2/bridges/editions/' + encodeURIComponent(ed.id), body);
      if (r && r.edition) D.hub.editions = D.hub.editions.map(x => x.id === ed.id ? r.edition : x);
      st.recapEdit = null;
      await refreshHub(); rerenderAll();
      ui.toast(COPY.events.rc.saved);
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  rcTogglePub: async (el) => {
    const ed = (D.hub.editions || []).find(x => x.id === el.dataset.id); if (!ed) return;
    try {
      const r = await api.put('/api/v2/bridges/editions/' + encodeURIComponent(ed.id), { is_published: !ed.is_published });
      if (r && r.edition) D.hub.editions = D.hub.editions.map(x => x.id === ed.id ? r.edition : x);
      rerender('[data-block="events"]', blockEvents()); rerender('[data-block="band"]', blockBand());
      ui.toast(ed.is_published ? COPY.events.rc.hidden : COPY.events.rc.shown);
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  rcPhotoRemove: async (el) => {
    const ed = (D.hub.editions || []).find(x => x.id === el.dataset.id); if (!ed) return;
    const photos = (ed.photos || []).filter((_, i) => i !== Number(el.dataset.i));
    try {
      const r = await api.put('/api/v2/bridges/editions/' + encodeURIComponent(ed.id), { photos });
      if (r && r.edition) D.hub.editions = D.hub.editions.map(x => x.id === ed.id ? r.edition : x);
      rerender('[data-block="events"]', blockEvents());
      ui.toast('PHOTO REMOVED FROM THE GALLERY');
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  queueInv: (el) => queueKind(el, el.dataset.id || (nextEvent() || {}).id, 'invitation'),
  queueRem: (el) => queueKind(el, el.dataset.id || (nextEvent() || {}).id, 'reminder'),
  queueThanks: (el) => queueKind(el, el.dataset.id, 'thankyou'),
  fuDone: async (el) => {
    const id = el.dataset.id;
    try {
      await api.put('/api/v2/bridges/followups/' + encodeURIComponent(id), { done: true });
      await refreshHub(); rerender('[data-block="fu"]', blockFollowups());
      ui.toast(COPY.fu.done, { undo: async () => { try { await api.put('/api/v2/bridges/followups/' + encodeURIComponent(id), { done: false }); } catch (e) {} if (rootEl) { await refreshHub(); rerender('[data-block="fu"]', blockFollowups()); } } });
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  fuAdd: async (el) => {
    const name = val('fuName');
    if (!name) { ui.toast(COPY.fu.typeFirst); return; }
    el.setAttribute('aria-disabled', 'true');
    try {
      await api.post('/api/v2/bridges/followups', { name, why: val('fuWhy') || COPY.fu.whyFallback });
      st.fuName = ''; st.fuWhy = '';
      await refreshHub(); rerender('[data-block="fu"]', blockFollowups());
      ui.toast(COPY.fu.added);
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  // ---- Boston · 5-minute presentations (every send is confirmed first — these are real emails
  // that leave immediately, not Outbox batches) ----
  bpAddToggle: () => { st.bpOpen = !st.bpOpen; st.bpName = val('bpName'); st.bpEmail = val('bpEmail'); rerender('[data-block="boston"]', blockBoston()); },
  bpSendOne: async (el) => {
    const c = COPY.boston;
    const id = el.dataset.id, who = el.dataset.who || '', mail = el.dataset.mail || '';
    const again = ((D.pres && D.pres.rows) || []).some(r => r.registration_id === id && r.invited_at != null);
    if (!await ui.confirm({ title: again ? c.cOneAgain : c.cOneTitle, body: c.cOneBody(esc(who), esc(mail)), ok: c.goSend, cancel: c.keep })) return;
    st.bpSending = id; rerender('[data-block="boston"]', blockBoston());
    try {
      const r = await api.post('/api/v2/boston/presenters/' + encodeURIComponent(id) + '/send-link', {});
      st.bpSending = null;
      await refreshBoston();
      ui.toast(c.sent((r && r.sent && r.sent[0]) || mail));
    } catch (e) { st.bpSending = null; rerender('[data-block="boston"]', blockBoston()); ui.toast(e.message, { kind: 'error' }); }
  },
  bpSendAll: async (el) => {
    const c = COPY.boston;
    const n = (D.pres && Number(D.pres.not_invited)) || 0;
    if (!n) return;
    if (!await ui.confirm({ title: c.cAllTitle(n), body: c.cAllBody(n), ok: c.goSend, cancel: c.keep })) return;
    el.setAttribute('aria-disabled', 'true');
    try {
      const r = await api.post('/api/v2/boston/presenters/send-all', {});
      await refreshBoston();
      ui.toast(c.sentAll((r && r.sent && r.sent.length) || 0));
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  bpAdd: async () => {
    const c = COPY.boston;
    const name = val('bpName'), email = val('bpEmail');
    if (!name || !email) { ui.toast(c.needBoth); return; }
    if (!await ui.confirm({ title: c.cAddTitle, body: c.cAddBody(esc(name), esc(email)), ok: c.goAdd, cancel: c.keep })) return;
    st.bpName = name; st.bpEmail = email; st.bpBusy = true;
    rerender('[data-block="boston"]', blockBoston());
    try {
      const r = await api.post('/api/v2/boston/presenters/add', { name, email });
      st.bpBusy = false; st.bpOpen = false; st.bpName = ''; st.bpEmail = '';
      await refreshBoston();
      ui.toast(r && r.pending ? c.addedPending : c.added(email));
    } catch (e) { st.bpBusy = false; rerender('[data-block="boston"]', blockBoston()); ui.toast(e.message, { kind: 'error' }); }
  },
  // ---- Boston · the see-you-next-week reminder (same rule: confirmed first, sent immediately) ----
  bpRemindOne: async (el) => {
    const c = COPY.cat;
    const id = el.dataset.id, who = el.dataset.who || '', mail = el.dataset.mail || '';
    const again = ((D.cat && D.cat.rows) || []).some(r => r.registration_id === id && r.reminder_sent);
    if (!await ui.confirm({ title: again ? c.cOneAgain : c.cOneTitle, body: c.cOneBody(esc(who), esc(mail)), ok: COPY.boston.goSend, cancel: COPY.boston.keep })) return;
    st.bpReminding = id; rerender('[data-block="boston"]', blockBoston());
    try {
      const r = await api.post('/api/v2/boston/reminders/' + encodeURIComponent(id) + '/send', {});
      st.bpReminding = null;
      await refreshCatering();
      ui.toast(c.sent((r && r.sent && r.sent[0]) || mail));
    } catch (e) { st.bpReminding = null; rerender('[data-block="boston"]', blockBoston()); ui.toast(e.message, { kind: 'error' }); }
  },
  bpRemindAll: async (el) => {
    const c = COPY.cat;
    const n = (D.cat && Number(D.cat.reminders_pending)) || 0;
    if (!n) return;
    if (!await ui.confirm({ title: c.cAllTitle(n), body: c.cAllBody(n), ok: COPY.boston.goSend, cancel: COPY.boston.keep })) return;
    el.setAttribute('aria-disabled', 'true');
    try {
      const r = await api.post('/api/v2/boston/reminders/send-all', {});
      await refreshCatering();
      ui.toast(c.sentAll((r && r.sent && r.sent.length) || 0));
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  scBridges: () => { st.scope = 'bridges'; st.copied = false; rerender('[data-block="stats"]', blockStats()); },
  scAll: () => { st.scope = 'all'; st.copied = false; rerender('[data-block="stats"]', blockStats()); },
  scYear: () => { st.scope = 'y2026'; st.copied = false; rerender('[data-block="stats"]', blockStats()); },
  copyLine: () => {
    const s = D.hub.stats && D.hub.stats[st.scope];
    const line = COPY.stats.line(s ? s.effective : { guests: '—', cities: '—', countries: '—', speakers: '—' }, COPY.stats.scopeName[st.scope]);
    copyText(line); st.copied = true;
    rerender('[data-block="stats"]', blockStats());
    ui.toast(COPY.stats.copiedToast);
  }
};

export default {
  title: 'Building Bridges',
  async render(root) {
    ensureCss();
    rootEl = root;
    st = { scope: 'bridges', copied: false, newCityOpen: false, ncCity: '', ncWhen: '', editEvent: null, recapEdit: null, fuName: '', fuWhy: '', uploading: null,
           bpOpen: false, bpName: '', bpEmail: '', bpBusy: false, bpSending: null, bpReminding: null };
    D = await load();
    if (rootEl !== root) return; // navigated away while loading
    root.innerHTML = template();
    unbind = ui.bind(root, handlers);
    changeHandler = (e) => {
      const t = e.target;
      if (t && t.matches && t.matches('input[data-stat]')) saveStat(t);
      if (t && t.matches && t.matches('input[data-role="rcPhotoFile"]')) uploadPhoto(t);
    };
    root.addEventListener('change', changeHandler);
  },
  destroy() {
    if (changeHandler && rootEl) rootEl.removeEventListener('change', changeHandler);
    changeHandler = null;
    if (unbind) unbind(); unbind = null; rootEl = null; D = null; st = null;
  }
};
