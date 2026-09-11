// Source: no artboard — design/MEETUPS-SPEC.md §3 ("Member view" and "Host view"), drawn in the
// house vocabulary of Plexus Conference.dc.html: breadcrumb, numbered section heads, bordered cream
// cards, gold chips, crimson micro-CTAs. Two screens in one module, exactly as js/views/plexus.js
// holds four:
//   /app/plexus/meetups             the board · my meetups · hosting
//   /app/plexus/meetups/:id/host    the host's own table — 404 for anyone else, never 403, so a
//                                   host can never learn that another meetup exists.
// Every count, name and label here is a live read. Nothing is invented client-side: invite-only
// tables arrive from the server only when you were invited, so there is no filtering to do here.
import { api } from '../api.js';
import { ui, esc, fmt } from '../ui.js';
import { chrome } from '../chrome.js';
import { state } from '../state.js';

export const SOURCE = 'design/MEETUPS-SPEC.md §3 (no .dc.html counterpart)';

const WD3 = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MON3 = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// ---- COPY: every string a member or host can read lives here ---------------------------------
export const COPY = {
  crumb: { projects: 'PROJECTS', plexus: 'PLEXUS WEEK', meetups: 'MEETUPS', hosting: 'HOSTING' },
  kinds: { coffee: 'COFFEE', lunch: 'LUNCH', dinner: 'DINNER', walk: 'WALK', visit: 'VISIT', other: 'MEETUP' },
  head: {
    eyebrow: 'PLEXUS WEEK · SMALL TABLES',
    title: 'Meetups.',
    line: 'A coffee, a lunch, a walk through town — a handful of places at each table, hosted by someone who is already coming. Sign up and the place is yours; let it go and it passes straight to the next person waiting.',
    week: (label, dates) => `${label} · ${dates}`
  },
  filters: { day: 'DAY', tag: 'FIELD', all: 'ALL', clear: 'CLEAR FILTERS' },
  board: {
    n: '01', title: 'THE TABLES', count: n => `${n} ${n === 1 ? 'TABLE' : 'TABLES'} OPEN`,
    invite: 'BY INVITATION', host: 'YOU HOST THIS ONE',
    forWho: who => `FOR: ${who}`,
    emptyLine: 'No tables are open yet.',
    emptyWhy: 'Hosts are being asked now — coffees, lunches and a walk or two. They appear here as the team publishes them.',
    emptyFilterLine: 'Nothing matches that.',
    emptyFilterWhy: 'Clear the filters to see every table of the week.'
  },
  seats: {
    left: n => `${n} ${n === 1 ? 'PLACE' : 'PLACES'} LEFT`,
    full: 'TABLE FULL',
    fullWaiting: n => `TABLE FULL · ${n} WAITING`,
    waiting: n => `${n} waiting`
  },
  act: {
    join: 'JOIN THIS TABLE →', waitlist: 'JOIN THE WAITLIST →', accept: 'ACCEPT THE INVITATION →',
    closed: 'TABLE FULL', past: 'THIS TABLE HAS PASSED', archivedWeek: 'PAST EDITION', leave: 'CAN’T MAKE IT'
  },
  // Only a place you actually hold gets a chip. A cancelled or declined row means you hold nothing,
  // and a "CANCELLED" chip on an open table reads as though the meetup itself was called off.
  mineChip: {
    confirmed: 'YOU’RE IN', waitlisted: pos => (pos ? `WAITLIST · NO. ${pos}` : 'ON THE WAITLIST'),
    invited: 'INVITED', checkedIn: '✓ CHECKED IN'
  },
  mine: {
    n: '02', title: 'MY MEETUPS',
    emptyLine: 'You hold no places yet.',
    emptyWhy: 'Join a table above and everything you need — the QR, the wallet pass, the calendar file — appears right here.',
    qrAlt: 'Your meetup QR code',
    apple: 'APPLE WALLET →', google: 'GOOGLE WALLET →', calendar: 'ADD TO CALENDAR →',
    accept: 'YES, I’M COMING →', decline: 'CAN’T MAKE IT',
    inviteNote: 'The host invited you to this one. Accept and the place is held for you.',
    cancelledNote: 'The organizers cancelled this meetup — nothing for you to do.',
    passNote: 'Show the QR at the table, or keep the pass in your phone wallet.'
  },
  hosting: {
    n: '03', title: 'YOU ARE HOSTING',
    open: 'OPEN THE HOST PAGE →',
    line: (c, cap) => `${c} of ${cap} places taken`
  },
  help: {
    line: 'Questions about a table — the venue, the time, who else is coming?',
    sub: 'Message us — you’re signed in, so replies land right here in your portal inbox.',
    cta: 'MESSAGE US →'
  },
  leaveModal: {
    eyebrow: 'MEETUPS · YOUR PLACE', title: 'Let this place go?',
    body: (title, when) => `<p style="margin:0 0 10px">You are releasing your place at <strong>${title}</strong>${when ? ` — ${when}` : ''}.</p>
      <ul style="margin:0;padding-left:18px;line-height:1.7">
        <li>The place passes straight to the first person waiting.</li>
        <li>You can join again later, but you go to the back of the line.</li>
      </ul>`,
    ok: 'RELEASE MY PLACE', cancel: 'KEEP IT'
  },
  toast: {
    joined: title => `You’re in — ${title}. The details are in your inbox, and your pass is under MY MEETUPS.`,
    waitlisted: (title, pos) => `You’re on the waitlist for ${title}${pos ? ` — number ${pos}` : ''}. We email you the moment a place opens.`,
    already: 'You already hold a place at this table.',
    left: 'Your place is released.',
    leftPromoted: 'Your place is released — it went straight to the next person waiting.'
  },
  // ---- host screen ----
  host: {
    title: 'Your table.',
    eyebrow: 'PLEXUS WEEK · HOSTING',
    headcount: { confirmed: 'CONFIRMED', waitlist: 'WAITLIST', checkedIn: 'CHECKED IN' },
    linkLabel: 'HOST LINK · WORKS WITHOUT SIGNING IN',
    copyLink: 'COPY LINK', copied: 'Host link copied — it opens your table without a sign-in.',
    n1: '01', t1: 'WHO IS COMING',
    emptyLine: 'Nobody has joined yet.',
    emptyWhy: 'The table is published — as people sign up, their names, institutions and a line about their work appear here.',
    waitTitle: 'WAITING', invitedTitle: 'INVITED · NOT ANSWERED YET',
    waitPos: n => `NO. ${n}`,
    checkedIn: '✓ CHECKED IN', noBio: 'No bio on file yet.',
    n2: '02', t2: 'MESSAGE YOUR ATTENDEES',
    msgLead: 'Write once, and everyone holding a place gets it — after the Med&X team approves it. Nothing you write here goes out on its own.',
    msgSubject: 'SUBJECT', msgBody: 'YOUR MESSAGE', msgSend: 'SEND FOR APPROVAL →',
    msgNeed: 'A subject and a message are both needed.',
    msgQueued: n => `${n} draft${n === 1 ? '' : 's'} staged for the Med&X team to approve and send. Nothing has gone out yet.`,
    msgStaged: n => `Waiting for approval: ${n} draft${n === 1 ? '' : 's'}. The team sends them from the Med&X outbox.`,
    msgNobody: 'Nobody holds a place yet, so there is no one to write to.',
    n3: '03', t3: 'CHECK SOMEONE IN',
    scanLead: 'Check-in is optional. Type or paste the code under someone’s QR and you see who they are.',
    scanPlaceholder: 'm-0000…', scanGo: 'CHECK IN →', scanNeed: 'Paste the code from their pass first.',
    scanAgain: 'CLEAR',
    kindLine: (kind, when) => [kind, when].filter(Boolean).join(' · ')
  }
};

