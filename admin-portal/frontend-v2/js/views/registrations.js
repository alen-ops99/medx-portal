// Source: Admin Registrations.dc.html
// Blocks (artboard order): "Title row" (← PEOPLE · Registrations · EMAIL SELECTED · EXPORT CSV) ›
// "Stat strip" (ALL · CONFERENCE · GALA · BOSTON — every number is a door that sets the filter) ›
// "Filter row" (search · event select · status chips) › "All-events table" + "Registration file"
// side panel (facts + contextual actions). The header is js/chrome.js.
// Data: ONE cross-event union — GET /api/v2/registrations/all (backend/v2/registrations.js) over
// registrations + gala + bridges + forum + croatians_abroad (source='plexus' = the public form) +
// signup_form_responses, each row tagged with its source link (README: "Every sign-up lands in
// Registrations tagged with its source link"). Bulk email + resend-confirmation stage
// pending_approval rows in scheduled_emails — NOTHING sends without the Outbox OK (note 2).
// Audit 2026-09-02 #11: rows are single-line (name · dimmed email inline, ~40px), the render
// windows at 60 with SHOW ALL N (the server SHOW MORE stays for sets past the fetch limit),
// the ALL-REGISTRATIONS stat and the EXPORT count reconcile visibly (the stat counts live rows,
// the export counts the listed set incl. cancelled — both now say so), and COUNTRY facts
// normalize at render via people.js countryName (HR → Croatia, US/USA → United States).
import { api } from '../api.js';
import { ui, esc, fmt } from '../ui.js';
import { FACTS } from '../facts.js';
import { chrome } from '../chrome.js';
import router from '../router.js';
import { countryName } from './people.js';

export const SOURCE = 'Admin Registrations.dc.html';

export const COPY = {
  title: 'Registrations', back: '← PEOPLE',
  sub: 'Every sign-up across every event — filter, open the file, act. New submissions appear here the second the form is sent.',
  emailSel: n => `EMAIL SELECTED · ${n}`, exportCsv: n => `EXPORT CSV · ${n}`,
  inclCancelled: n => `incl. ${n} cancelled`,
  stats: { all: 'ALL REGISTRATIONS', conference: 'CONFERENCE', gala: 'GALA', boston: 'BOSTON', of: n => `of ${n}`, unpaid: n => `${n} unpaid`, cancelled: n => `+ ${n} cancelled` },
  searchPh: 'Name, email, note — e.g. “vegan”, “pending”, “kbc”',
  events: [['all', 'ALL EVENTS'], ['conference', 'PLEXUS CONFERENCE'], ['gala', 'GALA EVENING'], ['boston', 'BOSTON'], ['donor', 'DONOR NIGHT'], ['bridges', 'BUILDING BRIDGES'], ['forum', 'FORUM'], ['signup', 'SIGN-UP FORMS']],   // first five per the artboard; the rest are live data (v2)
  chips: ['ALL', 'PAID', 'PENDING', 'FREE'],
  cols: { who: 'WHO', event: 'EVENT', status: 'STATUS', when: 'WHEN' },
  empty: 'Nothing matches these filters.',
  foot: (n, t) => `Showing ${n} of ${t} registration${t === 1 ? '' : 's'}`, more: 'SHOW MORE', showAll: n => `SHOW ALL ${n}`,
  linkFilter: l => `SOURCE LINK · ${l}`, clearLink: '× CLEAR',
  panel: {
    registered: w => `registered ${w}`, none: 'No registrations to show — the file panel fills as sign-ups arrive.',
    people: 'The full person page — membership, messages, money history — opens from <a href="/people">People</a>.',
    source: 'SOURCE'
  },
  acts: {
    resend: 'RESEND CONFIRMATION', email: 'EMAIL', markPaid: 'MARK PAID',
    cancel: 'CANCEL REGISTRATION', cancelSure: 'SURE? CANCEL', remove: 'REMOVE RESPONSE', removeSure: 'SURE? REMOVE', openGala: 'OPEN THE GALA ROW'
  },
  toast: {
    tickFirst: 'TICK AT LEAST ONE ROW FIRST',
    queuedBulk: n => `EMAIL TO ${n} ${n === 1 ? 'PERSON' : 'PEOPLE'} — QUEUED IN THE OUTBOX FOR YOUR OK`,
    queuedResend: 'CONFIRMATION QUEUED IN THE OUTBOX FOR YOUR OK',
    exported: n => `EXPORTED ${n} ROWS · CSV`,
    cancelled: 'CANCELLED — THE SEAT IS FREED', restored: 'REGISTRATION RESTORED',
    removed: 'RESPONSE REMOVED — THIS ONE IS PERMANENT',
    markedPaid: 'MARKED PAID — MONEY & GALA PAGES UPDATE',
    galaRowMissing: 'THE LINKED GALA ROW IS NOT IN THIS LIST — CLEARING FILTERS'
  },
  compose: { eyebrow: 'QUEUES IN THE OUTBOX', title: n => `Email ${n} ${n === 1 ? 'person' : 'people'}`, subject: 'SUBJECT', message: 'MESSAGE', note: 'Nothing sends now — this stages the emails in Inbox → Outbox for an explicit Approve & send.', queue: 'QUEUE FOR YOUR OK', cancel: 'CANCEL', needBoth: 'SUBJECT AND MESSAGE FIRST' },
  transfers: {                                     // additive strip, 2026-08-31 — seat transfers
    title: 'RECENT TRANSFERS', of: n => `${n} TOTAL`,
    sub: 'Gala seats members passed to a colleague — same registration id and QR, new holder. Written by the member portal (POST /api/v2/transfer/gala).',
    empty: 'No seat transfers yet — they appear here the moment a member passes a seat on.',
    reg: ref => `REG ${String(ref).slice(0, 8)}`, checkedIn: '✓ CHECKED IN'
  },
  timeline: {                                      // additive drawer, 2026-08-31 — per-registrant history + staff notes
    title: 'TIMELINE', of: n => `${n} EVENT${n === 1 ? '' : 'S'}`,
    loading: 'Assembling the history…',
    empty: 'Nothing on file yet — events land here as this person registers, pays, transfers or walks in.',
    error: 'The timeline would not load — reopen the row to retry.',
    composerPh: 'Add a note for the team — e.g. “called about the invoice, will pay Friday”',
    appendOnly: 'Append-only — the team sees every note.',
    add: 'ADD NOTE',
    noteAdded: 'NOTE ADDED — THE WHOLE TEAM SEES IT',
    needText: 'WRITE THE NOTE FIRST'
  },
  csvName: 'medx-registrations.csv'
};

