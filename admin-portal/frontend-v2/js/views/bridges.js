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
  subShort: 'Evenings connecting Croatian & international biomedicine',   // the one-line phone subtitle
  manage: 'WHAT MEMBERS SEE — MANAGE ↗',
  // Event day (2026-09-21): the door scanner lives on /event-day (the Bridges door pre-selects
  // there) — on the day itself the hub and the Boston block both carry the shortcut to it.
  scanner: { cta: 'TONIGHT · OPEN THE DOOR SCANNER →' },
  // The phone cards (≤700 px) that stand in for the two Boston tables — same rows, same actions.
  card: { slides: 'slides', summary: 'summary', finished: 'finished ✓', requests: 'requests 📝', yes: '✓', no: '—',
    linkSent: d => `link sent ${d}`, linkNot: 'link not sent', emailSent: d => `Boston email ${d}`, emailNot: 'Boston email not sent',
    pref: 'preference', allergy: 'allergies', deck: 'deck', open: 'tap for actions', close: 'CLOSE ▴', decision: 'DECISION', files: 'FILES', nobody: 'Nobody in this group.' },
  next: (city, range) => `NEXT · ${city.toUpperCase()} · ${range}`, noNext: 'NEXT CITY — NOT SET',
  band: {
    events: (e, c, k) => `EVENTS · ${c} CITIES, ${k} COUNTRIES`, guests: 'GUESTS HOSTED',
    signups: (city, cap) => `${city.toUpperCase()} SIGN-UPS${cap ? ' · OF ' + cap : ''}`,
    days: (city, range) => `DAYS TO ${city.toUpperCase()} · ${range}`
  },
  events: {
    title: 'EVENTS', sub: 'one row per city — recaps publish to the member page',
    newCity: '+ NEW CITY', ncCity: 'City — e.g. Munich', ncWhen: 'When — e.g. Spring 2027', add: 'ADD',
    heldTitle: 'Start this evening’s recap — the next edition number, kept hidden from members until it has a guest count and a photo',
    recapMade: city => `${city.toUpperCase()} RECAP STARTED — ADD THE GUEST COUNT + A PHOTO, THEN SHOW IT`,
    added: city => `${city.toUpperCase()} ADDED — A DRAFT UNTIL YOU PUBLISH IT`, typeCity: 'TYPE THE CITY FIRST',
    upcoming: 'UPCOMING', held: 'JUST HELD · ADD RECAP', draft: 'DRAFT', manage: 'MANAGE →', openBoston: 'OPEN BOSTON →', close: 'CLOSE', recap: 'RECAP', edition: n => `EDITION ${String(n).padStart(2, '0')}`,
    venueTBA: 'Venue announced soon · exact date TBA', planTBA: 'Venue to scout',
    signups: (n, cap) => `${n} sign-up${n === 1 ? '' : 's'}${cap ? ' of ' + cap : ''}`,
    // The Boston row: MANAGE opens the Boston block below (presenters · the Boston email · catering);
    // the inline venue/date editor stays reachable as EDIT DETAILS. One line of counts on the row —
    // the numbers the row already has (sign-ups · checked in) plus the presenters read when it answered.
    editDetails: 'EDIT DETAILS',
    bostonLine: (n, cap, presenting, checkedIn) => `${n} sign-up${n === 1 ? '' : 's'}${cap ? ' of ' + cap : ''}` + (presenting == null ? '' : ` · ${presenting} presenting`) + ` · ${checkedIn} checked in`,
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
  // The fold around the Boston block (2026-09-17): closed by default, opened by MANAGE on the
  // Boston row or by /projects/bridges/boston, closed again from its own eyebrow bar.
  bostonBar: { eyebrow: 'BOSTON — MANAGE', close: 'CLOSE ✕' },
  // Boston's 5-minute presentations (2026-09-12). The member portal owns the upload links, the
  // files and the invite email (user-portal/backend/boston.js); this card is the organizer's door
  // to them — /api/v2/boston/presenters and friends.
  boston: {
    title: 'BOSTON · 5-MINUTE PRESENTATIONS', sub: 'the slides link is already inside the Boston email — this is the separate, presenters-only send',
    sendAll: n => `SLIDES LINK ONLY (PRESENTERS · ${n})`, allInvited: 'EVERYONE HAS THEIR LINK',
    zip: n => `DOWNLOAD ALL PRESENTATIONS (ZIP · ${n} ${n === 1 ? 'deck' : 'decks'})`, zipNone: 'NO PRESENTATIONS YET',
    // named after the person inside: Ruscic_Katarina.pptx / Ruscic_Katarina_summary.pdf
    sumZip: n => `DOWNLOAD ALL SUMMARIES (ZIP · ${n} ${n === 1 ? 'summary' : 'summaries'})`, sumZipNone: 'NO SUMMARIES YET',
    zipHint: 'files inside are named LastName_FirstName',
    add: '+ ADD A PRESENTER', addClose: 'CLOSE',
    phName: 'Full name — e.g. Dr. Ivana Kovač', phEmail: 'Email address', addSend: 'ADD & SEND THE LINK',
    cWho: 'PRESENTER', cInst: 'INSTITUTION', cPresents: 'DECISION', cDeck: 'DECK', cSummary: 'SUMMARY', cDone: 'FINISHED', cReq: 'REQUESTS', cSent: 'LINK SENT',
    send: 'SEND LINK', resend: 'RESEND', busy: 'SENDING…',
    deckYes: 'UPLOADED', deckLink: 'LINK ↗', deckNo: '–', notSent: 'not sent', byTeam: 'ADDED BY TEAM',
    summaryYes: '✓', finishedYes: '✓', reqNone: '–',
    // the filter chips over the presenters table (Alen 2026-09-16: "who accepted, who didn't, easy")
    filters: { all: 'ALL', confirmed: 'PRESENTS', panel: 'PANEL', declined: 'NOT THIS TIME', awaiting: 'AWAITING PANEL REPLY', requests: 'HAS REQUESTS' },
    programCsv: 'PROGRAM SHEET (CSV)',
    counts: (r, u, i) => `${r} presenting · ${u} uploaded · ${i} invited`,
    // The owner's pick. Far more people offered than the evening holds, so each row is his call:
    // presents, not this time, or still undecided — and the three counts always add up to the
    // number of offers, so a talk slot can never go missing between two screens.
    pick: { yes: 'PRESENTS ✓', panel: 'PANEL', no: 'NOT THIS TIME', unset: 'UNDECIDED', busy: '…' },
    pickCounts: (y, p, n, u) => `${y} confirmed · ${p} panel · ${n} declined · ${u} undecided`,
    panelReply: { yes: '✓ ACCEPTED', no: '✗ DECLINED', none: '– AWAITING' },
    declineAll: n => `SET ${n} UNDECIDED TO “NOT THIS TIME”`, declineAllNone: 'EVERY OFFER IS DECIDED',
    cPickTitle: (who, s) => s === 'confirmed' ? `Put ${who} on the running order?`
        : s === 'panel' ? `Invite ${who} to the panel?`
        : s === 'declined' ? `Tell ${who} there was no room?` : `Leave ${who} undecided again?`,
    cPickBody: s => s === 'panel'
        ? '<p style="margin:0 0 8px">Their Boston email invites them to the <b>panel discussion</b> instead of a talk — no slides step; their personal page asks them to accept or decline the seat.</p><p style="margin:0;color:#6d6459">Nothing is emailed by this — it only decides which shape they get.</p>'
        : s === 'confirmed'
        ? '<p style="margin:0 0 8px">They keep the slides step on their personal page and the Boston email asks them for a deck.</p><p style="margin:0;color:#6d6459">Nothing is emailed by this — it only decides which shape their Boston email takes.</p>'
        : s === 'declined'
            ? '<p style="margin:0 0 8px">Their Boston email becomes the warm shape: <b>their seat is confirmed</b> and said first, then why there was no room, then the invitation to come anyway and send a one-slide summary.</p><p style="margin:0;color:#6d6459">Nothing is emailed by this — it only decides which shape their Boston email takes.</p>'
            : '<p style="margin:0 0 8px">Back to undecided — until you choose, they are treated as presenting, exactly as before.</p><p style="margin:0;color:#6d6459">Nothing is emailed by this.</p>',
    cDeclineAllTitle: n => `Decline ${n} undecided offer${n === 1 ? '' : 's'}?`,
    cDeclineAllBody: n => `<p style="margin:0 0 8px">${n} ${n === 1 ? 'person who is' : 'people who are'} still undecided ${n === 1 ? 'is' : 'are'} set to <b>not this time</b>. Anyone already confirmed or declined is left alone.</p><p style="margin:0;color:#6d6459">Nothing is emailed by this — it only decides which shape their Boston email takes. You can put anyone back one row at a time.</p>`,
    goPick: 'YES, SET IT', goDeclineAll: 'SET THEM ALL',
    picked: (who, s) => `${String(who).toUpperCase()} — ${s === 'confirmed' ? 'PRESENTING' : s === 'panel' ? 'ON THE PANEL' : s === 'declined' ? 'NOT THIS TIME' : 'UNDECIDED AGAIN'}`,
    declinedAll: n => n ? `${n} OFFER${n === 1 ? '' : 'S'} SET TO “NOT THIS TIME”` : 'NOTHING WAS UNDECIDED',
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
    needBoth: 'TYPE A NAME AND AN EMAIL FIRST',
    // ---- team controls (Alen 2026-09-16: "email them … remove people or add people") ----
    // Every one of these is a real deed done on the member side; this card only asks and confirms.
    team: {
      email: 'EMAIL', release: 'RELEASE SEAT', releaseBusy: 'RELEASING…', emailBusy: 'SENDING…',
      nudged: (tpl, day) => `emailed ${day} · ${tpl === 'slides' ? 'slides' : tpl === 'panel' ? 'panel' : 'note'}`,
      bulkSlides: n => `EMAIL EVERYONE WITHOUT SLIDES (${n})`, bulkSlidesNone: 'EVERY PRESENTER HAS SENT SLIDES',
      bulkPanel: n => `EMAIL EVERYONE AWAITING REPLY (${n})`, bulkPanelNone: 'EVERY PANELIST HAS ANSWERED',
      // the composer
      eyebrow: 'EMAIL FROM THE TEAM · BOSTON',
      title: (who) => `Email ${who}`,
      tplLabel: 'TEMPLATE', tpl: { slides: 'Slides missing', panel: 'Panel reply missing', general: 'General note' },
      subjLabel: 'SUBJECT', bodyLabel: 'MESSAGE', bodyHint: 'Blank line = new paragraph. The greeting, the personal-page button and the sign-off are added for you.',
      greetingNote: (g) => `Opens with <b>${g}</b> — never a first name.`,
      ccNote: 'Sent immediately, Laura in CC — this is not the Outbox.',
      typeFirst: 'TYPE THE MESSAGE FIRST',
      send: 'SEND IT', sent: mail => `EMAIL SENT TO ${String(mail).toUpperCase()}`,
      draftBusy: 'PREPARING…',
      // bulk confirms
      cBulkTitle: (kind, n) => kind === 'slides-missing' ? `Email ${n} presenter${n === 1 ? '' : 's'} without slides?` : `Email ${n} panelist${n === 1 ? '' : 's'} who ${n === 1 ? 'has' : 'have'} not answered?`,
      cBulkBody: (kind, names) => `<p style="margin:0 0 8px">${kind === 'slides-missing' ? 'The <b>slides missing</b> note' : 'The <b>panel reply missing</b> note'} goes to: ${names}.</p><p style="margin:0;color:#6d6459">Formal greeting each (Prof. / Dr. / full name), their own personal-page link, Laura in CC. Anyone already emailed with this note <b>today</b> is skipped, so a second click cannot double-email the room.</p>`,
      goBulk: 'SEND THEM',
      bulkSent: (n, skipped) => (n ? `${n} EMAIL${n === 1 ? '' : 'S'} SENT` : 'NOBODY TO EMAIL') + (skipped ? ` · ${skipped} EMAILED TODAY, SKIPPED` : ''),
      // release
      cRelTitle: who => `Release ${who}’s seat?`,
      cRelBody: (who, mail, role) => `<p style="margin:0 0 8px">Exactly what happens when a guest taps “I can’t make it”: <b>${who}</b> is out of every count, their QR and personal page stop working, the sheet row reads <b>Cancelled by team</b>, and Laura and Alen get the FYI.</p>${role ? `<p style="margin:0 0 8px;color:#9b1b22">They are <b>${role}</b> — that decision is reset to undecided and the slot is free again.</p>` : ''}<p style="margin:0;color:#6d6459">No email goes to <b>${mail}</b>. The seat can be restored from the released list below.</p>`,
      goRelease: 'RELEASE IT',
      released: (mail, n) => `SEAT RELEASED — ${String(mail).toUpperCase()}${n == null ? '' : ` · ${n} REGISTERED NOW`}`,
      roleOf: r => r.presenter_status === 'confirmed' ? 'presenting' : r.presenter_status === 'panel' ? 'on the panel' : (r.presentation_requested && !r.presenter_status) ? 'presenting (undecided offer)' : '',
      // add a guest
      addGuest: '+ ADD A GUEST', addGuestClose: 'CLOSE',
      phFirst: 'First name', phLast: 'Last name', phMail: 'Email address', phInst: 'Institution', phPos: 'Position — e.g. Assistant Professor',
      tickPresenter: 'presents (5-minute talk)', tickPanel: 'on the panel',
      addGuestGo: 'ADD TO THE LIST',
      needGuest: 'FIRST NAME, LAST NAME AND EMAIL, PLEASE',
      cAddGuestTitle: 'Add this guest?',
      cAddGuestBody: (who, mail, role) => `<p style="margin:0 0 8px"><b>${who}</b> (${mail}) joins the Boston list as registered${role ? ` — <b>${role}</b>` : ''}, and gets a row on the sheet.</p><p style="margin:0;color:#6d6459">Nothing is emailed by this. Next you are offered to send their Boston email — the one with the ticket and the wallet passes.</p>`,
      goAddGuest: 'ADD',
      guestAdded: mail => `ADDED — ${String(mail).toUpperCase()}`,
      guestExists: 'ALREADY ON THE LIST — NOTHING ADDED',
      cSendNowTitle: who => `Send ${who} the Boston email now?`,
      cSendNowBody: (mail, shape) => `<p style="margin:0 0 8px">The <b>${shape}</b> email — program PDF, their ticket and wallet passes, the catering questions and their personal page — goes to <b>${mail}</b> right now.</p><p style="margin:0;color:#6d6459">Or later, from their row in THE BOSTON EMAIL table below.</p>`,
      goSendNow: 'SEND IT NOW', later: 'LATER',
      // the flipped-decision hint
      hint: shape => `already received the <b>${shape}</b> email — send the updated one?`,
      resend: 'RESEND', resendBusy: 'SENDING…',
      cResendTitle: who => `Send ${who} the updated Boston email?`,
      cResendBody: (mail, from, to) => `<p style="margin:0 0 8px">They received the <b>${from}</b> shape; their row now reads <b>${to}</b>. The <b>${to}</b> email goes to <b>${mail}</b> right now.</p><p style="margin:0;color:#6d6459">Same ticket, same personal page — only the asks change.</p>`,
      resent: mail => `UPDATED EMAIL SENT TO ${String(mail).toUpperCase()}`
    }
  },
  // THE Boston email (2026-09-13, reworked from the see-you-next-week reminder). One personalized
  // email per guest: the program PDF attached, their ticket, the two catering questions, the
  // one-slide-summary upload — and, for presenters only, the slides upload. Same card, second
  // table: everyone holding a seat, what has come back from them, and the send button per row.
  cat: {
    title: 'THE BOSTON EMAIL', sub: 'one personalized email per guest — program PDF, ticket, catering, one-slide summary',
    sendAll: n => `SEND THE BOSTON EMAIL TO EVERYONE (${n} NOT YET SENT)`, allSent: 'EVERYONE HAS THEIR EMAIL',
    csv: 'CATERING LIST (CSV)',
    // The archive holds only the summaries whose owner ticked "share with all participants", so
    // the button counts THOSE — a label reading higher than the file would be a small lie.
    opZip: n => `DOWNLOAD SHARED SUMMARIES (ZIP · ${n})`, opZipNone: 'NO SHARED SUMMARIES YET',
    // "registered N" counts seats actually held — a guest who tapped "I can't make it" in the one
    // email is out of it, and shows in the released list below instead.
    stripReg: n => `registered ${n}`,
    strip: (a, t, al, na) => `${a} of ${t} answered · ${al} with allergies · ${na} still to answer`,
    stripOp: (n, t, priv) => `one-slide summaries received ${n}/${t}` + (priv ? ` · ${priv} private` : ''),
    // The completion strip: the four facts the team checks daily, one glance. Slides count
    // against the presenters a deck is expected from, links included; "finished" is the guest's
    // own Finish click on their personal page; cancelled = seats given back.
    stripSlides: (x, y) => `slides in ${x}/${y} presenters`,
    stripPanel: (a, t) => `panel ${a}/${t} accepted`,
    stripFinished: n => `finished ${n}`,
    stripCancelled: n => `cancelled ${n}`,
    cDone: 'SLIDES · DONE', deckLink: 'LINK', finishedMark: 'FINISHED ✓',
    cReq: 'REQUESTS',
    // the CATERING block: head counts the kitchen can cook from, and the allergy list with names
    kitchen: { title: 'CATERING', sub: 'head counts by preference, then every allergy with a name — hand this to the caterer',
      notAnswered: n => `Not answered ${n}`, noAllergies: n => `${n} said no allergies`, allergiesUnanswered: n => `${n} have not answered the allergy question`,
      allergyTitle: 'ALLERGIES', allergyNone: 'No allergies reported yet.', reqTitle: 'SPECIAL REQUESTS', reqNone: 'No special requests yet.' },
    // released seats — collapsed, because on a good week the section is empty and silent
    relTitle: n => `RELEASED SEATS (${n})`, relOpen: 'SHOW', relClose: 'HIDE',
    relWhen: d => d ? `released ${d}` : 'released',
    relWhy: 'They tapped “I can’t make it” in the Boston email — or the team released the seat for them. Everything they told us is still on the row — restoring a seat brings it all back (a freed talk or panel decision too).',
    restore: 'RESTORE SEAT', restoreBusy: 'RESTORING…',
    cRestoreTitle: 'Put this seat back?',
    cRestoreBody: (who, mail) => `<p style="margin:0 0 8px"><b>${who}</b> goes back on the Boston list as registered, and the sheet row returns to Confirmed.</p><p style="margin:0;color:#6d6459">No email is sent to <b>${mail}</b> — tell them yourself, or send the Boston email again from the row.</p>`,
    goRestore: 'RESTORE IT',
    restored: mail => `SEAT RESTORED FOR ${String(mail).toUpperCase()}`,
    cWho: 'GUEST', cInst: 'INSTITUTION', cPref: 'PREFERENCE', cAllergy: 'ALLERGIES', cOnePager: 'ONE-SLIDE SUMMARY', cAnswered: 'ANSWERED', cRem: 'EMAIL SENT',
    send: 'SEND', resend: 'RESEND', busy: 'SENDING…',
    noPref: 'not set', noAllergy: 'not set', allergyNone: 'none', notSent: 'not sent',
    opShared: 'SHARED ✓', opPrivate: 'PRIVATE', opNo: '–',
    empty: 'Nobody is registered yet.',
    emptyWhy: 'Everyone who registers on the Boston form lands here — the email and everything it collects back follow.',
    down: 'The member portal did not answer, so the guest list is unavailable right now. Nothing is lost — reload in a minute.',
    cOneTitle: 'Send the Boston email?', cOneAgain: 'Send the Boston email again?',
    cOneBody: (who, mail) => `<p style="margin:0 0 8px">${who} gets the whole evening in one email at <b>${mail}</b> — the program PDF, their ticket, the two catering questions and their one-slide summary page, right now.</p><p style="margin:0;color:#6d6459">One email, sent immediately — this is not the Outbox.</p>`,
    cAllTitle: n => `Send the Boston email to ${n} guest${n === 1 ? '' : 's'}?`,
    cAllBody: n => `<p style="margin:0 0 8px">${n} guest${n === 1 ? '' : 's'} who ${n === 1 ? 'has' : 'have'} not had it get${n === 1 ? 's' : ''} the one email now — the program PDF, their ticket, the catering questions and their one-slide summary page.</p><p style="margin:0;color:#6d6459">Anyone already sent is skipped. One email each, sent immediately — this is not the Outbox.</p>`,
    sent: mail => `THE BOSTON EMAIL WENT TO ${String(mail).toUpperCase()}`,
    sentAll: n => n ? `${n} EMAIL${n === 1 ? '' : 'S'} SENT` : 'EVERYONE ALREADY HAD THE EMAIL',
    // the program PDF — the one attachment, and the gate on every real send
    progTitle: 'PROGRAM PDF', progNone: 'not uploaded yet — the email cannot go out without it',
    progOn: (kb, when) => `on file · ${kb} · ${when}`, progEnv: 'set by BB_PROGRAM_PDF_KEY',
    progUpload: 'UPLOAD THE PROGRAM PDF', progReplace: 'REPLACE', progBusy: 'UPLOADING…',
    progSaved: 'PROGRAM PDF SAVED — THE EMAIL CAN GO OUT',
    progBad: 'PDF ONLY, UP TO 10 MB',
    needProgram: 'UPLOAD THE PROGRAM PDF FIRST',
    // the owner's two previews
    prevTitle: 'PREVIEW', prevPresenter: 'PRESENTER', prevAttendee: 'ATTENDEE', prevPanel: 'PANEL', prevDeclined: 'NOT THIS TIME', prevBusy: 'SENDING…',
    prevSent: v => `${String(v).toUpperCase()} PREVIEW SENT TO YOUR INBOX`
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

let D = null, st = null, unbind = null, rootEl = null, changeHandler = null, mqHandler = null;

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
function hubEvents() { return (D.hub.events || []).filter(e => e.slug !== 'donor-night' && !/donor night/i.test(String(e.name || ''))); }   // Donor Night is Plexus Week, not a Bridges city
function nextEvent() {
  const today = fmt.ymd(new Date());
  const dated = hubEvents().filter(e => isoDate(e.event_date) && String(e.event_date).slice(0, 10) >= today);
  dated.sort((a, b) => String(a.event_date).localeCompare(String(b.event_date)));
  // no dated evening ahead → the undated one being planned (never an evening already held: Boston's row
  // keeps status 'upcoming' after 21 Sep, and used to stay "NEXT" here)
  return dated[0] || hubEvents().find(e => !isoDate(e.event_date) && (e.status === 'upcoming' || e.status === 'planning')) || null;
}
// an evening held in the last 45 days that has no recap row yet — kept on the EVENTS list (its Boston
// card, presenters and decks stay one tap away) until its recap exists
function justHeld(e) {
  if (!isoDate(e.event_date)) return false;
  const d = String(e.event_date).slice(0, 10), today = fmt.ymd(new Date());
  if (d >= today) return false;
  const ago = Math.round((new Date(today + 'T12:00:00') - new Date(d + 'T12:00:00')) / 86400000);
  const norm = v => String(v || '').toLowerCase().replace(/ü/g, 'u');
  return ago <= 45 && !(D.hub.editions || []).some(ed => norm(ed.city) === norm(e.city));
}
function nextRange(n) {
  if (n && isoDate(n.event_date)) {
    const end = FACTS.bridges.next.end && n.city === FACTS.bridges.next.city && String(n.event_date).slice(0, 10) === FACTS.bridges.next.start ? FACTS.bridges.next.end : null;
    return end ? fmt.rangeLabel(n.event_date, end) : fmt.rangeLabel(String(n.event_date).slice(0, 10));
  }
  // an undated evening (Zagreb, being planned) — never the canonical Boston date it replaced
  return n ? 'DATE TBC' : fmt.rangeLabel(FACTS.bridges.next.start, FACTS.bridges.next.end);
}
// The row the Boston block belongs to: the event id the presenters read names (boston-ops fixes
// it) when that row is on the list — otherwise (read locked or down, or a database without that
// row) the live Boston row by city.
function bostonRowId() {
  const events = D.hub.events || [];
  const id = D.pres && D.pres.event;
  if (id && events.some(e => String(e.id) === String(id))) return String(id);
  const live = events.find(e => String(e.city || '').toLowerCase() === 'boston' && e.status !== 'cancelled');
  return live ? String(live.id) : null;
}
const isBostonRow = e => String(e.id) === bostonRowId();
// ---- phone (≤700 px) ----
// The desktop artboard is untouched; on a phone a few blocks draw a different shape (cards for the
// two Boston tables, folded side blocks). One media query decides, and crossing it redraws.
const MQ = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(max-width:700px)') : null;
const isPhone = () => !!(MQ && MQ.matches);
// Event day: a bridges_events row dated today (not cancelled). The door scanner is on /event-day.
function eventTonight() {
  const today = fmt.ymd(new Date());
  return (D && D.hub ? hubEvents() : []).find(e => isoDate(e.event_date) && String(e.event_date).slice(0, 10) === today && e.status !== 'cancelled') || null;
}
function scannerBtn(where) {
  if (!eventTonight()) return '';
  return `<a href="/event-day" class="bh-scan bh-scan-${where}" data-v2="door-scanner" style="display:inline-flex;align-items:center;justify-content:center;gap:0;padding:11px 16px;background:#9b1b22;color:#fff;font:600 10.5px Inter,sans-serif;letter-spacing:.14em;white-space:nowrap;text-decoration:none;${where === 'hub' ? 'align-self:flex-start' : ''}" data-hover="background:#7e151b">${COPY.scanner.cta}</a>`;
}
// The three side blocks fold behind their headers on a phone: the header carries the toggle,
// the body carries the closed class (CSS ≤700 hides it — inline display:flex beats `hidden`).
const foldHead = key => isPhone() ? ` data-act="bhFold" data-fold="${key}" role="button" aria-expanded="${!!st.fold[key]}" class="bh-fold-head"` : '';
const foldBody = key => isPhone() && !st.fold[key] ? ' class="bh-fold-closed"' : '';
const foldMark = key => isPhone() ? `<span class="bh-fold-mark" aria-hidden="true" style="margin-left:auto;font:600 12px Inter,sans-serif;color:#9b1b22">${st.fold[key] ? '▴' : '▾'}</span>` : '';
// "28 presenting · 12 uploaded · 0 invited" → chips on a phone, the same line on a desktop
const chipsOrLine = (line, cls) => isPhone()
  ? `<span class="${cls} bh-chips">${String(line).split(' · ').map(x => `<span class="bh-chip">${esc(x)}</span>`).join('')}</span>`
  : `<span class="${cls}" style="font-size:11px;color:#6d6459;white-space:nowrap">${esc(line)}</span>`;

// ---------------------------------------------------------------- data
async function load() {
  const r = await api.settle({ hub: api.get('/api/v2/bridges/hub'), pres: api.get('/api/v2/boston/presenters'), cat: api.get('/api/v2/boston/catering'), decks: api.get('/api/v2/boston/decks') });
  return {
    errors: r.$errors,
    hub: r.hub || { events: [], editions: [], followups: [], stats: null, canonical_guests: FACTS.bridges.guests },
    pres: r.pres && r.pres.ok ? r.pres : null,
    cat: r.cat && r.cat.ok ? r.cat : null,
    decks: (r.decks && Array.isArray(r.decks.decks)) ? r.decks.decks : []
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
    <div class="bh-title" style="display:flex;align-items:flex-end;gap:16px;flex-wrap:wrap">
      <div class="bh-title-main">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <span class="mx-display-30" style="font-family:Fraunces,serif;font-size:30px">Building Bridges <i>in Biomedicine</i></span>
          <span style="font:600 9px Inter,sans-serif;letter-spacing:.15em;background:#e7ecf3;color:#31517e;padding:4px 8px;white-space:nowrap">${esc(n ? COPY.next(n.city, nextRange(n)) : COPY.noNext)}</span>
        </div>
        <div class="bh-sub" style="font-size:12.5px;color:#6d6459;margin-top:4px">${isPhone() ? COPY.subShort : COPY.sub}</div>
      </div>
      <div class="bh-sp" style="flex:1"></div>
      <a href="/member-pages/bridges" class="bh-manage" style="padding:10px 16px;border:2px solid #9b1b22;background:#fff;color:#9b1b22;font:600 10px Inter,sans-serif;letter-spacing:.14em;white-space:nowrap" data-hover="background:#9b1b22;color:#fff">${COPY.manage}</a>
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
      <a href="#bridges-events" class="bh-stat" style="white-space:nowrap;color:#201b16" data-hover="color:#9b1b22"><span class="bh-stat-n" style="font-family:Fraunces,serif;font-size:26px">${eds.length}</span> <span class="bh-stat-l" style="font:600 10px Inter,sans-serif;letter-spacing:.13em;color:#6d6459">${esc(b.events(eds.length, cities, countries))}</span></a>
      <span class="bh-stat" style="white-space:nowrap"><span class="bh-stat-n" style="font-family:Fraunces,serif;font-size:26px">${esc(guests)}</span> <span class="bh-stat-l" style="font:600 10px Inter,sans-serif;letter-spacing:.13em;color:#6d6459">${b.guests}</span></span>
      ${n ? `<a href="/registrations" class="bh-stat" style="white-space:nowrap;color:#201b16" data-hover="color:#9b1b22"><span class="bh-stat-n" style="font-family:Fraunces,serif;font-size:26px">${n.registration_count || 0}</span> <span class="bh-stat-l" style="font:600 10px Inter,sans-serif;letter-spacing:.13em;color:#6d6459">${esc(b.signups(n.city, n.capacity))}</span></a>` : ''}
      ${n && isoDate(n.event_date) ? `<span class="bh-stat" style="white-space:nowrap"><span class="bh-stat-n" style="font-family:Fraunces,serif;font-size:26px">${days}</span> <span class="bh-stat-l" style="font:600 10px Inter,sans-serif;letter-spacing:.13em;color:#6d6459">${esc(b.days(n.city, nextRange(n)))}</span></span>` : ''}
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
  const upcoming = hubEvents().filter(e => !isoDate(e.event_date) || String(e.event_date).slice(0, 10) >= today || justHeld(e));
  const editions = D.hub.editions || [];
  return `
      <!-- dc: Admin Bridges Hub.dc.html › "EVENTS" -->
      <div data-block="events" id="bridges-events" style="border:1px solid rgba(32,27,22,.14);background:#fff">
        <div class="bh-ev-head" style="display:flex;align-items:center;gap:10px;padding:14px 20px;border-bottom:1px solid rgba(32,27,22,.12)">
          <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${c.title}</span>
          <span class="bh-ev-head-sub" style="font-size:11.5px;color:#6d6459">${c.sub}</span>
          <div class="bh-sp" style="flex:1"></div>
          <span data-act="newCityToggle" class="bh-act" style="padding:8px 13px;background:#9b1b22;color:#fff;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap" data-hover="background:#7e151b">${c.newCity}</span>
        </div>
        ${st.newCityOpen ? `
          <div style="display:flex;gap:8px;align-items:center;padding:12px 20px;background:#fdfbf6;border-bottom:1px solid rgba(32,27,22,.08);flex-wrap:wrap">
            <input data-role="ncCity" value="${esc(st.ncCity)}" placeholder="${esc(c.ncCity)}" aria-label="City" style="flex:1;min-width:130px;border:1px solid rgba(32,27,22,.25);background:#fff;padding:8px 10px;font-size:12.5px;color:#201b16">
            <input data-role="ncWhen" value="${esc(st.ncWhen)}" placeholder="${esc(c.ncWhen)}" aria-label="When" style="width:150px;border:1px solid rgba(32,27,22,.25);background:#fff;padding:8px 10px;font-size:12.5px;color:#201b16">
            <span data-act="ncAdd" style="padding:8px 13px;background:#9b1b22;color:#fff;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer">${c.add}</span>
          </div>` : ''}
        ${upcoming.map(e => `
          <div data-row="${esc(e.id)}" class="bh-ev-row${isBostonRow(e) ? ' bh-ev-boston' : ''}" style="display:flex;align-items:center;gap:12px;padding:12px 20px;border-bottom:1px solid rgba(32,27,22,.07)">
            <span class="bh-ev-date" style="font:600 9px Inter,sans-serif;letter-spacing:.11em;color:#6d6459;width:76px;flex:none">${esc(dateLabel(e))}</span>
            <span class="bh-ev-main" ${isBostonRow(e) ? `data-act="bostonOpen" title="Open the Boston card" style="flex:1;min-width:0;cursor:pointer" data-hover="color:#9b1b22"` : `style="flex:1;min-width:0"`}><span style="display:block;font-size:13.5px;font-weight:600">${esc(e.city)}</span><span style="display:block;font-size:11px;color:#6d6459">${esc(e.venue_name || c.venueTBA)}</span></span>
            ${justHeld(e) ? `<span data-act="makeRecap" data-id="${esc(e.id)}" title="${esc(c.heldTitle)}" class="bh-ev-chip" style="font:600 8.5px Inter,sans-serif;letter-spacing:.1em;background:#e6f0e9;color:#2f7d4f;padding:3px 8px;white-space:nowrap;cursor:pointer" data-hover="background:#2f7d4f;color:#fff">${c.held}</span>` : e.is_published ? `<span class="bh-ev-chip" style="font:600 8.5px Inter,sans-serif;letter-spacing:.1em;background:#e7ecf3;color:#31517e;padding:3px 8px;white-space:nowrap">${c.upcoming}</span>` : `<span class="bh-ev-chip" style="font:600 8.5px Inter,sans-serif;letter-spacing:.1em;background:#eee9df;color:#4a4239;padding:3px 8px;white-space:nowrap">${c.draft}</span>`}
            ${isBostonRow(e) ? `
            <!-- v2: the Boston row — MANAGE opens the Boston block below; EDIT DETAILS is the inline editor -->
            <span class="bh-ev-count" style="font-size:11.5px;color:#6d6459;white-space:nowrap">${esc(c.bostonLine(e.registration_count || 0, e.capacity, D.pres ? Number(D.pres.confirmed) || 0 : null, e.checked_in_count || 0))}</span>
            <span data-act="bostonOpen" data-v2="boston-manage" class="bh-ev-go" style="padding:7px 12px;background:#9b1b22;color:#fff;font:600 9.5px Inter,sans-serif;letter-spacing:.12em;white-space:nowrap;cursor:pointer" data-hover="background:#7d1119">${st.bostonOpen ? c.manage : c.openBoston}</span>
            <span data-act="evEdit" data-id="${esc(e.id)}" class="bh-ev-edit" style="font:600 9.5px Inter,sans-serif;letter-spacing:.12em;color:#6d6459;white-space:nowrap;cursor:pointer" data-hover="color:#201b16">${st.editEvent === e.id ? c.close : c.editDetails}</span>`
            : `
            <span class="bh-ev-count" style="font-size:11.5px;color:#6d6459;white-space:nowrap">${esc(c.signups(e.registration_count || 0, e.capacity))}</span>
            <span data-act="evEdit" data-id="${esc(e.id)}" class="bh-ev-go bh-ev-ghost" style="font:600 9.5px Inter,sans-serif;letter-spacing:.12em;color:#9b1b22;white-space:nowrap;cursor:pointer" data-hover="color:#201b16">${st.editEvent === e.id ? c.close : c.manage}</span>`}
          </div>
          ${st.editEvent === e.id ? eventEditor(e) : ''}`).join('')}
        ${editions.map(ed => `
          <div data-row="${esc(ed.id)}" class="bh-ev-row" style="display:flex;align-items:center;gap:12px;padding:12px 20px;border-bottom:1px solid rgba(32,27,22,.07);${ed.is_published ? '' : 'opacity:.55'}">
            <span class="bh-ev-date" style="font:600 9px Inter,sans-serif;letter-spacing:.11em;color:#6d6459;width:76px;flex:none">${esc(c.edition(ed.edition_no))}</span>
            <span class="bh-ev-main" style="flex:1;min-width:0"><span style="display:block;font-size:13.5px;font-weight:600">${esc(ed.city)}</span><span style="display:block;font-size:11px;color:#6d6459">${esc(ed.venue || '')}</span></span>
            <span class="bh-ev-count" style="font-size:11.5px;color:${ed.guests == null ? '#b7791f' : '#6d6459'};white-space:nowrap">${esc(ed.guests == null ? c.recapMissing : c.recapLine(ed.guests, ed.connections))}</span>
            <span data-act="recap" data-id="${esc(ed.id)}" class="bh-ev-go bh-ev-ghost" style="font:600 9.5px Inter,sans-serif;letter-spacing:.12em;color:#9b1b22;white-space:nowrap;cursor:pointer" data-hover="color:#201b16">${st.recapEdit === ed.id ? c.close : c.recap}</span>
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
          <div${foldHead('ready')} style="padding:13px 20px;border-bottom:1px solid rgba(32,27,22,.1)"><span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${esc(n ? c.title(n.city) : c.title(FACTS.bridges.next.city))}</span>${foldMark('ready')}</div>
          <div${foldBody('ready')} style="padding:12px 20px 16px;display:flex;flex-direction:column;gap:10px">
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
          <div${foldHead('fu')} style="display:flex;align-items:center;gap:10px;padding:13px 20px;border-bottom:1px solid rgba(32,27,22,.1)"><span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${c.title}</span><div style="flex:1"></div><span class="bh-fu-hint" style="font-size:11px;color:#6d6459">${c.hint}</span>${foldMark('fu')}</div>
          <div${foldBody('fu')} style="padding:10px 20px 16px;display:flex;flex-direction:column;gap:6px">
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
          ${isPhone() ? `<div${foldHead('after')}><span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${c.title}</span>${foldMark('after')}</div><div${foldBody('after')} style="display:flex;flex-direction:column;gap:8px">` : `<span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${c.title}</span>`}
          <span style="font-size:12.5px;color:#6d6459;line-height:1.6">${c.body}</span>
          <a href="/inbox" style="font:600 10px Inter,sans-serif;letter-spacing:.14em">${c.cta}</a>
          ${lastPast ? `<!-- v2: one-click thank-you batch for the latest past evening --><span data-act="queueThanks" data-id="${esc(lastPast.id)}" style="font:600 10px Inter,sans-serif;letter-spacing:.14em;color:#9b1b22;cursor:pointer" data-v2="queue-thanks" data-hover="color:#201b16">${esc(c.queueThanks(lastPast.city))}</span>` : ''}
          ${isPhone() ? '</div>' : ''}
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
  const confirmedN = P ? Number(P.confirmed) || 0 : 0;
  const panelN = P ? Number(P.panel) || 0 : 0;
  const declinedN = P ? Number(P.declined) || 0 : 0;
  const undecidedN = P ? Number(P.undecided) || 0 : 0;
  // The three-state control, one row at a time. The state a row is IN reads as a solid chip; the
  // other two are quiet, clickable text — so the table can be scanned for "who is still open"
  // without reading a single word.
  // `big` = the phone card's thumb-sized version of the same control (same data-* attributes).
  const pickChip = (r, value, label, big) => {
    const on = (r.presenter_status || null) === value;
    const busy = st.bpPicking === r.registration_id;
    const tone = value === 'confirmed' ? { bg: '#1e6e42', fg: '#fff' } : value === 'panel' ? { bg: '#2f4f7a', fg: '#fff' } : value === 'declined' ? { bg: '#8a5a1c', fg: '#fff' } : { bg: '#eee9df', fg: '#4a4239' };
    return `<span data-act="${busy ? '' : 'bpPick'}" data-id="${esc(r.registration_id)}" data-status="${value === null ? '' : value}" data-who="${esc(r.name || r.email)}"
      style="${big ? 'display:flex;align-items:center;justify-content:center;min-height:44px;box-sizing:border-box;padding:10px 8px;font:600 10px Inter,sans-serif;text-align:center;' : 'display:inline-block;padding:3px 8px;margin-right:5px;font:600 8px Inter,sans-serif;'}letter-spacing:.1em;white-space:nowrap;${on
        ? `background:${tone.bg};color:${tone.fg};`
        : 'background:transparent;color:#9a9086;border:1px solid rgba(32,27,22,.18);'}${busy ? 'opacity:.5;cursor:progress' : 'cursor:pointer'}"
      ${busy ? 'aria-disabled="true"' : `data-hover="${on ? 'opacity:.85' : 'border-color:#201b16;color:#201b16'}"`}>${esc(busy ? c.pick.busy : label)}</span>`;
  };
  // kind 'ghost' = a secondary action: bordered even when it is live, so the primary send on the
  // card stays the only crimson button (the Boston email is the send that matters).
  const btn = (act, label, on, extra, kind) => kind === 'ghost'
    ? `<span data-act="${act}" ${extra || ''} style="padding:8px 13px;border:1px solid rgba(32,27,22,.25);background:#fff;color:${on ? '#201b16' : '#9a9086'};font:600 9.5px Inter,sans-serif;letter-spacing:.13em;white-space:nowrap;${on ? 'cursor:pointer' : 'cursor:default'}" ${on ? `data-hover="border-color:#201b16"` : 'aria-disabled="true"'}>${esc(label)}</span>`
    : `<span data-act="${act}" ${extra || ''} style="padding:8px 13px;${on ? 'background:#9b1b22;color:#fff;' : 'border:1px solid rgba(32,27,22,.25);background:#fff;color:#6d6459;'}font:600 9.5px Inter,sans-serif;letter-spacing:.13em;white-space:nowrap;${on ? 'cursor:pointer' : 'cursor:default'}" ${on ? `data-hover="background:#7e151b"` : 'aria-disabled="true"'}>${esc(label)}</span>`;
  const cell = 'padding:9px 12px;border-bottom:1px solid rgba(32,27,22,.07);vertical-align:middle';
  const head = 'padding:8px 12px;text-align:left;font:600 8.5px Inter,sans-serif;letter-spacing:.12em;color:#6d6459;border-bottom:1px solid rgba(32,27,22,.12);white-space:nowrap';
  // The filter chips: one glance answers "who presents / who is on the panel / who still owes a
  // panel answer / who asked for something" — the table below shows only that group.
  const f = st.bpFilter || 'all';
  const matches = r => f === 'all' ? true
    : f === 'confirmed' ? r.presenter_status === 'confirmed'
    : f === 'panel' ? !!r.panel
    : f === 'declined' ? r.presenter_status === 'declined'
    : f === 'awaiting' ? (!!r.panel && !r.panel_reply)
    : f === 'requests' ? !!r.guest_requests : true;
  const shown = rows.filter(matches);
  const countOf = k => k === 'all' ? rows.length : rows.filter(r => (k === 'confirmed' ? r.presenter_status === 'confirmed' : k === 'panel' ? !!r.panel : k === 'declined' ? r.presenter_status === 'declined' : k === 'awaiting' ? (!!r.panel && !r.panel_reply) : !!r.guest_requests)).length;
  const filterChips = Object.keys(c.filters).map(k => {
    const on = f === k; const n = countOf(k);
    return `<span data-act="bpFilter" data-filter="${k}" role="radio" aria-checked="${on}" style="padding:6px 10px;font:600 8.5px Inter,sans-serif;letter-spacing:.11em;cursor:pointer;white-space:nowrap;${on ? 'background:#201b16;color:#fff;border:1px solid #201b16' : 'background:#fff;color:#6d6459;border:1px solid rgba(32,27,22,.2)'}" data-hover="border-color:#201b16">${c.filters[k]} · ${n}</span>`;
  }).join('');
  // The two bulk nudges, counted from the SAME rows the member wing will target: presenters with
  // no deck (a share link counts), panelists with no answer — released seats excluded.
  const tm = c.team;
  const slidesMissing = rows.filter(r => r.presenter && !r.upload && !r.released);
  const panelAwaiting = rows.filter(r => r.panel && !r.panel_reply && !r.released);
  const bulkBusy = !!st.bpBulkBusy;
  return `
    <!-- v2: BOSTON — 5-minute presentations (member portal owns the links, files and the email) -->
    <div data-block="boston" id="boston-presentations" style="border:1px solid rgba(32,27,22,.14);border-top:2px solid #9b1b22;background:#fff;margin-top:22px">
      <div class="bh-bo-head" style="display:flex;align-items:center;gap:10px;padding:14px 20px;border-bottom:1px solid rgba(32,27,22,.1);flex-wrap:wrap">
        <span class="bh-bo-title" style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${c.title}</span>
        <span class="bh-bo-sub" style="font-size:11.5px;color:#6d6459">${c.sub}</span>
        ${scannerBtn('boston')}
        <div class="bh-sp" style="flex:1"></div>
        ${P ? chipsOrLine(c.counts(P.requested || 0, uploaded, P.invited || 0), 'bh-bo-count') : ''}
        ${P ? chipsOrLine(c.pickCounts(confirmedN, panelN, declinedN, undecidedN), 'bh-bo-count') : ''}
        ${P ? btn('bpDeclineAll', undecidedN ? c.declineAll(undecidedN) : c.declineAllNone, undecidedN > 0, 'class="bh-act"', 'ghost') : ''}
        ${P ? btn('bpSendAll', notInvited ? c.sendAll(notInvited) : c.allInvited, notInvited > 0, 'class="bh-act"', 'ghost') : ''}
        ${P && uploaded ? `<a href="${esc(P.zip_url)}" class="bh-act" title="${esc(c.zipHint)}" style="padding:8px 13px;border:1px solid rgba(32,27,22,.25);background:#fff;color:#201b16;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;white-space:nowrap" data-hover="border-color:#201b16">${esc(c.zip(uploaded))}</a>`
        : P ? `<span class="bh-act" style="padding:8px 13px;border:1px solid rgba(32,27,22,.15);color:#9a9086;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;white-space:nowrap" aria-disabled="true">${c.zipNone}</span>` : ''}
        ${P && (P.summaries || 0) ? `<a href="${esc(P.summaries_zip_url || '/api/v2/boston/onepagers.zip?all=1')}" class="bh-act" title="${esc(c.zipHint)}" style="padding:8px 13px;border:1px solid rgba(32,27,22,.25);background:#fff;color:#201b16;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;white-space:nowrap" data-hover="border-color:#201b16">${esc(c.sumZip(P.summaries))}</a>`
        : P ? `<span class="bh-act" style="padding:8px 13px;border:1px solid rgba(32,27,22,.15);color:#9a9086;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;white-space:nowrap" aria-disabled="true">${c.sumZipNone}</span>` : ''}
        ${P ? `<span data-act="bpAddToggle" class="bh-act bh-act-link" style="font:600 9.5px Inter,sans-serif;letter-spacing:.13em;color:#9b1b22;cursor:pointer;white-space:nowrap" data-hover="color:#201b16">${st.bpOpen ? c.addClose : c.add}</span>` : ''}
        ${P ? `<span data-act="bpGuestToggle" data-v2="boston-add-guest" class="bh-act bh-act-link" style="font:600 9.5px Inter,sans-serif;letter-spacing:.13em;color:#9b1b22;cursor:pointer;white-space:nowrap" data-hover="color:#201b16">${st.bpGuestOpen ? tm.addGuestClose : tm.addGuest}</span>` : ''}
      </div>
      ${st.bpOpen && P ? `
        <div style="display:flex;gap:8px;align-items:center;padding:12px 20px;background:#fdfbf6;border-bottom:1px solid rgba(32,27,22,.08);flex-wrap:wrap">
          <input data-role="bpName" value="${esc(st.bpName)}" placeholder="${esc(c.phName)}" aria-label="Presenter name" style="flex:1;min-width:160px;border:1px solid rgba(32,27,22,.25);background:#fff;padding:8px 10px;font-size:12.5px;color:#201b16">
          <input data-role="bpEmail" value="${esc(st.bpEmail)}" type="email" placeholder="${esc(c.phEmail)}" aria-label="Presenter email" style="flex:1;min-width:170px;border:1px solid rgba(32,27,22,.25);background:#fff;padding:8px 10px;font-size:12.5px;color:#201b16">
          ${btn('bpAdd', st.bpBusy ? c.busy : c.addSend, !st.bpBusy)}
        </div>` : ''}
      ${st.bpGuestOpen && P ? `
        <!-- v2: ADD A GUEST — someone who never used the form (Alen 2026-09-16). No email from here. -->
        <div data-v2="boston-add-guest-form" style="display:flex;gap:8px;align-items:center;padding:12px 20px;background:#fdfbf6;border-bottom:1px solid rgba(32,27,22,.08);flex-wrap:wrap">
          <input data-role="bgFirst" value="${esc(st.bg.first)}" placeholder="${esc(tm.phFirst)}" aria-label="First name" style="flex:1;min-width:120px;border:1px solid rgba(32,27,22,.25);background:#fff;padding:8px 10px;font-size:12.5px;color:#201b16">
          <input data-role="bgLast" value="${esc(st.bg.last)}" placeholder="${esc(tm.phLast)}" aria-label="Last name" style="flex:1;min-width:120px;border:1px solid rgba(32,27,22,.25);background:#fff;padding:8px 10px;font-size:12.5px;color:#201b16">
          <input data-role="bgEmail" value="${esc(st.bg.email)}" type="email" placeholder="${esc(tm.phMail)}" aria-label="Email address" style="flex:1.2;min-width:170px;border:1px solid rgba(32,27,22,.25);background:#fff;padding:8px 10px;font-size:12.5px;color:#201b16">
          <input data-role="bgInst" value="${esc(st.bg.inst)}" placeholder="${esc(tm.phInst)}" aria-label="Institution" style="flex:1.2;min-width:150px;border:1px solid rgba(32,27,22,.25);background:#fff;padding:8px 10px;font-size:12.5px;color:#201b16">
          <input data-role="bgPos" value="${esc(st.bg.pos)}" placeholder="${esc(tm.phPos)}" aria-label="Position" style="flex:1;min-width:150px;border:1px solid rgba(32,27,22,.25);background:#fff;padding:8px 10px;font-size:12.5px;color:#201b16">
          <label style="display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:#201b16;white-space:nowrap;cursor:pointer"><input data-role="bgPresenter" type="checkbox" ${st.bg.presenter ? 'checked' : ''}> ${esc(tm.tickPresenter)}</label>
          <label style="display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:#201b16;white-space:nowrap;cursor:pointer"><input data-role="bgPanel" type="checkbox" ${st.bg.panel ? 'checked' : ''}> ${esc(tm.tickPanel)}</label>
          ${btn('bpGuestAdd', st.bgBusy ? c.busy : tm.addGuestGo, !st.bgBusy)}
        </div>` : ''}
      ${lockErr && lockErr.status === 403 ? ui.lockedBlock('Building Bridges') : ''}
      ${!P && !lockErr ? `<div class="empty" style="padding:18px 20px"><span class="empty-line" style="font-family:Fraunces,serif;font-style:italic;font-size:14px">Not right now.</span><span class="empty-why" style="font-size:11.5px;color:#6d6459">${c.down}</span></div>` : ''}
      ${P && !rows.length ? `<div class="empty" style="padding:18px 20px"><span class="empty-line" style="font-family:Fraunces,serif;font-style:italic;font-size:14px">${c.empty}</span><span class="empty-why" style="font-size:11.5px;color:#6d6459">${c.emptyWhy}</span></div>` : ''}
      ${P && rows.length ? `
      <div class="bh-bo-filters" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:10px 20px;background:#fdfbf6;border-bottom:1px solid rgba(32,27,22,.08)">
        ${isPhone() ? `<div class="bh-chipscroll">${filterChips}</div>` : filterChips}
        <div class="bh-sp" style="flex:1"></div>
        <!-- v2: the two bulk nudges (Alen 2026-09-16) — real emails, confirmed first, "emailed today" skipped -->
        ${btn('bpBulkEmail', bulkBusy === 'slides-missing' ? tm.emailBusy : slidesMissing.length ? tm.bulkSlides(slidesMissing.length) : tm.bulkSlidesNone, slidesMissing.length > 0 && !bulkBusy, 'data-kind="slides-missing" class="bh-act"', 'ghost')}
        ${btn('bpBulkEmail', bulkBusy === 'panel-awaiting' ? tm.emailBusy : panelAwaiting.length ? tm.bulkPanel(panelAwaiting.length) : tm.bulkPanelNone, panelAwaiting.length > 0 && !bulkBusy, 'data-kind="panel-awaiting" class="bh-act"', 'ghost')}
        <a href="${esc((D.cat && D.cat.program_csv_url) || '/api/v2/boston/program.csv')}" class="bh-act" style="padding:7px 12px;border:1px solid rgba(32,27,22,.25);background:#fff;color:#201b16;font:600 9px Inter,sans-serif;letter-spacing:.13em;white-space:nowrap" data-hover="border-color:#201b16">${c.programCsv}</a>
      </div>
      ${isPhone() ? presenterCards(shown, { pickChip, btn }) : `
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:12.5px;min-width:900px">
          <thead><tr><th style="${head}">${c.cWho}</th><th style="${head}">${c.cInst}</th><th style="${head}">${c.cPresents}</th><th style="${head}">${c.cDeck}</th><th style="${head}">${c.cSummary}</th><th style="${head}">${c.cDone}</th><th style="${head}">${c.cReq}</th><th style="${head}">${c.cSent}</th><th style="${head}"></th></tr></thead>
          <tbody>
          ${shown.map(r => {
            const busy = st.bpSending === r.registration_id;
            const releasing = st.bpReleasing === r.registration_id;
            const resending = st.bpResending === r.registration_id;
            // "they already received the <shape> email": the wing says so when the stored shape
            // differs from today's; rows emailed before the shape was stored show it once a
            // decision is flipped in this session (bpFlipped).
            const hintShape = r.reminder_sent && !r.released && (r.shape_changed ? r.sent_shape : (st.bpFlipped[r.registration_id] && !r.sent_shape ? st.bpFlipped[r.registration_id] : null));
            return `
            <tr data-row="${esc(r.registration_id)}" ${r.released ? 'style="opacity:.55"' : ''}>
              <td style="${cell}"><span style="display:block;font-weight:600">${esc(r.name || r.email)}${r.released ? ` <span style="font:600 7.5px Inter,sans-serif;letter-spacing:.1em;color:#9b1b22">RELEASED${r.released_by === 'team' ? ' BY TEAM' : ''}</span>` : ''}</span><span style="display:block;font-size:11px;color:#6d6459">${esc(r.email)}${r.added_by_team ? ` · <span style="font:600 7.5px Inter,sans-serif;letter-spacing:.1em;color:#7a6432">${c.byTeam}</span>` : ''}</span>${nudgedLine(r)}</td>
              <td style="${cell};color:#6d6459">${esc(r.institution || '—')}</td>
              <td style="${cell};white-space:nowrap">${(r.presentation_requested || r.panel)
                ? pickChip(r, 'confirmed', c.pick.yes) + pickChip(r, 'panel', c.pick.panel) + pickChip(r, 'declined', c.pick.no) + pickChip(r, null, c.pick.unset)
                  + (r.panel ? `<span style="display:block;margin-top:4px;font:600 7.5px Inter,sans-serif;letter-spacing:.1em;color:${r.panel_reply === 'yes' ? '#1e6e42' : r.panel_reply === 'no' ? '#9b1b22' : '#b7791f'}">${c.panelReply[r.panel_reply === 'yes' ? 'yes' : r.panel_reply === 'no' ? 'no' : 'none']}</span>` : '')
                  + (hintShape ? `<span data-v2="boston-resend-hint" style="display:block;margin-top:5px;font-size:11px;color:#8a5a12;white-space:normal;max-width:260px">${tm.hint(esc(hintShape))} <span data-act="${resending ? '' : 'bpResendShape'}" data-id="${esc(r.registration_id)}" data-who="${esc(r.name || r.email)}" data-mail="${esc(r.email)}" data-from="${esc(hintShape)}" data-to="${esc(r.current_shape || '')}" style="font:600 8.5px Inter,sans-serif;letter-spacing:.11em;color:#9b1b22;cursor:pointer;margin-left:4px" data-hover="color:#201b16">${resending ? tm.resendBusy : tm.resend}</span></span>` : '')
                : `<span style="color:#9a9086">${c.deckNo}</span>`}</td>
              <td style="${cell};white-space:nowrap">${r.upload
                ? (r.upload.external_url
                  /* the over-25 MB lane: the deck lives on Drive / Dropbox — open it there, the URL sits in the title */
                  ? `<a href="${esc(r.upload.external_url)}" target="_blank" rel="noopener" title="${esc(r.upload.external_url)}" style="font:600 8.5px Inter,sans-serif;letter-spacing:.1em;background:#e6efe8;color:#1e6e42;padding:3px 8px" data-hover="background:#1e6e42;color:#fff">✓ ${c.deckLink}</a>`
                  : `<a href="${esc(r.upload.download_url)}" title="${esc(r.upload.filename || '')}" style="font:600 8.5px Inter,sans-serif;letter-spacing:.1em;background:#e6efe8;color:#1e6e42;padding:3px 8px" data-hover="background:#1e6e42;color:#fff">✓ ${c.deckYes}</a>`)
                : `<span style="color:#9a9086">${c.deckNo}</span>`}</td>
              <td style="${cell};white-space:nowrap;color:${r.onepager ? '#1e6e42' : '#9a9086'}">${r.onepager && r.onepager_download_url
                ? `<a href="${esc(r.onepager_download_url)}" title="download the one-slide summary" style="font:600 8.5px Inter,sans-serif;letter-spacing:.1em;background:#e6efe8;color:#1e6e42;padding:3px 8px;text-decoration:none" data-hover="background:#1e6e42;color:#fff">${c.summaryYes}</a>`
                : r.onepager ? c.summaryYes : c.deckNo}</td>
              <td style="${cell};white-space:nowrap;color:${r.finished ? '#1e6e42' : '#9a9086'}">${r.finished ? c.finishedYes : c.deckNo}</td>
              <td style="${cell};max-width:220px">${r.guest_requests
                ? `<span title="${esc(r.guest_requests)}" style="display:block;font-size:11.5px;color:#201b16;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">✎ ${esc(r.guest_requests)}</span>`
                : `<span style="color:#9a9086">${c.reqNone}</span>`}</td>
              <td style="${cell};white-space:nowrap;color:${r.invited_at == null ? '#b7791f' : '#6d6459'}">${r.invited_at == null ? c.notSent : esc(r.invited_at || '✓')}</td>
              <td style="${cell};text-align:right;white-space:nowrap">${r.released ? '' : btn('bpSendOne', busy ? c.busy : (r.invited_at == null ? c.send : c.resend), !busy, `data-id="${esc(r.registration_id)}" data-who="${esc(r.name || r.email)}" data-mail="${esc(r.email)}"`)}${rowTeamActions(r, releasing)}</td>
            </tr>`;
          }).join('')}
          ${!shown.length ? `<tr><td colspan="9" style="${cell};color:#6d6459;font-style:italic">Nobody in this group.</td></tr>` : ''}
          </tbody>
        </table>
      </div>`}` : ''}
      ${sectionCatering(btn, cell, head)}
    </div>`;
}
// ---- the phone shape of the two Boston tables (≤700 px) ----
// One card per row: name · institution · the decision chip · a facts line; a tap opens the same
// actions the table row carries (same data-act, same data-id/-who/-mail), sized for a thumb.
const CARD_BTN = 'display:flex;align-items:center;justify-content:center;min-height:44px;box-sizing:border-box;padding:10px 12px;font:600 10.5px Inter,sans-serif;letter-spacing:.12em;text-align:center;white-space:normal;line-height:1.3;cursor:pointer;text-decoration:none';
const cardBtn = (act, label, extra, kind) => kind === 'primary'
  ? `<span data-act="${act}" ${extra || ''} style="${CARD_BTN};background:#9b1b22;color:#fff" data-hover="background:#7e151b">${esc(label)}</span>`
  : `<span data-act="${act}" ${extra || ''} style="${CARD_BTN};border:1px solid rgba(32,27,22,.25);background:#fff;color:#201b16" data-hover="border-color:#201b16">${esc(label)}</span>`;
const cardLink = (href, label, extra) => `<a href="${esc(href)}" ${extra || ''} style="${CARD_BTN};border:1px solid rgba(30,110,66,.4);background:#e6efe8;color:#1e6e42" data-hover="background:#1e6e42;color:#fff">${esc(label)}</a>`;
const fact = (label, on, tone) => `<span style="display:inline-flex;align-items:center;gap:4px;font-size:13px;color:${on ? (tone || '#1e6e42') : '#9a9086'}">${esc(label)} ${on ? COPY.card.yes : COPY.card.no}</span>`;
const factWord = (word, color) => `<span style="font-size:13px;color:${color}">${esc(word)}</span>`;
function decisionChip(r) {
  const c = COPY.boston.pick;
  if (!(r.presentation_requested || r.panel)) return '';
  const s = r.presenter_status || null;
  const tone = s === 'confirmed' ? { bg: '#1e6e42', fg: '#fff', l: c.yes } : s === 'panel' ? { bg: '#2f4f7a', fg: '#fff', l: c.panel } : s === 'declined' ? { bg: '#8a5a1c', fg: '#fff', l: c.no } : { bg: '#eee9df', fg: '#4a4239', l: c.unset };
  return `<span style="flex:none;padding:5px 9px;font:600 9px Inter,sans-serif;letter-spacing:.1em;background:${tone.bg};color:${tone.fg};white-space:nowrap">${esc(tone.l)}</span>`;
}
function cardShell(key, r, head, body) {
  const open = st.bpCardOpen === key;
  return `
        <div data-row="${esc(r.registration_id)}" class="bh-card" style="border-bottom:1px solid rgba(32,27,22,.1);${r.released ? 'opacity:.6' : ''}">
          <div data-act="bpCard" data-key="${esc(key)}" role="button" aria-expanded="${open}" style="padding:14px 16px;cursor:pointer;display:flex;flex-direction:column;gap:5px;min-height:44px;box-sizing:border-box">${head}</div>
          ${open ? `<div class="bh-card-body" style="padding:2px 16px 16px;display:flex;flex-direction:column;gap:12px;background:#fdfbf6;border-top:1px solid rgba(32,27,22,.06)">${body}</div>` : ''}
        </div>`;
}
function presenterCards(shown, h) {
  const c = COPY.boston, k = COPY.card, tm = c.team;
  if (!shown.length) return `<div style="padding:16px;font-size:14px;color:#6d6459;font-style:italic">${k.nobody}</div>`;
  return `<div class="bh-cards" data-v2="boston-presenter-cards">${shown.map(r => {
    const key = 'p:' + r.registration_id;
    const busy = st.bpSending === r.registration_id, releasing = st.bpReleasing === r.registration_id, resending = st.bpResending === r.registration_id;
    const hintShape = r.reminder_sent && !r.released && (r.shape_changed ? r.sent_shape : (st.bpFlipped[r.registration_id] && !r.sent_shape ? st.bpFlipped[r.registration_id] : null));
    const who = `data-id="${esc(r.registration_id)}" data-who="${esc(r.name || r.email)}" data-mail="${esc(r.email)}"`;
    const head = `
            <div style="display:flex;align-items:flex-start;gap:10px"><span style="flex:1;min-width:0;font-size:16px;font-weight:600;line-height:1.3;overflow-wrap:anywhere">${esc(r.name || r.email)}${r.released ? ` <span style="font:600 8px Inter,sans-serif;letter-spacing:.1em;color:#9b1b22">RELEASED${r.released_by === 'team' ? ' BY TEAM' : ''}</span>` : ''}</span>${decisionChip(r)}</div>
            <span style="font-size:13px;color:#6d6459;line-height:1.35">${esc(r.institution || '—')}</span>
            <div style="display:flex;gap:6px 14px;flex-wrap:wrap;align-items:center">${fact(k.slides, !!r.upload)}${fact(k.summary, !!r.onepager)}${r.finished ? factWord(k.finished, '#1e6e42') : ''}${r.guest_requests ? factWord(k.requests, '#8a5a12') : ''}${r.panel ? factWord('panel ' + c.panelReply[r.panel_reply === 'yes' ? 'yes' : r.panel_reply === 'no' ? 'no' : 'none'].toLowerCase().replace(/^[–✓✗] /, ''), r.panel_reply === 'yes' ? '#1e6e42' : r.panel_reply === 'no' ? '#9b1b22' : '#b7791f') : ''}</div>`;
    const body = `
            ${(r.presentation_requested || r.panel) ? `<div><div style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#6d6459;margin-bottom:6px">${k.decision}</div><div class="bh-card-picks" style="display:grid;grid-template-columns:1fr 1fr;gap:6px">${h.pickChip(r, 'confirmed', c.pick.yes, true)}${h.pickChip(r, 'panel', c.pick.panel, true)}${h.pickChip(r, 'declined', c.pick.no, true)}${h.pickChip(r, null, c.pick.unset, true)}</div>
              ${hintShape ? `<div data-v2="boston-resend-hint" style="margin-top:8px;font-size:13px;color:#8a5a12;line-height:1.45">${tm.hint(esc(hintShape))}</div>${cardBtn(resending ? '' : 'bpResendShape', resending ? tm.resendBusy : tm.resend, `${who} data-from="${esc(hintShape)}" data-to="${esc(r.current_shape || '')}"`, 'primary')}` : ''}</div>` : ''}
            ${r.guest_requests ? `<div style="font-size:14px;line-height:1.5;color:#201b16;border-left:3px solid #c9a962;padding-left:10px">✎ ${esc(r.guest_requests)}</div>` : ''}
            <div style="font-size:13px;color:#6d6459;line-height:1.5;overflow-wrap:anywhere">${esc(r.email)}${r.added_by_team ? ` · <span style="font:600 8px Inter,sans-serif;letter-spacing:.1em;color:#7a6432">${c.byTeam}</span>` : ''}<br>${r.invited_at == null ? `<span style="color:#b7791f">${k.linkNot}</span>` : esc(k.linkSent(r.invited_at === true ? '✓' : r.invited_at))}${nudgedLine(r)}</div>
            ${(r.upload || (r.onepager && r.onepager_download_url)) ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
              ${r.upload ? (r.upload.external_url ? cardLink(r.upload.external_url, '✓ ' + c.deckLink, 'target="_blank" rel="noopener"') : cardLink(r.upload.download_url, '✓ ' + c.deckYes)) : ''}
              ${r.onepager && r.onepager_download_url ? cardLink(r.onepager_download_url, '✓ ' + c.cSummary) : ''}
            </div>` : ''}
            ${r.released ? '' : `<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
              ${cardBtn(busy ? '' : 'bpSendOne', busy ? c.busy : (r.invited_at == null ? c.send : c.resend), who, 'primary')}
              ${cardBtn(st.bpMsgBusy === r.registration_id ? '' : 'bpEmail', tm.email, who)}
              ${cardBtn(releasing ? '' : 'bpRelease', releasing ? tm.releaseBusy : tm.release, who)}
              ${cardBtn('bpCard', k.close, `data-key="${esc(key)}"`)}
            </div>`}`;
    return cardShell(key, r, head, body);
  }).join('')}</div>`;
}
function guestCards(rows, h) {
  const c = COPY.cat, k = COPY.card, tm = COPY.boston.team;
  return `<div class="bh-cards" data-v2="boston-guest-cards">${rows.map(r => {
    const key = 'c:' + r.registration_id;
    const busy = st.bpReminding === r.registration_id, releasing = st.bpReleasing === r.registration_id;
    const who = `data-id="${esc(r.registration_id)}" data-who="${esc(r.name || r.email)}" data-mail="${esc(r.email)}"`;
    const allergyOn = r.allergy_state === 'yes';
    const opShared = r.onepager_share_ok !== false;
    const head = `
            <div style="display:flex;align-items:flex-start;gap:10px"><span style="flex:1;min-width:0;font-size:16px;font-weight:600;line-height:1.3;overflow-wrap:anywhere">${esc(r.name || r.email)}</span>${r.presenter ? `<span style="flex:none;padding:5px 9px;font:600 9px Inter,sans-serif;letter-spacing:.1em;background:#eee9df;color:#7a6432;white-space:nowrap">PRESENTING</span>` : ''}</div>
            <span style="font-size:13px;color:#6d6459;line-height:1.35">${esc(r.institution || '—')}</span>
            <div style="display:flex;gap:6px 14px;flex-wrap:wrap;align-items:center">
              ${factWord(r.preference || (k.pref + ' ' + c.noPref), r.preference ? '#201b16' : '#9a9086')}
              ${allergyOn ? factWord('⚠ ' + (r.allergies || 'allergies'), '#9b1b22') : factWord(r.allergy_state === 'none' ? 'no allergies' : 'allergies ' + c.noAllergy, r.allergy_state === 'none' ? '#6d6459' : '#9a9086')}
              ${fact(k.summary, !!r.onepager)}${r.presenter ? fact(k.slides, !!r.slides) : ''}${r.finished ? factWord(k.finished, '#1e6e42') : ''}${r.guest_requests ? factWord(k.requests, '#8a5a12') : ''}
              ${factWord(r.reminder_sent ? k.emailSent(r.reminder_sent_at || '✓') : k.emailNot, r.reminder_sent ? '#6d6459' : '#b7791f')}
            </div>`;
    const body = `
            ${r.guest_requests ? `<div style="font-size:14px;line-height:1.5;color:#201b16;border-left:3px solid #c9a962;padding-left:10px">✎ ${esc(r.guest_requests)}</div>` : ''}
            ${r.onepager_headline ? `<div style="font-size:13px;color:#6d6459;line-height:1.45">${esc(r.onepager_headline)}</div>` : ''}
            <div style="font-size:13px;color:#6d6459;line-height:1.5;overflow-wrap:anywhere">${esc(r.email)}${r.added_by_team ? ` · <span style="font:600 8px Inter,sans-serif;letter-spacing:.1em;color:#7a6432">${COPY.boston.byTeam}</span>` : ''}${r.answered ? `<br>answered${r.answered_at ? ' ' + esc(String(r.answered_at).slice(0, 10)) : ''}` : ''}${nudgedLine(r)}</div>
            ${r.onepager && r.onepager_download_url ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">${cardLink(r.onepager_download_url, (opShared ? c.opShared : c.opPrivate) + ' · ' + c.cOnePager)}</div>` : ''}
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
              ${cardBtn(busy ? '' : 'bpRemindOne', busy ? c.busy : (r.reminder_sent ? c.resend : c.send), who, 'primary')}
              ${cardBtn(st.bpMsgBusy === r.registration_id ? '' : 'bpEmail', tm.email, who)}
              ${cardBtn(releasing ? '' : 'bpRelease', releasing ? tm.releaseBusy : tm.release, who)}
              ${cardBtn('bpCard', k.close, `data-key="${esc(key)}"`)}
            </div>`;
    return cardShell(key, r, head, body);
  }).join('')}</div>`;
}
// ---- the team controls shared by both tables (Alen 2026-09-16) ----
// "18 Sep" from "2026-09-18" — the card's own short date, no library.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dayOf(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] || ''}`.trim() : String(iso || '');
}
// The latest nudge under the email — one line, the newest template wins.
function nudgedLine(r) {
  const n = r && r.nudged;
  if (!n) return '';
  const last = ['slides', 'panel', 'general'].map(k => n[k] ? { k, d: n[k] } : null).filter(Boolean).sort((a, b) => a.d < b.d ? 1 : a.d > b.d ? -1 : 0)[0];
  return last ? `<span data-v2="boston-nudged" style="display:block;font-size:10.5px;color:#8a5a12;margin-top:2px">${esc(COPY.boston.team.nudged(last.k, dayOf(last.d)))}</span>` : '';
}
// EMAIL · RELEASE SEAT under the row's main button. Quiet text, not buttons: the primary action
// on each table stays the send. A released row gets neither (restore lives in the released list).
function rowTeamActions(r, releasing) {
  const tm = COPY.boston.team;
  if (r.released) return '';
  const link = (act, label, extra, on) => `<span data-act="${on ? act : ''}" ${extra} style="font:600 8.5px Inter,sans-serif;letter-spacing:.11em;color:${on ? '#6d6459' : '#b7a89a'};cursor:${on ? 'pointer' : 'progress'};white-space:nowrap" ${on ? 'data-hover="color:#9b1b22"' : 'aria-disabled="true"'}>${esc(label)}</span>`;
  const who = `data-id="${esc(r.registration_id)}" data-who="${esc(r.name || r.email)}" data-mail="${esc(r.email)}"`;
  return `<span data-v2="boston-row-team" style="display:block;margin-top:6px;text-align:right">${link('bpEmail', tm.email, who, st.bpMsgBusy !== r.registration_id)}<span style="color:#d6cfc4;margin:0 6px">·</span>${link('bpRelease', releasing ? tm.releaseBusy : tm.release, who, !releasing)}</span>`;
}
// Second section of the same card: THE Boston email and everything it brings back. Every guest is
// here (presenters included) because the email — the program, the food, the booklet — is for
// everyone. The program PDF sits at the top because no real send can happen without it.
function sectionCatering(btn, cell, head) {
  const c = COPY.cat;
  const C = D.cat;
  const lockErr = D.errors && D.errors.cat;
  if (lockErr && lockErr.status === 403) return '';           // the presenters block already shows the lock
  const rows = C ? (C.rows || []) : [];
  const pending = C ? Number(C.reminders_pending) || 0 : 0;
  const opGot = C ? Number(C.onepagers_received) || 0 : 0;
  const opPriv = C ? Number(C.onepagers_private) || 0 : 0;
  const opShareable = C ? Math.max(0, opGot - opPriv) : 0;
  const prefLine = C ? (C.preferences || []).filter(p => p.count).map(p => `${esc(p.label)} ${p.count}`).join(' · ') : '';
  const prog = (C && C.program) || null;
  const progOn = !!(prog && prog.present);
  const progLine = progOn
    ? c.progOn(Math.max(1, Math.round(Number(prog.size || 0) / 1024)) + ' KB', String(prog.uploaded_at || '').slice(0, 10) || '—')
      + (prog.source === 'env' ? ' · ' + c.progEnv : '')
    : c.progNone;
  const ghostLink = (href, label) => `<a href="${esc(href)}" class="bh-act" style="padding:8px 13px;border:1px solid rgba(32,27,22,.25);background:#fff;color:#201b16;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;white-space:nowrap" data-hover="border-color:#201b16">${esc(label)}</a>`;
  return `
      <div style="border-top:1px solid rgba(32,27,22,.14)">
        <div class="bh-bo-head" style="display:flex;align-items:center;gap:10px;padding:14px 20px;border-bottom:1px solid rgba(32,27,22,.1);flex-wrap:wrap">
          <span class="bh-bo-title" style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${c.title}</span>
          <span class="bh-bo-sub" style="font-size:11.5px;color:#6d6459">${c.sub}</span>
          <div class="bh-sp" style="flex:1"></div>
          ${C ? btn('bpRemindAll', !progOn ? c.needProgram : pending ? c.sendAll(pending) : c.allSent, progOn && pending > 0, 'class="bh-act"') : ''}
          ${C ? ghostLink(C.csv_url || '/api/v2/boston/catering.csv', c.csv) : ''}
          ${C && opShareable ? ghostLink(C.onepagers_zip_url || '/api/v2/boston/onepagers.zip', c.opZip(opShareable))
            : C ? `<span class="bh-act" style="padding:8px 13px;border:1px solid rgba(32,27,22,.15);color:#9a9086;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;white-space:nowrap" aria-disabled="true">${c.opZipNone}</span>` : ''}
        </div>
        ${C ? `
        <!-- v2: the program PDF — the one attachment, and the gate on every real send -->
        <div class="bh-bo-prog" style="display:flex;align-items:center;gap:10px 14px;flex-wrap:wrap;padding:12px 20px;background:#fdfbf6;border-bottom:1px solid rgba(32,27,22,.08)">
          <span class="bh-full" style="font:600 8.5px Inter,sans-serif;letter-spacing:.12em;color:#6d6459">${c.progTitle}</span>
          <span class="bh-full" style="font-size:11.5px;color:${progOn ? '#1e6e42' : '#b7791f'}">${progOn ? '✓ ' : ''}${esc(progLine)}</span>
          <label class="bh-act" style="padding:8px 13px;border:1px solid rgba(32,27,22,.25);background:#fff;color:#201b16;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;white-space:nowrap;cursor:pointer" data-hover="border-color:#201b16">${st.bpProgramBusy ? c.progBusy : progOn ? c.progReplace : c.progUpload}<input data-role="bbProgramFile" type="file" accept="application/pdf,.pdf" style="display:none"></label>
          <div class="bh-sp" style="flex:1"></div>
          <span class="bh-full" style="font:600 8.5px Inter,sans-serif;letter-spacing:.12em;color:#6d6459">${c.prevTitle}</span>
          ${btn('bpPreview', st.bpPreviewing === 'presenter' ? c.prevBusy : c.prevPresenter, !st.bpPreviewing, 'data-variant="presenter" class="bh-act"', 'ghost')}
          ${btn('bpPreview', st.bpPreviewing === 'panel' ? c.prevBusy : c.prevPanel, !st.bpPreviewing, 'data-variant="panel" class="bh-act"', 'ghost')}
          ${btn('bpPreview', st.bpPreviewing === 'attendee' ? c.prevBusy : c.prevAttendee, !st.bpPreviewing, 'data-variant="attendee" class="bh-act"', 'ghost')}
          ${btn('bpPreview', st.bpPreviewing === 'declined' ? c.prevBusy : c.prevDeclined, !st.bpPreviewing, 'data-variant="declined" class="bh-act"', 'ghost')}
        </div>` : ''}
        ${(D.decks && D.decks.length) ? `
        <!-- the host's own decks for the evening (S3 boston/decks/, presigned 1 h) — Alen 2026-09-21 -->
        <div class="bh-bo-decks" style="display:flex;align-items:center;gap:10px 14px;flex-wrap:wrap;padding:12px 20px;background:#fff;border-bottom:1px solid rgba(32,27,22,.08)">
          <span class="bh-full" style="font:600 8.5px Inter,sans-serif;letter-spacing:.12em;color:#6d6459">HOST DECKS · TONIGHT</span>
          ${D.decks.map(d => `<a href="${esc(d.url || '#')}" class="bh-act" download="${esc(d.filename || '')}" style="padding:9px 14px;background:#201b16;color:#fff;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;white-space:nowrap;text-decoration:none" data-hover="background:#9b1b22">⬇ ${esc(d.label)}${d.size ? ` · ${Math.round(d.size / 1048576)} MB` : ''}</a>`).join('')}
          <span class="bh-full" style="font-size:11px;color:#9a9086">links valid for an hour after the page loads — reload for fresh ones</span>
        </div>` : ''}
        ${C ? `<div class="bh-bo-strip" style="display:flex;gap:8px 20px;flex-wrap:wrap;padding:11px 20px;background:#fdfbf6;border-bottom:1px solid rgba(32,27,22,.08);font-size:11.5px;color:#6d6459">
          <span><b style="color:#201b16">${esc(c.stripReg(C.total || 0))}</b></span>
          <span><b style="color:#201b16">${esc(c.strip(C.answered || 0, C.total || 0, C.with_allergies || 0, C.not_answered || 0))}</b></span>
          <span><b style="color:#201b16">${esc(c.stripOp(opGot, C.total || 0, opPriv))}</b></span>
          <span><b style="color:${(C.slides_in || 0) >= (C.slides_expected || 0) ? '#1e6e42' : '#201b16'}">${esc(c.stripSlides(C.slides_in || 0, C.slides_expected || 0))}</b></span>
          <span><b style="color:#201b16">${esc(c.stripFinished(C.finished_count || 0))}</b></span>
          ${C.panel_count ? `<span><b style="color:${(C.panel_accepted || 0) >= (C.panel_count || 0) ? '#1e6e42' : '#201b16'}">${esc(c.stripPanel(C.panel_accepted || 0, C.panel_count || 0))}</b></span>` : ''}
          ${C.released_count ? `<span style="color:#9b1b22"><b style="color:#9b1b22">${esc(c.stripCancelled(C.released_count))}</b></span>` : ''}
          ${prefLine ? `<span>${prefLine}</span>` : ''}
        </div>` : ''}
        ${sectionKitchen()}
        ${sectionReleased(btn)}
        ${!C && !lockErr ? `<div class="empty" style="padding:18px 20px"><span class="empty-line" style="font-family:Fraunces,serif;font-style:italic;font-size:14px">Not right now.</span><span class="empty-why" style="font-size:11.5px;color:#6d6459">${c.down}</span></div>` : ''}
        ${C && !rows.length ? `<div class="empty" style="padding:18px 20px"><span class="empty-line" style="font-family:Fraunces,serif;font-style:italic;font-size:14px">${c.empty}</span><span class="empty-why" style="font-size:11.5px;color:#6d6459">${c.emptyWhy}</span></div>` : ''}
        ${C && rows.length ? (isPhone() ? guestCards(rows, { btn }) : `
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:12.5px;min-width:860px">
            <thead><tr><th style="${head}">${c.cWho}</th><th style="${head}">${c.cInst}</th><th style="${head}">${c.cPref}</th><th style="${head}">${c.cAllergy}</th><th style="${head}">${c.cOnePager}</th><th style="${head}">${c.cAnswered}</th><th style="${head}">${c.cDone}</th><th style="${head}">${c.cReq}</th><th style="${head}">${c.cRem}</th><th style="${head}"></th></tr></thead>
            <tbody>
            ${rows.map(r => {
              const busy = st.bpReminding === r.registration_id;
              const allergy = r.allergy_state === 'yes' ? esc(r.allergies || 'yes')
                : r.allergy_state === 'none' ? c.allergyNone : c.noAllergy;
              // The guest's own answer to "share it with all participants?" is what the chip
              // reports — a private summary is on file for the team but never in the archive.
              const opShared = r.onepager_share_ok !== false;
              const opLabel = opShared ? c.opShared : c.opPrivate;
              const opSkin = opShared ? 'background:#e6efe8;color:#1e6e42' : 'background:#fdf1dc;color:#8a5a12';
              const opHover = opShared ? 'background:#1e6e42;color:#fff' : 'background:#8a5a12;color:#fff';
              const opMark = r.onepager
                ? (r.onepager_download_url
                  ? `<a href="${esc(r.onepager_download_url)}" style="font:600 8.5px Inter,sans-serif;letter-spacing:.1em;${opSkin};padding:3px 8px;white-space:nowrap" data-hover="${opHover}">${opLabel}</a>`
                  : `<span style="color:${opShared ? '#1e6e42' : '#8a5a12'}">${opLabel}</span>`)
                : `<span style="color:#9a9086">${c.opNo}</span>`;
              return `
              <tr data-row="${esc(r.registration_id)}">
                <td style="${cell}"><span style="display:block;font-weight:600">${esc(r.name || r.email)}</span><span style="display:block;font-size:11px;color:#6d6459">${esc(r.email)}${r.presenter ? ` · <span style="font:600 7.5px Inter,sans-serif;letter-spacing:.1em;color:#7a6432">PRESENTING</span>` : ''}${r.added_by_team ? ` · <span style="font:600 7.5px Inter,sans-serif;letter-spacing:.1em;color:#7a6432">${COPY.boston.byTeam}</span>` : ''}</span>${nudgedLine(r)}</td>
                <td style="${cell};color:#6d6459">${esc(r.institution || '—')}</td>
                <td style="${cell};white-space:nowrap;color:${r.preference ? '#201b16' : '#9a9086'}">${r.preference ? esc(r.preference) : c.noPref}</td>
                <td style="${cell};color:${r.allergy_state === 'yes' ? '#9b1b22' : r.allergy_state === 'none' ? '#6d6459' : '#9a9086'}">${allergy}</td>
                <td style="${cell}">${opMark}${r.onepager_headline ? `<span style="display:block;font-size:11px;color:#6d6459;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.onepager_headline)}">${esc(r.onepager_headline)}</span>` : ''}</td>
                <td style="${cell};white-space:nowrap;color:${r.answered ? '#1e6e42' : '#b7791f'}">${r.answered ? '✓' + (r.answered_at ? ' ' + esc(String(r.answered_at).slice(0, 10)) : '') : '—'}</td>
                <td style="${cell};white-space:nowrap">${r.presenter
                  ? (r.slides ? `<span style="color:#1e6e42">✓ ${r.slides_link ? c.deckLink : 'DECK'}</span>` : '<span style="color:#b7791f">no deck</span>')
                  : '<span style="color:#9a9086">–</span>'}${r.finished ? `<span style="display:block;font:600 7.5px Inter,sans-serif;letter-spacing:.1em;color:#1e6e42">${c.finishedMark}</span>` : ''}</td>
                <td style="${cell};max-width:200px">${r.guest_requests ? `<span title="${esc(r.guest_requests)}" style="display:block;font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">✎ ${esc(r.guest_requests)}</span>` : '<span style="color:#9a9086">–</span>'}</td>
                <td style="${cell};white-space:nowrap;color:${r.reminder_sent ? '#6d6459' : '#b7791f'}">${r.reminder_sent ? esc(r.reminder_sent_at || '✓') : c.notSent}</td>
                <td style="${cell};text-align:right;white-space:nowrap">${btn('bpRemindOne', busy ? c.busy : (r.reminder_sent ? c.resend : c.send), !busy, `data-id="${esc(r.registration_id)}" data-who="${esc(r.name || r.email)}" data-mail="${esc(r.email)}"`)}${rowTeamActions(r, st.bpReleasing === r.registration_id)}</td>
              </tr>`;
            }).join('')}
            </tbody>
          </table>
        </div>`) : ''}
      </div>`;
}
// The CATERING block (Alen 2026-09-16): "how many vegan, how many whatever" — head counts per
// preference the kitchen can cook from (unset and unanswered counted too, so the numbers add up to
// the room), every allergy with a name, and every special request with a name.
function sectionKitchen() {
  const c = COPY.cat.kitchen;
  const C = D.cat;
  if (!C || !C.catering) return '';
  const K = C.catering;
  const total = Number(C.total) || 0;
  const pills = (K.by_preference || []).map(p => `<span class="bh-kit-pill" style="display:inline-flex;align-items:baseline;gap:6px;padding:7px 11px;border:1px solid rgba(32,27,22,.14);background:#fff"><b style="font:600 18px Fraunces,serif;color:#201b16">${Number(p.count) || 0}</b><span style="font:600 8.5px Inter,sans-serif;letter-spacing:.1em;color:#6d6459">${esc(String(p.label).toUpperCase())}</span></span>`).join('');
  const answered = (K.by_preference || []).filter(p => p.key !== 'unset').reduce((n, p) => n + (Number(p.count) || 0), 0);
  const al = K.allergies || [];
  const rq = K.requests || [];
  return `
        <div data-v2="boston-catering" class="bh-kit" style="border-bottom:1px solid rgba(32,27,22,.08);background:#fffdf8">
          <div class="bh-kit-head" style="display:flex;align-items:center;gap:10px;padding:12px 20px;flex-wrap:wrap">
            <span style="font:600 8.5px Inter,sans-serif;letter-spacing:.12em;color:#8a5a12">${c.title}</span>
            <span class="bh-kit-sub" style="font-size:11.5px;color:#6d6459">${c.sub}</span>
            <div class="bh-sp" style="flex:1"></div>
            <span class="bh-kit-n" style="font-size:11px;color:#6d6459">${esc(String(answered))} of ${esc(String(total))} chose a preference</span>
          </div>
          <div class="bh-kit-pills" style="display:flex;gap:8px;flex-wrap:wrap;padding:0 20px 12px">${pills}</div>
          <div class="mx-two bh-kit-lists" style="display:grid;grid-template-columns:1fr 1fr;gap:18px;padding:0 20px 14px">
            <div>
              <div style="font:600 8.5px Inter,sans-serif;letter-spacing:.12em;color:#9b1b22;margin-bottom:6px">${c.allergyTitle} · ${al.length}</div>
              ${al.length ? al.map(a => `<div class="bh-kit-row" style="display:flex;gap:10px;padding:5px 0;border-top:1px solid rgba(32,27,22,.07);font-size:12.5px"><span style="font-weight:600;min-width:150px">${esc(a.name)}</span><span style="color:#9b1b22">${esc(a.allergies)}</span></div>`).join('') : `<div style="font-size:12px;color:#6d6459;font-style:italic">${c.allergyNone}</div>`}
              <div class="bh-kit-foot" style="font-size:11px;color:#6d6459;margin-top:8px">${esc(c.noAllergies(Number(K.no_allergies) || 0))} · ${esc(c.allergiesUnanswered(Number(K.allergies_unanswered) || 0))}</div>
            </div>
            <div>
              <div style="font:600 8.5px Inter,sans-serif;letter-spacing:.12em;color:#7a6432;margin-bottom:6px">${c.reqTitle} · ${rq.length}</div>
              ${rq.length ? rq.map(r => `<div class="bh-kit-row" style="padding:5px 0;border-top:1px solid rgba(32,27,22,.07);font-size:12.5px"><span style="font-weight:600">${esc(r.name)}</span><span style="display:block;color:#201b16;margin-top:2px">${esc(r.text)}</span></div>`).join('') : `<div style="font-size:12px;color:#6d6459;font-style:italic">${c.reqNone}</div>`}
            </div>
          </div>
        </div>`;
}
// Seats handed back from the one email. Collapsed by default and absent entirely when nobody has
// released one — the good state is silence. Open, it is the shortest possible list (who, when) plus
// the undo, because that is all the team ever wants from it.
function sectionReleased(btn) {
  const c = COPY.cat;
  const C = D.cat;
  const rel = C ? (C.released || []) : [];
  if (!rel.length) return '';
  const open = !!st.bpRelOpen;
  return `
        <div data-v2="boston-released" style="border-bottom:1px solid rgba(32,27,22,.08);background:#fdf7f2">
          <div class="bh-rel-head" style="display:flex;align-items:center;gap:10px;padding:11px 20px;flex-wrap:wrap">
            <span style="font:600 8.5px Inter,sans-serif;letter-spacing:.12em;color:#8a5a12">${esc(c.relTitle(rel.length))}</span>
            <div style="flex:1"></div>
            <span data-act="bpRelToggle" role="button" aria-expanded="${open}" class="bh-rel-toggle" style="font:600 9.5px Inter,sans-serif;letter-spacing:.13em;color:#9b1b22;cursor:pointer;white-space:nowrap" data-hover="color:#201b16">${open ? c.relClose : c.relOpen}</span>
          </div>
          ${open ? `
          <div style="padding:0 20px 14px">
            <div class="bh-rel-why" style="font-size:11.5px;color:#6d6459;margin-bottom:10px">${esc(c.relWhy)}</div>
            ${rel.map(r => {
              const busy = st.bpRestoring === r.registration_id;
              return `
              <div data-row="${esc(r.registration_id)}" class="bh-rel-row" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 0;border-top:1px solid rgba(32,27,22,.07)">
                <span class="bh-rel-name" style="font-weight:600;font-size:12.5px">${esc(r.name || r.email)}</span>
                <span class="bh-rel-mail" style="font-size:11px;color:#6d6459">${esc(r.email)}${r.institution ? ' · ' + esc(r.institution) : ''}${r.presenter ? ' · <span style="font:600 7.5px Inter,sans-serif;letter-spacing:.1em;color:#7a6432">WAS PRESENTING</span>' : ''}</span>
                <div class="bh-sp" style="flex:1"></div>
                <span class="bh-rel-when" style="font-size:11px;color:#8a5a12;white-space:nowrap">${esc(c.relWhen(r.released_on))}${r.released_by === 'team' ? ' · by the team' : ''}</span>
                ${btn('bpRestore', busy ? c.restoreBusy : c.restore, !busy, `data-id="${esc(r.registration_id)}" data-who="${esc(r.name || r.email)}" data-mail="${esc(r.email)}" class="bh-act"`, 'ghost')}
              </div>`;
            }).join('')}
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
// The fold around the Boston block (2026-09-17). The block is the heaviest thing on the screen
// (presenters · the Boston email · catering · released seats), so it stays folded until the Boston
// row's MANAGE opens it — /projects/bridges/boston deep-links to it open, CLOSE on its eyebrow
// folds it again. Nothing inside blockBoston() changes; this is only where and when it is drawn.
// Folded = an empty, hidden slot, so the column's gap does not open up around nothing.
function blockBostonSlot() {
  const c = COPY.bostonBar;
  if (!st.bostonOpen) return `<div data-block="boston-slot" id="boston-block" hidden></div>`;
  return `
    <!-- v2: BOSTON — folded behind MANAGE on the Boston row; the block itself is untouched -->
    <div data-block="boston-slot" id="boston-block" data-v2="boston-slot">
      <div style="display:flex;align-items:center;gap:10px;padding:0 2px;margin-top:22px">
        <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#6d6459">${c.eyebrow}</span>
        <div style="flex:1"></div>
        <span data-act="bostonClose" style="font:600 9.5px Inter,sans-serif;letter-spacing:.13em;color:#9b1b22;cursor:pointer;white-space:nowrap" data-hover="color:#201b16">${c.close}</span>
      </div>
      ${blockBoston()}
    </div>`;
}
function template() {
  return `
<div class="mxpj" data-screen-label="Admin Bridges Hub" style="min-height:100vh;background:#f6f2ea;color:#201b16;font-family:Inter,sans-serif">
  ${blockSubnav()}
  <div class="mx-gutter mx-stagger bh-col" style="max-width:1180px;margin:0 auto;padding:30px 28px 48px;display:flex;flex-direction:column;gap:24px">
    ${scannerBtn('hub')}
    ${blockTitle()}
    ${blockBand()}
    <div class="mx-two bh-two" style="display:grid;grid-template-columns:1.5fr 1fr;gap:22px;align-items:start">
      ${blockEvents()}
      <div class="bh-side" style="display:flex;flex-direction:column;gap:22px">
        ${blockReady()}
        ${blockFollowups()}
        ${blockAfter()}
      </div>
    </div>
    ${blockBostonSlot()}
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
  rerender('[data-block="boston-slot"]', blockBostonSlot());
  rerender('[data-block="stats"]', blockStats());
}
// Open / fold the Boston block in place and keep the URL truthful (/projects/bridges/boston is
// the deep link), the way member-pages syncs its tab — no route round-trip, so nothing reloads
// and the page does not jump to the top first.
function setBostonOpen(open) {
  st.bostonOpen = !!open;
  try { history.replaceState(history.state, '', st.bostonOpen ? '/projects/bridges/boston' : '/projects/bridges'); } catch (e) {}
  rerender('[data-block="boston-slot"]', blockBostonSlot());
}
function scrollToBoston() {
  const el = rootEl && rootEl.querySelector('#boston-block');
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
// A team deed touches both tables (a nudge date, a released seat, a new guest) — re-read both,
// draw once.
async function refreshBostonAll() {
  try {
    const [p, c] = await Promise.all([api.get('/api/v2/boston/presenters').catch(() => null), api.get('/api/v2/boston/catering').catch(() => null)]);
    if (p && p.ok) { D.pres = p; if (D.errors) delete D.errors.pres; }
    if (c && c.ok) { D.cat = c; if (D.errors) delete D.errors.cat; }
  } catch (e) { /* keep the last read on screen */ }
  rerender('[data-block="boston"]', blockBoston());
}
// The add-a-guest fields survive a re-render (a toggle, a toast) — read them into state first.
function readGuestForm() {
  if (!rootEl || !rootEl.querySelector('[data-role="bgFirst"]')) return;
  st.bg = { first: val('bgFirst'), last: val('bgLast'), email: val('bgEmail').toLowerCase(), inst: val('bgInst'), pos: val('bgPos'), presenter: checked('bgPresenter'), panel: checked('bgPanel') };
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

// The program PDF — the one attachment on the Boston email. It goes to the admin backend, which
// forwards it to the member portal (the team key never reaches this browser on the write path).
async function uploadProgram(input) {
  const c = COPY.cat;
  const file = input.files && input.files[0];
  if (!file) return;
  if (!/\.pdf$/i.test(file.name) || file.size > 10 * 1024 * 1024) { input.value = ''; ui.toast(c.progBad, { kind: 'error' }); return; }
  st.bpProgramBusy = true; rerender('[data-block="boston"]', blockBoston());
  try {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/v2/boston/program', { method: 'POST', headers: { Authorization: 'Bearer ' + (localStorage.getItem('medx_token') || '') }, body: fd });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.success) throw new Error(j.error || c.progBad);
    st.bpProgramBusy = false;
    await refreshCatering();
    ui.toast(c.progSaved);
  } catch (e) {
    st.bpProgramBusy = false; rerender('[data-block="boston"]', blockBoston());
    ui.toast(e.message || c.progBad, { kind: 'error' });
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
  // ---- the Boston fold: MANAGE on the Boston row opens the block and goes to it; CLOSE on its
  // eyebrow folds it. Already open → just go to it.
  bostonOpen: () => { if (!st.bostonOpen) setBostonOpen(true); scrollToBoston(); },
  bostonClose: () => { setBostonOpen(false); const row = rootEl && rootEl.querySelector('[data-block="events"]'); if (row) row.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
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
  // an evening just held → its recap row (v2_bridges_editions, next edition number, hidden until ready)
  makeRecap: async (el) => {
    const e = hubEvents().find(x => String(x.id) === String(el.dataset.id));
    if (!e) return;
    el.setAttribute('aria-disabled', 'true');
    try {
      const r = await api.post('/api/v2/bridges/editions', { city: e.city, venue: e.venue_name || null, event_date: String(e.event_date || '').slice(0, 10) || null, event_id: e.id, is_published: 0 });
      await refreshHub();
      st.recapEdit = (r && r.edition && r.edition.id) || null; st.editEvent = null;
      rerenderAll();
      ui.toast(COPY.events.recapMade(e.city));
    } catch (err) { el.removeAttribute('aria-disabled'); ui.toast(err.message, { kind: 'error' }); }
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
  // ---- Boston · who actually presents. These are NOT sends: each one only decides which shape
  // that guest's Boston email takes, so the confirm says so plainly rather than warning about mail.
  bpPick: async (el) => {
    const c = COPY.boston;
    const id = el.dataset.id, who = el.dataset.who || '';
    const status = el.dataset.status ? el.dataset.status : null;
    const row = ((D.pres && D.pres.rows) || []).find(r => r.registration_id === id);
    if (row && (row.presenter_status || null) === status) return;         // already in that state
    if (!await ui.confirm({ title: c.cPickTitle(esc(who), status), body: c.cPickBody(status), ok: c.goPick, cancel: c.keep })) return;
    st.bpPicking = id; rerender('[data-block="boston"]', blockBoston());
    try {
      await api.post('/api/v2/boston/presenters/' + encodeURIComponent(id) + '/status', { status });
      st.bpPicking = null;
      // The Boston email already went to them → the row will offer "send the updated one". Rows
      // emailed before the shape was stored carry no sent_shape; remember what they most likely
      // got (the shape their row read a moment ago) so the hint still appears.
      if (row && row.reminder_sent && !st.bpFlipped[id]) st.bpFlipped[id] = row.current_shape || 'previous';
      await refreshBoston();
      ui.toast(c.picked(who, status));
    } catch (e) { st.bpPicking = null; rerender('[data-block="boston"]', blockBoston()); ui.toast(e.message, { kind: 'error' }); }
  },
  // ---- Boston · team controls (Alen 2026-09-16) — every one a real deed on the member side ----
  // The composer: three drafts fetched for THIS person (greeting included), a template picker that
  // swaps subject + body, both editable; SEND IT posts exactly what is on screen.
  bpEmail: async (el) => {
    const tm = COPY.boston.team;
    const id = el.dataset.id, who = el.dataset.who || '', mail = el.dataset.mail || '';
    if (st.bpMsgBusy) return;
    st.bpMsgBusy = id; rerender('[data-block="boston"]', blockBoston());
    let d = null;
    try { d = await api.get('/api/v2/boston/message/draft?id=' + encodeURIComponent(id)); }
    catch (e) { st.bpMsgBusy = null; rerender('[data-block="boston"]', blockBoston()); ui.toast(e.message, { kind: 'error' }); return; }
    st.bpMsgBusy = null; rerender('[data-block="boston"]', blockBoston());
    const drafts = (d && d.drafts) || {};
    const tpl0 = ['slides', 'panel', 'general'].includes(d && d.suggested) ? d.suggested : 'general';
    const field = 'width:100%;box-sizing:border-box;border:1px solid rgba(32,27,22,.25);background:#fff;padding:9px 10px;font-size:12.5px;color:#201b16;font-family:Inter,sans-serif';
    const lab = 'display:block;font:600 8.5px Inter,sans-serif;letter-spacing:.12em;color:#6d6459;margin:12px 0 5px';
    const body = `
      <div data-v2="boston-composer">
        <div style="font-size:12px;color:#6d6459">${esc(mail)} · ${tm.greetingNote(esc(d.greeting || 'Dear colleague,'))}</div>
        <label style="${lab}">${tm.tplLabel}</label>
        <select data-role="bmTpl" style="${field}">${['slides', 'panel', 'general'].map(k => `<option value="${k}" ${k === tpl0 ? 'selected' : ''}>${esc(tm.tpl[k])}</option>`).join('')}</select>
        <label style="${lab}">${tm.subjLabel}</label>
        <input data-role="bmSubj" value="${esc((drafts[tpl0] || {}).subject || '')}" style="${field}">
        <label style="${lab}">${tm.bodyLabel}</label>
        <textarea data-role="bmBody" rows="9" style="${field};line-height:1.55;resize:vertical">${esc((drafts[tpl0] || {}).body || '')}</textarea>
        <div style="font-size:11px;color:#9a9086;margin-top:6px">${esc(tm.bodyHint)}</div>
        <div style="font-size:11px;color:#8a5a12;margin-top:8px">${esc(tm.ccNote)}</div>
      </div>`;
    let sending = false;
    const m = ui.modal({
      eyebrow: tm.eyebrow, title: esc(tm.title(who)), body, closeOnScrim: false,
      actions: [
        { label: COPY.boston.keep },
        { label: tm.send, kind: 'primary', onClick: () => {
          if (sending) return false;
          const root = m.el;
          const template = root.querySelector('[data-role="bmTpl"]').value;
          const subject = root.querySelector('[data-role="bmSubj"]').value.trim();
          const text = root.querySelector('[data-role="bmBody"]').value.trim();
          if (!text) { ui.toast(tm.typeFirst, { kind: 'error' }); return false; }
          sending = true;
          (async () => {
            try {
              const r = await api.post('/api/v2/boston/message', { to: id, template, subject, body: text });
              ui.toast(tm.sent((r && r.sent && r.sent[0]) || mail));
              await refreshBostonAll();
            } catch (e) { ui.toast(e.message, { kind: 'error' }); }
          })();
          return undefined;                                   // closes the sheet; the toast reports
        } }
      ]
    });
    const sheet = m.el.querySelector('.mx-modal-sheet'); if (sheet) sheet.style.width = '580px';
    // picking another template swaps the draft in — the team's edits are theirs to redo
    m.el.addEventListener('change', e => {
      if (!e.target || e.target.getAttribute('data-role') !== 'bmTpl') return;
      const k = e.target.value; const dr = drafts[k] || { subject: '', body: '' };
      m.el.querySelector('[data-role="bmSubj"]').value = dr.subject || '';
      m.el.querySelector('[data-role="bmBody"]').value = dr.body || '';
    });
    const first = m.el.querySelector('[data-role="bmBody"]'); if (first && !first.value) first.focus();
  },
  bpBulkEmail: async (el) => {
    const tm = COPY.boston.team;
    const kind = el.dataset.kind === 'panel-awaiting' ? 'panel-awaiting' : 'slides-missing';
    const template = kind === 'panel-awaiting' ? 'panel' : 'slides';
    const rows = (D.pres && D.pres.rows) || [];
    const group = kind === 'slides-missing' ? rows.filter(r => r.presenter && !r.upload && !r.released) : rows.filter(r => r.panel && !r.panel_reply && !r.released);
    if (!group.length || st.bpBulkBusy) return;
    const names = group.map(r => `<b>${esc(r.name || r.email)}</b>`).join(', ');
    if (!await ui.confirm({ title: tm.cBulkTitle(kind, group.length), body: tm.cBulkBody(kind, names), ok: tm.goBulk, cancel: COPY.boston.keep })) return;
    st.bpBulkBusy = kind; rerender('[data-block="boston"]', blockBoston());
    try {
      const r = await api.post('/api/v2/boston/message', { to: kind, template });
      st.bpBulkBusy = null;
      await refreshBostonAll();
      ui.toast(tm.bulkSent((r && r.sent && r.sent.length) || 0, (r && r.skipped && r.skipped.length) || 0));
    } catch (e) { st.bpBulkBusy = null; rerender('[data-block="boston"]', blockBoston()); ui.toast(e.message, { kind: 'error' }); }
  },
  bpRelease: async (el) => {
    const tm = COPY.boston.team;
    const id = el.dataset.id, who = el.dataset.who || '', mail = el.dataset.mail || '';
    if (st.bpReleasing) return;
    const row = ((D.pres && D.pres.rows) || []).find(r => r.registration_id === id) || ((D.cat && D.cat.rows) || []).find(r => r.registration_id === id) || {};
    const role = tm.roleOf(row);
    if (!await ui.confirm({ title: tm.cRelTitle(esc(who)), body: tm.cRelBody(esc(who), esc(mail), esc(role)), ok: tm.goRelease, cancel: COPY.boston.keep })) return;
    st.bpReleasing = id; rerender('[data-block="boston"]', blockBoston());
    try {
      const r = await api.post('/api/v2/boston/registrations/' + encodeURIComponent(id) + '/release', {});
      st.bpReleasing = null; st.bpRelOpen = true;
      await refreshBostonAll();
      ui.toast(tm.released(mail, r && r.registered_now));
    } catch (e) { st.bpReleasing = null; rerender('[data-block="boston"]', blockBoston()); ui.toast(e.message, { kind: 'error' }); }
  },
  bpGuestToggle: () => { readGuestForm(); st.bpGuestOpen = !st.bpGuestOpen; rerender('[data-block="boston"]', blockBoston()); },
  bpGuestAdd: async () => {
    const tm = COPY.boston.team;
    readGuestForm();
    const g = st.bg;
    if (!g.first || !g.last || !g.email) { ui.toast(tm.needGuest, { kind: 'error' }); return; }
    const who = `${g.first} ${g.last}`;
    const role = g.presenter ? 'presenting (5-minute talk)' : g.panel ? 'on the panel' : '';
    if (!await ui.confirm({ title: tm.cAddGuestTitle, body: tm.cAddGuestBody(esc(who), esc(g.email), esc(role)), ok: tm.goAddGuest, cancel: COPY.boston.keep })) return;
    st.bgBusy = true; rerender('[data-block="boston"]', blockBoston());
    let r = null;
    try {
      r = await api.post('/api/v2/boston/guests/add', { first_name: g.first, last_name: g.last, email: g.email, institution: g.inst, position: g.pos, presenter: !!g.presenter, panel: !!g.panel });
    } catch (e) {
      st.bgBusy = false; rerender('[data-block="boston"]', blockBoston());
      ui.toast(e.status === 409 || /already on the/i.test(e.message || '') ? (e.message || tm.guestExists) : e.message, { kind: 'error' });
      return;
    }
    st.bgBusy = false; st.bpGuestOpen = false; st.bg = { first: '', last: '', email: '', inst: '', pos: '', presenter: false, panel: false };
    await refreshBostonAll();
    ui.toast(tm.guestAdded(g.email));
    // the offer: their Boston email, now — the one with the ticket and the wallet passes
    const progOn = !!(D.cat && D.cat.program && D.cat.program.present);
    if (!progOn) { ui.toast(COPY.cat.needProgram, { kind: 'error' }); return; }
    const id = r && r.registration_id; if (!id) return;
    if (!await ui.confirm({ title: tm.cSendNowTitle(esc(who)), body: tm.cSendNowBody(esc(g.email), esc((r && r.shape) || 'attendee')), ok: tm.goSendNow, cancel: tm.later })) return;
    try {
      const s = await api.post('/api/v2/boston/reminders/' + encodeURIComponent(id) + '/send', {});
      await refreshBostonAll();
      ui.toast(COPY.cat.sent((s && s.sent && s.sent[0]) || g.email));
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  bpResendShape: async (el) => {
    const tm = COPY.boston.team;
    const id = el.dataset.id, who = el.dataset.who || '', mail = el.dataset.mail || '';
    if (st.bpResending) return;
    if (!await ui.confirm({ title: tm.cResendTitle(esc(who)), body: tm.cResendBody(esc(mail), esc(el.dataset.from || 'previous'), esc(el.dataset.to || 'current')), ok: tm.goSendNow, cancel: COPY.boston.keep })) return;
    st.bpResending = id; rerender('[data-block="boston"]', blockBoston());
    try {
      const r = await api.post('/api/v2/boston/reminders/' + encodeURIComponent(id) + '/send', {});
      st.bpResending = null; delete st.bpFlipped[id];
      await refreshBostonAll();
      ui.toast(tm.resent((r && r.sent && r.sent[0]) || mail));
    } catch (e) { st.bpResending = null; rerender('[data-block="boston"]', blockBoston()); ui.toast(e.message, { kind: 'error' }); }
  },
  bpDeclineAll: async (el) => {
    const c = COPY.boston;
    const n = (D.pres && Number(D.pres.undecided)) || 0;
    if (!n) return;
    if (!await ui.confirm({ title: c.cDeclineAllTitle(n), body: c.cDeclineAllBody(n), ok: c.goDeclineAll, cancel: c.keep })) return;
    el.setAttribute('aria-disabled', 'true');
    try {
      const r = await api.post('/api/v2/boston/presenters/decline-undecided', {});
      await refreshBoston();
      ui.toast(c.declinedAll((r && r.declined && r.declined.length) || 0));
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
    if (!(D.cat && D.cat.program && D.cat.program.present)) { ui.toast(c.needProgram, { kind: 'error' }); return; }
    if (!n) return;
    if (!await ui.confirm({ title: c.cAllTitle(n), body: c.cAllBody(n), ok: COPY.boston.goSend, cancel: COPY.boston.keep })) return;
    el.setAttribute('aria-disabled', 'true');
    try {
      const r = await api.post('/api/v2/boston/reminders/send-all', {});
      await refreshCatering();
      ui.toast(c.sentAll((r && r.sent && r.sent.length) || 0));
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  // The owner's own read-through: the two shapes of the one email, to his inbox and nowhere else.
  // No confirm — nothing reaches a guest — but only one at a time so a double click cannot double-send.
  bpFilter: (el) => { st.bpFilter = el.dataset.filter || 'all'; rerender('[data-block="boston"]', blockBoston()); },
  bpPreview: async (el) => {
    const c = COPY.cat;
    const variant = ['presenter', 'attendee', 'panel', 'declined'].includes(el.dataset.variant) ? el.dataset.variant : 'attendee';
    if (st.bpPreviewing) return;
    st.bpPreviewing = variant; rerender('[data-block="boston"]', blockBoston());
    try {
      await api.post('/api/v2/boston/reminders/preview', { variant });
      st.bpPreviewing = null; rerender('[data-block="boston"]', blockBoston());
      ui.toast(c.prevSent(variant));
    } catch (e) { st.bpPreviewing = null; rerender('[data-block="boston"]', blockBoston()); ui.toast(e.message, { kind: 'error' }); }
  },
  // ---- Boston · released seats (the guest tapped "I can't make it" in the one email) ----
  bpRelToggle: () => { st.bpRelOpen = !st.bpRelOpen; rerender('[data-block="boston"]', blockBoston()); },
  bpRestore: async (el) => {
    const c = COPY.cat;
    const id = el.dataset.id, who = el.dataset.who || '', mail = el.dataset.mail || '';
    if (st.bpRestoring) return;
    if (!await ui.confirm({ title: c.cRestoreTitle, body: c.cRestoreBody(esc(who), esc(mail)), ok: c.goRestore, cancel: COPY.boston.keep })) return;
    st.bpRestoring = id; rerender('[data-block="boston"]', blockBoston());
    try {
      await api.post('/api/v2/boston/registrations/' + encodeURIComponent(id) + '/restore', {});
      st.bpRestoring = null;
      await refreshCatering();
      ui.toast(c.restored(mail));
    } catch (e) { st.bpRestoring = null; rerender('[data-block="boston"]', blockBoston()); ui.toast(e.message, { kind: 'error' }); }
  },
  // ---- phone only (≤700 px): the folded side blocks and the tap-to-open cards ----
  bhFold: (el) => {
    const k = el.dataset.fold; if (!k || !st.fold) return;
    st.fold[k] = !st.fold[k];
    if (k === 'ready') rerender('[data-block="ready"]', blockReady());
    else if (k === 'fu') { st.fuName = val('fuName'); st.fuWhy = val('fuWhy'); rerender('[data-block="fu"]', blockFollowups()); }
    else rerender('[data-block="after"]', blockAfter());
  },
  bpCard: (el) => {
    const k = el.dataset.key || '';
    st.bpCardOpen = st.bpCardOpen === k ? null : k;
    readGuestForm(); st.bpName = val('bpName') || st.bpName; st.bpEmail = val('bpEmail') || st.bpEmail;
    rerender('[data-block="boston"]', blockBoston());
    if (st.bpCardOpen === k) { const row = rootEl && rootEl.querySelector(`.bh-card [data-key="${k.replace(/"/g, '')}"]`); if (row && row.getBoundingClientRect().top < 0) row.scrollIntoView({ block: 'start' }); }
  },
  scBridges: () => { st.scope = 'bridges'; st.copied = false; rerender('[data-block="stats"]', blockStats()); },
  scAll: () => { st.scope = 'all'; st.copied = false; rerender('[data-block="stats"]', blockStats()); },
  scYear: () => { st.scope = 'y2026'; st.copied = false; rerender('[data-block="stats"]', blockStats()); },
  copyLine: () => {
    const s = D.hub.stats && D.hub.stats[st.scope];
    const line = COPY.stats.line(s ? s.effective : { guests: '—', cities: '—', countries: '—', speakers: '—' }, COPY.stats.scopeName[st.scope]);
    copyText(line); st.copied = true;
    rerender('[data-block="stats"]', blockStats());
    // the one copy confirmation (ui.copied): ✓ COPIED on green with one gold ring, then it lets go in place
    ui.copied(rootEl && rootEl.querySelector('[data-act="copyLine"]'), () => {
      if (!rootEl || !st || !st.copied) return;
      st.copied = false;
      const b = rootEl.querySelector('[data-act="copyLine"]'); if (b) { b.classList.remove('mx-copied'); b.textContent = COPY.stats.copy; b.style.background = '#201b16'; }
    }, { say: COPY.stats.copiedToast });
  }
};

export default {
  title: 'Building Bridges',
  async render(root, ctx) {
    ensureCss();
    rootEl = root;
    // `:tab?` — /projects/bridges/boston lands with the Boston block open (and in view).
    const tab = String((ctx && ctx.params && ctx.params.tab) || '').toLowerCase();
    st = { scope: 'bridges', copied: false, newCityOpen: false, ncCity: '', ncWhen: '', editEvent: null, recapEdit: null, fuName: '', fuWhy: '', uploading: null,
           bostonOpen: tab === 'boston',
           bpOpen: false, bpName: '', bpEmail: '', bpBusy: false, bpSending: null, bpReminding: null, bpPicking: null,
           bpProgramBusy: false, bpPreviewing: null, bpRelOpen: false, bpRestoring: null, bpFilter: 'all',
           // team controls (2026-09-16)
           bpMsgBusy: null, bpBulkBusy: null, bpReleasing: null, bpResending: null, bpFlipped: {},
           bpGuestOpen: false, bgBusy: false, bg: { first: '', last: '', email: '', inst: '', pos: '', presenter: false, panel: false },
           // phone (≤700 px): the three side blocks start folded; one Boston card open at a time
           fold: { ready: false, fu: false, after: false }, bpCardOpen: null };
    D = await load();
    if (rootEl !== root) return; // navigated away while loading
    root.innerHTML = template();
    unbind = ui.bind(root, handlers);
    // crossing the phone breakpoint (a rotation, a resized window) redraws in the other shape
    if (MQ) { mqHandler = () => { if (rootEl === root && D && st) root.innerHTML = template(); }; try { MQ.addEventListener('change', mqHandler); } catch (e) { try { MQ.addListener(mqHandler); } catch (e2) { mqHandler = null; } } }
    // The router scrolls to the top once render resolves; a deep link to the Boston block goes
    // there right after (next frame). Back/forward (`popped`) keeps the router's restored scroll.
    if (st.bostonOpen && !(ctx && ctx.popped)) requestAnimationFrame(() => { if (rootEl === root) scrollToBoston(); });
    changeHandler = (e) => {
      const t = e.target;
      if (t && t.matches && t.matches('input[data-stat]')) saveStat(t);
      if (t && t.matches && t.matches('input[data-role="rcPhotoFile"]')) uploadPhoto(t);
      if (t && t.matches && t.matches('input[data-role="bbProgramFile"]')) uploadProgram(t);
    };
    root.addEventListener('change', changeHandler);
  },
  destroy() {
    if (changeHandler && rootEl) rootEl.removeEventListener('change', changeHandler);
    changeHandler = null;
    if (mqHandler && MQ) { try { MQ.removeEventListener('change', mqHandler); } catch (e) { try { MQ.removeListener(mqHandler); } catch (e2) {} } } mqHandler = null;
    if (unbind) unbind(); unbind = null; rootEl = null; D = null; st = null;
  }
};
