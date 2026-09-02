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
  title: first => `Your membership, <i>${esc(first)}</i>.`,
  lede: "Your member card and tickets — one QR admits you to everything you're registered for.",
  dlCard: 'DOWNLOAD CARD', addWallet: 'ADD TO PHONE WALLET',
  walletNote: 'Apple and Google Wallet supported · per-event tickets live below in <strong style="color:#191512">My wallet</strong>.',
  card: {
    label: 'MEMBER CARD · 2026', member: 'MEMBER', motto: 'Jedna karta, sva vrata.',
    mottoSub: 'One card, every door · tap to flip back', fast: 'FAST CHECK-IN AT MED&X EVENTS',
    present: 'PRESENT FULL SCREEN', presentHint: 'Show this code at the door'
  },
  wallet: {
    n: '01', title: 'MY WALLET', cur: 'CURRENT TICKETS', past: 'PAST PURCHASES',
    browse: 'BROWSE EVENTS →', download: 'DOWNLOAD', email: 'EMAIL', add: 'ADD TO WALLET', pay: 'COMPLETE PAYMENT →',
    emptyLine: 'Your wallet is ready for December.',
    emptyWhy: 'Plexus 2026 is free for members — register and your ticket lands here, QR and all.',
    emptyCta: 'REGISTER FOR PLEXUS →', emptyTag: 'MY WALLET · NO TICKETS YET', emptyPh: 'YOUR FIRST TICKET',
    pastEmptyLine: 'No purchases yet.', pastEmptyWhy: 'Receipts and confirmations collect here after you register — free entries get a confirmation, paid seats a receipt.',
    pastNote: 'Free registrations come with a confirmation rather than a receipt · certificates of attendance live under <strong style="color:#191512">My record</strong> below. Ask us anything about an order — ',
    contact: 'contact the team', receipt: 'RECEIPT →', confirmation: 'CONFIRMATION →',
    emailed: to => `Ticket sent to ${to} — check your inbox.`,
    walletGate: 'Phone wallets switch on once the wallet keys are configured.',
    status: {
      free: 'Free entry, confirmed', paidSeat: a => `${fmt.eur(a)}, seat reserved`, paid: a => `${fmt.eur(a)}, confirmed`,
      vip: 'Complimentary seat', pending: a => (a ? `${fmt.eur(a)} due — payment pending` : 'Payment pending'),
      waitlisted: 'On the waiting list', checkedIn: 'Checked in'
    },
    order: n => `Order ${n}`, paidTag: a => `${fmt.eur(a)} · PAID`, freeTag: 'FREE ENTRY', vipTag: 'VIP · COMPLIMENTARY'
  },
  record: {
    n: '02', title: 'MY RECORD', sub: 'Attendance and year-in-review cards arrive by email automatically when you register.',
    events: 'EVENTS', eventsEmpty: 'Your events appear here after you register. ', browseShort: 'Browse events',
    certs: 'CERTIFICATES', certsEmpty: 'Certificates appear here after events you attend — download any time.',
    certExample: 'Certificate of Attendance', open: 'OPEN CERTIFICATES →',
    badges: 'BADGES', badgesEmpty: 'Recognition you earn across Med&X events collects here.',
    example: 'EXAMPLE', attended: 'ATTENDED', confirmed: 'CONFIRMED', registered: 'REGISTERED',
    cards: 'ATTENDANCE CARDS'
  },
  certs: {
    eyebrow: 'MY MED&X · CERTIFICATES', title: 'Your <i>certificates</i>.',
    lede: 'Every certificate carries a public verification link — share it anywhere, it proves itself.',
    download: 'DOWNLOAD PDF', verify: 'VERIFY LINK', copy: 'COPY LINK', copied: 'Verification link copied.',
    emptyLine: 'No certificates yet.', emptyWhy: 'Attend an event and your certificate of attendance appears here, ready to download and verify.',
    emptyCta: 'BROWSE EVENTS →', back: '← BACK TO MY MED&X', no: 'N°'
  },
  // UX audit 2026-09-02 › item 8: name, email, password and language were editable here AND on
  // Profile & settings, in two different UI systems, with no answer to "where do I change X".
  // Profile & settings is the single owner now — every control moved there — and My Med&X goes back
  // to what it is best at: the card, the wallet, the record.
  settings: {
    n: '03', title: 'SETTINGS',
    line: 'Account settings live in your <i>Profile &amp; settings</i>.',
    why: 'Your name, email, password, language, the projects you follow and your interests — all in one place.',
    cta: 'OPEN PROFILE &amp; SETTINGS →'
  },
  help: {
    line: "Don't see something, or something looks wrong?",
    sub: "Message us — you're signed in, so replies land right here in your portal inbox.",
    cta: 'MESSAGE US →'
  },
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
function shortRange(it) {
  const s = fmt.longRange(it.date, it.end_date);
  return s ? s.replace(/,\s*\d{4}$/, '') : '';
}
function walletProviderModal(onPick) {
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
function qrImgTag(size, role) {
  const src = st.qrUrl || '';
  const box = `width:${size}px;height:${size}px;background:#f7f1e6;padding:${size >= 100 ? 9 : 8}px;box-sizing:border-box`;
  const inner = src
    ? `<img data-role="${role}" src="${src}" alt="Member QR" style="width:100%;height:100%;display:block;image-rendering:pixelated">`
    : `<div data-role="${role}" style="width:100%;height:100%;border:1px dashed rgba(25,21,18,.4);display:flex;align-items:center;justify-content:center;font:600 10px ui-monospace,Menlo,monospace;color:#4a4239;background:repeating-linear-gradient(90deg,rgba(25,21,18,.08) 0 3px,transparent 3px 6px)">QR</div>`;
  return `<div style="${box};flex:none">${inner}</div>`;
}
function cardInner() {
  const m = D.member || {};
  const meta = D.meta || {};
  const first = (D.me.first_name || '').trim();
  const last = (D.me.last_name || '').trim();
  if (st.cardBack) return `
        <div style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:12px 0 8px;text-align:center">
          <div style="width:120px;height:120px;background:#f7f1e6;padding:9px;box-sizing:border-box">
            ${st.qrUrl ? `<img src="${st.qrUrl}" alt="Member QR" style="width:100%;height:100%;display:block;image-rendering:pixelated">` : `<div style="width:100%;height:100%;border:1px dashed rgba(25,21,18,.4);display:flex;align-items:center;justify-content:center;font:600 10px ui-monospace,Menlo,monospace;color:#4a4239;background:repeating-linear-gradient(90deg,rgba(25,21,18,.08) 0 3px,transparent 3px 6px)">QR</div>`}
          </div>
          <div style="font-family:Fraunces,serif;font-style:italic;font-size:19px;color:#c9a962">${COPY.card.motto}</div>
          <div style="font-size:11px;color:rgba(247,241,230,.55)">${COPY.card.mottoSub}</div>
          <span data-act="present" data-v2="present-mode — no artboard counterpart" style="font:600 8.5px Inter,sans-serif;letter-spacing:.18em;color:rgba(247,241,230,.6);cursor:pointer;white-space:nowrap" data-hover="color:#f7f1e6">${COPY.card.present}</span>
        </div>`;
  return `
        <div style="display:flex;align-items:center">
          <img src="/assets/logo-white.png" alt="med&amp;X" style="height:19px;display:block">
          <div style="flex:1"></div>
          <span style="font:600 9px Inter,sans-serif;letter-spacing:.22em;color:#c9a962">${COPY.card.label}</span>
        </div>
        <div style="width:34px;height:1px;background:#c9a962;margin:26px 0 14px"></div>
        <div style="display:flex;align-items:flex-end;gap:20px">
          <div style="flex:1;min-width:0">
            <div style="font:600 8.5px Inter,sans-serif;letter-spacing:.2em;color:rgba(247,241,230,.5)">${COPY.card.member}</div>
            <div style="font-family:Fraunces,serif;font-size:25px;margin-top:4px">${esc(first || session.displayName())}${last ? ' <i style="color:#c9a962">' + esc(last) + '</i>' : ''}</div>
            <div style="font-size:11.5px;color:rgba(247,241,230,.65);margin-top:5px">${esc(meta.member_type_label || m.type_label || 'Member')} · Member since ${esc(String(meta.member_since || m.since_year || FACTS.year).slice(0, 4))}</div>
            <span style="display:inline-block;margin-top:12px;padding:4px 9px;background:rgba(201,169,98,.16);color:#c9a962;font:600 8.5px Inter,sans-serif;letter-spacing:.16em">${esc(fmt.upper(meta.standing_label || m.standing_label || 'Member in good standing'))}</span>
          </div>
          ${qrImgTag(92, 'qr-front')}
        </div>
        <div style="display:flex;align-items:center;margin-top:18px;padding-top:12px;border-top:1px solid rgba(247,241,230,.14)">
          <span style="font:600 9px ui-monospace,Menlo,monospace;letter-spacing:.18em;color:rgba(247,241,230,.45)">N° ${esc(m.member_no || String(D.me.id || '').slice(0, 8).toUpperCase())}</span>
          <div style="flex:1"></div>
          <span style="font:600 8.5px Inter,sans-serif;letter-spacing:.2em;color:rgba(247,241,230,.45)">${COPY.card.fast}</span>
        </div>`;
}
function blockHero() {
  return `
  <!-- dc: My MedX.dc.html › "MY MED&X · MEMBERSHIP, TICKETS & RECORD" -->
  <div class="mx-grid-2 mx-me-hero" style="display:grid;grid-template-columns:1fr 1fr;align-items:stretch;border-bottom:1px solid rgba(25,21,18,.16)">
    <div class="mx-me-intro" style="padding:42px 48px 26px 36px;display:flex;flex-direction:column;justify-content:center">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
        <span style="width:28px;height:1px;background:#c9a962"></span>
        <span style="font:600 11px Inter,sans-serif;letter-spacing:.18em;color:#9b1b22">${COPY.eyebrow.replace(/&/g, '&amp;')}</span>
      </div>
      <div class="mx-display-46" style="font-family:Fraunces,serif;font-size:44px;line-height:1.08">${COPY.title((D.me.first_name || '').trim() || session.displayName())}</div>
      <div style="font-size:15px;line-height:1.6;color:#4a4239;max-width:440px;margin-top:14px">${COPY.lede}</div>
      <div style="display:flex;gap:12px;margin-top:24px;flex-wrap:wrap">
        <span data-act="dlCard" style="padding:12px 20px;background:#9b1b22;color:#f7f1e6;font:600 10.5px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;white-space:nowrap" data-hover="background:#7e151b">${COPY.dlCard}</span>
        <span data-act="cardWallet" style="padding:12px 20px;border:1px solid rgba(25,21,18,.35);font:600 10.5px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;white-space:nowrap" data-hover="border-color:#191512">${COPY.addWallet}</span>
      </div>
      <div style="font-size:12px;color:#4a4239;margin-top:16px;max-width:440px;line-height:1.55">${COPY.walletNote}</div>
    </div>
    <div class="mx-me-cardpanel" style="position:relative;display:flex;align-items:center;justify-content:center;padding:36px;overflow:hidden">
      <div style="position:absolute;inset:0;background-image:url('/assets/photo-candlelit.jpg');background-size:cover;background-position:center"></div>
      <div style="position:absolute;inset:0;background:rgba(25,21,18,.72)"></div>
      <div data-act="flip" data-block="card" role="button" aria-label="Member card — tap to flip" class="mx-me-card" style="position:relative;width:450px;background:linear-gradient(135deg,#221c17 0%,#191512 55%,#14100d 100%);color:#f7f1e6;padding:26px 28px;box-shadow:0 24px 60px rgba(0,0,0,.5);cursor:pointer;transition:transform .5s cubic-bezier(.22,1,.36,1);transform:perspective(1100px) rotateY(${st.cardBack ? '360deg' : '0deg'})">
        <div style="position:absolute;inset:9px;border:1px solid rgba(201,169,98,.55);pointer-events:none"></div>
        <div style="position:absolute;inset:12px;border:1px solid rgba(201,169,98,.2);pointer-events:none"></div>
        ${cardInner()}
      </div>
    </div>
  </div>
  <!-- /dc -->`;
}
function ticketCard(it) {
  const gala = it.kind === 'gala';
  const wrapBorder = gala ? 'border:1px solid rgba(201,169,98,.55)' : 'border:1px solid rgba(25,21,18,.16)';
  const qr = it.ticket
    ? `<div style="width:44px;height:44px;flex:none;background:#fff;border:1px solid rgba(25,21,18,.16);padding:2px;box-sizing:border-box"><img src="${esc(api.url(it.ticket))}" alt="Ticket QR" style="width:100%;height:100%;display:block;object-fit:contain"></div>`
    : `<div style="width:44px;height:44px;flex:none;border:1px dashed rgba(25,21,18,.4);display:flex;align-items:center;justify-content:center;font:600 8px ui-monospace,Menlo,monospace;color:#4a4239;background:repeating-linear-gradient(90deg,rgba(25,21,18,.08) 0 3px,#f7f1e6 3px 6px)">QR</div>`;
  const line = [shortRange(it), fmt.detail(String(it.venue || '').replace(/;\s*/g, ' · ')), statusLine(it)].filter(Boolean).join(' · ');
  const actions = it.pending && !it.paid
    ? `<a href="${it.kind === 'gala' ? '/app/gala' : '/app/plexus'}" style="color:#9b1b22;cursor:pointer;white-space:nowrap">${COPY.wallet.pay}</a>`
    : `<span data-act="tDl" data-id="${esc(it.id)}" style="color:#9b1b22;cursor:pointer;white-space:nowrap">${COPY.wallet.download}</span>
            <span data-act="tEmail" data-id="${esc(it.id)}" style="color:#9b1b22;cursor:pointer;white-space:nowrap">${COPY.wallet.email}</span>
            <span data-act="tWallet" data-id="${esc(it.id)}" style="color:#9b1b22;cursor:pointer;white-space:nowrap">${COPY.wallet.add}</span>`;
  return `
        <div style="display:flex;gap:16px;align-items:center;padding:15px 18px;${wrapBorder};background:#fdfaf3">
          ${qr}
          <span style="flex:1;min-width:0"><span style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap"><span style="font-family:Fraunces,serif;font-size:16.5px">${yearItalic(it.title, gala ? '#9b1b22' : '#191512')}</span>${it.checked_in ? `<span style="padding:2px 6px;border:1px solid rgba(201,169,98,.65);font:600 8.5px Inter,sans-serif;letter-spacing:.14em;color:#6e5626">${COPY.wallet.status.checkedIn.toUpperCase()}</span>` : ''}</span><span style="display:block;font-size:11.5px;color:#4a4239;margin-top:2px">${esc(fmt.dash(line))}</span><span style="display:flex;gap:14px;flex-wrap:wrap;font:600 9.5px Inter,sans-serif;letter-spacing:.14em;margin-top:7px">
            ${actions}
          </span></span>
        </div>`;
}
function walletCurrent() {
  if (!D.upcoming.length) return `
      <!-- dc: Empty States.dc.html › "MY WALLET · NO TICKETS YET" -->
      <div data-block="wallet-list" style="background:#f7f1e6;border:1px solid rgba(25,21,18,.16);margin-bottom:26px">
        <div style="padding:12px 22px;border-bottom:1px solid rgba(25,21,18,.16);font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#9b1b22">${COPY.wallet.emptyTag.replace(/&/g, '&amp;')}</div>
        <div style="padding:30px 22px 32px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:8px">
          <div style="width:150px;height:88px;border:1px dashed rgba(25,21,18,.3);background:repeating-linear-gradient(45deg,rgba(25,21,18,.05) 0 8px,transparent 8px 16px);display:flex;align-items:center;justify-content:center;font:600 8.5px ui-monospace,Menlo,monospace;color:#4a4239">${COPY.wallet.emptyPh}</div>
          <span style="font-family:Fraunces,serif;font-style:italic;font-size:17px;margin-top:8px">${COPY.wallet.emptyLine}</span>
          <span style="font-size:12.5px;color:#4a4239;max-width:380px;line-height:1.55">${COPY.wallet.emptyWhy}</span>
          <a href="/app/plexus" style="margin-top:8px;padding:11px 20px;background:#9b1b22;color:#f7f1e6;font:600 10px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;white-space:nowrap" data-hover="background:#7e151b;color:#f7f1e6">${COPY.wallet.emptyCta}</a>
        </div>
      </div>
      <!-- /dc -->`;
  return `
      <div data-block="wallet-list">
      <div class="mx-grid-2" style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        ${D.upcoming.map(ticketCard).join('')}
      </div>
      <div style="display:flex;gap:10px;align-items:baseline;padding:12px 0 26px">
        <span style="font-size:12px;color:#4a4239">One QR opens all doors — your member card admits you to everything you're registered for.</span>
        <a href="/app/plexus" style="font:600 9.5px Inter,sans-serif;letter-spacing:.14em">${COPY.wallet.browse}</a>
      </div>
      </div>`;
}
function walletPast() {
  if (!D.purchases.length) return `
      <div data-block="wallet-list" style="margin-bottom:26px">
        <div class="empty" style="padding:26px 0 18px">
          <span style="width:28px;height:1px;background:#c9a962;margin-bottom:6px"></span>
          <span style="font-family:Fraunces,serif;font-style:italic;font-size:17px">${COPY.wallet.pastEmptyLine}</span>
          <span style="font-size:12.5px;color:#4a4239;max-width:400px;line-height:1.55">${COPY.wallet.pastEmptyWhy}</span>
          <a href="/app/plexus" style="margin-top:8px;padding:11px 20px;border:1px solid rgba(25,21,18,.3);font:600 10px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;color:#191512;white-space:nowrap" data-hover="border-color:#191512">${COPY.wallet.browse}</a>
        </div>
      </div>`;
  const row = it => {
    const sub = it.kind === 'gala' ? 'one seat' : 'registration';
    const orderNo = it.invoice_number ? '#' + it.invoice_number : '#' + String(it.id).slice(0, 8).toUpperCase();
    const tag = it.status === 'vip' ? COPY.wallet.vipTag : (it.amount > 0 && it.paid ? COPY.wallet.paidTag(it.amount) : COPY.wallet.freeTag);
    const action = it.receipt === 'receipt'
      ? `<span data-act="tReceipt" data-id="${esc(it.id)}" style="font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#9b1b22;cursor:pointer;white-space:nowrap">${COPY.wallet.receipt}</span>`
      : `<span data-act="tConfirm" data-id="${esc(it.id)}" style="font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#9b1b22;cursor:pointer;white-space:nowrap">${COPY.wallet.confirmation}</span>`;
    return `
        <div class="mx-me-row" style="display:flex;gap:16px;align-items:center;padding:13px 0;border-bottom:1px solid rgba(25,21,18,.12)">
          <span style="flex:1"><span style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap"><span style="font-family:Fraunces,serif;font-size:17px">${yearItalic(it.title + ' — ' + sub, '#191512')}</span></span><span style="display:block;font-size:12px;color:#4a4239;margin-top:2px">${esc(COPY.wallet.order(orderNo))}${it.date ? ' · ' + esc(fmt.longRange(it.date, it.end_date)) : ''}</span></span>
          <span style="font:600 10px Inter,sans-serif;letter-spacing:.14em;color:#4a4239;white-space:nowrap">${esc(tag)}</span>
          ${action}
        </div>`;
  };
  return `
      <div data-block="wallet-list" style="margin-bottom:26px">
        ${D.purchases.map(row).join('')}
        <div style="font-size:12px;color:#4a4239;padding-top:10px">${COPY.wallet.pastNote}<a href="/app/messages" style="color:#9b1b22;cursor:pointer">${COPY.wallet.contact}</a>.</div>
      </div>`;
}
function blockWallet() {
  const cur = st.tab !== 'past';
  return `
  <!-- dc: My MedX.dc.html › "01 · MY WALLET" -->
  <div data-block="wallet">
    <div class="mx-wrap-row" style="display:flex;align-items:baseline;gap:14px;padding:24px 0 14px;flex-wrap:wrap">
      <span style="font-family:Fraunces,serif;font-weight:600;font-size:14px;color:#9b1b22">${COPY.wallet.n}</span>
      <span style="font:600 14px Inter,sans-serif;letter-spacing:.14em">${COPY.wallet.title}</span>
      <div style="display:flex;margin-left:14px">
        <span data-act="showCur" role="tab" aria-selected="${cur}" style="padding:8px 14px;font:600 9.5px Inter,sans-serif;letter-spacing:.15em;cursor:pointer;border:1px solid rgba(25,21,18,.3);background:${cur ? '#191512' : 'transparent'};color:${cur ? '#f7f1e6' : '#4a4239'};white-space:nowrap">${COPY.wallet.cur}</span>
        <span data-act="showPast" role="tab" aria-selected="${!cur}" style="padding:8px 14px;font:600 9.5px Inter,sans-serif;letter-spacing:.15em;cursor:pointer;border:1px solid rgba(25,21,18,.3);border-left:none;background:${cur ? 'transparent' : '#191512'};color:${cur ? '#4a4239' : '#f7f1e6'};white-space:nowrap">${COPY.wallet.past}</span>
      </div>
    </div>
    ${cur ? walletCurrent() : walletPast()}
  </div>
  <!-- /dc -->`;
}
// UX audit 2026-09-02 › item 15: MY RECORD listed the same "BUILDING BRIDGES — BOSTON" twice, for
// an evening that has not happened. One row per event — the richest one wins (an attended row
// outranks a merely registered one) — and an attendance card, which is a souvenir of having been
// there, waits until the member has actually been through the door.
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
  const eventsInner = evs.length ? evs.slice(0, 4).map(ev => {
    const chip = ev.attended ? R.attended : (ev.paid ? R.confirmed : R.registered);
    return `<span style="display:flex;gap:8px;align-items:baseline;justify-content:space-between"><span style="font-size:12.5px;color:#191512;line-height:1.45;min-width:0">${esc(ev.title)}<span style="color:#4a4239"> · ${esc(fmt.keyDateLabel(fmt.longRange(ev.start_date, ev.end_date) || ''))}</span></span><span style="padding:2px 6px;border:1px solid rgba(25,21,18,.22);font:600 8px Inter,sans-serif;letter-spacing:.13em;color:${ev.attended ? '#6e5626' : '#4a4239'};white-space:nowrap">${chip}</span></span>`;
  }).join('') + (evs.length > 4 ? `<span style="font-size:11.5px;color:#4a4239">+ ${evs.length - 4} more</span>` : '')
    : `<span style="font-size:12.5px;color:#4a4239;line-height:1.5">${R.eventsEmpty}<a href="/app/plexus">${R.browseShort}</a></span>`;
  const certs = D.certs || [];
  const certsInner = certs.length
    ? certs.slice(0, 2).map(c => `<span style="display:flex;gap:8px;align-items:baseline"><span style="font-family:Fraunces,serif;font-size:15px;min-width:0">${esc(c.title || R.certExample)}</span></span><span style="font-size:11.5px;color:#4a4239">${esc(c.number || '')}${c.issue_date ? ' · ' + esc(String(c.issue_date).slice(0, 4)) : ''}</span>`).join('')
      + `<a href="/app/me/certificates" style="font:600 9.5px Inter,sans-serif;letter-spacing:.14em;margin-top:4px">${R.open}</a>`
    : `<span style="display:flex;gap:8px;align-items:baseline"><span style="font-family:Fraunces,serif;font-size:15px">${R.certExample}</span><span style="padding:2px 6px;border:1px solid rgba(25,21,18,.22);font:600 8.5px Inter,sans-serif;letter-spacing:.14em;color:#4a4239">${R.example}</span></span>
        <span style="font-size:12px;color:#4a4239">${R.certsEmpty}</span>`;
  const badges = (D.record.badges || []);
  const badgesInner = badges.length
    ? `<span style="display:flex;gap:8px;flex-wrap:wrap">${badges.map(b => `<span style="padding:5px 10px;border:1px solid rgba(25,21,18,.22);font:600 9.5px Inter,sans-serif;letter-spacing:.13em">${esc(fmt.upper(b.name || 'BADGE'))}</span>`).join('')}</span>`
    : `<span style="display:flex;gap:8px;flex-wrap:wrap">
          <span style="padding:5px 10px;border:1px solid rgba(25,21,18,.22);font:600 9.5px Inter,sans-serif;letter-spacing:.13em">FIRST CONFERENCE</span>
          <span style="padding:5px 10px;border:1px solid rgba(25,21,18,.22);font:600 9.5px Inter,sans-serif;letter-spacing:.13em">PRESENTER</span>
          <span style="padding:5px 10px;border:1px solid rgba(25,21,18,.22);font:600 8.5px Inter,sans-serif;letter-spacing:.14em;color:#4a4239">${R.example}</span>
        </span>
        <span style="font-size:12px;color:#4a4239">${R.badgesEmpty.replace(/&/g, '&amp;')}</span>`;
  const att = D.attendance;
  const rawCards = (att && (att.cards || att.items || (Array.isArray(att) ? att : null))) || [];
  const attCards = visibleCards(rawCards);
  const attBlock = attCards.length ? `
    <div data-v2="attendance cards — GET /api/v2/attendance-cards/mine" style="border:1px solid rgba(25,21,18,.16);background:#fdfaf3;padding:18px;display:flex;flex-direction:column;gap:7px;grid-column:1/-1">
      <span style="font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#c9a962">${R.cards}</span>
      <span style="display:flex;gap:10px;flex-wrap:wrap">${attCards.map(c => { const href = c.download_url || c.image_url || c.url || ''; return `<a href="${esc(href ? api.url(href) : '#')}" ${href ? 'target="_blank" rel="noopener"' : ''} style="padding:5px 10px;border:1px solid rgba(25,21,18,.22);font:600 9.5px Inter,sans-serif;letter-spacing:.13em;white-space:nowrap">${esc(fmt.upper(c.event_name || c.title || c.label || c.event || 'CARD'))} ↓</a>`; }).join('')}</span>
    </div>` : `
    <!-- v2: attendance cards — GET /api/v2/attendance-cards/mine (separate builder); this block lights up under MY RECORD once the member has generated cards (endpoint absent or empty right now) -->`;
  return `
  <!-- dc: My MedX.dc.html › "02 · MY RECORD" -->
  <div class="mx-wrap-row" style="display:flex;align-items:baseline;gap:14px;border-top:1px solid rgba(25,21,18,.16);padding:24px 0 16px;flex-wrap:wrap">
    <span style="font-family:Fraunces,serif;font-weight:600;font-size:14px;color:#9b1b22">${R.n}</span>
    <span style="font:600 14px Inter,sans-serif;letter-spacing:.14em">${R.title}</span>
    <span style="font-size:12px;color:#4a4239;margin-left:10px">${R.sub}</span>
  </div>
  <div class="mx-grid-3" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;padding-bottom:28px">
    <div style="border:1px solid rgba(25,21,18,.16);background:#fdfaf3;padding:18px;display:flex;flex-direction:column;gap:7px">
      <span style="font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#c9a962">${R.events}</span>
      ${eventsInner}
    </div>
    <div style="border:1px solid rgba(25,21,18,.16);background:#fdfaf3;padding:18px;display:flex;flex-direction:column;gap:7px">
      <span style="font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#c9a962">${R.certs}</span>
      ${certsInner}
    </div>
    <div style="border:1px solid rgba(25,21,18,.16);background:#fdfaf3;padding:18px;display:flex;flex-direction:column;gap:7px">
      <span style="font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#c9a962">${R.badges}</span>
      ${badgesInner}
    </div>
    ${attBlock}
  </div>
  <!-- /dc -->`;
}
function blockSettings() {
  const S = COPY.settings;
  return `
  <!-- dc: My MedX.dc.html › "03 · SETTINGS" -->
  <div data-block="settings">
  <div style="display:flex;align-items:baseline;gap:14px;border-top:1px solid rgba(25,21,18,.16);padding:24px 0 6px">
    <span style="font-family:Fraunces,serif;font-weight:600;font-size:14px;color:#9b1b22">${S.n}</span>
    <span style="font:600 14px Inter,sans-serif;letter-spacing:.14em">${S.title}</span>
  </div>
  <a href="/app/profile" style="display:flex;align-items:center;gap:18px;border:1px solid rgba(25,21,18,.16);border-left:3px solid #c9a962;background:#fdfaf3;padding:18px 20px;margin:10px 0 26px;color:#191512;text-decoration:none;flex-wrap:wrap" data-hover="background:#f7efdf">
    <span style="flex:1;min-width:240px"><span style="display:block;font-family:Fraunces,serif;font-size:17px;line-height:1.3">${S.line}</span><span style="display:block;font-size:12.5px;color:#4a4239;margin-top:3px;line-height:1.5">${S.why}</span></span>
    <span style="font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#9b1b22;white-space:nowrap;flex:none">${S.cta}</span>
  </a>
  </div>
  <!-- /dc -->`;
}
function blockHelp() {
  return `
  <!-- dc: My MedX.dc.html › "Don't see something…" -->
  <div class="mx-wrap-row" style="display:flex;align-items:center;gap:20px;border-top:1px solid rgba(25,21,18,.16);padding:20px 0 32px;flex-wrap:wrap">
    <span style="font-family:Fraunces,serif;font-style:italic;font-size:16px;color:#4a4239">${COPY.help.line}</span>
    <span style="font-size:12px;color:#4a4239">${COPY.help.sub}</span>
    <div style="flex:1"></div>
    <a href="/app/messages" style="padding:10px 16px;background:#9b1b22;color:#f7f1e6;font:600 10px Inter,sans-serif;letter-spacing:.16em;white-space:nowrap" style-hover="background:#7e151b;color:#f7f1e6" data-hover="background:#7e151b;color:#f7f1e6">${COPY.help.cta}</a>
  </div>
  <!-- /dc -->`;
}