// ---------------------------------------------------------------- module state
let D = null, H = null, st = null, rootEl = null, unbind = null, mode = 'board', meetupId = null, edition = null;

function ensureCss() {
  if (document.querySelector('link[data-view-css="plexus-meetups"]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = '/css/views/plexus-meetups.css'; l.setAttribute('data-view-css', 'plexus-meetups');
  document.head.appendChild(l);
}
function rerender(sel, html) { const el = rootEl && rootEl.querySelector(sel); if (el) el.outerHTML = html; }

// ---------------------------------------------------------------- helpers
function dayLabel(iso) {
  const d = fmt.toDate(iso);
  return d ? `${WD3[d.getDay()]}, ${MON3[d.getMonth()]} ${d.getDate()}` : String(iso || '');
}
function kindLabel(kind) { return COPY.kinds[String(kind || 'other').toLowerCase()] || COPY.kinds.other; }
function startedMs(m) { const d = fmt.toDate(m.starts_at); return d ? d.getTime() : NaN; }
function isPast(m) { const ms = startedMs(m); return Number.isFinite(ms) && ms < Date.now(); }
function venueLine(m) { return [m.venue_name, m.venue_address].filter(Boolean).join(' · '); }
// The QR png is served with Cross-Origin-Resource-Policy: same-origin, and the backend builds its
// own absolute URL — so on staging (Netlify front end, Render API) the browser blocks the <img>
// silently. Every deployment proxies /api/* on the portal's own origin (_redirects · dev-server.js),
// so an /api path renders it same-origin everywhere. Anything else is passed through untouched.
function assetSrc(url) {
  const s = String(url || '');
  if (!s) return '';
  try { const u = new URL(s, window.location.origin); return u.pathname.startsWith('/api/') ? u.pathname + u.search : s; }
  catch (e) { return s; }
}
function seatsLine(m) {
  if (m.full) return m.waitlisted ? COPY.seats.fullWaiting(m.waitlisted) : COPY.seats.full;
  return COPY.seats.left(m.spots_left);
}

// ---------------------------------------------------------------- data
async function loadBoard() {
  const r = await api.settle({
    board: edition
      ? api.get(`/api/v2/meetups?edition=${encodeURIComponent(edition)}`)
      : api.get('/api/v2/meetups'),
    mine: api.get('/api/v2/meetups/mine')
  });
  const b = r.board || {};
  return {
    edition: b.edition || null,
    archived: !!(b.edition && b.edition.status === 'archived'),
    meetups: Array.isArray(b.meetups) ? b.meetups : [],
    days: Array.isArray(b.days) ? b.days : [],
    tags: Array.isArray(b.tags) ? b.tags : [],
    mine: (r.mine && Array.isArray(r.mine.meetups)) ? r.mine.meetups : [],
    hosting: (r.mine && Array.isArray(r.mine.hosting)) ? r.mine.hosting : []
  };
}
// 404 is the host guard's own answer for "not yours" — it must read as a plain not-found.
async function loadHost(id) {
  try { return await api.get(`/api/v2/meetups/${encodeURIComponent(id)}/host`); }
  catch (e) { if (e instanceof api.ApiError && e.status === 404) return null; throw e; }
}

// ---------------------------------------------------------------- shared blocks
// Same breadcrumb idiom as js/views/plexus.js › crumb()
function crumb(items) {
  const sep = '<span style="color:rgba(25,21,18,.35);font-size:10px">→</span>';
  return `
  <!-- v2: breadcrumb (Plexus Conference.dc.html › "Breadcrumb" idiom) -->
  <div class="mx-crumbs mx-gutter" style="display:flex;align-items:center;gap:13px;padding:10px 36px;border-bottom:1px solid rgba(25,21,18,.16);flex-wrap:wrap">
    ${items.map((it, i) => (i ? sep + '\n    ' : '') + (it.to
      ? `<a href="${it.to}" style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#4a4239" data-hover="color:#191512">${it.label}</a>`
      : `<span style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:${i ? '#191512' : '#4a4239'}">${it.label}</span>`)).join('\n    ')}
    <div style="flex:1"></div>
  </div>
  <!-- /v2 -->`;
}
function blockHelp(line, sub) {
  return `
  <!-- v2: "Message us" (Plexus Conference.dc.html idiom) -->
  <div class="mx-gutter" style="display:flex;align-items:center;gap:20px;border-top:1px solid rgba(25,21,18,.16);padding:18px 36px 30px;flex-wrap:wrap">
    <span style="font-family:Fraunces,serif;font-style:italic;font-size:16px;color:#4a4239">${esc(line)}</span>
    <span style="font-size:12px;color:#4a4239">${esc(sub)}</span>
    <div style="flex:1"></div>
    <a href="/app/messages?about=plexus" style="padding:10px 16px;background:#9b1b22;color:#f7f1e6;font:600 10px Inter,sans-serif;letter-spacing:.16em;white-space:nowrap" data-hover="background:#7e151b;color:#f7f1e6">${COPY.help.cta}</a>
  </div>
  <!-- /v2 -->`;
}
const chipGold = (text) => `<span style="padding:3px 7px;border:1px solid rgba(201,169,98,.65);color:#6e5626;font:600 8.5px Inter,sans-serif;letter-spacing:.14em;white-space:nowrap">${esc(text)}</span>`;
const chipCrimson = (text) => `<span style="padding:3px 7px;border:1px solid rgba(155,27,34,.5);color:#9b1b22;font:600 8.5px Inter,sans-serif;letter-spacing:.14em;white-space:nowrap">${esc(text)}</span>`;
const chipQuiet = (text) => `<span style="padding:3px 7px;border:1px solid rgba(25,21,18,.22);color:#4a4239;font:600 8.5px Inter,sans-serif;letter-spacing:.14em;white-space:nowrap">${esc(text)}</span>`;

function mineChipFor(m) {
  const s = String(m.my_status || '');
  if (s === 'confirmed' || s === 'promoted') return chipCrimson(COPY.mineChip.confirmed);
  if (s === 'waitlisted') return chipGold(COPY.mineChip.waitlisted(m.my_waitlist_pos));
  if (s === 'invited') return chipGold(COPY.mineChip.invited);
  return '';                                     // cancelled / declined: you hold nothing to label
}

// ================================================================ BOARD (/app/plexus/meetups)
function filtered() {
  return D.meetups.filter(m => (!st.day || m.day === st.day) && (!st.tag || (m.tags || []).includes(st.tag)));
}
function boardFilters() {
  if (!D.days.length && !D.tags.length) return '';
  const chip = (act, value, label, on) => `<span data-act="${act}" data-value="${esc(value)}" role="button" aria-pressed="${on}" style="padding:5px 9px;border:1px solid ${on ? '#9b1b22' : 'rgba(25,21,18,.22)'};background:${on ? '#9b1b22' : 'transparent'};color:${on ? '#f7f1e6' : '#191512'};font:600 8.5px Inter,sans-serif;letter-spacing:.12em;cursor:pointer;white-space:nowrap">${esc(label)}</span>`;
  return `
      <div class="mx-meetup-filters" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:4px 0 18px">
        ${D.days.length ? `<span style="font:600 9px Inter,sans-serif;letter-spacing:.16em;color:#6e5626">${COPY.filters.day}</span>
        ${chip('fDay', '', COPY.filters.all, !st.day)}
        ${D.days.map(d => chip('fDay', d, dayLabel(d), st.day === d)).join('\n        ')}` : ''}
        ${D.days.length && D.tags.length ? '<span style="width:1px;height:16px;background:rgba(25,21,18,.16)"></span>' : ''}
        ${D.tags.length ? `<span style="font:600 9px Inter,sans-serif;letter-spacing:.16em;color:#6e5626">${COPY.filters.tag}</span>
        ${chip('fTag', '', COPY.filters.all, !st.tag)}
        ${D.tags.map(t => chip('fTag', t, fmt.upper(t), st.tag === t)).join('\n        ')}` : ''}
        ${(st.day || st.tag) ? `<span data-act="fClear" style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:#9b1b22;cursor:pointer;margin-left:4px;white-space:nowrap">${COPY.filters.clear}</span>` : ''}
      </div>`;
}
function joinControl(m) {
  const base = 'padding:11px 18px;font:600 10px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;white-space:nowrap;text-decoration:none';
  if (D.archived) return `<span style="${base};border:1px solid rgba(25,21,18,.22);color:#9b8f80;cursor:default">${COPY.act.archivedWeek}</span>`;
  const s = String(m.my_status || '');
  if (s === 'confirmed' || s === 'promoted' || s === 'waitlisted') {
    return `<span data-act="leave" data-id="${esc(m.id)}" style="${base};border:1px solid rgba(25,21,18,.3);color:#191512" data-hover="border-color:#191512;color:#9b1b22">${COPY.act.leave}</span>`;
  }
  if (isPast(m)) return `<span style="${base};border:1px solid rgba(25,21,18,.22);color:#9b8f80;cursor:default">${COPY.act.past}</span>`;
  if (m.full && !m.waitlist_enabled) return `<span style="${base};border:1px solid rgba(25,21,18,.22);color:#9b8f80;cursor:default">${COPY.act.closed}</span>`;
  const label = s === 'invited' ? COPY.act.accept : (m.full ? COPY.act.waitlist : COPY.act.join);
  return `<span data-act="join" data-id="${esc(m.id)}" style="${base};background:#9b1b22;color:#f7f1e6" data-hover="background:#7e151b;color:#f7f1e6">${label}</span>`;
}
function meetupCard(m) {
  const chips = [chipGold(kindLabel(m.kind))];
  if (m.visibility === 'invite') chips.push(chipQuiet(COPY.board.invite));
  if (m.is_host) chips.push(chipCrimson(COPY.board.host));
  const mc = mineChipFor(m);
  if (mc) chips.push(mc);
  const venue = venueLine(m);
  return `
        <div class="mx-meetup-card" style="border:1px solid rgba(25,21,18,.16);border-top:2px solid #c9a962;background:#fdfaf3;display:flex;flex-direction:column;gap:9px;padding:18px 20px;box-sizing:border-box">
          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">${chips.join('')}</div>
          <span style="font-family:Fraunces,serif;font-size:20px;line-height:1.2">${esc(m.title || '')}</span>
          ${m.host_line ? `<span style="font-size:12px;color:#9b1b22">${esc(m.host_line)}</span>` : ''}
          <span style="font:600 10px Inter,sans-serif;letter-spacing:.14em;color:#4a4239">${esc(fmt.upper(m.when_label || ''))}</span>
          ${venue ? (m.venue_map_url
            ? `<a href="${esc(m.venue_map_url)}" target="_blank" rel="noopener" style="font-size:12.5px;color:#4a4239;line-height:1.5" data-hover="color:#9b1b22">${esc(venue)} ↗</a>`
            : `<span style="font-size:12.5px;color:#4a4239;line-height:1.5">${esc(venue)}</span>`) : ''}
          ${m.description ? `<span style="font-size:12.5px;color:#4a4239;line-height:1.6">${esc(m.description)}</span>` : ''}
          ${m.audience ? `<span style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:#6e5626">${esc(fmt.upper(COPY.board.forWho(m.audience)))}</span>` : ''}
          ${(m.tags || []).length ? `<div style="display:flex;gap:6px;flex-wrap:wrap">${m.tags.map(t => `<span style="padding:2px 7px;border:1px solid rgba(25,21,18,.18);color:#4a4239;font:600 8.5px Inter,sans-serif;letter-spacing:.12em;white-space:nowrap">${esc(fmt.upper(t))}</span>`).join('')}</div>` : ''}
          <div class="mx-meetup-foot" style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;border-top:1px solid rgba(25,21,18,.12);padding-top:12px;margin-top:auto">
            <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.14em;color:${m.full ? '#6e5626' : '#9b1b22'}">${esc(seatsLine(m))}</span>
            <div style="flex:1"></div>
            ${joinControl(m)}
          </div>
        </div>`;
}
function boardBlock() {
  const list = filtered();
  const filtering = !!(st.day || st.tag);
  return `
    <div data-block="board">
      <!-- v2: "01 · THE TABLES" -->
      <div class="mx-wrap-row" style="display:flex;align-items:baseline;gap:14px;padding:24px 0 10px">
        <span style="font-family:Fraunces,serif;font-weight:600;font-size:14px;color:#9b1b22">${COPY.board.n}</span>
        <span style="font:600 14px Inter,sans-serif;letter-spacing:.14em">${COPY.board.title}</span>
        <span style="font-size:12.5px;color:#4a4239">${esc(COPY.board.count(D.meetups.length))}</span>
      </div>
      ${boardFilters()}
      ${list.length ? `
      <div class="mx-grid-2 mx-meetup-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;padding-bottom:28px">
        ${list.map(meetupCard).join('')}
      </div>` : `
      <div class="empty" style="padding:24px 0 28px">
        <span class="rule-gold" style="margin-bottom:6px"></span>
        <span class="empty-line">${esc(filtering ? COPY.board.emptyFilterLine : COPY.board.emptyLine)}</span>
        <span class="empty-why">${esc(filtering ? COPY.board.emptyFilterWhy : COPY.board.emptyWhy)}</span>
        ${filtering ? `<span data-act="fClear" style="margin-top:8px;padding:11px 20px;border:1px solid rgba(25,21,18,.3);font:600 10px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;color:#191512;white-space:nowrap">${COPY.filters.clear}</span>` : ''}
      </div>`}
      <!-- /v2 -->
    </div>`;
}

function passRow(m) {
  const links = [];
  if (m.apple_pass_url) links.push({ href: m.apple_pass_url, label: COPY.mine.apple });
  if (m.google_wallet_url) links.push({ href: m.google_wallet_url, label: COPY.mine.google });
  if (m.calendar_url) links.push({ href: m.calendar_url, label: COPY.mine.calendar });
  if (!links.length) return '';
  return `<div style="display:flex;gap:14px;flex-wrap:wrap;font:600 9.5px Inter,sans-serif;letter-spacing:.14em">
            ${links.map(l => `<a href="${esc(l.href)}" target="_blank" rel="noopener" style="color:#9b1b22;white-space:nowrap">${l.label}</a>`).join('')}
          </div>`;
}
function mineRow(m) {
  const invited = String(m.my_status || '') === 'invited';
  const inv = m.invite || null;
  return `
        <div class="mx-meetup-mine" style="display:flex;gap:18px;align-items:flex-start;border:1px solid rgba(25,21,18,.16);background:#fdfaf3;padding:16px 18px">
          ${m.qr_url ? `<img class="mx-meetup-qr" src="${esc(assetSrc(m.qr_url))}" alt="${esc(COPY.mine.qrAlt)}" loading="lazy">` : ''}
          <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:7px">
            <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
              ${chipGold(kindLabel(m.kind))}${mineChipFor(m)}${m.checked_in ? chipCrimson(COPY.mineChip.checkedIn) : ''}
            </div>
            <span style="font-family:Fraunces,serif;font-size:18px;line-height:1.2">${esc(m.title || '')}</span>
            <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.14em;color:#4a4239">${esc(fmt.upper(m.when_label || ''))}</span>
            ${venueLine(m) ? `<span style="font-size:12.5px;color:#4a4239">${esc(venueLine(m))}</span>` : ''}
            ${m.host_line ? `<span style="font-size:12px;color:#9b1b22">${esc(m.host_line)}</span>` : ''}
            ${m.cancelled ? `<span style="font-size:12.5px;color:#9b1b22">${esc(COPY.mine.cancelledNote)}</span>` : ''}
            ${invited ? `<span style="font-size:12.5px;color:#4a4239;line-height:1.55">${esc(COPY.mine.inviteNote)}</span>` : ''}
            ${m.qr_url ? `<span style="font-size:11.5px;color:#9b8f80">${esc(COPY.mine.passNote)}</span>` : ''}
            ${passRow(m)}
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end;flex:none">
            ${invited && inv ? `
            <a href="${esc(inv.accept_url)}" style="padding:10px 16px;background:#9b1b22;color:#f7f1e6;font:600 9.5px Inter,sans-serif;letter-spacing:.16em;white-space:nowrap;text-decoration:none" data-hover="background:#7e151b;color:#f7f1e6">${COPY.mine.accept}</a>
            <a href="${esc(inv.decline_url)}" style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:#4a4239;white-space:nowrap" data-hover="color:#9b1b22">${COPY.mine.decline}</a>` : `
            <span data-act="leave" data-id="${esc(m.id)}" style="padding:10px 16px;border:1px solid rgba(25,21,18,.3);font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#191512;cursor:pointer;white-space:nowrap" data-hover="border-color:#191512;color:#9b1b22">${COPY.act.leave}</span>`}
          </div>
        </div>`;
}
function mineBlock() {
  return `
    <div data-block="mine">
      <!-- v2: "02 · MY MEETUPS" -->
      <div class="mx-wrap-row" style="display:flex;align-items:baseline;gap:14px;border-top:1px solid rgba(25,21,18,.16);padding:24px 0 12px">
        <span style="font-family:Fraunces,serif;font-weight:600;font-size:14px;color:#9b1b22">${COPY.mine.n}</span>
        <span style="font:600 14px Inter,sans-serif;letter-spacing:.14em">${COPY.mine.title}</span>
      </div>
      ${D.mine.length ? `
      <div style="display:flex;flex-direction:column;gap:12px;padding-bottom:26px">
        ${D.mine.map(mineRow).join('')}
      </div>` : `
      <div class="empty" style="padding:18px 0 26px">
        <span class="rule-gold" style="margin-bottom:6px"></span>
        <span class="empty-line">${esc(COPY.mine.emptyLine)}</span>
        <span class="empty-why">${esc(COPY.mine.emptyWhy)}</span>
      </div>`}
      <!-- /v2 -->
    </div>`;
}
function hostingBlock() {
  if (!D.hosting.length) return '<div data-block="hosting"></div>';
  return `
    <div data-block="hosting">
      <!-- v2: "03 · YOU ARE HOSTING" -->
      <div class="mx-wrap-row" style="display:flex;align-items:baseline;gap:14px;border-top:1px solid rgba(25,21,18,.16);padding:24px 0 12px">
        <span style="font-family:Fraunces,serif;font-weight:600;font-size:14px;color:#9b1b22">${COPY.hosting.n}</span>
        <span style="font:600 14px Inter,sans-serif;letter-spacing:.14em">${COPY.hosting.title}</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:12px;padding-bottom:26px">
        ${D.hosting.map(m => `
        <a href="/app/plexus/meetups/${encodeURIComponent(m.id)}/host" class="mx-wrap-row" style="display:flex;align-items:center;gap:16px;border:1px solid rgba(25,21,18,.16);border-left:3px solid #c9a962;background:#fdfaf3;padding:16px 18px;color:#191512;text-decoration:none;flex-wrap:wrap" data-hover="background:#f7efdf">
          ${chipGold(kindLabel(m.kind))}
          <span style="flex:1;min-width:200px">
            <span style="display:block;font-family:Fraunces,serif;font-size:18px;line-height:1.2">${esc(m.title || '')}</span>
            <span style="display:block;font-size:12px;color:#4a4239;margin-top:3px">${esc(fmt.detail([m.when_label, COPY.hosting.line(m.confirmed, m.capacity), m.waitlisted ? COPY.seats.waiting(m.waitlisted) : ''].filter(Boolean).join(' · ')))}</span>
          </span>
          <span style="font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#9b1b22;white-space:nowrap">${COPY.hosting.open}</span>
        </a>`).join('')}
      </div>
      <!-- /v2 -->
    </div>`;
}
function boardTpl() {
  const ed = D.edition || {};
  const weekLine = ed.label ? COPY.head.week(ed.label, fmt.longRange(ed.starts_on, ed.ends_on)) : '';
  return `
