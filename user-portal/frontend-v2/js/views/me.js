// Source: My MedX.dc.html
// Blocks (artboard order): "MY MED&X · MEMBERSHIP, TICKETS & RECORD" (intro + member card panel) ›
// "01 · MY WALLET" (CURRENT TICKETS / PAST PURCHASES) › "02 · MY RECORD"
// (EVENTS · CERTIFICATES · BADGES) › "03 · SETTINGS" › help band. Wallet empty state from
// Empty States.dc.html › "MY WALLET · NO TICKETS YET". Ticket-card vocabulary: Emails.dc.html.
// Tabs: /app/me (wallet) · /app/me/certificates — the sub-tab has no artboard of its own and
// reuses this screen's vocabulary (v2-marked). The REWARDS band, the /app/me/rewards tab and the
// points economy were deleted (UX audit 2026-09-02 › item 4); badges, certificates and attendance
// cards stay — they are the recognition layer the audit keeps.
// Backend: user-portal/backend/v2/wallet.js (/api/v2/wallet/*) + existing member routes.
import { api } from '../api.js';
import { session } from '../state.js';
import { ui, esc, fmt } from '../ui.js';
import { FACTS } from '../facts.js';
import { chrome } from '../chrome.js';
import router from '../router.js';

export const SOURCE = 'My MedX.dc.html';

export const COPY = {
  eyebrow: 'MY MED&X · MEMBERSHIP, TICKETS & RECORD',
  // the quiet door to Profile & settings (password, directory, delete account — App Store 5.1.1(v)) at the top
  settingsLink: 'PROFILE &amp; SETTINGS →',
  title: first => `Your membership, <i>${esc(first)}</i>.`,
  titleT: 'My Med&amp;X', addWalletT: 'Add to Wallet', dlCardT: 'Download',
  lede: "Your member card and tickets — one QR admits you to everything you're registered for.",
  dlCard: 'DOWNLOAD CARD', addWallet: 'ADD TO PHONE WALLET',
  // on an iPhone or iPad only Apple Wallet can take the pass, so the note (and the picker) name only it there
  walletNote: apple => `${apple ? 'Apple Wallet' : 'Apple and Google Wallet'} supported · per-event tickets live below in <strong style="color:#191512">My wallet</strong>.`,
  card: {
    label: 'MEMBER CARD · 2026', member: 'MEMBER', motto: 'Jedna karta, sva vrata.',
    mottoSub: 'One card, every door · tap to flip back', fast: 'FAST CHECK-IN AT MED&X EVENTS',
    present: 'PRESENT FULL SCREEN', presentHint: 'Show this code at the door',
    presentT: 'Present full screen', flipT: 'Tap for your QR', sinceT: y => `since ${y}`
  },
  wallet: {
    n: '01', title: 'MY WALLET', cur: 'CURRENT TICKETS', past: 'PAST PURCHASES',
    browse: 'BROWSE EVENTS →', download: 'DOWNLOAD', email: 'EMAIL', add: 'ADD TO WALLET', pay: 'COMPLETE PAYMENT →',
    emptyLine: 'Your wallet is ready for December.',
    emptyWhy: 'Plexus 2026 is free for members — register and your ticket lands here, QR and all.',
    emptyCta: 'REGISTER FOR PLEXUS →', emptyTag: 'MY WALLET · NO TICKETS YET', emptyPh: 'Your first ticket',
    pastEmptyLine: 'No purchases yet.', pastEmptyWhy: 'Receipts and confirmations collect here after you register — free entries get a confirmation, paid seats a receipt.',
    pastNote: 'Free registrations come with a confirmation rather than a receipt · certificates of attendance live under <strong style="color:#191512">My record</strong> below. Ask us anything about an order — ',
    contact: 'contact the team', receipt: 'RECEIPT →', confirmation: 'CONFIRMATION →',
    emailed: to => `Ticket sent to ${to} — check your inbox.`,
    walletGate: 'Wallet passes are on their way — until then, the QR on your card here works at the door.',
    status: {
      free: 'Free entry, confirmed', paidSeat: a => `${fmt.eur(a)}, seat reserved`, paid: a => `${fmt.eur(a)}, confirmed`,
      vip: 'Complimentary seat', pending: a => (a ? `${fmt.eur(a)} due — payment pending` : 'Payment pending'),
      waitlisted: 'On the waiting list', checkedIn: 'Checked in'
    },
    order: n => `Order ${n}`, paidTag: a => `${fmt.eur(a)} · PAID`, freeTag: 'FREE ENTRY', vipTag: 'VIP · COMPLIMENTARY',
    titleT: 'Tickets', curT: 'Upcoming', pastT: 'Past', payT: 'Complete payment →', downloadT: 'Download', emailT: 'Email', addT: 'Wallet',
    emptyCtaT: 'Register for Plexus', pastEmptyWhyT: 'Receipts and confirmations collect here.', receiptT: 'Receipt', confirmationT: 'Confirmation'
  },
  record: {
    n: '02', title: 'MY RECORD', sub: 'Everything you have attended and earned with Med&amp;X — kept here for good.',
    events: 'EVENTS', eventsEmpty: 'Your events appear here after you register. ', browseShort: 'Browse events',
    certs: 'CERTIFICATES', certsEmpty: 'Certificates appear here after events you attend — download any time.',
    certExample: 'Certificate of Attendance', open: 'OPEN CERTIFICATES →',
    badges: 'BADGES', badgesEmpty: 'Recognition you earn across Med&X events collects here.',
    none: 'None yet', example: 'EXAMPLE', attended: 'ATTENDED', confirmed: 'CONFIRMED', registered: 'REGISTERED',
    cards: 'ATTENDANCE CARDS',
    titleT: 'Record', eventsT: 'Events', certsT: 'Certificates', badgesT: 'Badges', cardsT: 'Attendance card'
  },
  certs: {
    eyebrow: 'MY MED&X · CERTIFICATES', title: 'Your <i>certificates</i>.',
    lede: 'Every certificate carries a public verification link — share it anywhere, it proves itself.',
    download: 'DOWNLOAD PDF', verify: 'VERIFY LINK', copy: 'COPY LINK', copied: 'Verification link copied.',
    emptyLine: 'No certificates yet.', emptyWhy: 'Attend an event and your certificate of attendance appears here, ready to download and verify.',
    emptyCta: 'BROWSE EVENTS →', back: '← BACK TO MY MED&X', no: 'N°',
    titleT: 'Certificates', ledeT: 'Each carries a public verification link.', downloadT: 'Download', verifyT: 'Verify', copyT: 'Copy link',
    emptyWhyT: 'Attend an event and your certificate appears here.', emptyCtaT: 'Browse events'
  },
  // UX audit 2026-09-02 › item 8: name, email, password and language were editable here AND on
  // Profile & settings, in two different UI systems, with no answer to "where do I change X".
  // Profile & settings is the single owner now — every control moved there — and My Med&X goes back
  // to what it is best at: the card, the wallet, the record.
  settings: {
    n: '03', title: 'SETTINGS',
    line: 'Account settings live in your <i>Profile &amp; settings</i>.',
    why: 'Your name, photo, password, the projects you follow and your interests — all in one place.',
    cta: 'OPEN PROFILE &amp; SETTINGS →'
  },
  help: {
    line: "Don't see something, or something looks wrong?",
    sub: "Message us — you're signed in, so replies land right here in your portal inbox.",
    cta: 'MESSAGE US →'
  },
  rows: { profile: 'Profile &amp; settings', certs: 'Certificates', message: 'Message us' },
  err: { load: 'Could not reach the portal — showing what we have.', dl: 'Download failed — please try again.' }
};

