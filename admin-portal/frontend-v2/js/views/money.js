// Source: Admin Money.dc.html — REBUILT to Miro's team-review spec (MONEY section, Aug 2026 doc;
// TEAM-REVIEW-CONSOLIDATED-2026-08.md §C "Money rebuild").
// Blocks (new order): "Money header row" › "Money stat row" (COLLECTED = ALL income across every
// project · STILL OWED incl. manually entered receivables · SPENT = all costs · NET) › jump strip ›
// "RECENT MONEY IN" (every source) + "STILL OWED TO US" (breakdown + očekivane uplate add/edit) ›
// "KNJIGA IZLAZNIH RAČUNA" › "KNJIGA ULAZNIH RAČUNA" › "PUTNI NALOZI" (separated) › "NALOZI ZA
// PLAĆANJE" › "RADNE JEDINICE" › "IZVJEŠTAJI" (project · work unit · person · date range, CSV of the
// filtered set) › "FINANCE TOOLS" (all transactions · Stripe · close year).
//
// REMOVED from this screen per Miro: PAYMENTS TO CHASE, SPONSORS & DONORS, BOARD PACK (they live
// with their projects), RECONCILE BANK TRANSFERS, the free-form EXPENSES quick-add (costs now follow
// the knjiga ulaznih računa entry), and the orders' "send to sign" button (no e-signing exists).
// Their /api/v2/money endpoints stay alive for the project screens.
// REMOVED per the 2026-09-02 UX audit (#15): the v2 MORNING-AFTER SURVEY card — email machinery,
// not bookkeeping; it belongs beside the outbox it feeds. The /api/v2/money/survey* endpoints stay
// alive untouched (queued survey links must keep resolving) — only the card left this screen.
// Audit #13: every heading keeps the one-directional bilingual rule the book headers set —
// Croatian term first, English gloss after — and every date on this screen renders dd.mm.yyyy.
// Audit #1: the gala line inside STILL-OWED arrives from /api/v2/money/summary, which now reads
// the ONE canonical gala computation (backend/v2/gala-ops.js computeSummary) — same numbers as /gala.
//
// ⚠ FIRA RULE (hard): invoices are issued ONLY through the FIRA fiscal system. The outgoing book
// LISTS FIRA-issued invoices — the number is TYPED from FIRA; non-fiscalized rows are manual
// entries. This screen never generates an invoice document or an invoice number.
import { api } from '../api.js';
import { session } from '../state.js';
import { ui, esc, fmt } from '../ui.js';
import { chrome } from '../chrome.js';

export const SOURCE = 'Admin Money.dc.html';

export const COPY = {
  // Audit C6: this screen is now ENGLISH, like every other admin screen. The statutory Croatian
  // bookkeeping terms (knjiga izlaznih/ulaznih računa, putni nalog, nalog za plaćanje, radna
  // jedinica, OIB, fiskalizirani račun) are kept as a small gloss after the English heading, so a
  // Croatian bookkeeper still recognises the book they are looking at. Dates stay dd.mm.yyyy and
  // the CSV exports keep their Croatian column headers — those go to the bookkeeper, not the screen.
  title: 'Money', sub: 'every book in one place — income, receivables and spending',
  fiscalYear: 'FISCAL YEAR',
  stats: {
    collected: y => `COLLECTED IN ${y}`, collectedSub: 'naplaćeno — every project, every source of income',
    owed: 'STILL OWED TO US', owedSub: n => `otvorena potraživanja — ${fmt.plural(n, 'item', 'items')}, hand-entered receivables included`,
    owedTitle: 'Everything still owed to us — reserved Gala seats, unsettled invoices and hand-entered receivables (a won grant whose payment has not landed yet)',
    spent: 'SPENT', spentSub: 'potrošeno — incoming invoices + travel orders + the legacy ledger',
    net: y => `NET ${y}`, netSub: 'collected minus spent'
  },
  jump: [
    ['bookout', 'Outgoing invoices'], ['bookin', 'Incoming invoices'], ['travel', 'Travel orders'],
    ['payment', 'Payment orders'], ['units', 'Work units'], ['reports', 'Reports'], ['tools', 'Tools']
  ],
  moneyIn: {
    title: 'RECENT MONEY IN', sub: 'nedavne uplate — all income, whatever the source or project',
    all: 'ALL TRANSACTIONS →', empty: 'Nothing has landed yet this year.',
    foot: 'Stripe payments, bank transfers, settled invoices, received receivables and sponsorships — one stream.'
  },
  owed: {
    title: 'STILL OWED TO US', sub: 'otvorena potraživanja — everything that has not landed yet',
    add: '+ EXPECTED PAYMENT', addTitle: 'Enter a receivable that is not an invoice — a won grant whose payment has not arrived yet',
    expTitle: 'EXPECTED PAYMENTS — ENTERED BY HAND', expEmpty: 'Nothing entered by hand — add a won grant whose payment has not landed yet.',
    srcPh: 'Who owes us — e.g. Ministry of Science — NGO grant', descPh: 'Description (optional)', amtPh: '€ amount', datePh: 'Expected date',
    save: 'SAVE', added: 'RECEIVABLE ENTERED — IT COUNTS TOWARDS STILL OWED', needBoth: 'A SOURCE AND A POSITIVE AMOUNT ARE BOTH REQUIRED',
    received: 'RECEIVED ✓ — MOVED INTO COLLECTED', receivedUndo: 'MOVED BACK INTO STILL OWED',
    receiveBtn: 'RECEIVED', deleted: 'RECEIVABLE DELETED',
    confirmDelete: s => ({ title: `Delete "${s}"?`, body: 'The row leaves the receivables book and the STILL OWED total.', ok: 'DELETE', cancel: 'KEEP' }),
    statusChip: { open: 'OPEN', received: 'RECEIVED', cancelled: 'CANCELLED' },
    lineDoor: { gala_unpaid: '/gala', sponsor_ledger: '/gala' },
    foot: 'Gala seats are collected on the project (Plexus › Gala) — here they are only counted.'
  },
  book: {
    outTitle: 'OUTGOING INVOICE BOOK', outSub: 'knjiga izlaznih računa — FIRA issues, this records',
    inTitle: 'INCOMING INVOICE BOOK', inSub: 'knjiga ulaznih računa — every cost follows this entry',
    add: '+ RECORD AN INVOICE', addTitleOut: 'Record an invoice issued in FIRA (or a manual non-fiscal entry) — the portal never issues invoices',
    addTitleIn: 'Record an incoming (supplier) invoice',
    sums: { total: 'TOTAL', settled: 'SETTLED', open: 'UNSETTLED', fisk: 'FISCAL', nefisk: 'NON-FISCAL', inSettled: 'PAID', inOpen: 'UNPAID' },
    th: {
      broj: 'INVOICE NUMBER', kupac: 'CUSTOMER', dobavljac: 'SUPPLIER', oib: 'OIB', datum: 'INVOICE DATE',
      iznos: 'AMOUNT', knjizenje: 'BOOKING DATE', vrsta: 'TYPE', naplata: 'SETTLED', placanje: 'PAID',
      jedinica: 'WORK UNIT', projekt: 'PROJECT', akcije: ''
    },
    vrste: [['fiskalizirani', 'FISCAL'], ['nefiskalizirani', 'NON-FISCAL']],
    firaPh: 'Invoice number from FIRA — e.g. 26-100-0042', brojPh: 'Invoice number', partyOutPh: 'Customer name', partyInPh: 'Supplier name',
    oibPh: 'OIB (11 digits)', amtPh: '€ amount', notesPh: 'Note (optional)',
    lblDatum: 'Invoice date', lblKnjizenje: 'Booking date', lblNaplata: 'Date settled (if it has been)', lblPlacanje: 'Date paid (if it has been)',
    settleAct: 'SETTLED?', settleActIn: 'PAID?', settled: d => `✓ ${dmy(d)}`,
    added: 'INVOICE RECORDED IN THE BOOK', saved: 'ROW SAVED', deleted: 'ROW DELETED FROM THE BOOK',
    settledToast: 'MARKED SETTLED — TOTALS REFRESHED', settledToastIn: 'MARKED PAID', settleUndone: 'MOVED BACK TO UNSETTLED',
    confirmDelete: n => ({ title: `Delete invoice ${n} from the book?`, body: 'Only the record here is deleted — the invoice in FIRA (or at the supplier) does not go away.', ok: 'DELETE', cancel: 'KEEP' }),
    emptyOut: 'The book is empty for this filter — record the first invoice from FIRA.', emptyIn: 'No incoming invoices for this filter.',
    legacyTitle: n => `LEGACY INVOICES (old system) · ${n}`, legacyNote: 'read-only — booked in the old tool, shown here only',
    firaFoot: 'Fiscal invoices are created only in FIRA — the number is copied here. The portal never issues or generates an invoice. Non-fiscal rows are manual entries.',
    inFoot: 'This entry is the form every cost follows — SPENT and the work units read this book (plus travel orders).'
  },
  travel: {
    title: 'TRAVEL ORDERS', sub: 'putni nalozi — separate from payment orders · no e-signature',
    add: '+ NEW TRAVEL ORDER', total: y => `TOTAL COST ${y}`,
    th: { broj: 'ORDER NUMBER', ime: 'NAME', datum: 'TRAVEL DATE', odrediste: 'DESTINATION', svrha: 'PURPOSE', trosak: 'TOTAL COST', otvoren: 'DATE OPENED', jedinica: 'WORK UNIT', projekt: 'PROJECT', akcije: '' },
    imePh: 'Full name', odredistePh: 'Destination', svrhaPh: 'Purpose of travel', amtPh: '€ cost', brojPh: 'Order number (blank = automatic)',
    lblDatum: 'Travel date', lblOtvaranje: 'Date opened',
    personPh: 'Filter: person…',
    added: n => `TRAVEL ORDER ${n} OPENED`, saved: 'TRAVEL ORDER SAVED', deleted: 'TRAVEL ORDER DELETED',
    confirmDelete: n => ({ title: `Delete travel order ${n}?`, body: 'The cost leaves the SPENT total and its work unit.', ok: 'DELETE', cancel: 'KEEP' }),
    empty: 'No travel orders for this filter.',
    foot: 'Every order follows the putni nalog form: number, person, date, destination, purpose, cost, date opened, work unit, project.'
  },
  pay: {
    title: 'PAYMENT ORDERS', sub: 'nalozi za plaćanje — their own list, separate from travel orders',
    add: '+ NEW ORDER', total: y => `TOTAL ${y}`,
    th: { broj: 'ORDER NUMBER', primatelj: 'PAYEE', opis: 'DESCRIPTION', iznos: 'AMOUNT', datum: 'ORDER DATE', jedinica: 'WORK UNIT', projekt: 'PROJECT', akcije: '' },
    primateljPh: 'Payee — company or person', opisPh: 'Description / purpose of payment', amtPh: '€ amount', brojPh: 'Order number (blank = automatic)', lblDatum: 'Order date',
    added: n => `ORDER ${n} RECORDED`, saved: 'ORDER SAVED', deleted: 'ORDER DELETED',
    confirmDelete: n => ({ title: `Delete order ${n}?`, body: 'Only the payment-order record is deleted.', ok: 'DELETE', cancel: 'KEEP' }),
    empty: 'No payment orders for this filter.',
    foot: 'A payment order usually settles an incoming invoice, so it is not counted into SPENT twice — the cost sits with the incoming invoice book.'
  },
  units: {
    title: 'WORK UNITS', sub: 'radne jedinice & grant budgets — every book row ties to a unit and a project',
    add: '+ NEW WORK UNIT',
    th: { sifra: 'CODE', naziv: 'NAME', opis: 'DESCRIPTION', prihod: y => `INCOME ${y}`, rashod: y => `EXPENSE ${y}`, preneseno: 'CARRIED OVER', konacno: 'CLOSING BALANCE', akcije: '' },
    sifraPh: 'Code — e.g. RJ-2026-001', nazivPh: 'Name of the work unit', opisPh: 'Description — what is booked to this unit', carryPh: '€ balance carried over from last year',
    added: 'WORK UNIT ADDED', saved: 'WORK UNIT SAVED', deleted: 'WORK UNIT DELETED',
    confirmDelete: c => ({ title: `Delete work unit ${c}?`, body: 'Only possible while nothing is booked to it — otherwise mark it inactive.', ok: 'DELETE', cancel: 'KEEP' }),
    empty: 'No work units yet — add the first one and every book row can tie to it.',
    inactive: 'INACTIVE',
    foot: 'Income = outgoing invoices booked to the unit · expense = incoming invoices + travel orders · closing balance = carried over + income − expense.'
  },
  reports: {
    title: 'REPORTS', sub: 'izvještaji — by project, by work unit, by person, by period',
    groups: [['project', 'By project'], ['work_unit', 'By work unit'], ['person', 'By person']],
    run: 'SHOW', th: { grupa: { project: 'PROJECT', work_unit: 'WORK UNIT', person: 'PERSON' }, prihod: 'INCOME', rashod: 'EXPENSE', neto: 'NET', stavki: 'ITEMS' },
    total: 'TOTAL', legacyChip: 'incl. legacy',
    empty: 'Nothing for this cut — change the group or the date range.',
    csv: (g, y, n) => `CSV — ${({ project: 'BY PROJECT', work_unit: 'BY WORK UNIT', person: 'BY PERSON' })[g]} · ${y} · ${fmt.plural(n, 'row', 'rows')}`,
    foot: 'Income = outgoing invoices + received receivables · expense = incoming invoices + travel orders. A by-project report with no further filters also includes the legacy booked income and costs.'
  },
  csvBtn: (label, y, n, extra) => `CSV — ${label} · ${y}${extra ? ' · ' + extra : ''} · ${fmt.plural(n, 'row', 'rows')}`,
  csvStarted: f => `DOWNLOAD STARTED — ${f}`,
  filters: { project: '— all projects —', unit: '— all work units —', from: 'from', to: 'to', clear: 'CLEAR FILTERS' },
  noUnitShort: '—',
  projects: [['plexus', 'Plexus Week'], ['gala', 'Gala'], ['accelerator', 'Accelerator'], ['forum', 'Forum'], ['bridges', 'Bridges'], ['general', 'General']],
  tools: {
    heading: 'FINANCE TOOLS', foot: 'Each opens right here — the view appears under this card.',
    rows: [
      { id: 'tx', name: 'All transactions', note: 'the legacy ledger — every euro the old flows booked' },
      { id: 'stripe', name: 'Stripe payments', note: 'read-only · recent card payments', v2: true },
      { id: 'close', name: 'Close fiscal year', note: 'end-of-year lock' }
    ],
    titles: { tx: 'ALL TRANSACTIONS (LEGACY LEDGER)', stripe: 'STRIPE — RECENT CARD PAYMENTS', close: y => `CLOSE FISCAL YEAR ${y}` },
    close: '✕ CLOSE'
  },
  tx: { foot: 'The legacy book of payments and costs (Stripe, bank, mark-paid) — new entries go through the books above.', empty: 'Nothing in the legacy books for this year.' },
  stripe: { gate: 'STRIPE KEY NOT SET', matched: 'MATCHED ✓', unmatched: 'NO PORTAL RECORD', foot: at => `Read-only view of the Stripe account — refreshed ${at || 'just now'}, cached for a minute.` },
  close: {
    body: 'Closing locks every {Y} number forever — the books, the orders and the reports stay readable but nothing can change. It asks twice, and only works after December 31.',
    notYet: y => `AVAILABLE AFTER DEC 31, ${y}`, closeBtn: y => `CLOSE ${y} FOR GOOD`, reopen: 'REOPEN THE YEAR',
    isClosed: y => `Fiscal year ${y} is closed — every number is locked. Reopen it only to correct a genuine error.`,
    confirm1: y => ({ title: `Close ${y}?`, body: 'Every book row, order and report for the year becomes read-only.', ok: 'CONTINUE', cancel: 'KEEP IT OPEN' }),
    confirm2: y => ({ title: 'Asking twice, as promised.', body: `This locks ${y} for good — reopening later is possible but audited.`, ok: `CLOSE ${y}`, cancel: 'CANCEL' }),
    closed: 'YEAR CLOSED — EVERY NUMBER IS NOW READ-ONLY', reopened: 'YEAR REOPENED'
  },
  editEyebrow: 'EDIT ROW', editSave: 'SAVE', editCancel: 'CANCEL'
};// (the MORNING-AFTER SURVEY card left this screen per audit #15 — it lives with the email
// machinery it feeds; the /api/v2/money/survey* endpoints stay alive untouched)