<div data-screen-label="Meetups" style="font-family:Inter,sans-serif;color:#191512;background:#f7f1e6;min-height:100vh">
  ${crumb([{ label: COPY.crumb.projects }, { label: COPY.crumb.plexus, to: '/app/plexus' }, { label: COPY.crumb.meetups }])}
  <!-- v2: head -->
  <div class="mx-pad-hero" style="border-bottom:1px solid rgba(25,21,18,.16);padding:40px 36px 32px">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
      <span style="width:28px;height:1px;background:#c9a962"></span>
      <span style="font:600 11px Inter,sans-serif;letter-spacing:.18em;color:#9b1b22">${COPY.head.eyebrow}</span>
    </div>
    <div class="mx-display-42" style="font-family:Fraunces,serif;font-size:42px;line-height:1.1">${COPY.head.title}</div>
    <div style="font-size:14.5px;line-height:1.6;color:#4a4239;max-width:620px;margin-top:12px">${esc(COPY.head.line)}</div>
    ${weekLine ? `<div style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#4a4239;margin-top:14px">${esc(fmt.upper(fmt.detail(weekLine)))}</div>` : ''}
  </div>
  <!-- /v2 -->
  <div class="mx-gutter" style="padding:0 36px">
    ${boardBlock()}
    ${mineBlock()}
    ${hostingBlock()}
  </div>
  ${blockHelp(COPY.help.line, COPY.help.sub)}