// ---- view state ----
let D = null, st = null, unbind = null, rootEl = null, qrObjectUrl = null;

function ensureCss() {
  if (!document.getElementById('mx-css-me')) {
    const l = document.createElement('link');
    l.id = 'mx-css-me'; l.rel = 'stylesheet'; l.href = '/css/views/me.css';
    document.head.appendChild(l);
  }
}

// ---------------------------------------------------------------- data
async function load(tab) {
  // A separate builder ships GET /api/v2/attendance-cards/mine — probe the v2 mount table first
  // so a not-yet-landed module never 404s in the console (v2/index.js lists mounted files).
  let attendanceCall = Promise.resolve(null);
  try {
    const status = await api.get('/api/v2/_status', { noAuth: true });
    if (((status && status.modules) || []).some(f => String(f).startsWith('attendance'))) {
      attendanceCall = api.get('/api/v2/attendance-cards/mine');
    }
  } catch (e) { /* status route absent → leave the marked block empty */ }
  const r = await api.settle({
    me: api.get('/api/auth/me'),
    meta: api.get('/api/member/meta'),
    member: api.get('/api/v2/wallet/member'),
    tickets: api.get('/api/v2/wallet/tickets'),
    events: api.get('/api/my/events'),
    record: api.get('/api/member/record'),
    attendance: attendanceCall
  });
  // Certificates tab: mint-on-open only when a checked-in Plexus registration exists —
  // GET /api/plexus/my-certificate answers 400 for everyone else (kept out of the console).
  let myCert = null;
  if (tab === 'certificates' && r.record && (r.record.events || []).some(e => e.attended)) {
    try { myCert = await api.get('/api/plexus/my-certificate'); } catch (e) { myCert = null; }
  }
  r.myCert = myCert;
  if (r.me) session.update(Object.assign({}, r.me, { email_verified: (session.user || {}).email_verified }));
  const me = session.user || r.me || {};
  // unified ticket list: v2 enriched when mounted, /api/my/events shape as the fallback
  let upcoming = [], purchases = [], items = [];
  if (r.tickets && Array.isArray(r.tickets.items)) {
    items = r.tickets.items; upcoming = r.tickets.upcoming || []; purchases = r.tickets.purchases || [];
  } else if (r.events) {
    const lift = (e, up) => ({ kind: e.evt, id: e.id, title: e.title, date: e.date, end_date: e.end_date, venue: e.venue, amount: null, paid: e.paid, free: !e.paid ? false : true, pending: !e.paid, status: e.paid ? 'confirmed' : 'pending', waitlisted: !!e.waitlisted, checked_in: !!e.checked_in, ticket: e.ticket, calendar: e.calendar, invoice_number: null, receipt: e.paid ? 'confirmation' : null, upcoming: up });
    upcoming = (r.events.upcoming || []).map(e => lift(e, true));
    purchases = (r.events.past || []).map(e => lift(e, false));
    items = upcoming.concat(purchases);
  }
  const certs = (r.record && r.record.certificates) || [];
  if (r.myCert && r.myCert.id && !certs.find(c => c.id === r.myCert.id)) {
    certs.unshift({ id: r.myCert.id, title: (r.myCert.conference_name ? r.myCert.conference_name + ' — Certificate of Attendance' : 'Certificate of Attendance'), number: r.myCert.certificate_number, issue_date: r.myCert.issue_date, type: r.myCert.certificate_type || 'attendance' });
  }
  return {
    me, meta: r.meta || {}, member: r.member, items, upcoming, purchases,
    record: r.record || { events: [], certificates: [], badges: [] }, certs,
    attendance: r.attendance, v2: !!r.tickets, quiet: !!me.quiet
  };
}

