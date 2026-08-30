// Source: Admin Gala.dc.html
// Blocks (artboard order): "Title row" › "KPI strip" › "GUEST LIST" › "SEATING BOARD" ›
// "MEALS — KITCHEN COUNT" › "WAITLIST" › "THE NIGHT". The header is js/chrome.js.
// Data — every number is a live read (README note 6):
//   GET /api/admin/gala/registrations          the guest list (gala_registrations)
//   GET /api/admin/gala/settings               date/venue/schedule/prices (admin-edited)
//   GET /api/admin/gala/menu-options           the venue's dinner menu (meal buckets)
//   GET /api/admin/nag/items                   gala_unpaid rows → CHASE goes through the nag act
//   GET /api/v2/gala-ops/overview              tables + assignments + meal overrides + waitlist +
//                                              performers meta + room state + effective price
// Mutations: seat assign/unassign via the EXISTING /api/admin/gala/tables/:id/assign +
// /api/admin/gala/unassign; MARK PAID via the EXISTING /api/admin/registrant/gala/:id/mark-paid
// (FIRA on payment stays that route's business); CHASE via /api/admin/nag/items/:id/act with the
// guest-message outbox queue as the fallback — both approval-gated, nothing emails directly.
// Add guest / meal / soft-cancel + undo / waitlist + 24 h offers / performers flip live in
// admin-portal/backend/v2/gala-ops.js (/api/v2/gala-ops/…). Seats are NON-REFUNDABLE: cancel is a
// status door (+ undo), never a refund, and money documents stay FIRA's business.
import { api } from '../api.js';
import { ui, esc, fmt } from '../ui.js';
import { FACTS, galaPriceNow } from '../facts.js';
import router from '../router.js';

export const SOURCE = 'Admin Gala.dc.html';

// ---- COPY: every string that may change in a revision (dates/prices/venues via FACTS/API) ----
export const COPY = {
  back: '← PLEXUS WEEK',
  title: 'The <i>Gala Evening</i>',
  badge: (day, venue) => `${day} · ${venue}`,
  sub: 'Guest list, seating, meals, waitlist — everything for the night, on one page. Seats are non-refundable; cancelling frees the seat for the waitlist.',
  csvBtn: 'KITCHEN SHEET (CSV)', csvDone: 'KITCHEN SHEET DOWNLOADED', csvFile: 'gala-kitchen-sheet.csv',
  eventDay: 'EVENT DAY ROOM →',
  kpi: {
    reserved: 'RESERVED', reservedSub: 'seats spoken for',
    paid: 'PAID', paidSub: v => `${fmt.eur(v)} collected`,
    chase: 'TO CHASE', chaseSub: v => `${fmt.eur(v)} outstanding`,
    seated: 'SEATED', seatedSub: r => `of ${r} · rest unassigned`,
    room: 'ROOM', roomSub: 'tables × seats · limited by design'
  },
  list: {
    title: 'GUEST LIST', search: 'Find a guest…', add: '+ ADD GUEST',
    cols: { guest: 'GUEST', table: 'TABLE', meal: 'MEAL', status: 'STATUS' },
    addName: 'Guest name', addEmail: 'Email (needed for the invoice path)',
    kinds: price => [`INVOICE — ${fmt.eur(price)}`, 'VIP — FREE', 'SPONSOR SEAT'],
    addBtn: 'ADD',
    addNote: 'Invoice guests get a payment email queued in the Outbox · VIP and sponsor seats count as paid.',
    nameFirst: 'TYPE THE GUEST’S NAME FIRST',
    addedInvoice: 'ADDED — PAYMENT EMAIL QUEUED IN THE OUTBOX', addedPaid: 'ADDED — COUNTS AS PAID',
    groupNote: 'Group bookings (the table of four, the group of five) hold their seats under one payer — split them from the row when names arrive.',
    emptyLine: 'No guests yet.', emptyWhy: 'The first reservations land here the moment they come in — invitations go out from the Plexus hub.',
    noneMatch: q => `No guest matches “${q}”.`,
    filterTag: { paid: 'PAID ONLY', unpaid: 'TO CHASE ONLY', requested: 'REQUESTS ONLY' },
    tableTag: t => `TABLE ${t}`, clear: '✕',
    subPending: d => `reserved ${d} · payment pending`,
    subPaid: amt => amt ? `paid · ${fmt.eur(amt)}` : 'paid',
    seats: n => `${n} seats`,
    cancelled: n => `${n} cancelled seat${n === 1 ? '' : 's'}`, showCancelled: 'SHOW', hideCancelled: 'HIDE',
    reinstate: 'REINSTATE', cancelledChip: 'CANCELLED'
  },
  chips: { paid: 'PAID', vip: 'VIP · PAID', sponsor: 'SPONSOR · PAID', pending: 'PENDING', requested: 'REQUESTED' },
  chase: {
    label: 'CHASE', queued: 'QUEUED ✓', toast: 'REMINDER QUEUED IN THE OUTBOX',
    subject: 'Your Gala Evening seat — payment pending',
    body: (price) => `Dear {first_name},\n\nYour seat at the Med&X Gala Evening (December 5, Hotel Esplanade) is reserved — the payment of ${fmt.eur(price)} confirms it. You can pay from the member portal's Gala section in one click.\n\nIf the payment is already on its way, please ignore this note.\n\nWarm regards,\nThe Med&X Team`
  },
  pay: { label: 'MARK PAID', done: 'MARKED PAID — MONEY UPDATES TOO' },
  cancel: {
    label: '✕ CANCEL', sure: 'SURE? CANCEL',
    title: 'Frees the seat — the waitlist gets an automatic offer. Seats are non-refundable.',
    freed: 'SEAT FREED — WAITLIST GETS THE OFFER · NO REFUND ISSUED',
    restored: 'SEAT RESTORED'
  },
  board: {
    title: 'SEATING BOARD', hint: 'assign tables in the list — this fills in live',
    foot: 'Hover a table to see who sits there · the head table is T1. The walk-the-room 3D view builds on this same plan in production.',
    empty: 'empty'
  },
  meals: {
    title: 'MEALS — KITCHEN COUNT',
    foot: d => `Final counts go to the Esplanade on ${d} — the kitchen sheet export uses exactly these numbers.`,
    deadline: 'Nov 15'
  },
  wl: {
    title: 'WAITLIST', soldOut: 'SOLD OUT — LIVE',
    empty: 'Empty — when the room fills, new requests land here.',
    addName: 'Add to waitlist — name', addEmail: 'email (for the offer)', addBtn: 'ADD',
    foot: 'A freed seat auto-offers to the top of this list — they get 24 h before it moves on.',
    offer: 'OFFER A SEAT', offered: 'OFFER SENT ✓', accepted: 'ACCEPTED ✓', expired: 'EXPIRED — OFFER AGAIN',
    needsEmail: 'ADD AN EMAIL FIRST — THE OFFER GOES OUT BY EMAIL',
    offerSent: 'OFFER EMAILED — 24 H TO ACCEPT', added: 'ADDED TO THE WAITLIST',
    addedOffered: 'ADDED — A SEAT IS FREE, OFFER EMAILED (24 H)',
    removed: 'REMOVED FROM THE WAITLIST',
    left: h => `${h} h left`
  },
  night: {
    title: 'THE NIGHT',
    fallbackLine: '19:00 doors · 19:30 dinner · 21:00 Annual Awards · 22:00 performers · 23:30 carriages',
    tba: 'Performers — announced this autumn.',
    named: names => `Performers — ${names}.`,
    line2: 'Charity auction and the 3D room walk-through open from here as the night takes shape.',
    money: 'AUCTION PLEDGES → MONEY', memberPage: 'EDIT THE MEMBER PAGE →',
    announceBtn: 'ANNOUNCE PERFORMERS', tbaBtn: 'BACK TO TBA',
    modalTitle: 'Announce the performers',
    modalBody: 'One per line, as <b>Name — Role</b>. The member portal’s TBA slots flip the moment you announce.',
    announced: 'PERFORMERS ANNOUNCED — LIVE ON THE MEMBER PAGE', reverted: 'BACK TO TBA ON THE MEMBER PAGE',
    needOne: 'ADD AT LEAST ONE PERFORMER FIRST',
    revertTitle: 'Back to TBA?', revertBody: 'The member Gala page shows the “announced this autumn” slots again. The names stay saved here.',
    revertOk: 'BACK TO TBA', revertCancel: 'KEEP THEM LIVE'
  },
  loadFail: 'The guest list could not be loaded — try again in a moment.'
};

