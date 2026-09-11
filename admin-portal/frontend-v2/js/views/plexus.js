// Source: Admin Plexus Hub.dc.html
// Blocks (artboard order): "Hub sub-nav" › "Title row" (name · LIVE FOR MEMBERS · facts line · ✎ EDIT ·
// MANAGE / EVENT DAY buttons) › "Stat strip + key dates" › "BEFORE THE WEEK" (row-list; Speakers /
// Schedule / Live Q&A rows open inline manage panels) › "THE GALA EVENING" + "AFTER THE WEEK" (left
// column) › "WHAT MEMBERS SEE" + "CME note" + v2 "STATS FOR MEDIA & SPONSORS" (right column, note 21) ›
// "Edition footer". The main header is NOT here — js/chrome.js renders it.
// Every number is a live database read (note 6); FACTS fills gaps and wording only.
// Deviations from the artboard (marked data-v2 where visible):
//   · the DAYS TO GO Croatian tooltip was dropped (review-round decision: text easter eggs removed);
//   · THE GALA EVENING "FULL VIEW →" goes to /gala (the seating board — the artboard pointed at
//     Event Day, but the guest list + seating live at /gala; the ON THE DAY row still goes there);
//   · sign-up forms render one row per form with a real OPEN/CLOSE control (screen spec).
//
// v2 additions 2026-09-11 (design/MEETUPS-SPEC.md §1 + §3 "Admin view"), all marked data-v2:
//   · EDITION SWITCHER — the title row carries a "2026 ▾" chip reading /api/v2/plexus-hub/editions.
//     The chosen edition rides in ?edition=<id>; an archived one opens READ ONLY (every write action
//     is hidden AND every write handler is refused — see bindHandlers()).
//   · TAB STRIP — /projects/plexus is the hub, /projects/plexus/meetups is the MEETUPS tab. The live
//     deep links /projects/plexus/speakers|schedule|qa still open their inline hub panels, unchanged.
//   · MEETUPS tab — stats strip · table · create/edit drawer · attendees drawer · invites drawer ·
//     copy host link · CSV. Permission section `plexus-meetups` (server.js mirrors the id and maps
//     /api/v2/meetups-ops to it); without it the tab renders the locked state.
import { api } from '../api.js';
import { session } from '../state.js';
import { ui, esc, fmt } from '../ui.js';
import { FACTS, galaPriceNow } from '../facts.js';
import { perms } from '../perms.js';
import router from '../router.js';

export const SOURCE = 'Admin Plexus Hub.dc.html';

const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const PLANNER_URL = 'https://plexus-tables.netlify.app/planner.html';
const SESSION_TYPES = ['talk', 'keynote', 'panel', 'workshop', 'networking', 'gala', 'break'];
const STATS_SCOPE = 'plexus';

// ---- COPY: every string that may change in a revision (dates/prices/venues via FACTS or the API) ----
export const COPY = {
  title: 'Plexus Week 2026',
  subnav: { projects: 'PROJECTS', self: 'PLEXUS WEEK 2026', accelerator: 'ACCELERATOR', forum: 'BIOMEDICAL FORUM', bridges: 'BUILDING BRIDGES' },
  head: {
    live: 'LIVE FOR MEMBERS', hidden: 'NOT ON THE MEMBER PORTAL', liveTitle: 'What members see right now — edit it in the card on the right',
    facts: (cap, range, venue, city) => `Conference (free, cap ${cap}) + Gala Evening + Donor Night · ${range} · ${venue}, ${city}`,
    edit: '✎ EDIT', editTitle: 'Dates, venue, capacity and registration — saved straight to the live conference',
    manage: 'WHAT MEMBERS SEE — MANAGE ↗', eventday: 'EVENT DAY ROOM →'
  },
  confModal: { eyebrow: 'CONFERENCE SETTINGS', title: 'Plexus Week — dates, venue & capacity', start: 'FIRST DAY', end: 'LAST DAY', venue: 'VENUE', vcity: 'CITY', cap: 'CAPACITY (SEATS)', open: 'Registration open', save: 'SAVE', cancel: 'CANCEL', saved: 'CONFERENCE SAVED — EVERY SCREEN READS IT LIVE', capBad: 'CAPACITY MUST BE A WHOLE NUMBER OF SEATS' },
  stats: {
    days: 'DAYS TO GO', reg: 'CONFERENCE REGISTERED', regSub: cap => `CAP ${cap} · OPEN LIST →`,
    // UXFIX closing (2026-09-02, audit #1): the cell counted registration ROWS, kept chasing
    // cancelled ones, and called the result seats. Canonical numbers now come from
    // /api/v2/gala-ops/summary (seats incl. plus-ones, cancelled/rejected/declined/expired out);
    // an older backend falls back to the local rows and says BOOKINGS, which is what rows are.
    gala: 'GALA SEATS', galaFallback: 'GALA BOOKINGS', galaSub: (p, c) => `${p} PAID · ${c} TO CHASE →`,
    speakers: 'SPEAKERS', speakersLive: n => `${n} live for members · manage →`, speakersDraft: 'program in draft · manage →',
    money: 'COLLECTED', moneySub: 'OPEN MONEY →', calendar: 'CALENDAR →'
  },
  dates: { earlyBird: p => `Early-bird ends → ${p}`, dayOne: 'Donor Night · Event Day wakes up', dayTwo: 'Conference day two + Gala' },
  before: {
    title: 'BEFORE THE WEEK', sub: 'in priority order — what is not done yet',
    editList: '✎ EDIT LIST', editListTitle: 'Reorder, rename or add rows — this list is shared by the whole team', editListToast: 'THE LIST FOLLOWS THE LIVE DATA — EDIT THE THING ITSELF VIA ITS ROW',
    regs: { name: 'Registrations', open: 'OPEN NOW', closed: 'CLOSED', status: (n, cap) => `${n} of ${cap} signed up · form live`, action: 'OPEN LIST' },
    forms: { none: 'Sign-up Forms', noneStatus: 'No sign-up form pages yet — create one from Links', noneAction: 'CREATE', status: (r, w, d) => `${r} response${r === 1 ? '' : 's'}${w ? ` · ${w} waitlisted` : ''}${d ? ` · ${d}` : ''}`, open: 'OPEN', close: 'CLOSE', responses: 'RESPONSES', toggled: s => s === 'open' ? 'FORM IS LIVE — SIGN-UPS FLOW IN AGAIN' : 'FORM CLOSED — THE PAGE STOPS TAKING SIGN-UPS' },
    speakers: { name: 'Speakers', tag: n => `${n} CONFIRMED`, none: '0 CONFIRMED', status: (t, l) => `${t} on file · ${l} live on the member page`, action: 'MANAGE' },
    schedule: { name: 'Schedule & program', tag: n => `${n} PUBLISHED`, draft: 'IN DRAFT', status: t => `${t} session${t === 1 ? '' : 's'} · the member Program page renders the published rows`, none: 'No sessions yet — members see “Program in preparation”', action: 'BUILD' },
    travel: { tag: 'TRAVEL', name: 'Speaker itineraries', status: n => n ? `${n} itinerar${n === 1 ? 'y' : 'ies'} filed · flights, hotel nights & pickups per speaker` : 'Flights, hotel nights & airport pickups per speaker — nothing filed yet', action: 'MANAGE' },
    prices: { tag: 'SET', name: 'Tickets & prices', status: (a, b, d) => `Gala ${a} → ${b} on ${d}`, after: b => `Gala at the regular price ${b} — early bird is over`, action: 'EDIT' },
    outbox: { tag: 'QUEUED', clear: 'CLEAR', name: 'Emails to registrants', status: n => n ? `${n} batch${n === 1 ? '' : 'es'} queued in the Outbox — nothing sends without your OK` : 'Nothing queued — the Outbox is clear', action: 'REVIEW' },
    links: { tag: 'AUTO', name: 'Invitations & short links', status: n => `${n} live link${n === 1 ? '' : 's'} · Paid, VIP, diaspora — every sign-up lands tagged with its source`, action: 'GET LINK' },
    cme: { name: 'CME / HLK accreditation', on: 'ACCREDITED', off: 'NOT FILED', status: (p, s) => `${p != null ? p + ' HLK point' + (p === 1 ? '' : 's') : 'points not set'} · ${s} consented submission${s === 1 ? '' : 's'} for the chamber report`, offStatus: 'File the accreditation before the week — certificates need it', action: 'EXPORT CSV', door: 'SETTINGS', exported: 'CHAMBER CSV DOWNLOADED', exportFail: 'EXPORT FAILED — TRY AGAIN' },
    qa: { name: 'Live stage Q&A', open: n => `${n} OPEN`, quiet: 'QUIET', status: t => t ? `${t} question${t === 1 ? '' : 's'} from the floor · answer or hide them here` : 'No questions yet — the floor is quiet until the event', action: 'MODERATE' }
  },
  sp: {
    add: '+ ADD SPEAKER', addTitle: 'ADD', saveTitle: 'SAVE', cancel: 'CANCEL',
    name: 'Full name', role: 'Role (e.g. President)', inst: 'Institution', email: 'Email', talk: 'Talk title', keynote: 'Keynote',
    logo: 'Institution logo URL', tag: 'Shows on', tagOpts: [['', '—'], ['plexus', 'Plexus'], ['gala', 'Gala'], ['both', 'Both']],
    confirmedTitle: 'Confirmed = the speaker said yes; Live = members see the card',
    confirmed: 'CONFIRMED', pending: 'PENDING', live: 'LIVE', hiddenTag: 'HIDDEN',
    edit: 'EDIT', del: 'DELETE', photo: 'PHOTO', photoTitle: 'Upload a portrait — lands on the member page card',
    nameFirst: 'TYPE THE NAME FIRST', added: 'SPEAKER ADDED — CONFIRM & PUBLISH WHEN READY', saved: 'SPEAKER SAVED',
    confirmedOn: 'MARKED CONFIRMED', confirmedOff: 'BACK TO PENDING', liveOn: n => `${n.toUpperCase()} IS LIVE — MEMBERS SEE THE CARD NOW`, liveOff: 'HIDDEN FROM THE MEMBER PAGE',
    delAsk: n => `Remove ${n}? The member page stops showing the card at once.`, delOk: 'REMOVE', delKeep: 'KEEP', deleted: 'SPEAKER REMOVED',
    photoUp: 'PHOTO UPLOADED — ON THE CARD NOW', metaSaved: 'LOGO & EVENT TAG SAVED', empty: 'No speakers yet — add the first one above.'
  },
  ss: {
    add: '+ ADD SESSION', addTitle: 'ADD', saveTitle: 'SAVE', cancel: 'CANCEL',
    title: 'Session title', day: n => `Day ${n}`, start: 'Start', end: 'End', room: 'Room', type: 'Type',
    publishNow: 'Publish now', pub: 'PUBLISH', unpub: 'UNPUBLISH', pubAll: 'PUBLISH ALL', edit: 'EDIT', del: 'DELETE',
    liveTag: 'LIVE', draftTag: 'DRAFT',
    titleFirst: 'TYPE THE SESSION TITLE FIRST', added: 'SESSION ADDED', saved: 'SESSION SAVED',
    published: 'PUBLISHED — ON THE MEMBER PROGRAM PAGE NOW', unpublished: 'UNPUBLISHED — OFF THE MEMBER PAGE',
    pubAllAsk: n => `Publish all ${n} draft session${n === 1 ? '' : 's'}? Members get a schedule-update notification.`, pubAllOk: 'PUBLISH ALL', pubAllDone: n => `${n} SESSION${n === 1 ? '' : 'S'} PUBLISHED TO THE MEMBER PAGE`, pubAllNone: 'EVERYTHING IS ALREADY PUBLISHED',
    delAsk: t => `Delete “${t}”? It leaves the program and every personal schedule.`, delOk: 'DELETE', delKeep: 'KEEP', deleted: 'SESSION DELETED',
    empty: 'No sessions yet — members see “Program in preparation” until the first publish.'
  },
  qa: {
    answer: 'ANSWER', answered: 'ANSWERED', hide: 'HIDE', unhide: 'UNHIDE', from: 'from the floor', admin: 'organizer question',
    modal: { eyebrow: 'LIVE Q&A', title: 'Answer this question', send: 'SEND ANSWER', cancel: 'CANCEL', empty: 'TYPE THE ANSWER FIRST' },
    answeredToast: 'ANSWER SAVED — VISIBLE ON THE LIVE BOARD', hidden: 'QUESTION HIDDEN FROM THE BOARD', shown: 'QUESTION BACK ON THE BOARD', empty: 'No questions yet.'
  },
  gala: {
    title: 'THE GALA EVENING', when: (d, v) => [d, v].filter(Boolean).join(' · '), full: 'FULL VIEW →',
    seats: { name: 'Guest list & seating', tag: n => `${n} PAID`, status: (r, c) => `${r} reserved · ${c} to chase · seating chart open`, action: 'SEAT' },
    waitlist: { tag: 'AUTO', name: 'Waitlist', status: n => `${n} waiting · auto-offers a freed seat · 24 h to accept`, action: 'VIEW' },
    donor: { name: 'Donor Night — Croatians Abroad', none: '0 INVITED', tag: n => `${n} SIGNED UP`, status: d => `${d} · the diaspora list from the Croatians Abroad flow`, emptyStatus: d => `${d} · guest list empty`, action: 'INVITE' },
    onday: { tag: 'ON THE DAY', name: 'Check-in, ops map & stage Q&A', status: 'Live tools in the Event Day room', action: 'REHEARSE' },
    more: 'More tools:', planner: '3D ballroom planner', auctions: 'charity auctions', moreTail: '— auction pledges land in Money → Sponsors & donors'
  },
  after: {
    title: 'AFTER THE WEEK', line: d => `Certificates, thank-yous & photo recap unlock ${d}.`,
    certs: { name: 'Certificates & thank-yous', tag: 'QUEUED', done: n => `${n} SENT`, status: s => s || 'Runs after the week — every email stages to the Outbox for your OK', action: 'DETAILS' },
    editions: { name: 'Editions', tag: '2026 EDITION', status: n => `${n} edition${n === 1 ? '' : 's'} on file · nothing is ever deleted`, action: 'VIEW' },
    start2027: d => `START PLEXUS 2027 · AFTER ${d.toUpperCase()}`, start2027Title: 'Duplicates this hub with dates cleared — available after the 2026 edition closes',
    notYet: d => `AVAILABLE AFTER ${d.toUpperCase()} — THE 2026 EDITION CLOSES FIRST`,
    peModal: { eyebrow: 'POST-EVENT', title: 'Certificates, thank-yous & recap', close: 'CLOSE' }
  },
  edModal: { eyebrow: 'EDITIONS', title: 'Plexus — every edition on file', close: 'CLOSE', note: 'Archiving locks an edition read-only; carry-over starts the next year from it. Both open after the week.' },
  members: {
    title: 'WHAT MEMBERS SEE', sub: 'their home card', label: 'STATUS LABEL', detail: 'DETAIL LINE',
    save: 'SAVE TO MEMBER PORTAL', saved: '✓ SAVED — MEMBERS SEE IT NOW', failed: 'COULD NOT SAVE — TRY AGAIN',
    manage: 'MANAGE THE FULL MEMBER PAGE →'
  },
  cme: { on: '✓ CME accredited', onTail: ' — certificates auto-send after the week. ', off: '○ CME not filed yet', offTail: ' — set it up before the week so certificates can carry points. ', link: 'Settings → documents' },
  widget: {
    title: 'STATS FOR MEDIA & SPONSORS', sub: 'live numbers · ✎ overrides one figure',
    copy: 'COPY LINE', copied: 'LINE COPIED — PASTE IT ANYWHERE', copyFail: 'COPY FAILED — SELECT THE LINE BY HAND',
    manual: 'MANUAL', save: 'SET', clear: '✕', cleared: 'BACK TO THE LIVE NUMBER', overridden: 'FIGURE OVERRIDDEN — THE COPY LINE USES IT',
    figures: { registered: 'Registered', gala_paid: 'Gala seats paid', speakers_confirmed: 'Speakers confirmed', days_to_go: 'Days to go' },
    line: f => `Plexus Week 2026 — ${f.registered} registered (cap ${f.cap}) · ${f.gala_paid} Gala seats paid · ${f.speakers_confirmed} speakers confirmed · ${f.days_to_go} days to go · ${f.range} · ${f.venue}, ${f.city}`
  },
  footer: { line: 'nothing is ever deleted — tickets &amp; receipts stay valid forever.', edition: '2026 edition', archive: d => `ARCHIVE · AFTER ${d.toUpperCase()}`, archiveTitle: 'Locks this edition read-only once the week is over' },
  locked: sec => `${perms.label(sec) || 'That section'} is locked for you — ask Alen.`,

  // ---- v2 2026-09-11: tab strip ----------------------------------------------------------------
  tabs: { hub: 'THE WEEK', meetups: 'MEETUPS', meetupsLocked: 'MEETUPS · LOCKED' },

  // ---- v2 2026-09-11: edition switcher ---------------------------------------------------------
  ed: {
    title: 'Switch edition — archived years open read-only', label: 'EDITION',
    status: { active: 'ACTIVE', upcoming: 'UPCOMING', archived: 'ARCHIVED' },
    none: 'No editions on file yet — the 2026 week seeds itself on the next boot.',
    roTag: 'READ ONLY',
    roLine: y => `${y} is archived — everything on this screen is read-only.`,
    roWhy: 'Nothing can be changed in a closed edition. Switch back to the active year to edit.',
    roToast: 'THIS EDITION IS ARCHIVED — SWITCH TO THE ACTIVE YEAR TO CHANGE ANYTHING'
  },

  // ---- v2 2026-09-11: MEETUPS tab (design/MEETUPS-SPEC.md §3 "Admin view") ----------------------
  meet: {
    stats: {
      meetups: 'MEETUPS', meetupsSub: (p, d) => `${p} published · ${d} draft${d === 1 ? '' : 's'}`,
      seats: 'SEATS', seatsSub: (taken, left) => `${taken} taken · ${left} left`,
      fill: 'FILL', fillSub: n => `${n} host${n === 1 ? '' : 's'} on the programme`,
      wait: 'WAITLISTED', waitSub: 'people holding for a place'
    },
    table: {
      title: 'MEETUPS', sub: 'coffee, lunch, a walk — one host, one small table',
      add: '+ NEW MEETUP', addTitle: 'A table of 3–15: the host, the time, the place and who may come',
      head: { title: 'MEETUP', host: 'HOST', when: 'WHEN', venue: 'WHERE', seats: 'SEATS', wait: 'WAIT', status: 'STATUS' },
      seats: (a, b) => `${a}/${b}`, noHost: 'no host yet', noVenue: '—',
      empty: 'No meetups yet — the first one is a coffee with 6 seats.',
      emptyWhy: 'Create it as a draft, add the host, then publish when the time and place are set.',
      kinds: { coffee: 'COFFEE', lunch: 'LUNCH', dinner: 'DINNER', walk: 'WALK', visit: 'VISIT', other: 'MEETUP' },
      status: { draft: 'DRAFT', published: 'LIVE', cancelled: 'CANCELLED', completed: 'DONE' },
      inviteOnly: 'INVITE ONLY', noWaitlist: 'NO WAITLIST', full: 'FULL'
    },
    acts: {
      people: 'PEOPLE', peopleTitle: 'Attendees, waitlist, check-in',
      invites: 'INVITE', invitesTitle: 'Invite members or paste emails — preview before anything sends',
      link: 'HOST LINK', linkTitle: 'Copy the host’s own page link — no login needed',
      csv: 'CSV', csvTitle: 'Download the attendee list',
      edit: 'EDIT', publish: 'PUBLISH', unpublish: 'UNPUBLISH', cancel: 'CANCEL', del: '✕', delTitle: 'Delete this draft'
    },
    drawer: { close: 'CLOSE', newTitle: 'NEW MEETUP', editTitle: t => `EDIT · ${String(t || '').toUpperCase()}`, attTitle: t => `PEOPLE · ${String(t || '').toUpperCase()}`, invTitle: t => `INVITATIONS · ${String(t || '').toUpperCase()}` },
    form: {
      title: 'TITLE', titlePh: 'Coffee with the keynote', kind: 'KIND',
      description: 'WHAT IT IS', descriptionPh: 'One short paragraph the member sees on the card.',
      audience: 'WHO IT IS FOR', audiencePh: 'Students & residents in neuroscience',
      tags: 'FIELD TAGS', tagsPh: 'neuroscience, sleep, research — comma separated',
      venueName: 'VENUE', venueNamePh: 'Kavana Esplanade', venueAddress: 'ADDRESS', venueAddressPh: 'Mihanovićeva 1, Zagreb',
      venueMap: 'MAP LINK', venueMapPh: 'https://maps.app.goo.gl/…',
      starts: 'STARTS', ends: 'ENDS', capacity: 'SEATS', capacityWhy: '3–15 is the usual table (1–60 allowed)',
      waitlist: 'Waitlist when it fills', visibility: 'WHO CAN SEE IT',
      visOpts: [['open', 'Open — any member can join'], ['invite', 'Invite only — only the people you invite']],
      host: 'HOST', hostMember: 'A MED&X MEMBER', hostFree: 'A NAME + EMAIL',
      hostSearch: 'Search members — name, email or institution', hostSearchShort: 'Type at least two letters.',
      hostNone: 'No member matches that.', hostClear: 'CLEAR', hostPicked: 'PICKED',
      hostName: 'HOST NAME', hostNamePh: 'Prof. Ivana Kovač', hostEmail: 'HOST EMAIL', hostEmailPh: 'host@example.org',
      hostTitle: 'ROLE & INSTITUTION', hostTitlePh: 'Professor of Neurology · KBC Zagreb',
      save: 'SAVE', create: 'CREATE MEETUP', cancel: 'CANCEL',
      needTitle: 'GIVE THE MEETUP A TITLE FIRST', needStart: 'SET THE START — DATE AND TIME',
      created: 'MEETUP CREATED AS A DRAFT — PUBLISH IT WHEN THE PLACE IS SET', saved: 'MEETUP SAVED'
    },
    att: {
      confirmed: 'COMING', waitlist: 'WAITLIST', invited: 'INVITED', declined: 'DECLINED', cancelled: 'CANCELLED',
      countOf: (n, cap) => `${n} of ${cap}`, empty: 'Nobody here yet.',
      add: 'ADD SOMEONE', addMember: 'A MEMBER', addEmail: 'AN EMAIL',
      addEmailPh: 'name@example.org', addNamePh: 'Full name', addInstPh: 'Institution', addPosPh: 'Position / field',
      addBtn: 'ADD', notify: 'Email them', addedIn: n => `${n.toUpperCase()} IS IN — THE PLACE IS CONFIRMED`,
      addedWait: n => `${n.toUpperCase()} IS ON THE WAITLIST`, already: 'THAT PERSON ALREADY HAS A PLACE HERE',
      needEmail: 'A VALID EMAIL ADDRESS IS NEEDED',
      pos: n => `#${n}`, checkedIn: '✓ IN', checkIn: 'CHECK IN', undo: 'UNDO',
      promote: 'PROMOTE', promoteTitle: 'Move this person up into the table now — they get the email',
      cancelPlace: 'CANCEL', cancelTitle: 'Free this place — the first waitlisted person is promoted automatically',
      remove: '✕', removeTitle: 'Remove the row entirely (a mistake, a duplicate)',
      csv: 'EXPORT CSV', csvName: 'medx-meetup-attendees.csv', csvDone: 'ATTENDEE LIST DOWNLOADED',
      checkedOn: n => `${n.toUpperCase()} CHECKED IN`, checkedOff: 'CHECK-IN UNDONE',
      promoted: n => `${n.toUpperCase()} MOVED INTO THE TABLE — THEY GET THE EMAIL`,
      cancelAsk: n => `Free ${n}’s place? They get a cancellation email and the first person on the waitlist moves up automatically.`,
      cancelOk: 'FREE THE PLACE', cancelKeep: 'KEEP',
      // NB: `cancelled` above is the BUCKET label — the toasts keep their own names on purpose
      freed: 'PLACE FREED', freedUp: n => `PLACE FREED — ${n.toUpperCase()} MOVED UP`,
      removeAsk: n => `Remove ${n} from this meetup completely? No email is sent — use CANCEL if they should hear about it.`,
      removeOk: 'REMOVE', removeKeep: 'KEEP', removed: 'ROW REMOVED'
    },
    inv: {
      summary: (i, a, d) => `${i} invited · ${a} accepted · ${d} declined`,
      pick: 'PICK MEMBERS', pickPh: 'Search members — name, email or institution',
      paste: 'OR PASTE EMAILS', pastePh: 'a@example.org, b@example.org',
      preview: 'PREVIEW THE EMAIL', previewTitle: 'Renders the exact email and sends nothing',
      previewHead: (n, s) => `${n} recipient${n === 1 ? '' : 's'} · ${s}`,
      previewNone: 'Pick someone or paste an address first.',
      invalid: list => `Not an email address: ${list}`,
      send: 'SEND THE INVITATIONS', sendAsk: n => `Send the invitation to ${n} ${n === 1 ? 'person' : 'people'}? Each gets an Accept / Can’t make it email.`,
      sendOk: 'SEND', sendKeep: 'NOT YET',
      sent: (n, m) => `${n} INVITED · ${m} EMAIL${m === 1 ? '' : 'S'} SENT`,
      skipped: n => `${n} already had a place — skipped`,
      none: 'Nobody invited yet.', drop: '✕'
    },
    hostLink: { copied: 'HOST LINK COPIED — SEND IT TO THE HOST', failed: 'COPY FAILED — OPEN THE MEETUP AND COPY BY HAND', none: 'THIS MEETUP HAS NO HOST LINK YET — PUBLISH IT FIRST' },
    publish: { needHost: 'ADD A HOST BEFORE PUBLISHING — THE MEETUP EMAIL NAMES THEM', on: t => `${String(t).toUpperCase()} IS LIVE — MEMBERS CAN JOIN NOW`, off: 'BACK TO DRAFT — OFF THE MEMBER PAGE' },
    cancelM: {
      eyebrow: 'CANCEL THIS MEETUP', title: t => `Cancel “${t}”?`,
      warn: 'This emails EVERY person holding a place and everyone on the waitlist, at once. There is no undo.',
      reason: 'WHY (goes into the email — optional)', reasonPh: 'The host had to travel — we are sorry.',
      notify: 'Email everyone', go: 'CANCEL THE MEETUP', keep: 'KEEP IT',
      done: n => n ? `MEETUP CANCELLED — ${n} PERSON${n === 1 ? '' : 'S'} EMAILED` : 'MEETUP CANCELLED'
    },
    del: { ask: t => `Delete the draft “${t}”? Nothing was published and nobody holds a place.`, ok: 'DELETE', keep: 'KEEP', done: 'DRAFT DELETED' },
    locked: 'Meetups are locked for you.',
    lockedWhy: 'Plexus Meetups needs access — ask Alen, he grants it per section.'
  }
};
const FIG_KEYS = ['registered', 'gala_paid', 'speakers_confirmed', 'days_to_go'];