</div>`;
}

// ================================================================ HOST (/app/plexus/meetups/:id/host)
function personCard(p, opts) {
  const o = opts || {};
  const role = [p.position, p.institution].filter(Boolean).join(' · ');
  return `
        <div style="border:1px solid rgba(25,21,18,.16);background:#fdfaf3;padding:16px 18px;display:flex;flex-direction:column;gap:6px;box-sizing:border-box">
          <div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap">
            <span style="font-family:Fraunces,serif;font-size:17px;line-height:1.2;flex:1;min-width:0">${esc(p.name || '')}</span>
            ${o.pos ? chipQuiet(COPY.host.waitPos(o.pos)) : ''}
            ${p.checked_in ? chipGold(COPY.host.checkedIn) : ''}
          </div>
          ${role ? `<span style="font-size:12px;color:#9b1b22">${esc(role)}</span>` : ''}
          <span style="font-size:12.5px;color:#4a4239;line-height:1.6">${p.bio ? esc(p.bio) : `<i>${esc(COPY.host.noBio)}</i>`}</span>
        </div>`;
}
function hostPeople() {
  const att = Array.isArray(H.attendees) ? H.attendees : [];
  const wait = Array.isArray(H.waitlist) ? H.waitlist : [];
  const inv = Array.isArray(H.invited) ? H.invited : [];
  return `
      ${att.length ? `
      <div class="mx-grid-3 mx-meetup-people" style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;padding-bottom:22px">
        ${att.map(p => personCard(p)).join('')}
      </div>` : `
      <div class="empty" style="padding:18px 0 24px">
        <span class="rule-gold" style="margin-bottom:6px"></span>
        <span class="empty-line">${esc(COPY.host.emptyLine)}</span>
        <span class="empty-why">${esc(COPY.host.emptyWhy)}</span>
      </div>`}
      ${wait.length ? `
      <div style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#6e5626;padding-bottom:10px">${COPY.host.waitTitle}</div>
      <div class="mx-grid-3 mx-meetup-people" style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;padding-bottom:22px">
        ${wait.map((p, i) => personCard(p, { pos: p.waitlist_pos || i + 1 })).join('')}
      </div>` : ''}
      ${inv.length ? `
      <div style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#6e5626;padding-bottom:10px">${COPY.host.invitedTitle}</div>
      <div class="mx-grid-3 mx-meetup-people" style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;padding-bottom:22px">
        ${inv.map(p => personCard(p)).join('')}
      </div>` : ''}`;
}
function hostScanResult() {
  const r = st.scan;
  if (!r) return '';
  const p = r.person || null;
  const accent = r.ok ? '#6e5626' : '#9b1b22';
  const role = p ? [p.position, p.institution].filter(Boolean).join(' · ') : '';
  return `
      <div style="border:1px solid rgba(25,21,18,.16);border-left:3px solid ${accent};background:#fdfaf3;padding:16px 18px;display:flex;flex-direction:column;gap:6px;margin-top:14px">
        <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:${accent}">${esc(fmt.upper(String(r.result || '').replace(/_/g, ' ')))}</span>
        ${p ? `<span style="font-family:Fraunces,serif;font-size:20px;line-height:1.2">${esc(p.name || '')}</span>` : ''}
        ${role ? `<span style="font-size:12.5px;color:#9b1b22">${esc(role)}</span>` : ''}
        ${p && p.bio ? `<span style="font-size:12.5px;color:#4a4239;line-height:1.6">${esc(p.bio)}</span>` : ''}
        <span style="font-size:12.5px;color:#4a4239">${esc(r.message || '')}</span>
        <span data-act="scanClear" style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:#9b1b22;cursor:pointer;align-self:flex-start;margin-top:4px">${COPY.host.scanAgain}</span>
      </div>`;
}
function hostTpl() {
  const m = H.meetup || {};
  const hc = H.headcount || {};
  const venue = [m.venue_name, m.venue_address].filter(Boolean).join(' · ');
  const stat = (v, label) => `<span style="display:flex;align-items:baseline;gap:7px"><span style="font-family:Fraunces,serif;font-size:22px;color:#c9a962">${esc(String(v))}</span><span style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:rgba(247,241,230,.7)">${label}</span></span>`;
  return `
<div data-screen-label="Meetup host" style="font-family:Inter,sans-serif;color:#191512;background:#f7f1e6;min-height:100vh">
  ${crumb([{ label: COPY.crumb.projects }, { label: COPY.crumb.plexus, to: '/app/plexus' }, { label: COPY.crumb.meetups, to: '/app/plexus/meetups' }, { label: COPY.crumb.hosting }])}
  <!-- v2: host head -->
  <div class="mx-pad-hero" style="padding:38px 36px 28px">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
      <span style="width:28px;height:1px;background:#c9a962"></span>
      <span style="font:600 11px Inter,sans-serif;letter-spacing:.18em;color:#9b1b22">${COPY.host.eyebrow}</span>
    </div>
    <div class="mx-display-42" style="font-family:Fraunces,serif;font-size:38px;line-height:1.12">${esc(m.title || '')}</div>
    <div style="font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#4a4239;margin-top:12px">${esc(fmt.upper(COPY.host.kindLine(kindLabel(m.kind), m.when_label)))}</div>
    ${venue ? (m.venue_map_url
      ? `<div style="margin-top:6px"><a href="${esc(m.venue_map_url)}" target="_blank" rel="noopener" style="font-size:13px;color:#4a4239" data-hover="color:#9b1b22">${esc(venue)} ↗</a></div>`
      : `<div style="font-size:13px;color:#4a4239;margin-top:6px">${esc(venue)}</div>`) : ''}
    ${m.description ? `<div style="font-size:13.5px;color:#4a4239;line-height:1.6;max-width:620px;margin-top:10px">${esc(m.description)}</div>` : ''}
  </div>
  <!-- /v2 -->
  <!-- v2: headcount band -->
  <div class="mx-pad-band" style="display:flex;align-items:center;gap:28px;padding:14px 36px;background:#191512;color:#f7f1e6;flex-wrap:wrap">
    ${stat(`${hc.confirmed == null ? 0 : hc.confirmed}/${hc.capacity == null ? 0 : hc.capacity}`, COPY.host.headcount.confirmed)}
    ${stat(hc.waitlisted == null ? 0 : hc.waitlisted, COPY.host.headcount.waitlist)}
    ${stat(hc.checked_in == null ? 0 : hc.checked_in, COPY.host.headcount.checkedIn)}
    <div style="flex:1"></div>
    ${H.host_link ? `<span style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><span style="font:600 9px Inter,sans-serif;letter-spacing:.16em;color:rgba(247,241,230,.65)">${COPY.host.linkLabel}</span><span data-act="copyHostLink" style="padding:7px 12px;border:1px solid rgba(201,169,98,.6);color:#c9a962;font:600 9px Inter,sans-serif;letter-spacing:.14em;cursor:pointer;white-space:nowrap">${COPY.host.copyLink}</span></span>` : ''}
  </div>
  <!-- /v2 -->
  <div class="mx-gutter" style="padding:0 36px">
    <!-- v2: "01 · WHO IS COMING" -->
    <div class="mx-wrap-row" style="display:flex;align-items:baseline;gap:14px;padding:24px 0 12px">
      <span style="font-family:Fraunces,serif;font-weight:600;font-size:14px;color:#9b1b22">${COPY.host.n1}</span>
      <span style="font:600 14px Inter,sans-serif;letter-spacing:.14em">${COPY.host.t1}</span>
    </div>
    <div data-block="people">${hostPeople()}</div>
    <!-- /v2 -->
    <!-- v2: "02 · MESSAGE YOUR ATTENDEES" -->
    <div class="mx-wrap-row" style="display:flex;align-items:baseline;gap:14px;border-top:1px solid rgba(25,21,18,.16);padding:24px 0 10px">
      <span style="font-family:Fraunces,serif;font-weight:600;font-size:14px;color:#9b1b22">${COPY.host.n2}</span>
      <span style="font:600 14px Inter,sans-serif;letter-spacing:.14em">${COPY.host.t2}</span>
    </div>
    ${composerBlock()}
    <!-- /v2 -->
    <!-- v2: "03 · CHECK SOMEONE IN" -->
    <div class="mx-wrap-row" style="display:flex;align-items:baseline;gap:14px;border-top:1px solid rgba(25,21,18,.16);padding:24px 0 10px">
      <span style="font-family:Fraunces,serif;font-weight:600;font-size:14px;color:#9b1b22">${COPY.host.n3}</span>
      <span style="font:600 14px Inter,sans-serif;letter-spacing:.14em">${COPY.host.t3}</span>
    </div>
    ${scanBlock()}
    <!-- /v2 -->
  </div>
  ${blockHelp(COPY.help.line, COPY.help.sub)}
</div>`;
}