const INACTIVE = ['cancelled', 'rejected', 'declined', 'expired'];

let D = null, st = null, unbind = null, rootEl = null, onChange = null;

// ---------------------------------------------------------------- data
async function fetchOps() { return api.get('/api/v2/gala-ops/overview'); }
async function load() {
  const r = await api.settle({
    regs: api.get('/api/admin/gala/registrations'),
    settings: api.get('/api/admin/gala/settings'),
    menu: api.get('/api/admin/gala/menu-options'),
    ops: fetchOps(),
    nag: api.get('/api/admin/nag/items')
  });
  const gs = (r.settings && r.settings.settings) || r.settings || {};
  let schedule = Array.isArray(gs.schedule) ? gs.schedule : [];
  if (!schedule.length && gs.schedule_json) { try { schedule = JSON.parse(gs.schedule_json) || []; } catch (e) { schedule = []; } }
  const nagByReg = {};
  for (const it of ((r.nag && r.nag.items) || [])) if (it.kind === 'gala_unpaid') nagByReg[it.subject_id] = it;
  const D0 = {
    regs: Array.isArray(r.regs) ? r.regs : [], gs, schedule,
    menu: (r.menu && r.menu.options) || [],
    ops: r.ops || { tables: [], assignments: [], meals: {}, waitlist: [], cancellations: [], meta: { performers_announced: false, performers: [] }, room: {}, price: null },
    nagByReg, errors: r.$errors || {}
  };
  D0.price = (D0.ops.price && D0.ops.price.current) || galaPriceNow(gs);
  return D0;
}
// The board is 10 × 8 by design — create the missing gala_tables rows ONCE through the
// existing admin route so seating uses the same tables the v1 tools and the member wallet see.
async function ensureTables() {
  const have = new Set((D.ops.tables || []).map(t => String(t.label || '').toUpperCase()));
  const want = Array.from({ length: 10 }, (_, i) => 'T' + (i + 1)).filter(l => !have.has(l));
  if (!want.length) return;
  for (const label of want) {
    try { await api.post('/api/admin/gala/tables', { label, capacity: 8, notes: label === 'T1' ? 'Head table' : '' }); } catch (e) { break; }
  }
  try { D.ops = await fetchOps(); } catch (e) {}
}

// ---------------------------------------------------------------- derivations
const seatsOf = r => 1 + (Number(r.guest_count) || 0);
const isActive = r => !INACTIVE.includes(String(r.status || '').toLowerCase());
const isPaid = r => r.payment_status === 'paid';
const nameOf = r => `${r.first_name || ''} ${r.last_name || ''}`.trim() || r.email || 'Guest';
const tnum = t => { const m = String(t.label || '').match(/\d+/); return m ? +m[0] : 999; };

function tablesSorted() { return (D.ops.tables || []).slice().sort((a, b) => tnum(a) - tnum(b)); }
function assignMap() { const m = {}; for (const a of (D.ops.assignments || [])) m[a.registration_id] = a.table_id; return m; }
function tableById(id) { return (D.ops.tables || []).find(t => t.id === id) || null; }