const HAIR = 'rgba(32,27,22,.14)', HAIR12 = 'rgba(32,27,22,.12)', HAIR08 = 'rgba(32,27,22,.08)', HAIR07 = 'rgba(32,27,22,.07)';
const SRC_TAG = { CARD: ['#e4efe7', '#22563a'], BANK: ['#e4efe7', '#22563a'], GALA: ['#fdf3df', '#8a6116'], PLEXUS: ['#eee9df', '#4a4239'], INVOICE: ['#e8e4f0', '#4a3a6b'], GRANT: ['#e2ecf3', '#2b567a'], SPONSOR: ['#f3e6d8', '#7a5222'] };
const INPUT = 'border:1px solid rgba(32,27,22,.25);background:#fff;padding:8px 10px;font:400 12.5px Inter,sans-serif;color:#201b16';
const INPUT2 = 'border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:8px 10px;font:400 12.5px Inter,sans-serif;color:#201b16';
const BTN_RED = 'padding:8px 13px;background:#9b1b22;color:#fff;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap';
const BTN_GHOST = 'padding:7px 11px;border:1px solid rgba(32,27,22,.2);font:600 9px Inter,sans-serif;letter-spacing:.12em;cursor:pointer;color:#201b16;white-space:nowrap';
const MICRO = 'font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#6d6459';

let D = null, st = null, unbind = null, rootEl = null, cssEl = null;

// ---------------------------------------------------------------- data
const qs = o => Object.entries(o).filter(([, v]) => v !== '' && v != null).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
const bookQ = dir => qs({ direction: dir, year: st.year, ...st.f[dir === 'out' ? 'out' : 'inb'] });
const travelQ = () => qs({ year: st.year, ...st.f.travel });
const payQ = () => qs({ year: st.year, ...st.f.pay });

async function load(year) {
  const r = await api.settle({
    summary: api.get('/api/v2/money/summary?year=' + year),
    out: api.get('/api/v2/money/book?direction=out&year=' + year),
    inb: api.get('/api/v2/money/book?direction=in&year=' + year),
    travel: api.get('/api/v2/money/travel-orders?year=' + year),
    pay: api.get('/api/v2/money/payment-orders?year=' + year),
    units: api.get('/api/v2/money/work-units?year=' + year),
    expected: api.get('/api/v2/money/expected'),
    years: api.get('/api/finance/years')
  });
  const list = (x, k) => (x && Array.isArray(x[k])) ? x[k] : [];
  return {
    errors: r.$errors,
    summary: r.summary || { collected: { total: 0, sources: [] }, owed: { total: 0, sources: [] }, spent: { total: 0, sources: [] }, payment_orders: { total: 0, count: 0 }, gala: {}, recent_in: [] },
    out: r.out || { rows: [], sums: {}, legacy_rows: [], legacy_total: 0 },
    inb: r.inb || { rows: [], sums: {}, legacy_rows: [], legacy_total: 0 },
    travel: r.travel || { rows: [], sums: { count: 0, total: 0 } },
    pay: r.pay || { rows: [], sums: { count: 0, total: 0 } },
    units: list(r.units, 'rows'),
    expected: list(r.expected, 'rows'),
    years: Array.isArray(r.years) ? r.years : []
  };
}

const projLabel = p => (COPY.projects.find(x => x[0] === p) || [null, p || 'General'])[1];
const unitLabel = r => r.work_unit_code ? `${r.work_unit_code}` : COPY.noUnitShort;
const unitTitle = r => r.work_unit_code ? `${r.work_unit_code} — ${r.work_unit_name || ''}` : '';
const money = v => fmt.eur(v || 0);
// Audit #13: Croatian bookkeeping reads dd.mm.yyyy — "09/01/2026" means two different days
// depending on who reads it, so every rendered date on this screen uses this form.
const dmy = v => { const d = fmt.toDate(v); return d ? `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}` : '—'; };
// the locale + format hint every date input on this screen carries (browsers render the native
// picker in the OS locale — the title is the part we control)
const DATE_HINT = ' lang="hr" title="dd.mm.yyyy"';

async function fetchBlob(path) {
  const res = await fetch(api.url(path), { headers: { Authorization: 'Bearer ' + session.token } });
  if (!res.ok) { let j = null; try { j = JSON.parse(await res.text()); } catch (e) {} throw new Error((j && (j.message || j.error)) || ('The export failed (HTTP ' + res.status + ').')); }
  return res.blob();
}
const dl = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };

