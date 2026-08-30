// Source: Admin Money.dc.html
// Blocks (artboard order): "Money header row" (title · sub · FISCAL YEAR) › "Finance tool panel"
// (ALL TRANSACTIONS · INVOICES (read-only, FIRA) · PAYMENT & TRAVEL ORDERS · WORK UNITS · RECONCILE
// (later state) · REPORTS · CLOSE FISCAL YEAR · STRIPE (v2)) › "Money stat row" › "RECENT MONEY IN" ›
// "PAYMENTS TO CHASE" › "SPONSORS & DONORS" › "EXPENSES" › "FINANCE TOOLS" › "BOARD PACK" ›
// v2: "MORNING-AFTER SURVEY". Header comes from js/chrome.js.
//
// ⚠ FIRA RULE (hard): invoices are issued ONLY through the FIRA fiscal system. This screen never
// generates an invoice document or number — the ledger's "invoiced" state records the FIRA number
// the admin TYPED, the invoices tool is a read-only mirror, and any queued invoice email is a
// REQUEST referencing the FIRA number (approval-gated in the Outbox), never a generated PDF.
// The artboard's "+ NEW INVOICE · numbered automatically · PDF generated" block is therefore
// intentionally NOT reproduced (decision recorded here; COPY carries the replacement wording).
import { api } from '../api.js';
import { session } from '../state.js';
import { ui, esc, fmt } from '../ui.js';
import { FACTS, galaPriceNow } from '../facts.js';
import { perms } from '../perms.js';
import { chrome } from '../chrome.js';

export const SOURCE = 'Admin Money.dc.html';

export const COPY = {
  title: 'Money', sub: 'what came in, what’s owed, and the report for the board',
  fiscalYear: 'FISCAL YEAR',
  stats: {
    collected: y => `COLLECTED IN ${y}`, collectedSub: (tx, gala) => `${fmt.plural(tx, 'entry', 'entries')} in the books · ${gala} Gala ${gala === 1 ? 'seat' : 'seats'} paid`,
    owed: 'STILL OWED TO US', owedTitle: 'Money people promised us but haven\'t paid yet — reserved Gala seats and open invoices',
    owedSub: (seats, inv) => { const bits = []; if (seats) bits.push(`${fmt.plural(seats, 'reserved Gala seat')} — chased below`); if (inv) bits.push(`${fmt.plural(inv, 'open invoice')}`); return bits.join(' · ') || 'nothing outstanding'; },
    spent: 'SPENT', spentSub: n => n ? `${fmt.plural(n, 'expense')} booked` : 'no expenses booked yet',
    net: 'NET THIS YEAR', netSub: 'collected minus spent'
  },
  tools: {
    heading: 'FINANCE TOOLS', foot: 'Each opens right here — the view appears at the top of the page.',
    rows: [
      { id: 'tx', name: 'All transactions', note: 'every euro, in and out' },
      { id: 'inv', name: 'Invoices', note: 'issued in FIRA — recorded here' },
      { id: 'orders', name: 'Payment & travel orders', note: 'putni nalozi · for speakers and team' },
      { id: 'units', name: 'Work units & grant budgets', note: 'budget lines per project or grant' },
      { id: 'rec', name: 'Reconcile bank statement', note: 'later — import lands here' },
      { id: 'rep', name: 'Reports', note: 'by project, by month' },
      { id: 'stripe', name: 'Stripe payments', note: 'read-only · recent card payments', v2: true },
      { id: 'close', name: 'Close fiscal year', note: 'end-of-year lock' }
    ],
    titles: { tx: 'ALL TRANSACTIONS', inv: 'INVOICES — RECORDED FROM FIRA', orders: 'PAYMENT & TRAVEL ORDERS (PUTNI NALOZI)', units: 'WORK UNITS & GRANT BUDGETS', rec: 'RECONCILE BANK STATEMENT', rep: y => `REPORTS — MONEY IN BY PROJECT, ${y}`, stripe: 'STRIPE — RECENT CARD PAYMENTS', close: y => `CLOSE FISCAL YEAR ${y}` },
    close: '✕ CLOSE'
  },
  tx: { foot: 'Every euro in and out, newest first — expenses show as red.', empty: 'Nothing in the books yet for this year.' },
  inv: {
    foot: 'Invoices are issued in FIRA, never here — this list mirrors what was recorded, and ledger rows carry their FIRA number.',
    empty: y => `No invoices on file for ${y}. Issue them in FIRA and record the number on the sponsor’s ledger row below.`,
    fiscal: 'FISCALIZED ✓'
  },
  orders: {
    foot: 'Travel orders (putni nalozi) and payment orders route to whoever signs — signed PDFs archive themselves in the team library.',
    empty: 'No orders yet — draft the first one below.', placeholder: 'What — e.g. Travel order, speaker flight ZAG→BOS', add: '+ NEW ORDER',
    doc: 'DOCUMENT', added: 'ORDER DRAFTED', needWhat: 'DESCRIBE THE ORDER FIRST', needAmt: 'ADD A € AMOUNT FIRST'
  },
  units: { foot: 'Work units mirror the old portal — each project or grant gets a budget line; expenses booked against it show here.', empty: 'No budget lines yet for this year — they are created with each grant or project budget.' },
  rec: {
    later: 'LATER', line: 'Bank import lands here later.',
    why: 'Reconciliation — importing the bank statement and matching transfers to seats — is on the build list, one step behind. Card payments already match themselves through Stripe, and MARK PAID on a chase row books the income today.'
  },
  rep: { monthly: 'INCOME BY MONTH', foot: y => `Money in by project, ${y} — every bar is a live read from the ledger.`, empty: 'No income booked yet for this year.' },
  stripe: { gate: 'STRIPE KEY NOT SET', matched: 'MATCHED ✓', unmatched: 'NO PORTAL RECORD', foot: at => `Read-only view of the Stripe account — refreshed ${at || 'just now'}, cached for a minute.` },
  close: {
    body: 'Closing locks every {Y} number forever — receipts, invoices and reports stay readable but nothing can change. It asks twice, and only works after December 31.',
    notYet: y => `AVAILABLE AFTER DEC 31, ${y}`, closeBtn: y => `CLOSE ${y} FOR GOOD`, reopen: 'REOPEN THE YEAR',
    isClosed: y => `Fiscal year ${y} is closed — every number is locked. Reopen it only to correct a genuine error.`,
    confirm1: y => ({ title: `Close ${y}?`, body: 'Every transaction, invoice and order for the year becomes read-only.', ok: 'CONTINUE', cancel: 'KEEP IT OPEN' }),
    confirm2: y => ({ title: 'Asking twice, as promised.', body: `This locks ${y} for good — reopening later is possible but audited.`, ok: `CLOSE ${y}`, cancel: 'CANCEL' }),
    closed: 'YEAR CLOSED — EVERY NUMBER IS NOW READ-ONLY', reopened: 'YEAR REOPENED'
  },
  moneyIn: { title: 'RECENT MONEY IN', all: 'ALL TRANSACTIONS →', foot: 'Card payments arrive via Stripe · bank transfers are matched by reference number', empty: 'Nothing received yet this year.' },
  chase: {
    title: 'PAYMENTS TO CHASE', note: 'reminders wait in the Outbox for your OK',
    sub: g => `Gala seat · reserved ${fmt.longRange(g.created_at)}`,
    queue: 'QUEUE REMINDER', queued: 'REMINDER QUEUED ✓', paid: 'MARK PAID', empty: 'Everyone has paid — nothing to chase.',
    queuedToast: 'REMINDER QUEUED — SENDS AFTER YOUR OK IN THE OUTBOX', paidToast: 'MARKED PAID — COLLECTED & LEDGER UPDATED',
    confirmPaid: (name, amt) => ({ title: `Mark ${name} as paid?`, body: `Books ${amt} into the finance ledger and frees the seat from this list. There is no un-pay — confirm only when the money arrived.`, ok: 'MARK PAID', cancel: 'NOT YET' })
  },
  ledger: {
    title: 'SPONSORS &amp; DONORS', flow: 'pledge → invoice → paid → thanked', newPledge: '+ NEW PLEDGE',
    namePh: 'Who — company or person', amtPh: '€ amount', emailPh: 'Email — for invoice notice & thank-you (optional)', add: 'ADD',
    kinds: [['sponsor', 'SPONSOR'], ['donor', 'DONOR']], events: ['Donor Night', 'Auction', 'Gala Evening', 'Plexus Week', 'Accelerator', 'General'],
    stage: { pledge: 'PLEDGED', invoiced: 'INVOICED', paid: 'PAID', thanked: 'THANKED' },
    action: { pledge: 'RECORD FIRA INVOICE', invoiced: 'MARK PAID', paid: 'SEND THANK-YOU', thanked: 'HISTORY' },
    sums: ['PLEDGED', 'INVOICED', 'PAID', 'THANKED'], foot: 'every pledge and auction result lands here',
    added: 'PLEDGE RECORDED', needBoth: 'NEED A NAME AND AN AMOUNT',
    firaModal: { eyebrow: 'FIRA — RECORD THE INVOICE', title: 'Type the FIRA invoice number.',
      body: 'The invoice itself is issued in FIRA — the portal only records the number. Optionally queue a notice email that references it; nothing sends without your OK in the Outbox.',
      numPh: 'FIRA invoice number — e.g. 26-100-0042', queueLabel: 'Queue the invoice notice for approval in the Outbox', ok: 'RECORD', cancel: 'CANCEL',
      needNum: 'The FIRA number is required — invoices exist only in FIRA.', needEmail: 'Add a contact email to queue the notice.' },
    thanksModal: { eyebrow: 'THANK-YOU', title: 'Where should the thank-you go?', body: 'The thank-you email queues in the Outbox and sends only after your OK there.', emailPh: 'contact@example.com', ok: 'QUEUE THANK-YOU', cancel: 'CANCEL', needEmail: 'An email address is needed for the thank-you.' },
    invoiced: 'FIRA INVOICE RECORDED', invoicedQueued: 'FIRA RECORDED — NOTICE QUEUED IN THE OUTBOX', markedPaid: 'MARKED PAID — LEDGER UPDATED', thanked: 'THANK-YOU QUEUED IN THE OUTBOX',
    undone: 'PUT BACK', historyEyebrow: 'LEDGER HISTORY'
  },
  expenses: {
    title: 'EXPENSES', note: 'type them in — totals update everywhere', empty: 'Nothing booked yet — add the first expense below.',
    ph: 'What — e.g. Esplanade deposit', amtPh: '€ amount', add: 'ADD', added: 'BOOKED — TOTALS UPDATED EVERYWHERE', needBoth: 'NEED A DESCRIPTION AND AN AMOUNT',
    projects: [['Plexus Week', 'plexus', null], ['Gala', 'plexus', 'gala'], ['Accelerator', 'accelerator', null], ['Bridges', 'bridges', null], ['Forum', 'forum', null], ['General', 'general', null]]
  },
  board: {
    title: 'BOARD PACK', lang: 'LANGUAGE', preview: 'PREVIEW', pdf: 'PDF', word: 'WORD',
    body: 'Quarterly and annual reviews, generated from live numbers — nothing typed in by hand. Every figure is read from the database the moment you press the button.',
    cells: [['members', 'MEMBERS'], ['countries', 'COUNTRIES'], ['events', 'EVENTS'], ['registrations', 'REGISTRATIONS']],
    period: y => `Annual · ${y}`
  },
  survey: {
    title: 'MORNING-AFTER SURVEY', sub: 'queues at 08:00 the day after each event — 3 questions, approved like any email; answers feed the Board pack',
    sweep: 'RUN SWEEP NOW', sweepTitle: 'Checks now instead of waiting for the 10-minute timer',
    state: {
      scheduled: e => `queues ${fmt.dayLabel(e.queue_at)} · 08:00`,
      due: 'due — the sweep queues it within 10 minutes',
      queued: e => `${fmt.plural(e.awaiting_approval || e.sent, 'email')} awaiting your OK — Outbox →`,
      sent: e => `${e.answered} of ${e.sent} answered`, missed: 'window passed — not queued'
    },
    results: r => `${r.n_answered}/${r.n_sent} answered${r.avg_q1 != null ? ` · avg ${r.avg_q1}/10` : ''}${r.yes_pct != null ? ` · ${r.yes_pct}% would return` : ''}`,
    swept: n => n ? `SWEPT — ${fmt.plural(n, 'BATCH', 'BATCHES')} QUEUED FOR YOUR OK` : 'NOTHING DUE — IT QUEUES AT 08:00 AFTER EACH EVENT',
    empty: 'No dated events found — surveys attach themselves to conference and Bridges dates.'
  },
  lockedGala: 'Gala rows need Plexus access — the rest of Money still works.'
};