// ---------------------------------------------------------------- sub-tab: certificates
function certificatesTab() {
  const C = COPY.certs;
  const certs = D.certs || [];
  const rows = certs.map(c => `
    <div class="mx-me-row" style="display:flex;gap:16px;align-items:center;padding:14px 0;border-bottom:1px solid rgba(25,21,18,.12)">
      <span style="flex:1;min-width:0"><span style="font-family:Fraunces,serif;font-size:17px">${esc(c.title || 'Certificate of Attendance')}</span><span style="display:block;font-size:12px;color:#4a4239;margin-top:2px">${C.no} ${esc(c.number || '—')}${c.issue_date ? ' · ' + esc(fmt.longRange(c.issue_date, null)) : ''}</span></span>
      <span style="display:flex;gap:14px;flex-wrap:wrap;font:600 9.5px Inter,sans-serif;letter-spacing:.15em">
        <span data-act="certDl" data-id="${esc(c.id)}" data-num="${esc(c.number || '')}" style="color:#9b1b22;cursor:pointer;white-space:nowrap">${C.download}</span>
        <span data-act="certVerify" data-num="${esc(c.number || '')}" style="color:#9b1b22;cursor:pointer;white-space:nowrap">${C.verify}</span>
        <span data-act="certCopy" data-num="${esc(c.number || '')}" style="color:#9b1b22;cursor:pointer;white-space:nowrap">${C.copy}</span>
      </span>
    </div>`).join('');
  return `
  <!-- v2: certificates tab — drawer "Certificates" target; reuses this screen's vocabulary (no dedicated artboard) -->
  <div style="padding:42px 36px 26px;border-bottom:1px solid rgba(25,21,18,.16)" class="mx-gutter">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
      <span style="width:28px;height:1px;background:#c9a962"></span>
      <span style="font:600 11px Inter,sans-serif;letter-spacing:.18em;color:#9b1b22">${C.eyebrow.replace(/&/g, '&amp;')}</span>
    </div>
    <div class="mx-display-46" style="font-family:Fraunces,serif;font-size:44px;line-height:1.08">${C.title}</div>
    <div style="font-size:15px;line-height:1.6;color:#4a4239;max-width:520px;margin-top:14px">${C.lede}</div>
    <a href="/app/me" style="display:inline-block;margin-top:18px;font:600 10px Inter,sans-serif;letter-spacing:.16em">${C.back.replace(/&/g, '&amp;')}</a>
  </div>
  <div class="mx-gutter" style="padding:10px 36px 34px">
    ${certs.length ? rows : `
    <div class="empty" style="padding:34px 0 26px">
      <span style="width:28px;height:1px;background:#c9a962;margin-bottom:6px"></span>
      <span style="font-family:Fraunces,serif;font-style:italic;font-size:17px">${C.emptyLine}</span>
      <span style="font-size:12.5px;color:#4a4239;max-width:400px;line-height:1.55">${C.emptyWhy}</span>
      <a href="/app/plexus" style="margin-top:8px;padding:11px 20px;border:1px solid rgba(25,21,18,.3);font:600 10px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;color:#191512;white-space:nowrap" data-hover="border-color:#191512">${C.emptyCta}</a>
    </div>`}
  </div>`;
}