// ---- v2 2026-09-11: tabs. `/projects/plexus/:tab?` still takes speakers|schedule|qa — those are
// LIVE deep links (chrome PALETTE, facts.js SECTION_ROUTES, eventday.js) that pre-open an inline
// hub panel, so they map to the hub tab and set openPanel exactly as before.
const PANEL_SLUGS = ['speakers', 'schedule', 'qa'];
const SLUG_TO_TAB = { '': 'hub', meetups: 'meetups', speakers: 'hub', schedule: 'hub', qa: 'hub' };
const TAB_TO_SLUG = { hub: '', meetups: 'meetups' };
const TAB_ORDER = ['hub', 'meetups'];
const MEET_SECTION = 'plexus-meetups';
const CAP_MIN = 1, CAP_MAX = 60;

// ---- shared inline vocabulary (same values the other screens use; look stays inline) ----
const HAIR = 'rgba(32,27,22,.14)', HAIR12 = 'rgba(32,27,22,.12)', HAIR08 = 'rgba(32,27,22,.08)', HAIR07 = 'rgba(32,27,22,.07)';
const MICRO = 'font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#6d6459';
const BTN_GHOST = 'padding:7px 11px;border:1px solid rgba(32,27,22,.2);font:600 9px Inter,sans-serif;letter-spacing:.12em;cursor:pointer;color:#201b16;white-space:nowrap';
const INPUT = 'border:1px solid rgba(32,27,22,.25);background:#fff;padding:8px 10px;font:400 12.5px Inter,sans-serif;color:#201b16';
const INPUT2 = 'border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:8px 10px;font:400 12.5px Inter,sans-serif;color:#201b16';

// table helpers — the js/views/money.js vocabulary, verbatim
function tblWrap(headers, bodyRows, minWidth) {
  return `
    <div class="mxp-scroll" style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;min-width:${minWidth || 900}px">
        <thead><tr>${headers.map(h => `<th style="text-align:${h.r ? 'right' : 'left'};padding:9px 10px;${MICRO};border-bottom:1px solid ${HAIR12};white-space:nowrap">${h.t}</th>`).join('')}</tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>`;
}
const td = (v, extra) => `<td style="font-size:12.5px;padding:9px 10px;border-bottom:1px solid ${HAIR07};vertical-align:top;${extra || ''}">${v}</td>`;
const tdNum = v => td(`<span style="font-family:Fraunces,serif;font-size:14px;white-space:nowrap">${v}</span>`, 'text-align:right');
const tdActs = acts => td(`<span style="display:flex;gap:6px;justify-content:flex-end">${acts}</span>`, 'text-align:right;white-space:nowrap');
const actBtn = (act, id, label, title) => `<span data-act="${act}" data-id="${esc(id)}"${title ? ` title="${esc(title)}"` : ''} style="${BTN_GHOST}" data-hover="border-color:#201b16">${label}</span>`;

// authed CSV download — the js/views/money.js fetchBlob/dl pair
async function fetchBlob(path) {
  const res = await fetch(api.url(path), { headers: { Authorization: 'Bearer ' + session.token } });
  if (!res.ok) { let j = null; try { j = JSON.parse(await res.text()); } catch (e) {} throw new Error((j && (j.message || j.error)) || ('The export failed (HTTP ' + res.status + ').')); }
  return res.blob();
}
const dl = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };

// ---- view state ----
let D = null, st = null, unbind = null, rootEl = null, onChangeBound = null, onInputBound = null;
let hostTimer = null;

function injectCss() {
  if (!document.querySelector('link[data-mxp-css]')) {
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = '/css/views/plexus-hub.css'; l.setAttribute('data-mxp-css', '1');
    document.head.appendChild(l);
  }
}

// ---------------------------------------------------------------- data
// The hub tab reads the whole week; the MEETUPS tab reads only what its own screen prints, so
// switching tabs never fires twenty calls for blocks that are not on screen. Both need the
// conference row (title facts), the member status label and the edition list (switcher + H1 year).
async function load(tab, editionId) {
  const want = {
    conf: api.get('/api/conferences/active', { noAuth: true }),
    pstatus: api.get('/api/admin/project-status'),
    eds: api.get('/api/v2/plexus-hub/editions')
  };
  if (tab === 'meetups') {
    if (perms.can(MEET_SECTION)) want.meet = api.get('/api/v2/meetups-ops/overview' + (editionId ? '?edition=' + encodeURIComponent(editionId) : ''));
    return shape(await api.settle(want));
  }
  Object.assign(want, {
    summary: api.get('/api/dashboard/summary'),
    pstats: api.get('/api/dashboard/portal-stats'),
    gala: api.get('/api/admin/gala/registrations'),
    gs: api.get('/api/admin/gala/settings'),
    galaOps: api.get('/api/v2/gala-ops/summary'),   // UXFIX closing: ONE truth for the gala tallies (seats incl. plus-ones)
    sessions: api.get('/api/admin/plexus/sessions'),
    speakers: api.get('/api/admin/plexus/speakers'),
    meta: api.get('/api/v2/plexus-hub/speaker-meta'),
    forms: api.get('/api/admin/signup-forms'),
    cme: api.get('/api/admin/cme/events'),
    qa: api.get('/api/admin/plexus/qa'),
    editions: api.get('/api/admin/editions'),
    pe: api.get('/api/admin/post-event/summary?event_key=plexus'),
    cal: api.get('/api/admin/year-calendar'),
    outbox: api.get('/api/admin/outbox?status=pending_approval'),
    itins: api.get('/api/admin/speaker-itineraries'),
    links: api.get('/api/admin/registration-links'),
    waitlist: api.get('/api/admin/waitlist'),
    croat: api.get('/api/admin/croatians-abroad/registrations'),
    ov: api.get('/api/v2/plexus-hub/stats-overrides?scope=' + STATS_SCOPE)
  });
  return shape(await api.settle(want));
}
function shape(r) {
  const conf = r.conf || {};
  // Local fallback walk — same inactive list as gala-ops.js (declined/expired excluded too, audit #1)
  const galaRows = (Array.isArray(r.gala) ? r.gala : []).filter(g => !['rejected', 'cancelled', 'declined', 'expired'].includes(String(g.status || '').toLowerCase()));
  const paid = galaRows.filter(g => g.payment_status === 'paid');
  const galaOps = r.galaOps && r.galaOps.seats && r.galaOps.eur ? r.galaOps : null;
  const gs = r.gs || {};
  const ebDeadline = (gs.early_bird_deadline || FACTS.gala.priceFlip).slice(0, 10);
  const cmeList = Array.isArray(r.cme) ? r.cme : [];
  return {
    errors: r.$errors, conf,
    cap: Number(conf.max_capacity) || FACTS.plexus.cap,
    regs: r.summary ? Number(r.summary.plexus.registrations || 0) : (r.pstats ? Number(r.pstats.plexus.registrations || 0) : null),
    revenue: r.pstats && r.pstats.plexus ? Number(r.pstats.plexus.revenue || 0) : 0,
    gala: {
      rows: galaRows, paid, toChase: galaRows.filter(g => g.payment_status !== 'paid'),
      ops: galaOps,
      settings: gs, price: galaPriceNow(gs), early: Number(gs.price_gala_early_bird) || FACTS.gala.priceEarly,
      regular: Number(gs.price_gala_regular) || FACTS.gala.priceRegular,
      ebDeadline, ebDays: fmt.daysUntil(ebDeadline),
      collected: paid.reduce((n, g) => n + (Number(g.amount_paid) || 0), 0)
    },
    sessions: Array.isArray(r.sessions) ? r.sessions : [],
    speakers: Array.isArray(r.speakers) ? r.speakers : [],
    meta: (r.meta && r.meta.meta) || {},
    forms: Array.isArray(r.forms) ? r.forms : [],
    cme: cmeList.find(c => c.conference_id === conf.id) || cmeList.find(c => c.is_active) || null,
    qa: Array.isArray(r.qa) ? r.qa : [],
    editions: ((r.editions && r.editions.projects) || []).find(p => p.project === 'plexus') || { editions: [] },
    pe: r.pe || null,
    pstatus: (Array.isArray(r.pstatus) ? r.pstatus : []).find(p => p.project_key === 'plexus') || null,
    cal: Array.isArray(r.cal) ? r.cal : [],
    outbox: (r.outbox && Array.isArray(r.outbox.batches)) ? r.outbox.batches : [],
    itins: Array.isArray(r.itins) ? r.itins.length : ((r.itins && Array.isArray(r.itins.itineraries)) ? r.itins.itineraries.length : 0),
    links: (Array.isArray(r.links) ? r.links : ((r.links && r.links.links) || [])).filter(l => Number(l.is_active == null ? 1 : l.is_active)).length,
    waitn: (Array.isArray(r.waitlist) ? r.waitlist : []).filter(w => (w.status || 'waiting') === 'waiting').length,
    croat: Array.isArray(r.croat) ? r.croat.length : 0,
    overrides: (r.ov && r.ov.overrides) || {},
    days: Math.max(0, fmt.daysUntil(conf.start_date || FACTS.plexus.start) || 0),
    // v2 2026-09-11 — edition switcher + MEETUPS tab
    eds: (r.eds && Array.isArray(r.eds.editions)) ? r.eds.editions : [],
    edActive: (r.eds && r.eds.active) || null,
    meet: r.meet || null
  };
}

// ---------------------------------------------------------------- derived
const spConfirmed = () => D.speakers.filter(s => String(s.confirmation_status || '') === 'confirmed');
const spLive = () => D.speakers.filter(s => Number(s.is_confirmed) && Number(s.is_published));
const ssPublished = () => D.sessions.filter(s => Number(s.is_published));
const qaOpen = () => D.qa.filter(x => !x.is_answered && !x.is_hidden);
const isLocked = key => !!(D.errors[key] && D.errors[key].isLocked);

// ---- v2 2026-09-11: editions + tabs -------------------------------------------------------------
const activeEdId = () => (D.edActive && D.edActive.id) || null;
function chosenEd() {
  if (!D.eds.length) return D.edActive || null;
  return D.eds.find(e => e.id === st.editionId) || D.edActive || D.eds[0];
}
const edYear = () => { const e = chosenEd(); return e && e.year ? String(e.year) : String(FACTS.year); };
const isArchived = () => { const e = chosenEd(); return !!(e && e.status === 'archived'); };
// the query rides along only when the chosen edition is NOT the active one — the everyday URL stays clean
const edQ = (id) => { const v = id === undefined ? (st.editionId || null) : id; return v && v !== activeEdId() ? '?edition=' + encodeURIComponent(v) : ''; };
const tabPath = (tab) => '/projects/plexus' + (TAB_TO_SLUG[tab] ? '/' + TAB_TO_SLUG[tab] : '');
const hrefTab = (tab) => tabPath(tab) + edQ();
const hrefEd = (id) => tabPath(st.tab) + edQ(id);

// ---- v2 2026-09-11: meetups ---------------------------------------------------------------------
const canMeet = () => perms.can(MEET_SECTION);
const meetRows = () => (D.meet && Array.isArray(D.meet.meetups)) ? D.meet.meetups : [];
const meetStats = () => (D.meet && D.meet.stats) || { meetups: 0, published: 0, drafts: 0, cancelled: 0, seats: 0, taken: 0, seats_left: 0, fill_percent: 0, waitlisted: 0, hosts: 0 };
const meetKinds = () => (D.meet && Array.isArray(D.meet.kinds) && D.meet.kinds.length) ? D.meet.kinds : ['coffee', 'lunch', 'dinner', 'walk', 'visit', 'other'];
const meetById = (id) => meetRows().find(m => String(m.id) === String(id)) || null;
// the meetups payload is edition-scoped server-side too; read_only mirrors the chosen edition
const meetReadOnly = () => !!(D.meet && D.meet.read_only) || isArchived();

function euRange(a, b) {
  const da = fmt.toDate(a), db = fmt.toDate(b);
  if (!da) return FACTS.plexus.dateRange;
  if (!db || da.getTime() === db.getTime()) return `${da.getDate()} ${MONTHS_EN[da.getMonth()]}`;
  if (da.getMonth() === db.getMonth()) return `${da.getDate()}–${db.getDate()} ${MONTHS_EN[da.getMonth()]}`;
  return `${da.getDate()} ${MONTHS_EN[da.getMonth()]} – ${db.getDate()} ${MONTHS_EN[db.getMonth()]}`;
}
function afterLabel() { // 'Dec 6' — the day after the last conference day
  const end = fmt.toDate(D.conf.end_date || FACTS.plexus.end);
  if (!end) return 'the week';
  return fmt.dayShort(new Date(end.getTime() + 86400000));
}
const weekOver = () => (fmt.daysUntil(D.conf.end_date || FACTS.plexus.end) || 0) < 0;
function figLive() {
  return { registered: D.regs == null ? '—' : String(D.regs), gala_paid: String(D.gala.ops ? D.gala.ops.seats.paid : D.gala.paid.length), speakers_confirmed: String(spConfirmed().length), days_to_go: String(D.days) };
}
function figEffective() {
  const live = figLive(); const out = {};
  FIG_KEYS.forEach(k => { out[k] = D.overrides[k] ? String(D.overrides[k].value) : live[k]; });
  return out;
}
function statsLine() {
  const f = figEffective();
  return COPY.widget.line({ ...f, cap: D.cap, range: fmt.longRange(D.conf.start_date || FACTS.plexus.start, D.conf.end_date || FACTS.plexus.end), venue: D.conf.venue_name || FACTS.plexus.venue, city: D.conf.venue_city || FACTS.plexus.city });
}
function keyDates() {
  const out = [];
  const add = (d, label, text, color) => { const dd = String(d || '').slice(0, 10); if (!dd) return; const n = fmt.daysUntil(dd); if (n == null || n < 0) return; out.push({ d: dd, label, text, color: color || (n <= 7 ? '#9b1b22' : '#c9a962') }); };
  if (D.gala.ebDays != null && D.gala.ebDays >= 0) add(D.gala.ebDeadline, fmt.dayLabel(D.gala.ebDeadline), COPY.dates.earlyBird(fmt.eur(D.gala.regular)));
  D.cal.forEach(e => { if (!e.starts_on || /early[- ]bird/i.test(e.title || '')) return; add(e.starts_on, fmt.rangeLabel(e.starts_on, e.ends_on), e.title); });
  add(D.conf.start_date || FACTS.plexus.start, fmt.dayLabel(D.conf.start_date || FACTS.plexus.start), COPY.dates.dayOne, '#9b1b22');
  add(D.conf.end_date || FACTS.plexus.end, fmt.dayLabel(D.conf.end_date || FACTS.plexus.end), COPY.dates.dayTwo, '#9b1b22');
  return out.sort((a, b) => a.d.localeCompare(b.d)).slice(0, 4);
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; }
  catch (e) {
    try { const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); return true; }
    catch (e2) { return false; }
  }
}