const HAIR = 'rgba(32,27,22,.14)', HAIR12 = 'rgba(32,27,22,.12)', HAIR08 = 'rgba(32,27,22,.08)', HAIR07 = 'rgba(32,27,22,.07)';
const STAGE_TAG = { pledge: ['#fdf3df', '#8a6116'], invoiced: ['#eee9df', '#4a4239'], paid: ['#e4efe7', '#22563a'], thanked: ['#e4efe7', '#22563a'] };
const SURVEY_DOT = { scheduled: '#6d6459', due: '#b7791f', queued: '#c9a962', sent: '#2f7d4f', missed: '#9a9086' };

let D = null, st = null, unbind = null, rootEl = null, cssEl = null;

const isLocked = key => !!(D && D.errors[key] && D.errors[key].isLocked);

// ---------------------------------------------------------------- data
async function load(year) {
  const r = await api.settle({
    fin: api.get('/api/finance/dashboard?year=' + year),
    years: api.get('/api/finance/years'),
    tx: api.get('/api/finance/transactions?year=' + year),
    invoices: api.get('/api/finance/invoices'),
    gala: api.get('/api/admin/gala/registrations'),
    gs: api.get('/api/admin/gala/settings'),
    nag: api.get('/api/admin/nag/items'),
    chaseQ: api.get('/api/v2/money/chase'),
    ledger: api.get('/api/v2/money/ledger'),
    facts: api.get('/api/admin/transparency/facts?year=' + year),
    wu: api.get('/api/finance/reports/by-work-unit?year=' + year),
    po: api.get('/api/finance/payment-orders?year=' + year),
    to: api.get('/api/finance/travel-orders?year=' + year),
    rep: api.get('/api/finance/reports/by-project?year=' + year),
    repM: api.get('/api/finance/reports/monthly?year=' + year),
    survey: api.get('/api/v2/money/survey')
  });
  const galaRows = Array.isArray(r.gala) ? r.gala : [];
  const paid = galaRows.filter(g => g.payment_status === 'paid');
  const toChase = galaRows.filter(g => g.payment_status !== 'paid' && !['rejected', 'cancelled'].includes(String(g.status || '')))
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  const tx = Array.isArray(r.tx) ? r.tx : [];
  const invoices = (Array.isArray(r.invoices) ? r.invoices : []).filter(i => !i.fiscal_year || Number(i.fiscal_year) === Number(year));
  const nagByGala = {};
  (((r.nag || {}).items) || []).forEach(n => { if (n.kind === 'gala_unpaid') nagByGala[n.subject_id || (n.action_payload && n.action_payload.gala_id) || ''] = n; });
  return {
    errors: r.$errors, fin: r.fin || {}, years: Array.isArray(r.years) ? r.years : [],
    tx, txIncome: tx.filter(t => t.transaction_type === 'income'), txExpense: tx.filter(t => t.transaction_type === 'expense'),
    invoices, gala: { rows: galaRows, paid, toChase }, gs: r.gs || {}, price: galaPriceNow(r.gs || {}),
    nagByGala, chaseQueued: (r.chaseQ && r.chaseQ.queued) || {},
    ledger: (r.ledger && Array.isArray(r.ledger.rows)) ? r.ledger.rows : [], ledgerSums: (r.ledger && r.ledger.sums) || { pledge: 0, invoiced: 0, paid: 0, thanked: 0 },
    facts: (r.facts && r.facts.facts) || null,
    wu: Array.isArray(r.wu) ? r.wu : [], po: Array.isArray(r.po) ? r.po : [], to: Array.isArray(r.to) ? r.to : [],
    rep: Array.isArray(r.rep) ? r.rep : [], repM: Array.isArray(r.repM) ? r.repM : [],
    survey: (r.survey && Array.isArray(r.survey.events)) ? r.survey.events : [], surveyResults: null
  };
}

const chaseIsQueued = g => !!(st.queuedLocal[g.id] || D.chaseQueued[String(g.email || '').toLowerCase()] || (D.nagByGala[g.id] && D.nagByGala[g.id].status === 'actioned'));
const openInvoices = () => D.invoices.filter(i => i.status === 'issued' || i.status === 'sent');
const owedTotal = () => D.gala.toChase.length * D.price + openInvoices().reduce((n, i) => n + (Number(i.total) || 0), 0)
  + D.ledger.filter(l => l.status === 'invoiced').reduce((n, l) => n + (Number(l.amount) || 0), 0);
