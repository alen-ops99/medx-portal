// Source: no artboard — design/MEETUPS-SPEC.md §3 ("Member view" and "Host view"), redrawn to the phone calm rules
// (DESIGN-RULES.md 2026-09-25): a large title, the week's facts, one card per table (a date tile, the title, the
// venue, the places left and the table's own join control), my places as rows with the pass as icon actions.
// Two screens in one module, exactly as js/views/plexus.js holds four:
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

const WD3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ---- COPY: every string a member or host can read lives here ---------------------------------
export const COPY = {
  crumb: { projects: 'PROJECTS', plexus: 'PLEXUS WEEK', meetups: 'MEETUPS', hosting: 'HOSTING' },
  kinds: { coffee: 'Coffee', lunch: 'Lunch', dinner: 'Dinner', walk: 'Walk', visit: 'Visit', other: 'Meetup' },
  head: {
    title: 'Meetups',
    line: 'Small tables, hosted by people already coming.'
  },
  // three short facts (GLASS-RULES §3.6 Meetups): the waitlist rule lives in the leave sheet, where it matters
  facts: { free: 'Free, by sign-up', small: 'A few places per table' },
  filters: { day: 'Day', tag: 'Field', all: 'All', clear: 'Clear filters' },
  board: {
    title: 'Tables', count: n => `${n} open`,
    invite: 'By invitation', host: 'You host this one',
    forWho: who => `For ${who}`,
    emptyLine: 'No tables open yet.',
    emptyFilterLine: 'Nothing matches that.'
  },
  seats: {
    left: (n, cap) => cap ? `${n} of ${cap} places left` : `${n} ${n === 1 ? 'place' : 'places'} left`,
    full: 'Table full',
    fullWaiting: n => `Table full · ${n} waiting`,
    waiting: n => `${n} waiting`
  },
  act: {
    join: 'JOIN THIS TABLE →', waitlist: 'JOIN THE WAITLIST →', accept: 'ACCEPT THE INVITATION →',
    closed: 'TABLE FULL', past: 'THIS TABLE HAS PASSED', archivedWeek: 'PAST EDITION', leave: 'CAN’T MAKE IT'
  },
  // Only a place you actually hold gets a tag. A cancelled or declined row means you hold nothing.
  mineChip: {
    confirmed: 'You’re in', waitlisted: pos => (pos ? `Waitlist · no. ${pos}` : 'On the waitlist'),
    invited: 'Invited', checkedIn: 'Checked in'
  },
  mine: {
    title: 'My meetups',
    qrAlt: 'Your meetup QR code',
    apple: 'Apple Wallet', google: 'Google Wallet', calendar: 'Add to calendar',
    accept: 'YES, I’M COMING →', decline: 'CAN’T MAKE IT',
    inviteNote: 'The host invited you. Accept and the place is held for you.',
    cancelledNote: 'The organizers cancelled this meetup — nothing for you to do.',
    passNote: 'Show the QR at the table.'
  },
  hosting: {
    title: 'You are hosting',
    open: 'Open the host page',
    line: (c, cap) => `${c} of ${cap} places taken`
  },
  help: { ask: 'Message us' },
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
    eyebrow: 'Plexus Week · hosting',
    headcount: { confirmed: 'Confirmed', waitlist: 'Waiting', checkedIn: 'Checked in' },
    linkLabel: 'HOST LINK · WORKS WITHOUT SIGNING IN',
    linkRow: 'Host link', linkSub: 'Opens your table without a sign-in',
    copyLink: 'Copy', copied: 'Host link copied — it opens your table without a sign-in.',
    t1: 'Who is coming',
    emptyLine: 'Nobody has joined yet.',
    waitTitle: 'Waiting', invitedTitle: 'Invited · not answered yet',
    waitPos: n => `No. ${n}`,
    checkedIn: 'Checked in', noBio: 'No bio on file yet.',
    t2: 'Message your attendees',
    msgLead: 'The Med&X team approves every message.',
    msgSubject: 'SUBJECT', msgBody: 'YOUR MESSAGE', msgSend: 'SEND FOR APPROVAL →',
    msgNeed: 'A subject and a message are both needed.',
    msgQueued: n => `${n} draft${n === 1 ? '' : 's'} staged for the Med&X team to approve and send. Nothing has gone out yet.`,
    msgStaged: n => `Waiting for approval: ${n} draft${n === 1 ? '' : 's'}.`,
    msgNobody: 'Nobody holds a place yet, so there is no one to write to.',
    t3: 'Check someone in',
    scanLead: 'Paste the code under their QR.',
    scanPlaceholder: 'm-0000…', scanGo: 'CHECK IN →', scanNeed: 'Paste the code from their pass first.',
    scanAgain: 'Clear',
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
  return d ? `${WD3[d.getDay()]} ${d.getDate()} ${MON3[d.getMonth()]}` : String(iso || '');
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
  return COPY.seats.left(m.spots_left, Number(m.capacity) || 0);
}
// the date tile: weekday over the day number, from the meetup's own start (or its day)
function dateTile(m) {
  const d = fmt.toDate(m.starts_at || m.day);
  return d ? `<span class="mx-mu-date" aria-hidden="true"><span>${WD3[d.getDay()]}</span><b>${d.getDate()}</b></span>` : `<span class="mx-mu-date" aria-hidden="true"><span>Dec</span><b>·</b></span>`;
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

// ---------------------------------------------------------------- kit helpers
const icon = (n, s) => ui.icon(n, s || 20);
const chev = () => ui.icon('chevron-right', 18);
// a section head without numerals (GLASS-RULES Q2)
function sectionHead(title, right) {
  return `<div class="mx-sh"><h2 class="mx-sh-t">${title}</h2>${right || ''}</div>`;
}
function crumb(items) {
  const sep = '<span style="color:rgba(25,21,18,.35);font-size:12px">→</span>';
  return `
  <!-- v2: breadcrumb (desktop; phones carry back in the top bar) -->
  <div class="mx-crumbs mx-gutter" style="display:flex;align-items:center;gap:13px;padding:10px 36px;border-bottom:1px solid rgba(25,21,18,.16);flex-wrap:wrap">
    ${items.map((it, i) => (i ? sep + '\n    ' : '') + (it.to
      ? `<a href="${it.to}" data-dir="back" style="font:600 12px Inter,sans-serif;letter-spacing:.12em;color:#4a4239" data-hover="color:#191512">${it.label}</a>`
      : `<span style="font:600 12px Inter,sans-serif;letter-spacing:.12em;color:${i ? '#191512' : '#4a4239'}">${it.label}</span>`)).join('\n    ')}
    <div style="flex:1"></div>
  </div>
  <!-- /v2 -->`;
}
function blockHelp() {
  return `
  <section class="mx-sec">
    <div class="mx-list"><a class="mx-row" href="/app/messages?about=plexus">${icon('mail')}<span class="mx-row-l">${COPY.help.ask}</span>${chev()}</a></div>
  </section>`;
}
const tag = (text, kind) => `<span class="mx-tag mx-tag--${kind || 'soft'}">${esc(text)}</span>`;

function mineChipFor(m) {
  const s = String(m.my_status || '');
  if (s === 'confirmed' || s === 'promoted') return tag(COPY.mineChip.confirmed, 'crimson');
  if (s === 'waitlisted') return tag(COPY.mineChip.waitlisted(m.my_waitlist_pos), 'gold');
  if (s === 'invited') return tag(COPY.mineChip.invited, 'gold');
  return '';                                     // cancelled / declined: you hold nothing to label
}

// ================================================================ BOARD (/app/plexus/meetups)
function filtered() {
  return D.meetups.filter(m => (!st.day || m.day === st.day) && (!st.tag || (m.tags || []).includes(st.tag)));
}
function boardFilters() {
  if (!D.days.length && !D.tags.length) return '';
  const chip = (act, value, label, on) => `<span data-act="${act}" data-value="${esc(value)}" role="button" aria-pressed="${on}" class="chip${on ? ' on' : ''}">${esc(label)}</span>`;
  return `
      <div class="mx-meetup-filters">
        ${D.days.length ? `${chip('fDay', '', COPY.filters.all, !st.day)}
        ${D.days.map(d => chip('fDay', d, dayLabel(d), st.day === d)).join('\n        ')}` : ''}
        ${D.tags.length ? `${D.days.length ? '<span class="mx-mu-div" aria-hidden="true"></span>' : chip('fTag', '', COPY.filters.all, !st.tag)}
        ${D.tags.map(t => chip('fTag', t, t, st.tag === t)).join('\n        ')}` : ''}
        ${(st.day || st.tag) ? `<span data-act="fClear" role="button" class="mx-mu-textbtn">${COPY.filters.clear}</span>` : ''}
      </div>`;
}
// the table's own control — the same data-acts as before, drawn as a small button
function joinControl(m) {
  if (D.archived) return `<span class="btn-ghost btn-sm" aria-disabled="true">${COPY.act.archivedWeek}</span>`;
  const s = String(m.my_status || '');
  if (s === 'confirmed' || s === 'promoted' || s === 'waitlisted') {
    return `<span data-act="leave" data-id="${esc(m.id)}" role="button" class="btn-ghost btn-sm">${COPY.act.leave}</span>`;
  }
  if (isPast(m)) return `<span class="btn-ghost btn-sm" aria-disabled="true">${COPY.act.past}</span>`;
  if (m.full && !m.waitlist_enabled) return `<span class="btn-ghost btn-sm" aria-disabled="true">${COPY.act.closed}</span>`;
  const label = s === 'invited' ? COPY.act.accept : (m.full ? COPY.act.waitlist : COPY.act.join);
  return `<span data-act="join" data-id="${esc(m.id)}" role="button" class="btn-ghost btn-sm mx-mu-join">${label}</span>`;
}
function meetupCard(m) {
  const tags = [];
  if (m.visibility === 'invite') tags.push(tag(COPY.board.invite));
  if (m.is_host) tags.push(tag(COPY.board.host, 'ink'));
  const mc = mineChipFor(m); if (mc) tags.push(mc);
  const venue = venueLine(m);
  return `
        <article class="mx-meetup-card">
          <div class="mx-mu-top">
            ${dateTile(m)}
            <div class="mx-mu-main">
              <span class="mx-mu-kind">${esc(kindLabel(m.kind))}${m.when_label ? ` · ${esc(m.when_label)}` : ''}</span>
              <span class="mx-mu-title">${esc(m.title || '')}</span>
              ${m.host_line ? `<span class="mx-mu-host">${esc(m.host_line)}</span>` : ''}
            </div>
          </div>
          ${tags.length ? `<div class="mx-mu-tags">${tags.join('')}</div>` : ''}
          ${venue ? (m.venue_map_url
            ? `<a class="mx-mu-venue" href="${esc(m.venue_map_url)}" target="_blank" rel="noopener">${icon('pin', 18)}<span>${esc(venue)}</span></a>`
            : `<span class="mx-mu-venue">${icon('pin', 18)}<span>${esc(venue)}</span></span>`) : ''}
          ${m.description ? `<p class="mx-mu-desc">${esc(m.description)}</p>` : ''}
          ${m.audience ? `<span class="mx-mu-for">${esc(COPY.board.forWho(m.audience))}</span>` : ''}
          <div class="mx-meetup-foot">
            <span class="mx-mu-seats${m.full ? ' is-full' : ''}">${icon('users', 18)}${esc(seatsLine(m))}</span>
            ${joinControl(m)}
          </div>
        </article>`;
}
function boardBlock() {
  const list = filtered();
  const filtering = !!(st.day || st.tag);
  return `
    <section class="mx-sec" data-block="board">
      ${sectionHead(COPY.board.title, D.meetups.length ? tag(COPY.board.count(D.meetups.length)) : '')}
      ${boardFilters()}
      ${list.length ? `
      <div class="mx-meetup-grid">
        ${list.map(meetupCard).join('')}
      </div>` : `
      <div class="empty mx-mu-empty">
        <span class="empty-line">${esc(filtering ? COPY.board.emptyFilterLine : COPY.board.emptyLine)}</span>
        ${filtering ? `<span data-act="fClear" role="button" class="btn-ghost btn-sm">${COPY.filters.clear}</span>` : ''}
      </div>`}
    </section>`;
}

// my places: one row each — the QR, what and when, and the pass as icon actions
function passIcons(m) {
  const links = [];
  if (m.apple_pass_url) links.push({ href: m.apple_pass_url, label: COPY.mine.apple, ic: 'wallet' });
  if (m.google_wallet_url) links.push({ href: m.google_wallet_url, label: COPY.mine.google, ic: 'card' });
  if (m.calendar_url) links.push({ href: m.calendar_url, label: COPY.mine.calendar, ic: 'calendar' });
  return links.map(l => `<a class="mx-iconbtn" href="${esc(l.href)}" target="_blank" rel="noopener" aria-label="${esc(l.label)}" title="${esc(l.label)}">${icon(l.ic)}</a>`).join('');
}
function mineRow(m) {
  const invited = String(m.my_status || '') === 'invited';
  const inv = m.invite || null;
  return `
        <div class="mx-meetup-mine">
          ${m.qr_url ? `<img class="mx-meetup-qr" src="${esc(assetSrc(m.qr_url))}" alt="${esc(COPY.mine.qrAlt)}" loading="lazy">` : dateTile(m)}
          <div class="mx-mu-main">
            <div class="mx-mu-tags">${mineChipFor(m)}${m.checked_in ? tag(COPY.mineChip.checkedIn, 'ink') : ''}</div>
            <span class="mx-mu-title">${esc(m.title || '')}</span>
            <span class="mx-mu-kind">${esc(kindLabel(m.kind))}${m.when_label ? ` · ${esc(m.when_label)}` : ''}</span>
            ${venueLine(m) ? `<span class="mx-mu-venue">${icon('pin', 18)}<span>${esc(venueLine(m))}</span></span>` : ''}
            ${m.cancelled ? `<span class="mx-mu-note is-alert">${esc(COPY.mine.cancelledNote)}</span>` : ''}
            ${invited ? `<span class="mx-mu-note">${esc(COPY.mine.inviteNote)}</span>` : ''}
            ${m.qr_url ? `<span class="mx-mu-note">${esc(COPY.mine.passNote)}</span>` : ''}
            <div class="mx-mu-acts">
              ${passIcons(m)}
              ${invited && inv ? `
              <a href="${esc(inv.accept_url)}" class="btn-primary btn-sm">${COPY.mine.accept}</a>
              <a href="${esc(inv.decline_url)}" class="mx-mu-textbtn">${COPY.mine.decline}</a>` : `
              <span data-act="leave" data-id="${esc(m.id)}" role="button" class="btn-ghost btn-sm">${COPY.act.leave}</span>`}
            </div>
          </div>
        </div>`;
}
// not drawn while the member holds no place (an empty section with nothing to act on, Q11)
function mineBlock() {
  if (!D.mine.length) return '<div data-block="mine"></div>';
  return `
    <section class="mx-sec" data-block="mine">
      ${sectionHead(COPY.mine.title)}
      <div class="mx-mu-minelist">
        ${D.mine.map(mineRow).join('')}
      </div>
    </section>`;
}
function hostingBlock() {
  if (!D.hosting.length) return '<div data-block="hosting"></div>';
  return `
    <section class="mx-sec" data-block="hosting">
      ${sectionHead(COPY.hosting.title)}
      <div class="mx-list">
        ${D.hosting.map(m => `
        <a href="/app/plexus/meetups/${encodeURIComponent(m.id)}/host" class="mx-row">${dateTile(m)}
          <span class="mx-row-l">${esc(m.title || '')}<span class="mx-row-s">${esc(fmt.detail([m.when_label, COPY.hosting.line(m.confirmed, m.capacity), m.waitlisted ? COPY.seats.waiting(m.waitlisted) : ''].filter(Boolean).join(' · ')))}</span></span>
          ${chev()}
        </a>`).join('')}
      </div>
    </section>`;
}
// "3–6 December" (one month) or "30 November – 2 December", from the edition's own dates
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function dayRange(a, b) {
  const x = fmt.toDate(a), y = fmt.toDate(b) || x;
  if (!x) return '';
  if (x.getTime() === y.getTime()) return `${x.getDate()} ${MONTH[x.getMonth()]}`;
  return x.getMonth() === y.getMonth() ? `${x.getDate()}–${y.getDate()} ${MONTH[x.getMonth()]}` : `${x.getDate()} ${MONTH[x.getMonth()]} – ${y.getDate()} ${MONTH[y.getMonth()]}`;
}
function boardTpl() {
  const ed = D.edition || {};
  const range = ed.starts_on ? [dayRange(ed.starts_on, ed.ends_on), ed.city].filter(Boolean).join(' · ') : '';
  return `
<div data-screen-label="Meetups" class="mx-mu">
  ${crumb([{ label: COPY.crumb.projects, to: '/app/projects' }, { label: COPY.crumb.plexus, to: '/app/plexus' }, { label: COPY.crumb.meetups }])}
  <div class="mx-p">
    <section class="mx-sec mx-sec--tight">
      <h1 class="mx-lt">${COPY.head.title}</h1>
      <p class="mx-lede">${esc(COPY.head.line)}</p>
      <ul class="mx-facts mx-mu-facts">
        ${range ? `<li class="mx-fact">${icon('calendar')}<div class="mx-fact-body"><span class="mx-fact-v">${esc(range)}</span></div></li>` : ''}
        <li class="mx-fact">${icon('ticket')}<div class="mx-fact-body"><span class="mx-fact-v">${COPY.facts.free}</span></div></li>
        <li class="mx-fact">${icon('users')}<div class="mx-fact-body"><span class="mx-fact-v">${COPY.facts.small}</span></div></li>
      </ul>
    </section>
    ${boardBlock()}
    ${mineBlock()}
    ${hostingBlock()}
    ${blockHelp()}
  </div>
</div>`;
}

// ================================================================ HOST (/app/plexus/meetups/:id/host)
function personRow(p, opts) {
  const o = opts || {};
  const role = [p.position, p.institution].filter(Boolean).join(' · ');
  return `
        <div class="mx-person-row mx-mu-person">${ui.portrait({ name: p.name || '', size: 64, alt: '' })}
          <span class="mx-person-text">
            <span class="mx-person-name">${esc(p.name || '')}</span>
            ${role ? `<span class="mx-person-role">${esc(role)}</span>` : ''}
            <span class="mx-mu-bio">${p.bio ? esc(p.bio) : esc(COPY.host.noBio)}</span>
          </span>
          <span class="mx-person-act">${o.pos ? tag(COPY.host.waitPos(o.pos)) : ''}${p.checked_in ? tag(COPY.host.checkedIn, 'gold') : ''}</span>
        </div>`;
}
function hostPeople() {
  const att = Array.isArray(H.attendees) ? H.attendees : [];
  const wait = Array.isArray(H.waitlist) ? H.waitlist : [];
  const inv = Array.isArray(H.invited) ? H.invited : [];
  return `
      ${att.length ? `<div class="mx-person-rows">${att.map(p => personRow(p)).join('')}</div>` : `
      <div class="empty mx-mu-empty"><span class="empty-line">${esc(COPY.host.emptyLine)}</span></div>`}
      ${wait.length ? `
      <h3 class="mx-mu-h3">${COPY.host.waitTitle}</h3>
      <div class="mx-person-rows">${wait.map((p, i) => personRow(p, { pos: p.waitlist_pos || i + 1 })).join('')}</div>` : ''}
      ${inv.length ? `
      <h3 class="mx-mu-h3">${COPY.host.invitedTitle}</h3>
      <div class="mx-person-rows">${inv.map(p => personRow(p)).join('')}</div>` : ''}`;
}
function hostScanResult() {
  const r = st.scan;
  if (!r) return '';
  const p = r.person || null;
  const role = p ? [p.position, p.institution].filter(Boolean).join(' · ') : '';
  return `
      <div class="mx-mu-scanres${r.ok ? ' is-ok' : ' is-bad'}">
        <span class="mx-mu-scanstate">${esc(String(r.result || '').replace(/_/g, ' '))}</span>
        ${p ? `<span class="mx-mu-title">${esc(p.name || '')}</span>` : ''}
        ${role ? `<span class="mx-mu-kind">${esc(role)}</span>` : ''}
        ${p && p.bio ? `<span class="mx-mu-note">${esc(p.bio)}</span>` : ''}
        <span class="mx-mu-note">${esc(r.message || '')}</span>
        <span data-act="scanClear" role="button" class="mx-mu-textbtn">${COPY.host.scanAgain}</span>
      </div>`;
}
function hostTpl() {
  const m = H.meetup || {};
  const hc = H.headcount || {};
  const venue = [m.venue_name, m.venue_address].filter(Boolean).join(' · ');
  const tile = (v, label) => `<div class="mx-tile"><span class="mx-tile-n">${esc(String(v))}</span><span class="mx-tile-l">${label}</span></div>`;
  return `
<div data-screen-label="Meetup host" class="mx-mu">
  ${crumb([{ label: COPY.crumb.projects, to: '/app/projects' }, { label: COPY.crumb.plexus, to: '/app/plexus' }, { label: COPY.crumb.meetups, to: '/app/plexus/meetups' }, { label: COPY.crumb.hosting }])}
  <div class="mx-p">
    <section class="mx-sec mx-sec--tight">
      <span class="mx-mu-eyebrow">${COPY.host.eyebrow}</span>
      <h1 class="mx-lt">${esc(m.title || '')}</h1>
      <p class="mx-lede">${esc(COPY.host.kindLine(kindLabel(m.kind), m.when_label))}</p>
      ${venue ? `<ul class="mx-facts mx-mu-facts">${m.venue_map_url
        ? `<li><a class="mx-fact" href="${esc(m.venue_map_url)}" target="_blank" rel="noopener">${icon('pin')}<div class="mx-fact-body"><span class="mx-fact-v">${esc(venue)}</span></div>${icon('external', 18)}</a></li>`
        : `<li class="mx-fact">${icon('pin')}<div class="mx-fact-body"><span class="mx-fact-v">${esc(venue)}</span></div></li>`}</ul>` : ''}
      ${m.description ? `<div class="mx-accs mx-mu-about"><details class="mx-acc"><summary>About this table</summary><div class="mx-acc-a">${esc(m.description)}</div></details></div>` : ''}
    </section>
    <section class="mx-sec mx-sec--tight">
      <div class="mx-tiles mx-tiles--3">
        ${tile(`${hc.confirmed == null ? 0 : hc.confirmed}/${hc.capacity == null ? 0 : hc.capacity}`, COPY.host.headcount.confirmed)}
        ${tile(hc.waitlisted == null ? 0 : hc.waitlisted, COPY.host.headcount.waitlist)}
        ${tile(hc.checked_in == null ? 0 : hc.checked_in, COPY.host.headcount.checkedIn)}
      </div>
      ${H.host_link ? `<div class="mx-list mx-mu-link"><div class="mx-row">${icon('external')}<span class="mx-row-l">${COPY.host.linkRow}<span class="mx-row-s">${COPY.host.linkSub}</span></span><span data-act="copyHostLink" role="button" class="btn-ghost btn-sm">${COPY.host.copyLink}</span></div></div>` : ''}
    </section>
    <section class="mx-sec">
      ${sectionHead(COPY.host.t1)}
      <div data-block="people">${hostPeople()}</div>
    </section>
    <section class="mx-sec">
      ${sectionHead(COPY.host.t2)}
      ${composerBlock()}
    </section>
    <section class="mx-sec">
      ${sectionHead(COPY.host.t3)}
      ${scanBlock()}
    </section>
    ${blockHelp()}
  </div>
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
    <div data-block="composer" class="mx-mu-form">
      <p class="mx-sh-sub">${esc(COPY.host.msgLead)}</p>
      <label class="label" for="mt-subj">${COPY.host.msgSubject}</label>
      <input id="mt-subj" class="input" data-role="msgSubject" aria-label="${esc(COPY.host.msgSubject)}" maxlength="160"${nobody ? ' disabled' : ''}>
      <label class="label" for="mt-body">${COPY.host.msgBody}</label>
      <textarea id="mt-body" class="input mx-meetup-textarea" data-role="msgBody" aria-label="${esc(COPY.host.msgBody)}" rows="5" maxlength="4000"${nobody ? ' disabled' : ''}></textarea>
      ${nobody
        ? `<p class="mx-mu-note">${esc(COPY.host.msgNobody)}</p>`
        : `<span data-act="msgSend" role="button" class="btn-primary btn-block">${COPY.host.msgSend}</span>`}
      ${st.msgStaged ? `<p class="mx-mu-note">${esc(COPY.host.msgStaged(st.msgStaged))}</p>` : ''}
    </div>`;
}
function scanBlock() {
  return `
    <div data-block="scan" class="mx-mu-form">
      <p class="mx-sh-sub">${esc(COPY.host.scanLead)}</p>
      <div class="mx-mu-scanrow">
        <input class="input" data-role="scanCode" aria-label="${esc(COPY.host.t3)}" placeholder="${esc(COPY.host.scanPlaceholder)}" maxlength="80">
        <span data-act="scanGo" role="button" class="btn-ghost btn-sm">${COPY.host.scanGo}</span>
      </div>
      ${hostScanResult()}
    </div>`;
}

// ---------------------------------------------------------------- module
export default {
  reveal: true,        // sections below the fold rise in on scroll (router › ui.revealOnScroll)
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
        if (rootEl !== root || (ctx.ready && !(await ctx.ready()))) return;
        state.set({ layout: 'bare' });                   // the router resets this on the next route
        await (nf.default || nf).render(root, ctx);
        return;
      }
      if (ctx.ready && !(await ctx.ready())) return;    // the router moved on
      root.innerHTML = hostTpl();
      unbind = ui.bind(root, handlers);
      chrome.refresh();
      return;
    }

    D = await loadBoard();
    if (rootEl !== root || (ctx.ready && !(await ctx.ready()))) return; // navigated away while loading, or the router moved on
    root.innerHTML = boardTpl();
    unbind = ui.bind(root, handlers);
    chrome.refresh();
  },
  destroy() {
    if (unbind) unbind(); unbind = null;
    rootEl = null; D = null; H = null; st = null; meetupId = null; edition = null; mode = 'board';
  }
};
