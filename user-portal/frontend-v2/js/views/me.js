// Source: My MedX.dc.html
// Blocks (artboard order): "MY MED&X · MEMBERSHIP, TICKETS & RECORD" (intro + member card panel) ›
// "REWARDS" band › "01 · MY WALLET" (CURRENT TICKETS / PAST PURCHASES) › "02 · MY RECORD"
// (EVENTS · CERTIFICATES · BADGES) › "03 · SETTINGS" › help band. Wallet empty state from
// Empty States.dc.html › "MY WALLET · NO TICKETS YET". Ticket-card vocabulary: Emails.dc.html.
// Tabs: /app/me (wallet) · /app/me/certificates · /app/me/rewards (OPEN REWARDS →) — the two
// sub-tabs have no artboard of their own and reuse this screen's vocabulary (v2-marked).
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
  rewards: {
    tag: 'REWARDS', line: n => `<strong style="color:#191512">${fmt.num(n)} point${Number(n) === 1 ? '' : 's'}</strong> · earn at every event and connection, redeem for seats and perks.`,
    open: 'OPEN REWARDS →', back: '← BACK TO MY MED&X',
    quiet: 'Rewards are not part of your membership view — your record and tickets live in My Med&X.',
    earnTitle: 'HOW POINTS ARE EARNED', redeemTitle: 'REDEEM FOR EVENT CREDIT', codesTitle: 'MY CODES', ledgerTitle: 'ACTIVITY',
    earn: [['Event payments', '+1 point per €1'], ['Event check-in', '+100'], ['Profile completed', '+50'], ['Email confirmed', '+25']],
    balance: 'POINTS BALANCE', lifetime: 'LIFETIME POINTS', minNote: m => `Coupons apply to purchases of €${m} or more.`,
    redeem: 'REDEEM', locked: n => `${fmt.num(n)} MORE`, redeemQ: (p, e) => `Redeem ${fmt.num(p)} points for a €${e} coupon?`,
    redeemBody: 'You get a one-time code to paste into checkout. Points leave your balance right away.',
    coupon: e => `Your €${e} coupon is ready.`, copy: 'COPY CODE', copied: 'Code copied — paste it at checkout.',
    noCodes: 'No codes yet — redeem a tier above and it appears here.', noActivity: 'No activity yet — points arrive with payments, check-ins and your profile.',
    more: 'SHOW MORE', showLess: 'SHOW LESS',
    reasons: { payment: 'Event payment', checkin: 'Event check-in', profile: 'Profile completed', verify: 'Email confirmed', admin_adjust: 'Adjustment', redeem: 'Coupon redeemed' }
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
  settings: {
    n: '03', title: 'SETTINGS',
    name: 'NAME', email: 'EMAIL', password: 'PASSWORD', language: 'LANGUAGE', follow: 'PROJECTS I FOLLOW', interests: 'MY INTERESTS',
    change: 'CHANGE →', switch: 'SWITCH →', add: '+ ADD', unconfirmed: 'UNCONFIRMED', resend: 'RESEND LINK',
    resent: 'Link sent — check your inbox (and spam).',
    nameSaved: 'Name updated.', pwSaved: 'Password changed.', langSaved: 'Saved — English for now; Hrvatski arrives with the translations.',
    emailTitle: 'Change your email',
    emailBody: 'Your email links every ticket, receipt and certificate to you, so changes go through the team — message us and we move everything over safely.',
    emailCta: 'MESSAGE US →', emailToast: 'Email changes go through the team — message us and we handle it.',
    followed: 'Following updated.', interestsSaved: 'Interests updated.',
    pwMismatch: 'The passwords do not match.', pwShort: 'At least 8 characters.',
    projects: { plexus: 'Plexus Conference', gala: 'Gala Evening', accelerator: 'The Accelerator', forum: 'Biomedical Forum', bridges: 'Building Bridges' },
    suggestions: ['Neuroscience', 'Sleep Medicine', 'Oncology', 'Public Health', 'Biotech', 'AI in Medicine', 'Mental Health', 'Genetics']
  },
  help: {
    line: "Don't see something, or something looks wrong?",
    sub: "Message us — you're signed in, so replies land right here in your portal inbox.",
    cta: 'MESSAGE US →'
  },
  err: { load: 'Could not reach the portal — showing what we have.', dl: 'Download failed — please try again.' }
};