// ---------------------------------------------------------------- helpers
async function authedDownload(path, filename) {
  const res = await fetch(api.url(path), { headers: session.token ? { Authorization: 'Bearer ' + session.token } : {} });
  if (!res.ok) {
    let msg = COPY.err.dl;
    try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (e) { }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
function itemById(id) { return (D.items || []).find(i => i.id === id) || null; }
function yearItalic(title, color) {
  const m = String(title || '').match(/^(.*?)(\s+\d{4})$/);
  return m ? esc(m[1]) + ' <i style="color:' + color + '">' + esc(m[2].trim()) + '</i>' : esc(title || '');
}
function statusLine(it) {
  const S = COPY.wallet.status;
  if (it.waitlisted) return S.waitlisted;
  if (it.status === 'vip') return S.vip;
  if (it.pending) return S.pending(it.amount);
  if (it.amount > 0) return it.kind === 'gala' ? S.paidSeat(it.amount) : S.paid(it.amount);
  return S.free;
}
// '4–5 Dec' (day first, like the rest of the phone screens)
function dayFirst(a, b) {
  const x = fmt.toDate(a), y = fmt.toDate(b), M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (!x) return '';
  return y && +y !== +x && y.getMonth() === x.getMonth() ? `${x.getDate()}–${y.getDate()} ${M[x.getMonth()]}` : `${x.getDate()} ${M[x.getMonth()]}`;
}
function shortRange(it) {
  const s = fmt.longRange(it.date, it.end_date);
  return s ? s.replace(/,\s*\d{4}$/, '') : '';
}
// an iPhone / iPad (the iOS app, or Safari there) can only add to Apple Wallet — the picker (Google as the filled
// primary button) is skipped and the Apple pass opens directly
const appleOnly = () => document.documentElement.classList.contains('mx-ios') || /iPhone|iPad|iPod/.test(navigator.userAgent || '') ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function walletProviderModal(onPick) {
  if (appleOnly()) return onPick('apple');
  ui.modal({
    eyebrow: 'ADD TO PHONE WALLET', title: 'Pick your wallet',
    body: '<p>The pass carries the same QR the door scans — one card, every door.</p>',
    actions: [
      { label: 'APPLE WALLET', onClick: () => onPick('apple') },
      { label: 'GOOGLE WALLET', kind: 'primary', onClick: () => onPick('google') }
    ]
  });
}
async function handlePassResponse(p) {
  if (p && p.configured && p.save_url) { window.open(p.save_url, '_blank', 'noopener'); return; }
  ui.toast(COPY.wallet.walletGate);
}

// ---------------------------------------------------------------- blocks (artboard order)
// Phone calm pass (2026-09-25, DESIGN-RULES §11 › /app/me): a large title, the member card first (nothing on it under
// 12px), ONE primary under it (Add to Wallet) with Download beside it, tickets as a shelf (or the drawn empty ticket and
// one line), the record as three numbers, then three rows: Profile & settings · Certificates · Message us. No paragraphs.
function qrBox(size, role) {
  const src = st.qrUrl || '';
  return `<div class="mx-me-qr" style="width:${size}px;height:${size}px">${src
    ? `<img data-role="${role}" src="${src}" alt="Member QR" style="image-rendering:pixelated">`
    : `<span data-role="${role}" class="mx-me-qr-wait" aria-hidden="true">${ui.icon('qr', Math.round(size * .4))}</span>`}</div>`;
}
// "MEMBER CARD · 2026": on a 320 phone only the year stays (me.css), so the label never crosses the gold frame
function cardLabel() {
  const parts = String(COPY.card.label).split(' · ');
  return parts.length > 1 ? `<span class="mx-me-card-label-a">${parts.slice(0, -1).join(' · ')} · </span>${parts[parts.length - 1]}` : COPY.card.label;
}
function cardInner() {
  const m = D.member || {};
  const meta = D.meta || {};
  const first = (D.me.first_name || '').trim();
  const last = (D.me.last_name || '').trim();
  const since = String(meta.member_since || m.since_year || FACTS.year).slice(0, 4);
  if (st.cardBack) return `
        <div class="mx-me-back">
          ${qrBox(200, 'qr-back')}
          <div class="mx-me-back-name">${esc([first, last].filter(Boolean).join(' ') || session.displayName())}</div>
          <div class="mx-me-back-sub">${esc(meta.member_type_label || m.type_label || 'Member')} · ${COPY.card.sinceT(since)}</div>
          <span data-act="present" data-v2="present-mode — no artboard counterpart" role="button" tabindex="0" class="mx-me-back-go">${COPY.card.presentT}</span>
        </div>`;
  return `
        <div class="mx-me-card-top">
          <img src="/assets/logo-white.png" alt="med&amp;X" style="height:20px;display:block">
          <span class="mx-me-card-label">${cardLabel()}</span>
        </div>
        <div class="mx-me-card-mid">
          <div class="mx-me-card-who">
            <div class="mx-me-card-name">${esc(first || session.displayName())}${last ? ' <i>' + esc(last) + '</i>' : ''}</div>
            <div class="mx-me-card-sub">${esc(meta.member_type_label || m.type_label || 'Member')} · ${COPY.card.sinceT(since)}</div>
          </div>
          <span class="mx-me-card-standing">${esc(meta.standing_label || m.standing_label || 'Member in good standing')}</span>
          ${qrBox(88, 'qr-front')}
        </div>
        <div class="mx-me-card-foot">
          <span>N° ${esc(m.member_no || String(D.me.id || '').slice(0, 8).toUpperCase())}</span>
          <span>${COPY.card.flipT}</span>
        </div>`;
}
function blockHero() {
  return `
  <!-- dc: My MedX.dc.html › "MY MED&X · MEMBERSHIP, TICKETS & RECORD" (large title, the card, one primary) -->
  <h1 class="mx-lt">${COPY.titleT}</h1>
  <section class="mx-sec mx-sec--tight mx-me-cardsec">
    <div class="mx-me-tilt" data-v2="hover tilt (css .mx-me-tilt / wireCardTilt) — the flip stays on the card">
      <div data-act="flip" data-block="card" role="button" tabindex="0" aria-label="Member card — tap to flip" class="mx-me-card${st.cardBack ? ' is-back' : ''}" style="transform:perspective(1100px) rotateY(${st.cardBack ? '360deg' : '0deg'})">
        ${cardInner()}
      </div>
    </div>
    <div class="mx-me-cardacts">
      <span data-act="cardWallet" role="button" tabindex="0" class="mx-me-walletbtn">${ui.icon('wallet', 20)}<span>${COPY.addWalletT}</span></span>
      <span data-act="dlCard" role="button" tabindex="0" class="btn-ghost mx-me-dl">${ui.icon('download', 18)}<span>${COPY.dlCardT}</span></span>
    </div>
  </section>
  <!-- /dc -->`;
}
function ticketCard(it) {
  const gala = it.kind === 'gala';
  const qr = it.ticket
    ? `<span class="mx-me-tqr"><img src="${esc(api.url(it.ticket))}" alt="Ticket QR"></span>`
    : `<span class="mx-me-tqr is-wait" aria-hidden="true">${ui.icon('qr', 24)}</span>`;
  const where = [shortRange(it), fmt.detail(String(it.venue || '').split(/;|·/)[0].trim())].filter(Boolean).join(' · ');
  const actions = it.pending && !it.paid
    ? `<a href="${it.kind === 'gala' ? '/app/gala' : '/app/plexus'}" class="mx-me-tact is-strong">${COPY.wallet.payT}</a>`
    : `<span data-act="tDl" data-id="${esc(it.id)}" role="button" tabindex="0" class="mx-me-tact">${COPY.wallet.downloadT}</span>
          <span data-act="tEmail" data-id="${esc(it.id)}" role="button" tabindex="0" class="mx-me-tact">${COPY.wallet.emailT}</span>
          <span data-act="tWallet" data-id="${esc(it.id)}" role="button" tabindex="0" class="mx-me-tact">${COPY.wallet.addT}</span>`;
  return `
        <div class="mx-me-ticket${gala ? ' is-gala' : ''}">
          <div class="mx-me-ticket-top">
            <span class="mx-me-ticket-text">
              <span class="mx-me-ticket-title">${yearItalic(it.title, 'inherit')}</span>
              ${where ? `<span class="mx-me-ticket-line">${esc(fmt.dash(where))}</span>` : ''}
              <span class="mx-me-ticket-status">${it.checked_in ? ui.icon('check', 16) + COPY.wallet.status.checkedIn : esc(statusLine(it))}</span>
            </span>
            ${qr}
          </div>
          <div class="mx-me-ticket-acts">${actions}</div>
        </div>`;
}
function walletCurrent() {
  if (!D.upcoming.length) return `
      <!-- dc: Empty States.dc.html › "MY WALLET · NO TICKETS YET" (compact) -->
      <div data-block="wallet-list" class="mx-me-empty">
        <div class="mx-ghost-ticket" aria-hidden="true">
          <span class="gt-stub"><span>ADMIT</span><b>1</b></span>
          <span class="gt-body"><span class="gt-eye">${esc(fmt.upper(FACTS.plexus.short))}</span><span class="gt-title">${COPY.wallet.emptyPh}</span><span class="gt-meta">${esc(dayFirst(FACTS.plexus.start, FACTS.plexus.end))} · ${esc(FACTS.plexus.city)}</span></span>
        </div>
        <span class="empty-line">${COPY.wallet.emptyLine}</span>
        <a href="/app/plexus" class="btn-ghost btn-sm mx-me-btn">${COPY.wallet.emptyCtaT}</a>
      </div>
      <!-- /dc -->`;
  return `
      <div data-block="wallet-list">
        <div class="mx-shelf mx-me-tickets" style="--w:300px">${D.upcoming.map(ticketCard).join('')}</div>
      </div>`;
}
function walletPast() {
  if (!D.purchases.length) return `
      <div data-block="wallet-list" class="mx-me-empty">
        <span class="empty-line">${COPY.wallet.pastEmptyLine}</span>
        <span class="empty-why">${COPY.wallet.pastEmptyWhyT}</span>
      </div>`;
  const row = it => {
    const orderNo = it.invoice_number ? '#' + it.invoice_number : '#' + String(it.id).slice(0, 8).toUpperCase();
    const tag = it.status === 'vip' ? COPY.wallet.vipTag : (it.amount > 0 && it.paid ? COPY.wallet.paidTag(it.amount) : COPY.wallet.freeTag);
    const action = it.receipt === 'receipt'
      ? `<span data-act="tReceipt" data-id="${esc(it.id)}" role="button" tabindex="0" class="mx-me-tact">${COPY.wallet.receiptT}</span>`
      : `<span data-act="tConfirm" data-id="${esc(it.id)}" role="button" tabindex="0" class="mx-me-tact">${COPY.wallet.confirmationT}</span>`;
    return `
        <div class="mx-me-row mx-me-past">
          <span class="mx-me-past-text"><span class="mx-me-past-title">${yearItalic(it.title, 'inherit')}</span><span class="mx-me-past-sub">${esc([COPY.wallet.order(orderNo), it.date ? fmt.longRange(it.date, it.end_date) : '', tag.charAt(0) + tag.slice(1).toLowerCase()].filter(Boolean).join(' · '))}</span></span>
          ${action}
        </div>`;
  };
  return `
      <div data-block="wallet-list" class="mx-me-pastlist">
        ${D.purchases.map(row).join('')}
      </div>`;
}
function blockWallet() {
  const cur = st.tab !== 'past';
  return `
  <!-- dc: My MedX.dc.html › "01 · MY WALLET" (Upcoming / Past, tickets as a shelf) -->
  <section class="mx-sec" data-block="wallet">
    <div class="mx-sh"><span class="mx-sh-n">01</span><h2 class="mx-sh-t">${COPY.wallet.titleT}</h2>
      <span class="mx-me-seg" role="tablist"><span data-act="showCur" role="tab" tabindex="0" aria-selected="${cur}" class="mx-me-tab${cur ? ' is-on' : ''}">${COPY.wallet.curT}</span><span data-act="showPast" role="tab" tabindex="0" aria-selected="${!cur}" class="mx-me-tab${cur ? '' : ' is-on'}">${COPY.wallet.pastT}</span></span>
    </div>
    ${cur ? walletCurrent() : walletPast()}
  </section>
  <!-- /dc -->`;
}
// UX audit 2026-09-02 › item 15: one row per event — the richest one wins (an attended row outranks a merely
// registered one) — and an attendance card waits until the member has actually been through the door.
function eventKey(e) {
  return String(e.event_id || e.id || `${e.title || ''}|${String(e.start_date || e.date || '').slice(0, 10)}`).toLowerCase();
}
function dedupeEvents(list) {
  const by = new Map();
  list.forEach(e => {
    const k = eventKey(e);
    const prev = by.get(k);
    if (!prev || (!prev.attended && e.attended) || (!prev.paid && e.paid)) by.set(k, e);
  });
  return [...by.values()];
}
function attendedKeys() {
  const keys = new Set();
  const norm = v => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  (D.record.events || []).forEach(e => { if (e.attended) keys.add(norm(e.title)); });
  (D.items || []).forEach(it => { if (it.checked_in) keys.add(norm(it.title)); });
  return keys;
}
function visibleCards(cards) {
  const been = attendedKeys();
  const norm = v => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const upcoming = new Set((D.upcoming || []).map(it => norm(it.title)));
  const seen = new Set();
  return cards.filter(c => {
    const name = norm(c.event_name || c.title || c.label || c.event);
    const key = `${c.kind || ''}|${name}`;
    if (seen.has(key)) return false;                       // one card per event
    if (c.kind !== 'year' && !been.has(name) && upcoming.has(name)) return false;  // not through the door yet
    seen.add(key);
    return true;
  });
}
function blockRecord() {
  const R = COPY.record;
  const evs = dedupeEvents(D.record.events || []);
  const certs = D.certs || [];
  const badges = (D.record.badges || []);
  const att = D.attendance;
  const rawCards = (att && (att.cards || att.items || (Array.isArray(att) ? att : null))) || [];
  const attCards = visibleCards(rawCards);
  return `
  <!-- dc: My MedX.dc.html › "02 · MY RECORD" (three numbers) -->
  <section class="mx-sec">
    <div class="mx-sh"><span class="mx-sh-n">02</span><h2 class="mx-sh-t">${R.titleT}</h2></div>
    <div class="mx-tiles mx-tiles--3">
      <div class="mx-tile"><span class="mx-tile-n">${evs.length}</span><span class="mx-tile-l">${R.eventsT}</span></div>
      <a class="mx-tile" href="/app/me/certificates"><span class="mx-tile-n">${certs.length}</span><span class="mx-tile-l">${R.certsT}</span></a>
      <div class="mx-tile"><span class="mx-tile-n">${badges.length}</span><span class="mx-tile-l">${R.badgesT}</span></div>
    </div>
    ${attCards.length ? `
    <div data-v2="attendance cards — GET /api/v2/attendance-cards/mine" class="mx-list mx-list--plain mx-me-cards">
      ${attCards.map(c => { const href = c.download_url || c.image_url || c.url || ''; return `<a class="mx-row" href="${esc(href ? api.url(href) : '#')}" ${href ? 'target="_blank" rel="noopener"' : ''}>${ui.icon('image')}<span class="mx-row-l">${esc(c.event_name || c.title || c.label || c.event || 'Attendance card')}<span class="mx-row-s">${R.cardsT}</span></span>${ui.icon('download', 18)}</a>`; }).join('')}
    </div>` : `
    <!-- v2: attendance cards — GET /api/v2/attendance-cards/mine; rows appear here once the member has generated cards -->`}
  </section>
  <!-- /dc -->`;
}
function blockSettings() {
  return `
  <!-- dc: My MedX.dc.html › "03 · SETTINGS" + help band → three rows -->
  <section class="mx-sec" data-block="settings">
    <div class="mx-list">
      <a class="mx-row" href="/app/profile">${ui.icon('user')}<span class="mx-row-l">${COPY.rows.profile}</span>${ui.icon('chevron-right', 18)}</a>
      <a class="mx-row" href="/app/me/certificates">${ui.icon('seal')}<span class="mx-row-l">${COPY.rows.certs}</span>${(D.certs || []).length ? `<span class="mx-row-v">${(D.certs || []).length}</span>` : ''}${ui.icon('chevron-right', 18)}</a>
      <a class="mx-row" href="/app/messages">${ui.icon('mail')}<span class="mx-row-l">${COPY.rows.message}</span>${ui.icon('chevron-right', 18)}</a>
    </div>
  </section>
  <!-- /dc -->`;
}

// ---------------------------------------------------------------- sub-tab: certificates
function certificatesTab() {
  const C = COPY.certs;
  const certs = D.certs || [];
  const rows = certs.map(c => `
    <div class="mx-me-row mx-me-cert">
      <span class="mx-me-seal" aria-hidden="true">${ui.icon('seal', 22)}</span>
      <span class="mx-me-cert-text">
        <span class="mx-me-cert-title">${esc(c.title || 'Certificate of Attendance')}</span>
        <span class="mx-me-cert-sub">${C.no} ${esc(c.number || '—')}${c.issue_date ? ' · ' + esc(fmt.longRange(c.issue_date, null)) : ''}</span>
        <span class="mx-me-cert-acts">
          <span data-act="certDl" data-id="${esc(c.id)}" data-num="${esc(c.number || '')}" role="button" tabindex="0" class="mx-me-tact">${C.downloadT}</span>
          <span data-act="certVerify" data-num="${esc(c.number || '')}" role="button" tabindex="0" class="mx-me-tact">${C.verifyT}</span>
          <span data-act="certCopy" data-num="${esc(c.number || '')}" role="button" tabindex="0" class="mx-me-tact">${C.copyT}</span>
        </span>
      </span>
    </div>`).join('');
  return `
  <!-- v2: certificates tab (phone calm pass: a large title, rows with a seal, three text actions) -->
  <div class="mx-p mx-me-certhead">
    <h1 class="mx-lt">${C.titleT}</h1>
    <p class="mx-lede">${C.ledeT}</p>
    <section class="mx-sec mx-sec--tight">
      ${certs.length ? `<div class="mx-me-certs">${rows}</div>` : `
      <div class="empty">
        <span class="empty-line">${C.emptyLine}</span>
        <span class="empty-why">${C.emptyWhyT}</span>
        <a href="/app/plexus" class="btn-ghost btn-sm mx-me-btn">${C.emptyCtaT}</a>
      </div>`}
    </section>
  </div>`;
}

// ---------------------------------------------------------------- template
function template() {
  if (st.view === 'certificates') return `
<div data-screen-label="My Med&X" class="mx-me-screen" style="font-family:Inter,sans-serif;color:#191512;background:#f7f1e6;min-height:100vh">${certificatesTab()}</div>`;
  return `
<div data-screen-label="My Med&X" class="mx-me-screen" style="font-family:Inter,sans-serif;color:#191512;background:#f7f1e6;min-height:100vh">
  <div class="mx-p">
    ${blockHero()}
    ${blockWallet()}
    ${blockRecord()}
    ${blockSettings()}
  </div>
</div>`;
}
function rerender(sel, html) { const el = rootEl && rootEl.querySelector(sel); if (el) el.outerHTML = html; }
// UPCOMING ⇄ PAST: the new list cross-fades in (css .mx-me-swap) — on the switch only, not on arrival
function swapIn() { const wl = rootEl && rootEl.querySelector('[data-block="wallet-list"]'); if (wl) wl.classList.add('mx-me-swap'); }
function repaintCard() {
  const card = rootEl && rootEl.querySelector('[data-block="card"]');
  if (!card) return;
  card.style.transform = `perspective(1100px) rotateY(${st.cardBack ? '360deg' : '0deg'})`;
  card.classList.toggle('is-back', !!st.cardBack);
  card.innerHTML = cardInner();
}

// ---------------------------------------------------------------- modals
function openPresent() {
  if (!st.qrUrl) return ui.toast(COPY.err.dl, { kind: 'error' });
  const m = ui.modal({
    eyebrow: 'MEMBER QR', title: '',
    body: `<div style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:6px 0 2px">
      <div style="width:min(64vw,260px);height:min(64vw,260px);background:#fff;border:1px solid rgba(25,21,18,.16);padding:12px;box-sizing:border-box"><img src="${st.qrUrl}" alt="Member QR" style="width:100%;height:100%;display:block;image-rendering:pixelated"></div>
      <div style="font-family:Fraunces,serif;font-style:italic;font-size:20px;color:#191512">${COPY.card.motto}</div>
      <div style="font:400 16px Inter,sans-serif;color:#4a4239">${COPY.card.presentHint}</div>
    </div>`,
    actions: [{ label: 'DONE', kind: 'primary' }]
  });
  return m;
}

// ---------------------------------------------------------------- handlers
const handlers = {
  flip: () => { st.cardBack = !st.cardBack; repaintCard(); },
  present: (el, e) => { if (e) e.stopPropagation(); openPresent(); },
  dlCard: (el) => {
    el.setAttribute('aria-disabled', 'true');
    authedDownload('/api/v2/wallet/card.pdf', 'medx-member-card.pdf')
      .catch(e2 => ui.toast(e2.message, { kind: 'error' }))
      .finally(() => el.removeAttribute('aria-disabled'));
  },
  cardWallet: () => walletProviderModal(async provider => {
    try {
      const p = provider === 'google'
        ? await api.get('/api/member/wallet/google')
        : await api.get('/api/v2/wallet/card/pass?provider=apple');
      await handlePassResponse(p);
    } catch (e) { ui.toast(COPY.wallet.walletGate); }
  }),
  showCur: () => { if (st.tab !== 'cur') { st.tab = 'cur'; rerender('[data-block="wallet"]', blockWallet()); swapIn(); } },
  showPast: () => { if (st.tab !== 'past') { st.tab = 'past'; rerender('[data-block="wallet"]', blockWallet()); swapIn(); } },
  tDl: (el) => {
    const it = itemById(el.dataset.id); if (!it) return;
    el.setAttribute('aria-disabled', 'true');
    authedDownload(`/api/v2/wallet/tickets/${encodeURIComponent(it.id)}.pdf`, `medx-ticket-${it.kind}.pdf`)
      .catch(e => ui.toast(e.message, { kind: 'error' }))
      .finally(() => el.removeAttribute('aria-disabled'));
  },
  tEmail: async (el) => {
    const it = itemById(el.dataset.id); if (!it) return;
    el.setAttribute('aria-disabled', 'true');
    try {
      const r = await api.post(`/api/v2/wallet/tickets/${encodeURIComponent(it.id)}/email`);
      ui.toast(COPY.wallet.emailed(r.to || D.me.email || 'your inbox'));
    } catch (e) { ui.toast(e.message, { kind: 'error' }); el.removeAttribute('aria-disabled'); return; }
    setTimeout(() => el.removeAttribute('aria-disabled'), 15000);
  },
  tWallet: (el) => {
    const it = itemById(el.dataset.id); if (!it) return;
    walletProviderModal(async provider => {
      try {
        const p = await api.get(`/api/v2/wallet/tickets/${encodeURIComponent(it.id)}/pass?provider=${provider}`);
        await handlePassResponse(p);
      } catch (e) { ui.toast(COPY.wallet.walletGate); }
    });
  },
  tReceipt: (el) => {
    const it = itemById(el.dataset.id); if (!it) return;
    authedDownload(`/api/v2/wallet/receipts/${encodeURIComponent(it.id)}.pdf`, `medx-receipt.pdf`)
      .catch(e => ui.toast(e.message, { kind: 'error' }));
  },
  tConfirm: (el) => {
    const it = itemById(el.dataset.id); if (!it) return;
    authedDownload(`/api/v2/wallet/confirmations/${encodeURIComponent(it.id)}.pdf`, `medx-confirmation.pdf`)
      .catch(e => ui.toast(e.message, { kind: 'error' }));
  },
  certDl: (el) => {
    authedDownload(`/api/v2/wallet/certificates/${encodeURIComponent(el.dataset.id)}.pdf`, `medx-certificate-${el.dataset.num || 'attendance'}.pdf`)
      .catch(e => ui.toast(e.message, { kind: 'error' }));
  },
  certVerify: (el) => { window.open(api.url('/verify-certificate?n=' + encodeURIComponent(el.dataset.num || '')), '_blank', 'noopener'); },
  certCopy: async (el) => {
    const url = api.url('/verify-certificate?n=' + encodeURIComponent(el.dataset.num || ''));
    try { await navigator.clipboard.writeText(url); ui.toast(COPY.certs.copied); }
    catch (e) {
      const ta = document.createElement('textarea'); ta.value = url; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); ui.toast(COPY.certs.copied); } catch (e2) { ui.toast(url); }
      ta.remove();
    }
  }
};