function menuSorted() { return (D.menu || []).slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)); }
function defaultOption() { const m = menuSorted(); return m.find(o => o.is_default) || m[0] || null; }
function deriveOption(r) {
  const text = String(r.dietary || '').trim().toLowerCase();
  if (text) {
    for (const o of menuSorted()) {
      const kws = String(o.keywords || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
      if (kws.some(k => text.includes(k))) return o;
    }
  }
  return defaultOption();
}
function mealOptionOf(r) {
  const ov = D.ops.meals && D.ops.meals[r.id];
  if (ov) { const o = (D.menu || []).find(x => x.id === ov); if (o) return o; }
  return deriveOption(r);
}

function bucketOf(r) {
  if (isPaid(r)) return 'paid';
  if (String(r.status || '').toLowerCase() === 'pending') return 'requested';
  return 'unpaid';
}
function chipOf(r) {
  const p = String(r.pricing || '').toLowerCase();
  if (isPaid(r)) return { label: p === 'vip' ? COPY.chips.vip : p === 'sponsor' ? COPY.chips.sponsor : COPY.chips.paid, bg: '#e4efe7', fg: '#22563a', bucket: 'paid' };
  if (bucketOf(r) === 'requested') return { label: COPY.chips.requested, bg: '#f1e7d4', fg: '#7a6432', bucket: 'requested' };
  return { label: COPY.chips.pending, bg: '#f7e3e4', fg: '#7e151b', bucket: 'unpaid' };
}

function stats() {
  const act = D.regs.filter(isActive);
  const am = assignMap();
  const reserved = act.reduce((n, r) => n + seatsOf(r), 0);
  const paidRows = act.filter(isPaid);
  const chaseRows = act.filter(r => !isPaid(r));
  return {
    reserved,
    paidSeats: paidRows.reduce((n, r) => n + seatsOf(r), 0),
    chaseSeats: chaseRows.reduce((n, r) => n + seatsOf(r), 0),
    seated: act.filter(r => am[r.id]).reduce((n, r) => n + seatsOf(r), 0),
    collected: paidRows.reduce((n, r) => n + (Number(r.amount_paid) || 0), 0),
    owed: chaseRows.reduce((n, r) => n + seatsOf(r), 0) * D.price
  };
}
function visibleRows() {
  const q = st.q.trim().toLowerCase();
  const am = assignMap();
  return D.regs.filter(isActive)
    .filter(r => !q || nameOf(r).toLowerCase().includes(q) || String(r.institution || '').toLowerCase().includes(q) || String(r.email || '').toLowerCase().includes(q))
    .filter(r => st.filter === 'all' || bucketOf(r) === st.filter)
    .filter(r => { if (!st.filterTable) return true; const t = tableById(am[r.id]); return t && t.label === st.filterTable; });
}
function cancelledRows() {
  const live = new Set((D.ops.cancellations || []).map(c => c.registration_id));
  return D.regs.filter(r => String(r.status || '').toLowerCase() === 'cancelled' && live.has(r.id));
}
function mealCounts() {
  const per = new Map(menuSorted().map(o => [o.id, { option: o, n: 0 }]));
  for (const r of D.regs.filter(isActive)) {
    const o = mealOptionOf(r);
    if (o && per.has(o.id)) per.get(o.id).n += seatsOf(r);
  }
  return Array.from(per.values());
}

// ---------------------------------------------------------------- blocks (artboard markup verbatim)
function blockTitle() {
  return `
  <!-- dc: Admin Gala.dc.html › "Title row" -->
  <div style="display:flex;align-items:flex-end;gap:16px;flex-wrap:wrap">
    <div>
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <a href="/projects/plexus" style="font:600 10px Inter,sans-serif;letter-spacing:.14em;color:#6d6459" data-hover="color:#201b16">${COPY.back}</a>
        <span class="mx-display-30" style="font-family:Fraunces,serif;font-size:30px">${COPY.title}</span>
        <span style="font:600 9px Inter,sans-serif;letter-spacing:.15em;background:#f1e7d4;color:#7a6432;padding:4px 8px">${esc(COPY.badge(fmt.dayLabel(FACTS.gala.date), FACTS.gala.venue.toUpperCase()))}</span>
      </div>
      <div style="font-size:12.5px;color:#6d6459;margin-top:4px">${COPY.sub}</div>
    </div>
    <div style="flex:1"></div>
    <span data-act="kitchenCsv" style="padding:10px 15px;border:1px solid rgba(32,27,22,.25);background:#fff;font:600 10px Inter,sans-serif;letter-spacing:.14em;cursor:pointer;white-space:nowrap" data-hover="border-color:#201b16">${COPY.csvBtn}</span>
    <a href="/event-day" style="padding:11px 15px;background:#201b16;color:#f6f2ea;font:600 10px Inter,sans-serif;letter-spacing:.14em;white-space:nowrap" data-hover="background:#9b1b22;color:#f6f2ea">${COPY.eventDay}</a>
  </div>
  <!-- /dc -->`;
}

function blockKpis() {
  const s = stats();
  const room = D.ops.room || {};
  const cell = 'padding:15px 18px;border-right:1px solid rgba(32,27,22,.1);color:inherit;display:block';
  const k = 'font:600 9px Inter,sans-serif;letter-spacing:.15em;color:#6d6459';
  const n = 'font-family:Fraunces,serif;font-size:28px;margin-top:2px';
  const sub = 'font-size:11px;color:#6d6459';
  return `
  <!-- dc: Admin Gala.dc.html › "KPI strip" -->
  <div data-block="kpis" class="mx-kpi" style="border:1px solid rgba(32,27,22,.14);background:#fff;display:grid;grid-template-columns:repeat(5,1fr)">
    <span data-act="kpiAll" title="Show the full guest list" style="${cell};cursor:pointer"><div style="${k}">${COPY.kpi.reserved}</div><div style="${n}">${s.reserved}</div><div style="${sub}">${COPY.kpi.reservedSub}</div></span>
    <span data-act="kpiPaid" title="Show only paid seats" style="${cell};cursor:pointer"><div style="${k}">${COPY.kpi.paid}</div><div style="${n};color:#1e6e42">${s.paidSeats}</div><div style="${sub}">${esc(COPY.kpi.paidSub(s.collected))}</div></span>
    <span data-act="kpiChase" title="Show only seats with payment pending" style="${cell};cursor:pointer"><div style="${k}">${COPY.kpi.chase}</div><div style="${n};color:#9b1b22">${s.chaseSeats}</div><div style="${sub}">${esc(COPY.kpi.chaseSub(s.owed))}</div></span>
    <span data-act="kpiSeated" title="Jump to the seating board" style="${cell};cursor:pointer"><div style="${k}">${COPY.kpi.seated}</div><div style="${n}">${s.seated}</div><div style="${sub}">${esc(COPY.kpi.seatedSub(s.reserved))}</div></span>
    <span data-act="kpiRoom" title="Jump to the seating board" style="padding:15px 18px;display:block;cursor:pointer"><div style="${k}">${COPY.kpi.room}</div><div style="${n}">${room.table_count || 10} × ${room.seats_per_table || 8}</div><div style="${sub}">${COPY.kpi.roomSub}</div></span>
  </div>
  <!-- /dc -->`;
}

function addPanel() {
  if (!st.addOpen) return '';
  return `
    <div data-block="addpanel" style="display:flex;gap:8px;align-items:center;padding:11px 18px;border-bottom:1px solid rgba(32,27,22,.08);background:#fdfbf6;flex-wrap:wrap">
      <input data-role="ngName" placeholder="${COPY.list.addName}" style="flex:1;min-width:150px;border:1px solid rgba(32,27,22,.25);background:#fff;padding:8px 10px;font:400 12.5px Inter,sans-serif;color:#201b16">
      <input data-role="ngEmail" placeholder="${COPY.list.addEmail}" style="flex:1;min-width:170px;border:1px solid rgba(32,27,22,.25);background:#fff;padding:8px 10px;font:400 12.5px Inter,sans-serif;color:#201b16">
      <select data-role="ngKind" style="border:1px solid rgba(32,27,22,.25);background:#fff;padding:8px;font:400 12px Inter,sans-serif;color:#201b16">${COPY.list.kinds(D.price).map((o, i) => `<option value="${['invoice', 'vip', 'sponsor'][i]}">${esc(o)}</option>`).join('')}</select>
      <span data-act="addGuest" style="padding:8px 13px;background:#9b1b22;color:#fff;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer" data-hover="background:#7e151b">${COPY.list.addBtn}</span>
      <span style="font-size:11px;color:#6d6459;flex-basis:100%">${COPY.list.addNote}</span>
    </div>`;
}

function guestRow(r) {
  const am = assignMap();
  const t = tableById(am[r.id]);
  const meal = mealOptionOf(r);
  const chip = chipOf(r);
  const seats = seatsOf(r);
  const subBits = [];
  if (seats > 1) subBits.push(COPY.list.seats(seats));
  if (r.institution) subBits.push(esc(r.institution));
  subBits.push(isPaid(r) ? esc(COPY.list.subPaid(Number(r.amount_paid) || 0)) : esc(COPY.list.subPending(fmt.dayShort(r.created_at))));
  const nagItem = D.nagByReg[r.id];
  const chased = (nagItem && nagItem.status === 'actioned') || st.chasedLocal[r.id];
  const sure = st.cancelConfirm === r.id;
  const hint = [r.dietary ? 'Dietary: ' + r.dietary : '', r.requests ? 'Requests: ' + r.requests : ''].filter(Boolean).join(' · ');
  return `
    <div data-row="${esc(r.id)}" class="mx-gala-row" style="display:grid;grid-template-columns:1.7fr 92px 96px 1fr auto;gap:10px;padding:9px 18px;border-bottom:1px solid rgba(32,27,22,.07);align-items:center">
      <span style="min-width:0" ${hint ? `title="${esc(hint)}"` : ''}><span style="display:block;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(nameOf(r))}</span><span style="display:block;font-size:10.5px;color:#6d6459">${subBits.join(' · ')}</span></span>
      <select data-role="tableSel" data-id="${esc(r.id)}" aria-label="Table for ${esc(nameOf(r))}" style="border:1px solid rgba(32,27,22,.2);background:#f6f2ea;padding:6px 4px;font:600 11px Inter,sans-serif;color:#201b16;width:100%">
        <option value="">—</option>${tablesSorted().map(x => `<option value="${esc(x.id)}"${t && t.id === x.id ? ' selected' : ''}>${esc(x.label)}</option>`).join('')}
      </select>
      <select data-role="mealSel" data-id="${esc(r.id)}" aria-label="Meal for ${esc(nameOf(r))}" style="border:1px solid rgba(32,27,22,.2);background:#f6f2ea;padding:6px 4px;font:600 11px Inter,sans-serif;color:#201b16;width:100%">
        ${menuSorted().map(o => `<option value="${esc(o.id)}"${meal && meal.id === o.id ? ' selected' : ''}>${esc(String(o.label).toUpperCase())}</option>`).join('')}
      </select>
      <span style="display:flex;gap:5px;align-items:center;flex-wrap:wrap">
        <span data-act="chipFilter" data-bucket="${chip.bucket}" title="Filter the list by this status" style="font:600 8px Inter,sans-serif;letter-spacing:.1em;padding:3px 6px;background:${chip.bg};color:${chip.fg};white-space:nowrap;cursor:pointer">${chip.label}</span>
        ${!isPaid(r) ? (chased
          ? `<span title="Approve it on the Inbox → Outbox tab" style="font:600 8.5px Inter,sans-serif;letter-spacing:.1em;color:#6d6459;white-space:nowrap">${COPY.chase.queued}</span>`
          : `<span data-act="chase" data-id="${esc(r.id)}" style="font:600 8.5px Inter,sans-serif;letter-spacing:.1em;color:#9b1b22;cursor:pointer;white-space:nowrap" data-hover="color:#201b16">${COPY.chase.label}</span>`) : ''}
        ${!isPaid(r) ? `<span data-act="pay" data-id="${esc(r.id)}" style="font:600 8.5px Inter,sans-serif;letter-spacing:.1em;color:#1e6e42;cursor:pointer;white-space:nowrap">${COPY.pay.label}</span>` : ''}
      </span>
      <span data-act="cancel" data-id="${esc(r.id)}" title="${COPY.cancel.title}" style="font:600 9px Inter,sans-serif;letter-spacing:.1em;color:${sure ? '#9b1b22' : '#9a9086'};cursor:pointer;white-space:nowrap" data-hover="color:#9b1b22">${sure ? COPY.cancel.sure : COPY.cancel.label}</span>
    </div>`;
}

function rowsHtml() {
  if (D.errors.regs) return `<div class="empty"><span style="width:28px;height:1px;background:#c9a962"></span><span class="empty-line">${COPY.loadFail}</span></div>`;
  const rows = visibleRows();
  const cx = cancelledRows();
  let html = '';
  if ((st.filter !== 'all') || st.filterTable) {
    html += `<div style="display:flex;gap:8px;align-items:center;padding:8px 18px;border-bottom:1px solid rgba(32,27,22,.08);background:#fdfbf6">
      ${st.filter !== 'all' ? `<span data-act="clearFilter" style="font:600 8.5px Inter,sans-serif;letter-spacing:.12em;padding:4px 8px;background:#f1e7d4;color:#7a6432;cursor:pointer;white-space:nowrap">${COPY.list.filterTag[st.filter]} ${COPY.list.clear}</span>` : ''}
      ${st.filterTable ? `<span data-act="clearTable" style="font:600 8.5px Inter,sans-serif;letter-spacing:.12em;padding:4px 8px;background:#f1e7d4;color:#7a6432;cursor:pointer;white-space:nowrap">${esc(COPY.list.tableTag(st.filterTable))} ${COPY.list.clear}</span>` : ''}
    </div>`;
  }
  if (!rows.length) {
    html += st.q || st.filter !== 'all' || st.filterTable
      ? `<div style="padding:18px;font-size:12.5px;color:#6d6459;font-style:italic">${st.q ? esc(COPY.list.noneMatch(st.q)) : 'Nothing in this view — clear the filter above.'}</div>`
      : `<div class="empty"><span style="width:28px;height:1px;background:#c9a962"></span><span class="empty-line">${COPY.list.emptyLine}</span><span class="empty-why">${COPY.list.emptyWhy}</span></div>`;
  } else html += rows.map(guestRow).join('');
  html += `<div style="padding:10px 18px;font-size:11px;color:#6d6459;display:flex;gap:12px;flex-wrap:wrap;align-items:center"><span style="flex:1;min-width:220px">${COPY.list.groupNote}</span>
    ${cx.length ? `<span data-act="toggleCancelled" style="font:600 8.5px Inter,sans-serif;letter-spacing:.11em;color:#9a9086;cursor:pointer;white-space:nowrap" data-hover="color:#201b16">${esc(COPY.list.cancelled(cx.length))} · ${st.showCancelled ? COPY.list.hideCancelled : COPY.list.showCancelled}</span>` : ''}</div>`;
  if (st.showCancelled && cx.length) {
    html += cx.map(r => `
    <div data-row="${esc(r.id)}" style="display:flex;gap:10px;padding:9px 18px;border-top:1px solid rgba(32,27,22,.07);align-items:center;background:#fdfbf6">
      <span style="flex:1;min-width:0"><span style="display:block;font-size:13px;font-weight:600;color:#9a9086;text-decoration:line-through">${esc(nameOf(r))}</span><span style="display:block;font-size:10.5px;color:#9a9086">${esc(r.institution || '')}</span></span>
      <span style="font:600 8px Inter,sans-serif;letter-spacing:.1em;padding:3px 6px;background:#eee7dc;color:#6d6459;white-space:nowrap">${COPY.list.cancelledChip}</span>
      <span data-act="reinstate" data-id="${esc(r.id)}" style="font:600 8.5px Inter,sans-serif;letter-spacing:.11em;color:#9b1b22;cursor:pointer;white-space:nowrap" data-hover="color:#201b16">${COPY.list.reinstate}</span>
    </div>`).join('');
  }
  return html;
}

function blockList() {
  return `
  <!-- dc: Admin Gala.dc.html › "GUEST LIST" -->
  <div style="border:1px solid rgba(32,27,22,.14);background:#fff">
    <div style="display:flex;align-items:center;gap:10px;padding:13px 18px;border-bottom:1px solid rgba(32,27,22,.12);flex-wrap:wrap">
      <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${COPY.list.title}</span>
      <input data-role="q" value="${esc(st.q)}" placeholder="${COPY.list.search}" aria-label="Find a guest" style="flex:1;min-width:140px;border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:8px 10px;font:400 12.5px Inter,sans-serif;color:#201b16">
      <span data-act="addToggle" style="padding:8px 13px;background:#9b1b22;color:#fff;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap" data-hover="background:#7e151b">${COPY.list.add}</span>
    </div>
    <span data-block="addwrap">${addPanel()}</span>
    <div class="mx-gala-head" style="display:grid;grid-template-columns:1.7fr 92px 96px 1fr auto;gap:10px;padding:8px 18px;border-bottom:1px solid rgba(32,27,22,.12);font:600 8.5px Inter,sans-serif;letter-spacing:.14em;color:#6d6459;align-items:center"><span>${COPY.list.cols.guest}</span><span>${COPY.list.cols.table}</span><span>${COPY.list.cols.meal}</span><span>${COPY.list.cols.status}</span><span></span></div>
    <div data-block="rows">${rowsHtml()}</div>
  </div>
  <!-- /dc -->`;
}

function boardCells() {
  const am = assignMap();
  const act = D.regs.filter(isActive);
  return tablesSorted().map(t => {
    const at = act.filter(r => am[r.id] === t.id);
    const n = at.reduce((s, r) => s + seatsOf(r), 0);
    const cap = Number(t.capacity) || 8;
    const who = at.length ? at.map(nameOf).join(' · ') : COPY.board.empty;
    const bg = n ? (n >= cap ? '#f1e7d4' : '#fdfbf6') : 'transparent';
    const bd = n ? '#c9a962' : 'rgba(32,27,22,.18)';
    const fg = n >= cap ? '#7a6432' : '#201b16';
    return `<span data-act="tableFilter" data-label="${esc(t.label)}" title="${esc(who)}" style="border:1px solid ${bd};background:${bg};padding:10px 6px;display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer">
        <span style="font:600 10px Inter,sans-serif;letter-spacing:.1em;color:#201b16">${esc(t.label)}</span>
        <span style="font-family:Fraunces,serif;font-size:16px;color:${fg}">${n}/${cap}</span>
      </span>`;
  }).join('');
}
function blockBoard() {
  return `
  <!-- dc: Admin Gala.dc.html › "SEATING BOARD" -->
  <div id="mx-gala-board" style="border:1px solid rgba(32,27,22,.14);border-top:2px solid #c9a962;background:#fff">
    <div style="display:flex;align-items:center;gap:10px;padding:13px 18px;border-bottom:1px solid rgba(32,27,22,.1)"><span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${COPY.board.title}</span><div style="flex:1"></div><span style="font-size:11px;color:#6d6459">${COPY.board.hint}</span></div>
    <div data-block="board" style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;padding:14px 18px">${boardCells()}</div>
    <div style="padding:0 18px 14px;font-size:11px;color:#6d6459">${COPY.board.foot}</div>
  </div>
  <!-- /dc -->`;
}

function mealBars() {
  const counts = mealCounts();
  const max = Math.max(1, ...counts.map(m => m.n));
  return counts.map(m => `
      <div style="display:flex;align-items:center;gap:10px"><span style="width:110px;flex:none;font-size:12px">${esc(m.option.label)}</span><span style="flex:1;height:9px;background:rgba(32,27,22,.06)"><span style="display:block;width:${Math.round((m.n / max) * 100)}%;height:100%;background:#c9a962"></span></span><span style="font:600 11px Inter,sans-serif;width:24px;text-align:right">${m.n}</span></div>`).join('');
}
function blockMeals() {
  return `
  <!-- dc: Admin Gala.dc.html › "MEALS — KITCHEN COUNT" -->
  <div style="border:1px solid rgba(32,27,22,.14);background:#fff">
    <div style="padding:13px 18px;border-bottom:1px solid rgba(32,27,22,.1)"><span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${COPY.meals.title}</span></div>
    <div data-block="meals" style="padding:12px 18px 14px;display:flex;flex-direction:column;gap:7px">
      ${mealBars()}
      <span style="font-size:11px;color:#6d6459;margin-top:3px">${esc(COPY.meals.foot(COPY.meals.deadline))}</span>
    </div>
  </div>
  <!-- /dc -->`;
}

function wlRow(w) {
  const status = String(w.status || 'waiting');
  let right = '';
  if (status === 'waiting') {
    right = w.email
      ? `<span data-act="wlOffer" data-id="${esc(w.id)}" style="font:600 8.5px Inter,sans-serif;letter-spacing:.11em;color:#9b1b22;cursor:pointer;white-space:nowrap" data-hover="color:#201b16">${COPY.wl.offer}</span>`
      : `<span data-act="wlNeedsEmail" style="font:600 8.5px Inter,sans-serif;letter-spacing:.11em;color:#9a9086;cursor:pointer;white-space:nowrap" title="${COPY.wl.needsEmail}">${COPY.wl.offer}</span>`;
  } else if (status === 'offered') {
    const h = Math.max(0, Math.round((new Date(w.offer_expires_at) - Date.now()) / 3600000));
    right = `<span title="Offered ${esc(fmt.when(w.offered_at))} · expires ${esc(fmt.when(w.offer_expires_at))}" style="font:600 8.5px Inter,sans-serif;letter-spacing:.11em;color:#7a6432;white-space:nowrap">${COPY.wl.offered} · ${esc(COPY.wl.left(h))}</span>`;
  } else if (status === 'accepted') {
    right = `<span title="They are in the guest list now" style="font:600 8.5px Inter,sans-serif;letter-spacing:.11em;color:#1e6e42;white-space:nowrap">${COPY.wl.accepted}</span>`;
  } else if (status === 'expired') {
    right = `<span data-act="wlOffer" data-id="${esc(w.id)}" style="font:600 8.5px Inter,sans-serif;letter-spacing:.11em;color:#9b1b22;cursor:pointer;white-space:nowrap" data-hover="color:#201b16">${COPY.wl.expired}</span>`;
  }
  return `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 18px;border-bottom:1px solid rgba(32,27,22,.07)">
        <span style="flex:1;min-width:0;font-size:12.5px;font-weight:600" title="${esc(w.email || '')}">${esc(w.name)}</span>
        <span style="font-size:10.5px;color:#6d6459;white-space:nowrap">${esc(fmt.when(w.created_at))}</span>
        ${right}
        <span data-act="wlRemove" data-id="${esc(w.id)}" title="Remove from the waitlist" style="font:400 12px Inter,sans-serif;color:#9a9086;cursor:pointer" data-hover="color:#9b1b22">✕</span>
      </div>`;
}
function blockWaitlist() {
  const wl = (D.ops.waitlist || []).filter(w => w.status !== 'removed');
  const open = wl.filter(w => w.status === 'waiting' || w.status === 'offered');
  const soldOut = D.ops.room && D.ops.room.sold_out;
  return `
  <!-- dc: Admin Gala.dc.html › "WAITLIST" -->
  <div style="border:1px solid rgba(32,27,22,.14);background:#fff">
    <div style="display:flex;align-items:center;gap:10px;padding:13px 18px;border-bottom:1px solid rgba(32,27,22,.1)"><span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${COPY.wl.title}</span><span style="min-width:18px;height:18px;padding:0 5px;background:#201b16;color:#fff;font:600 11px Inter,sans-serif;display:inline-flex;align-items:center;justify-content:center">${open.length}</span>${soldOut ? `<span style="font:600 8px Inter,sans-serif;letter-spacing:.12em;background:#c9a962;color:#201b16;padding:3px 7px;white-space:nowrap">${COPY.wl.soldOut}</span>` : ''}<div style="flex:1"></div></div>
    <span data-block="wlrows">
    ${wl.length ? wl.map(wlRow).join('') : `<div style="padding:12px 18px;font-size:12px;color:#6d6459;font-style:italic;border-bottom:1px solid rgba(32,27,22,.07)">${COPY.wl.empty}</div>`}
    </span>
    <div style="display:flex;gap:8px;padding:11px 18px;flex-wrap:wrap">
      <input data-role="wlName" placeholder="${COPY.wl.addName}" aria-label="Waitlist name" style="flex:1.2;border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:8px 10px;font:400 12px Inter,sans-serif;color:#201b16;min-width:120px">
      <input data-role="wlEmail" placeholder="${COPY.wl.addEmail}" aria-label="Waitlist email" style="flex:1;border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:8px 10px;font:400 12px Inter,sans-serif;color:#201b16;min-width:110px">
      <span data-act="addWl" style="padding:8px 12px;background:#201b16;color:#f6f2ea;font:600 9px Inter,sans-serif;letter-spacing:.12em;cursor:pointer;display:flex;align-items:center">${COPY.wl.addBtn}</span>
    </div>
    <div style="padding:0 18px 12px;font-size:11px;color:#6d6459">${COPY.wl.foot}</div>
  </div>
  <!-- /dc -->`;
}

function blockNight() {
  const meta = D.ops.meta || { performers_announced: false, performers: [] };
  const schedLine = (D.schedule && D.schedule.length)
    ? D.schedule.map(it => `${esc(it.time || '')} ${esc(it.title || '')}`.trim()).filter(Boolean).join(' · ')
    : COPY.night.fallbackLine;
  const perfLine = meta.performers_announced && meta.performers.length
    ? esc(COPY.night.named(meta.performers.map(p => p.name + (p.role ? ` (${p.role})` : '')).join(' · ')))
    : COPY.night.tba;
  return `
  <!-- dc: Admin Gala.dc.html › "THE NIGHT" -->
  <div data-block="night" style="border:1px solid rgba(32,27,22,.14);background:#fdfbf6;padding:14px 18px;display:flex;flex-direction:column;gap:6px">
    <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${COPY.night.title}</span>
    <span style="font-size:12px;color:#4a4239;line-height:1.7">${schedLine}<br>${perfLine} ${COPY.night.line2}</span>
    <span style="display:flex;gap:14px;flex-wrap:wrap;align-items:center">
      <a href="/money" style="font:600 9px Inter,sans-serif;letter-spacing:.13em">${COPY.night.money}</a>
      <a href="/member-pages" style="font:600 9px Inter,sans-serif;letter-spacing:.13em">${COPY.night.memberPage}</a>
      <span data-act="perfFlip" data-v2="performers-flip" style="font:600 9px Inter,sans-serif;letter-spacing:.13em;color:${meta.performers_announced ? '#6d6459' : '#7a6432'};cursor:pointer;white-space:nowrap" data-hover="color:#201b16">${meta.performers_announced ? COPY.night.tbaBtn : COPY.night.announceBtn}</span>
    </span>
  </div>
  <!-- /dc -->`;
}

function template() {
  return `
<div data-screen-label="Admin Gala Management" style="min-height:100vh;background:#f6f2ea;color:#201b16;font-family:Inter,sans-serif">
  <div class="mx-gutter" style="max-width:1180px;margin:0 auto;padding:30px 28px 56px;display:flex;flex-direction:column;gap:22px">
    ${blockTitle()}
    ${blockKpis()}
    <div class="mx-two" style="display:grid;grid-template-columns:1.55fr 1fr;gap:22px;align-items:start">
      <span data-block="list">${blockList()}</span>
      <div style="display:flex;flex-direction:column;gap:22px">
        ${blockBoard()}
        ${blockMeals()}
        <span data-block="waitlist">${blockWaitlist()}</span>
        ${blockNight()}
      </div>
    </div>
  </div>
</div>`;
}

// ---------------------------------------------------------------- behaviour
function rerender(sel, html) { const el = rootEl && rootEl.querySelector(sel); if (el) el.outerHTML = html; }
function redrawLive() {
  rerender('[data-block="kpis"]', blockKpis());
  rerender('[data-block="rows"]', `<div data-block="rows">${rowsHtml()}</div>`);
  rerender('[data-block="board"]', `<div data-block="board" style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;padding:14px 18px">${boardCells()}</div>`);
  rerender('[data-block="meals"]', `<div data-block="meals" style="padding:12px 18px 14px;display:flex;flex-direction:column;gap:7px">${mealBars()}<span style="font-size:11px;color:#6d6459;margin-top:3px">${esc(COPY.meals.foot(COPY.meals.deadline))}</span></div>`);
  rerender('[data-block="waitlist"]', `<span data-block="waitlist">${blockWaitlist()}</span>`);
  rerender('[data-block="night"]', blockNight());
}
async function refresh({ regs = true, ops = true, nag = false } = {}) {
  try {
    const jobs = {};
    if (regs) jobs.regs = api.get('/api/admin/gala/registrations');
    if (ops) jobs.ops = fetchOps();
    if (nag) jobs.nag = api.get('/api/admin/nag/items');
    const r = await api.settle(jobs);
    if (!rootEl) return;
    if (r.regs) D.regs = Array.isArray(r.regs) ? r.regs : D.regs;
    if (r.ops) { D.ops = r.ops; D.price = (r.ops.price && r.ops.price.current) || D.price; }
    if (r.nag) { D.nagByReg = {}; for (const it of (r.nag.items || [])) if (it.kind === 'gala_unpaid') D.nagByReg[it.subject_id] = it; }
  } catch (e) { /* keep the current data on a failed refresh */ }
  redrawLive();
}
function busy(el, on) { if (el) el.setAttribute('aria-disabled', on ? 'true' : 'false'); }
function regById(id) { return D.regs.find(r => r.id === id); }

const handlers = {
  // KPI + filter doors — every status navigates to where you act on it
  kpiAll: () => { st.filter = 'all'; st.filterTable = null; redrawLive(); },
  kpiPaid: () => { st.filter = 'paid'; redrawLive(); },
  kpiChase: () => { st.filter = 'unpaid'; redrawLive(); },
  kpiSeated: () => { const b = rootEl.querySelector('#mx-gala-board'); if (b) b.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
  kpiRoom: () => handlers.kpiSeated(),
  chipFilter: (el) => { const b = el.dataset.bucket; st.filter = st.filter === b ? 'all' : b; redrawLive(); },
  clearFilter: () => { st.filter = 'all'; redrawLive(); },
  clearTable: () => { st.filterTable = null; redrawLive(); },
  tableFilter: (el) => { const l = el.dataset.label; st.filterTable = st.filterTable === l ? null : l; redrawLive(); },
  toggleCancelled: () => { st.showCancelled = !st.showCancelled; redrawLive(); },

  // Kitchen sheet CSV — exactly the numbers on the MEALS card (counts weighted by seats)
  kitchenCsv: () => {
    const counts = mealCounts();
    const lines = ['Meal,Seats'].concat(counts.map(m => `"${String(m.option.label).replace(/"/g, '""')}",${m.n}`));
    lines.push(`Total,${counts.reduce((n, m) => n + m.n, 0)}`);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' }));
    a.download = COPY.csvFile; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    ui.toast(COPY.csvDone);
  },

  // ADD GUEST — invoice / VIP / sponsor
  addToggle: () => { st.addOpen = !st.addOpen; rerender('[data-block="addwrap"]', `<span data-block="addwrap">${addPanel()}</span>`); const i = rootEl.querySelector('[data-role="ngName"]'); if (i) i.focus(); },
  addGuest: async (el) => {
    const name = (rootEl.querySelector('[data-role="ngName"]') || {}).value || '';
    const email = (rootEl.querySelector('[data-role="ngEmail"]') || {}).value || '';
    const kind = (rootEl.querySelector('[data-role="ngKind"]') || {}).value || 'invoice';
    if (!name.trim()) { ui.toast(COPY.list.nameFirst); return; }
    busy(el, true);
    try {
      await api.post('/api/v2/gala-ops/registrations', { name: name.trim(), email: email.trim(), kind });
      st.addOpen = false;
      rerender('[data-block="addwrap"]', `<span data-block="addwrap"></span>`);
      ui.toast(kind === 'invoice' ? COPY.list.addedInvoice : COPY.list.addedPaid);
      await refresh();
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
    busy(el, false);
  },

  // CHASE — the nag act stages an approval-gated reminder; guest-message queue is the fallback
  chase: async (el) => {
    const id = el.dataset.id; const r = regById(id); if (!r) return;
    busy(el, true);
    try {
      const item = D.nagByReg[id];
      if (item && item.status === 'open') {
        await api.post('/api/admin/nag/items/' + encodeURIComponent(item.id) + '/act');
        item.status = 'actioned';
      } else {
        await api.post('/api/admin/gala/guest-message/queue', {
          registration_ids: [id], subject: COPY.chase.subject, body: COPY.chase.body(D.price)
        });
        st.chasedLocal[id] = true;
      }
      ui.toast(COPY.chase.toast);
      redrawLive();
    } catch (e) { busy(el, false); ui.toast(e.message, { kind: 'error' }); }
  },

  // MARK PAID — the existing registrant route (FIRA on payment stays its business, untouched)
  pay: async (el) => {
    const id = el.dataset.id; if (!regById(id)) return;
    busy(el, true);
    try {
      await api.post('/api/admin/registrant/gala/' + encodeURIComponent(id) + '/mark-paid');
      ui.toast(COPY.pay.done);
      await refresh();
    } catch (e) { busy(el, false); ui.toast(e.message, { kind: 'error' }); }
  },

  // Non-refundable CANCEL — in-row confirm, then soft cancel + UNDO; a freed seat runs the sweep
  cancel: async (el) => {
    const id = el.dataset.id; const r = regById(id); if (!r) return;
    if (st.cancelConfirm !== id) { st.cancelConfirm = id; redrawLive(); return; }
    st.cancelConfirm = null;
    busy(el, true);
    try {
      await api.post('/api/v2/gala-ops/registrations/' + encodeURIComponent(id) + '/cancel');
      ui.toast(COPY.cancel.freed, {
        undo: async () => {
          try { await api.post('/api/v2/gala-ops/registrations/' + encodeURIComponent(id) + '/restore'); ui.toast(COPY.cancel.restored); } catch (e) { ui.toast(e.message, { kind: 'error' }); }
          if (rootEl) refresh();
        }
      });
      await refresh();
    } catch (e) { busy(el, false); ui.toast(e.message, { kind: 'error' }); }
  },
  reinstate: async (el) => {
    const id = el.dataset.id;
    busy(el, true);
    try { await api.post('/api/v2/gala-ops/registrations/' + encodeURIComponent(id) + '/restore'); ui.toast(COPY.cancel.restored); await refresh(); }
    catch (e) { busy(el, false); ui.toast(e.message, { kind: 'error' }); }
  },

  // WAITLIST
  addWl: async (el) => {
    const name = (rootEl.querySelector('[data-role="wlName"]') || {}).value || '';
    const email = (rootEl.querySelector('[data-role="wlEmail"]') || {}).value || '';
    if (!name.trim()) { ui.toast(COPY.list.nameFirst); return; }
    busy(el, true);
    try {
      const r = await api.post('/api/v2/gala-ops/waitlist', { name: name.trim(), email: email.trim() });
      ui.toast(r.sweep && r.sweep.offered && r.sweep.offered.length ? COPY.wl.addedOffered : COPY.wl.added);
      await refresh({ regs: false });
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
    busy(el, false);
  },
  wlOffer: async (el) => {
    const id = el.dataset.id;
    busy(el, true);
    try { await api.post('/api/v2/gala-ops/waitlist/' + encodeURIComponent(id) + '/offer'); ui.toast(COPY.wl.offerSent); await refresh({ regs: false }); }
    catch (e) { busy(el, false); ui.toast(e.message, { kind: 'error' }); }
  },
  wlNeedsEmail: () => ui.toast(COPY.wl.needsEmail),
  wlRemove: async (el) => {
    const id = el.dataset.id;
    busy(el, true);
    try { await api.del('/api/v2/gala-ops/waitlist/' + encodeURIComponent(id)); ui.toast(COPY.wl.removed); await refresh({ regs: false }); }
    catch (e) { busy(el, false); ui.toast(e.message, { kind: 'error' }); }
  },

  // Performers TBA flip (v2_gala_meta — the member Gala page reads the same row)
  perfFlip: async () => {
    const meta = D.ops.meta || { performers_announced: false, performers: [] };
    if (meta.performers_announced) {
      const ok = await ui.confirm({ title: COPY.night.revertTitle, body: COPY.night.revertBody, ok: COPY.night.revertOk, cancel: COPY.night.revertCancel });
      if (!ok) return;
      try { await api.put('/api/v2/gala-ops/meta', { performers_announced: false }); ui.toast(COPY.night.reverted); await refresh({ regs: false }); }
      catch (e) { ui.toast(e.message, { kind: 'error' }); }
      return;
    }
    const prefill = (meta.performers || []).map(p => p.name + (p.role ? ' — ' + p.role : '')).join('\n');
    const m = ui.modal({
      eyebrow: 'GALA EVENING', title: COPY.night.modalTitle,
      body: `<div style="margin-bottom:10px">${COPY.night.modalBody}</div><textarea data-role="perfList" rows="4" style="width:100%;box-sizing:border-box;border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:9px 10px;font:400 12.5px Inter,sans-serif;color:#201b16;resize:vertical">${esc(prefill)}</textarea>`,
      actions: [
        { label: 'CANCEL' },
        { label: COPY.night.announceBtn, kind: 'primary', onClick: () => {
          const ta = m.el.querySelector('[data-role="perfList"]');
          const list = String(ta && ta.value || '').split('\n').map(s => s.trim()).filter(Boolean).map(line => {
            const i = line.indexOf('—') >= 0 ? line.indexOf('—') : line.indexOf(' - ');
            return i > 0 ? { name: line.slice(0, i).replace(/-$/, '').trim(), role: line.slice(i + 1).replace(/^-/, '').trim() } : { name: line, role: '' };
          });
          if (!list.length) { ui.toast(COPY.night.needOne); return false; }
          api.put('/api/v2/gala-ops/meta', { performers: list, performers_announced: true })
            .then(() => { ui.toast(COPY.night.announced); if (rootEl) refresh({ regs: false }); })
            .catch(e => ui.toast(e.message, { kind: 'error' }));
        } }
      ]
    });
  }
};

// selects (table / meal) fire change, not click — one delegated listener beside ui.bind
async function handleChange(e) {
  const el = e.target;
  if (!el || !rootEl || !rootEl.contains(el)) return;
  // NOTE: no q branch here — the input handler below covers search live; rerendering rows on the
  // field's blur would detach whatever the admin is about to click (the click never lands).
  const id = el.dataset && el.dataset.id;
  if (el.matches('[data-role="tableSel"]') && id) {
    el.disabled = true;
    try {
      if (el.value) await api.post('/api/admin/gala/tables/' + encodeURIComponent(el.value) + '/assign', { registration_id: id });
      else await api.post('/api/admin/gala/unassign', { registration_id: id });
      await refresh({ regs: false });
    } catch (err) { el.disabled = false; ui.toast(err.message, { kind: 'error' }); await refresh({ regs: false }); }
    return;
  }
  if (el.matches('[data-role="mealSel"]') && id) {
    el.disabled = true;
    try { await api.put('/api/v2/gala-ops/registrations/' + encodeURIComponent(id) + '/meal', { option_id: el.value }); await refresh({ regs: false }); }
    catch (err) { el.disabled = false; ui.toast(err.message, { kind: 'error' }); await refresh({ regs: false }); }
  }
}
function handleInput(e) {
  if (e.target && e.target.matches && e.target.matches('[data-role="q"]')) {
    st.q = e.target.value;
    rerender('[data-block="rows"]', `<div data-block="rows">${rowsHtml()}</div>`);
  }
}

function injectCss() {
  if (!document.querySelector('link[href="/css/views/gala.css"]')) {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/css/views/gala.css'; l.setAttribute('data-view-css', 'gala'); document.head.appendChild(l);
  }
}

export default {
  title: 'Gala Evening',
  async render(root, ctx) {
    rootEl = root;
    st = { q: '', addOpen: false, filter: 'all', filterTable: null, cancelConfirm: null, showCancelled: false, chasedLocal: {} };
    injectCss();
    D = await load();
    if (rootEl !== root) return;                    // navigated away while loading
    if (!D.errors.ops && (D.ops.tables || []).length < 10) { await ensureTables(); if (rootEl !== root) return; }
    root.innerHTML = template();
    unbind = ui.bind(root, handlers);
    onChange = handleChange;
    root.addEventListener('change', onChange);
    root.addEventListener('input', handleInput);
  },
  destroy() {
    if (unbind) unbind(); unbind = null;
    if (rootEl && onChange) { rootEl.removeEventListener('change', onChange); rootEl.removeEventListener('input', handleInput); }
    onChange = null; rootEl = null; D = null; st = null;
  }
};