// ---------------------------------------------------------------- template
function template() {
  if (st.view === 'certificates') return `
<div data-screen-label="My Med&X" style="font-family:Inter,sans-serif;color:#191512;background:#f7f1e6;min-height:100vh">${certificatesTab()}</div>`;
  return `
<div data-screen-label="My Med&X" style="font-family:Inter,sans-serif;color:#191512;background:#f7f1e6;min-height:100vh">
  ${blockHero()}
  <div class="mx-gutter" style="padding:0 36px">
    ${blockWallet()}
    ${blockRecord()}
    ${blockSettings()}
    ${blockHelp()}
  </div>
</div>`;
}
function rerender(sel, html) { const el = rootEl && rootEl.querySelector(sel); if (el) el.outerHTML = html; }
function repaintCard() {
  const card = rootEl && rootEl.querySelector('[data-block="card"]');
  if (!card) return;
  card.style.transform = `perspective(1100px) rotateY(${st.cardBack ? '360deg' : '0deg'})`;
  card.innerHTML = `
        <div style="position:absolute;inset:9px;border:1px solid rgba(201,169,98,.55);pointer-events:none"></div>
        <div style="position:absolute;inset:12px;border:1px solid rgba(201,169,98,.2);pointer-events:none"></div>
        ${cardInner()}`;
}