// ---------------------------------------------------------------- member card: tilt on hover
// A mouse over the card tips it a few degrees toward the pointer, and it eases home when the pointer
// leaves (css .mx-me-tilt reads --rx/--ry). One gesture only. Mouse only, hover-capable pointers only,
// never under reduced motion; the flip keeps its own transform on the card itself.
function wireCardTilt(root) {
  const tilt = root.querySelector('.mx-me-tilt');
  const card = root.querySelector('.mx-me-card');
  if (!tilt || !card || !window.matchMedia) return;
  const mq = window.matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)');
  let raf = 0, px = 0, py = 0;
  const apply = () => {
    raf = 0;
    // the card's UNtransformed box (offset geometry through the wrapper), so the tilt never feeds back into itself
    const host = tilt.offsetParent, r = host ? host.getBoundingClientRect() : { left: 0, top: 0 };
    const w = card.offsetWidth || 1, h = card.offsetHeight || 1;
    const x = Math.min(1, Math.max(0, (px - r.left - tilt.offsetLeft - card.offsetLeft) / w));
    const y = Math.min(1, Math.max(0, (py - r.top - tilt.offsetTop - card.offsetTop) / h));
    tilt.style.setProperty('--ry', ((x - .5) * 6).toFixed(2) + 'deg');
    tilt.style.setProperty('--rx', ((.5 - y) * 5).toFixed(2) + 'deg');
  };
  card.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse' || !mq.matches) return;
    px = e.clientX; py = e.clientY;
    tilt.classList.add('is-live');
    if (!raf) raf = requestAnimationFrame(apply);
  });
  card.addEventListener('pointerleave', () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    tilt.classList.remove('is-live');
    tilt.style.setProperty('--rx', '0deg'); tilt.style.setProperty('--ry', '0deg');
  });
}