// ---------------------------------------------------------------- behaviour
async function reloadBoard() {
  const fresh = await loadBoard();
  if (!rootEl) return;
  D = fresh;
  if (st.day && !D.days.includes(st.day)) st.day = null;
  if (st.tag && !D.tags.includes(st.tag)) st.tag = null;
  rerender('[data-block="board"]', boardBlock());
  rerender('[data-block="mine"]', mineBlock());
  rerender('[data-block="hosting"]', hostingBlock());
}
function findMeetup(id) {
  return D.meetups.find(m => m.id === id) || D.mine.find(m => m.id === id) || null;
}

const handlers = {
  fDay: (el) => { st.day = el.dataset.value || null; rerender('[data-block="board"]', boardBlock()); },
  fTag: (el) => { st.tag = el.dataset.value || null; rerender('[data-block="board"]', boardBlock()); },
  fClear: () => { st.day = null; st.tag = null; rerender('[data-block="board"]', boardBlock()); },

  join: async (el) => {
    const id = el.dataset.id;
    el.setAttribute('aria-disabled', 'true');
    try {
      const r = await api.post(`/api/v2/meetups/${encodeURIComponent(id)}/join`);
      const m = (r && r.meetup) || findMeetup(id) || {};
      const title = m.title || '';
      if (r && r.already) ui.toast(COPY.toast.already, { ms: 4000 });
      else if (r && r.status === 'waitlisted') ui.toast(COPY.toast.waitlisted(title, m.my_waitlist_pos), { ms: 6500 });
      else ui.toast(COPY.toast.joined(title), { ms: 6500 });
      await reloadBoard();
      chrome.refresh();
    } catch (e) {
      el.removeAttribute('aria-disabled');
      ui.toast(e.message, { kind: 'error', ms: 6000 });
    }
  },
  leave: async (el) => {
    const id = el.dataset.id;
    const m = findMeetup(id) || {};
    const ok = await ui.confirm({
      eyebrow: COPY.leaveModal.eyebrow, title: COPY.leaveModal.title,
      body: COPY.leaveModal.body(esc(m.title || ''), esc(m.when_label || '')),
      ok: COPY.leaveModal.ok, cancel: COPY.leaveModal.cancel, danger: true
    });
    if (!ok) return;
    try {
      const r = await api.post(`/api/v2/meetups/${encodeURIComponent(id)}/cancel`);
      ui.toast(r && r.promoted ? COPY.toast.leftPromoted : COPY.toast.left, { ms: 6000 });
      await reloadBoard();
      chrome.refresh();
    } catch (e) { ui.toast(e.message, { kind: 'error', ms: 6000 }); }
  },

  // ---- host screen ----
  copyHostLink: async () => {
    const url = H && H.host_link;
    if (!url) return;
    try { await navigator.clipboard.writeText(url); ui.toast(COPY.host.copied, { ms: 5000 }); }
    catch (e) { window.prompt(COPY.host.linkLabel, url); }
  },
  msgSend: async (el) => {
    const subject = ((rootEl.querySelector('[data-role="msgSubject"]') || {}).value || '').trim();
    const body = ((rootEl.querySelector('[data-role="msgBody"]') || {}).value || '').trim();
    if (!subject || !body) return ui.toast(COPY.host.msgNeed, { kind: 'error' });
    el.setAttribute('aria-disabled', 'true');
    try {
      const r = await api.post(`/api/v2/meetups/${encodeURIComponent(meetupId)}/host/message`, { subject, body });
      st.msgStaged = Number(r && r.staged) || 0;
      const subjEl = rootEl.querySelector('[data-role="msgSubject"]'); if (subjEl) subjEl.value = '';
      const bodyEl = rootEl.querySelector('[data-role="msgBody"]'); if (bodyEl) bodyEl.value = '';
      // The server stages DRAFTS for the team to approve — the UI never says "sent".
      ui.toast(COPY.host.msgQueued(st.msgStaged), { ms: 7000 });
      rerender('[data-block="composer"]', composerBlock());
    } catch (e) { ui.toast(e.message, { kind: 'error', ms: 6000 }); }
    el.removeAttribute('aria-disabled');
  },
  scanGo: async (el) => {
    const input = rootEl.querySelector('[data-role="scanCode"]');
    const code = ((input || {}).value || '').trim();
    if (!code) return ui.toast(COPY.host.scanNeed, { kind: 'error' });
    el.setAttribute('aria-disabled', 'true');
    try {
      const r = await api.post(`/api/v2/meetups/${encodeURIComponent(meetupId)}/host/scan`, { code });
      st.scan = r || null;
      if (input) input.value = '';
      H = (await loadHost(meetupId)) || H;
      rerender('[data-block="people"]', `<div data-block="people">${hostPeople()}</div>`);
      rerender('[data-block="scan"]', scanBlock());
    } catch (e) { ui.toast(e.message, { kind: 'error', ms: 6000 }); }
    el.removeAttribute('aria-disabled');
  },
  scanClear: () => { st.scan = null; rerender('[data-block="scan"]', scanBlock()); }
};