// artboard stStyle(): PAID / PENDING / everything else; CANCELLED greys out (v2 — the mock had no cancelled rows)
const ST = { PAID: ['#e4efe7', '#22563a'], PENDING: ['#f7e3e4', '#7e151b'], FREE: ['#eee9df', '#4a4239'], CANCELLED: ['#eee9df', '#9a9086'] };
const LINK_TAG = { VIP: ['#f1e7d4', '#7a6432'], DIASPORA: ['#e8eef7', '#2c4a73'], LINK: ['#eee9df', '#4a4239'] };

let D = null, st = null, unbind = null, rootEl = null, reqId = 0, qTimer = null;

function loadCss() {
  if (!document.getElementById('mx-css-registrations')) {
    const l = document.createElement('link'); l.id = 'mx-css-registrations'; l.rel = 'stylesheet'; l.href = '/css/views/registrations.css'; document.head.appendChild(l);
  }
}

// ---------------------------------------------------------------- data
async function load() {
  const my = ++reqId;
  const p = new URLSearchParams();
  if (st.q.trim()) p.set('q', st.q.trim());
  if (st.event !== 'all') p.set('event', st.event);
  if (st.status !== 'ALL') p.set('status', st.status);
  if (st.link) p.set('link', st.link);
  p.set('limit', String(st.limit));
  const r = await api.get('/api/v2/registrations/all?' + p.toString());
  if (my !== reqId) return false;                        // a newer request superseded this one
  D = r || { rows: [], total: 0, grand_total: 0, stats: {} };
  if (st.sel && !D.rows.some(x => x.key === st.sel)) st.sel = null;
  return true;
}
const rows = () => (D && Array.isArray(D.rows)) ? D.rows : [];
const selRow = () => rows().find(r => r.key === st.sel) || rows()[0] || null;
// audit #11: the export button says exactly what it exports — the listed set, cancelled included
function exportLabel() {
  const list = rows();
  const cx = list.filter(r => r.status === 'CANCELLED').length;
  return COPY.exportCsv(list.length) + (cx ? ` · ${COPY.inclCancelled(cx)}` : '');
}