// ---------------------------------------------------------------- QR blob (Bearer-auth image)
async function loadMemberQr() {
  try {
    const res = await fetch(api.url('/api/v2/wallet/member-qr.png'), { headers: session.token ? { Authorization: 'Bearer ' + session.token } : {} });
    if (!res.ok) return;
    const blob = await res.blob();
    if (qrObjectUrl) URL.revokeObjectURL(qrObjectUrl);
    qrObjectUrl = URL.createObjectURL(blob);
    st.qrUrl = qrObjectUrl;
    repaintCard();
  } catch (e) { /* the striped placeholder stays */ }
}

export default {
  title: 'My Med&X',
  async render(root, ctx) {
    ensureCss();
    rootEl = root;
    const tab = (ctx.params && ctx.params.tab) || '';
    // /app/me/rewards is gone with the points economy — a bookmarked URL lands on the wallet (no dead route)
    const view = tab === 'certificates' ? 'certificates' : 'wallet';
    D = await load(view === 'certificates' ? 'certificates' : '');
    if (rootEl !== root || (ctx.ready && !(await ctx.ready()))) return; // navigated away while loading, or the router moved on
    st = {
      view, tab: ctx.query && ctx.query.qa === 'past' ? 'past' : 'cur',
      cardBack: !!(ctx.query && (ctx.query.open === 'qr' || ctx.query.view === 'ticket')),
      qrUrl: null
    };
    root.innerHTML = template();
    unbind = ui.bind(root, handlers);
    if (view === 'wallet') {
      wireCardTilt(root);
      loadMemberQr();
      if (st.cardBack) {
        const card = root.querySelector('[data-block="card"]');
        if (card) setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150);
      }
    }
    chrome.refresh();
  },
  destroy() {
    if (unbind) unbind(); unbind = null;
    if (qrObjectUrl) { URL.revokeObjectURL(qrObjectUrl); qrObjectUrl = null; }
    rootEl = null; D = null; st = null;
  }
};