const PROJECT_KEYS = ['plexus', 'gala', 'accelerator', 'forum', 'bridges'];

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
    rewards: api.get('/api/rewards/summary'),
    topics: api.get('/api/notify-topics'),
    net: api.get('/api/networking/profile'),
    locale: api.get('/api/me/locale'),
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
  let interests = (r.net && r.net.research_interests) || [];
  if (typeof interests === 'string') interests = interests.split(',').map(s => s.trim()).filter(Boolean);
  const certs = (r.record && r.record.certificates) || [];
  if (r.myCert && r.myCert.id && !certs.find(c => c.id === r.myCert.id)) {
    certs.unshift({ id: r.myCert.id, title: (r.myCert.conference_name ? r.myCert.conference_name + ' — Certificate of Attendance' : 'Certificate of Attendance'), number: r.myCert.certificate_number, issue_date: r.myCert.issue_date, type: r.myCert.certificate_type || 'attendance' });
  }
  return {
    me, meta: r.meta || {}, member: r.member, items, upcoming, purchases,
    record: r.record || { events: [], certificates: [], badges: [] }, certs,
    rewards: r.rewards, topics: (r.topics && r.topics.projects) || [], net: r.net || null,
    interests, locale: (r.locale && r.locale.locale) || 'en',
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
function blockRewardsBand() {
  if (D.quiet) return '<!-- dc: My MedX.dc.html › "REWARDS" --><!-- hidden for quiet profiles (server-flagged) --><!-- /dc -->';
  const bal = D.rewards ? Number(D.rewards.balance || 0) : 0;
  return `
  <!-- dc: My MedX.dc.html › "REWARDS" -->
  <div style="border-bottom:1px solid rgba(25,21,18,.16)">
    <div class="mx-gutter mx-wrap-row" style="padding:13px 36px;display:flex;align-items:center;gap:16px;flex-wrap:wrap">
      <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#c9a962">${COPY.rewards.tag}</span>
      <span style="font-size:12.5px;color:#4a4239">${COPY.rewards.line(bal)}</span>
      <div style="flex:1"></div>
      <a href="/app/me/rewards" style="font:600 9.5px Inter,sans-serif;letter-spacing:.15em;color:#9b1b22;cursor:pointer;white-space:nowrap">${COPY.rewards.open}</a>
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
function blockRecord() {
  const R = COPY.record;
  const evs = (D.record.events || []);
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
  const attCards = att && (att.cards || att.items || (Array.isArray(att) ? att : null));
  const attBlock = attCards && attCards.length ? `
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
function chipRow(list, rmAct, addAct) {
  return `${list.map(v => `<span style="padding:5px 10px;border:1px solid rgba(25,21,18,.22);font-size:12px;white-space:nowrap">${esc(v.label)} <span data-act="${rmAct}" data-key="${esc(v.key)}" role="button" aria-label="Remove ${esc(v.label)}" style="cursor:pointer;color:#9b1b22">×</span></span>`).join('')}
        <span data-act="${addAct}" style="padding:5px 10px;border:1px dashed rgba(25,21,18,.35);font:600 9.5px Inter,sans-serif;letter-spacing:.14em;color:#9b1b22;cursor:pointer;white-space:nowrap">${COPY.settings.add}</span>`;
}
function blockSettings() {
  const S = COPY.settings;
  const emailOk = session.emailConfirmed();
  const follows = (D.topics || []).map(k => ({ key: k, label: S.projects[k] || k }));
  const interests = (D.interests || []).map(k => ({ key: k, label: k }));
  const row = (label, valueHtml, act, actLabel) => `
  <div class="mx-me-row" style="display:flex;gap:16px;align-items:center;padding:12px 0;border-bottom:1px solid rgba(25,21,18,.12)">
    <span class="mx-me-label" style="font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#4a4239;width:120px;flex:none">${label}</span>
    <span style="font-size:13.5px;flex:1;min-width:0">${valueHtml}</span>
    ${act ? `<span data-act="${act}" style="font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#9b1b22;cursor:pointer;white-space:nowrap">${actLabel}</span>` : ''}
  </div>`;
  return `
  <!-- dc: My MedX.dc.html › "03 · SETTINGS" -->
  <div data-block="settings">
  <div style="display:flex;align-items:baseline;gap:14px;border-top:1px solid rgba(25,21,18,.16);padding:24px 0 6px">
    <span style="font-family:Fraunces,serif;font-weight:600;font-size:14px;color:#9b1b22">${S.n}</span>
    <span style="font:600 14px Inter,sans-serif;letter-spacing:.14em">${S.title}</span>
  </div>
  ${row(S.name, esc([D.me.first_name, D.me.last_name].filter(Boolean).join(' ') || session.displayName()), 'chgName', S.change)}
  ${row(S.email, `${esc(D.me.email || '')}${emailOk ? '' : ` <span style="padding:2px 6px;margin-left:6px;border:1px solid rgba(155,27,34,.45);color:#9b1b22;font:600 8.5px Inter,sans-serif;letter-spacing:.14em">${S.unconfirmed}</span> <span data-act="resend" data-v2="RESEND LINK — wiring-map addition for unconfirmed accounts" style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:#9b1b22;cursor:pointer;white-space:nowrap">${S.resend}</span>`}`, 'chgEmail', S.change)}
  ${row(S.password, '••••••••', 'chgPw', S.change)}
  ${row(S.language, D.locale === 'hr' ? '<span style="font-weight:600">Hrvatski</span> · English' : '<span style="font-weight:600">English</span> · Hrvatski', 'chgLang', S.switch)}
  ${row(S.follow, `<span style="display:flex;gap:8px;flex-wrap:wrap">${chipRow(follows, 'followRm', 'followAdd')}</span>`)}
  <div class="mx-me-row" style="display:flex;gap:16px;align-items:center;padding:12px 0 26px">
    <span class="mx-me-label" style="font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#4a4239;width:120px;flex:none">${S.interests}</span>
    <span style="font-size:13.5px;flex:1;display:flex;gap:8px;flex-wrap:wrap;min-width:0">${chipRow(interests, 'intRm', 'intAdd')}</span>
  </div>
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

// ---------------------------------------------------------------- sub-tab: rewards
function rewardsTab() {
  const R = COPY.rewards;
  if (D.quiet) return `
  <!-- v2: rewards tab — OPEN REWARDS target (quiet profiles get the dignified note) -->
  <div class="mx-pad-hero" style="padding:54px 36px 46px;display:flex;flex-direction:column;align-items:center;text-align:center">
    <span style="width:28px;height:1px;background:#c9a962;margin-bottom:14px"></span>
    <div class="mx-display-30" style="font-family:Fraunces,serif;font-size:30px;line-height:1.15;max-width:640px">Your membership speaks for <i style="color:#9b1b22">itself</i>.</div>
    <div style="font-size:14px;line-height:1.6;color:#4a4239;max-width:460px;margin-top:12px">${R.quiet.replace(/&/g, '&amp;')}</div>
    <a href="/app/me" style="margin-top:22px;padding:12px 20px;border:1px solid rgba(25,21,18,.35);font:600 10.5px Inter,sans-serif;letter-spacing:.16em;color:#191512;white-space:nowrap" data-hover="border-color:#191512">${R.back.replace(/&/g, '&amp;')}</a>
  </div>`;
  const rw = D.rewards || { balance: 0, lifetime_points: 0, tiers: [], ledger: [], redemptions: [], min_purchase: 50 };
  const tiers = (rw.tiers || []).map(t => {
    const afford = Number(rw.balance || 0) >= t.points;
    return `
      <div style="border:1px solid rgba(25,21,18,.16);background:#fdfaf3;padding:18px;display:flex;flex-direction:column;gap:6px;align-items:flex-start">
        <span style="font-family:Fraunces,serif;font-size:26px">${fmt.eur(t.euros)}</span>
        <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.14em;color:#4a4239">${fmt.num(t.points)} POINTS</span>
        ${afford
        ? `<span data-act="redeem" data-points="${t.points}" data-euros="${t.euros}" style="margin-top:6px;padding:9px 16px;background:#9b1b22;color:#f7f1e6;font:600 9.5px Inter,sans-serif;letter-spacing:.15em;cursor:pointer;white-space:nowrap" data-hover="background:#7e151b">${R.redeem}</span>`
        : `<span aria-disabled="true" style="margin-top:6px;padding:9px 16px;border:1px solid rgba(25,21,18,.25);color:#4a4239;font:600 9.5px Inter,sans-serif;letter-spacing:.15em;white-space:nowrap;opacity:.6">${R.locked(t.points - Number(rw.balance || 0))}</span>`}
      </div>`;
  }).join('');
  const codes = (rw.redemptions || []);
  const codesHtml = codes.length ? codes.map(c => `
      <div class="mx-me-row" style="display:flex;gap:14px;align-items:center;padding:11px 0;border-bottom:1px solid rgba(25,21,18,.12)">
        <span style="font:600 12px ui-monospace,Menlo,monospace;letter-spacing:.08em">${esc(c.coupon_code)}</span>
        <span style="font-size:12px;color:#4a4239">${fmt.eur(c.coupon_value_eur)}${c.expires_at && c.status === 'active' ? ' · until ' + esc(fmt.longRange(String(c.expires_at).slice(0, 10), null)) : ''}</span>
        <div style="flex:1"></div>
        <span style="padding:2px 8px;border:1px solid ${c.status === 'active' ? 'rgba(201,169,98,.65)' : 'rgba(25,21,18,.22)'};font:600 8.5px Inter,sans-serif;letter-spacing:.14em;color:${c.status === 'active' ? '#6e5626' : '#4a4239'}">${esc(fmt.upper(c.status))}</span>
        ${c.status === 'active' ? `<span data-act="copyCode" data-code="${esc(c.coupon_code)}" style="font:600 9.5px Inter,sans-serif;letter-spacing:.14em;color:#9b1b22;cursor:pointer;white-space:nowrap">${R.copy}</span>` : ''}
      </div>`).join('') : `<div style="font-size:12.5px;color:#4a4239;padding:8px 0 2px">${R.noCodes}</div>`;
  const ledger = (rw.ledger || []).slice(0, st.ledgerN);
  const ledgerHtml = ledger.length ? ledger.map(l => `
      <div style="display:flex;gap:14px;align-items:baseline;padding:9px 0;border-bottom:1px solid rgba(25,21,18,.1)">
        <span style="font:600 10px Inter,sans-serif;letter-spacing:.12em;color:#9b8f80;flex:none;width:52px">${esc(fmt.shortDate(l.created_at))}</span>
        <span style="font-size:13px;flex:1;min-width:0">${esc(l.note || R.reasons[l.reason] || l.reason)}</span>
        <span style="font-family:Fraunces,serif;font-size:15px;color:${Number(l.delta) >= 0 ? '#6e5626' : '#9b1b22'}">${Number(l.delta) >= 0 ? '+' : ''}${fmt.num(l.delta)}</span>
      </div>`).join('') : `<div style="font-size:12.5px;color:#4a4239;padding:8px 0 2px">${R.noActivity}</div>`;
  return `
  <!-- v2: rewards tab — OPEN REWARDS → rewards summary + points ledger (/api/rewards/*) -->
  <div style="padding:42px 36px 26px;border-bottom:1px solid rgba(25,21,18,.16)" class="mx-gutter">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
      <span style="width:28px;height:1px;background:#c9a962"></span>
      <span style="font:600 11px Inter,sans-serif;letter-spacing:.18em;color:#9b1b22">MY MED&amp;X · REWARDS</span>
    </div>
    <div class="mx-wrap-row" style="display:flex;gap:44px;align-items:baseline;flex-wrap:wrap">
      <span><span class="mx-display-46" style="font-family:Fraunces,serif;font-size:44px;line-height:1.05;display:block">${fmt.num(rw.balance)}</span><span style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#4a4239">${R.balance}</span></span>
      <span><span style="font-family:Fraunces,serif;font-size:28px;line-height:1.05;display:block;color:#4a4239">${fmt.num(rw.lifetime_points)}</span><span style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#4a4239">${R.lifetime}</span></span>
      <div style="flex:1"></div>
      <a href="/app/me" style="font:600 10px Inter,sans-serif;letter-spacing:.16em;white-space:nowrap">${R.back.replace(/&/g, '&amp;')}</a>
    </div>
    <div style="font-size:12.5px;color:#4a4239;margin-top:12px">${R.minNote(rw.min_purchase || 50)}</div>
  </div>
  <div class="mx-gutter" style="padding:20px 36px 34px">
    <div class="mx-grid-2" style="display:grid;grid-template-columns:1fr 1fr;gap:34px;align-items:start">
      <div>
        <div style="font:600 11px Inter,sans-serif;letter-spacing:.15em;color:#6e5626;padding-bottom:6px">${R.earnTitle}</div>
        ${R.earn.map(([a, b]) => `<div style="display:flex;gap:14px;align-items:baseline;padding:9px 0;border-bottom:1px solid rgba(25,21,18,.1)"><span style="font-size:13px;flex:1">${a}</span><span style="font:600 10px Inter,sans-serif;letter-spacing:.12em;color:#6e5626">${b}</span></div>`).join('')}
        <div style="font:600 11px Inter,sans-serif;letter-spacing:.15em;color:#6e5626;padding:22px 0 6px">${R.codesTitle}</div>
        <div data-block="codes">${codesHtml}</div>
      </div>
      <div>
        <div style="font:600 11px Inter,sans-serif;letter-spacing:.15em;color:#6e5626;padding-bottom:10px">${R.redeemTitle}</div>
        <div class="mx-grid-3" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">${tiers}</div>
        <div style="font:600 11px Inter,sans-serif;letter-spacing:.15em;color:#6e5626;padding:22px 0 4px">${R.ledgerTitle}</div>
        <div data-block="ledger">${ledgerHtml}</div>
        ${(rw.ledger || []).length > st.ledgerN ? `<span data-act="moreLedger" style="display:inline-block;margin-top:10px;font:600 9.5px Inter,sans-serif;letter-spacing:.15em;color:#9b1b22;cursor:pointer">${R.more}</span>` : ''}
      </div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------- template
function template() {
  if (st.view === 'certificates') return `
<div data-screen-label="My Med&X" style="font-family:Inter,sans-serif;color:#191512;background:#f7f1e6;min-height:100vh">${certificatesTab()}</div>`;
  if (st.view === 'rewards') return `
<div data-screen-label="My Med&X" style="font-family:Inter,sans-serif;color:#191512;background:#f7f1e6;min-height:100vh">${rewardsTab()}</div>`;
  return `
<div data-screen-label="My Med&X" style="font-family:Inter,sans-serif;color:#191512;background:#f7f1e6;min-height:100vh">
  ${blockHero()}
  ${blockRewardsBand()}
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

// ---------------------------------------------------------------- modals (settings)
function inputRow(label, name, type, value, ph) {
  return `<label style="display:block;margin-top:12px"><span class="label" style="display:block;font:600 10px Inter,sans-serif;letter-spacing:.14em;color:#4a4239;margin-bottom:5px">${label}</span>
    <input name="${name}" type="${type || 'text'}" value="${esc(value || '')}" placeholder="${esc(ph || '')}" autocomplete="off" style="border:1px solid rgba(25,21,18,.25);background:#fdfaf3;padding:11px 12px;font:13px Inter,sans-serif;color:#191512;width:100%;box-sizing:border-box"></label>`;
}
function openNameModal() {
  const m = ui.modal({
    eyebrow: 'SETTINGS · NAME', title: 'Change your name',
    body: `${inputRow('FIRST NAME', 'first', 'text', D.me.first_name)}${inputRow('LAST NAME', 'last', 'text', D.me.last_name)}<p data-role="error" style="color:#9b1b22;font-size:12px;min-height:14px;margin:8px 0 0"></p>`,
    actions: [{ label: 'CANCEL' }, {
      label: 'SAVE', kind: 'primary', onClick: () => {
        const first = m.el.querySelector('[name=first]').value.trim();
        const last = m.el.querySelector('[name=last]').value.trim();
        if (!first) { m.el.querySelector('[data-role=error]').textContent = 'A first name is required.'; return false; }
        // PUT /api/auth/profile overwrites every field — send the current values back with the new name
        api.put('/api/auth/profile', {
          first_name: first, last_name: last, phone: D.me.phone || null, institution: D.me.institution || null,
          country: D.me.country || null, bio: D.me.bio || null, is_public_profile: D.me.is_public_profile ? 1 : 0
        }).then(() => {
          D.me.first_name = first; D.me.last_name = last;
          session.update({ first_name: first, last_name: last });
          ui.toast(COPY.settings.nameSaved);
          rerender('[data-block="settings"]', blockSettings());
        }).catch(e => ui.toast(e.message, { kind: 'error' }));
      }
    }]
  });
}
function openEmailModal() {
  ui.modal({
    eyebrow: 'SETTINGS · EMAIL', title: COPY.settings.emailTitle,
    body: `<p>${COPY.settings.emailBody.replace(/&/g, '&amp;')}</p>`,
    actions: [{ label: 'CLOSE' }, { label: COPY.settings.emailCta, kind: 'primary', onClick: () => router.navigate('/app/messages') }]
  });
  ui.toast(COPY.settings.emailToast);
}
function openPasswordModal() {
  const m = ui.modal({
    eyebrow: 'SETTINGS · PASSWORD', title: 'Change your password',
    body: `${inputRow('CURRENT PASSWORD', 'cur', 'password')}${inputRow('NEW PASSWORD', 'nw', 'password', '', 'At least 8 characters')}${inputRow('REPEAT NEW PASSWORD', 'nw2', 'password')}<p data-role="error" style="color:#9b1b22;font-size:12px;min-height:14px;margin:8px 0 0"></p>`,
    actions: [{ label: 'CANCEL' }, {
      label: 'SAVE', kind: 'primary', onClick: () => {
        const cur = m.el.querySelector('[name=cur]').value, nw = m.el.querySelector('[name=nw]').value, nw2 = m.el.querySelector('[name=nw2]').value;
        const err = m.el.querySelector('[data-role=error]');
        if (nw.length < 8) { err.textContent = COPY.settings.pwShort; return false; }
        if (nw !== nw2) { err.textContent = COPY.settings.pwMismatch; return false; }
        // keepSession: a 401 here means "wrong current password", not an expired token
        api.post('/api/auth/change-password', { currentPassword: cur, newPassword: nw }, { keepSession: true })
          .then(() => { ui.toast(COPY.settings.pwSaved); m.close(); })
          .catch(e => { err.textContent = e.message; });
        return false;
      }
    }]
  });
}
function openLanguageModal() {
  const m = ui.modal({
    eyebrow: 'SETTINGS · LANGUAGE', title: 'Portal language',
    body: `<p>English is the portal language for now — Hrvatski switches on with the translations. Your choice is remembered.</p>
      <div style="display:flex;gap:8px;margin-top:12px">
        <span data-lang="en" role="radio" aria-checked="${D.locale !== 'hr'}" style="padding:9px 18px;border:1px solid rgba(25,21,18,.3);font:600 10px Inter,sans-serif;letter-spacing:.15em;cursor:pointer;background:${D.locale !== 'hr' ? '#191512' : 'transparent'};color:${D.locale !== 'hr' ? '#f7f1e6' : '#4a4239'}">ENGLISH</span>
        <span data-lang="hr" role="radio" aria-checked="${D.locale === 'hr'}" style="padding:9px 18px;border:1px solid rgba(25,21,18,.3);border-left:none;font:600 10px Inter,sans-serif;letter-spacing:.15em;cursor:pointer;background:${D.locale === 'hr' ? '#191512' : 'transparent'};color:${D.locale === 'hr' ? '#f7f1e6' : '#4a4239'}">HRVATSKI</span>
      </div>`,
    actions: [{ label: 'DONE', kind: 'primary' }]
  });
  m.el.querySelectorAll('[data-lang]').forEach(el => {
    el.setAttribute('tabindex', '0');
    el.addEventListener('click', async () => {
      const locale = el.dataset.lang;
      try {
        await api.patch('/api/me', { locale });
        D.locale = locale;
        ui.toast(COPY.settings.langSaved);
        m.close();
        rerender('[data-block="settings"]', blockSettings());
      } catch (e) { ui.toast(e.message, { kind: 'error' }); }
    });
  });
}
function openFollowModal() {
  const left = PROJECT_KEYS.filter(k => !(D.topics || []).includes(k));
  if (!left.length) return ui.toast('You already follow every project.');
  const m = ui.modal({
    eyebrow: 'SETTINGS · PROJECTS I FOLLOW', title: 'Follow a project',
    body: `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">${left.map(k => `<span data-follow="${k}" role="button" style="padding:7px 12px;border:1px solid rgba(25,21,18,.22);font-size:12.5px;cursor:pointer" data-hover="border-color:#9b1b22;color:#9b1b22">${esc(COPY.settings.projects[k])}</span>`).join('')}</div>`,
    actions: [{ label: 'DONE', kind: 'primary' }]
  });
  m.el.querySelectorAll('[data-follow]').forEach(el => {
    el.setAttribute('tabindex', '0');
    el.addEventListener('click', async () => {
      try {
        await api.post('/api/notify-topics', { project: el.dataset.follow, on: true });
        D.topics.push(el.dataset.follow);
        ui.toast(COPY.settings.followed); m.close();
        rerender('[data-block="settings"]', blockSettings());
        chrome.refresh();
      } catch (e) { ui.toast(e.message, { kind: 'error' }); }
    });
  });
}
async function saveInterests(next) {
  const p = D.net || {};
  // PUT /api/networking/profile overwrites every column — carry the existing values along
  await api.put('/api/networking/profile', {
    career_stage: p.career_stage || null, looking_for: p.looking_for || null,
    research_interests: next, working_on: p.working_on || null,
    timezone: p.timezone || 'Europe/Zagreb', meeting_format: p.meeting_format || 'video',
    open_to_coffee_chats: p.open_to_coffee_chats == null ? 1 : p.open_to_coffee_chats,
    coffeeMatchmaker: !!p.coffee_matchmaker_opt_in
  });
  D.interests = next;
  if (D.net) D.net.research_interests = next;
  ui.toast(COPY.settings.interestsSaved);
  rerender('[data-block="settings"]', blockSettings());
}
function openInterestsModal() {
  const left = COPY.settings.suggestions.filter(s => !(D.interests || []).some(i => i.toLowerCase() === s.toLowerCase()));
  const m = ui.modal({
    eyebrow: 'SETTINGS · MY INTERESTS', title: 'Add an interest',
    body: `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">${left.map(s => `<span data-int="${esc(s)}" role="button" style="padding:7px 12px;border:1px solid rgba(25,21,18,.22);font-size:12.5px;cursor:pointer" data-hover="border-color:#9b1b22;color:#9b1b22">${esc(s)}</span>`).join('') || '<span style="font-size:12.5px;color:#4a4239">All suggestions added — type your own below.</span>'}</div>
      ${inputRow('OR TYPE YOUR OWN', 'custom', 'text', '', 'e.g. Cardiology')}`,
    actions: [{ label: 'CANCEL' }, {
      label: 'ADD', kind: 'primary', onClick: () => {
        const v = m.el.querySelector('[name=custom]').value.trim();
        if (!v) return true;
        saveInterests((D.interests || []).concat([v])).catch(e => ui.toast(e.message, { kind: 'error' }));
      }
    }]
  });
  m.el.querySelectorAll('[data-int]').forEach(el => {
    el.setAttribute('tabindex', '0');
    el.addEventListener('click', () => { m.close(); saveInterests((D.interests || []).concat([el.dataset.int])).catch(e => ui.toast(e.message, { kind: 'error' })); });
  });
}
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
  chgName: openNameModal,
  chgEmail: openEmailModal,
  chgPw: openPasswordModal,
  chgLang: openLanguageModal,
  followAdd: openFollowModal,
  followRm: async (el) => {
    try {
      await api.post('/api/notify-topics', { project: el.dataset.key, on: false });
      D.topics = D.topics.filter(k => k !== el.dataset.key);
      ui.toast(COPY.settings.followed);
      rerender('[data-block="settings"]', blockSettings());
      chrome.refresh();
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  intAdd: openInterestsModal,
  intRm: (el) => saveInterests((D.interests || []).filter(i => i !== el.dataset.key)).catch(e => ui.toast(e.message, { kind: 'error' })),
  resend: async (el) => {
    const email = D.me.email; if (!email) return;
    el.setAttribute('aria-disabled', 'true');
    try { const r = await api.post('/api/auth/request-verification', { email }); ui.toast(r.message || COPY.settings.resent); if (r.devVerifyUrl) console.info('[dev] verification link:', r.devVerifyUrl); }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
    setTimeout(() => el.removeAttribute('aria-disabled'), 30000);
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
  },
  redeem: (el) => {
    const points = Number(el.dataset.points), euros = Number(el.dataset.euros);
    ui.confirm({ eyebrow: 'REWARDS · REDEEM', title: COPY.rewards.redeemQ(points, euros), body: `<p>${COPY.rewards.redeemBody}</p>`, ok: COPY.rewards.redeem, cancel: 'KEEP MY POINTS' })
      .then(ok => {
        if (!ok) return;
        api.post('/api/rewards/redeem', { tier: points }).then(r => {
          if (D.rewards) { D.rewards.balance = r.balance; D.rewards.redemptions = [{ coupon_code: r.coupon_code, coupon_value_eur: r.coupon_value_eur, status: 'active', expires_at: r.expires_at }].concat(D.rewards.redemptions || []); }
          if (rootEl) rootEl.innerHTML = template();
          ui.modal({
            eyebrow: 'REWARDS · YOUR CODE', title: COPY.rewards.coupon(r.coupon_value_eur),
            body: `<div style="font:600 16px ui-monospace,Menlo,monospace;letter-spacing:.1em;border:1px dashed rgba(25,21,18,.35);padding:14px;text-align:center;background:#fdfaf3">${esc(r.coupon_code)}</div><p style="margin-top:10px">Paste it into the checkout coupon field — valid on purchases of ${fmt.eur(r.min_purchase || 50)}+.</p>`,
            actions: [{ label: 'DONE' }, { label: COPY.rewards.copy, kind: 'primary', onClick: () => { try { navigator.clipboard.writeText(r.coupon_code); ui.toast(COPY.rewards.copied); } catch (e) { } } }]
          });
          chrome.refresh();
        }).catch(e => ui.toast(e.message, { kind: 'error' }));
      });
  },
  copyCode: async (el) => { try { await navigator.clipboard.writeText(el.dataset.code); ui.toast(COPY.rewards.copied); } catch (e) { ui.toast(el.dataset.code); } },
  moreLedger: () => { st.ledgerN += 24; rootEl.innerHTML = template(); }
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
    const view = tab === 'certificates' ? 'certificates' : tab === 'rewards' ? 'rewards' : 'wallet';
    D = await load(view === 'certificates' ? 'certificates' : '');
    if (rootEl !== root) return;
    st = {
      view, tab: ctx.query && ctx.query.qa === 'past' ? 'past' : 'cur',
      cardBack: !!(ctx.query && (ctx.query.open === 'qr' || ctx.query.view === 'ticket')),
      qrUrl: null, ledgerN: 12
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