// ---------------------------------------------------------------- blocks (artboard markup verbatim)
function blockTitle() {
  return `
  <!-- dc: Admin Registrations.dc.html › "Title row" -->
  <div style="display:flex;align-items:flex-end;gap:16px;flex-wrap:wrap">
    <div>
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <a href="/people" style="font:600 10px Inter,sans-serif;letter-spacing:.14em;color:#6d6459" data-hover="color:#201b16">${COPY.back}</a>
        <span class="mx-display-30" style="font-family:Fraunces,serif;font-size:30px">${COPY.title}</span>
      </div>
      <div style="font-size:12.5px;color:#6d6459;margin-top:4px">${COPY.sub}</div>
    </div>
    <div style="flex:1"></div>
    <span data-act="emailSel" data-role="emailSel" style="padding:10px 15px;border:1px solid rgba(32,27,22,.25);background:#fff;font:600 10px Inter,sans-serif;letter-spacing:.14em;cursor:pointer;white-space:nowrap" data-hover="border-color:#201b16">${COPY.emailSel(st.ticked.size)}</span>
    <span data-act="exportCsv" data-role="exportCsv" style="padding:10px 15px;background:#9b1b22;color:#fff;font:600 10px Inter,sans-serif;letter-spacing:.14em;cursor:pointer;white-space:nowrap" data-hover="background:#7e151b">${exportLabel()}</span>
  </div>
  <!-- /dc -->`;
}
function blockStats() {
  const s = (D && D.stats) || {};
  const cap = s.conference_cap || FACTS.plexus.cap;
  const cell = (act, label, num, sub, subColor, last) => `
      <span data-act="${act}" role="button" style="padding:14px 18px;${last ? '' : 'border-right:1px solid rgba(32,27,22,.1);'}cursor:pointer;display:block" data-hover="background:#fdfbf6"><span style="display:block;font:600 9px Inter,sans-serif;letter-spacing:.15em;color:#6d6459">${label}</span><span style="display:block;font-family:Fraunces,serif;font-size:26px;margin-top:2px">${num} ${sub ? `<span style="font-size:13px;color:${subColor}">${sub}</span>` : ''}</span></span>`;
  // audit #11: the ALL stat counts LIVE rows; the cancelled remainder is named right on the stat,
  // so it can no longer silently disagree with the export button (which lists cancelled too).
  const cxAll = D && D.grand_total != null && s.all != null ? Math.max(0, D.grand_total - s.all) : 0;
  return `
  <!-- dc: Admin Registrations.dc.html › "Stat strip" -->
  <div data-block="stats" class="mx-grid-4" style="border:1px solid rgba(32,27,22,.14);background:#fff;display:grid;grid-template-columns:repeat(4,1fr)">
    ${cell('statAll', COPY.stats.all, s.all == null ? '—' : s.all, cxAll ? COPY.stats.cancelled(cxAll) : '', '#9a9086')}
    ${cell('statConf', COPY.stats.conference, s.conference == null ? '—' : s.conference, cap ? COPY.stats.of(cap) : '', '#6d6459')}
    ${cell('statGala', COPY.stats.gala, s.gala == null ? '—' : s.gala, s.gala_unpaid ? COPY.stats.unpaid(s.gala_unpaid) : '', '#9b1b22')}
    ${cell('statBoston', COPY.stats.boston, s.boston == null ? '—' : s.boston, s.boston_cap ? COPY.stats.of(s.boston_cap) : '', '#6d6459', true)}
  </div>
  <!-- /dc -->`;
}
function blockFilters() {
  const chip = on => on ? 'background:#201b16;color:#f6f2ea;border:1px solid #201b16' : 'background:#fff;color:#6d6459;border:1px solid rgba(32,27,22,.2)';
  return `
  <!-- dc: Admin Registrations.dc.html › "Filter row" -->
  <div data-block="filters" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
    <span style="display:flex;align-items:center;gap:8px;border:1px solid rgba(32,27,22,.25);background:#fff;padding:9px 13px;flex:1;min-width:220px"><span style="color:#6d6459">⌕</span><input data-role="regq" value="${esc(st.q)}" placeholder="${esc(COPY.searchPh)}" aria-label="Search registrations" style="border:none;background:transparent;font:400 13px Inter,sans-serif;color:#201b16;flex:1;outline:none;padding:0"></span>
    <select data-role="ev" aria-label="Event filter" style="border:1px solid rgba(32,27,22,.25);background:#fff;padding:9px 11px;font:600 11px Inter,sans-serif;color:#201b16">${COPY.events.map(([k, label]) => `<option value="${k}"${st.event === k ? ' selected' : ''}>${label}</option>`).join('')}</select>
    ${COPY.chips.map(c => `<span data-act="chip" data-chip="${c}" style="padding:9px 13px;font:600 9.5px Inter,sans-serif;letter-spacing:.12em;cursor:pointer;${chip(st.status === c)};white-space:nowrap">${c}</span>`).join('')}
    ${st.link ? `<span data-v2="link-filter" style="display:flex;align-items:center;gap:8px;padding:9px 13px;font:600 9.5px Inter,sans-serif;letter-spacing:.12em;background:#f8f1e2;color:#7a6432;white-space:nowrap">${esc(COPY.linkFilter(st.linkLabel || st.link.slice(0, 10)))}<span data-act="clearLink" style="cursor:pointer;color:#9b1b22">${COPY.clearLink}</span></span>` : ''}
  </div>
  <!-- /dc -->`;
}
function rowHtml(r, selected) {
  const c = ST[r.status] || ST.FREE;
  const lt = r.link ? (LINK_TAG[r.link.kind] || LINK_TAG.LINK) : null;
  // audit #11: one line per row — name with the email inline and dimmed (~40px, was two lines)
  return `
      <div data-act="open" data-key="${esc(r.key)}" role="button" aria-label="Open ${esc(r.name)}" class="mx-regrow" style="display:grid;grid-template-columns:auto 1.9fr 1.2fr 1fr auto;gap:10px;padding:8px 16px;border-bottom:1px solid rgba(32,27,22,.07);align-items:center;cursor:pointer;background:${selected ? '#f6f2ea' : '#fff'}">
        <span data-act="tick" data-key="${esc(r.key)}" role="checkbox" aria-checked="${st.ticked.has(r.key)}" aria-label="Select ${esc(r.name)}" style="width:13px;height:13px;border:1px solid rgba(32,27,22,.4);cursor:pointer;background:${st.ticked.has(r.key) ? '#9b1b22' : 'transparent'};flex:none"></span>
        <span style="min-width:0;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><span style="font-weight:600;${r.status === 'CANCELLED' ? 'color:#9a9086;text-decoration:line-through' : ''}">${esc(r.name)}</span>${r.email ? ` <span style="font-size:10.5px;color:#6d6459">· ${esc(r.email)}</span>` : ''}</span>
        <span class="mx-reg-event" style="min-width:0;display:flex;align-items:center;gap:6px"><span style="font-size:11.5px;color:#4a4239;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.event)}</span>${lt ? `<span data-act="linkTag" data-link="${esc(r.link.ref)}" data-label="${esc(r.link.label)}" title="Source link — click to see every sign-up from it" style="font:600 7.5px Inter,sans-serif;letter-spacing:.1em;padding:2px 5px;background:${lt[0]};color:${lt[1]};white-space:nowrap;cursor:pointer;flex:none">${esc(r.link.kind === 'LINK' ? 'LINK' : r.link.kind)}</span>` : ''}</span>
        <span style="font:600 8px Inter,sans-serif;letter-spacing:.1em;padding:3px 6px;background:${c[0]};color:${c[1]};white-space:nowrap;justify-self:start">${esc(r.status)}</span>
        <span class="mx-reg-when" style="font:600 9px Inter,sans-serif;color:#9a9086;white-space:nowrap">${esc(fmt.dayLabel(r.when) || '')}</span>
      </div>`;
}
const REG_WINDOW = 60;                                     // audit #11: window the render, keep the page short
function blockTable() {
  const list = rows(); const sel = selRow();
  const visible = st.shown ? list.slice(0, st.shown) : list;
  const allTicked = list.length && list.every(r => st.ticked.has(r.key));
  const canExpand = list.length > visible.length;          // display window (SHOW ALL)
  const more = D && D.total > list.length;                 // server fetch window (SHOW MORE)
  return `
      <div data-block="table" style="border:1px solid rgba(32,27,22,.14);background:#fff">
        <div style="display:grid;grid-template-columns:auto 1.9fr 1.2fr 1fr auto;gap:10px;padding:9px 16px;border-bottom:1px solid rgba(32,27,22,.14);font:600 8.5px Inter,sans-serif;letter-spacing:.14em;color:#6d6459;align-items:center"><span data-act="selAll" role="checkbox" aria-checked="${!!allTicked}" title="Select everything shown" style="width:13px;height:13px;border:1px solid rgba(32,27,22,.4);cursor:pointer;background:${allTicked ? '#9b1b22' : 'transparent'}"></span><span>${COPY.cols.who}</span><span class="mx-reg-event">${COPY.cols.event}</span><span>${COPY.cols.status}</span><span class="mx-reg-when">${COPY.cols.when}</span></div>
        ${visible.map(r => rowHtml(r, sel && r.key === sel.key)).join('')}
        ${!list.length ? `<div style="padding:24px 16px;text-align:center;font-size:13px;color:#6d6459">${COPY.empty}</div>` : ''}
        <div style="padding:10px 16px;font-size:11px;color:#6d6459;display:flex;gap:14px;align-items:baseline">${COPY.foot(visible.length, D ? D.total : 0)}<div style="flex:1"></div>${canExpand ? `<span data-act="showAll" style="font:600 9.5px Inter,sans-serif;letter-spacing:.13em;color:#9b1b22;cursor:pointer;white-space:nowrap">${COPY.showAll(list.length)}</span>` : more ? `<span data-act="more" style="font:600 9.5px Inter,sans-serif;letter-spacing:.13em;color:#9b1b22;cursor:pointer;white-space:nowrap">${COPY.more} · ${D.total - list.length}</span>` : ''}</div>
      </div>`;
}
function panelActions(r) {
  const ghost = 'background:transparent;border:1px solid rgba(32,27,22,.2);color:#201b16';
  const acts = [];
  if (r.email) acts.push({ act: 'resend', label: COPY.acts.resend, style: ghost });
  if (r.email) acts.push({ act: 'emailOne', label: COPY.acts.email, style: 'background:#9b1b22;border:1px solid #9b1b22;color:#fff' });
  if (r.can_mark_paid && ['conference', 'gala', 'bridges', 'croatians-abroad'].includes(r.type)) acts.push({ act: 'markPaid', label: COPY.acts.markPaid, style: ghost });
  if (r.gala_id) acts.push({ act: 'openGala', label: COPY.acts.openGala, style: ghost });
  if (r.status !== 'CANCELLED') {
    const confirming = st.cancelConfirm === r.key;
    const isSignup = r.type === 'signup';
    acts.push({ act: 'cancel', label: confirming ? (isSignup ? COPY.acts.removeSure : COPY.acts.cancelSure) : (isSignup ? COPY.acts.remove : COPY.acts.cancel), style: `background:transparent;border:1px solid rgba(32,27,22,.2);color:${confirming ? '#9b1b22' : '#6d6459'}` });
  }
  return acts;
}
function blockPanel() {
  const r = selRow();
  if (!r) return `
      <div data-block="panel" class="mx-sticky" style="border:1px solid rgba(32,27,22,.14);border-top:2px solid #9b1b22;background:#fff;position:sticky;top:16px">
        <div class="empty" style="padding:30px 18px 32px"><span style="width:28px;height:1px;background:#c9a962"></span><span class="empty-line">No file open.</span><span class="empty-why">${COPY.panel.none}</span></div>
      </div>`;
  const ini = r.name.replace('Dr. ', '').split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  // COUNTRY facts normalize at render (audit #11) — same countryName rule the People directory uses
  const facts = (r.facts || []).map(([k, v]) => k === 'COUNTRY' ? [k, countryName(v)] : [k, v])
    .concat([[COPY.panel.source, r.source || '—']]);
  return `
      <!-- dc: Admin Registrations.dc.html › "Registration file" -->
      <div data-block="panel" class="mx-sticky" style="border:1px solid rgba(32,27,22,.14);border-top:2px solid #9b1b22;background:#fff;position:sticky;top:16px">
        <div style="padding:15px 18px;border-bottom:1px solid rgba(32,27,22,.1);display:flex;gap:12px;align-items:center">
          <span style="width:38px;height:38px;background:#191512;color:#c9a962;display:inline-flex;align-items:center;justify-content:center;font:600 13px Fraunces,serif;flex:none">${esc(ini)}</span>
          <span style="min-width:0"><span style="display:block;font-size:14.5px;font-weight:600">${esc(r.name)}</span><span style="display:block;font-size:11px;color:#6d6459">${esc(r.event)} · ${esc(COPY.panel.registered(fmt.dayLabel(r.when) || '—'))}</span></span>
        </div>
        <div style="padding:12px 18px;display:flex;flex-direction:column;gap:8px;border-bottom:1px solid rgba(32,27,22,.08)">
          ${facts.map(([k, v]) => `<div style="display:flex;gap:10px;align-items:baseline"><span style="font:600 8.5px Inter,sans-serif;letter-spacing:.13em;color:#6d6459;width:86px;flex:none">${esc(k)}</span><span style="font-size:12.5px;flex:1;line-height:1.5">${esc(v)}</span></div>`).join('')}
        </div>
        <div style="padding:12px 18px;display:flex;gap:8px;flex-wrap:wrap">
          ${panelActions(r).map(a => `<span data-act="${a.act}" data-key="${esc(r.key)}" style="padding:8px 12px;${a.style};font:600 9px Inter,sans-serif;letter-spacing:.12em;cursor:pointer;white-space:nowrap" data-hover="border-color:#201b16">${a.label}</span>`).join('')}
        </div>
        ${blockTimeline(r)}
        <div style="padding:0 18px 14px;font-size:11px;color:#6d6459;line-height:1.5">${COPY.panel.people}</div>
      </div>
      <!-- /dc -->`;
}
// ---- RECENT TRANSFERS strip (additive, 2026-08-31) — GET /api/v2/transfer/log ----
// T === null → endpoint unavailable (older backend): the strip stays out of the page entirely.
let T = null;
async function loadTransfers() {
  try { const r = await api.get('/api/v2/transfer/log?limit=8'); T = { rows: (r && r.transfers) || [], total: (r && r.total) || 0 }; }
  catch (e) { T = null; }
}
function blockTransfers() {
  if (!T) return '';
  const C = COPY.transfers;
  const rows = T.rows;
  return `
    <!-- dc: Admin Registrations.dc.html › "Recent transfers" (v2 addition) -->
    <div data-block="transfers" style="background:#fff;border:1px solid rgba(32,27,22,.14)">
      <div style="display:flex;align-items:baseline;gap:12px;padding:12px 16px;border-bottom:1px solid rgba(32,27,22,.14);flex-wrap:wrap">
        <span style="font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#201b16">${C.title}</span>
        ${T.total ? `<span style="font:600 8.5px Inter,sans-serif;letter-spacing:.14em;color:#6d6459">${esc(C.of(T.total))}</span>` : ''}
        <span style="flex:1"></span>
        <span style="font-size:11px;color:#6d6459">${C.sub}</span>
      </div>
      ${rows.length ? rows.map((t, i) => `
      <div style="display:grid;grid-template-columns:2.2fr 1.4fr auto auto;gap:10px;padding:9px 16px;${i < rows.length - 1 ? 'border-bottom:1px solid rgba(32,27,22,.07);' : ''}align-items:center">
        <span style="min-width:0;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
          <span style="color:#6d6459">${esc(t.from_email || '—')}</span>
          <span style="color:#9b1b22;font-weight:600"> → </span>
          <strong>${esc(t.to_name || t.to_email)}</strong>
          <span style="color:#6d6459">${t.to_name ? ` (${esc(t.to_email)})` : ''}</span>
        </span>
        <span style="min-width:0;font-size:11px;color:#4a4239;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.event || 'Gala Evening')}</span>
        <span title="Registration id — unchanged by the transfer" style="font:600 8px ui-monospace,Menlo,monospace;letter-spacing:.08em;padding:2px 6px;background:#f6f2ea;color:#4a4239;white-space:nowrap">${esc(C.reg(t.registration_ref))}${t.checked_in ? ` · ${C.checkedIn}` : ''}</span>
        <span class="mx-reg-when" style="font:600 8.5px Inter,sans-serif;letter-spacing:.1em;color:#6d6459;white-space:nowrap">${esc(fmt.when(t.created_at))}</span>
      </div>`).join('') : `<div style="padding:14px 16px;font-size:12px;color:#6d6459">${C.empty}</div>`}
    </div>
    <!-- /dc -->`;
}