// The two host blocks that re-render on their own (kept out of hostTpl so both callers agree).
function composerBlock() {
  const nobody = !(Array.isArray(H.attendees) && H.attendees.length);
  return `
    <div data-block="composer" style="max-width:620px;padding-bottom:26px">
      <div style="font-size:12.5px;color:#4a4239;line-height:1.6;margin-bottom:12px">${esc(COPY.host.msgLead)}</div>
      <label class="label" style="display:block;margin-bottom:4px">${COPY.host.msgSubject}</label>
      <input class="input" data-role="msgSubject" aria-label="${esc(COPY.host.msgSubject)}" maxlength="160" style="margin-bottom:10px"${nobody ? ' disabled' : ''}>
      <label class="label" style="display:block;margin-bottom:4px">${COPY.host.msgBody}</label>
      <textarea class="input mx-meetup-textarea" data-role="msgBody" aria-label="${esc(COPY.host.msgBody)}" rows="5" maxlength="4000"${nobody ? ' disabled' : ''}></textarea>
      <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-top:12px">
        ${nobody
          ? `<span style="font-size:12.5px;color:#4a4239;font-style:italic">${esc(COPY.host.msgNobody)}</span>`
          : `<span data-act="msgSend" style="padding:12px 20px;background:#9b1b22;color:#f7f1e6;font:600 10px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;white-space:nowrap" data-hover="background:#7e151b;color:#f7f1e6">${COPY.host.msgSend}</span>`}
        ${st.msgStaged ? `<span style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:#6e5626">${esc(COPY.host.msgStaged(st.msgStaged))}</span>` : ''}
      </div>
    </div>`;
}
function scanBlock() {
  return `
    <div data-block="scan" style="max-width:620px;padding-bottom:30px">
      <div style="font-size:12.5px;color:#4a4239;line-height:1.6;margin-bottom:12px">${esc(COPY.host.scanLead)}</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <input class="input mx-w250" data-role="scanCode" aria-label="${esc(COPY.host.t3)}" placeholder="${esc(COPY.host.scanPlaceholder)}" maxlength="80" style="width:250px">
        <span data-act="scanGo" style="padding:12px 20px;border:1px solid rgba(25,21,18,.3);font:600 10px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;color:#191512;white-space:nowrap" data-hover="border-color:#191512;color:#191512">${COPY.host.scanGo}</span>
      </div>
      ${hostScanResult()}
    </div>`;
}

// ---------------------------------------------------------------- module
export default {
  title: (ctx) => ((ctx && ctx.params && ctx.params.id) ? 'Hosting a meetup' : 'Meetups'),
  async render(root, ctx) {
    ensureCss();
    rootEl = root;
    edition = (ctx.query && ctx.query.edition) || null;
    meetupId = (ctx.params && ctx.params.id) || null;
    mode = meetupId ? 'host' : 'board';
    st = { day: null, tag: null, scan: null, msgStaged: 0 };

    if (mode === 'host') {
      H = await loadHost(meetupId);
      if (rootEl !== root) return;                      // navigated away while loading
      if (!H) {                                          // 404 — never "you are not the host of X"
        const nf = await import('./notfound.js');
        if (rootEl !== root) return;
        state.set({ layout: 'bare' });                   // the router resets this on the next route
        (nf.default || nf).render(root, ctx);
        return;
      }
      root.innerHTML = hostTpl();
      unbind = ui.bind(root, handlers);
      chrome.refresh();
      return;
    }

    D = await loadBoard();
    if (rootEl !== root) return;
    root.innerHTML = boardTpl();
    unbind = ui.bind(root, handlers);
    chrome.refresh();
  },
  destroy() {
    if (unbind) unbind(); unbind = null;
    rootEl = null; D = null; H = null; st = null; meetupId = null; edition = null; mode = 'board';
  }
};