const txTag = t => t.transaction_type === 'expense'
  ? { label: (t.category || t.project || 'expense').toUpperCase(), bg: '#f7e3e4', fg: '#7e151b' }
  : { label: /card|stripe/i.test(t.payment_method || '') ? 'CARD' : 'BANK', bg: '#e4efe7', fg: '#22563a' };
const projLabel = p => ({ plexus: 'Plexus Week', accelerator: 'Accelerator', forum: 'Forum', bridges: 'Bridges', general: 'General' }[p] || p || 'General');

async function fetchBlob(path) {
  const res = await fetch(api.url(path), { headers: { Authorization: 'Bearer ' + session.token } });
  if (!res.ok) { let j = null; try { j = JSON.parse(await res.text()); } catch (e) {} throw new Error((j && (j.message || j.error)) || ('The export failed (HTTP ' + res.status + ').')); }
  return res.blob();
}

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

function toolRow(cells) { // one list row inside a tool panel (artboard row vocabulary)
  return `<div class="mx-row" style="display:flex;align-items:center;gap:14px;padding:12px 20px;border-bottom:1px solid ${HAIR07}">${cells}</div>`;
}
function toolBody() {
  const t = st.toolOpen, c = COPY;
  if (t === 'tx') {
    const rows = D.tx.map(x => toolRow(`
      <span style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#6d6459;width:46px;flex:none">${esc(fmt.dayLabel(x.date))}</span>
      <span class="mx-row-text" style="flex:1;font-size:13px;min-width:0">${esc(x.description || x.transaction_number || '—')}</span>
      <span style="font:600 9px Inter,sans-serif;letter-spacing:.1em;padding:3px 7px;background:${txTag(x).bg};color:${txTag(x).fg};white-space:nowrap">${esc(txTag(x).label)}</span>
      <span style="font-family:Fraunces,serif;font-size:15px;white-space:nowrap;color:${x.transaction_type === 'expense' ? '#9b1b22' : '#201b16'}">${x.transaction_type === 'expense' ? '−' : ''}${fmt.eur(x.amount)}</span>`)).join('');
    return (rows || `<div style="padding:14px 20px;font-size:12.5px;color:#6d6459">${c.tx.empty}</div>`) + `<div style="padding:11px 20px;font-size:11.5px;color:#6d6459">${c.tx.foot}</div>`;
  }
  if (t === 'inv') {
    const tag = s => s === 'paid' ? ['#e4efe7', '#22563a'] : s === 'draft' ? ['#fdf3df', '#8a6116'] : ['#eee9df', '#4a4239'];
    const rows = D.invoices.map(i => { const tg = tag(i.status); return toolRow(`
      <span style="font:600 11px ui-monospace,monospace;flex:none">${esc(i.invoice_number || '—')}</span>
      <span class="mx-row-text" style="flex:1;font-size:13px;min-width:0">${esc(i.party_name || '')}${i.notes ? ` <span style="color:#6d6459">· ${esc(i.notes)}</span>` : ''}</span>
      <span style="font-family:Fraunces,serif;font-size:15px;white-space:nowrap">${fmt.eur(i.total)}</span>
      <span style="font:600 9px Inter,sans-serif;letter-spacing:.12em;padding:4px 9px;background:${tg[0]};color:${tg[1]};white-space:nowrap">${esc(String(i.status || '').toUpperCase())}${i.direction === 'incoming' ? ' · IN' : ''}</span>
      ${Number(i.fiscalized) ? `<span style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#2f7d4f;white-space:nowrap">${c.inv.fiscal}</span>` : ''}`); }).join('');
    return (rows || `<div style="padding:14px 20px;font-size:12.5px;color:#6d6459">${c.inv.empty(st.year)}</div>`) + `<div style="padding:11px 20px;font-size:11.5px;color:#6d6459">${c.inv.foot}</div>`;
  }
  if (t === 'orders') {
    const stTag = s => /paid|approved|signed/i.test(s) ? ['#e4efe7', '#22563a'] : /assigned|submitted|pending/i.test(s) ? ['#eee9df', '#4a4239'] : ['#fdf3df', '#8a6116'];
    const all = D.po.map(o => ({ kind: 'PAYMENT', what: [o.recipient_name, o.description].filter(Boolean).join(' — '), amount: o.amount, stage: String(o.status || 'draft'), id: o.id, doc: false }))
      .concat(D.to.map(o => ({ kind: 'TRAVEL', what: [o.destination, o.traveler_name].filter(Boolean).join(' — '), amount: o.advance_amount, stage: String(o.status || 'assigned'), id: o.id, doc: true })));
    const rows = all.map(o => { const tg = stTag(o.stage); return toolRow(`
      <span style="font:600 8.5px Inter,sans-serif;letter-spacing:.1em;color:#6d6459;width:52px;flex:none">${o.kind}</span>
      <span class="mx-row-text" style="flex:1;font-size:13px;min-width:0">${esc(o.what || '—')}</span>
      <span style="font-family:Fraunces,serif;font-size:15px">${fmt.eur(o.amount || 0)}</span>
      <span style="font:600 9px Inter,sans-serif;letter-spacing:.12em;padding:4px 9px;background:${tg[0]};color:${tg[1]};white-space:nowrap">${esc(o.stage.replace(/_/g, ' ').toUpperCase())}</span>
      ${o.doc ? `<span data-act="orderDoc" data-id="${esc(o.id)}" style="padding:7px 11px;border:1px solid rgba(32,27,22,.2);font:600 9px Inter,sans-serif;letter-spacing:.12em;cursor:pointer;white-space:nowrap" data-hover="border-color:#201b16">${c.orders.doc}</span>` : ''}`); }).join('');
    return (rows || `<div style="padding:14px 20px;font-size:12.5px;color:#6d6459">${c.orders.empty}</div>`) + `
      <div style="display:flex;gap:8px;align-items:center;padding:12px 20px;flex-wrap:wrap">
        <select data-role="noKind" aria-label="Order kind" style="border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:8px;font:400 12.5px Inter,sans-serif;color:#201b16"><option>TRAVEL</option><option>PAYMENT</option></select>
        <input data-role="noWhat" placeholder="${esc(c.orders.placeholder)}" aria-label="Order description" style="flex:1;min-width:180px;border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:8px 10px;font:400 12.5px Inter,sans-serif;color:#201b16">
        <input data-role="noAmt" placeholder="€" aria-label="Order amount" style="width:70px;border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:8px 10px;font:400 12.5px Inter,sans-serif;color:#201b16">
        <span data-act="addOrder" style="padding:8px 13px;background:#9b1b22;color:#fff;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer">${c.orders.add}</span>
      </div>
      <div style="padding:0 20px 12px;font-size:11.5px;color:#6d6459">${c.orders.foot}</div>`;
  }
  if (t === 'units') {
    const rows = D.wu.map(u => { const total = Number(u.budget_total) || 0; const used = Number(u.budget_used) || 0; const pct = total ? Math.min(100, Math.round(used / total * 100)) : 0; return toolRow(`
      <span class="mx-row-text" style="flex:1;min-width:0"><span style="display:block;font-size:13px;font-weight:600">${esc(u.name || u.code || '—')}</span><span style="display:block;font-size:11px;color:#6d6459">${esc(u.code || '')}</span></span>
      <span style="width:140px;height:8px;background:rgba(32,27,22,.08);flex:none"><span style="display:block;width:${pct}%;height:100%;background:#c9a962"></span></span>
      <span style="font:600 10px Inter,sans-serif;color:#4a4239;white-space:nowrap">${fmt.eur(used)} of ${fmt.eur(total)}</span>`); }).join('');
    return (rows || `<div style="padding:14px 20px;font-size:12.5px;color:#6d6459">${c.units.empty}</div>`) + `<div style="padding:11px 20px;font-size:11.5px;color:#6d6459">${c.units.foot}</div>`;
  }
  if (t === 'rec') { // spec-only: bank import is NOT built — this is the deliberate "later" state
    return `
      <div class="empty" data-v2="reconcile-later" style="padding:30px 22px 32px">
        <span style="font:600 9px Inter,sans-serif;letter-spacing:.12em;background:#f8f1e2;color:#7a6432;padding:3px 8px">${COPY.rec.later}</span>
        <span class="empty-line" style="margin-top:6px">${COPY.rec.line}</span>
        <span class="empty-why">${COPY.rec.why}</span>
      </div>`;
  }
  if (t === 'rep') {
    const income = D.rep.map(r => ({ name: projLabel(r.project), v: Number(r.total_income) || 0 })).filter(r => r.v > 0).sort((a, b) => b.v - a.v);
    const max = Math.max(1, ...income.map(r => r.v));
    const colors = ['#9b1b22', '#c9a962', '#201b16', '#3f5f8a', '#6a4a8c'];
    const bars = income.map((r, i) => `
      <div style="display:flex;align-items:center;gap:10px"><span style="width:130px;flex:none;font-size:12.5px">${esc(r.name)}</span><span style="flex:1;height:10px;background:rgba(32,27,22,.06)"><span style="display:block;width:${Math.round(r.v / max * 100)}%;height:100%;background:${colors[i % colors.length]}"></span></span><span style="font:600 11px Inter,sans-serif;width:64px;text-align:right">${fmt.eur(r.v)}</span></div>`).join('');
    const months = D.repM.filter(m => Number(m.income) > 0 || Number(m.expenses) > 0)
      .map(m => `<span style="font:600 9.5px Inter,sans-serif;letter-spacing:.1em;color:#4a4239;white-space:nowrap">${esc(String(m.month || '').toUpperCase())} <span style="color:#2f7d4f">${fmt.eur(m.income || 0)}</span>${Number(m.expenses) ? ` <span style="color:#9b1b22">−${fmt.eur(m.expenses)}</span>` : ''}</span>`).join('');
    return `
      <div style="padding:14px 20px;display:flex;flex-direction:column;gap:8px">
        ${bars || `<span style="font-size:12.5px;color:#6d6459">${COPY.rep.empty}</span>`}
        ${months ? `<div style="margin-top:8px"><span style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:#6d6459">${COPY.rep.monthly}</span><div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:6px">${months}</div></div>` : ''}
        <span style="font-size:11.5px;color:#6d6459;margin-top:4px">${COPY.rep.foot(st.year)}</span>
      </div>`;
  }
  if (t === 'stripe') { // v2 tool (read-only; key-gated on the server)
    const s = st.stripe;
    if (!s) return `<div style="padding:16px 20px;font-size:12.5px;color:#6d6459">Asking Stripe…</div>`;
    if (s.error) return `<div style="padding:16px 20px;font-size:12.5px;color:#9b1b22">${esc(s.error)}</div>`;
    if (!s.configured) return `
      <div class="empty" data-v2="stripe-gate" style="padding:30px 22px 32px">
        <span style="font:600 9px Inter,sans-serif;letter-spacing:.12em;background:#f8f1e2;color:#7a6432;padding:3px 8px">${COPY.stripe.gate}</span>
        <span class="empty-line" style="margin-top:6px">Stripe connects with one key.</span>
        <span class="empty-why">${esc(s.message || '')}</span>
      </div>`;
    const rows = (s.payments || []).map(p => toolRow(`
      <span style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#6d6459;width:46px;flex:none">${esc(fmt.dayLabel(p.date))}</span>
      <span class="mx-row-text" style="flex:1;min-width:0"><span style="display:block;font-size:13px;font-weight:600">${esc(p.name || p.email || '—')}</span><span style="display:block;font-size:11px;color:#6d6459">${esc(p.kind || '')}${p.matchDetail ? ' · ' + esc(p.matchDetail) : ''}</span></span>
      <span style="font-family:Fraunces,serif;font-size:15px;white-space:nowrap">${fmt.eur(p.amount)}</span>
      <span style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:${p.matched ? '#2f7d4f' : p.matched === false ? '#9b1b22' : '#6d6459'};white-space:nowrap">${p.matched ? COPY.stripe.matched : p.matched === false ? COPY.stripe.unmatched : esc(String(p.status || '').toUpperCase())}</span>`)).join('');
    return (rows || `<div style="padding:14px 20px;font-size:12.5px;color:#6d6459">No recent Stripe payments.</div>`) + `<div style="padding:11px 20px;font-size:11.5px;color:#6d6459">${COPY.stripe.foot(s.fetchedAt ? fmt.when(s.fetchedAt).toLowerCase() : '')}</div>`;
  }
  if (t === 'close') {
    const fy = D.years.find(y => Number(y.year) === st.year);
    const status = fy ? String(fy.status || 'open') : 'open';
    const pastYearEnd = new Date() > new Date(st.year, 11, 31, 23, 59, 59);
    const control = status !== 'open'
      ? `<span data-act="reopenYear" style="padding:10px 14px;border:1px solid rgba(32,27,22,.2);color:#201b16;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;align-self:flex-start;cursor:pointer" data-hover="border-color:#201b16">${COPY.close.reopen}</span>`
      : pastYearEnd
        ? `<span data-act="closeYear" style="padding:10px 14px;background:#9b1b22;color:#fff;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;align-self:flex-start;cursor:pointer" data-hover="background:#7e151b">${COPY.close.closeBtn(st.year)}</span>`
        : `<span style="padding:10px 14px;border:1px solid rgba(32,27,22,.2);color:#9a9086;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;align-self:flex-start">${COPY.close.notYet(st.year)}</span>`;
    return `
      <div style="padding:16px 20px;display:flex;flex-direction:column;gap:9px">
        <span style="font-size:13px;line-height:1.6;color:#4a4239">${status !== 'open' ? COPY.close.isClosed(st.year) : COPY.close.body.replace('{Y}', st.year)}</span>
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

function blockStats() {
  const c = COPY.stats;
  const owed = owedTotal();
  const net = (Number(D.fin.totalIncome) || 0) - (Number(D.fin.totalExpenses) || 0);
  const cell = (extra, act, k, v, sub, vColor, title) => `
      <span data-act="${act}"${title ? ` title="${esc(title)}"` : ''} style="padding:18px 22px;${extra}display:block;color:#201b16;cursor:pointer" data-hover="background:#fdfbf6">
        <span style="display:block;font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#6d6459">${k}</span>
        <span class="mx-display-32" style="display:block;font-family:Fraunces,serif;font-size:32px;margin-top:4px${vColor ? ';color:' + vColor : ''}">${v}</span>
        <span style="display:block;font-size:11.5px;color:#6d6459">${sub}</span>
      </span>`;
  return `
  <!-- dc: Admin Money.dc.html › "Money stat row" -->
  <div data-block="stats" class="mx-kpi" style="border:1px solid ${HAIR};background:#fff;display:grid;grid-template-columns:repeat(4,1fr)">
    ${cell(`border-right:1px solid ${HAIR12};`, 'openTx', c.collected(st.year), fmt.eur(D.fin.totalIncome || 0), esc(c.collectedSub(D.txIncome.length, isLocked('gala') ? 0 : D.gala.paid.length)))}
    ${cell(`border-right:1px solid ${HAIR12};`, 'goChase', c.owed, fmt.eur(owed), esc(c.owedSub(isLocked('gala') ? 0 : D.gala.toChase.length, openInvoices().length)), '#9b1b22', c.owedTitle)}
    ${cell(`border-right:1px solid ${HAIR12};`, 'goExpenses', c.spent, fmt.eur(D.fin.totalExpenses || 0), esc(c.spentSub(D.txExpense.length)))}
    ${cell('', 'openRep', c.net, fmt.eur(net), c.netSub, net >= 0 ? '#2f7d4f' : '#9b1b22')}
  </div>
  <!-- /dc -->`;
}

function blockMoneyIn() {
  const rows = D.txIncome.slice(0, 5);
  return `
    <!-- dc: Admin Money.dc.html › "RECENT MONEY IN" -->
    <div data-block="moneyin" style="border:1px solid ${HAIR};background:#fff">
      <div style="display:flex;align-items:center;gap:10px;padding:14px 20px;border-bottom:1px solid ${HAIR12}">
        <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${COPY.moneyIn.title}</span>
        <div style="flex:1"></div>
        <span data-act="openTx" style="font:600 10px Inter,sans-serif;letter-spacing:.13em;color:#9b1b22;cursor:pointer" data-hover="color:#201b16">${COPY.moneyIn.all}</span>
      </div>
      ${rows.map(t => `
      <div style="display:flex;align-items:center;gap:14px;padding:12px 20px;border-bottom:1px solid ${HAIR07}">
        <span style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#6d6459;width:46px;flex:none">${esc(fmt.dayLabel(t.date))}</span>
        <span style="flex:1;font-size:13px">${esc(t.description || t.transaction_number || '—')}</span>
        <span style="font:600 9px Inter,sans-serif;letter-spacing:.1em;padding:3px 7px;background:#e4efe7;color:#22563a;white-space:nowrap">${esc(txTag(t).label)}</span>
        <span style="font-family:Fraunces,serif;font-size:15px;white-space:nowrap">${fmt.eur(t.amount)}</span>
      </div>`).join('')}
      ${!rows.length ? `<div style="padding:14px 20px;font-size:12.5px;color:#6d6459">${COPY.moneyIn.empty}</div>` : ''}
      <div style="padding:11px 20px;font-size:11.5px;color:#6d6459">${COPY.moneyIn.foot}</div>
    </div>
    <!-- /dc -->`;
}

function blockChase() {
  const c = COPY.chase;
  if (isLocked('gala')) return `
    <!-- dc: Admin Money.dc.html › "PAYMENTS TO CHASE" -->
    <div data-block="chase" id="chase" style="border:1px solid ${HAIR};background:#fff">
      <div style="display:flex;align-items:center;gap:10px;padding:14px 20px;border-bottom:1px solid ${HAIR12}"><span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${c.title}</span></div>
      ${ui.lockedBlock(perms.label('plexus'), COPY.lockedGala)}
    </div>
    <!-- /dc -->`;
  const rows = D.gala.toChase;
  return `
    <!-- dc: Admin Money.dc.html › "PAYMENTS TO CHASE" -->
    <div data-block="chase" id="chase" style="border:1px solid ${HAIR};background:#fff">
      <div style="display:flex;align-items:center;gap:10px;padding:14px 20px;border-bottom:1px solid ${HAIR12}">
        <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${c.title}</span>
        <a href="/inbox/outbox" style="min-width:18px;height:18px;padding:0 5px;background:#9b1b22;color:#fff;font:600 11px Inter,sans-serif;display:inline-flex;align-items:center;justify-content:center" title="${esc(c.note)}">${rows.length}</a>
        <div style="flex:1"></div>
        <span style="font-size:11.5px;color:#6d6459">${c.note}</span>
      </div>
      ${rows.map(g => { const queued = chaseIsQueued(g); const name = [g.first_name, g.last_name].filter(Boolean).join(' '); return `
      <div data-row="${esc(g.id)}" class="mx-row" style="display:flex;align-items:center;gap:14px;padding:13px 20px;border-bottom:1px solid ${HAIR08}">
        <a href="/gala" class="mx-row-text" style="flex:1;min-width:0;color:#201b16" data-hover="color:#9b1b22">
          <span style="display:block;font-size:13.5px;font-weight:600">${esc(name)}</span>
          <span style="display:block;font-size:11.5px;color:#6d6459;margin-top:2px">${esc(c.sub(g))}</span>
        </a>
        <span style="font-family:Fraunces,serif;font-size:17px;white-space:nowrap">${fmt.eur(D.price)}</span>
        ${queued
          ? `<span style="font:600 9.5px Inter,sans-serif;letter-spacing:.12em;color:#2f7d4f;white-space:nowrap">${c.queued}</span>`
          : `<span data-act="chaseQueue" data-id="${esc(g.id)}" style="padding:8px 13px;background:#9b1b22;color:#fff;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap" data-hover="background:#7e151b">${c.queue}</span>`}
        <span data-act="chasePaid" data-id="${esc(g.id)}" style="padding:8px 12px;border:1px solid rgba(32,27,22,.2);font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;color:#201b16;white-space:nowrap" data-hover="border-color:#201b16">${c.paid}</span>
      </div>`; }).join('')}
      ${!rows.length ? `<div style="padding:26px 20px;text-align:center;font-size:13px;color:#6d6459">${c.empty}</div>` : ''}
    </div>
    <!-- /dc -->`;
}

function ledgerSub(l) {
  const bits = [l.kind === 'donor' ? 'Donor' : 'Sponsor'];
  if (l.event_ref) bits.push(l.event_ref);
  if (l.status === 'pledge' && l.pledged_at) bits.push('pledged ' + fmt.longRange(l.pledged_at));
  if (l.status === 'invoiced') bits.push('FIRA ' + (l.fira_invoice_number || '—'));
  if (l.status === 'paid' && l.paid_at) bits.push('paid ' + fmt.longRange(l.paid_at));
  if (l.status === 'thanked' && l.thanked_at) bits.push('thanked ' + fmt.longRange(l.thanked_at));
  if (l.notes) bits.push(l.notes);
  return bits.join(' · ');
}
function blockLedger() {
  const c = COPY.ledger; const s = D.ledgerSums;
  return `
    <!-- dc: Admin Money.dc.html › "SPONSORS & DONORS" -->
    <div data-block="ledger" style="border:1px solid ${HAIR};border-top:2px solid #c9a962;background:#fff">
      <div style="display:flex;align-items:center;gap:10px;padding:14px 20px;border-bottom:1px solid ${HAIR12}">
        <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em;white-space:nowrap">${c.title}</span>
        <div style="flex:1"></div>
        <span style="font-size:11.5px;color:#6d6459">${c.flow}</span>
        <span data-act="pledgeToggle" style="padding:7px 12px;background:#201b16;color:#f6f2ea;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap">${c.newPledge}</span>
      </div>
      ${st.pledgeOpen ? `
      <div class="mxm-form" style="display:flex;gap:8px;align-items:center;padding:12px 20px;border-bottom:1px solid ${HAIR08};flex-wrap:wrap;background:#fdfbf6">
        <input data-role="plName" placeholder="${esc(c.namePh)}" aria-label="Sponsor or donor name" style="flex:1;min-width:160px;border:1px solid rgba(32,27,22,.25);background:#fff;padding:8px 10px;font:400 12.5px Inter,sans-serif;color:#201b16">
        <input data-role="plAmt" placeholder="${esc(c.amtPh)}" aria-label="Pledge amount" style="width:90px;border:1px solid rgba(32,27,22,.25);background:#fff;padding:8px 10px;font:400 12.5px Inter,sans-serif;color:#201b16">
        <select data-role="plKind" aria-label="Kind" style="border:1px solid rgba(32,27,22,.25);background:#fff;padding:8px;font:400 12.5px Inter,sans-serif;color:#201b16">${c.kinds.map(k => `<option value="${k[0]}">${k[1]}</option>`).join('')}</select>
        <select data-role="plEvent" aria-label="Event" style="border:1px solid rgba(32,27,22,.25);background:#fff;padding:8px;font:400 12.5px Inter,sans-serif;color:#201b16">${c.events.map(e => `<option>${e}</option>`).join('')}</select>
        <input data-role="plEmail" data-v2="ledger-email" placeholder="${esc(c.emailPh)}" aria-label="Contact email" style="flex:1;min-width:200px;border:1px solid rgba(32,27,22,.25);background:#fff;padding:8px 10px;font:400 12.5px Inter,sans-serif;color:#201b16">
        <span data-act="pledgeAdd" style="padding:8px 13px;background:#9b1b22;color:#fff;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer">${c.add}</span>
      </div>` : ''}
      ${D.ledger.map(l => { const tg = STAGE_TAG[l.status] || STAGE_TAG.pledge; return `
      <div data-row="${esc(l.id)}" class="mx-row" style="display:flex;align-items:center;gap:14px;padding:13px 20px;border-bottom:1px solid ${HAIR08}">
        <span data-act="ledgerHistory" data-id="${esc(l.id)}" class="mx-row-text" style="flex:1;min-width:0;cursor:pointer" title="Open the row history">
          <span style="display:block;font-size:13.5px;font-weight:600">${esc(l.party)}</span>
          <span style="display:block;font-size:11.5px;color:#6d6459;margin-top:2px">${esc(ledgerSub(l))}</span>
        </span>
        <span style="font-family:Fraunces,serif;font-size:17px;white-space:nowrap">${fmt.eur(l.amount)}</span>
        <span style="font:600 9px Inter,sans-serif;letter-spacing:.12em;padding:4px 9px;background:${tg[0]};color:${tg[1]};white-space:nowrap">${c.stage[l.status] || l.status}</span>
        <span data-act="ledgerAct" data-id="${esc(l.id)}" style="padding:8px 13px;border:1px solid rgba(32,27,22,.2);font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;color:#201b16;white-space:nowrap" data-hover="border-color:#201b16">${c.action[l.status] || 'OPEN'}</span>
      </div>`; }).join('')}
      ${!D.ledger.length ? `<div style="padding:22px 20px;text-align:center;font-size:13px;color:#6d6459">Nothing pledged yet — Donor Night pledges and auction results land here.</div>` : ''}
      <div class="mxm-sums" style="display:flex;align-items:center;gap:14px;padding:11px 20px;flex-wrap:wrap;border-top:1px solid ${HAIR08}">
        <span style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#8a6116">PLEDGED ${fmt.eur(s.pledge)}</span>
        <span style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#4a4239">INVOICED ${fmt.eur(s.invoiced)}</span>
        <span style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#22563a">PAID ${fmt.eur(s.paid)}</span>
        <span style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#22563a">THANKED ${fmt.eur(s.thanked)}</span>
        <div style="flex:1"></div>
        <span style="font-size:11.5px;color:#6d6459">${c.foot}</span>
      </div>
    </div>
    <!-- /dc -->`;
}

function blockExpenses() {
  const c = COPY.expenses; const rows = D.txExpense.slice(0, 6);
  return `
    <!-- dc: Admin Money.dc.html › "EXPENSES" -->
    <div data-block="expenses" id="expenses" style="border:1px solid ${HAIR};background:#fff">
      <div style="display:flex;align-items:center;gap:10px;padding:14px 20px;border-bottom:1px solid ${HAIR12}">
        <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${c.title}</span>
        <div style="flex:1"></div>
        <span style="font-size:11.5px;color:#6d6459">${c.note}</span>
      </div>
      ${rows.map(x => `
      <div style="display:flex;align-items:center;gap:14px;padding:11px 20px;border-bottom:1px solid ${HAIR07}">
        <span style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#6d6459;width:46px;flex:none">${esc(fmt.dayLabel(x.date))}</span>
        <span style="flex:1;font-size:13px;min-width:0">${esc(x.description || '—')}</span>
        <span style="font:600 9px Inter,sans-serif;letter-spacing:.1em;padding:3px 7px;background:#f7e3e4;color:#7e151b;white-space:nowrap">${esc((x.category === 'gala' ? 'Gala' : projLabel(x.project)).toUpperCase())}</span>
        <span style="font-family:Fraunces,serif;font-size:15px;white-space:nowrap;color:#9b1b22">−${fmt.eur(x.amount)}</span>
      </div>`).join('')}
      ${!rows.length ? `<div style="padding:14px 20px;font-size:12.5px;color:#6d6459;border-bottom:1px solid ${HAIR07}">${c.empty}</div>` : ''}
      <div class="mxm-form" style="display:flex;gap:8px;padding:13px 20px;flex-wrap:wrap">
        <input data-role="exDesc" placeholder="${esc(c.ph)}" aria-label="Expense description" style="flex:2;min-width:160px;border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:9px 11px;font:400 13px Inter,sans-serif;color:#201b16">
        <input data-role="exAmt" placeholder="${esc(c.amtPh)}" aria-label="Expense amount" style="width:90px;border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:9px 11px;font:400 13px Inter,sans-serif;color:#201b16">
        <select data-role="exProj" aria-label="Project" style="border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:9px 11px;font:400 13px Inter,sans-serif;color:#201b16">${c.projects.map(p => `<option value="${p[1]}${p[2] ? ':' + p[2] : ''}">${p[0]}</option>`).join('')}</select>
        <span data-act="expenseAdd" style="padding:9px 14px;background:#9b1b22;color:#fff;font:600 10px Inter,sans-serif;letter-spacing:.14em;cursor:pointer;display:flex;align-items:center" data-hover="background:#7e151b">${c.add}</span>
      </div>
    </div>
    <!-- /dc -->`;
}

function blockTools() {
  return `
    <!-- dc: Admin Money.dc.html › "FINANCE TOOLS" -->
    <div data-block="tools" style="border:1px solid ${HAIR};background:#fff;padding:16px 20px;display:flex;flex-direction:column;gap:4px">
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

function blockBoardPack() {
  const c = COPY.board; const f = D.facts || {};
  const cellVal = k => k === 'members' ? (f.members && f.members.total) : k === 'countries' ? (f.members && f.members.countries) : k === 'events' ? (f.events && f.events.total) : (f.registrations && f.registrations.total);
  const years = [...new Set([st.year, ...D.years.map(y => Number(y.year))])].sort((a, b) => b - a);
  return `
    <!-- dc: Admin Money.dc.html › "BOARD PACK" -->
    <div data-block="boardpack" style="border:1px solid ${HAIR};border-top:2px solid #c9a962;background:#fff;padding:18px 20px;display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${c.title}</span><div style="flex:1"></div><select data-role="bpYear" aria-label="Board pack period" style="border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:6px 8px;font:600 11px Inter,sans-serif;color:#201b16">${years.map(y => `<option value="${y}"${y === st.year ? ' selected' : ''}>${esc(c.period(y))}</option>`).join('')}</select></div>
      <span style="font-size:12px;color:#6d6459;line-height:1.55">${c.body}</span>
      <div class="mxm-bp-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:2px;background:rgba(32,27,22,.1);border:1px solid rgba(32,27,22,.1)">
        ${c.cells.map(([k, label]) => `<div style="background:#fff;padding:10px 12px"><span style="font-family:Fraunces,serif;font-size:20px;display:block">${cellVal(k) == null ? '—' : fmt.num(cellVal(k))}</span><span style="font:600 8.5px Inter,sans-serif;letter-spacing:.13em;color:#6d6459">${label}</span></div>`).join('')}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <label style="display:flex;align-items:center;gap:6px;font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#6d6459">${c.lang}<select data-role="bpLang" aria-label="Board pack language" style="border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:6px 8px;font:600 11px Inter,sans-serif;color:#201b16"><option value="en">English</option><option value="hr">Hrvatski</option></select></label>
        <div style="flex:1"></div>
        <span data-act="bpWord" data-v2="board-word" style="padding:8px 12px;border:1px solid rgba(32,27,22,.2);font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer" data-hover="border-color:#201b16">${c.word}</span>
        <span data-act="bpPreview" style="padding:8px 12px;border:1px solid rgba(32,27,22,.2);font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer" data-hover="border-color:#201b16">${c.preview}</span>
        <span data-act="bpPdf" style="padding:8px 12px;background:#9b1b22;color:#fff;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer" data-hover="background:#7e151b">${c.pdf}</span>
      </div>
    </div>
    <!-- /dc -->`;
}

function blockSurvey() {
  const c = COPY.survey;
  const stateLine = e => {
    if (e.state === 'queued' && e.awaiting_approval > 0) return `<a href="/inbox/outbox" style="font-size:11px;color:#9b1b22">${esc(c.state.queued(e))}</a>`;
    if (e.state === 'queued') return `<span style="font-size:11px;color:#6d6459">${esc(c.state.sent(e))}</span>`;
    if (e.state === 'due') return `<span style="font-size:11px;color:#b7791f">${esc(c.state.due)}</span>`;
    if (e.state === 'missed') return `<span style="font-size:11px;color:#9a9086">${esc(c.state.missed)}</span>`;
    return `<span style="font-size:11px;color:#6d6459">${esc(c.state.scheduled(e))}</span>`;
  };
  const results = st.surveyResults || [];
  const resFor = key => results.find(r => r.event_key === key);
  return `
    <!-- v2: MORNING-AFTER SURVEY (README note 11 — no artboard counterpart) -->
    <div data-block="survey" data-v2="morning-after-survey" style="border:1px solid ${HAIR};background:#fff;padding:16px 20px;display:flex;flex-direction:column;gap:8px">
      <div style="display:flex;align-items:center;gap:10px"><span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${c.title}</span><div style="flex:1"></div><span data-act="surveySweep" title="${esc(c.sweepTitle)}" style="font:600 9px Inter,sans-serif;letter-spacing:.13em;color:#9b1b22;cursor:pointer;border:1px solid rgba(32,27,22,.18);padding:4px 8px" data-hover="color:#201b16;border-color:#201b16">${c.sweep}</span></div>
      <span style="font-size:11.5px;color:#6d6459;line-height:1.55">${c.sub}</span>
      ${D.survey.map(e => { const r = resFor(e.key); return `
      <div style="display:flex;gap:10px;align-items:baseline;padding:7px 0;border-bottom:1px solid rgba(32,27,22,.06)">
        <span style="width:8px;height:8px;background:${SURVEY_DOT[e.state] || '#6d6459'};flex:none;transform:translateY(-1px)"></span>
        <span style="flex:1;min-width:0"><span style="display:block;font-size:12.5px;font-weight:600">${esc(e.label)}</span>${r && r.n_answered ? `<span style="display:block;font-size:11px;color:#2f7d4f">${esc(c.results(r))}</span>` : ''}</span>
        ${stateLine(e)}
      </div>`; }).join('')}
      ${!D.survey.length ? `<span style="font-size:12.5px;color:#6d6459;font-style:italic">${c.empty}</span>` : ''}
    </div>
    <!-- /v2 -->`;
}

function template() {
  return `
<div data-screen-label="Admin Money" style="min-height:100vh;background:#f6f2ea;color:#201b16;font-family:Inter,sans-serif">
  <div class="mx-gutter" style="max-width:1180px;margin:0 auto;padding:30px 28px 48px;display:flex;flex-direction:column;gap:22px">
    ${blockHead()}
    ${blockStats()}
    ${blockTool()}
    <div class="mx-two" style="display:grid;grid-template-columns:1.5fr 1fr;gap:22px;align-items:start">
      <div style="display:flex;flex-direction:column;gap:22px">
        ${blockMoneyIn()}
        ${blockChase()}
        ${blockLedger()}
        ${blockExpenses()}
      </div>
      <div style="display:flex;flex-direction:column;gap:22px">
        ${blockTools()}
        ${blockBoardPack()}
        ${blockSurvey()}
      </div>
    </div>
  </div>
</div>`;
}

// ---------------------------------------------------------------- behaviour
function rerender(sel, html) { const el = rootEl && rootEl.querySelector(sel); if (el) el.outerHTML = html; }
function openTool(id) {
  st.toolOpen = id;
  rerender('[data-block="tool"]', blockTool());
  if (id === 'stripe' && !st.stripe) {
    api.get('/api/finance/stripe-payments/recent')
      .then(r => { st.stripe = r; if (st.toolOpen === 'stripe') rerender('[data-block="tool"]', blockTool()); })
      .catch(e => { st.stripe = { error: e.message }; if (st.toolOpen === 'stripe') rerender('[data-block="tool"]', blockTool()); });
  }
  const el = rootEl.querySelector('[data-block="tool"]'); if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
}
async function reloadAll() {
  D = await load(st.year);
  if (!rootEl) return;
  rootEl.innerHTML = template();
}
async function refreshLedger() {
  try { const r = await api.get('/api/v2/money/ledger'); D.ledger = r.rows || []; D.ledgerSums = r.sums || D.ledgerSums; } catch (e) {}
  rerender('[data-block="ledger"]', blockLedger());
  rerender('[data-block="stats"]', blockStats());
}
async function refreshFinance() {
  try {
    const r = await api.settle({ fin: api.get('/api/finance/dashboard?year=' + st.year), tx: api.get('/api/finance/transactions?year=' + st.year), gala: api.get('/api/admin/gala/registrations') });
    if (r.fin) D.fin = r.fin;
    if (Array.isArray(r.tx)) { D.tx = r.tx; D.txIncome = r.tx.filter(t => t.transaction_type === 'income'); D.txExpense = r.tx.filter(t => t.transaction_type === 'expense'); }
    if (Array.isArray(r.gala)) {
      D.gala.rows = r.gala; D.gala.paid = r.gala.filter(g => g.payment_status === 'paid');
      D.gala.toChase = r.gala.filter(g => g.payment_status !== 'paid' && !['rejected', 'cancelled'].includes(String(g.status || ''))).sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
    }
  } catch (e) {}
  rerender('[data-block="stats"]', blockStats());
  rerender('[data-block="moneyin"]', blockMoneyIn());
  rerender('[data-block="chase"]', blockChase());
  rerender('[data-block="expenses"]', blockExpenses());
  if (st.toolOpen === 'tx') rerender('[data-block="tool"]', blockTool());
}
const roleVal = r => { const el = rootEl.querySelector(`[data-role="${r}"]`); return el ? el.value.trim() : ''; };
const parseAmt = v => Math.round((parseFloat(String(v).replace(',', '.').replace(/[^\d.]/g, '')) || 0) * 100) / 100;
const dl = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };

const handlers = {
  toolOpen: el => openTool(el.dataset.id),
  toolClose: () => { st.toolOpen = null; rerender('[data-block="tool"]', blockTool()); },
  openTx: () => openTool('tx'),
  openRep: () => openTool('rep'),
  goChase: () => { const el = rootEl.querySelector('#chase'); if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' }); },
  goExpenses: () => { const el = rootEl.querySelector('#expenses'); if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' }); },

  // ---- payments to chase --------------------------------------------------
  chaseQueue: async el => {
    const id = el.dataset.id; el.setAttribute('aria-disabled', 'true');
    const nag = D.nagByGala[id];
    try {
      if (nag && nag.status === 'open') await api.post('/api/admin/nag/items/' + encodeURIComponent(nag.id) + '/act');
      else await api.post('/api/v2/money/chase/' + encodeURIComponent(id));
      st.queuedLocal[id] = true;
      if (nag) nag.status = 'actioned';
      rerender('[data-block="chase"]', blockChase());
      ui.toast(COPY.chase.queuedToast);
      chrome.refresh();
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  chasePaid: async el => {
    const id = el.dataset.id; const g = D.gala.toChase.find(x => x.id === id); if (!g) return;
    const name = [g.first_name, g.last_name].filter(Boolean).join(' ');
    const ok = await ui.confirm(Object.assign({ eyebrow: 'PLEASE CONFIRM' }, COPY.chase.confirmPaid(name, fmt.eur(D.price))));
    if (!ok) return;
    el.setAttribute('aria-disabled', 'true');
    try {
      await api.post('/api/finance/conference-payments/' + encodeURIComponent(id) + '/confirm', { payment_type: 'gala' });
      await refreshFinance();
      ui.toast(COPY.chase.paidToast);
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },

  // ---- sponsors & donors ledger ------------------------------------------
  pledgeToggle: () => { st.pledgeOpen = !st.pledgeOpen; rerender('[data-block="ledger"]', blockLedger()); if (st.pledgeOpen) { const i = rootEl.querySelector('[data-role="plName"]'); if (i) i.focus(); } },
  pledgeAdd: async el => {
    const party = roleVal('plName'); const amount = parseAmt(roleVal('plAmt'));
    if (!party || !(amount > 0)) { ui.toast(COPY.ledger.needBoth); return; }
    el.setAttribute('aria-disabled', 'true');
    try {
      await api.post('/api/v2/money/ledger', { party, amount, kind: roleVal('plKind') || 'sponsor', event_ref: roleVal('plEvent'), contact_email: roleVal('plEmail') || null });
      st.pledgeOpen = false;
      await refreshLedger();
      ui.toast(COPY.ledger.added);
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  ledgerAct: el => {
    const l = D.ledger.find(x => x.id === el.dataset.id); if (!l) return;
    if (l.status === 'pledge') return firaModal(l);
    if (l.status === 'invoiced') return advance(l, { to: 'paid' }, COPY.ledger.markedPaid, l.fira_invoice_number ? 'invoiced' : 'pledge');
    if (l.status === 'paid') return l.contact_email ? advance(l, { to: 'thanked' }, COPY.ledger.thanked, 'paid', true) : thanksModal(l);
    return handlers.ledgerHistory(el);
  },
  ledgerHistory: el => {
    const l = D.ledger.find(x => x.id === el.dataset.id); if (!l) return;
    const line = (k, v) => v ? `<div style="display:flex;gap:10px;padding:6px 0;border-bottom:1px solid rgba(32,27,22,.06)"><span style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#6d6459;width:90px;flex:none;text-transform:uppercase">${k}</span><span style="font-size:13px;color:#201b16">${esc(v)}</span></div>` : '';
    ui.modal({ eyebrow: COPY.ledger.historyEyebrow, title: esc(l.party),
      body: line('Kind', l.kind) + line('Amount', fmt.eur(l.amount)) + line('Event', l.event_ref) + line('Email', l.contact_email) + line('FIRA no.', l.fira_invoice_number)
          + line('Pledged', l.pledged_at && fmt.longRange(l.pledged_at)) + line('Invoiced', l.invoiced_at && fmt.longRange(l.invoiced_at))
          + line('Paid', l.paid_at && fmt.longRange(l.paid_at)) + line('Thanked', l.thanked_at && fmt.longRange(l.thanked_at)) + line('Notes', l.notes),
      actions: [{ label: 'CLOSE', kind: 'primary' }] });
  },

  // ---- expenses -----------------------------------------------------------
  expenseAdd: async el => {
    const description = roleVal('exDesc'); const amount = parseAmt(roleVal('exAmt'));
    if (!description || !(amount > 0)) { ui.toast(COPY.expenses.needBoth); return; }
    const [project, category] = (roleVal('exProj') || 'general').split(':');
    el.setAttribute('aria-disabled', 'true');
    try {
      await api.post('/api/finance/transactions', { transaction_type: 'expense', amount, date: fmt.ymd(new Date()), description, project, category: category || null, fiscal_year: st.year });
      await refreshFinance();
      ui.toast(COPY.expenses.added);
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },

  // ---- orders tool --------------------------------------------------------
  addOrder: async el => {
    const kind = roleVal('noKind') || 'TRAVEL'; const what = roleVal('noWhat'); const amt = parseAmt(roleVal('noAmt'));
    if (!what) { ui.toast(COPY.orders.needWhat); return; }
    if (kind === 'PAYMENT' && !(amt > 0)) { ui.toast(COPY.orders.needAmt); return; }
    el.setAttribute('aria-disabled', 'true');
    try {
      if (kind === 'PAYMENT') {
        await api.post('/api/finance/payment-orders', { recipient_name: what, amount: amt, date: fmt.ymd(new Date()), description: what, fiscal_year: st.year });
      } else {
        const parts = what.split('—').map(s => s.trim());
        await api.post('/api/finance/travel-orders', { traveler_name: parts[1] || 'Med&X team', destination: parts[0] || what, purpose: what, advance_amount: amt || 0, fiscal_year: st.year });
      }
      const r = await api.settle({ po: api.get('/api/finance/payment-orders?year=' + st.year), to: api.get('/api/finance/travel-orders?year=' + st.year) });
      if (Array.isArray(r.po)) D.po = r.po; if (Array.isArray(r.to)) D.to = r.to;
      rerender('[data-block="tool"]', blockTool());
      ui.toast(COPY.orders.added);
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  orderDoc: async el => {
    try { const blob = await fetchBlob('/api/finance/travel-orders/' + encodeURIComponent(el.dataset.id) + '/pdf'); window.open(URL.createObjectURL(blob), '_blank'); }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },

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
  },

  // ---- board pack ---------------------------------------------------------
  bpPreview: async () => {
    try { const blob = await fetchBlob('/api/admin/transparency/board-pack?year=' + roleVal('bpYear') + '&lang=' + roleVal('bpLang')); window.open(URL.createObjectURL(blob), '_blank'); }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  bpPdf: async el => {
    el.setAttribute('aria-disabled', 'true');
    try { const y = roleVal('bpYear'); dl(await fetchBlob('/api/admin/transparency/board-pack.pdf?year=' + y + '&lang=' + roleVal('bpLang')), `medx-board-pack-${y}.pdf`); }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
    el.removeAttribute('aria-disabled');
  },
  bpWord: async () => {
    try { const y = roleVal('bpYear'); dl(await fetchBlob('/api/admin/transparency/board-pack.doc?year=' + y + '&lang=' + roleVal('bpLang')), `medx-board-pack-${y}.doc`); }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },

  // ---- morning-after survey ----------------------------------------------
  surveySweep: async el => {
    el.setAttribute('aria-disabled', 'true');
    try {
      const r = await api.post('/api/v2/money/survey/sweep');
      const s = await api.get('/api/v2/money/survey'); D.survey = (s && s.events) || D.survey;
      try { const rr = await api.get('/api/v2/money/survey/results'); st.surveyResults = (rr && rr.results) || []; } catch (e) {}
      rerender('[data-block="survey"]', blockSurvey());
      ui.toast(COPY.survey.swept((r.queued || []).length));
      chrome.refresh();
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  }
};

// FIRA record modal — the number is TYPED from FIRA; nothing here creates an invoice.
function firaModal(l) {
  const c = COPY.ledger.firaModal;
  const m = ui.modal({ eyebrow: c.eyebrow, title: c.title, body: `
    <p style="margin:0 0 12px">${c.body}</p>
    <input data-role="mFira" placeholder="${esc(c.numPh)}" aria-label="FIRA invoice number" style="width:100%;box-sizing:border-box;border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:9px 11px;font:400 13px Inter,sans-serif;color:#201b16">
    <input data-role="mEmail" placeholder="${esc(COPY.ledger.thanksModal.emailPh)}" value="${esc(l.contact_email || '')}" aria-label="Contact email" style="margin-top:8px;width:100%;box-sizing:border-box;border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:9px 11px;font:400 13px Inter,sans-serif;color:#201b16">
    <label style="display:flex;gap:8px;align-items:center;margin-top:10px;font-size:12.5px;color:#4a4239;cursor:pointer"><input type="checkbox" data-role="mQueue">${c.queueLabel}</label>
    <div data-role="mErr" style="color:#9b1b22;font-size:12px;margin-top:8px"></div>`,
    actions: [{ label: c.cancel }, { label: c.ok, kind: 'primary', onClick: () => {
      const fira = (m.el.querySelector('[data-role="mFira"]').value || '').trim();
      const email = (m.el.querySelector('[data-role="mEmail"]').value || '').trim();
      const queue = m.el.querySelector('[data-role="mQueue"]').checked;
      const err = m.el.querySelector('[data-role="mErr"]');
      if (!fira) { err.textContent = c.needNum; return false; }
      if (queue && !email) { err.textContent = c.needEmail; return false; }
      advance(l, { to: 'invoiced', fira_invoice_number: fira, queue_email: queue, contact_email: email || null }, queue ? COPY.ledger.invoicedQueued : COPY.ledger.invoiced, 'pledge');
    } }] });
  const first = m.el.querySelector('[data-role="mFira"]'); if (first) first.focus();
}
function thanksModal(l) {
  const c = COPY.ledger.thanksModal;
  const m = ui.modal({ eyebrow: c.eyebrow, title: c.title, body: `
    <p style="margin:0 0 12px">${c.body}</p>
    <input data-role="mEmail" placeholder="${esc(c.emailPh)}" aria-label="Contact email" style="width:100%;box-sizing:border-box;border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:9px 11px;font:400 13px Inter,sans-serif;color:#201b16">
    <div data-role="mErr" style="color:#9b1b22;font-size:12px;margin-top:8px"></div>`,
    actions: [{ label: c.cancel }, { label: c.ok, kind: 'primary', onClick: () => {
      const email = (m.el.querySelector('[data-role="mEmail"]').value || '').trim();
      if (!email) { m.el.querySelector('[data-role="mErr"]').textContent = c.needEmail; return false; }
      advance(l, { to: 'thanked', contact_email: email }, COPY.ledger.thanked, 'paid', true);
    } }] });
  const first = m.el.querySelector('[data-role="mEmail"]'); if (first) first.focus();
}
// One ledger transition + toast with a REAL undo (reverts the status; cancels a queued batch).
async function advance(l, body, toastMsg, revertTo, cancelBatchOnUndo) {
  try {
    const r = await api.post('/api/v2/money/ledger/' + encodeURIComponent(l.id) + '/advance', body);
    await refreshLedger();
    const batch = r && r.batch_id;
    ui.toast(toastMsg, { undo: async () => {
      try {
        if (cancelBatchOnUndo && batch) { try { await api.post('/api/admin/outbox/' + encodeURIComponent(batch) + '/cancel'); } catch (e) {} }
        await api.put('/api/v2/money/ledger/' + encodeURIComponent(l.id), { status: revertTo });
        await refreshLedger();
        ui.toast(COPY.ledger.undone);
      } catch (e) { ui.toast(e.message, { kind: 'error' }); }
    } });
    chrome.refresh();
  } catch (e) { ui.toast(e.message, { kind: 'error' }); }
}

function onchangeDelegate(e) {
  const el = e.target.closest && e.target.closest('[data-change]');
  if (!el || !rootEl || !rootEl.contains(el)) return;
  if (el.dataset.change === 'year') { const y = parseInt(el.value, 10); if (y && y !== st.year) { st.year = y; st.stripe = null; reloadAll(); } }
}

function ensureCss() {
  if (document.querySelector('link[data-view-css="money"]')) { cssEl = document.querySelector('link[data-view-css="money"]'); return; }
  cssEl = document.createElement('link'); cssEl.rel = 'stylesheet'; cssEl.href = '/css/views/money.css'; cssEl.setAttribute('data-view-css', 'money');
  document.head.appendChild(cssEl);
}

export default {
  title: 'Money',
  async render(root, ctx) {
    rootEl = root;
    ensureCss();
    st = { year: new Date().getFullYear(), toolOpen: null, pledgeOpen: false, stripe: null, queuedLocal: {}, surveyResults: null };
    D = await load(st.year);
    if (rootEl !== root) return; // navigated away while loading
    try { const rr = await api.get('/api/v2/money/survey/results'); st.surveyResults = (rr && rr.results) || []; } catch (e) {}
    if (rootEl !== root) return;
    root.innerHTML = template();
    unbind = ui.bind(root, handlers);
    root.addEventListener('change', onchangeDelegate);
    if (ctx.params && ctx.params.tab === 'chase') handlers.goChase();
    chrome.refresh();
  },
  destroy() {
    if (rootEl) rootEl.removeEventListener('change', onchangeDelegate);
    if (unbind) unbind(); unbind = null; rootEl = null; D = null; st = null;
    if (cssEl) { cssEl.remove(); cssEl = null; }
  }
};