// ---------------------------------------------------------------- modals
function openPresent() {
  if (!st.qrUrl) return ui.toast(COPY.err.dl, { kind: 'error' });
  const m = ui.modal({
    eyebrow: 'MEMBER QR', title: '',
    body: `<div style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:6px 0 2px">
      <div style="width:min(64vw,260px);height:min(64vw,260px);background:#fff;border:1px solid rgba(25,21,18,.16);padding:12px;box-sizing:border-box"><img src="${st.qrUrl}" alt="Member QR" style="width:100%;height:100%;display:block;image-rendering:pixelated"></div>
      <div style="font-family:Fraunces,serif;font-style:italic;font-size:17px;color:#191512">${COPY.card.motto}</div>
      <div style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#4a4239">${COPY.card.presentHint.toUpperCase()}</div>
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
  showCur: () => { if (st.tab !== 'cur') { st.tab = 'cur'; rerender('[data-block="wallet"]', blockWallet()); } },
  showPast: () => { if (st.tab !== 'past') { st.tab = 'past'; rerender('[data-block="wallet"]', blockWallet()); } },
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
    if (rootEl !== root) return;
    st = {
      view, tab: ctx.query && ctx.query.qa === 'past' ? 'past' : 'cur',
      cardBack: !!(ctx.query && (ctx.query.open === 'qr' || ctx.query.view === 'ticket')),
      qrUrl: null
    };
    root.innerHTML = template();
    unbind = ui.bind(root, handlers);
    if (view === 'wallet') {
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