// ---------------------------------------------------------------- shared UI vocabulary
function card(block, id, title, sub, headExtra, body) {
  return `
    <div data-block="${block}" id="${id}" style="border:1px solid ${HAIR};background:#fff">
      <div class="mxm-cardhead" style="display:flex;align-items:center;gap:10px;padding:14px 20px;border-bottom:1px solid ${HAIR12};flex-wrap:wrap">
        <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em;white-space:nowrap">${title}</span>
        <span style="font-size:11.5px;color:#6d6459">${sub}</span>
        <div style="flex:1"></div>
        ${headExtra || ''}
      </div>
      ${body}
    </div>`;
}
function chip(k, v, color) {
  return `<span style="${MICRO};${color ? 'color:' + color : ''};white-space:nowrap">${k} <span style="font-family:Fraunces,serif;font-size:14px;letter-spacing:0;color:${color || '#201b16'}">${v}</span></span>`;
}
function chipRow(cells, extra) {
  return `<div class="mxm-sums" style="display:flex;align-items:center;gap:16px;padding:10px 20px;flex-wrap:wrap;border-bottom:1px solid ${HAIR08};background:#fdfbf6">${cells}${extra || ''}</div>`;
}
function tblWrap(headers, bodyRows, minWidth) {
  return `
    <div class="mxm-scroll" style="overflow-x:auto">
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
const csvBtn = (act, label) => `<span data-act="${act}" style="${BTN_GHOST}" data-hover="border-color:#201b16" title="Exports exactly what you are looking at — the filtered set">${label}</span>`;
const addBtn = (act, label, title) => `<span data-act="${act}"${title ? ` title="${esc(title)}"` : ''} style="padding:7px 12px;background:#201b16;color:#f6f2ea;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap" data-hover="background:#9b1b22">${label}</span>`;
function selProject(role, val, withAll) {
  const opts = (withAll ? [['', COPY.filters.project]] : []).concat(COPY.projects);
  return `<select data-role="${role}" aria-label="Project" style="${INPUT}">${opts.map(([v, l]) => `<option value="${v}"${v === (val || (withAll ? '' : 'general')) ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
}
function selUnit(role, val, withAll) {
  const opts = (withAll ? [['', COPY.filters.unit]] : [['', '— bez jedinice —']]).concat(D.units.map(u => [u.id, `${u.code} — ${u.name}`]));
  return `<select data-role="${role}" aria-label="Work unit" style="${INPUT}">${opts.map(([v, l]) => `<option value="${esc(v)}"${v === (val || '') ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
}
function filterRow(cardKey, f, withPerson) {
  return `<div class="mxm-form" style="display:flex;gap:8px;align-items:center;padding:10px 20px;flex-wrap:wrap;border-bottom:1px solid ${HAIR08}">
    ${withPerson ? `<input data-change="filter" data-card="${cardKey}" data-field="person" value="${esc(f.person || '')}" placeholder="${esc(withPerson)}" aria-label="Filter by person" style="${INPUT};min-width:150px">` : ''}
    <select data-change="filter" data-card="${cardKey}" data-field="project" aria-label="Filter by project" style="${INPUT}">${[['', COPY.filters.project]].concat(COPY.projects).map(([v, l]) => `<option value="${v}"${v === (f.project || '') ? ' selected' : ''}>${l}</option>`).join('')}</select>
    <select data-change="filter" data-card="${cardKey}" data-field="work_unit" aria-label="Filter by work unit" style="${INPUT}">${[['', COPY.filters.unit]].concat(D.units.map(u => [u.id, u.code])).map(([v, l]) => `<option value="${esc(v)}"${v === (f.work_unit || '') ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>
    <label style="${MICRO}">${COPY.filters.from} <input type="date" lang="hr" title="dd.mm.yyyy" data-change="filter" data-card="${cardKey}" data-field="from" value="${esc(f.from || '')}" aria-label="From date" style="${INPUT}"></label>
    <label style="${MICRO}">${COPY.filters.to} <input type="date" lang="hr" title="dd.mm.yyyy" data-change="filter" data-card="${cardKey}" data-field="to" value="${esc(f.to || '')}" aria-label="To date" style="${INPUT}"></label>
    ${(f.project || f.work_unit || f.from || f.to || f.person) ? `<span data-act="clearFilter" data-id="${cardKey}" style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#9b1b22;cursor:pointer">${COPY.filters.clear}</span>` : ''}
  </div>`;
}
const filterSuffix = f => [f.person, f.project && projLabel(f.project), f.work_unit && (D.units.find(u => u.id === f.work_unit) || {}).code, f.from || f.to ? [f.from || '…', f.to || '…'].join('→') : '']
  .filter(Boolean).join(' · ');

// ---------------------------------------------------------------- blocks
function blockHead() {
  const years = [...new Set([st.year, ...D.years.map(y => Number(y.year))])].sort((a, b) => b - a);
  return `
  <!-- dc: Admin Money.dc.html › "Money header row" -->
  <div data-block="head" style="display:flex;align-items:baseline;gap:14px;flex-wrap:wrap">
    <span class="mx-display-30" style="font-family:Fraunces,serif;font-size:30px">${COPY.title}</span>
    <span style="font-size:12.5px;color:#6d6459">${COPY.sub}</span>
    <div style="flex:1"></div>
    <label style="display:flex;align-items:center;gap:8px;font:600 10px Inter,sans-serif;letter-spacing:.13em;color:#6d6459">${COPY.fiscalYear}<select data-change="year" aria-label="Fiscal year" style="border:1px solid rgba(32,27,22,.25);background:#fff;padding:7px 10px;font:600 12px Inter,sans-serif;color:#201b16">${years.map(y => `<option${y === st.year ? ' selected' : ''}>${y}</option>`).join('')}</select></label>
  </div>
  <!-- /dc -->`;
}

function blockStats() {
  const c = COPY.stats, s = D.summary;
  const net = (s.collected.total || 0) - (s.spent.total || 0);
  const owedCount = (s.owed.sources || []).reduce((n, x) => n + (x.count || 0), 0);
  const cell = (extra, act, k, v, sub, vColor, title) => `
      <span data-act="${act}"${title ? ` title="${esc(title)}"` : ''} style="padding:18px 22px;${extra}display:block;color:#201b16;cursor:pointer" data-hover="background:var(--row-hover)">
        <span style="display:block;font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#6d6459">${k}</span>
        <span class="mx-display-32" style="display:block;font-family:Fraunces,serif;font-size:32px;margin-top:4px${vColor ? ';color:' + vColor : ''}">${v}</span>
        <span style="display:block;font-size:11.5px;color:#6d6459">${sub}</span>
      </span>`;
  return `
  <!-- dc: Admin Money.dc.html › "Money stat row" (rebuilt: all projects, all sources) -->
  <div data-block="stats" class="mx-kpi" style="border:1px solid ${HAIR};background:#fff;display:grid;grid-template-columns:repeat(4,1fr)">
    ${cell(`border-right:1px solid ${HAIR12};`, 'goMoneyIn', c.collected(st.year), money(s.collected.total), esc(c.collectedSub))}
    ${cell(`border-right:1px solid ${HAIR12};`, 'goOwed', c.owed, money(s.owed.total), esc(c.owedSub(owedCount)), '#9b1b22', c.owedTitle)}
    ${cell(`border-right:1px solid ${HAIR12};`, 'goBookIn', c.spent, money(s.spent.total), esc(c.spentSub))}
    ${cell('', 'goReports', c.net(st.year), money(net), c.netSub, net >= 0 ? '#2f7d4f' : '#9b1b22')}
  </div>
  <!-- /dc -->`;
}

function blockJump() {
  return `
  <!-- v2: jump strip (long accounting page — every card is a door) -->
  <div data-block="jump" style="display:flex;gap:14px;flex-wrap:wrap;align-items:center">
    ${COPY.jump.map(([id, label]) => `<span data-act="jump" data-id="${id}" style="font:600 9.5px Inter,sans-serif;letter-spacing:.13em;color:#6d6459;cursor:pointer;white-space:nowrap" data-hover="color:#9b1b22">${label} ↓</span>`).join('')}
  </div>
  <!-- /v2 -->`;
}

function blockMoneyIn() {
  const rows = (D.summary.recent_in || []).slice(0, 12);
  return `
    <!-- dc: Admin Money.dc.html › "RECENT MONEY IN" (rebuilt: every source, one stream) -->
    <div data-block="moneyin" id="moneyin" style="border:1px solid ${HAIR};background:#fff">
      <div style="display:flex;align-items:center;gap:10px;padding:14px 20px;border-bottom:1px solid ${HAIR12};flex-wrap:wrap">
        <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${COPY.moneyIn.title}</span>
        <span style="font-size:11.5px;color:#6d6459">${COPY.moneyIn.sub}</span>
        <div style="flex:1"></div>
        <span data-act="openTx" style="font:600 10px Inter,sans-serif;letter-spacing:.13em;color:#9b1b22;cursor:pointer" data-hover="color:#201b16">${COPY.moneyIn.all}</span>
      </div>
      ${rows.map(t => { const tg = SRC_TAG[t.source] || ['#eee9df', '#4a4239']; return `
      <div style="display:flex;align-items:center;gap:14px;padding:11px 20px;border-bottom:1px solid ${HAIR07}">
        <span style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#6d6459;width:70px;flex:none">${esc(dmy(t.date))}</span>
        <span class="mx-row-text" style="flex:1;font-size:13px;min-width:0">${esc(t.label || '—')}</span>
        <span style="font:600 9px Inter,sans-serif;letter-spacing:.1em;padding:3px 7px;background:${tg[0]};color:${tg[1]};white-space:nowrap">${esc(t.source)}</span>
        <span style="font-family:Fraunces,serif;font-size:15px;white-space:nowrap">${money(t.amount)}</span>
      </div>`; }).join('')}
      ${!rows.length ? `<div style="padding:14px 20px;font-size:12.5px;color:#6d6459">${COPY.moneyIn.empty}</div>` : ''}
      <div style="padding:11px 20px;font-size:11.5px;color:#6d6459">${COPY.moneyIn.foot}</div>
    </div>
    <!-- /dc -->`;
}

function blockOwed() {
  const c = COPY.owed;
  const sources = (D.summary.owed.sources || []);
  const line = s => {
    const door = c.lineDoor[s.key];
    const jumpTo = s.key === 'book_out_open' || s.key === 'legacy_invoices' ? 'bookout' : null;
    const label = `<span style="flex:1;font-size:12.5px;min-width:0">${esc(s.label)}${s.count ? ` <span style="color:#6d6459">· ${s.count}</span>` : ''}</span>`;
    const amt = `<span style="font-family:Fraunces,serif;font-size:15px;white-space:nowrap;color:#9b1b22">${money(s.amount)}</span>`;
    if (door) return `<a href="${door}" style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid rgba(32,27,22,.06);color:#201b16" data-hover="color:#9b1b22">${label}${amt}<span style="font:600 10px Inter,sans-serif;color:#9b1b22">→</span></a>`;
    if (jumpTo) return `<span data-act="jump" data-id="${jumpTo}" style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid rgba(32,27,22,.06);color:#201b16;cursor:pointer" data-hover="color:#9b1b22">${label}${amt}<span style="font:600 10px Inter,sans-serif;color:#9b1b22">↓</span></span>`;
    return `<span style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid rgba(32,27,22,.06)">${label}${amt}</span>`;
  };
  const exp = D.expected;
  const stChip = x => { const map = { open: ['#fdf3df', '#8a6116'], received: ['#e4efe7', '#22563a'], cancelled: ['#eee9df', '#6d6459'] }; const t = map[x.status] || map.open; return `<span style="font:600 8.5px Inter,sans-serif;letter-spacing:.11em;padding:3px 7px;background:${t[0]};color:${t[1]};white-space:nowrap">${c.statusChip[x.status] || x.status}</span>`; };
  return `
    <!-- dc: Admin Money.dc.html › "STILL OWED TO US" (rebuilt: breakdown + ručno unesena potraživanja) -->
    <div data-block="owed" id="owed" style="border:1px solid ${HAIR};border-top:2px solid #9b1b22;background:#fff">
      <div style="display:flex;align-items:center;gap:10px;padding:14px 20px;border-bottom:1px solid ${HAIR12};flex-wrap:wrap">
        <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${c.title}</span>
        <span style="font-size:11.5px;color:#6d6459">${c.sub}</span>
        <div style="flex:1"></div>
        <span style="font-family:Fraunces,serif;font-size:19px;color:#9b1b22;white-space:nowrap">${money(D.summary.owed.total)}</span>
        ${addBtn('exToggle', c.add, c.addTitle)}
      </div>
      <div style="padding:6px 20px 4px">${sources.map(line).join('') || `<span style="display:block;padding:12px 0;font-size:12.5px;color:#6d6459">Nothing outstanding — everything is collected.</span>`}</div>
      ${st.exOpen ? `
      <div class="mxm-form" style="display:flex;gap:8px;align-items:center;padding:12px 20px;border-top:1px solid ${HAIR08};flex-wrap:wrap;background:#fdfbf6">
        <input data-role="exSrc" placeholder="${esc(c.srcPh)}" aria-label="Source of the receivable" style="flex:2;min-width:200px;${INPUT}">
        <input data-role="exDesc" placeholder="${esc(c.descPh)}" aria-label="Description" style="flex:1;min-width:140px;${INPUT}">
        <input data-role="exAmt" placeholder="${esc(c.amtPh)}" aria-label="Amount" style="width:90px;${INPUT}">
        <label style="${MICRO}">${esc(c.datePh)} <input type="date" lang="hr" title="dd.mm.yyyy" data-role="exDate" aria-label="Expected date" style="${INPUT}"></label>
        ${selProject('exProj', 'general', false)}
        ${selUnit('exUnit', '', false)}
        <span data-act="exAdd" style="${BTN_RED}" data-hover="background:#7e151b">${c.save}</span>
      </div>` : ''}
      <div style="padding:10px 20px 4px;border-top:1px solid ${HAIR08}"><span style="${MICRO}">${c.expTitle}</span></div>
      ${exp.map(x => `
      <div data-row="${esc(x.id)}" class="mx-row" style="display:flex;align-items:center;gap:12px;padding:10px 20px;border-bottom:1px solid ${HAIR07}">
        <span class="mx-row-text" style="flex:1;min-width:0">
          <span style="display:block;font-size:13px;font-weight:600">${esc(x.source)}</span>
          <span style="display:block;font-size:11.5px;color:#6d6459;margin-top:1px">${esc([x.description, x.expected_date ? 'expected ' + dmy(x.expected_date) : '', x.received_date ? 'received ' + dmy(x.received_date) : '', projLabel(x.project), x.work_unit_code || ''].filter(Boolean).join(' · '))}</span>
        </span>
        <span style="font-family:Fraunces,serif;font-size:15px;white-space:nowrap${x.status === 'received' ? ';color:#2f7d4f' : ''}">${money(x.amount)}</span>
        ${stChip(x)}
        ${x.status === 'open' ? `<span data-act="exReceive" data-id="${esc(x.id)}" style="${BTN_RED}" data-hover="background:#7e151b">${c.receiveBtn}</span>` : ''}
        ${actBtn('exEdit', x.id, '✎', 'Uredi')}
        ${actBtn('exDelete', x.id, '✕', 'Delete')}
      </div>`).join('')}
      ${!exp.length ? `<div style="padding:12px 20px;font-size:12.5px;color:#6d6459">${c.expEmpty}</div>` : ''}
      <div style="padding:11px 20px;font-size:11.5px;color:#6d6459">${c.foot}</div>
    </div>
    <!-- /dc -->`;
}

function bookTable(dir) {
  const c = COPY.book, data = dir === 'out' ? D.out : D.inb, f = st.f[dir === 'out' ? 'out' : 'inb'];
  const th = c.th;
  const headers = [{ t: th.broj }, { t: dir === 'out' ? th.kupac : th.dobavljac }, { t: th.oib }, { t: th.datum }, { t: th.iznos, r: 1 }, { t: th.knjizenje }]
    .concat(dir === 'out' ? [{ t: th.vrsta }] : [])
    .concat([{ t: dir === 'out' ? th.naplata : th.placanje }, { t: th.jedinica }, { t: th.projekt }, { t: th.akcije, r: 1 }]);
  const vrstaTag = v => v === 'fiskalizirani'
    ? `<span style="font:600 8.5px Inter,sans-serif;letter-spacing:.1em;padding:3px 6px;background:#e4efe7;color:#22563a;white-space:nowrap">FISCAL</span>`
    : `<span style="font:600 8.5px Inter,sans-serif;letter-spacing:.1em;padding:3px 6px;background:#fdf3df;color:#8a6116;white-space:nowrap">NON-FISCAL</span>`;
  const rows = data.rows.map(r => `<tr data-row="${esc(r.id)}">
      ${td(`<span style="font:600 11px Inter,sans-serif;font-variant-numeric:tabular-nums;white-space:nowrap">${esc(r.invoice_number)}</span>`)}
      ${td(esc(r.party_name) + (r.notes ? `<span style="display:block;font-size:11px;color:#6d6459">${esc(r.notes)}</span>` : ''))}
      ${td(`<span style="font:400 11.5px Inter,sans-serif;font-variant-numeric:tabular-nums">${esc(r.party_oib || '—')}</span>`)}
      ${td(esc(dmy(r.invoice_date)))}
      ${tdNum(money(r.amount))}
      ${td(esc(dmy(r.booking_date)))}
      ${dir === 'out' ? td(vrstaTag(r.vrsta)) : ''}
      ${td(r.settled_date
        ? `<span style="font:600 9.5px Inter,sans-serif;letter-spacing:.1em;color:#2f7d4f;white-space:nowrap">${esc(c.settled(r.settled_date))}</span>`
        : `<span data-act="${dir === 'out' ? 'boSettle' : 'biSettle'}" data-id="${esc(r.id)}" style="${BTN_GHOST}" data-hover="border-color:#201b16">${dir === 'out' ? c.settleAct : c.settleActIn}</span>`)}
      ${td(`<span title="${esc(unitTitle(r))}">${esc(unitLabel(r))}</span>`)}
      ${td(esc(projLabel(r.project)))}
      ${tdActs(actBtn(dir === 'out' ? 'boEdit' : 'biEdit', r.id, '✎', 'Edit row') + actBtn(dir === 'out' ? 'boDelete' : 'biDelete', r.id, '✕', 'Delete row'))}
    </tr>`).join('');
  const legacyRows = data.legacy_rows.map(r => `<tr style="opacity:.66">
      ${td(`<span style="font:600 11px Inter,sans-serif;font-variant-numeric:tabular-nums;white-space:nowrap">${esc(r.invoice_number || '—')}</span>`)}
      ${td(esc(r.party_name || '—') + ` <span style="font:600 8px Inter,sans-serif;letter-spacing:.1em;padding:2px 5px;background:#eee9df;color:#6d6459">LEGACY</span>`)}
      ${td(`<span style="font:400 11.5px Inter,sans-serif;font-variant-numeric:tabular-nums">${esc(r.party_oib || '—')}</span>`)}
      ${td(esc(r.invoice_date ? dmy(r.invoice_date) : '—'))}
      ${tdNum(money(r.amount))}
      ${td('—')}
      ${dir === 'out' ? td(vrstaTag(r.vrsta)) : ''}
      ${td(r.settled_date ? `<span style="font:600 9.5px Inter,sans-serif;color:#2f7d4f;white-space:nowrap">${esc(c.settled(r.settled_date))}</span>` : `<span style="font:600 9px Inter,sans-serif;letter-spacing:.1em;color:#6d6459">${esc(String(r.status || '').toUpperCase())}</span>`)}
      ${td(`<span title="${esc(unitTitle(r))}">${esc(unitLabel(r))}</span>`)}
      ${td(esc(projLabel(r.project)))}
      ${tdActs('')}
    </tr>`).join('');
  const s = data.sums || {};
  const chips = dir === 'out'
    ? chip(c.sums.total, money(s.total)) + chip(c.sums.settled, money(s.settled_total), '#2f7d4f') + chip(c.sums.open, money(s.open_total), '#9b1b22') + chip(c.sums.fisk, money(s.fisk_total)) + chip(c.sums.nefisk, money(s.nefisk_total))
    : chip(c.sums.total, money(s.total)) + chip(c.sums.inSettled, money(s.settled_total), '#2f7d4f') + chip(c.sums.inOpen, money(s.open_total), '#9b1b22');
  const csvLabel = COPY.csvBtn(dir === 'out' ? 'OUTGOING INVOICES' : 'INCOMING INVOICES', st.year, data.rows.length + data.legacy_rows.length, filterSuffix(f));
  return { headers, rows, legacyRows, chips, csvLabel };
}
function blockBook(dir) {
  const c = COPY.book, data = dir === 'out' ? D.out : D.inb, f = st.f[dir === 'out' ? 'out' : 'inb'];
  const t = bookTable(dir);
  const addOpen = dir === 'out' ? st.boOpen : st.biOpen;
  const pfx = dir === 'out' ? 'bo' : 'bi';
  const addForm = !addOpen ? '' : `
      <div class="mxm-form" style="display:flex;gap:8px;align-items:center;padding:12px 20px;border-bottom:1px solid ${HAIR08};flex-wrap:wrap;background:#fdfbf6">
        ${dir === 'out' ? `<select data-role="${pfx}Vrsta" aria-label="Invoice type" style="${INPUT}">${c.vrste.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>` : ''}
        <input data-role="${pfx}Num" placeholder="${esc(dir === 'out' ? c.firaPh : c.brojPh)}" aria-label="Invoice number" style="flex:1;min-width:190px;${INPUT}">
        <input data-role="${pfx}Party" placeholder="${esc(dir === 'out' ? c.partyOutPh : c.partyInPh)}" aria-label="${dir === 'out' ? 'Customer name' : 'Supplier name'}" style="flex:1;min-width:160px;${INPUT}">
        <input data-role="${pfx}Oib" placeholder="${esc(c.oibPh)}" aria-label="OIB" maxlength="11" style="width:120px;${INPUT}">
        <input data-role="${pfx}Amt" placeholder="${esc(c.amtPh)}" aria-label="Amount" style="width:90px;${INPUT}">
        <label style="${MICRO}">${c.lblDatum} <input type="date" lang="hr" title="dd.mm.yyyy" data-role="${pfx}Date" value="${esc(fmt.ymd(new Date()))}" aria-label="Invoice date" style="${INPUT}"></label>
        <label style="${MICRO}">${c.lblKnjizenje} <input type="date" lang="hr" title="dd.mm.yyyy" data-role="${pfx}Book" value="${esc(fmt.ymd(new Date()))}" aria-label="Booking date" style="${INPUT}"></label>
        <label style="${MICRO}">${dir === 'out' ? c.lblNaplata : c.lblPlacanje} <input type="date" lang="hr" title="dd.mm.yyyy" data-role="${pfx}Settled" aria-label="Date settled" style="${INPUT}"></label>
        ${selUnit(pfx + 'Unit', '', false)}
        ${selProject(pfx + 'Proj', 'general', false)}
        <span data-act="${pfx}Add" style="${BTN_RED}" data-hover="background:#7e151b">${COPY.owed.save}</span>
      </div>`;
  return `
    <!-- dc: Admin Money.dc.html › "${dir === 'out' ? 'KNJIGA IZLAZNIH RAČUNA' : 'KNJIGA ULAZNIH RAČUNA'}" (Miro spec — columns verbatim) -->
    ${card(dir === 'out' ? 'bookout' : 'bookin', dir === 'out' ? 'bookout' : 'bookin',
      dir === 'out' ? c.outTitle : c.inTitle, dir === 'out' ? c.outSub : c.inSub,
      csvBtn(pfx + 'Csv', t.csvLabel) + addBtn(pfx + 'Toggle', c.add, dir === 'out' ? c.addTitleOut : c.addTitleIn),
      chipRow(t.chips) + filterRow(dir === 'out' ? 'out' : 'inb', f) + addForm
      + tblWrap(t.headers, t.rows || '', dir === 'out' ? 1020 : 940)
      + (!data.rows.length ? `<div style="padding:13px 20px;font-size:12.5px;color:#6d6459">${dir === 'out' ? c.emptyOut : c.emptyIn}</div>` : '')
      + (data.legacy_rows.length ? `
        <div style="padding:12px 20px 4px;border-top:1px solid ${HAIR08};display:flex;gap:10px;align-items:baseline;flex-wrap:wrap">
          <span style="${MICRO}">${c.legacyTitle(data.legacy_rows.length)}</span>
          <span style="font-size:11px;color:#6d6459">${c.legacyNote} · ${money(data.legacy_total)}</span>
        </div>` + tblWrap(t.headers, t.legacyRows, dir === 'out' ? 1020 : 940) : '')
      + `<div style="padding:11px 20px;font-size:11.5px;color:#6d6459">${dir === 'out' ? c.firaFoot : c.inFoot}</div>`)}
    <!-- /dc -->`;
}

function blockTravel() {
  const c = COPY.travel, f = st.f.travel;
  const headers = [{ t: c.th.broj }, { t: c.th.ime }, { t: c.th.datum }, { t: c.th.odrediste }, { t: c.th.svrha }, { t: c.th.trosak, r: 1 }, { t: c.th.otvoren }, { t: c.th.jedinica }, { t: c.th.projekt }, { t: c.th.akcije, r: 1 }];
  const rows = D.travel.rows.map(r => `<tr data-row="${esc(r.id)}">
      ${td(`<span style="font:600 11px Inter,sans-serif;font-variant-numeric:tabular-nums;white-space:nowrap">${esc(r.order_number)}</span>`)}
      ${td(`<span style="font-weight:600">${esc(r.traveler_name)}</span>`)}
      ${td(esc(dmy(r.travel_date)))}
      ${td(esc(r.destination))}
      ${td(esc(r.purpose || '—'))}
      ${tdNum(money(r.total_cost))}
      ${td(esc(r.opened_date ? dmy(r.opened_date) : '—'))}
      ${td(`<span title="${esc(unitTitle(r))}">${esc(unitLabel(r))}</span>`)}
      ${td(esc(projLabel(r.project)))}
      ${tdActs(actBtn('trEdit', r.id, '✎', 'Edit order') + actBtn('trDelete', r.id, '✕', 'Delete order'))}
    </tr>`).join('');
  const addForm = !st.trOpen ? '' : `
      <div class="mxm-form" style="display:flex;gap:8px;align-items:center;padding:12px 20px;border-bottom:1px solid ${HAIR08};flex-wrap:wrap;background:#fdfbf6">
        <input data-role="trNum" placeholder="${esc(c.brojPh)}" aria-label="Broj naloga" style="width:190px;${INPUT}">
        <input data-role="trName" placeholder="${esc(c.imePh)}" aria-label="Full name" style="flex:1;min-width:150px;${INPUT}">
        <label style="${MICRO}">${c.lblDatum} <input type="date" lang="hr" title="dd.mm.yyyy" data-role="trDate" aria-label="Travel date" style="${INPUT}"></label>
        <input data-role="trDest" placeholder="${esc(c.odredistePh)}" aria-label="Destination" style="flex:1;min-width:130px;${INPUT}">
        <input data-role="trPurpose" placeholder="${esc(c.svrhaPh)}" aria-label="Purpose" style="flex:1;min-width:150px;${INPUT}">
        <input data-role="trAmt" placeholder="${esc(c.amtPh)}" aria-label="Total cost" style="width:90px;${INPUT}">
        <label style="${MICRO}">${c.lblOtvaranje} <input type="date" lang="hr" title="dd.mm.yyyy" data-role="trOpened" value="${esc(fmt.ymd(new Date()))}" aria-label="Date opened" style="${INPUT}"></label>
        ${selUnit('trUnit', '', false)}
        ${selProject('trProj', 'general', false)}
        <span data-act="trAdd" style="${BTN_RED}" data-hover="background:#7e151b">${COPY.owed.save}</span>
      </div>`;
  return `
    <!-- dc: Admin Money.dc.html › "PAYMENT & TRAVEL ORDERS" (rebuilt: PUTNI NALOZI separated, no send-to-sign) -->
    ${card('travel', 'travel', c.title, c.sub,
      csvBtn('trCsv', COPY.csvBtn('PUTNI NALOZI', st.year, D.travel.rows.length, filterSuffix(f))) + addBtn('trToggle', c.add),
      chipRow(chip(c.total(st.year), money(D.travel.sums.total)) + chip('NALOGA', fmt.num(D.travel.sums.count)))
      + filterRow('travel', f, c.personPh) + addForm
      + tblWrap(headers, rows, 1040)
      + (!D.travel.rows.length ? `<div style="padding:13px 20px;font-size:12.5px;color:#6d6459">${c.empty}</div>` : '')
      + `<div style="padding:11px 20px;font-size:11.5px;color:#6d6459">${c.foot}</div>`)}
    <!-- /dc -->`;
}

function blockPayment() {
  const c = COPY.pay, f = st.f.pay;
  const headers = [{ t: c.th.broj }, { t: c.th.primatelj }, { t: c.th.opis }, { t: c.th.iznos, r: 1 }, { t: c.th.datum }, { t: c.th.jedinica }, { t: c.th.projekt }, { t: c.th.akcije, r: 1 }];
  const rows = D.pay.rows.map(r => `<tr data-row="${esc(r.id)}">
      ${td(`<span style="font:600 11px Inter,sans-serif;font-variant-numeric:tabular-nums;white-space:nowrap">${esc(r.order_number)}</span>`)}
      ${td(`<span style="font-weight:600">${esc(r.recipient_name)}</span>`)}
      ${td(esc(r.description || '—'))}
      ${tdNum(money(r.amount))}
      ${td(esc(dmy(r.order_date)))}
      ${td(`<span title="${esc(unitTitle(r))}">${esc(unitLabel(r))}</span>`)}
      ${td(esc(projLabel(r.project)))}
      ${tdActs(actBtn('poEdit', r.id, '✎', 'Edit order') + actBtn('poDelete', r.id, '✕', 'Delete order'))}
    </tr>`).join('');
  const addForm = !st.poOpen ? '' : `
      <div class="mxm-form" style="display:flex;gap:8px;align-items:center;padding:12px 20px;border-bottom:1px solid ${HAIR08};flex-wrap:wrap;background:#fdfbf6">
        <input data-role="poNum" placeholder="${esc(c.brojPh)}" aria-label="Broj naloga" style="width:190px;${INPUT}">
        <input data-role="poName" placeholder="${esc(c.primateljPh)}" aria-label="Payee" style="flex:1;min-width:170px;${INPUT}">
        <input data-role="poDesc" placeholder="${esc(c.opisPh)}" aria-label="Description" style="flex:1;min-width:170px;${INPUT}">
        <input data-role="poAmt" placeholder="${esc(c.amtPh)}" aria-label="Amount" style="width:90px;${INPUT}">
        <label style="${MICRO}">${c.lblDatum} <input type="date" lang="hr" title="dd.mm.yyyy" data-role="poDate" value="${esc(fmt.ymd(new Date()))}" aria-label="Order date" style="${INPUT}"></label>
        ${selUnit('poUnit', '', false)}
        ${selProject('poProj', 'general', false)}
        <span data-act="poAdd" style="${BTN_RED}" data-hover="background:#7e151b">${COPY.owed.save}</span>
      </div>`;
  return `
    <!-- dc: Admin Money.dc.html › "PAYMENT & TRAVEL ORDERS" (rebuilt: NALOZI ZA PLAĆANJE — own list) -->
    ${card('payment', 'payment', c.title, c.sub,
      csvBtn('poCsv', COPY.csvBtn('PAYMENT ORDERS', st.year, D.pay.rows.length, filterSuffix(f))) + addBtn('poToggle', c.add),
      chipRow(chip(c.total(st.year), money(D.pay.sums.total)) + chip('NALOGA', fmt.num(D.pay.sums.count)))
      + filterRow('pay', f, 'Filter: primatelj…') + addForm
      + tblWrap(headers, rows, 920)
      + (!D.pay.rows.length ? `<div style="padding:13px 20px;font-size:12.5px;color:#6d6459">${c.empty}</div>` : '')
      + `<div style="padding:11px 20px;font-size:11.5px;color:#6d6459">${c.foot}</div>`)}
    <!-- /dc -->`;
}

function blockUnits() {
  const c = COPY.units;
  const headers = [{ t: c.th.sifra }, { t: c.th.naziv }, { t: c.th.opis }, { t: c.th.prihod(st.year), r: 1 }, { t: c.th.rashod(st.year), r: 1 }, { t: c.th.preneseno, r: 1 }, { t: c.th.konacno, r: 1 }, { t: c.th.akcije, r: 1 }];
  const rows = D.units.map(u => `<tr data-row="${esc(u.id)}">
      ${td(`<span style="font:600 11px Inter,sans-serif;font-variant-numeric:tabular-nums;white-space:nowrap">${esc(u.code)}</span>${!u.active ? ` <span style="font:600 8px Inter,sans-serif;letter-spacing:.1em;padding:2px 5px;background:#eee9df;color:#6d6459">${c.inactive}</span>` : ''}`)}
      ${td(`<span style="font-weight:600">${esc(u.name)}</span>`)}
      ${td(esc(u.description || '—'))}
      ${tdNum(`<span style="color:#2f7d4f">${money(u.prihod)}</span>`)}
      ${tdNum(`<span style="color:#9b1b22">${money(u.rashod)}</span>`)}
      ${tdNum(money(u.carryover_prev))}
      ${tdNum(`<span style="font-weight:600;color:${(u.konacno || 0) >= 0 ? '#201b16' : '#9b1b22'}">${money(u.konacno)}</span>`)}
      ${tdActs(actBtn('wuEdit', u.id, '✎', 'Edit work unit') + actBtn('wuDelete', u.id, '✕', 'Delete work unit'))}
    </tr>`).join('');
  const addForm = !st.wuOpen ? '' : `
      <div class="mxm-form" style="display:flex;gap:8px;align-items:center;padding:12px 20px;border-bottom:1px solid ${HAIR08};flex-wrap:wrap;background:#fdfbf6">
        <input data-role="wuCode" placeholder="${esc(c.sifraPh)}" aria-label="Code" style="width:160px;${INPUT}">
        <input data-role="wuName" placeholder="${esc(c.nazivPh)}" aria-label="Name" style="flex:1;min-width:170px;${INPUT}">
        <input data-role="wuDesc" placeholder="${esc(c.opisPh)}" aria-label="Description" style="flex:2;min-width:200px;${INPUT}">
        <input data-role="wuCarry" placeholder="${esc(c.carryPh)}" aria-label="Balance carried over" style="width:220px;${INPUT}">
        <span data-act="wuAdd" style="${BTN_RED}" data-hover="background:#7e151b">${COPY.owed.save}</span>
      </div>`;
  return `
    <!-- dc: Admin Money.dc.html › "WORK UNITS & GRANT BUDGETS" (rebuilt: popis radnih jedinica, full add/edit) -->
    ${card('units', 'units', c.title, c.sub,
      csvBtn('wuCsv', COPY.csvBtn('WORK UNITS', st.year, D.units.length)) + addBtn('wuToggle', c.add),
      addForm
      + tblWrap(headers, rows, 980)
      + (!D.units.length ? `<div style="padding:13px 20px;font-size:12.5px;color:#6d6459">${c.empty}</div>` : '')
      + `<div style="padding:11px 20px;font-size:11.5px;color:#6d6459">${c.foot}</div>`)}
    <!-- /dc -->`;
}

function blockReports() {
  const c = COPY.reports, r = st.report, data = st.reportData;
  const headers = [{ t: c.th.grupa[r.group] }, { t: c.th.prihod, r: 1 }, { t: c.th.rashod, r: 1 }, { t: c.th.neto, r: 1 }, { t: c.th.stavki, r: 1 }];
  const rows = data ? data.rows.map(g => `<tr>
      ${td(`<span style="font-weight:600">${esc(r.group === 'project' ? projLabel(g.key) : g.label)}</span>${g.includes_legacy ? ` <span style="font:600 8px Inter,sans-serif;letter-spacing:.1em;padding:2px 5px;background:#eee9df;color:#6d6459">${c.legacyChip}</span>` : ''}`)}
      ${tdNum(`<span style="color:#2f7d4f">${money(g.income)}</span>`)}
      ${tdNum(`<span style="color:#9b1b22">${money(g.expense)}</span>`)}
      ${tdNum(`<span style="font-weight:600;color:${g.net >= 0 ? '#201b16' : '#9b1b22'}">${money(g.net)}</span>`)}
      ${tdNum(fmt.num(g.items))}
    </tr>`).join('')
    + `<tr>
      ${td(`<span style="${MICRO}">${c.total}</span>`, 'border-top:2px solid #201b16')}
      ${td(`<span style="font-family:Fraunces,serif;font-size:14px;color:#2f7d4f;white-space:nowrap">${money(data.totals.income)}</span>`, 'text-align:right;border-top:2px solid #201b16')}
      ${td(`<span style="font-family:Fraunces,serif;font-size:14px;color:#9b1b22;white-space:nowrap">${money(data.totals.expense)}</span>`, 'text-align:right;border-top:2px solid #201b16')}
      ${td(`<span style="font-family:Fraunces,serif;font-size:14px;font-weight:600;white-space:nowrap">${money(data.totals.net)}</span>`, 'text-align:right;border-top:2px solid #201b16')}
      ${td(`<span style="font-family:Fraunces,serif;font-size:14px;white-space:nowrap">${fmt.num(data.totals.items)}</span>`, 'text-align:right;border-top:2px solid #201b16')}
    </tr>` : '';
  return `
    <!-- dc: Admin Money.dc.html › "REPORTS" (rebuilt: project · work unit · person · date range + CSV) -->
    ${card('reports', 'reports', c.title, c.sub,
      data ? csvBtn('repCsv', c.csv(r.group, st.year, data.rows.length)) : '',
      `<div class="mxm-form" style="display:flex;gap:8px;align-items:center;padding:12px 20px;border-bottom:1px solid ${HAIR08};flex-wrap:wrap">
        <select data-role="repGroup" aria-label="Report grouping" style="${INPUT}">${c.groups.map(([v, l]) => `<option value="${v}"${v === r.group ? ' selected' : ''}>${l}</option>`).join('')}</select>
        <label style="${MICRO}">${COPY.filters.from} <input type="date" lang="hr" title="dd.mm.yyyy" data-role="repFrom" value="${esc(r.from || '')}" aria-label="From date" style="${INPUT}"></label>
        <label style="${MICRO}">${COPY.filters.to} <input type="date" lang="hr" title="dd.mm.yyyy" data-role="repTo" value="${esc(r.to || '')}" aria-label="To date" style="${INPUT}"></label>
        <span data-act="repRun" style="${BTN_RED}" data-hover="background:#7e151b">${c.run}</span>
      </div>`
      + (data ? (data.rows.length ? tblWrap(headers, rows, 720) : `<div style="padding:13px 20px;font-size:12.5px;color:#6d6459">${c.empty}</div>`) : '')
      + `<div style="padding:11px 20px;font-size:11.5px;color:#6d6459">${c.foot}</div>`)}
    <!-- /dc -->`;
}

// ---------------------------------------------------------------- tools panel (legacy reads + close year)
function toolRow(cells) {
  return `<div class="mx-row" style="display:flex;align-items:center;gap:14px;padding:12px 20px;border-bottom:1px solid ${HAIR07}">${cells}</div>`;
}
const txTag = t => t.transaction_type === 'expense'
  ? { label: (t.category || t.project || 'expense').toUpperCase(), bg: '#f7e3e4', fg: '#7e151b' }
  : { label: /card|stripe/i.test(t.payment_method || '') ? 'CARD' : 'BANK', bg: '#e4efe7', fg: '#22563a' };
function toolBody() {
  const t = st.toolOpen, c = COPY;
  if (t === 'tx') {
    if (!st.tx) return `<div style="padding:16px 20px;font-size:12.5px;color:#6d6459">Reading the legacy books…</div>`;
    const rows = st.tx.map(x => toolRow(`
      <span style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#6d6459;width:70px;flex:none">${esc(dmy(x.date))}</span>
      <span class="mx-row-text" style="flex:1;font-size:13px;min-width:0">${esc(x.description || x.transaction_number || '—')}</span>
      <span style="font:600 9px Inter,sans-serif;letter-spacing:.1em;padding:3px 7px;background:${txTag(x).bg};color:${txTag(x).fg};white-space:nowrap">${esc(txTag(x).label)}</span>
      <span style="font-family:Fraunces,serif;font-size:15px;white-space:nowrap;color:${x.transaction_type === 'expense' ? '#9b1b22' : '#201b16'}">${x.transaction_type === 'expense' ? '−' : ''}${money(x.amount)}</span>`)).join('');
    return (rows || `<div style="padding:14px 20px;font-size:12.5px;color:#6d6459">${c.tx.empty}</div>`) + `<div style="padding:11px 20px;font-size:11.5px;color:#6d6459">${c.tx.foot}</div>`;
  }
  if (t === 'stripe') {
    const s = st.stripe;
    if (!s) return `<div style="padding:16px 20px;font-size:12.5px;color:#6d6459">Asking Stripe…</div>`;
    if (s.error) return `<div style="padding:16px 20px;font-size:12.5px;color:#9b1b22">${esc(s.error)}</div>`;
    if (!s.configured) return `
      <div class="empty" data-v2="stripe-gate" style="padding:30px 22px 32px">
        <span style="font:600 9px Inter,sans-serif;letter-spacing:.12em;background:#f8f1e2;color:#7a6432;padding:3px 8px">${c.stripe.gate}</span>
        <span class="empty-line" style="margin-top:6px">Stripe connects with one key.</span>
        <span class="empty-why">${esc(s.message || '')}</span>
      </div>`;
    const rows = (s.payments || []).map(p => toolRow(`
      <span style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#6d6459;width:70px;flex:none">${esc(dmy(p.date))}</span>
      <span class="mx-row-text" style="flex:1;min-width:0"><span style="display:block;font-size:13px;font-weight:600">${esc(p.name || p.email || '—')}</span><span style="display:block;font-size:11px;color:#6d6459">${esc(p.kind || '')}${p.matchDetail ? ' · ' + esc(p.matchDetail) : ''}</span></span>
      <span style="font-family:Fraunces,serif;font-size:15px;white-space:nowrap">${money(p.amount)}</span>
      <span style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:${p.matched ? '#2f7d4f' : p.matched === false ? '#9b1b22' : '#6d6459'};white-space:nowrap">${p.matched ? c.stripe.matched : p.matched === false ? c.stripe.unmatched : esc(String(p.status || '').toUpperCase())}</span>`)).join('');
    return (rows || `<div style="padding:14px 20px;font-size:12.5px;color:#6d6459">No recent Stripe payments.</div>`) + `<div style="padding:11px 20px;font-size:11.5px;color:#6d6459">${c.stripe.foot(s.fetchedAt ? fmt.when(s.fetchedAt).toLowerCase() : '')}</div>`;
  }
  if (t === 'close') {
    const fy = D.years.find(y => Number(y.year) === st.year);
    const status = fy ? String(fy.status || 'open') : 'open';
    const pastYearEnd = new Date() > new Date(st.year, 11, 31, 23, 59, 59);
    const control = status !== 'open'
      ? `<span data-act="reopenYear" style="padding:10px 14px;border:1px solid rgba(32,27,22,.2);color:#201b16;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;align-self:flex-start;cursor:pointer" data-hover="border-color:#201b16">${c.close.reopen}</span>`
      : pastYearEnd
        ? `<span data-act="closeYear" style="padding:10px 14px;background:#9b1b22;color:#fff;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;align-self:flex-start;cursor:pointer" data-hover="background:#7e151b">${c.close.closeBtn(st.year)}</span>`
        : `<span style="padding:10px 14px;border:1px solid rgba(32,27,22,.2);color:#9a9086;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;align-self:flex-start">${c.close.notYet(st.year)}</span>`;
    return `
      <div style="padding:16px 20px;display:flex;flex-direction:column;gap:9px">
        <span style="font-size:13px;line-height:1.6;color:#4a4239">${status !== 'open' ? c.close.isClosed(st.year) : c.close.body.replace('{Y}', st.year)}</span>
        ${control}
      </div>`;
  }
  return '';
}
function blockTool() {
  if (!st.toolOpen) return `<!-- dc: Admin Money.dc.html › "Finance tool panel" --><div data-block="tool"></div><!-- /dc -->`;
  const title = COPY.tools.titles[st.toolOpen];
  return `
  <!-- dc: Admin Money.dc.html › "Finance tool panel" -->
  <div data-block="tool">
    <div style="border:1px solid ${HAIR};border-top:2px solid #201b16;background:#fff">
      <div style="display:flex;align-items:center;gap:10px;padding:14px 20px;border-bottom:1px solid ${HAIR12}">
        <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${typeof title === 'function' ? title(st.year) : title}</span>
        <div style="flex:1"></div>
        <span data-act="toolClose" style="font:600 10px Inter,sans-serif;letter-spacing:.12em;color:#6d6459;cursor:pointer" data-hover="color:#9b1b22">${COPY.tools.close}</span>
      </div>
      ${toolBody()}
    </div>
  </div>
  <!-- /dc -->`;
}
function blockTools() {
  return `
    <!-- dc: Admin Money.dc.html › "FINANCE TOOLS" (trimmed: reconcile removed per Miro, books/orders/units/reports are cards now) -->
    <div data-block="tools" id="tools" style="border:1px solid ${HAIR};background:#fff;padding:16px 20px;display:flex;flex-direction:column;gap:4px">
      <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em;margin-bottom:6px">${COPY.tools.heading}</span>
      ${COPY.tools.rows.map(t => `
      <span data-act="toolOpen" data-id="${t.id}"${t.v2 ? ' data-v2="stripe-tool"' : ''} style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(32,27,22,.06);color:#201b16;cursor:pointer" data-hover="color:#9b1b22">
        <span style="font-size:12.5px;flex:1">${esc(t.name)}</span>
        <span style="font-size:11px;color:#6d6459">${esc(t.note)}</span>
        <span style="font:600 10px Inter,sans-serif;color:#9b1b22">→</span>
      </span>`).join('')}
      <span style="font-size:11px;color:#6d6459;margin-top:8px">${COPY.tools.foot}</span>
    </div>
    <!-- /dc -->`;
}

// (blockSurvey lived here until the 2026-09-02 audit, #15 — the MORNING-AFTER SURVEY card was
// email machinery on a bookkeeping screen. The card is gone; its /api/v2/money/survey* endpoints
// stay alive in backend/v2/money.js so queued survey links keep resolving. Re-homing the card
// beside the Outbox is the Inbox view's call — noted in deploy/staging/UXFIX-A3-2026-09-02.md.)

function template() {
  return `
<div data-screen-label="Admin Money" style="min-height:100vh;background:#f6f2ea;color:#201b16;font-family:Inter,sans-serif">
  <div class="mx-gutter" style="max-width:1180px;margin:0 auto;padding:30px 28px 48px;display:flex;flex-direction:column;gap:22px">
    ${blockHead()}
    ${blockStats()}
    ${blockJump()}
    <div class="mx-two" style="display:grid;grid-template-columns:1fr 1.4fr;gap:22px;align-items:start">
      ${blockMoneyIn()}
      ${blockOwed()}
    </div>
    ${blockBook('out')}
    ${blockBook('in')}
    ${blockTravel()}
    ${blockPayment()}
    ${blockUnits()}
    ${blockReports()}
    ${blockTool()}
    ${blockTools()}
  </div>
</div>`;
}

// ---------------------------------------------------------------- behaviour
function rerender(sel, html) { const el = rootEl && rootEl.querySelector(sel); if (el) el.outerHTML = html; }
const roleVal = (r, scope) => { const el = (scope || rootEl).querySelector(`[data-role="${r}"]`); return el ? el.value.trim() : ''; };
const parseAmt = v => Math.round((parseFloat(String(v).replace(',', '.').replace(/[^\d.-]/g, '')) || 0) * 100) / 100;
// a jump glides to its book (instantly for reduced-motion users) and the book it lands on glows gold once
const jumpTo = id => {
  const el = rootEl.querySelector('#' + id); if (!el) return;
  let calm = false; try { calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  el.scrollIntoView({ block: 'start', behavior: calm ? 'auto' : 'smooth' });
  el.classList.remove('mx-flash'); void el.offsetWidth; el.classList.add('mx-flash');
};

async function refreshSummary() {
  try { D.summary = await api.get('/api/v2/money/summary?year=' + st.year); } catch (e) {}
  rerender('[data-block="stats"]', blockStats());
  rerender('[data-block="moneyin"]', blockMoneyIn());
  rerender('[data-block="owed"]', blockOwed());
}
async function refreshBook(dir) {
  try { const r = await api.get('/api/v2/money/book?' + bookQ(dir)); if (dir === 'out') D.out = r; else D.inb = r; } catch (e) {}
  rerender(`[data-block="${dir === 'out' ? 'bookout' : 'bookin'}"]`, blockBook(dir));
}
async function refreshTravel() {
  try { D.travel = await api.get('/api/v2/money/travel-orders?' + travelQ()); } catch (e) {}
  rerender('[data-block="travel"]', blockTravel());
}
async function refreshPay() {
  try { D.pay = await api.get('/api/v2/money/payment-orders?' + payQ()); } catch (e) {}
  rerender('[data-block="payment"]', blockPayment());
}
async function refreshUnits() {
  try { const r = await api.get('/api/v2/money/work-units?year=' + st.year); D.units = (r && r.rows) || D.units; } catch (e) {}
  rerender('[data-block="units"]', blockUnits());
}
async function refreshExpected() {
  try { const r = await api.get('/api/v2/money/expected'); D.expected = (r && r.rows) || D.expected; } catch (e) {}
  rerender('[data-block="owed"]', blockOwed());
}
async function reloadAll() {
  D = await load(st.year);
  st.reportData = null;
  if (!rootEl) return;
  rootEl.innerHTML = template();
}
function openTool(id) {
  st.toolOpen = id;
  rerender('[data-block="tool"]', blockTool());
  if (id === 'tx' && !st.tx) {
    api.get('/api/finance/transactions?year=' + st.year)
      .then(r => { st.tx = Array.isArray(r) ? r : []; if (st.toolOpen === 'tx') rerender('[data-block="tool"]', blockTool()); })
      .catch(e => { st.tx = []; if (st.toolOpen === 'tx') rerender('[data-block="tool"]', blockTool()); ui.toast(e.message, { kind: 'error' }); });
  }
  if (id === 'stripe' && !st.stripe) {
    api.get('/api/finance/stripe-payments/recent')
      .then(r => { st.stripe = r; if (st.toolOpen === 'stripe') rerender('[data-block="tool"]', blockTool()); })
      .catch(e => { st.stripe = { error: e.message }; if (st.toolOpen === 'stripe') rerender('[data-block="tool"]', blockTool()); });
  }
  const el = rootEl.querySelector('[data-block="tool"]'); if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
}
async function downloadCsv(set, params, filename) {
  try {
    const blob = await fetchBlob('/api/v2/money/export.csv?' + qs({ set, ...params }));
    dl(blob, filename);
    ui.toast(COPY.csvStarted(filename));
  } catch (e) { ui.toast(e.message, { kind: 'error' }); }
}

// One generic edit modal: fields = [{role, label, value, type?, options?}] → PUT body via read().
function editModal(title, fields, onSave) {
  const input = f => f.options
    ? `<select data-role="${f.role}" aria-label="${esc(f.label)}" style="width:100%;box-sizing:border-box;${INPUT2}">${f.options.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(f.value == null ? '' : f.value) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`
    : `<input data-role="${f.role}" type="${f.type || 'text'}"${f.type === 'date' ? DATE_HINT : ''} value="${esc(f.value == null ? '' : f.value)}" aria-label="${esc(f.label)}" style="width:100%;box-sizing:border-box;${INPUT2}">`;
  const m = ui.modal({ eyebrow: COPY.editEyebrow, title: esc(title), body: `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px" class="mxm-editgrid">
      ${fields.map(f => `<label style="display:flex;flex-direction:column;gap:4px;${MICRO}">${esc(f.label)}${input(f)}</label>`).join('')}
    </div>
    <div data-role="mErr" style="color:#9b1b22;font-size:12px;margin-top:10px"></div>`,
    actions: [{ label: COPY.editCancel }, { label: COPY.editSave, kind: 'primary', onClick: () => {
      const read = {}; fields.forEach(f => { read[f.role] = roleVal(f.role, m.el); });
      const err = msg => { const e2 = m.el.querySelector('[data-role="mErr"]'); if (e2) e2.textContent = msg; };
      Promise.resolve(onSave(read, err)).then(v => { if (v !== false) m.close(); }).catch(e3 => err(e3.message));
      return false; // the save closes the modal itself on success
    } }] });
}
const unitOptions = () => [['', '— bez jedinice —']].concat(D.units.map(u => [u.id, `${u.code} — ${u.name}`]));

async function saveRow(path, body, after, toastMsg) {
  await api.put(path, body);
  await after();
  ui.toast(toastMsg);
}

const handlers = {
  jump: el => jumpTo(el.dataset.id),
  goMoneyIn: () => jumpTo('moneyin'),
  goOwed: () => { jumpTo('owed'); },
  goBookIn: () => jumpTo('bookin'),
  goReports: () => jumpTo('reports'),
  toolOpen: el => openTool(el.dataset.id),
  toolClose: () => { st.toolOpen = null; rerender('[data-block="tool"]', blockTool()); },
  openTx: () => openTool('tx'),
  clearFilter: async el => {
    const k = el.dataset.id;
    if (k === 'out' || k === 'inb') { st.f[k] = { project: '', work_unit: '', from: '', to: '' }; await refreshBook(k === 'out' ? 'out' : 'in'); }
    if (k === 'travel') { st.f.travel = { person: '', project: '', work_unit: '', from: '', to: '' }; await refreshTravel(); }
    if (k === 'pay') { st.f.pay = { person: '', project: '', work_unit: '', from: '', to: '' }; await refreshPay(); }
  },

  // ---- knjiga izlaznih / ulaznih računa -----------------------------------
  boToggle: () => { st.boOpen = !st.boOpen; rerender('[data-block="bookout"]', blockBook('out')); if (st.boOpen) { const i = rootEl.querySelector('[data-role="boNum"]'); if (i) i.focus(); } },
  biToggle: () => { st.biOpen = !st.biOpen; rerender('[data-block="bookin"]', blockBook('in')); if (st.biOpen) { const i = rootEl.querySelector('[data-role="biNum"]'); if (i) i.focus(); } },
  boAdd: el => bookAdd('out', el),
  biAdd: el => bookAdd('in', el),
  boEdit: el => bookEdit('out', el.dataset.id),
  biEdit: el => bookEdit('in', el.dataset.id),
  boDelete: el => bookDelete('out', el.dataset.id),
  biDelete: el => bookDelete('in', el.dataset.id),
  boSettle: el => bookSettle('out', el.dataset.id),
  biSettle: el => bookSettle('in', el.dataset.id),
  boCsv: () => downloadCsv('book_out', { year: st.year, ...st.f.out, include_legacy: 1 }, `medx-izlazni-racuni-${st.year}.csv`),
  biCsv: () => downloadCsv('book_in', { year: st.year, ...st.f.inb, include_legacy: 1 }, `medx-ulazni-racuni-${st.year}.csv`),

  // ---- putni nalozi -------------------------------------------------------
  trToggle: () => { st.trOpen = !st.trOpen; rerender('[data-block="travel"]', blockTravel()); if (st.trOpen) { const i = rootEl.querySelector('[data-role="trName"]'); if (i) i.focus(); } },
  trAdd: async el => {
    const body = { order_number: roleVal('trNum'), traveler_name: roleVal('trName'), travel_date: roleVal('trDate'), destination: roleVal('trDest'), purpose: roleVal('trPurpose'), total_cost: parseAmt(roleVal('trAmt')), opened_date: roleVal('trOpened'), work_unit_id: roleVal('trUnit') || null, project: roleVal('trProj') };
    el.setAttribute('aria-disabled', 'true');
    try {
      const r = await api.post('/api/v2/money/travel-orders', body);
      st.trOpen = false;
      await Promise.all([refreshTravel(), refreshSummary(), refreshUnits()]);
      ui.toast(COPY.travel.added(r.row.order_number));
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  trEdit: el => {
    const r = D.travel.rows.find(x => x.id === el.dataset.id); if (!r) return;
    editModal(`${r.order_number} — ${r.traveler_name}`, [
      { role: 'order_number', label: 'Broj naloga', value: r.order_number },
      { role: 'traveler_name', label: 'Full name', value: r.traveler_name },
      { role: 'travel_date', label: 'Travel date', value: r.travel_date, type: 'date' },
      { role: 'destination', label: 'Destination', value: r.destination },
      { role: 'purpose', label: 'Purpose', value: r.purpose },
      { role: 'total_cost', label: 'Total cost (€)', value: r.total_cost },
      { role: 'opened_date', label: 'Date opened', value: r.opened_date, type: 'date' },
      { role: 'work_unit_id', label: 'Work unit', value: r.work_unit_id || '', options: unitOptions() },
      { role: 'project', label: 'Project', value: r.project || 'general', options: COPY.projects }
    ], (v, err) => {
      v.total_cost = parseAmt(v.total_cost); v.work_unit_id = v.work_unit_id || null;
      return saveRow('/api/v2/money/travel-orders/' + encodeURIComponent(r.id), v,
        () => Promise.all([refreshTravel(), refreshSummary(), refreshUnits()]), COPY.travel.saved)
        .catch(e => { err(e.message); return false; });
    });
  },
  trDelete: async el => {
    const r = D.travel.rows.find(x => x.id === el.dataset.id); if (!r) return;
    if (!await ui.confirm(COPY.travel.confirmDelete(r.order_number))) return;
    try { await api.del('/api/v2/money/travel-orders/' + encodeURIComponent(r.id)); await Promise.all([refreshTravel(), refreshSummary(), refreshUnits()]); ui.toast(COPY.travel.deleted); }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  trCsv: () => downloadCsv('travel', { year: st.year, ...st.f.travel }, `medx-putni-nalozi-${st.year}.csv`),

  // ---- nalozi za plaćanje -------------------------------------------------
  poToggle: () => { st.poOpen = !st.poOpen; rerender('[data-block="payment"]', blockPayment()); if (st.poOpen) { const i = rootEl.querySelector('[data-role="poName"]'); if (i) i.focus(); } },
  poAdd: async el => {
    const body = { order_number: roleVal('poNum'), recipient_name: roleVal('poName'), description: roleVal('poDesc'), amount: parseAmt(roleVal('poAmt')), order_date: roleVal('poDate'), work_unit_id: roleVal('poUnit') || null, project: roleVal('poProj') };
    el.setAttribute('aria-disabled', 'true');
    try {
      const r = await api.post('/api/v2/money/payment-orders', body);
      st.poOpen = false;
      await Promise.all([refreshPay(), refreshSummary()]);
      ui.toast(COPY.pay.added(r.row.order_number));
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  poEdit: el => {
    const r = D.pay.rows.find(x => x.id === el.dataset.id); if (!r) return;
    editModal(`${r.order_number} — ${r.recipient_name}`, [
      { role: 'order_number', label: 'Broj naloga', value: r.order_number },
      { role: 'recipient_name', label: 'Payee', value: r.recipient_name },
      { role: 'description', label: 'Description', value: r.description },
      { role: 'amount', label: 'Amount (€)', value: r.amount },
      { role: 'order_date', label: 'Order date', value: r.order_date, type: 'date' },
      { role: 'work_unit_id', label: 'Work unit', value: r.work_unit_id || '', options: unitOptions() },
      { role: 'project', label: 'Project', value: r.project || 'general', options: COPY.projects }
    ], (v, err) => {
      v.amount = parseAmt(v.amount); v.work_unit_id = v.work_unit_id || null;
      return saveRow('/api/v2/money/payment-orders/' + encodeURIComponent(r.id), v,
        () => Promise.all([refreshPay(), refreshSummary(), refreshUnits()]), COPY.pay.saved)
        .catch(e => { err(e.message); return false; });
    });
  },
  poDelete: async el => {
    const r = D.pay.rows.find(x => x.id === el.dataset.id); if (!r) return;
    if (!await ui.confirm(COPY.pay.confirmDelete(r.order_number))) return;
    try { await api.del('/api/v2/money/payment-orders/' + encodeURIComponent(r.id)); await Promise.all([refreshPay(), refreshSummary()]); ui.toast(COPY.pay.deleted); }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  poCsv: () => downloadCsv('payment', { year: st.year, ...st.f.pay }, `medx-nalozi-za-placanje-${st.year}.csv`),

  // ---- radne jedinice -----------------------------------------------------
  wuToggle: () => { st.wuOpen = !st.wuOpen; rerender('[data-block="units"]', blockUnits()); if (st.wuOpen) { const i = rootEl.querySelector('[data-role="wuCode"]'); if (i) i.focus(); } },
  wuAdd: async el => {
    const body = { code: roleVal('wuCode'), name: roleVal('wuName'), description: roleVal('wuDesc'), carryover_prev: parseAmt(roleVal('wuCarry')) };
    el.setAttribute('aria-disabled', 'true');
    try {
      await api.post('/api/v2/money/work-units', body);
      st.wuOpen = false;
      await refreshUnits();
      rerender('[data-block="bookout"]', blockBook('out'));
      rerender('[data-block="bookin"]', blockBook('in'));
      ui.toast(COPY.units.added);
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  wuEdit: el => {
    const u = D.units.find(x => x.id === el.dataset.id); if (!u) return;
    editModal(`${u.code} — ${u.name}`, [
      { role: 'code', label: 'Code', value: u.code },
      { role: 'name', label: 'Name', value: u.name },
      { role: 'description', label: '(Pod)opis', value: u.description },
      { role: 'carryover_prev', label: 'Balance carried over (€)', value: u.carryover_prev },
      { role: 'active', label: 'Status', value: u.active ? '1' : '0', options: [['1', 'Active'], ['0', 'Inactive']] }
    ], (v, err) => {
      v.carryover_prev = parseAmt(v.carryover_prev); v.active = v.active === '1';
      return saveRow('/api/v2/money/work-units/' + encodeURIComponent(u.id), v, refreshUnits, COPY.units.saved)
        .catch(e => { err(e.message); return false; });
    });
  },
  wuDelete: async el => {
    const u = D.units.find(x => x.id === el.dataset.id); if (!u) return;
    if (!await ui.confirm(COPY.units.confirmDelete(u.code))) return;
    try { await api.del('/api/v2/money/work-units/' + encodeURIComponent(u.id)); await refreshUnits(); ui.toast(COPY.units.deleted); }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  wuCsv: () => downloadCsv('units', { year: st.year }, `medx-radne-jedinice-${st.year}.csv`),

  // ---- očekivane uplate (expected income) ---------------------------------
  exToggle: () => { st.exOpen = !st.exOpen; rerender('[data-block="owed"]', blockOwed()); if (st.exOpen) { const i = rootEl.querySelector('[data-role="exSrc"]'); if (i) i.focus(); } },
  exAdd: async el => {
    const source = roleVal('exSrc'), amount = parseAmt(roleVal('exAmt'));
    if (!source || !(amount > 0)) { ui.toast(COPY.owed.needBoth); return; }
    el.setAttribute('aria-disabled', 'true');
    try {
      await api.post('/api/v2/money/expected', { source, amount, description: roleVal('exDesc'), expected_date: roleVal('exDate'), project: roleVal('exProj'), work_unit_id: roleVal('exUnit') || null });
      st.exOpen = false;
      await Promise.all([refreshExpected(), refreshSummary()]);
      ui.toast(COPY.owed.added);
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  exReceive: async el => {
    const x = D.expected.find(r => r.id === el.dataset.id); if (!x) return;
    el.setAttribute('aria-disabled', 'true');
    try {
      await api.post('/api/v2/money/expected/' + encodeURIComponent(x.id) + '/receive');
      await Promise.all([refreshExpected(), refreshSummary()]);
      ui.toast(COPY.owed.received, { undo: async () => {
        try { await api.put('/api/v2/money/expected/' + encodeURIComponent(x.id), { status: 'open' }); await Promise.all([refreshExpected(), refreshSummary()]); ui.toast(COPY.owed.receivedUndo); }
        catch (e) { ui.toast(e.message, { kind: 'error' }); }
      } });
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  exEdit: el => {
    const x = D.expected.find(r => r.id === el.dataset.id); if (!x) return;
    editModal(x.source, [
      { role: 'source', label: 'Source', value: x.source },
      { role: 'description', label: 'Description', value: x.description },
      { role: 'amount', label: 'Amount (€)', value: x.amount },
      { role: 'expected_date', label: 'Expected date', value: x.expected_date, type: 'date' },
      { role: 'project', label: 'Project', value: x.project || 'general', options: COPY.projects },
      { role: 'work_unit_id', label: 'Work unit', value: x.work_unit_id || '', options: unitOptions() },
      { role: 'status', label: 'Status', value: x.status, options: [['open', 'Open'], ['received', 'Received'], ['cancelled', 'Cancelled']] }
    ], (v, err) => {
      v.amount = parseAmt(v.amount); v.work_unit_id = v.work_unit_id || null;
      return saveRow('/api/v2/money/expected/' + encodeURIComponent(x.id), v,
        () => Promise.all([refreshExpected(), refreshSummary()]), COPY.owed.added)
        .catch(e => { err(e.message); return false; });
    });
  },
  exDelete: async el => {
    const x = D.expected.find(r => r.id === el.dataset.id); if (!x) return;
    if (!await ui.confirm(COPY.owed.confirmDelete(x.source))) return;
    try { await api.del('/api/v2/money/expected/' + encodeURIComponent(x.id)); await Promise.all([refreshExpected(), refreshSummary()]); ui.toast(COPY.owed.deleted); }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },

  // ---- izvještaji ---------------------------------------------------------
  repRun: async el => {
    st.report.group = roleVal('repGroup') || 'project';
    st.report.from = roleVal('repFrom'); st.report.to = roleVal('repTo');
    el.setAttribute('aria-disabled', 'true');
    try {
      st.reportData = await api.get('/api/v2/money/report?' + qs({ group: st.report.group, year: st.year, from: st.report.from, to: st.report.to }));
      rerender('[data-block="reports"]', blockReports());
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  repCsv: () => downloadCsv('report', { group: st.report.group, year: st.year, from: st.report.from, to: st.report.to },
    `medx-izvjestaj-${st.report.group.replace('_', '-')}-${st.year}.csv`),

  // ---- fiscal year --------------------------------------------------------
  closeYear: async () => {
    const c1 = COPY.close.confirm1(st.year); if (!await ui.confirm(c1)) return;
    const c2 = COPY.close.confirm2(st.year); if (!await ui.confirm(c2)) return;
    try { await api.put('/api/finance/years/' + st.year, { status: 'closed' }); const y = await api.get('/api/finance/years'); D.years = Array.isArray(y) ? y : D.years; rerender('[data-block="tool"]', blockTool()); ui.toast(COPY.close.closed); }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  reopenYear: async () => {
    const ok = await ui.confirm({ title: `Reopen ${st.year}?`, body: 'Numbers become editable again — the reopening is audited.', ok: 'REOPEN', cancel: 'KEEP CLOSED' });
    if (!ok) return;
    try { await api.put('/api/finance/years/' + st.year, { status: 'open' }); const y = await api.get('/api/finance/years'); D.years = Array.isArray(y) ? y : D.years; rerender('[data-block="tool"]', blockTool()); ui.toast(COPY.close.reopened); }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
  }
};

// ---- book add/edit/delete/settle (shared for both directions) --------------
async function bookAdd(dir, el) {
  const pfx = dir === 'out' ? 'bo' : 'bi';
  const body = {
    direction: dir, invoice_number: roleVal(pfx + 'Num'), party_name: roleVal(pfx + 'Party'),
    party_oib: roleVal(pfx + 'Oib'), invoice_date: roleVal(pfx + 'Date'), amount: parseAmt(roleVal(pfx + 'Amt')),
    booking_date: roleVal(pfx + 'Book'), settled_date: roleVal(pfx + 'Settled') || null,
    work_unit_id: roleVal(pfx + 'Unit') || null, project: roleVal(pfx + 'Proj')
  };
  if (dir === 'out') body.vrsta = roleVal('boVrsta');
  el.setAttribute('aria-disabled', 'true');
  try {
    await api.post('/api/v2/money/book', body);
    if (dir === 'out') st.boOpen = false; else st.biOpen = false;
    await Promise.all([refreshBook(dir), refreshSummary(), refreshUnits()]);
    ui.toast(COPY.book.added);
  } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
}
function bookEdit(dir, id) {
  const data = dir === 'out' ? D.out : D.inb;
  const r = data.rows.find(x => x.id === id); if (!r) return;
  const fields = [
    { role: 'invoice_number', label: 'Invoice number' + (dir === 'out' ? ' (from FIRA for fiscal invoices)' : ''), value: r.invoice_number },
    { role: 'party_name', label: dir === 'out' ? 'Customer name' : 'Supplier name', value: r.party_name },
    { role: 'party_oib', label: 'OIB', value: r.party_oib },
    { role: 'invoice_date', label: 'Invoice date', value: r.invoice_date, type: 'date' },
    { role: 'amount', label: 'Amount (€)', value: r.amount },
    { role: 'booking_date', label: 'Booking date', value: r.booking_date, type: 'date' }
  ];
  if (dir === 'out') fields.push({ role: 'vrsta', label: 'Type', value: r.vrsta, options: COPY.book.vrste });
  fields.push(
    { role: 'settled_date', label: dir === 'out' ? 'Date settled' : 'Date paid', value: r.settled_date, type: 'date' },
    { role: 'work_unit_id', label: 'Work unit', value: r.work_unit_id || '', options: unitOptions() },
    { role: 'project', label: 'Project', value: r.project || 'general', options: COPY.projects },
    { role: 'notes', label: 'Note', value: r.notes }
  );
  editModal(`${r.invoice_number} — ${r.party_name}`, fields, (v, err) => {
    v.amount = parseAmt(v.amount); v.work_unit_id = v.work_unit_id || null; v.settled_date = v.settled_date || null;
    return saveRow('/api/v2/money/book/' + encodeURIComponent(r.id), v,
      () => Promise.all([refreshBook(dir), refreshSummary(), refreshUnits()]), COPY.book.saved)
      .catch(e => { err(e.message); return false; });
  });
}
async function bookDelete(dir, id) {
  const data = dir === 'out' ? D.out : D.inb;
  const r = data.rows.find(x => x.id === id); if (!r) return;
  if (!await ui.confirm(COPY.book.confirmDelete(r.invoice_number))) return;
  try { await api.del('/api/v2/money/book/' + encodeURIComponent(r.id)); await Promise.all([refreshBook(dir), refreshSummary(), refreshUnits()]); ui.toast(COPY.book.deleted); }
  catch (e) { ui.toast(e.message, { kind: 'error' }); }
}
async function bookSettle(dir, id) {
  const data = dir === 'out' ? D.out : D.inb;
  const r = data.rows.find(x => x.id === id); if (!r) return;
  try {
    await api.put('/api/v2/money/book/' + encodeURIComponent(r.id), { settled_date: fmt.ymd(new Date()) });
    await Promise.all([refreshBook(dir), refreshSummary()]);
    ui.toast(dir === 'out' ? COPY.book.settledToast : COPY.book.settledToastIn, { undo: async () => {
      try { await api.put('/api/v2/money/book/' + encodeURIComponent(r.id), { settled_date: null }); await Promise.all([refreshBook(dir), refreshSummary()]); ui.toast(COPY.book.settleUndone); }
      catch (e) { ui.toast(e.message, { kind: 'error' }); }
    } });
  } catch (e) { ui.toast(e.message, { kind: 'error' }); }
}

function onchangeDelegate(e) {
  const el = e.target.closest && e.target.closest('[data-change]');
  if (!el || !rootEl || !rootEl.contains(el)) return;
  if (el.dataset.change === 'year') {
    const y = parseInt(el.value, 10);
    if (y && y !== st.year) { st.year = y; st.tx = null; st.stripe = null; st.reportData = null; reloadAll(); }
    return;
  }
  if (el.dataset.change === 'filter') {
    const cardKey = el.dataset.card, field = el.dataset.field;
    if (!st.f[cardKey]) return;
    st.f[cardKey][field] = el.value;
    if (cardKey === 'out') refreshBook('out');
    else if (cardKey === 'inb') refreshBook('in');
    else if (cardKey === 'travel') refreshTravel();
    else if (cardKey === 'pay') refreshPay();
  }
}

function ensureCss() {
  if (document.querySelector('link[data-view-css="money"]')) { cssEl = document.querySelector('link[data-view-css="money"]'); return; }
  cssEl = document.createElement('link'); cssEl.rel = 'stylesheet'; cssEl.href = '/css/views/money.css'; cssEl.setAttribute('data-view-css', 'money');
  document.head.appendChild(cssEl);
}

// URL slugs: the Croatian ones are kept because they are already in links and bookmarks; the
// English aliases are added so the screen's own (now English) vocabulary works in the address bar.
const TAB_TARGET = { izlazni: 'bookout', ulazni: 'bookin', putni: 'travel', nalozi: 'payment', jedinice: 'units', izvjestaji: 'reports', owed: 'owed', chase: 'owed', tools: 'tools',
  outgoing: 'bookout', incoming: 'bookin', travel: 'travel', payments: 'payment', units: 'units', reports: 'reports' };

export default {
  title: 'Money',
  async render(root, ctx) {
    rootEl = root;
    ensureCss();
    st = {
      year: new Date().getFullYear(), toolOpen: null, tx: null, stripe: null,
      boOpen: false, biOpen: false, trOpen: false, poOpen: false, wuOpen: false, exOpen: false,
      f: { out: { project: '', work_unit: '', from: '', to: '' }, inb: { project: '', work_unit: '', from: '', to: '' },
           travel: { person: '', project: '', work_unit: '', from: '', to: '' }, pay: { person: '', project: '', work_unit: '', from: '', to: '' } },
      report: { group: 'project', from: '', to: '' }, reportData: null
    };
    D = await load(st.year);
    if (rootEl !== root) return; // navigated away while loading
    root.innerHTML = template();
    unbind = ui.bind(root, handlers);
    root.addEventListener('change', onchangeDelegate);
    const tab = ctx.params && ctx.params.tab;
    if (tab && TAB_TARGET[tab]) setTimeout(() => { if (rootEl === root) jumpTo(TAB_TARGET[tab]); }, 60);
    chrome.refresh();
  },
  destroy() {
    if (rootEl) rootEl.removeEventListener('change', onchangeDelegate);
    if (unbind) unbind(); unbind = null; rootEl = null; D = null; st = null;
    if (cssEl) { cssEl.remove(); cssEl = null; }
  }
};