// ---- TIMELINE drawer (additive, 2026-08-31) — the old-portal registrant-activity gem, per person ----
// GET /api/v2/registrations/timeline?email= (merged history across every source) + POST
// /api/v2/registrations/notes (append-only staff notes, author = the signed-in admin).
// TL === null → nothing loaded; TL.email tracks WHICH person the drawer holds, so switching rows
// refetches while unrelated redraws keep the loaded history AND any half-typed note draft.
let TL = null, tlReq = 0;
const TL_DOT = { registered: '#c9a962', paid: '#22563a', checkin: '#2c4a73', transfer: '#9b1b22', note: '#4a4239', nomination: '#7a6432', admin: '#9a9086' };
function authorName(a) {
  const s = String(a || '').trim(); if (!s) return 'Admin';
  const local = s.includes('@') ? s.split('@')[0] : s;
  return local.split(/[._-]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ') || 'Admin';
}
function tlWhen(at) {
  if (!at) return '—';
  const t = String(at).match(/[T ](\d{2}:\d{2})/);
  return (fmt.dayLabel(at) || String(at).slice(0, 10)) + (t ? ' · ' + t[1] : '');
}
async function loadTimeline(email) {
  const my = ++tlReq;
  TL = { email, loading: true, events: [] };
  try {
    const r = await api.get('/api/v2/registrations/timeline?email=' + encodeURIComponent(email));
    if (my !== tlReq) return;
    TL = { email, loading: false, events: (r && r.events) || [] };
  } catch (e) { if (my === tlReq) TL = { email, loading: false, error: true, events: [] }; }
}
function redrawTimeline() {
  const r = selRow();
  if (rootEl && r && r.email && TL && TL.email === r.email) rerender('[data-block="tl"]', blockTimeline(r));
}
function ensureTimeline() {
  if (!rootEl || !st) return;
  const r = selRow();
  if (!r || !r.email) { TL = null; return; }
  if (TL && TL.email === r.email) return;            // loaded or in flight — keep it (and the draft)
  loadTimeline(r.email).then(redrawTimeline);
}
function tlItem(ev, last) {
  const isNote = ev.kind === 'note';
  const meta = isNote
    ? `<span class="mx-tl-meta" style="display:block;font:600 9px Inter,sans-serif;letter-spacing:.1em;color:#7a6432">${esc(authorName(ev.author))} · ${esc(tlWhen(ev.at))}</span>`
    : `<span class="mx-tl-meta" style="display:block;font:600 8.5px Inter,sans-serif;letter-spacing:.12em;color:#9a9086">${esc(tlWhen(ev.at))}</span>`;
  return `
        <div class="mx-tl-item" style="display:flex;gap:10px">
          <span style="display:flex;flex-direction:column;align-items:center;flex:none;width:9px">
            <span style="width:7px;height:7px;border-radius:50%;background:${TL_DOT[ev.kind] || '#4a4239'};margin-top:4px;flex:none"></span>
            ${last ? '' : '<span style="width:1px;flex:1;background:rgba(32,27,22,.14);margin-top:3px"></span>'}
          </span>
          <span style="min-width:0;flex:1;padding-bottom:${last ? 2 : 12}px">
            ${meta}
            <span class="mx-tl-detail" style="display:block;font-size:12px;font-weight:600;margin-top:1px;line-height:1.45">${esc(ev.label)}</span>
            ${ev.detail ? `<span class="mx-tl-detail" style="display:block;font-size:11.5px;color:#6d6459;line-height:1.5;margin-top:1px">${esc(ev.detail)}</span>` : ''}
          </span>
        </div>`;
}
function blockTimeline(r) {
  if (!r || !r.email) return '';
  const C = COPY.timeline;
  const mine = TL && TL.email === r.email ? TL : null;
  const draft = rootEl ? (el => el ? el.value : '')(rootEl.querySelector('[data-role="tlNote"]')) : '';
  let body;
  if (!mine || mine.loading) body = `<div style="padding:2px 0 4px;font-size:11.5px;color:#9a9086">${C.loading}</div>`;
  else if (mine.error) body = `<div style="padding:2px 0 4px;font-size:11.5px;color:#7e151b">${C.error}</div>`;
  else if (!mine.events.length) body = `<div style="padding:2px 0 4px;font-size:11.5px;color:#6d6459;line-height:1.5">${C.empty}</div>`;
  else body = mine.events.map((ev, i) => tlItem(ev, i === mine.events.length - 1)).join('');
  return `
        <!-- dc: Admin Registrations.dc.html › "Registration file › Timeline" (v2 addition) -->
        <div data-block="tl" style="border-top:1px solid rgba(32,27,22,.08)">
          <div style="padding:12px 18px 10px;display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">
            <span style="font:600 9px Inter,sans-serif;letter-spacing:.16em;color:#201b16">${C.title}</span>
            ${mine && !mine.loading && !mine.error ? `<span style="font:600 8px Inter,sans-serif;letter-spacing:.12em;color:#9a9086">${esc(C.of(mine.events.length))}</span>` : ''}
          </div>
          <div class="mx-tl-scroll" style="padding:0 18px 6px;max-height:340px;overflow:auto">${body}</div>
          <div style="border-top:1px solid rgba(32,27,22,.08);padding:12px 18px;display:flex;flex-direction:column;gap:8px">
            <textarea data-role="tlNote" rows="2" maxlength="4000" placeholder="${esc(C.composerPh)}" aria-label="Add a staff note" style="border:1px solid rgba(32,27,22,.25);background:#fff;font:400 12.5px Inter,sans-serif;color:#201b16;padding:8px 10px;resize:vertical;outline:none;width:100%;box-sizing:border-box;min-height:42px">${esc(draft)}</textarea>
            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
              <span style="font-size:10.5px;color:#6d6459;flex:1;min-width:140px;line-height:1.45">${C.appendOnly}</span>
              <span data-act="tlAdd" role="button" style="padding:8px 12px;background:#201b16;color:#f6f2ea;font:600 9px Inter,sans-serif;letter-spacing:.12em;cursor:pointer;white-space:nowrap" data-hover="background:#3a322b">${C.add}</span>
            </div>
          </div>
        </div>
        <!-- /dc -->`;
}

function template() {
  return `
<div data-screen-label="Admin Registrations" style="min-height:100vh;background:#f6f2ea;color:#201b16;font-family:Inter,sans-serif">
  <div class="mx-gutter" style="max-width:1180px;margin:0 auto;padding:30px 28px 56px;display:flex;flex-direction:column;gap:20px">
    ${blockTitle()}
    ${blockStats()}
    ${blockFilters()}
    <!-- dc: Admin Registrations.dc.html › "All-events table" -->
    <div class="mx-side mx-regs-grid" style="display:grid;grid-template-columns:1fr 330px;gap:22px;align-items:start">
      ${blockTable()}
      ${blockPanel()}
    </div>
    <!-- /dc -->
    ${blockTransfers()}
  </div>
</div>`;
}

// ---------------------------------------------------------------- behaviour
function rerender(sel, html) { const el = rootEl && rootEl.querySelector(sel); if (el) el.outerHTML = html; }
function redrawData() {
  rerender('[data-block="stats"]', blockStats());
  rerender('[data-block="table"]', blockTable());
  rerender('[data-block="panel"]', blockPanel());
  syncButtons();
  ensureTimeline();                                       // the selected row may have changed under us (v2 timeline)
}
function syncButtons() {
  const e1 = rootEl && rootEl.querySelector('[data-role="emailSel"]'); if (e1) e1.textContent = COPY.emailSel(st.ticked.size);
  const e2 = rootEl && rootEl.querySelector('[data-role="exportCsv"]'); if (e2) e2.textContent = exportLabel();
}
async function refetch(alsoFilters) {
  if (!(await load()) || !rootEl) return;
  if (alsoFilters) rerender('[data-block="filters"]', blockFilters());
  redrawData();
  bindInputs();
}
function bindInputs() {
  const q = rootEl.querySelector('[data-role="regq"]');
  if (q && !q.dataset.bound) {
    q.dataset.bound = '1';
    q.addEventListener('input', () => { st.q = q.value; clearTimeout(qTimer); qTimer = setTimeout(() => refetch(false), 250); });
  }
  const ev = rootEl.querySelector('[data-role="ev"]');
  if (ev && !ev.dataset.bound) {
    ev.dataset.bound = '1';
    ev.addEventListener('change', () => { st.event = ev.value; st.sel = null; refetch(false); });
  }
}
function setFilter(patch) { Object.assign(st, patch); st.sel = null; st.shown = REG_WINDOW; refetch(true); }   // a new filter starts a fresh window (audit #11)

function csvExport() {
  const list = rows();
  const cell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const lines = ['Name,Email,Institution,Event,Status,When,Source'].concat(
    list.map(r => [r.name, r.email, r.institution, r.event, r.status, r.when || '', r.source || ''].map(cell).join(',')));
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent('﻿' + lines.join('\n'));   // BOM keeps diacritics intact in Excel
  a.download = COPY.csvName; a.click();
  ui.toast(COPY.toast.exported(list.length));
}

function composeModal(recipients) {
  const m = ui.modal({
    eyebrow: COPY.compose.eyebrow,
    title: COPY.compose.title(recipients.length),
    body: `
      <div style="display:flex;flex-direction:column;gap:10px">
        <label style="display:flex;flex-direction:column;gap:4px"><span class="label">${COPY.compose.subject}</span><input data-role="cSubject" class="input" maxlength="180"></label>
        <label style="display:flex;flex-direction:column;gap:4px"><span class="label">${COPY.compose.message}</span><textarea data-role="cMessage" class="input" rows="6" style="resize:vertical;font:400 13px Inter,sans-serif"></textarea></label>
        <span style="font-size:11.5px;color:#6d6459;line-height:1.5">${COPY.compose.note}</span>
      </div>`,
    actions: [
      { label: COPY.compose.cancel },
      { label: COPY.compose.queue, kind: 'primary', onClick: () => {
          const subject = m.el.querySelector('[data-role="cSubject"]').value.trim();
          const message = m.el.querySelector('[data-role="cMessage"]').value.trim();
          if (!subject || !message) { ui.toast(COPY.compose.needBoth); return false; }
          api.post('/api/v2/registrations/bulk-email', { recipients, subject, message })
            .then(r => { ui.toast(COPY.toast.queuedBulk(r.staged || recipients.length)); st.ticked.clear(); redrawData(); chrome.refresh(); })
            .catch(e => ui.toast(e.message, { kind: 'error' }));
        } }
    ]
  });
  const s = m.el.querySelector('[data-role="cSubject"]'); if (s) s.focus();
}

const handlers = {
  open: (el, ev) => { if (ev.target.closest('[data-act]') !== el) return; st.sel = el.dataset.key; st.cancelConfirm = null; rerender('[data-block="table"]', blockTable()); rerender('[data-block="panel"]', blockPanel()); ensureTimeline(); },
  tick: (el) => { const k = el.dataset.key; st.ticked.has(k) ? st.ticked.delete(k) : st.ticked.add(k); rerender('[data-block="table"]', blockTable()); syncButtons(); },
  selAll: () => { const list = rows(); const all = list.length && list.every(r => st.ticked.has(r.key)); list.forEach(r => all ? st.ticked.delete(r.key) : st.ticked.add(r.key)); rerender('[data-block="table"]', blockTable()); syncButtons(); },
  chip: (el) => setFilter({ status: el.dataset.chip }),
  clearLink: () => setFilter({ link: null, linkLabel: null }),
  linkTag: (el, ev) => { ev.stopPropagation(); setFilter({ link: el.dataset.link, linkLabel: el.dataset.label }); },
  statAll: () => setFilter({ event: 'all', status: 'ALL', link: null, linkLabel: null, q: '' }),
  statConf: () => setFilter({ event: 'conference', status: 'ALL' }),
  statGala: () => setFilter({ event: 'gala', status: 'ALL' }),
  statBoston: () => setFilter({ event: 'boston', status: 'ALL' }),
  showAll: () => { st.shown = 0; rerender('[data-block="table"]', blockTable()); },   // 0 = no display window
  more: () => { st.limit += 400; st.shown = 0; refetch(false); },
  emailSel: () => {
    if (!st.ticked.size) { ui.toast(COPY.toast.tickFirst); return; }
    const seen = new Set(); const recips = [];
    rows().forEach(r => { if (st.ticked.has(r.key) && r.email && !seen.has(r.email.toLowerCase())) { seen.add(r.email.toLowerCase()); recips.push({ email: r.email, name: r.name }); } });
    if (!recips.length) { ui.toast(COPY.toast.tickFirst); return; }
    composeModal(recips);
  },
  exportCsv: () => csvExport(),
  emailOne: () => { const r = selRow(); if (r && r.email) composeModal([{ email: r.email, name: r.name }]); },
  resend: async (el) => {
    const r = selRow(); if (!r) return;
    el.setAttribute('aria-disabled', 'true');
    try { await api.post(`/api/v2/registrations/${encodeURIComponent(r.type)}/${encodeURIComponent(r.id)}/resend-confirmation`); ui.toast(COPY.toast.queuedResend); chrome.refresh(); }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
    el.removeAttribute('aria-disabled');
  },
  markPaid: async (el) => {
    const r = selRow(); if (!r) return;
    el.setAttribute('aria-disabled', 'true');
    try { await api.post(`/api/admin/registrant/${encodeURIComponent(r.type)}/${encodeURIComponent(r.id)}/mark-paid`); ui.toast(COPY.toast.markedPaid); await refetch(false); }
    catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  openGala: () => {
    const r = selRow(); if (!r || !r.gala_id) return;
    const target = 'gala:' + r.gala_id;
    if (rows().some(x => x.key === target)) { st.sel = target; st.shown = 0; rerender('[data-block="table"]', blockTable()); rerender('[data-block="panel"]', blockPanel()); ensureTimeline(); }
    else { ui.toast(COPY.toast.galaRowMissing); st.q = ''; st.event = 'gala'; st.status = 'ALL'; st.link = null; st.sel = target; st.shown = 0; refetch(true); }
  },
  tlAdd: async (el) => {                                  // append-only staff note (v2 timeline)
    const r = selRow(); if (!r || !r.email) return;
    const ta = rootEl && rootEl.querySelector('[data-role="tlNote"]');
    const text = ta ? ta.value.trim() : '';
    if (!text) { ui.toast(COPY.timeline.needText); return; }
    el.setAttribute('aria-disabled', 'true');
    try {
      await api.post('/api/v2/registrations/notes', { email: r.email, text });
      if (ta) ta.value = '';
      ui.toast(COPY.timeline.noteAdded);
      await loadTimeline(r.email);                        // the fresh history now carries the note
      redrawTimeline();
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  cancel: async (el) => {
    const r = selRow(); if (!r) return;
    if (st.cancelConfirm !== r.key) { st.cancelConfirm = r.key; rerender('[data-block="panel"]', blockPanel()); return; }   // two-step confirm, per the artboard
    st.cancelConfirm = null;
    el.setAttribute('aria-disabled', 'true');
    try {
      if (r.type === 'signup') {                          // existing hard-delete route — permanent, no undo
        await api.del(`/api/admin/signup-forms/${encodeURIComponent(r.form_id)}/responses/${encodeURIComponent(r.id)}`);
        ui.toast(COPY.toast.removed);
      } else {
        const body = r.type === 'croatians-abroad' ? { event: r.ca_event } : {};
        const resp = await api.post(`/api/v2/registrations/${encodeURIComponent(r.type)}/${encodeURIComponent(r.id)}/cancel`, body);
        const prev = resp && resp.previous_status;
        ui.toast(COPY.toast.cancelled, { undo: async () => {
          try { await api.post(`/api/v2/registrations/${encodeURIComponent(r.type)}/${encodeURIComponent(r.id)}/restore`, Object.assign({ status: prev || 'pending' }, body)); ui.toast(COPY.toast.restored); }
          catch (e) { ui.toast(e.message, { kind: 'error' }); }
          if (rootEl) refetch(false);
        } });
      }
      await refetch(false);
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  }
};

export default {
  title: 'Registrations',
  async render(root, ctx) {
    rootEl = root; loadCss();
    st = { q: String(ctx.query.q || ''), event: String(ctx.query.event || 'all'), status: 'ALL',
      link: ctx.query.link ? String(ctx.query.link) : null, linkLabel: ctx.query.label ? String(ctx.query.label) : null,
      limit: 400, shown: REG_WINDOW, sel: null, ticked: new Set(), cancelConfirm: null };
    D = null; TL = null;
    await load();
    await loadTransfers();                                // RECENT TRANSFERS strip (additive)
    const r0 = selRow();
    if (r0 && r0.email) await loadTimeline(r0.email);     // TIMELINE drawer arrives with the first paint (additive)
    if (rootEl !== root) return;                          // navigated away while loading
    root.innerHTML = template();
    unbind = ui.bind(root, handlers);
    bindInputs();
  },
  destroy() { clearTimeout(qTimer); qTimer = null; reqId++; tlReq++; if (unbind) unbind(); unbind = null; rootEl = null; D = null; st = null; TL = null; }
};