// ---------------------------------------------------------------- blocks
function blockSubnav() {
  const t = COPY.subnav;
  return `
  <!-- dc: Admin Plexus Hub.dc.html › "Hub sub-nav" -->
  <div style="background:#fff;border-bottom:1px solid rgba(32,27,22,.14)">
    <div class="mx-subnav mx-gutter" style="max-width:1180px;margin:0 auto;padding:0 28px;display:flex;gap:24px;align-items:center;height:44px">
      <a href="/today" style="font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#9a9086" data-hover="color:#201b16">${t.projects}</a>
      <span style="font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#201b16;border-bottom:2px solid #9b1b22;padding:15px 0 13px">${t.self}</span>
      <a href="/projects/accelerator" style="font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#9a9086" data-hover="color:#201b16">${t.accelerator}</a>
      <a href="/projects/forum" style="font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#9a9086" data-hover="color:#201b16">${t.forum}</a>
      <a href="/projects/bridges" style="font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#9a9086" data-hover="color:#201b16">${t.bridges}</a>
    </div>
  </div>
  <!-- /dc -->`;
}
function blockTitle() {
  const h = COPY.head;
  const live = D.pstatus && D.pstatus.status_label;
  const ro = isArchived();
  return `
    <!-- dc: Admin Plexus Hub.dc.html › "Title row" -->
    <div data-block="title" style="display:flex;align-items:flex-end;justify-content:space-between;gap:20px;flex-wrap:wrap">
      <div style="min-width:0">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <span class="mx-display-34" style="font-family:Fraunces,serif;font-size:34px;white-space:nowrap">Plexus Week <i>${esc(edYear())}</i></span>
          ${edChip()}
          <span data-act="msFocus" title="${esc(h.liveTitle)}" style="background:${live ? '#1e6e42' : '#b07d10'};color:#fff;font:600 9px Inter,sans-serif;letter-spacing:.14em;padding:4px 8px;cursor:pointer">${live ? h.live : h.hidden}</span>
          ${ro ? `<span data-v2="read-only edition" style="background:#6d6459;color:#fff;font:600 9px Inter,sans-serif;letter-spacing:.14em;padding:4px 8px">${COPY.ed.roTag}</span>` : ''}
        </div>
        <div style="font-size:13px;color:#6d6459;margin-top:6px;display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">
          <span>${esc(h.facts(D.cap, euRange(D.conf.start_date || FACTS.plexus.start, D.conf.end_date || FACTS.plexus.end), D.conf.venue_name || FACTS.plexus.venue, D.conf.venue_city || FACTS.plexus.city))}</span>
          ${ro ? '' : `<span data-act="editConf" title="${esc(h.editTitle)}" style="font:600 9px Inter,sans-serif;letter-spacing:.13em;color:#9b1b22;cursor:pointer;white-space:nowrap" data-hover="color:#201b16">${h.edit}</span>`}
        </div>
      </div>
      <div class="mxp-title-actions" style="display:flex;gap:10px;flex-wrap:wrap">
        <a href="/member-pages/plexus" style="border:2px solid #9b1b22;background:#fff;color:#9b1b22;font:600 10px Inter,sans-serif;letter-spacing:.14em;padding:10px 16px;white-space:nowrap" data-hover="background:#9b1b22;color:#fff">${h.manage}</a>
        <a href="/event-day" style="background:#201b16;color:#f6f2ea;font:600 10px Inter,sans-serif;letter-spacing:.14em;padding:11px 16px;white-space:nowrap" data-hover="background:#9b1b22">${h.eventday}</a>
      </div>
    </div>
    <!-- /dc -->
    ${blockEditions()}
    ${ro ? `
    <!-- v2: archived edition banner -->
    <div data-v2="read-only banner" style="border:1px solid ${HAIR};border-left:3px solid #6d6459;background:#fdfbf6;padding:11px 18px;margin-top:14px;display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">
      <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.14em;color:#6d6459;white-space:nowrap">${esc(COPY.ed.roLine(edYear()))}</span>
      <span style="font-size:12px;color:#9a9086">${COPY.ed.roWhy}</span>
    </div>
    <!-- /v2 -->` : ''}`;
}
// The edition switcher chip — the eventday.js bridges EDITION chip idiom, one level up: the chip
// prints the chosen year, clicking it opens the chip row of every edition on file (blockEditions).
function edChip() {
  return `<span data-act="edToggle" data-v2="edition switcher" role="button" aria-expanded="${!!st.edOpen}" title="${esc(COPY.ed.title)}" style="padding:5px 10px;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;border:1px solid ${st.edOpen ? '#201b16' : 'rgba(32,27,22,.25)'};background:${st.edOpen ? '#201b16' : 'transparent'};color:${st.edOpen ? '#f6f2ea' : '#6d6459'};white-space:nowrap" data-hover="border-color:#201b16">${esc(edYear())} ${st.edOpen ? '▴' : '▾'}</span>`;
}
function blockEditions() {
  if (!st.edOpen) return `<div data-block="edPicker"></div>`;
  const tone = { active: ['#1e6e42', '#fff'], upcoming: ['#f8f1e2', '#7a6432'], archived: ['transparent', '#6d6459'] };
  return `
    <!-- v2: "EDITION" chip row (design/MEETUPS-SPEC.md §1 — archived editions open read-only) -->
    <div data-block="edPicker" class="mxp-edrow" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:12px">
      <span style="font:600 9px Inter,sans-serif;letter-spacing:.16em;color:#6d6459">${COPY.ed.label}</span>
      ${D.eds.length ? D.eds.map(e => {
        const on = chosenEd() && chosenEd().id === e.id;
        const [bg, fg] = tone[e.status] || tone.upcoming;
        return `<a href="${esc(hrefEd(e.id))}" role="tab" aria-selected="${on}" style="padding:6px 11px;font:600 9px Inter,sans-serif;letter-spacing:.12em;border:1px solid ${on ? '#201b16' : 'rgba(32,27,22,.25)'};background:${on ? '#201b16' : bg};color:${on ? '#f6f2ea' : fg};white-space:nowrap" data-hover="border-color:#201b16">${esc(e.label || ('Plexus Week ' + e.year))} · ${esc(COPY.ed.status[e.status] || String(e.status || '').toUpperCase())}${e.starts_on ? ' · ' + esc(fmt.rangeLabel(e.starts_on, e.ends_on)) : ''}</a>`;
      }).join('') : `<span style="font-size:12px;color:#6d6459;font-style:italic">${COPY.ed.none}</span>`}
    </div>
    <!-- /v2 -->`;
}
function blockTabs() {
  const meetLocked = !canMeet();
  return `
    <!-- v2: hub tab strip — /projects/plexus (the week) · /projects/plexus/meetups -->
    <div data-block="tabs" class="mxp-tabs" data-v2="tab strip" style="display:flex;gap:0;border-bottom:1px solid rgba(32,27,22,.18);margin-top:20px">
      ${TAB_ORDER.map(id => {
        const on = st.tab === id;
        const locked = id === 'meetups' && meetLocked;
        const tip = locked ? ` title="${esc(COPY.meet.lockedWhy)}"` : '';
        return `<a href="${esc(hrefTab(id))}"${tip} style="padding:10px 16px;font:600 10.5px Inter,sans-serif;letter-spacing:.14em;cursor:pointer;color:${on ? '#201b16' : '#6d6459'};${locked ? 'opacity:.5;' : ''}border-bottom:${on ? '2px solid #9b1b22' : '2px solid transparent'};margin-bottom:-1px;display:flex;align-items:center;gap:7px;white-space:nowrap" data-hover="color:#201b16">${locked ? COPY.tabs.meetupsLocked : COPY.tabs[id]}</a>`;
      }).join('\n      ')}
    </div>
    <!-- /v2 -->`;
}
function blockStats() {
  const s = COPY.stats;
  const galaLocked = isLocked('gala');
  const ops = D.gala.ops;
  const collected = galaLocked ? null : (ops ? ops.eur.collected : D.gala.collected) + D.revenue;
  const live = spLive().length;
  const cell = (inner, href, act) => href
    ? `<a href="${href}" style="padding:16px 20px;border-right:1px solid rgba(32,27,22,.1);color:#201b16;display:block" data-hover="background:#fdfbf6;color:#201b16">${inner}</a>`
    : act
      ? `<span data-act="${act}" style="padding:16px 20px;border-right:1px solid rgba(32,27,22,.1);color:#201b16;display:block;cursor:pointer" data-hover="background:#fdfbf6;color:#201b16">${inner}</span>`
      : `<div style="padding:16px 20px;border-right:1px solid rgba(32,27,22,.1)">${inner}</div>`;
  const kd = keyDates();
  return `
    <!-- dc: Admin Plexus Hub.dc.html › "Stat strip + key dates" -->
    <div data-block="stats" style="border:1px solid rgba(32,27,22,.14);background:#fff;margin-top:22px">
      <div class="mx-kpi" style="display:grid;grid-template-columns:repeat(5,1fr)">
        ${cell(`
          <div style="font:600 9px Inter,sans-serif;letter-spacing:.15em;color:#6d6459">${s.days}</div>
          <div class="mx-display-30" style="font-family:Fraunces,serif;font-size:30px;margin-top:3px">${D.days}</div>
          <div style="font-size:11px;color:#6d6459">${esc(fmt.rangeLabel(D.conf.start_date || FACTS.plexus.start, D.conf.end_date || FACTS.plexus.end))} · ${esc(D.conf.venue_city || FACTS.plexus.city)}</div>`)}
        ${cell(`
          <div style="font:600 9px Inter,sans-serif;letter-spacing:.15em;color:#6d6459">${s.reg}</div>
          <div class="mx-display-30" style="font-family:Fraunces,serif;font-size:30px;margin-top:3px">${D.regs == null ? '—' : esc(fmt.num(D.regs))}</div>
          <div style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#9b1b22">${esc(s.regSub(D.cap))}</div>`, '/registrations')}
        ${cell(`
          <div style="font:600 9px Inter,sans-serif;letter-spacing:.15em;color:#6d6459">${ops ? s.gala : s.galaFallback}</div>
          <div class="mx-display-30" style="font-family:Fraunces,serif;font-size:30px;margin-top:3px">${galaLocked ? '—' : (ops ? ops.seats.reserved : D.gala.rows.length)}</div>
          <div style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#9b1b22">${galaLocked ? esc(COPY.locked('plexus')) : esc(ops ? s.galaSub(ops.seats.paid, ops.seats.chase) : s.galaSub(D.gala.paid.length, D.gala.toChase.length))}</div>`, '/gala')}
        ${cell(`
          <div style="font:600 9px Inter,sans-serif;letter-spacing:.15em;color:#6d6459">${s.speakers}</div>
          <div class="mx-display-30" style="font-family:Fraunces,serif;font-size:30px;margin-top:3px">${D.speakers.length}</div>
          <div style="font-size:11px;color:${spLive().length ? '#6d6459' : '#9b1b22'}">${live ? esc(s.speakersLive(live)) : s.speakersDraft}</div>`, null, 'openSpeakers')}
        <a href="/money" style="padding:16px 20px;color:#201b16;display:block" data-hover="background:#fdfbf6;color:#201b16">
          <div style="font:600 9px Inter,sans-serif;letter-spacing:.15em;color:#6d6459">${s.money}</div>
          <div class="mx-display-30" style="font-family:Fraunces,serif;font-size:30px;margin-top:3px">${collected == null ? '—' : esc(fmt.eur(collected))}</div>
          <div style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#9b1b22">${s.moneySub}</div>
        </a>
      </div>
      <div class="mxp-dates" style="display:grid;grid-template-columns:repeat(4,1fr) auto;border-top:1px solid rgba(32,27,22,.1)">
        ${kd.map(r => `
        <div style="padding:10px 20px;display:flex;flex-direction:column;gap:2px;border-right:1px solid rgba(32,27,22,.08)">
          <span style="display:flex;align-items:center;gap:7px"><span style="width:7px;height:7px;background:${r.color};flex:none"></span><span style="font:600 9.5px Inter,sans-serif;letter-spacing:.12em">${esc(r.label)}</span></span>
          <span style="font-size:12px;color:#4a4239;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(fmt.detail(r.text))}</span>
        </div>`).join('')}
        <a href="/calendar" style="display:flex;align-items:center;padding:0 20px;border-left:1px solid rgba(32,27,22,.08);font:600 9px Inter,sans-serif;letter-spacing:.14em;white-space:nowrap">${COPY.stats.calendar}</a>
      </div>
    </div>
    <!-- /dc -->`;
}

// ---- BEFORE THE WEEK rows + inline manage panels -------------------------------------------------
function rowNav(r) { // the artboard's row: whole row is the door
  return `
          <a href="${esc(r.href)}" class="mx-row" data-row="${esc(r.id)}" style="display:flex;align-items:center;gap:14px;padding:10px 20px;border-bottom:1px solid rgba(32,27,22,.08);color:#201b16" data-hover="background:#fdfbf6">
            <span style="width:92px;flex:none;font:600 9px Inter,sans-serif;letter-spacing:.12em;color:${r.tagColor}">${esc(r.tag)}</span>
            <span class="mx-row-text" style="flex:1;min-width:0;display:flex;align-items:baseline;gap:10px;flex-wrap:wrap"><span style="font-size:13.5px;font-weight:600;white-space:nowrap">${esc(r.name)}</span><span style="font-size:12px;color:#6d6459;min-width:0">${esc(r.status)}</span></span>
            ${r.extra || ''}
            <span style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:#9b1b22;white-space:nowrap">${esc(r.action)} →</span>
          </a>`;
}
function rowAct(r) { // same look, opens an inline panel instead of navigating
  return `
          <span data-act="${esc(r.act)}" class="mx-row" data-row="${esc(r.id)}" style="display:flex;align-items:center;gap:14px;padding:10px 20px;border-bottom:1px solid rgba(32,27,22,.08);color:#201b16;cursor:pointer;text-align:left" data-hover="background:#fdfbf6">
            <span style="width:92px;flex:none;font:600 9px Inter,sans-serif;letter-spacing:.12em;color:${r.tagColor}">${esc(r.tag)}</span>
            <span class="mx-row-text" style="flex:1;min-width:0;display:flex;align-items:baseline;gap:10px;flex-wrap:wrap"><span style="font-size:13.5px;font-weight:600;white-space:nowrap">${esc(r.name)}</span><span style="font-size:12px;color:#6d6459;min-width:0">${esc(r.status)}</span></span>
            <span style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:#9b1b22;white-space:nowrap">${esc(r.action)} ${st.openPanel === r.panel ? '↑' : '→'}</span>
          </span>`;
}
function lockedRow(id, name, sec) {
  return `<div class="mx-row" data-row="${esc(id)}" style="display:flex;align-items:center;gap:14px;padding:10px 20px;border-bottom:1px solid rgba(32,27,22,.08)"><span style="width:92px;flex:none;font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#9a9086">LOCKED</span><span style="flex:1;font-size:12.5px;color:#6d6459"><b style="font-size:13.5px;color:#201b16">${esc(name)}</b> · ${esc(COPY.locked(sec))}</span></div>`;
}

function panelSpeakers() {
  const c = COPY.sp;
  const d = st.spDraft;
  const editing = !!st.spEdit;
  const opt = (v, l) => `<option value="${esc(v)}"${d.event_tag === v ? ' selected' : ''}>${esc(l)}</option>`;
  return `
        <div class="mxp-panel" data-block="spPanel">
          <div class="mxp-form" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:14px 20px 4px">
            <input data-role="spName" value="${esc(d.name)}" placeholder="${esc(c.name)}" aria-label="${esc(c.name)}" style="flex:1;min-width:150px">
            <input data-role="spTitle" value="${esc(d.title)}" placeholder="${esc(c.role)}" aria-label="${esc(c.role)}" style="width:150px">
            <input data-role="spInst" value="${esc(d.institution)}" placeholder="${esc(c.inst)}" aria-label="${esc(c.inst)}" style="width:170px">
            <input data-role="spEmail" value="${esc(d.email)}" placeholder="${esc(c.email)}" aria-label="${esc(c.email)}" style="width:150px">
          </div>
          <div class="mxp-form" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 20px 14px">
            <input data-role="spTalk" value="${esc(d.talk_title)}" placeholder="${esc(c.talk)}" aria-label="${esc(c.talk)}" style="flex:1;min-width:160px">
            <input data-role="spLogo" value="${esc(d.logo)}" placeholder="${esc(c.logo)}" aria-label="${esc(c.logo)}" style="width:190px">
            <select data-role="spTag" aria-label="${esc(c.tag)}">${c.tagOpts.map(([v, l]) => opt(v, l)).join('')}</select>
            <label style="display:flex;gap:6px;align-items:center;font-size:12px;color:#4a4239;cursor:pointer"><input type="checkbox" data-role="spKeynote"${d.is_keynote ? ' checked' : ''}> ${c.keynote}</label>
            ${editing ? `<span data-act="spUpload" title="${esc(c.photoTitle)}" class="btn-ghost" style="padding:8px 12px;font:600 9px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap">${c.photo}</span><input type="file" accept="image/*" data-role="spPhotoFile" style="display:none">` : ''}
            <span data-act="spSave" class="btn-primary" style="padding:9px 14px;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap">${editing ? c.saveTitle : c.addTitle}</span>
            ${editing ? `<span data-act="spCancel" style="font:600 9px Inter,sans-serif;letter-spacing:.13em;color:#6d6459;cursor:pointer;white-space:nowrap" data-hover="color:#201b16">${c.cancel}</span>` : ''}
          </div>
          ${D.speakers.map(sp => {
            const confirmed = String(sp.confirmation_status || '') === 'confirmed';
            const live = Number(sp.is_confirmed) && Number(sp.is_published);
            const meta = D.meta[sp.id] || {};
            return `
          <div data-row="sp-${esc(sp.id)}" style="display:flex;align-items:center;gap:12px;padding:9px 20px;border-top:1px solid rgba(32,27,22,.07)">
            ${sp.photo_url ? `<img src="${esc(sp.photo_url)}" alt="" style="width:26px;height:26px;object-fit:cover;flex:none">` : `<span style="width:26px;height:26px;background:#f6f2ea;border:1px solid rgba(32,27,22,.14);flex:none;display:inline-flex;align-items:center;justify-content:center;font:600 10px Inter,sans-serif;color:#9a9086">${esc(fmt.initials(sp.name))}</span>`}
            <span style="flex:1;min-width:0"><span style="display:block;font-size:13px;font-weight:600">${esc(sp.name)}${Number(sp.is_keynote) ? ` <span class="tag tag-gold">KEYNOTE</span>` : ''}${meta.event_tag ? ` <span class="tag">${esc(String(meta.event_tag).toUpperCase())}</span>` : ''}</span><span style="display:block;font-size:11.5px;color:#6d6459;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc([sp.title, sp.institution].filter(Boolean).join(' · ') || '—')}</span></span>
            <span data-act="spConfirm" data-id="${esc(sp.id)}" title="${esc(c.confirmedTitle)}" style="font:600 8.5px Inter,sans-serif;letter-spacing:.11em;padding:3px 7px;cursor:pointer;background:${confirmed ? '#1e6e42' : '#f8f1e2'};color:${confirmed ? '#fff' : '#7a6432'};white-space:nowrap">${confirmed ? c.confirmed : c.pending}</span>
            <span data-act="spLive" data-id="${esc(sp.id)}" title="${esc(c.confirmedTitle)}" style="font:600 8.5px Inter,sans-serif;letter-spacing:.11em;padding:3px 7px;cursor:pointer;background:${live ? '#201b16' : '#f6f2ea'};color:${live ? '#f6f2ea' : '#9a9086'};border:1px solid rgba(32,27,22,.14);white-space:nowrap">${live ? c.live : c.hiddenTag}</span>
            <span data-act="spEditBtn" data-id="${esc(sp.id)}" style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#9b1b22;cursor:pointer;white-space:nowrap" data-hover="color:#201b16">${c.edit}</span>
            <span data-act="spDel" data-id="${esc(sp.id)}" style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#6d6459;cursor:pointer;white-space:nowrap" data-hover="color:#9b1b22">${c.del}</span>
          </div>`; }).join('')}
          ${!D.speakers.length ? `<div style="padding:6px 20px 16px;font-size:12.5px;color:#6d6459;font-style:italic">${c.empty}</div>` : '<div style="height:8px"></div>'}
        </div>`;
}
function panelSchedule() {
  const c = COPY.ss;
  const d = st.ssDraft;
  const editing = !!st.ssEdit;
  const drafts = D.sessions.length - ssPublished().length;
  return `
        <div class="mxp-panel" data-block="ssPanel">
          <div class="mxp-form" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:14px 20px">
            <input data-role="ssTitle" value="${esc(d.title)}" placeholder="${esc(c.title)}" aria-label="${esc(c.title)}" style="flex:1;min-width:170px">
            <select data-role="ssDay" aria-label="Day">${[1, 2].map(n => `<option value="${n}"${Number(d.day) === n ? ' selected' : ''}>${esc(c.day(n))} · ${esc(fmt.dayShort(new Date((fmt.toDate(D.conf.start_date || FACTS.plexus.start) || new Date()).getTime() + (n - 1) * 86400000)))}</option>`).join('')}</select>
            <input data-role="ssStart" value="${esc(d.start_time)}" placeholder="09:00" aria-label="${esc(c.start)}" style="width:64px">
            <input data-role="ssEnd" value="${esc(d.end_time)}" placeholder="09:45" aria-label="${esc(c.end)}" style="width:64px">
            <input data-role="ssRoom" value="${esc(d.room)}" placeholder="${esc(c.room)}" aria-label="${esc(c.room)}" style="width:110px">
            <select data-role="ssType" aria-label="${esc(c.type)}">${SESSION_TYPES.map(t => `<option value="${t}"${d.session_type === t ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>
            <label style="display:flex;gap:6px;align-items:center;font-size:12px;color:#4a4239;cursor:pointer"><input type="checkbox" data-role="ssPub"${d.is_published ? ' checked' : ''}> ${c.publishNow}</label>
            <span data-act="ssSave" class="btn-primary" style="padding:9px 14px;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap">${editing ? c.saveTitle : c.addTitle}</span>
            ${editing ? `<span data-act="ssCancel" style="font:600 9px Inter,sans-serif;letter-spacing:.13em;color:#6d6459;cursor:pointer;white-space:nowrap" data-hover="color:#201b16">${c.cancel}</span>` : ''}
            ${drafts > 0 ? `<span data-act="ssPubAll" class="btn-ghost" style="padding:8px 12px;font:600 9px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap">${c.pubAll} · ${drafts}</span>` : ''}
          </div>
          ${D.sessions.map(s => `
          <div data-row="ss-${esc(s.id)}" style="display:flex;align-items:center;gap:12px;padding:9px 20px;border-top:1px solid rgba(32,27,22,.07)">
            <span style="width:92px;flex:none;font:600 9px Inter,sans-serif;letter-spacing:.1em;color:#6d6459">DAY ${esc(String(s.day || 1))} · ${esc([s.start_time, s.end_time].filter(Boolean).join('–') || '—')}</span>
            <span style="flex:1;min-width:0"><span style="display:block;font-size:13px;font-weight:600">${esc(s.title)}</span><span style="display:block;font-size:11.5px;color:#6d6459">${esc([s.room, s.track, s.session_type !== 'talk' ? s.session_type : ''].filter(Boolean).join(' · ') || '—')}${s.speaker_names ? ' · ' + esc(s.speaker_names) : ''}</span></span>
            <span class="tag${Number(s.is_published) ? ' tag-live' : ''}">${Number(s.is_published) ? c.liveTag : c.draftTag}</span>
            <span data-act="ssPubOne" data-id="${esc(s.id)}" style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#9b1b22;cursor:pointer;white-space:nowrap" data-hover="color:#201b16">${Number(s.is_published) ? c.unpub : c.pub}</span>
            <span data-act="ssEditBtn" data-id="${esc(s.id)}" style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#9b1b22;cursor:pointer;white-space:nowrap" data-hover="color:#201b16">${c.edit}</span>
            <span data-act="ssDel" data-id="${esc(s.id)}" style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#6d6459;cursor:pointer;white-space:nowrap" data-hover="color:#9b1b22">${c.del}</span>
          </div>`).join('')}
          ${!D.sessions.length ? `<div style="padding:2px 20px 16px;font-size:12.5px;color:#6d6459;font-style:italic">${c.empty}</div>` : '<div style="height:8px"></div>'}
        </div>`;
}
function panelQa() {
  const c = COPY.qa;
  return `
        <div class="mxp-panel" data-block="qaPanel">
          ${D.qa.map(q => `
          <div data-row="qa-${esc(q.id)}" style="display:flex;align-items:flex-start;gap:12px;padding:11px 20px;border-top:1px solid rgba(32,27,22,.07);${q.is_hidden ? 'opacity:.55' : ''}">
            <span style="width:92px;flex:none;font:600 9px Inter,sans-serif;letter-spacing:.1em;color:${q.is_answered ? '#1e6e42' : '#9b1b22'};padding-top:2px">${q.is_answered ? c.answered : `▲ ${Number(q.upvotes) || 0}`}</span>
            <span style="flex:1;min-width:0"><span style="display:block;font-size:13px">${esc(q.text)}</span><span style="display:block;font-size:11.5px;color:#6d6459;margin-top:2px">${esc(q.is_from_admin ? c.admin : (q.author_name || '—') + ' · ' + c.from)}${q.answer_text ? ` — <i>${esc(q.answer_text)}</i>` : ''}</span></span>
            ${q.is_answered ? '' : `<span data-act="qaAnswer" data-id="${esc(q.id)}" style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#9b1b22;cursor:pointer;white-space:nowrap" data-hover="color:#201b16">${c.answer}</span>`}
            <span data-act="qaHide" data-id="${esc(q.id)}" data-hidden="${q.is_hidden ? 1 : 0}" style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#6d6459;cursor:pointer;white-space:nowrap" data-hover="color:#201b16">${q.is_hidden ? c.unhide : c.hide}</span>
          </div>`).join('')}
          ${!D.qa.length ? `<div style="padding:14px 20px;font-size:12.5px;color:#6d6459;font-style:italic">${c.empty}</div>` : '<div style="height:8px"></div>'}
        </div>`;
}

function blockBefore() {
  const c = COPY.before;
  const formsLocked = isLocked('forms');
  const cmeLocked = isLocked('cme');
  const regOpen = Number(D.conf.registration_open == null ? 1 : D.conf.registration_open);
  const confirmedN = spConfirmed().length;
  const pubN = ssPublished().length;
  const openQ = qaOpen().length;
  const formRow = f => `
          <div class="mx-row" data-row="form-${esc(f.id)}" style="display:flex;align-items:center;gap:14px;padding:10px 20px;border-bottom:1px solid rgba(32,27,22,.08)">
            <span style="width:92px;flex:none;font:600 9px Inter,sans-serif;letter-spacing:.12em;color:${f.status === 'open' ? '#1e6e42' : f.status === 'draft' ? '#b07d10' : '#6d6459'}">${esc(String(f.status || 'draft').toUpperCase())}</span>
            <span class="mx-row-text" style="flex:1;min-width:0;display:flex;align-items:baseline;gap:10px;flex-wrap:wrap"><span style="font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:340px">${esc(f.title)}</span><span style="font-size:12px;color:#6d6459;min-width:0">${esc(c.forms.status(Number(f.response_count) || 0, Number(f.waitlist_count) || 0, f.event_date ? fmt.dayShort(f.event_date) : ''))}</span></span>
            <span data-act="formToggle" data-id="${esc(f.id)}" data-status="${esc(f.status || 'draft')}" data-v2="open-close" style="font:600 9px Inter,sans-serif;letter-spacing:.13em;color:#6d6459;border:1px solid rgba(32,27,22,.2);padding:5px 9px;cursor:pointer;white-space:nowrap" data-hover="border-color:#201b16;color:#201b16">${f.status === 'open' ? c.forms.close : c.forms.open}</span>
            <a href="/links" style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:#9b1b22;white-space:nowrap">${c.forms.responses} →</a>
          </div>`;
  return `
    <!-- dc: Admin Plexus Hub.dc.html › "BEFORE THE WEEK" -->
    <div data-block="before" style="background:#fff;border:1px solid rgba(32,27,22,.14);margin-top:22px">
      <div style="padding:12px 20px;border-bottom:1px solid rgba(32,27,22,.1);display:flex;align-items:center;gap:10px"><span style="font:600 10px Inter,sans-serif;letter-spacing:.16em">${c.title}</span><span style="font-size:12px;color:#9a9086">${c.sub}</span><div style="flex:1"></div><span data-act="editList" title="${esc(c.editListTitle)}" style="font:600 8.5px Inter,sans-serif;letter-spacing:.13em;color:#6d6459;cursor:pointer" data-hover="color:#201b16">${c.editList}</span></div>
      ${rowNav({ id: 'regs', tag: regOpen ? c.regs.open : c.regs.closed, tagColor: regOpen ? '#1e6e42' : '#9b1b22', name: c.regs.name, status: c.regs.status(D.regs == null ? '—' : D.regs, D.cap), action: c.regs.action, href: '/registrations' })}
      ${formsLocked ? lockedRow('forms', c.forms.none, 'signup-forms')
        : D.forms.length ? D.forms.map(formRow).join('')
        : rowNav({ id: 'forms', tag: 'NONE YET', tagColor: '#b07d10', name: c.forms.none, status: c.forms.noneStatus, action: c.forms.noneAction, href: '/links' })}
      ${rowAct({ id: 'speakers', act: 'openSpeakers', panel: 'speakers', tag: confirmedN ? c.speakers.tag(confirmedN) : c.speakers.none, tagColor: confirmedN ? '#1e6e42' : '#9b1b22', name: c.speakers.name, status: c.speakers.status(D.speakers.length, spLive().length), action: c.speakers.action })}
      ${st.openPanel === 'speakers' ? panelSpeakers() : ''}
      ${rowAct({ id: 'schedule', act: 'openSchedule', panel: 'schedule', tag: pubN ? c.schedule.tag(pubN) : c.schedule.draft, tagColor: pubN ? '#1e6e42' : '#9b1b22', name: c.schedule.name, status: D.sessions.length ? c.schedule.status(D.sessions.length) : c.schedule.none, action: c.schedule.action })}
      ${st.openPanel === 'schedule' ? panelSchedule() : ''}
      ${rowNav({ id: 'travel', tag: c.travel.tag, tagColor: '#b07d10', name: c.travel.name, status: c.travel.status(D.itins), action: c.travel.action, href: '/calendar' })}
      ${rowNav({ id: 'prices', tag: c.prices.tag, tagColor: '#6d6459', name: c.prices.name, status: D.gala.ebDays >= 0 ? c.prices.status(fmt.eur(D.gala.early), fmt.eur(D.gala.regular), fmt.dayShort(D.gala.ebDeadline)) : c.prices.after(fmt.eur(D.gala.regular)), action: c.prices.action, href: '/money' })}
      ${rowNav({ id: 'outbox', tag: D.outbox.length ? c.outbox.tag : c.outbox.clear, tagColor: D.outbox.length ? '#b07d10' : '#6d6459', name: c.outbox.name, status: c.outbox.status(D.outbox.length), action: c.outbox.action, href: '/inbox/outbox' })}
      ${rowNav({ id: 'links', tag: c.links.tag, tagColor: '#6d6459', name: c.links.name, status: c.links.status(D.links), action: c.links.action, href: '/links' })}
      ${cmeLocked ? lockedRow('cme', c.cme.name, 'cme')
        : rowNav({ id: 'cme', tag: D.cme && D.cme.is_accredited ? c.cme.on : c.cme.off, tagColor: D.cme && D.cme.is_accredited ? '#1e6e42' : '#b07d10', name: c.cme.name, status: D.cme && D.cme.is_accredited ? c.cme.status(D.cme.points_value, Number(D.cme.consented) || 0) : c.cme.offStatus, action: c.cme.door, href: '/settings', extra: `<span data-act="cmeExport" data-v2="cme-export" style="font:600 9px Inter,sans-serif;letter-spacing:.13em;color:#6d6459;border:1px solid rgba(32,27,22,.2);padding:5px 9px;cursor:pointer;white-space:nowrap" data-hover="border-color:#201b16;color:#201b16">${c.cme.action}</span>` })}
      ${rowAct({ id: 'qa', act: 'openQa', panel: 'qa', tag: openQ ? c.qa.open(openQ) : c.qa.quiet, tagColor: openQ ? '#9b1b22' : '#6d6459', name: c.qa.name, status: c.qa.status(D.qa.length), action: c.qa.action })}
      ${st.openPanel === 'qa' ? panelQa() : ''}
    </div>
    <!-- /dc -->`;
}

function blockGala() {
  const c = COPY.gala;
  const g = D.gala;
  const galaLocked = isLocked('gala');
  const when = [g.settings.date ? fmt.dayShort(g.settings.date) : FACTS.gala.dateLabel, g.settings.venue || FACTS.gala.venue].filter(Boolean);
  const row = r => `
          <a href="${esc(r.href)}" class="mx-row" data-row="${esc(r.id)}" style="display:flex;align-items:center;gap:14px;padding:15px 20px;border-bottom:1px solid rgba(32,27,22,.08);color:#201b16" data-hover="background:#fdfbf6">
            <span style="width:110px;flex:none;font:600 9px Inter,sans-serif;letter-spacing:.13em;color:${r.tagColor}">${esc(r.tag)}</span>
            <span class="mx-row-text" style="flex:1;min-width:0"><span style="display:block;font-size:14px;font-weight:600">${esc(r.name)}</span><span style="display:block;font-size:12px;color:#6d6459;margin-top:2px">${esc(r.status)}</span></span>
            <span style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:#9b1b22;white-space:nowrap">${esc(r.action)} →</span>
          </a>`;
  return `
        <!-- dc: Admin Plexus Hub.dc.html › "THE GALA EVENING" -->
        <div data-block="gala" style="background:#fff;border:1px solid rgba(32,27,22,.14)">
          <div style="padding:14px 20px;border-bottom:1px solid rgba(32,27,22,.1);display:flex;align-items:baseline;gap:10px;flex-wrap:wrap"><span style="font:600 10px Inter,sans-serif;letter-spacing:.16em">${c.title}</span><span style="font-size:12px;color:#9a9086">${esc(c.when(when[0], when[1] || ''))}</span><div style="flex:1"></div><a href="/gala" style="font:600 9px Inter,sans-serif;letter-spacing:.14em;white-space:nowrap">${c.full}</a></div>
          ${galaLocked ? `<div style="padding:8px 0">${ui.lockedBlock(perms.label('plexus'))}</div>` : `
          ${row({ id: 'gala-seats', tag: c.seats.tag(g.ops ? g.ops.seats.paid : g.paid.length), tagColor: '#1e6e42', name: c.seats.name, status: c.seats.status(g.ops ? g.ops.seats.reserved : g.rows.length, g.ops ? g.ops.seats.chase : g.toChase.length), action: c.seats.action, href: '/gala' })}
          ${row({ id: 'gala-waitlist', tag: c.waitlist.tag, tagColor: '#6d6459', name: c.waitlist.name, status: c.waitlist.status(D.waitn), action: c.waitlist.action, href: '/gala' })}
          ${row({ id: 'gala-donor', tag: D.croat ? c.donor.tag(D.croat) : c.donor.none, tagColor: D.croat ? '#1e6e42' : '#9b1b22', name: c.donor.name, status: D.croat ? c.donor.status(fmt.dayShort(D.conf.start_date || FACTS.plexus.start)) : c.donor.emptyStatus(fmt.dayShort(D.conf.start_date || FACTS.plexus.start)), action: c.donor.action, href: '/links' })}
          ${row({ id: 'gala-onday', tag: c.onday.tag, tagColor: '#6d6459', name: c.onday.name, status: c.onday.status, action: c.onday.action, href: '/event-day' })}`}
          <div style="padding:12px 20px;font-size:12px;color:#6d6459">${c.more} <a href="${esc(PLANNER_URL)}" target="_blank" rel="noopener" data-row="gala-planner">${c.planner} ↗</a> · <a href="/money" data-row="gala-auctions">${c.auctions}</a> ${c.moreTail}</div>
        </div>
        <!-- /dc -->`;
}

function blockAfter() {
  const c = COPY.after;
  const after = afterLabel();
  const pe = D.pe || {};
  const certs = Number(pe.certificates_issued != null ? pe.certificates_issued : (pe.certs && pe.certs.issued)) || 0;
  const peLine = pe && (pe.checked_in != null || pe.certificates_issued != null || pe.rounds != null)
    ? `${certs} certificate${certs === 1 ? '' : 's'} issued${pe.checked_in != null ? ` · ${pe.checked_in} checked in` : ''} — everything stages to the Outbox for your OK`
    : null;
  return `
        <!-- dc: Admin Plexus Hub.dc.html › "AFTER THE WEEK" -->
        <div data-block="after" style="background:#fff;border:1px solid rgba(32,27,22,.14)">
          <div style="padding:16px 20px;display:flex;align-items:center;gap:14px;flex-wrap:wrap">
            <span style="font:600 10px Inter,sans-serif;letter-spacing:.16em">${c.title}</span>
            <span style="font-size:13px;color:#6d6459;flex:1;min-width:200px">${esc(c.line(after))}</span>
            <span data-act="start2027" title="${esc(c.start2027Title)}" style="font:600 9px Inter,sans-serif;letter-spacing:.14em;white-space:nowrap;color:#9a9086;border:1px dashed rgba(32,27,22,.3);padding:6px 10px;cursor:pointer">${esc(c.start2027(after))}</span>
          </div>
          <div data-v2="post-event-rows" style="border-top:1px solid rgba(32,27,22,.08)">
          <span data-act="peOpen" class="mx-row" data-row="pe-certs" style="display:flex;align-items:center;gap:14px;padding:11px 20px;border-bottom:1px solid rgba(32,27,22,.08);cursor:pointer;color:#201b16" data-hover="background:#fdfbf6">
            <span style="width:110px;flex:none;font:600 9px Inter,sans-serif;letter-spacing:.13em;color:${certs ? '#1e6e42' : '#6d6459'}">${certs ? esc(c.certs.done(certs)) : c.certs.tag}</span>
            <span class="mx-row-text" style="flex:1;min-width:0;font-size:12.5px;color:#6d6459"><b style="font-size:13.5px;color:#201b16">${c.certs.name}</b> · ${esc(c.certs.status(peLine))}</span>
            <span style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:#9b1b22;white-space:nowrap">${c.certs.action} →</span>
          </span>
          <span data-act="editionsOpen" class="mx-row" data-row="editions" style="display:flex;align-items:center;gap:14px;padding:11px 20px;cursor:pointer;color:#201b16" data-hover="background:#fdfbf6">
            <span style="width:110px;flex:none;font:600 9px Inter,sans-serif;letter-spacing:.13em;color:#6d6459">${c.editions.tag}</span>
            <span class="mx-row-text" style="flex:1;min-width:0;font-size:12.5px;color:#6d6459"><b style="font-size:13.5px;color:#201b16">${c.editions.name}</b> · ${esc(c.editions.status(D.editions.editions.length))}</span>
            <span style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:#9b1b22;white-space:nowrap">${c.editions.action} →</span>
          </span>
          </div>
        </div>
        <!-- /dc -->`;
}

function blockMembers() {
  const c = COPY.members;
  const p = D.pstatus || {};
  const saved = st.msSaved;
  return `
        <!-- dc: Admin Plexus Hub.dc.html › "WHAT MEMBERS SEE" -->
        <div id="members-card" data-block="members" style="background:#fff;border:1px solid rgba(32,27,22,.14);border-top:2px solid #c9a962">
          <div style="padding:13px 20px;border-bottom:1px solid rgba(32,27,22,.1);display:flex;align-items:baseline;gap:10px"><span style="font:600 10px Inter,sans-serif;letter-spacing:.16em;white-space:nowrap">${c.title}</span><span style="font-size:12px;color:#9a9086;white-space:nowrap">${c.sub}</span></div>
          <div style="padding:4px 20px 20px">
          <div style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:#6d6459;margin-top:16px">${c.label}</div>
          <input data-role="msLabel" value="${esc(p.status_label || '')}" aria-label="${esc(c.label)}" style="width:100%;box-sizing:border-box;margin-top:6px;background:#f6f2ea;border:1px solid rgba(32,27,22,.25);padding:10px 12px;font:400 13px Inter,sans-serif;color:#201b16">
          <div style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:#6d6459;margin-top:12px">${c.detail}</div>
          <input data-role="msDetail" value="${esc(p.detail_line || '')}" aria-label="${esc(c.detail)}" style="width:100%;box-sizing:border-box;margin-top:6px;background:#f6f2ea;border:1px solid rgba(32,27,22,.25);padding:10px 12px;font:400 13px Inter,sans-serif;color:#201b16">
          <button data-act="msSave" data-role="msSaveBtn" style="margin-top:14px;background:${saved ? '#1e6e42' : '#9b1b22'};color:#fff;border:none;font:600 10px Inter,sans-serif;letter-spacing:.14em;padding:11px 18px;cursor:pointer;white-space:nowrap">${saved ? c.saved : c.save}</button>
          <div style="margin-top:12px;padding-top:10px;border-top:1px solid rgba(32,27,22,.1)"><a href="/member-pages/plexus" style="font:600 9px Inter,sans-serif;letter-spacing:.14em">${c.manage}</a></div>
          </div>
        </div>
        <!-- /dc -->`;
}
function blockCme() {
  const c = COPY.cme;
  const on = D.cme && D.cme.is_accredited;
  return `
        <!-- dc: Admin Plexus Hub.dc.html › "CME note" -->
        <div data-block="cmeNote" style="border:1px solid rgba(32,27,22,.14);background:#fdfbf6;padding:16px 20px;font-size:12.5px;color:#6d6459;line-height:1.6">
          <span style="color:${on ? '#1e6e42' : '#b07d10'};font-weight:600">${on ? c.on : c.off}</span>${on ? c.onTail : c.offTail}<a href="/settings">${c.link}</a>
        </div>
        <!-- /dc -->`;
}
function blockStatsWidget() {
  const c = COPY.widget;
  const live = figLive();
  const fig = k => {
    const ov = D.overrides[k];
    const editing = st.ovEdit === k;
    return `
          <div data-row="fig-${k}" style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid rgba(32,27,22,.07)">
            <span style="flex:1;font-size:12.5px;color:#4a4239">${esc(c.figures[k])}</span>
            ${editing
              ? `<input class="mxp-fig-input" data-role="ovInput" value="${esc(ov ? ov.value : live[k])}" aria-label="${esc(c.figures[k])} override">
                 <span data-act="ovSave" data-key="${k}" class="btn-primary" style="padding:6px 10px;font:600 8.5px Inter,sans-serif;letter-spacing:.12em;cursor:pointer">${c.save}</span>`
              : `<span style="font-family:Fraunces,serif;font-size:19px">${esc(ov ? ov.value : live[k])}</span>
                 ${ov ? `<span class="tag tag-gold" title="Live value: ${esc(live[k])}">${c.manual}</span><span data-act="ovClear" data-key="${k}" title="Back to the live number" style="font:600 10px Inter,sans-serif;color:#6d6459;cursor:pointer" data-hover="color:#9b1b22">${c.clear}</span>` : ''}
                 <span data-act="ovEdit" data-key="${k}" title="Override this figure for the copy line" style="font:600 10px Inter,sans-serif;color:#6d6459;cursor:pointer" data-hover="color:#201b16">✎</span>`}
          </div>`;
  };
  return `
        <!-- v2: "STATS FOR MEDIA & SPONSORS" — the reusable per-hub stats widget (README admin note 21):
             scoped live numbers · per-figure manual override (v2_stats_overrides) · one-click copy line -->
        <div data-block="widget" data-v2="stats-widget" style="background:#fff;border:1px solid rgba(32,27,22,.14)">
          <div style="padding:13px 20px;border-bottom:1px solid rgba(32,27,22,.1);display:flex;align-items:baseline;gap:10px;flex-wrap:wrap"><span style="font:600 10px Inter,sans-serif;letter-spacing:.16em;white-space:nowrap">${c.title}</span><span style="font-size:11.5px;color:#9a9086">${c.sub}</span></div>
          <div style="padding:6px 20px 4px">${FIG_KEYS.map(fig).join('')}</div>
          <div style="padding:10px 20px 16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <span data-act="copyStats" class="btn-ghost" style="padding:8px 13px;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap">${c.copy}</span>
            <span data-role="statsLine" style="font-size:11px;color:#9a9086;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(statsLine())}</span>
          </div>
        </div>
        <!-- /v2 -->`;
}
// ================================================================================================
// v2 2026-09-11 — MEETUPS tab (design/MEETUPS-SPEC.md §3 "Admin view"). No artboard source; built
// from the hub's own vocabulary: the blockStats() stat strip, the money.js table helpers and the
// studio.js tool-drawer. Every write action disappears on an archived edition (meetReadOnly()).
// ================================================================================================
const localIso = v => String(v == null ? '' : v).replace(' ', 'T').slice(0, 16);
const fLab = t => `<span style="${MICRO}">${t}</span>`;
function fText(role, label, value, ph, opts = {}) {
  return `<label class="mxp-f" style="display:flex;flex-direction:column;gap:5px;min-width:0${opts.span ? ';grid-column:1 / -1' : ''}">${fLab(esc(label))}<input data-role="${role}" type="${opts.type || 'text'}"${opts.min != null ? ` min="${opts.min}"` : ''}${opts.max != null ? ` max="${opts.max}"` : ''}${opts.step ? ` step="${opts.step}"` : ''} value="${esc(value == null ? '' : value)}" placeholder="${esc(ph || '')}" aria-label="${esc(label)}" style="width:100%;box-sizing:border-box;${INPUT2}"></label>`;
}
function fArea(role, label, value, ph, rows) {
  return `<label class="mxp-f" style="display:flex;flex-direction:column;gap:5px;min-width:0;grid-column:1 / -1">${fLab(esc(label))}<textarea data-role="${role}" rows="${rows || 3}" placeholder="${esc(ph || '')}" aria-label="${esc(label)}" style="width:100%;box-sizing:border-box;resize:vertical;${INPUT2}">${esc(value == null ? '' : value)}</textarea></label>`;
}
function fSel(role, label, value, opts, span) {
  return `<label class="mxp-f" style="display:flex;flex-direction:column;gap:5px;min-width:0${span ? ';grid-column:1 / -1' : ''}">${fLab(esc(label))}<select data-role="${role}" aria-label="${esc(label)}" style="width:100%;box-sizing:border-box;${INPUT2}">${opts.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(value == null ? '' : value) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
}
const pickerLine = t => `<span style="padding:9px 11px;font-size:12px;color:#6d6459;font-style:italic">${esc(t)}</span>`;
// one member picker, three uses (host · manual add · invitations) — /api/v2/meetups-ops/members
function memberResults(block, act, bag) {
  const b = bag || {};
  const q = String(b.q || '').trim();
  const body = b.busy ? pickerLine('…')
    : q.length < 2 ? pickerLine(COPY.meet.form.hostSearchShort)
    : !(b.results || []).length ? pickerLine(COPY.meet.form.hostNone)
    : b.results.map(m => `<span data-act="${act}" data-id="${esc(m.id)}" data-name="${esc(m.name || '')}" data-email="${esc(m.email || '')}" data-line="${esc(m.line || '')}" style="display:flex;align-items:baseline;gap:9px;padding:8px 11px;border-top:1px solid ${HAIR07};cursor:pointer" data-hover="background:#fdfbf6"><span style="font-size:12.5px;font-weight:600;white-space:nowrap">${esc(m.name || m.email)}</span><span style="font-size:11.5px;color:#6d6459;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(m.line || m.email || '')}</span></span>`).join('');
  return `<div data-block="${block}" class="mxp-picker" style="display:flex;flex-direction:column;border:1px solid ${HAIR12};background:#fff;max-height:196px;overflow:auto">${body}</div>`;
}

function blockMeetStats() {
  const s = meetStats(), c = COPY.meet.stats;
  const cell = (k, v, sub, last) => `
        <div style="padding:16px 20px;${last ? '' : 'border-right:1px solid rgba(32,27,22,.1)'}">
          <div style="font:600 9px Inter,sans-serif;letter-spacing:.15em;color:#6d6459">${k}</div>
          <div class="mx-display-30" style="font-family:Fraunces,serif;font-size:30px;margin-top:3px">${esc(v)}</div>
          <div style="font-size:11px;color:#6d6459">${esc(sub)}</div>
        </div>`;
  return `
    <!-- v2: "MEETUPS — stat strip" (the Plexus hub stat-strip markup, four cells) -->
    <div data-block="meetStats" data-v2="meetups stats" style="border:1px solid ${HAIR};background:#fff;margin-top:22px">
      <div class="mx-kpi" style="display:grid;grid-template-columns:repeat(4,1fr)">
        ${cell(c.meetups, fmt.num(s.meetups), c.meetupsSub(s.published, s.drafts))}
        ${cell(c.seats, fmt.num(s.seats), c.seatsSub(s.taken, s.seats_left))}
        ${cell(c.fill, s.fill_percent + '%', c.fillSub(s.hosts))}
        ${cell(c.wait, fmt.num(s.waitlisted), c.waitSub, true)}
      </div>
    </div>
    <!-- /v2 -->`;
}

function meetRow(m) {
  const t = COPY.meet.table, a = COPY.meet.acts;
  const ro = meetReadOnly();
  const tone = { draft: ['#f8f1e2', '#7a6432'], published: ['#1e6e42', '#fff'], cancelled: ['#9b1b22', '#fff'], completed: ['#f6f2ea', '#6d6459'] }[m.status] || ['#f6f2ea', '#6d6459'];
  const chips = [
    m.visibility === 'invite' ? t.inviteOnly : '',
    m.waitlist_enabled ? '' : t.noWaitlist,
    m.full ? t.full : ''
  ].filter(Boolean).map(x => `<span style="${MICRO};color:#9a9086;white-space:nowrap">${esc(x)}</span>`).join('');
  const canDelete = m.status === 'draft' && !m.confirmed && !m.waitlisted && !m.invited;
  const acts = [
    actBtn('mAtt', m.id, a.people, a.peopleTitle),
    actBtn('mInv', m.id, a.invites, a.invitesTitle),
    m.host_link ? actBtn('mHostLink', m.id, a.link, a.linkTitle) : '',
    actBtn('mCsv', m.id, a.csv, a.csvTitle),
    ro ? '' : actBtn('mEdit', m.id, a.edit),
    ro || m.status === 'cancelled' ? '' : actBtn('mPublish', m.id, m.status === 'published' ? a.unpublish : a.publish),
    ro || m.status === 'cancelled' ? '' : actBtn('mCancelMeetup', m.id, a.cancel),
    ro || !canDelete ? '' : actBtn('mDelete', m.id, a.del, a.delTitle)
  ].filter(Boolean).join('');
  return `
      <tr data-row="meet-${esc(m.id)}">
        ${td(`<span style="display:flex;flex-direction:column;gap:2px;min-width:0">
              <span style="font-size:13px;font-weight:600">${esc(m.title)}</span>
              <span style="display:flex;gap:9px;flex-wrap:wrap;align-items:baseline"><span style="${MICRO};color:#c9a962;white-space:nowrap">${esc(t.kinds[m.kind] || t.kinds.other)}</span>${chips}</span>
            </span>`, 'min-width:220px')}
        ${td(m.host_line || m.host_name ? `<span style="display:flex;flex-direction:column;gap:2px"><span style="font-size:12.5px">${esc(m.host_name || '')}</span>${m.host_title ? `<span style="font-size:11px;color:#6d6459">${esc(m.host_title)}</span>` : ''}</span>` : `<span style="font-size:12px;color:#9b1b22">${esc(t.noHost)}</span>`)}
        ${td(`<span style="white-space:nowrap">${esc(m.when_label || m.starts_at || '')}</span>`)}
        ${td(m.venue_name ? `<span style="display:flex;flex-direction:column;gap:2px"><span>${esc(m.venue_name)}</span>${m.venue_address ? `<span style="font-size:11px;color:#6d6459">${esc(m.venue_address)}</span>` : ''}</span>` : `<span style="color:#9a9086">${t.noVenue}</span>`)}
        ${tdNum(esc(t.seats(m.confirmed, m.capacity)))}
        ${tdNum(m.waitlisted ? esc(String(m.waitlisted)) : '<span style="color:#9a9086">—</span>')}
        ${td(`<span style="background:${tone[0]};color:${tone[1]};font:600 8.5px Inter,sans-serif;letter-spacing:.12em;padding:3px 7px;white-space:nowrap">${esc(t.status[m.status] || String(m.status || '').toUpperCase())}</span>`)}
        ${tdActs(acts)}
      </tr>`;
}
function blockMeetTable() {
  const t = COPY.meet.table;
  const ro = meetReadOnly();
  if (!canMeet()) {
    return `
    <!-- v2: "MEETUPS" — locked state (permission section plexus-meetups) -->
    <div data-block="meetTable" style="border:1px solid ${HAIR};background:#fff;margin-top:22px">
      <div style="padding:14px 20px;border-bottom:1px solid ${HAIR12};display:flex;align-items:baseline;gap:10px"><span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${t.title}</span><span style="font-size:11.5px;color:#9a9086">${t.sub}</span></div>
      <div style="padding:10px 0">${ui.lockedBlock(perms.label(MEET_SECTION))}</div>
    </div>
    <!-- /v2 -->`;
  }
  if (D.errors.meet) {
    const e = D.errors.meet;
    return `
    <!-- v2: "MEETUPS" — the overview call failed -->
    <div data-block="meetTable" style="border:1px solid ${HAIR};background:#fff;margin-top:22px">
      <div style="padding:14px 20px;border-bottom:1px solid ${HAIR12};display:flex;align-items:baseline;gap:10px"><span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${t.title}</span></div>
      <div style="padding:10px 0">${e.isLocked ? ui.lockedBlock(perms.label(e.section)) : `<div style="padding:16px 20px;font-size:12.5px;color:#9b1b22">${esc(e.message)}</div>`}</div>
    </div>
    <!-- /v2 -->`;
  }
  const rows = meetRows();
  const headers = [{ t: t.head.title }, { t: t.head.host }, { t: t.head.when }, { t: t.head.venue }, { t: t.head.seats, r: 1 }, { t: t.head.wait, r: 1 }, { t: t.head.status }, { t: '', r: 1 }];
  return `
    <!-- v2: "MEETUPS" — the table (design/MEETUPS-SPEC.md §3 "Admin view") -->
    <div data-block="meetTable" style="border:1px solid ${HAIR};background:#fff;margin-top:22px">
      <div class="mxp-cardhead" style="padding:14px 20px;border-bottom:1px solid ${HAIR12};display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em;white-space:nowrap">${t.title}</span>
        <span style="font-size:11.5px;color:#9a9086">${t.sub}</span>
        <div style="flex:1"></div>
        ${ro ? `<span style="${MICRO};color:#9a9086;white-space:nowrap">${COPY.ed.roTag}</span>`
             : `<span data-act="mNew" title="${esc(t.addTitle)}" style="padding:8px 13px;background:#9b1b22;color:#fff;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap" data-hover="background:#7e151b">${t.add}</span>`}
      </div>
      ${rows.length ? tblWrap(headers, rows.map(meetRow).join(''), 1120)
        : `<div class="empty" style="padding:30px 20px"><span style="width:28px;height:1px;background:#c9a962"></span><span class="empty-line">${t.empty}</span><span class="empty-why">${t.emptyWhy}</span></div>`}
    </div>
    <!-- /v2 -->`;
}

// ---- the drawer (the js/views/studio.js tool-drawer idiom: one slot, per-tool body) --------------
function drawerForm() {
  const c = COPY.meet.form, f = st.form;
  const cap = Math.max(CAP_MIN, Math.min(CAP_MAX, Number(f.capacity) || 8));
  const step = (act, label) => `<span data-act="${act}" style="width:34px;height:34px;display:inline-flex;align-items:center;justify-content:center;border:1px solid rgba(32,27,22,.25);font:600 14px Inter,sans-serif;cursor:pointer;background:#fff;box-sizing:border-box" data-hover="border-color:#201b16">${label}</span>`;
  return `
      <div class="mxp-fgrid" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:16px 20px">
        ${fText('fTitle', c.title, f.title, c.titlePh)}
        ${fSel('fKind', c.kind, f.kind, meetKinds().map(k => [k, COPY.meet.table.kinds[k] || k.toUpperCase()]))}
        ${fArea('fDescription', c.description, f.description, c.descriptionPh, 3)}
        ${fText('fAudience', c.audience, f.audience, c.audiencePh)}
        ${fText('fTags', c.tags, f.tags, c.tagsPh)}
        ${fText('fVenueName', c.venueName, f.venue_name, c.venueNamePh)}
        ${fText('fVenueAddress', c.venueAddress, f.venue_address, c.venueAddressPh)}
        ${fText('fVenueMap', c.venueMap, f.venue_map_url, c.venueMapPh, { span: true })}
        ${fText('fStarts', c.starts, localIso(f.starts_at), '', { type: 'datetime-local' })}
        ${fText('fEnds', c.ends, localIso(f.ends_at), '', { type: 'datetime-local' })}
        <div class="mxp-f" style="display:flex;flex-direction:column;gap:5px;min-width:0">
          ${fLab(c.capacity)}
          <span style="display:flex;align-items:center;gap:0;flex-wrap:wrap">
            ${step('mCapMinus', '−')}
            <input data-role="fCapacity" type="number" min="${CAP_MIN}" max="${CAP_MAX}" step="1" value="${cap}" aria-label="${esc(c.capacity)}" style="width:64px;text-align:center;box-sizing:border-box;${INPUT2};border-left:0;border-right:0;height:34px">
            ${step('mCapPlus', '+')}
            <span style="font-size:11px;color:#9a9086;margin-left:10px">${c.capacityWhy}</span>
          </span>
        </div>
        ${fSel('fVisibility', c.visibility, f.visibility, c.visOpts)}
        <label class="mxp-f" style="display:flex;gap:8px;align-items:center;font-size:12.5px;color:#4a4239;cursor:pointer;grid-column:1 / -1"><input type="checkbox" data-role="fWaitlist"${f.waitlist_enabled ? ' checked' : ''}> ${c.waitlist}</label>
        ${hostPickerHtml()}
      </div>
      <div style="display:flex;gap:10px;align-items:center;padding:0 20px 18px;flex-wrap:wrap">
        <span data-act="mSave" style="padding:10px 16px;background:#9b1b22;color:#fff;font:600 10px Inter,sans-serif;letter-spacing:.14em;cursor:pointer;white-space:nowrap" data-hover="background:#7e151b">${f.id ? c.save : c.create}</span>
        <span data-act="mDrawerClose" style="font:600 9px Inter,sans-serif;letter-spacing:.13em;color:#6d6459;cursor:pointer;white-space:nowrap" data-hover="color:#201b16">${c.cancel}</span>
      </div>`;
}
function hostPickerHtml() {
  const c = COPY.meet.form, f = st.form;
  const mode = (k, label) => `<span data-act="mHostMode" data-mode="${k}" style="padding:6px 11px;font:600 9px Inter,sans-serif;letter-spacing:.12em;cursor:pointer;border:1px solid ${f.hostMode === k ? '#201b16' : 'rgba(32,27,22,.25)'};background:${f.hostMode === k ? '#201b16' : 'transparent'};color:${f.hostMode === k ? '#f6f2ea' : '#6d6459'};white-space:nowrap">${label}</span>`;
  const picked = f.host_name || f.host_email;
  return `
        <div class="mxp-host" style="grid-column:1 / -1;display:flex;flex-direction:column;gap:9px;border-top:1px solid ${HAIR08};padding-top:13px">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            ${fLab(c.host)}
            ${mode('member', c.hostMember)}
            ${mode('free', c.hostFree)}
            ${picked ? `<span style="${MICRO};color:#1e6e42;white-space:nowrap">${c.hostPicked}: ${esc([f.host_name, f.host_email].filter(Boolean).join(' · '))}</span><span data-act="mHostClear" style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#6d6459;cursor:pointer" data-hover="color:#9b1b22">${c.hostClear}</span>` : ''}
          </div>
          ${f.hostMode === 'member' ? `
          <input data-role="fHostQ" value="${esc(f.hostQ || '')}" placeholder="${esc(c.hostSearch)}" aria-label="${esc(c.hostSearch)}" autocomplete="off" style="width:100%;box-sizing:border-box;${INPUT2}">
          ${memberResults('hostResults', 'mHostPick', { q: f.hostQ, results: f.hostResults, busy: f.hostBusy })}` : `
          <div class="mxp-fgrid" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            ${fText('fHostName', c.hostName, f.host_name, c.hostNamePh)}
            ${fText('fHostEmail', c.hostEmail, f.host_email, c.hostEmailPh, { type: 'email' })}
            ${fText('fHostTitle', c.hostTitle, f.host_title, c.hostTitlePh, { span: true })}
          </div>`}
        </div>`;
}

function attCard(a, bucket) {
  const c = COPY.meet.att;
  const ro = meetReadOnly();
  const line = [a.position, a.institution].filter(Boolean).join(' · ');
  const acts = [];
  if (!ro && bucket === 'waitlist') acts.push(actBtn('mPromote', a.id, c.promote, c.promoteTitle));
  if (!ro && bucket === 'confirmed') acts.push(`<span data-act="mCheckin" data-id="${esc(a.id)}" data-on="${a.checked_in ? 1 : 0}" style="${BTN_GHOST}${a.checked_in ? ';border-color:#1e6e42;color:#1e6e42' : ''}" data-hover="border-color:#201b16">${a.checked_in ? c.undo : c.checkIn}</span>`);
  if (!ro && (bucket === 'confirmed' || bucket === 'waitlist' || bucket === 'invited')) acts.push(actBtn('mAttCancel', a.id, c.cancelPlace, c.cancelTitle));
  if (!ro) acts.push(actBtn('mAttRemove', a.id, c.remove, c.removeTitle));
  return `
        <div data-row="att-${esc(a.id)}" style="display:flex;align-items:center;gap:10px;padding:9px 20px;border-top:1px solid ${HAIR07}">
          <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px">
            <span style="font-size:13px;font-weight:600">${esc(a.name || a.email || '')}${a.checked_in ? ` <span style="${MICRO};color:#1e6e42">${c.checkedIn}</span>` : ''}${bucket === 'waitlist' && a.waitlist_pos ? ` <span style="${MICRO};color:#7a6432">${esc(c.pos(a.waitlist_pos))}</span>` : ''}</span>
            <span style="font-size:11.5px;color:#6d6459;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(line || a.email || '—')}${line && a.email ? ' · ' + esc(a.email) : ''}</span>
            ${a.bio ? `<span style="font-size:11px;color:#9a9086;line-height:1.5">${esc(String(a.bio).slice(0, 200))}</span>` : ''}
          </span>
          ${acts.join('')}
        </div>`;
}
function drawerAtt() {
  const c = COPY.meet.att, s = st.att;
  const ro = meetReadOnly();
  if (s.busy || !s.data) return `<div style="padding:20px;font-size:12.5px;color:#6d6459;font-style:italic">…</div>`;
  const d = s.data, m = d.meetup || {};
  const bucket = (key, label, list, extra) => `
        <div data-block="att-${key}">
          <div style="display:flex;align-items:baseline;gap:10px;padding:11px 20px;border-top:1px solid ${HAIR12};background:#fdfbf6">
            <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.15em">${label}</span>
            <span style="font-size:11.5px;color:#6d6459">${esc(extra || String(list.length))}</span>
          </div>
          ${list.length ? list.map(a => attCard(a, key)).join('') : `<div style="padding:11px 20px;font-size:12px;color:#9a9086;font-style:italic">${c.empty}</div>`}
        </div>`;
  const add = st.att.add || { mode: 'member', q: '', results: [], busy: false, notify: true };
  const modeChip = (k, label) => `<span data-act="mAttMode" data-mode="${k}" style="padding:6px 11px;font:600 9px Inter,sans-serif;letter-spacing:.12em;cursor:pointer;border:1px solid ${add.mode === k ? '#201b16' : 'rgba(32,27,22,.25)'};background:${add.mode === k ? '#201b16' : 'transparent'};color:${add.mode === k ? '#f6f2ea' : '#6d6459'};white-space:nowrap">${label}</span>`;
  return `
      ${ro ? '' : `
      <div class="mxp-attadd" style="display:flex;flex-direction:column;gap:9px;padding:14px 20px">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">${fLab(c.add)}${modeChip('member', c.addMember)}${modeChip('email', c.addEmail)}
          <label style="display:flex;gap:6px;align-items:center;font-size:12px;color:#4a4239;cursor:pointer;margin-left:6px"><input type="checkbox" data-role="aNotify"${add.notify ? ' checked' : ''}> ${c.notify}</label>
        </div>
        ${add.mode === 'member' ? `
        <input data-role="aQ" value="${esc(add.q || '')}" placeholder="${esc(COPY.meet.form.hostSearch)}" aria-label="${esc(COPY.meet.form.hostSearch)}" autocomplete="off" style="width:100%;box-sizing:border-box;${INPUT2}">
        ${memberResults('attResults', 'mAttPick', add)}` : `
        <div class="mxp-fgrid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <input data-role="aEmail" type="email" value="" placeholder="${esc(c.addEmailPh)}" aria-label="${esc(c.addEmailPh)}" style="width:100%;box-sizing:border-box;${INPUT2}">
          <input data-role="aName" value="" placeholder="${esc(c.addNamePh)}" aria-label="${esc(c.addNamePh)}" style="width:100%;box-sizing:border-box;${INPUT2}">
          <input data-role="aInst" value="" placeholder="${esc(c.addInstPh)}" aria-label="${esc(c.addInstPh)}" style="width:100%;box-sizing:border-box;${INPUT2}">
          <input data-role="aPos" value="" placeholder="${esc(c.addPosPh)}" aria-label="${esc(c.addPosPh)}" style="width:100%;box-sizing:border-box;${INPUT2}">
        </div>
        <span data-act="mAttAdd" style="padding:9px 14px;background:#201b16;color:#f6f2ea;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;align-self:flex-start;white-space:nowrap">${c.addBtn}</span>`}
      </div>`}
      ${bucket('confirmed', c.confirmed, d.confirmed || [], c.countOf((d.confirmed || []).length, m.capacity || 0))}
      ${bucket('waitlist', c.waitlist, d.waitlist || [])}
      ${bucket('invited', c.invited, d.invited || [])}
      ${bucket('declined', c.declined, d.declined || [])}
      ${bucket('cancelled', c.cancelled, d.cancelled || [])}
      <div style="display:flex;gap:10px;align-items:center;padding:13px 20px;border-top:1px solid ${HAIR12}">
        <span data-act="mAttCsv" data-id="${esc(s.id)}" style="${BTN_GHOST}" data-hover="border-color:#201b16">${c.csv}</span>
      </div>`;
}

function drawerInv() {
  const c = COPY.meet.inv, s = st.inv;
  const ro = meetReadOnly();
  if (s.busy || !s.data) return `<div style="padding:20px;font-size:12.5px;color:#6d6459;font-style:italic">…</div>`;
  const d = s.data, sum = d.summary || { invited: 0, accepted: 0, declined: 0 };
  const list = (label, rows) => `
        <div>
          <div style="display:flex;align-items:baseline;gap:10px;padding:11px 20px;border-top:1px solid ${HAIR12};background:#fdfbf6"><span style="font:600 9.5px Inter,sans-serif;letter-spacing:.15em">${label}</span><span style="font-size:11.5px;color:#6d6459">${rows.length}</span></div>
          ${rows.length ? rows.map(a => `<div style="display:flex;align-items:baseline;gap:10px;padding:8px 20px;border-top:1px solid ${HAIR07}"><span style="font-size:12.5px;font-weight:600;white-space:nowrap">${esc(a.name || a.email || '')}</span><span style="font-size:11.5px;color:#6d6459;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.email || '')}</span></div>`).join('') : `<div style="padding:10px 20px;font-size:12px;color:#9a9086;font-style:italic">${c.none}</div>`}
        </div>`;
  const pv = s.preview;
  return `
      ${ro ? '' : `
      <div style="display:flex;flex-direction:column;gap:10px;padding:14px 20px">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">${fLab(c.pick)}
          ${(s.picked || []).map((p, i) => `<span style="display:inline-flex;align-items:center;gap:6px;padding:4px 8px;background:#f6f2ea;border:1px solid ${HAIR12};font-size:11.5px;white-space:nowrap">${esc(p.name || p.email)}<span data-act="mInvDrop" data-i="${i}" style="color:#9b1b22;cursor:pointer;font-weight:600">${c.drop}</span></span>`).join('')}
        </div>
        <input data-role="iQ" value="${esc(s.q || '')}" placeholder="${esc(c.pickPh)}" aria-label="${esc(c.pickPh)}" autocomplete="off" style="width:100%;box-sizing:border-box;${INPUT2}">
        ${memberResults('invResults', 'mInvPick', s)}
        <label style="display:flex;flex-direction:column;gap:5px">${fLab(c.paste)}<textarea data-role="iRaw" rows="2" placeholder="${esc(c.pastePh)}" aria-label="${esc(c.paste)}" style="width:100%;box-sizing:border-box;resize:vertical;${INPUT2}">${esc(s.raw || '')}</textarea></label>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <span data-act="mInvPreview" title="${esc(c.previewTitle)}" style="${BTN_GHOST}" data-hover="border-color:#201b16">${c.preview}</span>
          <span data-act="mInvSend" style="padding:9px 14px;background:#9b1b22;color:#fff;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap" data-hover="background:#7e151b">${c.send}</span>
        </div>
        ${pv ? `
        <div data-v2="invite email preview — sandboxed, nothing sent" style="display:flex;flex-direction:column;gap:6px">
          <span style="${MICRO}">${esc(c.previewHead(pv.recipients, pv.subject))}</span>
          ${(pv.invalid || []).length ? `<span style="font-size:11.5px;color:#9b1b22">${esc(c.invalid(pv.invalid.join(', ')))}</span>` : ''}
          <iframe data-role="invPreview" sandbox="" title="${esc(pv.subject)}" srcdoc="${esc(pv.html || '')}" style="width:100%;height:340px;border:1px solid ${HAIR12};background:#fff"></iframe>
        </div>` : ''}
      </div>`}
      <div style="padding:11px 20px;border-top:1px solid ${HAIR12};font-size:12px;color:#6d6459">${esc(c.summary(sum.invited, sum.accepted, sum.declined))}</div>
      ${list(COPY.meet.att.invited, d.invited || [])}
      ${list('ACCEPTED', d.accepted || [])}
      ${list(COPY.meet.att.declined, d.declined || [])}`;
}

function blockMeetDrawer() {
  if (!st.drawer) return `<div data-block="meetDrawer"></div>`;
  const c = COPY.meet.drawer;
  const m = st.drawer === 'form' ? (st.form.id ? meetById(st.form.id) : null)
    : st.drawer === 'att' ? meetById(st.att.id) : meetById(st.inv.id);
  const title = st.drawer === 'form' ? (st.form.id ? c.editTitle(m ? m.title : st.form.title) : c.newTitle)
    : st.drawer === 'att' ? c.attTitle(m ? m.title : '') : c.invTitle(m ? m.title : '');
  return `
    <!-- v2: "MEETUP DRAWER" (the js/views/studio.js tool-drawer idiom) -->
    <div data-block="meetDrawer" id="meetDrawer" style="border:1px solid ${HAIR};border-top:2px solid #9b1b22;background:#fff;margin-top:22px">
      <div style="display:flex;align-items:center;gap:14px;padding:13px 20px;border-bottom:1px solid ${HAIR12}">
        <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(title)}</span>
        <div style="flex:1"></div>
        <span data-act="mDrawerClose" style="font:600 10px Inter,sans-serif;letter-spacing:.12em;color:#6d6459;cursor:pointer" data-hover="color:#9b1b22">${c.close}</span>
      </div>
      ${st.drawer === 'form' ? drawerForm() : st.drawer === 'att' ? drawerAtt() : drawerInv()}
    </div>
    <!-- /v2 -->`;
}

function blockFooterEdition() {
  const c = COPY.footer;
  return `
    <!-- dc: Admin Plexus Hub.dc.html › "Edition footer" -->
    <div data-block="edfoot" style="display:flex;justify-content:space-between;align-items:baseline;gap:14px;margin-top:30px;flex-wrap:wrap">
      <span style="font-size:12px;color:#9a9086"><b style="color:#6d6459">${c.edition}</b> · ${c.line}</span>
      <span data-act="archiveNote" title="${esc(c.archiveTitle)}" style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:#c9beb2;border:1px dashed rgba(32,27,22,.25);padding:5px 9px;cursor:pointer">${esc(c.archive(afterLabel()))}</span>
    </div>
    <!-- /dc -->`;
}
function blockHub() {
  return `
    ${blockStats()}
    ${blockBefore()}
    <div class="mx-two" style="display:grid;grid-template-columns:1.55fr 1fr;gap:22px;margin-top:22px;align-items:start">
      <div class="mxp-col" style="display:grid;gap:22px">
        ${blockGala()}
        ${blockAfter()}
      </div>
      <div class="mxp-col" style="display:grid;gap:22px">
        ${blockMembers()}
        ${blockCme()}
        ${blockStatsWidget()}
      </div>
    </div>`;
}
function blockMeetups() {
  return `
    ${canMeet() && !D.errors.meet ? blockMeetStats() : ''}
    ${blockMeetTable()}
    ${blockMeetDrawer()}`;
}
function template() {
  return `
<div data-screen-label="Admin Plexus Hub" style="min-height:100vh;background:#f6f2ea;color:#201b16;font-family:Inter,sans-serif">
  ${blockSubnav()}
  <div class="mx-gutter" style="max-width:1180px;margin:0 auto;padding:34px 28px 60px">
    ${blockTitle()}
    ${blockTabs()}
    ${st.tab === 'meetups' ? blockMeetups() : blockHub()}
    ${blockFooterEdition()}
  </div>
</div>`;
}

// ---------------------------------------------------------------- behaviour
function paint() { if (rootEl) { rootEl.innerHTML = template(); } }
// surgical repaint of ONE block (the js/views/studio.js paint(sel, html) idiom) — used by the
// meetups drawer so typing in a search field survives a result-list refresh
function paintPart(sel, html) { const el = rootEl && rootEl.querySelector(sel); if (el) el.outerHTML = html; }
function val(role) { const el = rootEl.querySelector(`[data-role="${role}"]`); return el ? el.value.trim() : ''; }
function raw(role) { const el = rootEl.querySelector(`[data-role="${role}"]`); return el ? el.value : ''; }
function checked(role) { const el = rootEl.querySelector(`[data-role="${role}"]`); return !!(el && el.checked); }
const blankSp = () => ({ name: '', title: '', institution: '', email: '', talk_title: '', is_keynote: false, logo: '', event_tag: '' });
const blankSs = () => ({ title: '', day: 1, start_time: '', end_time: '', room: '', session_type: 'talk', is_published: false });

// ---- v2 2026-09-11: meetups state helpers -------------------------------------------------------
function blankForm() {
  const day = (chosenEd() && chosenEd().starts_on) || D.conf.start_date || FACTS.plexus.start;
  return {
    id: null, title: '', kind: 'coffee', description: '', audience: '', tags: '',
    venue_name: '', venue_address: '', venue_map_url: '',
    starts_at: String(day).slice(0, 10) + 'T10:30', ends_at: '',
    capacity: 8, waitlist_enabled: true, visibility: 'open',
    hostMode: 'member', host_user_id: null, host_name: '', host_title: '', host_email: '',
    hostQ: '', hostResults: [], hostBusy: false
  };
}
function formFrom(m) {
  return {
    id: m.id, title: m.title || '', kind: m.kind || 'coffee', description: m.description || '', audience: m.audience || '',
    tags: (m.tags || []).join(', '), venue_name: m.venue_name || '', venue_address: m.venue_address || '', venue_map_url: m.venue_map_url || '',
    starts_at: m.starts_at || '', ends_at: m.ends_at || '',
    capacity: Number(m.capacity) || 8, waitlist_enabled: !!m.waitlist_enabled, visibility: m.visibility || 'open',
    hostMode: m.host_user_id ? 'member' : 'free', host_user_id: m.host_user_id || null,
    host_name: m.host_name || '', host_title: m.host_title || '', host_email: m.host_email || '',
    hostQ: '', hostResults: [], hostBusy: false
  };
}
// merge whatever is currently typed back into st.form so a repaint never eats an edit
function syncForm() {
  if (!st.form || st.drawer !== 'form' || !rootEl.querySelector('[data-role="fTitle"]')) return;
  const f = st.form;
  f.title = val('fTitle'); f.kind = val('fKind'); f.description = raw('fDescription').trim(); f.audience = val('fAudience');
  f.tags = val('fTags'); f.venue_name = val('fVenueName'); f.venue_address = val('fVenueAddress'); f.venue_map_url = val('fVenueMap');
  f.starts_at = val('fStarts'); f.ends_at = val('fEnds');
  const cap = parseInt(val('fCapacity'), 10);
  if (Number.isFinite(cap)) f.capacity = Math.max(CAP_MIN, Math.min(CAP_MAX, cap));
  f.waitlist_enabled = checked('fWaitlist'); f.visibility = val('fVisibility') || 'open';
  if (f.hostMode === 'member') { const q = rootEl.querySelector('[data-role="fHostQ"]'); if (q) f.hostQ = q.value; }
  else { f.host_name = val('fHostName'); f.host_email = val('fHostEmail'); f.host_title = val('fHostTitle'); f.host_user_id = null; }
}
const meetUrl = (id, tail) => '/api/v2/meetups-ops/meetups/' + encodeURIComponent(id) + (tail || '');
// re-read the edition's meetups (the table + the stat strip) without redrawing the whole screen
async function reloadMeet(full) {
  try {
    const v = await api.get('/api/v2/meetups-ops/overview' + (st.editionId ? '?edition=' + encodeURIComponent(st.editionId) : ''));
    D.meet = v; delete D.errors.meet;
  } catch (e) { D.errors.meet = e; }
  if (!rootEl) return;
  if (full) { paint(); return; }
  paintPart('[data-block="meetStats"]', blockMeetStats());
  paintPart('[data-block="meetTable"]', blockMeetTable());
}
async function searchMembers(term) {
  if (String(term || '').trim().length < 2) return [];
  try { const r = await api.get('/api/v2/meetups-ops/members?q=' + encodeURIComponent(String(term).trim())); return (r && r.members) || []; }
  catch (e) { return []; }
}
async function openAtt(id) {
  st.drawer = 'att';
  st.att = { id, data: null, busy: true, add: { mode: 'member', q: '', results: [], busy: false, notify: true } };
  paintPart('[data-block="meetDrawer"]', blockMeetDrawer());
  try { st.att.data = await api.get(meetUrl(id, '/attendees')); } catch (e) { ui.toast(e.message, { kind: 'error' }); st.att.data = { confirmed: [], waitlist: [], invited: [], declined: [], cancelled: [] }; }
  st.att.busy = false;
  if (rootEl && st.drawer === 'att') { paintPart('[data-block="meetDrawer"]', blockMeetDrawer()); scrollDrawer(); }
}
async function openInv(id) {
  st.drawer = 'inv';
  st.inv = { id, data: null, busy: true, q: '', results: [], picked: [], raw: '', preview: null };
  paintPart('[data-block="meetDrawer"]', blockMeetDrawer());
  try { st.inv.data = await api.get(meetUrl(id, '/invites')); } catch (e) { ui.toast(e.message, { kind: 'error' }); st.inv.data = { invited: [], accepted: [], declined: [], summary: { invited: 0, accepted: 0, declined: 0 } }; }
  st.inv.busy = false;
  if (rootEl && st.drawer === 'inv') { paintPart('[data-block="meetDrawer"]', blockMeetDrawer()); scrollDrawer(); }
}
function scrollDrawer() { const d = rootEl && rootEl.querySelector('#meetDrawer'); if (d && d.scrollIntoView) d.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
// the people the invite drawer will actually mail: picked members + whatever was pasted
function invPeople() {
  const s = st.inv;
  const out = (s.picked || []).map(p => ({ email: p.email, name: p.name || undefined }));
  const seen = new Set(out.map(p => String(p.email).toLowerCase()));
  String(s.raw || '').split(/[\s,;]+/).map(x => x.trim()).filter(Boolean).forEach(e => {
    if (seen.has(e.toLowerCase())) return;
    seen.add(e.toLowerCase()); out.push({ email: e });
  });
  return out;
}

async function reload(keys) {
  // partial refresh: re-run only the touched reads, then repaint
  const calls = {
    speakers: () => api.get('/api/admin/plexus/speakers'),
    meta: () => api.get('/api/v2/plexus-hub/speaker-meta'),
    sessions: () => api.get('/api/admin/plexus/sessions'),
    forms: () => api.get('/api/admin/signup-forms'),
    qa: () => api.get('/api/admin/plexus/qa'),
    conf: () => api.get('/api/conferences/active', { noAuth: true }),
    pstatus: () => api.get('/api/admin/project-status')
  };
  for (const k of keys) {
    try {
      const v = await calls[k]();
      if (k === 'speakers') D.speakers = Array.isArray(v) ? v : [];
      else if (k === 'meta') D.meta = (v && v.meta) || {};
      else if (k === 'sessions') D.sessions = Array.isArray(v) ? v : [];
      else if (k === 'forms') D.forms = Array.isArray(v) ? v : [];
      else if (k === 'qa') D.qa = Array.isArray(v) ? v : [];
      else if (k === 'conf') { D.conf = v || {}; D.cap = Number(D.conf.max_capacity) || FACTS.plexus.cap; D.days = Math.max(0, fmt.daysUntil(D.conf.start_date || FACTS.plexus.start) || 0); }
      else if (k === 'pstatus') D.pstatus = (Array.isArray(v) ? v : []).find(p => p.project_key === 'plexus') || D.pstatus;
    } catch (e) { /* keep the stale slice — the toast already reported the write result */ }
  }
  paint();
}

function readSpDraft() {
  return { name: val('spName'), title: val('spTitle'), institution: val('spInst'), email: val('spEmail'), talk_title: val('spTalk'), is_keynote: checked('spKeynote'), logo: val('spLogo'), event_tag: val('spTag') };
}
function readSsDraft() {
  return { title: val('ssTitle'), day: Number(val('ssDay')) || 1, start_time: val('ssStart'), end_time: val('ssEnd'), room: val('ssRoom'), session_type: val('ssType') || 'talk', is_published: checked('ssPub') };
}

const handlers = {
  // ---- title row
  msFocus: () => { const el = rootEl.querySelector('#members-card'); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); const i = rootEl.querySelector('[data-role="msLabel"]'); if (i) i.focus(); } },
  editConf: () => {
    const c = COPY.confModal, conf = D.conf;
    const inp = (role, label, valv, type = 'text', extra = '') => `<div style="margin-top:10px"><div style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:#6d6459">${label}</div><input data-role="${role}" type="${type}" value="${esc(valv == null ? '' : valv)}" ${extra} style="width:100%;box-sizing:border-box;margin-top:5px;background:#f6f2ea;border:1px solid rgba(32,27,22,.25);padding:9px 11px;font:400 13px Inter,sans-serif;color:#201b16"></div>`;
    const m = ui.modal({
      eyebrow: c.eyebrow, title: c.title,
      body: `<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 12px">${inp('cfStart', c.start, String(conf.start_date || '').slice(0, 10), 'date')}${inp('cfEnd', c.end, String(conf.end_date || '').slice(0, 10), 'date')}${inp('cfVenue', c.venue, conf.venue_name)}${inp('cfCity', c.vcity, conf.venue_city)}${inp('cfCap', c.cap, conf.max_capacity, 'number', 'min="1" step="1"')}<label style="display:flex;gap:8px;align-items:center;font-size:12.5px;color:#4a4239;margin-top:26px;cursor:pointer"><input type="checkbox" data-role="cfOpen"${Number(conf.registration_open) ? ' checked' : ''}> ${c.open}</label></div>`,
      actions: [
        { label: c.cancel },
        { label: c.save, kind: 'primary', onClick: () => {
          const g = r => { const el = m.el.querySelector(`[data-role="${r}"]`); return el ? el.value.trim() : ''; };
          const cap = Number(g('cfCap'));
          if (!Number.isInteger(cap) || cap < 1) { ui.toast(c.capBad, { kind: 'error' }); return false; }
          const body = { start_date: g('cfStart') || conf.start_date, end_date: g('cfEnd') || conf.end_date, venue_name: g('cfVenue'), venue_city: g('cfCity'), max_capacity: cap, registration_open: m.el.querySelector('[data-role="cfOpen"]').checked ? 1 : 0 };
          api.put('/api/admin/conferences/' + encodeURIComponent(conf.id), body)
            .then(() => { ui.toast(c.saved); reload(['conf']); })
            .catch(e => ui.toast(e.message, { kind: 'error' }));
        } }
      ]
    });
  },
  // ---- BEFORE list
  editList: () => ui.toast(COPY.before.editListToast),
  openSpeakers: () => { st.openPanel = st.openPanel === 'speakers' ? null : 'speakers'; st.spEdit = null; st.spDraft = blankSp(); paint(); if (st.openPanel) { const r = rootEl.querySelector('[data-block="spPanel"]'); if (r) r.scrollIntoView({ behavior: 'smooth', block: 'center' }); } },
  openSchedule: () => { st.openPanel = st.openPanel === 'schedule' ? null : 'schedule'; st.ssEdit = null; st.ssDraft = blankSs(); paint(); },
  openQa: () => { st.openPanel = st.openPanel === 'qa' ? null : 'qa'; paint(); },
  formToggle: async (el) => {
    const id = el.dataset.id, cur = el.dataset.status;
    const next = cur === 'open' ? 'closed' : 'open';
    el.setAttribute('aria-disabled', 'true');
    try { await api.put('/api/admin/signup-forms/' + encodeURIComponent(id), { status: next }); ui.toast(COPY.before.forms.toggled(next)); await reload(['forms']); }
    catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  cmeExport: async (el) => {
    if (!D.cme) { ui.toast(COPY.before.cme.offStatus.toUpperCase()); return; }
    el.setAttribute('aria-disabled', 'true');
    try {
      const res = await fetch('/api/admin/cme/events/' + encodeURIComponent(D.cme.conference_id) + '/export.csv', { headers: { Authorization: 'Bearer ' + session.token } });
      if (!res.ok) throw new Error(COPY.before.cme.exportFail);
      const blob = await res.blob();
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'plexus-cme-hlk.csv'; a.click(); URL.revokeObjectURL(a.href);
      ui.toast(COPY.before.cme.exported);
    } catch (e) { ui.toast(e.message || COPY.before.cme.exportFail, { kind: 'error' }); }
    el.removeAttribute('aria-disabled');
  },
  // ---- speakers panel
  spSave: async (el) => {
    const d = readSpDraft();
    if (!d.name) { ui.toast(COPY.sp.nameFirst); return; }
    el.setAttribute('aria-disabled', 'true');
    try {
      let id = st.spEdit;
      if (id) {
        await api.put('/api/admin/plexus/speakers/' + encodeURIComponent(id), { name: d.name, title: d.title, institution: d.institution, email: d.email, talk_title: d.talk_title, is_keynote: d.is_keynote });
      } else {
        const r = await api.post('/api/admin/plexus/speakers', { name: d.name, title: d.title, institution: d.institution, email: d.email, talk_title: d.talk_title, is_keynote: d.is_keynote, year: FACTS.year });
        id = r && (r.speaker_id || r.id);
      }
      if (id && (d.logo || d.event_tag || (D.meta[id] && (D.meta[id].institution_logo_url || D.meta[id].event_tag)))) {
        await api.put('/api/v2/plexus-hub/speakers/' + encodeURIComponent(id) + '/meta', { institution_logo_url: d.logo || null, event_tag: d.event_tag || null });
      }
      ui.toast(st.spEdit ? COPY.sp.saved : COPY.sp.added);
      st.spEdit = null; st.spDraft = blankSp();
      await reload(['speakers', 'meta']);
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  spCancel: () => { st.spEdit = null; st.spDraft = blankSp(); paint(); },
  spEditBtn: (el) => {
    const sp = D.speakers.find(s => s.id === el.dataset.id); if (!sp) return;
    const meta = D.meta[sp.id] || {};
    st.spEdit = sp.id;
    st.spDraft = { name: sp.name || '', title: sp.title || '', institution: sp.institution || '', email: sp.email || '', talk_title: sp.talk_title || '', is_keynote: !!Number(sp.is_keynote), logo: meta.institution_logo_url || '', event_tag: meta.event_tag || '' };
    paint();
    const i = rootEl.querySelector('[data-role="spName"]'); if (i) { i.focus(); i.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  },
  spDel: async (el) => {
    const sp = D.speakers.find(s => s.id === el.dataset.id); if (!sp) return;
    const ok = await ui.confirm({ title: COPY.sp.delAsk(sp.name), ok: COPY.sp.delOk, cancel: COPY.sp.delKeep });
    if (!ok) return;
    try { await api.del('/api/admin/plexus/speakers/' + encodeURIComponent(sp.id)); ui.toast(COPY.sp.deleted); if (st.spEdit === sp.id) { st.spEdit = null; st.spDraft = blankSp(); } await reload(['speakers', 'meta']); }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  spConfirm: async (el) => {
    const sp = D.speakers.find(s => s.id === el.dataset.id); if (!sp) return;
    const next = String(sp.confirmation_status || '') === 'confirmed' ? 'pending' : 'confirmed';
    el.setAttribute('aria-disabled', 'true');
    try { await api.put('/api/admin/plexus/speakers/' + encodeURIComponent(sp.id), { confirmation_status: next }); ui.toast(next === 'confirmed' ? COPY.sp.confirmedOn : COPY.sp.confirmedOff); await reload(['speakers']); }
    catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  spLive: async (el) => {
    const sp = D.speakers.find(s => s.id === el.dataset.id); if (!sp) return;
    const next = !(Number(sp.is_confirmed) && Number(sp.is_published));
    el.setAttribute('aria-disabled', 'true');
    try { await api.put('/api/admin/plexus/speakers/' + encodeURIComponent(sp.id) + '/publish', { is_published: next }); ui.toast(next ? COPY.sp.liveOn(sp.name) : COPY.sp.liveOff); await reload(['speakers']); }
    catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  spUpload: () => { const f = rootEl.querySelector('[data-role="spPhotoFile"]'); if (f) f.click(); },
  // ---- schedule panel
  ssSave: async (el) => {
    const d = readSsDraft();
    if (!d.title) { ui.toast(COPY.ss.titleFirst); return; }
    el.setAttribute('aria-disabled', 'true');
    try {
      if (st.ssEdit) await api.put('/api/admin/plexus/sessions/' + encodeURIComponent(st.ssEdit), d);
      else await api.post('/api/admin/plexus/sessions', d);
      ui.toast(st.ssEdit ? COPY.ss.saved : COPY.ss.added);
      st.ssEdit = null; st.ssDraft = blankSs();
      await reload(['sessions']);
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  ssCancel: () => { st.ssEdit = null; st.ssDraft = blankSs(); paint(); },
  ssEditBtn: (el) => {
    const s = D.sessions.find(x => x.id === el.dataset.id); if (!s) return;
    st.ssEdit = s.id;
    st.ssDraft = { title: s.title || '', day: Number(s.day) || 1, start_time: s.start_time || '', end_time: s.end_time || '', room: s.room || '', session_type: s.session_type || 'talk', is_published: !!Number(s.is_published) };
    paint();
    const i = rootEl.querySelector('[data-role="ssTitle"]'); if (i) { i.focus(); i.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  },
  ssDel: async (el) => {
    const s = D.sessions.find(x => x.id === el.dataset.id); if (!s) return;
    const ok = await ui.confirm({ title: COPY.ss.delAsk(s.title), ok: COPY.ss.delOk, cancel: COPY.ss.delKeep });
    if (!ok) return;
    try { await api.del('/api/admin/plexus/sessions/' + encodeURIComponent(s.id)); ui.toast(COPY.ss.deleted); if (st.ssEdit === s.id) { st.ssEdit = null; st.ssDraft = blankSs(); } await reload(['sessions']); }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  ssPubOne: async (el) => {
    const s = D.sessions.find(x => x.id === el.dataset.id); if (!s) return;
    const next = !Number(s.is_published);
    el.setAttribute('aria-disabled', 'true');
    try { await api.put('/api/admin/plexus/sessions/' + encodeURIComponent(s.id) + '/publish', { is_published: next }); ui.toast(next ? COPY.ss.published : COPY.ss.unpublished); await reload(['sessions']); }
    catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  ssPubAll: async () => {
    const drafts = D.sessions.filter(s => !Number(s.is_published));
    if (!drafts.length) { ui.toast(COPY.ss.pubAllNone); return; }
    const ok = await ui.confirm({ title: COPY.ss.pubAllAsk(drafts.length), ok: COPY.ss.pubAllOk, cancel: COPY.ss.delKeep });
    if (!ok) return;
    try { const r = await api.post('/api/admin/plexus/sessions/bulk-publish', { session_ids: drafts.map(s => s.id) }); ui.toast(COPY.ss.pubAllDone((r && r.published) || drafts.length)); await reload(['sessions']); }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  // ---- Q&A panel
  qaAnswer: (el) => {
    const qrow = D.qa.find(x => x.id === el.dataset.id); if (!qrow) return;
    const c = COPY.qa.modal;
    const m = ui.modal({
      eyebrow: c.eyebrow, title: c.title,
      body: `<div style="font-size:12.5px;color:#4a4239;margin-bottom:10px">“${esc(qrow.text)}”</div><textarea data-role="qaText" rows="3" style="width:100%;box-sizing:border-box;background:#f6f2ea;border:1px solid rgba(32,27,22,.25);padding:10px 12px;font:400 13px Inter,sans-serif;color:#201b16;resize:vertical"></textarea>`,
      actions: [
        { label: c.cancel },
        { label: c.send, kind: 'primary', onClick: () => {
          const t = m.el.querySelector('[data-role="qaText"]').value.trim();
          if (!t) { ui.toast(c.empty); return false; }
          api.post('/api/admin/plexus/qa/' + encodeURIComponent(qrow.id) + '/answer', { answer_text: t })
            .then(() => { ui.toast(COPY.qa.answeredToast); reload(['qa']); })
            .catch(e => ui.toast(e.message, { kind: 'error' }));
        } }
      ]
    });
    const ta = m.el.querySelector('[data-role="qaText"]'); if (ta) ta.focus();
  },
  qaHide: async (el) => {
    const hidden = el.dataset.hidden === '1';
    el.setAttribute('aria-disabled', 'true');
    try { await api.post('/api/admin/plexus/qa/' + encodeURIComponent(el.dataset.id) + '/hide', { hidden: !hidden }); ui.toast(hidden ? COPY.qa.shown : COPY.qa.hidden); await reload(['qa']); }
    catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  // ---- after the week
  start2027: () => {
    if (!weekOver()) { ui.toast(COPY.after.notYet(afterLabel())); return; }
    ui.toast(COPY.after.notYet(afterLabel())); // carry-over ships with the editions tool — same message until then
  },
  archiveNote: () => ui.toast(COPY.after.notYet(afterLabel())),
  peOpen: async () => {
    const c = COPY.after.peModal;
    let facts = null;
    try { facts = await api.get('/api/admin/post-event/assemble/facts?event_key=plexus'); } catch (e) {}
    const pe = D.pe || {};
    const line = (k, v) => v == null || v === '' ? '' : `<div style="display:flex;gap:10px;justify-content:space-between;padding:7px 0;border-bottom:1px solid rgba(32,27,22,.07);font-size:12.5px"><span style="color:#6d6459">${esc(k)}</span><b>${esc(String(v))}</b></div>`;
    ui.modal({
      eyebrow: c.eyebrow, title: c.title,
      body: `
        ${line('Certificates issued', pe.certificates_issued != null ? pe.certificates_issued : (pe.certs && pe.certs.issued))}
        ${line('Checked in', pe.checked_in != null ? pe.checked_in : (facts && facts.checked_in))}
        ${line('Speakers on file', facts && facts.speakers_count)}
        ${line('Published sessions', facts && facts.sessions_count)}
        ${line('Event ends', fmt.longRange(D.conf.end_date || FACTS.plexus.end))}
        <div style="font-size:12px;color:#6d6459;margin-top:12px;line-height:1.6">${esc(COPY.after.line(afterLabel()))} Every certificate and thank-you stages to the Outbox — nothing emails a member without your OK there.</div>`,
      actions: [{ label: c.close, kind: 'primary' }]
    });
  },
  editionsOpen: () => {
    const c = COPY.edModal;
    const rows = D.editions.editions || [];
    ui.modal({
      eyebrow: c.eyebrow, title: c.title,
      body: `${rows.map(e => `<div style="display:flex;gap:10px;align-items:baseline;padding:8px 0;border-bottom:1px solid rgba(32,27,22,.07)"><span class="tag${e.status === 'active' ? ' tag-live' : ''}">${esc(String(e.status || '').toUpperCase())}</span><b style="font-size:13px">${esc(e.label || '')}</b><span style="font-size:12px;color:#6d6459">${esc(e.year != null ? String(e.year) : '')}${e.start_date ? ' · ' + esc(fmt.rangeLabel(e.start_date, e.end_date)) : ''}</span></div>`).join('') || `<div style="font-size:12.5px;color:#6d6459">No editions on file yet.</div>`}
      <div style="font-size:12px;color:#6d6459;margin-top:12px;line-height:1.6">${c.note}</div>`,
      actions: [{ label: c.close, kind: 'primary' }]
    });
  },
  // ---- what members see
  msSave: async (el) => {
    const body = { status_label: val('msLabel'), detail_line: val('msDetail') };
    el.setAttribute('aria-disabled', 'true');
    try {
      await api.put('/api/admin/project-status/plexus', body);
      st.msSaved = true;
      await reload(['pstatus']);
    } catch (e) { ui.toast(COPY.members.failed, { kind: 'error' }); }
    el.removeAttribute('aria-disabled');
  },
  // ---- stats widget
  ovEdit: (el) => { st.ovEdit = el.dataset.key; paint(); const i = rootEl.querySelector('[data-role="ovInput"]'); if (i) { i.focus(); i.select(); } },
  ovSave: async (el) => {
    const key = el.dataset.key;
    const v = val('ovInput');
    el.setAttribute('aria-disabled', 'true');
    try {
      const r = await api.put('/api/v2/plexus-hub/stats-overrides/' + STATS_SCOPE, { figure_key: key, value: v });
      D.overrides = (r && r.overrides) || {};
      st.ovEdit = null;
      ui.toast(v ? COPY.widget.overridden : COPY.widget.cleared);
      paint();
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  ovClear: async (el) => {
    try {
      const r = await api.put('/api/v2/plexus-hub/stats-overrides/' + STATS_SCOPE, { figure_key: el.dataset.key, value: null });
      D.overrides = (r && r.overrides) || {};
      ui.toast(COPY.widget.cleared);
      paint();
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  copyStats: async () => { ui.toast((await copyText(statsLine())) ? COPY.widget.copied : COPY.widget.copyFail); },

  // ================================ v2 2026-09-11: edition switcher ==============================
  edToggle: () => { st.edOpen = !st.edOpen; paintPart('[data-block="title"]', blockTitle()); },

  // ================================ v2 2026-09-11: MEETUPS =======================================
  mNew: () => { st.drawer = 'form'; st.form = blankForm(); paintPart('[data-block="meetDrawer"]', blockMeetDrawer()); scrollDrawer(); const i = rootEl.querySelector('[data-role="fTitle"]'); if (i) i.focus(); },
  mEdit: (el) => {
    const m = meetById(el.dataset.id); if (!m) return;
    st.drawer = 'form'; st.form = formFrom(m);
    paintPart('[data-block="meetDrawer"]', blockMeetDrawer()); scrollDrawer();
    const i = rootEl.querySelector('[data-role="fTitle"]'); if (i) i.focus();
  },
  mDrawerClose: () => { st.drawer = null; st.form = null; st.att = null; st.inv = null; paintPart('[data-block="meetDrawer"]', blockMeetDrawer()); },
  mCapMinus: () => { syncForm(); st.form.capacity = Math.max(CAP_MIN, (Number(st.form.capacity) || 8) - 1); const i = rootEl.querySelector('[data-role="fCapacity"]'); if (i) i.value = st.form.capacity; },
  mCapPlus: () => { syncForm(); st.form.capacity = Math.min(CAP_MAX, (Number(st.form.capacity) || 8) + 1); const i = rootEl.querySelector('[data-role="fCapacity"]'); if (i) i.value = st.form.capacity; },
  mHostMode: (el) => {
    syncForm();
    st.form.hostMode = el.dataset.mode === 'free' ? 'free' : 'member';
    if (st.form.hostMode === 'free') st.form.host_user_id = null; else { st.form.hostQ = ''; st.form.hostResults = []; }
    paintPart('[data-block="meetDrawer"]', blockMeetDrawer());
    const i = rootEl.querySelector(st.form.hostMode === 'free' ? '[data-role="fHostName"]' : '[data-role="fHostQ"]'); if (i) i.focus();
  },
  mHostPick: (el) => {
    syncForm();
    const f = st.form;
    f.host_user_id = el.dataset.id; f.host_name = el.dataset.name || ''; f.host_email = el.dataset.email || ''; f.host_title = el.dataset.line || '';
    f.hostQ = ''; f.hostResults = [];
    paintPart('[data-block="meetDrawer"]', blockMeetDrawer());
  },
  mHostClear: () => {
    syncForm();
    const f = st.form;
    f.host_user_id = null; f.host_name = ''; f.host_email = ''; f.host_title = ''; f.hostQ = ''; f.hostResults = [];
    paintPart('[data-block="meetDrawer"]', blockMeetDrawer());
  },
  mSave: async (el) => {
    syncForm();
    const f = st.form;
    if (!f.title) { ui.toast(COPY.meet.form.needTitle); return; }
    if (!f.starts_at) { ui.toast(COPY.meet.form.needStart); return; }
    const body = {
      title: f.title, kind: f.kind, description: f.description || null, audience: f.audience || null,
      tags: String(f.tags || '').split(',').map(s => s.trim()).filter(Boolean),
      venue_name: f.venue_name || null, venue_address: f.venue_address || null, venue_map_url: f.venue_map_url || null,
      starts_at: f.starts_at, ends_at: f.ends_at || null,
      capacity: Math.max(CAP_MIN, Math.min(CAP_MAX, Number(f.capacity) || 8)),
      waitlist_enabled: !!f.waitlist_enabled, visibility: f.visibility || 'open',
      host_user_id: f.hostMode === 'member' ? (f.host_user_id || null) : null,
      host_name: f.host_name || null, host_title: f.host_title || null, host_email: f.host_email || null
    };
    el.setAttribute('aria-disabled', 'true');
    try {
      if (f.id) await api.put('/api/v2/meetups-ops/meetups/' + encodeURIComponent(f.id), body);
      else await api.post('/api/v2/meetups-ops/meetups', Object.assign({ edition_id: st.editionId || undefined }, body));
      ui.toast(f.id ? COPY.meet.form.saved : COPY.meet.form.created);
      st.drawer = null; st.form = null;
      await reloadMeet(true);
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  mPublish: async (el) => {
    const m = meetById(el.dataset.id); if (!m) return;
    const next = m.status !== 'published';
    if (next && !m.host_name && !m.host_email) { ui.toast(COPY.meet.publish.needHost); return; }
    el.setAttribute('aria-disabled', 'true');
    try { await api.post(meetUrl(m.id, '/publish'), { published: next }); ui.toast(next ? COPY.meet.publish.on(m.title) : COPY.meet.publish.off); await reloadMeet(); }
    catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  // cancelling emails EVERY holder and every waitlisted person — the modal says so in as many words
  mCancelMeetup: (el) => {
    const m = meetById(el.dataset.id); if (!m) return;
    const c = COPY.meet.cancelM;
    const mod = ui.modal({
      eyebrow: c.eyebrow, title: c.title(m.title),
      body: `
        <div style="border:1px solid #9b1b22;background:#f8e9ea;padding:11px 13px;font-size:12.5px;color:#9b1b22;line-height:1.6">${esc(c.warn)}</div>
        <div style="margin-top:12px">${fLab(c.reason)}<textarea data-role="cReason" rows="2" placeholder="${esc(c.reasonPh)}" aria-label="${esc(c.reason)}" style="width:100%;box-sizing:border-box;margin-top:5px;resize:vertical;${INPUT2}"></textarea></div>
        <label style="display:flex;gap:8px;align-items:center;font-size:12.5px;color:#4a4239;margin-top:10px;cursor:pointer"><input type="checkbox" data-role="cNotify" checked> ${esc(c.notify)}</label>`,
      actions: [
        { label: c.keep },
        { label: c.go, kind: 'primary', onClick: () => {
          const reason = (mod.el.querySelector('[data-role="cReason"]') || {}).value || '';
          const notify = !!(mod.el.querySelector('[data-role="cNotify"]') || {}).checked;
          api.post('/api/v2/meetups-ops/meetups/' + encodeURIComponent(m.id) + '/cancel', { reason: reason.trim() || undefined, notify })
            .then(r => { ui.toast(c.done(r && r.notified)); return reloadMeet(); })
            .catch(e => ui.toast(e.message, { kind: 'error' }));
        } }
      ]
    });
  },
  mDelete: async (el) => {
    const m = meetById(el.dataset.id); if (!m) return;
    const ok = await ui.confirm({ title: COPY.meet.del.ask(m.title), ok: COPY.meet.del.ok, cancel: COPY.meet.del.keep });
    if (!ok) return;
    try { await api.del('/api/v2/meetups-ops/meetups/' + encodeURIComponent(m.id)); ui.toast(COPY.meet.del.done); if (st.drawer && (st.form || st.att || st.inv)) { st.drawer = null; st.form = st.att = st.inv = null; } await reloadMeet(true); }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  mHostLink: async (el) => {
    const m = meetById(el.dataset.id); if (!m) return;
    try {
      const r = await api.get('/api/v2/meetups-ops/meetups/' + encodeURIComponent(m.id) + '/host-link');
      if (!r || !r.host_link) { ui.toast(COPY.meet.hostLink.none); return; }
      ui.toast((await copyText(r.host_link)) ? COPY.meet.hostLink.copied : COPY.meet.hostLink.failed);
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  mCsv: async (el) => {
    const m = meetById(el.dataset.id); if (!m) return;
    try {
      const blob = await fetchBlob('/api/v2/meetups-ops/meetups/' + encodeURIComponent(m.id) + '/attendees.csv');
      dl(blob, 'medx-meetup-' + (String(m.title || 'meetup').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'meetup') + '.csv');
      ui.toast(COPY.meet.att.csvDone);
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  // ---- attendees drawer
  mAtt: (el) => openAtt(el.dataset.id),
  mAttCsv: (el) => handlers.mCsv(el),
  mAttMode: (el) => {
    st.att.add.notify = checked('aNotify');   // keep the operator's choice across the repaint
    st.att.add.mode = el.dataset.mode === 'email' ? 'email' : 'member';
    st.att.add.q = ''; st.att.add.results = [];
    paintPart('[data-block="meetDrawer"]', blockMeetDrawer());
  },
  mAttPick: (el) => addAttendee({ user_id: el.dataset.id }, el.dataset.name || el.dataset.email),
  mAttAdd: () => {
    const email = val('aEmail');
    if (!email || email.indexOf('@') < 1) { ui.toast(COPY.meet.att.needEmail); return; }
    addAttendee({ email, name: val('aName') || undefined, institution: val('aInst') || undefined, position: val('aPos') || undefined }, val('aName') || email);
  },
  mPromote: async (el) => {
    try { const r = await api.post('/api/v2/meetups-ops/attendees/' + encodeURIComponent(el.dataset.id) + '/promote', {}); ui.toast(COPY.meet.att.promoted((r && r.attendee && r.attendee.name) || '')); await refreshAtt(); }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  mCheckin: async (el) => {
    const on = el.dataset.on !== '1';
    try { const r = await api.post('/api/v2/meetups-ops/attendees/' + encodeURIComponent(el.dataset.id) + '/checkin', { checked_in: on }); ui.toast(on ? COPY.meet.att.checkedOn((r && r.attendee && r.attendee.name) || '') : COPY.meet.att.checkedOff); await refreshAtt(); }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  mAttCancel: async (el) => {
    const who = attById(el.dataset.id);
    const ok = await ui.confirm({ title: COPY.meet.att.cancelAsk((who && who.name) || 'this person'), ok: COPY.meet.att.cancelOk, cancel: COPY.meet.att.cancelKeep });
    if (!ok) return;
    try { const r = await api.post('/api/v2/meetups-ops/attendees/' + encodeURIComponent(el.dataset.id) + '/cancel', {}); ui.toast(r && r.promoted ? COPY.meet.att.freedUp(r.promoted.name || '') : COPY.meet.att.freed); await refreshAtt(); }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  mAttRemove: async (el) => {
    const who = attById(el.dataset.id);
    const ok = await ui.confirm({ title: COPY.meet.att.removeAsk((who && who.name) || 'this person'), ok: COPY.meet.att.removeOk, cancel: COPY.meet.att.removeKeep });
    if (!ok) return;
    try { await api.del('/api/v2/meetups-ops/attendees/' + encodeURIComponent(el.dataset.id)); ui.toast(COPY.meet.att.removed); await refreshAtt(); }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  // ---- invites drawer
  mInv: (el) => openInv(el.dataset.id),
  mInvPick: (el) => {
    const s = st.inv;
    const email = el.dataset.email;
    if (!email) return;
    if (!s.picked.some(p => String(p.email).toLowerCase() === email.toLowerCase())) s.picked.push({ email, name: el.dataset.name || '' });
    s.raw = raw('iRaw'); s.q = ''; s.results = []; s.preview = null;
    paintPart('[data-block="meetDrawer"]', blockMeetDrawer());
  },
  mInvDrop: (el) => { const s = st.inv; s.raw = raw('iRaw'); s.picked.splice(Number(el.dataset.i), 1); s.preview = null; paintPart('[data-block="meetDrawer"]', blockMeetDrawer()); },
  mInvPreview: async (el) => {
    const s = st.inv;
    s.raw = raw('iRaw');
    const people = invPeople();
    if (!people.length) { ui.toast(COPY.meet.inv.previewNone.toUpperCase()); return; }
    el.setAttribute('aria-disabled', 'true');
    try { s.preview = await api.post('/api/v2/meetups-ops/meetups/' + encodeURIComponent(s.id) + '/invites', { people, preview: true }); paintPart('[data-block="meetDrawer"]', blockMeetDrawer()); }
    catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  mInvSend: async (el) => {
    const s = st.inv;
    s.raw = raw('iRaw');
    const people = invPeople();
    if (!people.length) { ui.toast(COPY.meet.inv.previewNone.toUpperCase()); return; }
    const ok = await ui.confirm({ title: COPY.meet.inv.sendAsk(people.length), ok: COPY.meet.inv.sendOk, cancel: COPY.meet.inv.sendKeep });
    if (!ok) return;
    el.setAttribute('aria-disabled', 'true');
    try {
      const r = await api.post('/api/v2/meetups-ops/meetups/' + encodeURIComponent(s.id) + '/invites', { people });
      ui.toast(COPY.meet.inv.sent((r && r.invited) || 0, (r && r.mailed) || 0));
      if (r && r.skipped && r.skipped.length) setTimeout(() => ui.toast(COPY.meet.inv.skipped(r.skipped.length)), 900);
      s.picked = []; s.raw = ''; s.preview = null; s.q = ''; s.results = [];
      try { s.data = await api.get('/api/v2/meetups-ops/meetups/' + encodeURIComponent(s.id) + '/invites'); } catch (e2) {}
      paintPart('[data-block="meetDrawer"]', blockMeetDrawer());
      await reloadMeet();
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  }
};

// ---- meetups helpers the handlers lean on ------------------------------------------------------
function attById(id) {
  const d = (st.att && st.att.data) || {};
  return ['confirmed', 'waitlist', 'invited', 'declined', 'cancelled'].reduce((hit, k) => hit || (d[k] || []).find(a => String(a.id) === String(id)) || null, null);
}
async function refreshAtt() {
  if (!st.att) return;
  try { st.att.data = await api.get('/api/v2/meetups-ops/meetups/' + encodeURIComponent(st.att.id) + '/attendees'); } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  if (rootEl && st.drawer === 'att') paintPart('[data-block="meetDrawer"]', blockMeetDrawer());
  await reloadMeet();
}
async function addAttendee(body, who) {
  const notify = checked('aNotify');
  try {
    const r = await api.post('/api/v2/meetups-ops/meetups/' + encodeURIComponent(st.att.id) + '/attendees', Object.assign({ notify }, body));
    if (r && r.already) ui.toast(COPY.meet.att.already);
    else ui.toast(r && r.status === 'waitlisted' ? COPY.meet.att.addedWait(who || '') : COPY.meet.att.addedIn(who || ''));
    st.att.add.q = ''; st.att.add.results = [];
    await refreshAtt();
  } catch (e) { ui.toast(e.message, { kind: 'error' }); }
}

// An archived edition is READ ONLY (design/MEETUPS-SPEC.md §1): the write affordances are already
// hidden in the markup — this refuses the handler too, so a stale button or a keyboard Enter on one
// can never write into a closed year.
const RO_SAFE = new Set(['edToggle', 'msFocus', 'openSpeakers', 'openSchedule', 'openQa', 'copyStats', 'peOpen', 'editionsOpen', 'cmeExport', 'editList', 'archiveNote', 'start2027',
  'mAtt', 'mInv', 'mHostLink', 'mCsv', 'mAttCsv', 'mDrawerClose']);
function bindHandlers(root) {
  const wrapped = {};
  Object.keys(handlers).forEach(k => {
    wrapped[k] = (el, ev) => {
      if (isArchived() && !RO_SAFE.has(k)) { ui.toast(COPY.ed.roToast); return; }
      return handlers[k](el, ev);
    };
  });
  return ui.bind(root, wrapped);
}

// photo upload (delegated change event — survives repaints)
async function onChange(e) {
  const input = e.target.closest && e.target.closest('[data-role="spPhotoFile"]');
  if (!input || !input.files || !input.files[0] || !st.spEdit) return;
  st.spDraft = readSpDraft(); // keep unsaved edit-form fields across the repaint below
  const fd = new FormData();
  fd.append('file', input.files[0]);
  try {
    const up = await api.post('/api/upload/speakers', fd);
    if (!up || !up.file_url) throw new Error('Upload failed');
    await api.put('/api/admin/plexus/speakers/' + encodeURIComponent(st.spEdit), { photo_url: up.file_url });
    ui.toast(COPY.sp.photoUp);
    await reload(['speakers']);
  } catch (err) { ui.toast(err.message, { kind: 'error' }); }
}
// v2 2026-09-11 — the three member pickers (host · manual add · invitations) share one debounce and
// repaint ONLY their own result list, so the search field never loses focus mid-word.
function pickerFor(t) {
  if (t.matches('[data-role="fHostQ"]')) return {
    block: 'hostResults', act: 'mHostPick', alive: () => !!st.form,
    set: (q, results, busy) => { if (!st.form) return; st.form.hostQ = q; if (results !== undefined) st.form.hostResults = results; if (busy !== undefined) st.form.hostBusy = busy; },
    read: () => st.form ? { q: st.form.hostQ, results: st.form.hostResults, busy: st.form.hostBusy } : null
  };
  if (t.matches('[data-role="aQ"]')) return {
    block: 'attResults', act: 'mAttPick', alive: () => !!(st.att && st.att.add),
    set: (q, results, busy) => { if (!(st.att && st.att.add)) return; st.att.add.q = q; if (results !== undefined) st.att.add.results = results; if (busy !== undefined) st.att.add.busy = busy; },
    read: () => (st.att && st.att.add) || null
  };
  if (t.matches('[data-role="iQ"]')) return {
    block: 'invResults', act: 'mInvPick', alive: () => !!st.inv,
    set: (q, results, busy) => { if (!st.inv) return; st.inv.q = q; if (results !== undefined) st.inv.results = results; if (busy !== undefined) st.inv.busy = busy; },
    read: () => st.inv || null
  };
  return null;
}
function paintPicker(p) { const bag = p.read(); if (bag) paintPart(`[data-block="${p.block}"]`, memberResults(p.block, p.act, bag)); }
// typing into the member card resets the ✓ SAVED state (artboard behaviour) without a repaint
function onInput(e) {
  const t = e.target;
  if (!t || !t.matches) return;
  const p = pickerFor(t);
  if (p) {
    if (!p.alive()) return;
    const q = t.value;
    clearTimeout(hostTimer);
    if (String(q).trim().length < 2) { p.set(q, [], false); paintPicker(p); return; }
    p.set(q, undefined, true);
    paintPicker(p);
    hostTimer = setTimeout(async () => {
      const rows = await searchMembers(q);
      if (!rootEl || !p.alive()) return;
      const bag = p.read();
      if (!bag || String(bag.q || '') !== q) return;   // the operator kept typing — a fresher call is coming
      p.set(q, rows, false);
      paintPicker(p);
    }, 250);
    return;
  }
  if (!(t.matches('[data-role="msLabel"]') || t.matches('[data-role="msDetail"]'))) return;
  if (!st.msSaved) return;
  st.msSaved = false;
  const b = rootEl.querySelector('[data-role="msSaveBtn"]');
  if (b) { b.style.background = '#9b1b22'; b.textContent = COPY.members.save; }
}

export default {
  title: 'Plexus Week 2026',
  async render(root, ctx) {
    rootEl = root;
    injectCss();
    // `:tab?` still carries the live panel deep links (speakers|schedule|qa) — they stay on the hub
    // tab and pre-open their inline panel exactly as before; 'meetups' is the only new tab slug.
    const slug = String((ctx.params && ctx.params.tab) || '').toLowerCase();
    const tab = SLUG_TO_TAB[slug] || 'hub';
    st = {
      tab,
      openPanel: PANEL_SLUGS.includes(slug) ? slug : null,
      editionId: (ctx.query && ctx.query.edition) ? String(ctx.query.edition) : null,
      edOpen: false,
      spEdit: null, spDraft: blankSp(), ssEdit: null, ssDraft: blankSs(),
      msSaved: false, ovEdit: null,
      drawer: null, form: null, att: null, inv: null
    };
    D = await load(tab, st.editionId);
    if (rootEl !== root) return; // navigated away while loading
    // an unknown ?edition= falls back to the active year (the server resolves the same way)
    if (st.editionId && !D.eds.some(e => e.id === st.editionId)) st.editionId = null;
    if (!st.editionId && D.edActive) st.editionId = D.edActive.id;
    root.innerHTML = template();
    unbind = bindHandlers(root);
    onChangeBound = onChange; root.addEventListener('change', onChangeBound);
    onInputBound = onInput; root.addEventListener('input', onInputBound);
  },
  destroy() {
    if (unbind) unbind(); unbind = null;
    clearTimeout(hostTimer); hostTimer = null;
    if (rootEl && onChangeBound) rootEl.removeEventListener('change', onChangeBound);
    if (rootEl && onInputBound) rootEl.removeEventListener('input', onInputBound);
    onChangeBound = null; onInputBound = null; rootEl = null; D = null; st = null;
  }
};
