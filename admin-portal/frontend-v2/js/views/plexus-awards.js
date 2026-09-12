// js/views/plexus-awards.js — the Plexus Week hub's AWARDS tab (design/AWARDS-SPEC.md §Admin).
//
// No artboard source; built from the hub's own vocabulary — the blockStats() stat strip, the
// money.js table helpers and the studio.js tool-drawer — so it reads as one screen with the
// MEETUPS tab beside it.
//
// WHY ITS OWN MODULE: js/views/plexus.js is already 1.9k lines and owns four screens. The awards
// tab is a fifth, with its own data, its own drawer and its own eight handlers, so it lives here
// and plexus.js delegates: one import, one line in TAB_ORDER, one branch in template(), and the
// handler map merged into the hub's. Everything shared — the edition chip, the read-only rule,
// the tab strip — stays exactly where it already was.
//
// Permission section `plexus-awards` (server.js mirrors the id and maps /api/v2/awards-ops to
// it); without it the tab renders the locked state, the same way MEETUPS does.
import { api } from '../api.js';
import { session } from '../state.js';
import { ui, esc, fmt } from '../ui.js';
import { perms } from '../perms.js';

export const AW_SECTION = 'plexus-awards';

// ---- COPY: every string that may change in a revision ------------------------------------------
export const COPY_AW = {
  tab: 'AWARDS', tabLocked: 'AWARDS · LOCKED',
  locked: 'The awards are locked for you.',
  stats: {
    entries: 'ENTRIES', entriesSub: n => `${n} candidate${n === 1 ? '' : 's'} after grouping`,
    shortlist: 'SHORTLISTED', shortlistSub: 'across all four awards',
    laureates: 'LAUREATES', laureatesSub: (n, m) => `${n} chosen · ${m} seat${m === 1 ? '' : 's'} on the gala list`,
    panel: 'PANEL READ', panelSub: n => `${n} reader${n === 1 ? '' : 's'} on the panel`,
    held: 'HELD FOR REVIEW', heldSub: 'waiting on your approve/reject email'
  },
  cats: {
    title: 'THE FOUR AWARDS', sub: 'nominations, the reading panel, and who takes the stage',
    windows: { none: 'ORGANIZERS CHOOSE', before: 'NOT OPEN YET', open: 'OPEN', closed: 'CLOSED' },
    closes: n => n == null ? '' : (n < 0 ? 'closed' : n === 0 ? 'closes today' : `${n} day${n === 1 ? '' : 's'} to close`),
    counts: (e, c) => `${e} entr${e === 1 ? 'y' : 'ies'} · ${c} candidate${c === 1 ? '' : 's'}`,
    open: 'OPEN', ranking: 'RANKING', settings: 'SETTINGS', add: 'ADD LAUREATE', notify: 'DECIDE & NOTIFY', csv: 'CSV',
    empty: 'No awards on this edition yet — they seed themselves on the next boot.'
  },
  panel: {
    title: 'ENTRIES', back: '← ALL FOUR AWARDS',
    filterAll: 'ALL', search: 'Search a name, an institution…',
    head: { name: 'CANDIDATE', who: 'WHO PUT THEM FORWARD', inst: 'INSTITUTION', score: 'MEAN', n: 'READ', status: 'STATUS' },
    noms: n => n === 1 ? '1 nomination' : `${n} nominations`,
    self: 'SELF', merged: 'MERGED',
    empty: 'Nothing here yet.',
    emptyWhy: 'Entries appear as people send them — the public page is the only way in.'
  },
  acts: {
    open: 'OPEN', eligible: 'ELIGIBLE', ineligible: 'NOT ELIGIBLE', shortlist: 'SHORTLIST',
    winner: 'CHOOSE AS WINNER', decline: 'DECLINE', merge: 'MERGE', pdf: 'PDF', note: 'SAVE NOTE', close: 'CLOSE'
  },
  status: {
    received: 'RECEIVED', eligible: 'ELIGIBLE', ineligible: 'NOT ELIGIBLE', shortlisted: 'SHORTLISTED',
    winner: 'WINNER', declined: 'DECLINED', withdrawn: 'WITHDRAWN', 'pending-review': 'HELD'
  },
  drawer: {
    entry: 'THE ENTRY', scores: 'WHAT THE PANEL SAID', nominators: 'PUT FORWARD BY', notes: 'YOUR NOTE',
    noScores: 'Nobody has read this one yet.',
    conflictNote: n => n ? `${n} reader${n === 1 ? '' : 's'} declared a conflict — left out of every number.` : '',
    mean: (m, n) => m == null ? 'not scored' : `${m} mean · ${n} reader${n === 1 ? '' : 's'}`,
    spread: s => s == null ? '' : `spread ${s}`,
    saved: 'NOTE SAVED', statusDone: s => `MOVED TO ${s}`, mergeAsk: (a, b) => `Merge “${a}” into “${b}”? Their nominations become nominations of the surviving name — nothing is deleted.`,
    mergeOk: 'MERGE', mergeKeep: 'KEEP BOTH', mergePick: 'PICK THE SURVIVING CANDIDATE FIRST',
    pdfMissing: 'That attachment is not on file storage — nothing to download.'
  },
  rank: {
    title: 'RANKING', sub: 'mean of every score, conflicts excluded',
    head: { rank: '#', name: 'CANDIDATE', mean: 'MEAN', spread: 'SPREAD', n: 'READ', conf: 'CONFLICTS' },
    empty: 'Nothing to rank yet — the panel has not scored anything in this award.',
    note: 'A conflict-flagged score counts for nothing: not in the mean, not in the spread, not in n.',
    winner: 'WINNER', shortlist: 'SHORTLIST'
  },
  reviewers: {
    title: 'THE READING PANEL', sub: 'a handful of people, one link each, no login',
    add: '+ ADD A READER', name: 'Name', email: 'Email', cats: 'WHICH AWARDS',
    send: 'ADD & SEND THE INVITATION', sent: 'INVITATION SENT',
    resend: 'RESEND', revoke: 'REVOKE', copy: 'COPY LINK', copied: 'LINK COPIED',
    progress: (a, b) => `${a} of ${b} read`,
    empty: 'Nobody on the panel yet.',
    emptyWhy: 'Add two or three people you trust to read. Each gets one private link — no account, no password.',
    revokeAsk: n => `Revoke ${n}? Their link stops working at once; the scores they already gave stay in the ranking.`,
    revokeOk: 'REVOKE', revokeKeep: 'KEEP',
    nameFirst: 'A NAME AND AN EMAIL FIRST', catFirst: 'PICK AT LEAST ONE AWARD',
    statusTag: { invited: 'INVITED', active: 'READING', revoked: 'REVOKED' }
  },
  notify: {
    title: 'DECIDE & NOTIFY', sub: 'every letter waits in the Outbox for your approval',
    winners: 'Winners', shortlisted: 'Shortlisted, not selected', declined: 'Everyone else, kindly', nominators: 'Thank-you to nominators',
    preview: 'PREVIEW', stage: 'STAGE THEM IN THE OUTBOX',
    staged: n => `${n} LETTER${n === 1 ? '' : 'S'} WAITING IN THE OUTBOX — NOTHING HAS BEEN SENT`,
    none: 'NOTHING TO STAGE — CHOOSE A WINNER FIRST',
    note: 'Nothing leaves Med&X from this screen. The drafts land under Inbox → Email & Outbox, and only APPROVE & SEND there puts them on the wire.'
  },
  laureate: {
    title: 'ADD A LAUREATE', sub: 'the Lifetime Bridge is chosen here, not nominated',
    name: 'Full name', inst: 'Institution', cite: 'Citation (read out at the Gala)', photo: 'Photo URL', email: 'Email (for the letter)',
    save: 'ADD THE LAUREATE', added: 'LAUREATE ADDED', nameFirst: 'TYPE THE NAME FIRST',
    remove: 'REMOVE', removeAsk: n => `Remove ${n} from the laureates? The entry itself stays exactly as it is.`,
    removeOk: 'REMOVE', removeKeep: 'KEEP', removed: 'LAUREATE REMOVED',
    presents: 'SPEAKS', confirmed: 'CONFIRMED', unconfirmed: 'NOT CONFIRMED', slides: 'SLIDES ON FILE', noSlides: 'NO SLIDES',
    seat: 'GALA SEAT · COMP', noSeat: 'NO SEAT YET'
  },
  settings: {
    title: 'SETTINGS', sub: 'names, criteria, dates and the rubric — all live',
    name: 'Name (English)', nameHr: 'Naziv (hrvatski)', cite: 'Citation', citeHr: 'Obrazloženje (hrvatski)',
    opens: 'Opens (Zagreb time)', closes: 'Closes (Zagreb time)', max: 'How many laureates',
    self: 'Self-nominations allowed', crit: 'Criteria (English)', critHr: 'Kriteriji (hrvatski)',
    save: 'SAVE', saved: 'SETTINGS SAVED — THE PUBLIC PAGE READS THEM LIVE'
  },
  roster: { title: 'GALA ROSTER', csv: 'ROSTER CSV', sheet: 'PRINTABLE ONE-PAGER', sub: 'for the seating team and the MC' },
  err: 'Could not load the awards.'
};

// ---- the hub's shared inline vocabulary (same values js/views/plexus.js uses) -------------------
const HAIR = 'rgba(32,27,22,.14)', HAIR12 = 'rgba(32,27,22,.12)', HAIR07 = 'rgba(32,27,22,.07)';
const MICRO = 'font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#6d6459';
const BTN_GHOST = 'padding:7px 11px;border:1px solid rgba(32,27,22,.2);font:600 9px Inter,sans-serif;letter-spacing:.12em;cursor:pointer;color:#201b16;white-space:nowrap';
const INPUT2 = 'border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:8px 10px;font:400 12.5px Inter,sans-serif;color:#201b16';
const TONE = {
  received: ['#f6f2ea', '#6d6459'], eligible: ['#f8f1e2', '#7a6432'], ineligible: ['#f6f2ea', '#9a9086'],
  shortlisted: ['#1f4f7a', '#fff'], winner: ['#1e6e42', '#fff'], declined: ['#f6f2ea', '#9a9086'],
  withdrawn: ['#f6f2ea', '#9a9086'], 'pending-review': ['#9b1b22', '#fff']
};

function tbl(headers, bodyRows, minWidth) {
  return `
    <div class="mxp-scroll" style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;min-width:${minWidth || 900}px">
        <thead><tr>${headers.map(h => `<th style="text-align:${h.r ? 'right' : 'left'};padding:9px 10px;${MICRO};border-bottom:1px solid ${HAIR12};white-space:nowrap">${h.t}</th>`).join('')}</tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>`;
}
const td = (v, extra) => `<td style="font-size:12.5px;padding:9px 10px;border-bottom:1px solid ${HAIR07};vertical-align:top;${extra || ''}">${v}</td>`;
const tdNum = v => td(`<span style="font-family:Fraunces,serif;font-size:14px;white-space:nowrap">${v}</span>`, 'text-align:right');
const tdActs = acts => td(`<span style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap">${acts}</span>`, 'text-align:right');
const act = (a, id, label, extra) => `<span data-act="${a}" data-id="${esc(id)}"${extra || ''} style="${BTN_GHOST}" data-hover="border-color:#201b16">${label}</span>`;
const chip = (text, bg, fg) => `<span style="background:${bg};color:${fg};font:600 8.5px Inter,sans-serif;letter-spacing:.12em;padding:3px 7px;white-space:nowrap">${esc(text)}</span>`;
const fLab = t => `<span style="${MICRO}">${t}</span>`;
const fText = (role, label, value, ph, span) =>
  `<label style="display:flex;flex-direction:column;gap:5px;min-width:0${span ? ';grid-column:1 / -1' : ''}">${fLab(esc(label))}<input data-role="${role}" type="text" value="${esc(value == null ? '' : value)}" placeholder="${esc(ph || '')}" aria-label="${esc(label)}" style="width:100%;box-sizing:border-box;${INPUT2}"></label>`;
const fArea = (role, label, value, rows) =>
  `<label style="display:flex;flex-direction:column;gap:5px;min-width:0;grid-column:1 / -1">${fLab(esc(label))}<textarea data-role="${role}" rows="${rows || 4}" aria-label="${esc(label)}" style="width:100%;box-sizing:border-box;resize:vertical;${INPUT2}">${esc(value == null ? '' : value)}</textarea></label>`;

async function fetchBlob(path) {
  const res = await fetch(api.url(path), { headers: { Authorization: 'Bearer ' + session.token } });
  if (!res.ok) { let j = null; try { j = JSON.parse(await res.text()); } catch (e) {} throw new Error((j && (j.message || j.error)) || ('The export failed (HTTP ' + res.status + ').')); }
  return res.blob();
}
const dl = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
// Same anchor trick for a URL the server already signed. The presigned S3 link carries
// Content-Disposition: attachment, so this downloads instead of navigating away.
const dlHref = (href, name) => { const a = document.createElement('a'); a.href = href; if (name) a.download = name; a.rel = 'noopener'; a.click(); };

// ---- state --------------------------------------------------------------------------------------
// H is the host contract js/views/plexus.js hands us once per render: how to repaint, which
// edition is chosen, and whether that edition is read-only. Nothing else crosses the line.
let H = null, A = null, S = null;

export function initAwards(host) {
  H = host;
  S = { cat: null, data: null, busy: false, filter: '', term: '', drawer: null, entry: null, rank: null, revs: null, notify: null, mergeFrom: null };
}
export function setAwardsData(d) { A = d || null; }
export const awardsLoaded = () => !!A;
export const canAwards = () => perms.can(AW_SECTION);
const readOnly = () => !!(H && H.readOnly && H.readOnly()) || !!(A && A.read_only);
const cats = () => (A && Array.isArray(A.categories)) ? A.categories : [];
const catById = (id) => cats().find(c => String(c.id) === String(id)) || null;
const stats = () => (A && A.stats) || {};
const reviewers = () => (A && Array.isArray(A.reviewers)) ? A.reviewers : [];
const opsUrl = (tail) => '/api/v2/awards-ops' + tail;
const edQ = () => { const id = H && H.editionId && H.editionId(); return id ? '?edition=' + encodeURIComponent(id) : ''; };

// ---- data ---------------------------------------------------------------------------------------
export function loadAwards(editionId) {
  return api.get(opsUrl('/overview') + (editionId ? '?edition=' + encodeURIComponent(editionId) : ''));
}
async function reloadOverview() {
  try { A = await loadAwards(H && H.editionId && H.editionId()); } catch (e) { ui.toast(e.message, { kind: 'error' }); }
}
async function reloadCategory(id) {
  S.busy = true;
  paintPanel();
  try { S.data = await api.get(opsUrl('/categories/' + encodeURIComponent(id) + '/entries')); }
  catch (e) { ui.toast(e.message, { kind: 'error' }); S.data = { candidates: [], laureates: [], withdrawn: [] }; }
  S.busy = false;
  paintPanel();
}
function paintAll() { if (H && H.paint) H.paint(); }
function paintPanel() { if (H && H.paintPart) H.paintPart('[data-block="awBody"]', blockAwBody()); }
function paintDrawer() { if (H && H.paintPart) H.paintPart('[data-block="awDrawer"]', blockAwDrawer()); }

// ================================================================ BLOCKS
function blockAwStats() {
  const s = stats(), c = COPY_AW.stats;
  const seats = cats().reduce((n, x) => n + (x.laureate_rows || []).filter(l => l.gala_registration_id).length, 0);
  const cell = (k, v, sub, last) => `
        <div style="padding:16px 20px;${last ? '' : 'border-right:1px solid rgba(32,27,22,.1)'}">
          <div style="font:600 9px Inter,sans-serif;letter-spacing:.15em;color:#6d6459">${k}</div>
          <div class="mx-display-30" style="font-family:Fraunces,serif;font-size:30px;margin-top:3px">${esc(v)}</div>
          <div style="font-size:11px;color:${sub && /HELD/.test(k) && Number(s.pending_review) ? '#9b1b22' : '#6d6459'}">${esc(sub)}</div>
        </div>`;
  return `
    <!-- v2: "AWARDS — stat strip" (the Plexus hub stat-strip markup, five cells) -->
    <div data-block="awStats" data-v2="awards stats" style="border:1px solid ${HAIR};background:#fff;margin-top:22px">
      <div class="mx-kpi" style="display:grid;grid-template-columns:repeat(5,1fr)">
        ${cell(c.entries, fmt.num(s.entries || 0), c.entriesSub(s.candidates || 0))}
        ${cell(c.shortlist, fmt.num(s.shortlisted || 0), c.shortlistSub)}
        ${cell(c.laureates, fmt.num(s.laureates || 0), c.laureatesSub(s.winners || 0, seats))}
        ${cell(c.panel, (s.reviewer_percent || 0) + '%', c.panelSub(s.reviewers || 0))}
        ${cell(c.held, fmt.num(s.pending_review || 0), c.heldSub, true)}
      </div>
    </div>
    <!-- /v2 -->`;
}

function catRow(c) {
  const t = COPY_AW.cats;
  const ro = readOnly();
  const wTone = { none: ['#f6f2ea', '#6d6459'], before: ['#f8f1e2', '#7a6432'], open: ['#1e6e42', '#fff'], closed: ['#f6f2ea', '#9a9086'] }[c.window] || ['#f6f2ea', '#6d6459'];
  const laur = (c.laureate_rows || []);
  const acts = [
    act('awOpen', c.id, t.open),
    act('awRank', c.id, t.ranking),
    c.intake === 'none' && !ro ? act('awLaureate', c.id, t.add) : '',
    ro ? '' : act('awNotify', c.id, t.notify),
    act('awCsv', c.id, t.csv),
    ro ? '' : act('awSettings', c.id, t.settings)
  ].filter(Boolean).join('');
  return `
      <tr data-row="aw-${esc(c.id)}">
        ${td(`<span style="display:flex;flex-direction:column;gap:3px;min-width:0">
              <span style="font-size:13px;font-weight:600">${esc(c.name)}</span>
              <span style="font-size:11.5px;color:#6d6459">${esc(c.citation || '')}</span>
              ${laur.length ? `<span style="display:flex;gap:7px;flex-wrap:wrap;margin-top:3px">${laur.map(l => chip(l.name, '#1e6e42', '#fff')).join('')}</span>` : ''}
            </span>`, 'min-width:280px')}
        ${td(`<span style="display:flex;flex-direction:column;gap:3px">${chip(t.windows[c.window] || String(c.window || '').toUpperCase(), wTone[0], wTone[1])}
              <span style="font-size:11px;color:#6d6459">${esc(c.window === 'open' ? t.closes(c.days_to_close) : (c.closes_at ? String(c.closes_at).slice(0, 10) : ''))}</span></span>`)}
        ${td(`<span style="font-size:12px;color:#6d6459">${esc(t.counts(c.counts.entries, c.counts.candidates))}</span>`)}
        ${tdNum(c.counts.shortlisted || '<span style="color:#9a9086">—</span>')}
        ${tdNum(c.laureates ? `${c.laureates} / ${c.laureates_max}` : `<span style="color:#9a9086">0 / ${c.laureates_max}</span>`)}
        ${td(c.counts.pending_review ? chip(String(c.counts.pending_review) + ' HELD', '#9b1b22', '#fff') : '<span style="color:#9a9086">—</span>')}
        ${tdActs(acts)}
      </tr>`;
}

function blockAwCats() {
  const t = COPY_AW.cats;
  const rows = cats();
  const headers = [{ t: 'AWARD' }, { t: 'INTAKE' }, { t: 'ENTRIES' }, { t: 'SHORT', r: 1 }, { t: 'LAUREATES', r: 1 }, { t: 'HELD' }, { t: '', r: 1 }];
  return `
    <div data-block="awCats" style="border:1px solid ${HAIR};background:#fff;margin-top:22px">
      <div class="mxp-cardhead" style="padding:14px 20px;border-bottom:1px solid ${HAIR12};display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em;white-space:nowrap">${t.title}</span>
        <span style="font-size:11.5px;color:#9a9086">${t.sub}</span>
        <div style="flex:1"></div>
        ${act('awReviewers', 'panel', COPY_AW.reviewers.title)}
        ${act('awRoster', 'roster', COPY_AW.roster.csv)}
        ${act('awOnePager', 'sheet', COPY_AW.roster.sheet)}
      </div>
      ${rows.length ? tbl(headers, rows.map(catRow).join(''), 1080)
        : `<div class="empty" style="padding:30px 20px"><span style="width:28px;height:1px;background:#c9a962"></span><span class="empty-line">${t.empty}</span></div>`}
    </div>`;
}

// ---- one award opened -----------------------------------------------------------------------
function candRow(c) {
  const p = COPY_AW.panel;
  const tone = TONE[c.status] || TONE.received;
  const who = c.self_nominated && !c.nominators.length
    ? p.self
    : (c.nominators.length ? c.nominators.map(n => n.name || n.email).filter(Boolean).slice(0, 3).join(', ') + (c.nominators.length > 3 ? ` +${c.nominators.length - 3}` : '') : '—');
  return `
      <tr data-row="awc-${esc(c.key)}">
        ${td(`<span style="display:flex;flex-direction:column;gap:2px;min-width:0">
              <span style="font-size:13px;font-weight:600">${esc(c.name)}</span>
              <span style="display:flex;gap:8px;flex-wrap:wrap;align-items:baseline">
                <span style="${MICRO};color:#c9a962;white-space:nowrap">${esc(p.noms(c.nominations))}</span>
                ${c.self_nominated ? `<span style="${MICRO};color:#9a9086">${p.self}</span>` : ''}
                ${c.email ? `<span style="font-size:11px;color:#6d6459">${esc(c.email)}</span>` : ''}
              </span></span>`, 'min-width:230px')}
        ${td(`<span style="font-size:12px;color:#6d6459">${esc(who)}</span>`)}
        ${td(`<span style="font-size:12px">${esc(c.institution || '—')}</span>`)}
        ${tdNum(c.scores.mean == null ? '<span style="color:#9a9086">—</span>' : esc(String(c.scores.mean)))}
        ${tdNum(c.scores.n ? esc(String(c.scores.n)) : '<span style="color:#9a9086">0</span>')}
        ${td(chip(COPY_AW.status[c.status] || String(c.status).toUpperCase(), tone[0], tone[1]))}
        ${tdActs(act('awEntry', c.lead_entry_id, COPY_AW.acts.open) + (readOnly() ? '' : act('awMerge', c.key, COPY_AW.acts.merge)))}
      </tr>`;
}

function laureateStrip(cat) {
  const t = COPY_AW.laureate;
  const rows = (S.data && S.data.laureates) || [];
  if (!rows.length) return '';
  return `
      <div style="padding:14px 20px;border-top:1px solid ${HAIR12};background:#fdfbf6">
        <div style="${MICRO};color:#6d6459">LAUREATES</div>
        ${rows.map(l => `
        <div style="display:flex;gap:12px;align-items:baseline;flex-wrap:wrap;padding:8px 0;border-bottom:1px solid ${HAIR07}">
          <span style="font-family:Fraunces,serif;font-size:16px">${esc(l.name)}</span>
          ${l.institution ? `<span style="font-size:12px;color:#6d6459">${esc(l.institution)}</span>` : ''}
          ${l.present_minutes ? chip(`${t.presents} · ${l.present_minutes} MIN`, '#f8f1e2', '#7a6432') : ''}
          ${l.present_minutes ? chip(l.presentation_confirmed ? t.confirmed : t.unconfirmed, l.presentation_confirmed ? '#1e6e42' : '#f6f2ea', l.presentation_confirmed ? '#fff' : '#9a9086') : ''}
          ${l.present_minutes ? chip(l.slides_name ? t.slides : t.noSlides, '#f6f2ea', '#6d6459') : ''}
          ${chip(l.gala_registration_id ? t.seat : t.noSeat, l.gala_registration_id ? '#1f4f7a' : '#f6f2ea', l.gala_registration_id ? '#fff' : '#9a9086')}
          <div style="flex:1"></div>
          ${l.slides_url ? act('awCopy', l.slides_url, 'SLIDES LINK') : ''}
          ${readOnly() ? '' : act('awDelLaureate', l.id, t.remove, ` data-name="${esc(l.name)}"`)}
        </div>`).join('')}
      </div>`;
}

function blockAwPanel() {
  const cat = catById(S.cat);
  if (!cat) return '';
  const p = COPY_AW.panel;
  const all = (S.data && S.data.candidates) || [];
  const rows = all
    .filter(c => !S.filter || c.status === S.filter)
    .filter(c => !S.term || [c.name, c.email, c.institution, c.position].filter(Boolean).some(v => String(v).toLowerCase().includes(S.term.toLowerCase())));
  const headers = [{ t: p.head.name }, { t: p.head.who }, { t: p.head.inst }, { t: p.head.score, r: 1 }, { t: p.head.n, r: 1 }, { t: p.head.status }, { t: '', r: 1 }];
  const filters = ['', 'pending-review', 'received', 'eligible', 'shortlisted', 'winner', 'declined', 'ineligible'].map(s => {
    const on = S.filter === s;
    return `<span data-act="awFilter" data-id="${esc(s)}" style="padding:5px 9px;font:600 9px Inter,sans-serif;letter-spacing:.12em;cursor:pointer;border:1px solid ${on ? '#201b16' : 'rgba(32,27,22,.2)'};background:${on ? '#201b16' : 'transparent'};color:${on ? '#f6f2ea' : '#6d6459'};white-space:nowrap" data-hover="border-color:#201b16">${esc(s ? (COPY_AW.status[s] || s.toUpperCase()) : p.filterAll)}</span>`;
  }).join('');
  return `
    <div data-block="awPanel" style="border:1px solid ${HAIR};background:#fff;margin-top:22px">
      <div class="mxp-cardhead" style="padding:14px 20px;border-bottom:1px solid ${HAIR12};display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <span data-act="awClose" style="${BTN_GHOST}" data-hover="border-color:#201b16">${p.back}</span>
        <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em;white-space:nowrap">${esc(cat.name)}</span>
        <span style="font-size:11.5px;color:#9a9086">${esc(COPY_AW.cats.counts(cat.counts.entries, cat.counts.candidates))}</span>
        <div style="flex:1"></div>
        ${act('awRank', cat.id, COPY_AW.cats.ranking)}
        ${readOnly() ? '' : act('awNotify', cat.id, COPY_AW.cats.notify)}
      </div>
      <div style="padding:12px 20px;border-bottom:1px solid ${HAIR12};display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        ${filters}
        <div style="flex:1"></div>
        <input data-role="awSearch" type="search" value="${esc(S.term)}" placeholder="${esc(p.search)}" aria-label="${esc(p.search)}" style="min-width:200px;${INPUT2}">
      </div>
      ${S.busy ? `<div style="padding:26px 20px;font-size:12.5px;color:#6d6459">…</div>`
        : rows.length ? tbl(headers, rows.map(candRow).join(''), 1040)
        : `<div class="empty" style="padding:30px 20px"><span style="width:28px;height:1px;background:#c9a962"></span><span class="empty-line">${p.empty}</span><span class="empty-why">${p.emptyWhy}</span></div>`}
      ${laureateStrip(cat)}
    </div>`;
}

// ---- the drawer (the studio.js tool-drawer idiom: one slot, per-tool body) ---------------------
function drawerShell(title, sub, body) {
  return `
    <div data-block="awDrawer" id="awDrawer" style="border:1px solid ${HAIR};background:#fff;margin-top:22px">
      <div class="mxp-cardhead" style="padding:14px 20px;border-bottom:1px solid ${HAIR12};display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em;white-space:nowrap">${esc(title)}</span>
        <span style="font-size:11.5px;color:#9a9086">${esc(sub || '')}</span>
        <div style="flex:1"></div>
        <span data-act="awDrawerClose" style="${BTN_GHOST}" data-hover="border-color:#201b16">${COPY_AW.acts.close}</span>
      </div>
      <div style="padding:18px 20px">${body}</div>
    </div>`;
}

function drawerEntry() {
  const d = S.entry;
  if (!d) return drawerShell(COPY_AW.drawer.entry, '', '<div style="font-size:12.5px;color:#6d6459">…</div>');
  const e = d.entry, sc = d.scores || { per_reviewer: [] };
  const dd = COPY_AW.drawer;
  const ro = readOnly();
  const field = (k, v) => v ? `<div style="display:flex;gap:12px;padding:7px 0;border-bottom:1px solid ${HAIR07};font-size:12.5px"><span style="min-width:120px;${MICRO}">${esc(k)}</span><span style="min-width:0;color:#201b16;white-space:pre-wrap">${esc(v)}</span></div>` : '';
  const long = (k, v) => v ? `<div style="margin-top:14px"><div style="${MICRO}">${esc(k)}</div><div style="font-size:13px;line-height:1.7;color:#4a4239;margin-top:5px;white-space:pre-wrap">${esc(v)}</div></div>` : '';
  const statusBtn = (s, label) => ro || e.status === s ? '' : `<span data-act="awStatus" data-id="${esc(e.id)}" data-status="${s}" style="${BTN_GHOST}" data-hover="border-color:#201b16">${label}</span>`;
  return drawerShell(dd.entry, e.name, `
    <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:26px;align-items:start" class="mx-two">
      <div style="min-width:0">
        ${field('STATUS', COPY_AW.status[e.status] || e.status)}
        ${field('KIND', e.kind)}
        ${field('EMAIL', e.nominee_email)}
        ${field('INSTITUTION', e.nominee_institution)}
        ${field('POSITION', e.nominee_position)}
        ${field('COUNTRY', e.nominee_country)}
        ${field('BORN', e.nominee_birth_year)}
        ${field('SCHOOL', [e.school, e.study_year].filter(Boolean).join(' · '))}
        ${field('WILLING TO PRESENT', e.willing_to_present ? 'yes' : '')}
        ${field('CONSENT TO PUBLISH', e.consent_publish ? 'yes' : 'no')}
        ${field('HELD BECAUSE', e.gate_reason)}
        ${e.links && e.links.length ? `<div style="margin-top:10px;${MICRO}">LINKS</div><div style="font-size:12px;margin-top:4px">${e.links.map(u => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer nofollow">${esc(u)}</a>`).join('<br>')}</div>` : ''}
        ${long('STATEMENT', e.statement)}
        ${long('THE CHALLENGE', e.challenge)}
        ${long('THEIR SOLUTION', e.solution)}
        ${long('WHY THEM', e.why_you)}
        ${e.attachment ? `<div style="margin-top:14px">${act('awPdf', e.id, `${COPY_AW.acts.pdf} · ${esc(e.attachment.name)}`)}</div>` : ''}
        <div style="margin-top:18px">
          <div style="${MICRO}">${dd.notes}</div>
          <textarea data-role="awNote" rows="3" style="width:100%;box-sizing:border-box;margin-top:5px;${INPUT2}">${esc(e.admin_notes || '')}</textarea>
          ${ro ? '' : `<span data-act="awSaveNote" data-id="${esc(e.id)}" style="${BTN_GHOST};margin-top:8px;display:inline-block" data-hover="border-color:#201b16">${COPY_AW.acts.note}</span>`}
        </div>
      </div>
      <div style="min-width:0">
        <div style="${MICRO}">${dd.nominators}</div>
        ${(d.nominators || []).length ? (d.nominators || []).map(n => `
          <div style="padding:7px 0;border-bottom:1px solid ${HAIR07};font-size:12.5px">
            <div style="font-weight:600">${esc(n.name || n.email || '—')}</div>
            <div style="font-size:11.5px;color:#6d6459">${esc([n.email, n.relation].filter(Boolean).join(' · ') || '')}</div>
          </div>`).join('') : `<div style="font-size:12px;color:#6d6459;font-style:italic;padding:6px 0">${e.kind === 'application' ? 'A student’s own application.' : 'A self-nomination.'}</div>`}

        <div style="${MICRO};margin-top:18px">${dd.scores}</div>
        <div style="font-size:13px;margin-top:4px">${esc(dd.mean(sc.mean, sc.n))}${sc.spread != null ? ` · ${esc(dd.spread(sc.spread))}` : ''}</div>
        ${sc.conflicts ? `<div style="font-size:11.5px;color:#9b1b22;margin-top:3px">${esc(dd.conflictNote(sc.conflicts))}</div>` : ''}
        ${(sc.per_reviewer || []).length ? (sc.per_reviewer || []).map(r => `
          <div style="padding:8px 0;border-bottom:1px solid ${HAIR07};font-size:12.5px">
            <div style="display:flex;gap:8px;align-items:baseline"><span style="font-weight:600">${esc(r.reviewer)}</span>${r.conflict ? chip('CONFLICT', '#9b1b22', '#fff') : `<span style="font-family:Fraunces,serif;font-size:15px">${esc(String(r.total))}</span>`}</div>
            ${r.conflict ? '' : `<div style="font-size:11px;color:#6d6459">${esc(Object.keys(r.scores || {}).map(k => `${k} ${r.scores[k]}`).join(' · '))}</div>`}
            ${r.comment ? `<div style="font-size:12px;color:#4a4239;margin-top:4px;line-height:1.6">${esc(r.comment)}</div>` : ''}
          </div>`).join('') : `<div style="font-size:12px;color:#6d6459;font-style:italic;padding:6px 0">${dd.noScores}</div>`}

        <div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:18px">
          ${statusBtn('eligible', COPY_AW.acts.eligible)}
          ${statusBtn('ineligible', COPY_AW.acts.ineligible)}
          ${statusBtn('shortlisted', COPY_AW.acts.shortlist)}
          ${statusBtn('winner', COPY_AW.acts.winner)}
          ${statusBtn('declined', COPY_AW.acts.decline)}
        </div>
      </div>
    </div>`);
}

function drawerRank() {
  const r = S.rank;
  const c = COPY_AW.rank;
  if (!r) return drawerShell(c.title, '', '<div style="font-size:12.5px;color:#6d6459">…</div>');
  const ro = readOnly();
  const headers = [{ t: c.head.rank }, { t: c.head.name }, { t: c.head.mean, r: 1 }, { t: c.head.spread, r: 1 }, { t: c.head.n, r: 1 }, { t: c.head.conf, r: 1 }, { t: '', r: 1 }];
  const rows = (r.ranking || []).map(x => `
      <tr>
        ${td(`<span style="font-family:Fraunces,serif;font-size:16px">${x.rank}</span>`)}
        ${td(`<span style="font-size:13px;font-weight:600">${esc(x.entry.name)}</span><div style="font-size:11.5px;color:#6d6459">${esc(x.entry.nominee_institution || '')}</div>`)}
        ${tdNum(x.mean == null ? '<span style="color:#9a9086">—</span>' : `${esc(String(x.mean))} <span style="font-size:11px;color:#6d6459">/ ${esc(String(r.max_total))}</span>`)}
        ${tdNum(x.spread == null ? '<span style="color:#9a9086">—</span>' : esc(String(x.spread)))}
        ${tdNum(esc(String(x.n)))}
        ${tdNum(x.conflicts ? `<span style="color:#9b1b22">${esc(String(x.conflicts))}</span>` : '<span style="color:#9a9086">0</span>')}
        ${tdActs(ro ? '' : (`<span data-act="awStatus" data-id="${esc(x.entry.id)}" data-status="shortlisted" style="${BTN_GHOST}" data-hover="border-color:#201b16">${c.shortlist}</span>`
          + `<span data-act="awStatus" data-id="${esc(x.entry.id)}" data-status="winner" style="${BTN_GHOST}" data-hover="border-color:#201b16">${c.winner}</span>`))}
      </tr>`).join('');
  return drawerShell(c.title, `${r.category.name} · ${c.sub}`, `
    ${(r.ranking || []).length ? tbl(headers, rows, 820) : `<div style="font-size:12.5px;color:#6d6459;font-style:italic">${c.empty}</div>`}
    <div style="font-size:11.5px;color:#6d6459;margin-top:12px">${c.note}</div>`);
}

function drawerReviewers() {
  const c = COPY_AW.reviewers;
  const ro = readOnly();
  const list = reviewers();
  const catOpts = cats().map(x => `<label style="display:flex;gap:7px;align-items:center;font-size:12.5px;white-space:nowrap"><input type="checkbox" data-role="awRevCat" value="${esc(x.id)}" style="accent-color:#9b1b22">${esc(x.name)}</label>`).join('');
  const rows = list.map(r => {
    const tone = { invited: ['#f8f1e2', '#7a6432'], active: ['#1e6e42', '#fff'], revoked: ['#f6f2ea', '#9a9086'] }[r.status] || ['#f6f2ea', '#6d6459'];
    return `
      <div style="display:flex;gap:12px;align-items:baseline;flex-wrap:wrap;padding:10px 0;border-bottom:1px solid ${HAIR07}">
        <span style="font-size:13px;font-weight:600">${esc(r.name)}</span>
        <span style="font-size:11.5px;color:#6d6459">${esc(r.email)}</span>
        ${chip(c.statusTag[r.status] || String(r.status).toUpperCase(), tone[0], tone[1])}
        <span style="font-size:12px;color:#6d6459">${esc(c.progress(r.scored, r.total))}</span>
        <span style="flex:1;min-width:60px;height:4px;background:#f6f2ea;display:inline-block"><span style="display:block;height:4px;width:${Math.max(0, Math.min(100, r.percent))}%;background:#1e6e42"></span></span>
        ${act('awCopy', r.room_url, c.copy)}
        ${ro || r.status === 'revoked' ? '' : act('awResend', r.id, c.resend)}
        ${ro || r.status === 'revoked' ? '' : act('awRevoke', r.id, c.revoke, ` data-name="${esc(r.name)}"`)}
      </div>`;
  }).join('');
  return drawerShell(c.title, c.sub, `
    ${list.length ? rows : `<div class="empty" style="padding:16px 0"><span style="width:28px;height:1px;background:#c9a962"></span><span class="empty-line">${c.empty}</span><span class="empty-why">${c.emptyWhy}</span></div>`}
    ${ro ? '' : `
    <div style="margin-top:18px;padding-top:16px;border-top:1px solid ${HAIR12}">
      <div style="${MICRO}">${c.add}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:8px">
        ${fText('awRevName', c.name, '')}
        ${fText('awRevEmail', c.email, '')}
      </div>
      <div style="${MICRO};margin-top:12px">${c.cats}</div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:6px">${catOpts}</div>
      <span data-act="awAddReviewer" style="display:inline-block;margin-top:14px;padding:9px 14px;background:#9b1b22;color:#fff;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer" data-hover="background:#7e151b">${c.send}</span>
    </div>`}`);
}

function drawerNotify() {
  const c = COPY_AW.notify;
  const n = S.notify || {};
  const cat = catById(n.catId) || {};
  const box = (role, label, on) => `<label style="display:flex;gap:8px;align-items:center;font-size:13px;padding:6px 0"><input type="checkbox" data-role="${role}" ${on ? 'checked' : ''} style="accent-color:#9b1b22;width:15px;height:15px">${esc(label)}</label>`;
  return drawerShell(c.title, `${cat.name || ''} · ${c.sub}`, `
    ${box('awNWin', c.winners, true)}
    ${box('awNShort', c.shortlisted, true)}
    ${box('awNDecl', c.declined, true)}
    ${box('awNNoms', c.nominators, true)}
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
      ${act('awNotifyPreview', cat.id || '', c.preview)}
      <span data-act="awNotifyStage" data-id="${esc(cat.id || '')}" style="padding:9px 14px;background:#9b1b22;color:#fff;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer" data-hover="background:#7e151b">${c.stage}</span>
    </div>
    ${n.drafts ? `<div style="margin-top:16px;border-top:1px solid ${HAIR12};padding-top:12px">
      <div style="${MICRO}">${esc(n.drafts.length + ' LETTER' + (n.drafts.length === 1 ? '' : 'S'))}</div>
      ${n.drafts.map(d => `<div style="display:flex;gap:10px;padding:6px 0;border-bottom:1px solid ${HAIR07};font-size:12.5px"><span style="${MICRO};min-width:130px">${esc(d.kind.replace(/_/g, ' ').toUpperCase())}</span><span>${esc(d.to)}</span><span style="color:#6d6459;min-width:0">${esc(d.subject)}</span></div>`).join('')}
    </div>` : ''}
    <div style="font-size:11.5px;color:#6d6459;margin-top:14px">${c.note}</div>`);
}

function drawerLaureate() {
  const c = COPY_AW.laureate;
  const cat = catById(S.drawerCat) || {};
  return drawerShell(c.title, `${cat.name || ''} · ${c.sub}`, `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      ${fText('awLName', c.name, '')}
      ${fText('awLInst', c.inst, '')}
      ${fText('awLEmail', c.email, '')}
      ${fText('awLPhoto', c.photo, '')}
      ${fArea('awLCite', c.cite, cat.citation || '', 3)}
    </div>
    <span data-act="awSaveLaureate" data-id="${esc(cat.id || '')}" style="display:inline-block;margin-top:14px;padding:9px 14px;background:#9b1b22;color:#fff;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer" data-hover="background:#7e151b">${c.save}</span>`);
}

function drawerSettings() {
  const c = COPY_AW.settings;
  const cat = catById(S.drawerCat);
  if (!cat) return '';
  return drawerShell(c.title, cat.name, `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      ${fText('awSName', c.name, cat.name)}
      ${fText('awSNameHr', c.nameHr, cat.name_hr)}
      ${fText('awSCite', c.cite, cat.citation)}
      ${fText('awSCiteHr', c.citeHr, cat.citation_hr)}
      ${fText('awSOpens', c.opens, cat.opens_at, '2026-10-01T09:00')}
      ${fText('awSCloses', c.closes, cat.closes_at, '2026-11-01T23:59')}
      ${fText('awSMax', c.max, cat.laureates_max)}
      <label style="display:flex;gap:8px;align-items:center;font-size:12.5px;margin-top:22px"><input type="checkbox" data-role="awSSelf" ${cat.allow_self ? 'checked' : ''} style="accent-color:#9b1b22;width:15px;height:15px">${esc(c.self)}</label>
      ${fArea('awSCrit', c.crit, cat.criteria_md, 6)}
      ${fArea('awSCritHr', c.critHr, cat.criteria_md_hr, 6)}
    </div>
    <span data-act="awSaveSettings" data-id="${esc(cat.id)}" style="display:inline-block;margin-top:14px;padding:9px 14px;background:#9b1b22;color:#fff;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer" data-hover="background:#7e151b">${c.save}</span>`);
}

function blockAwDrawer() {
  if (!S.drawer) return '<div data-block="awDrawer"></div>';
  if (S.drawer === 'entry') return drawerEntry();
  if (S.drawer === 'rank') return drawerRank();
  if (S.drawer === 'reviewers') return drawerReviewers();
  if (S.drawer === 'notify') return drawerNotify();
  if (S.drawer === 'laureate') return drawerLaureate();
  if (S.drawer === 'settings') return drawerSettings();
  return '<div data-block="awDrawer"></div>';
}

function blockAwBody() {
  return `<div data-block="awBody">${S.cat ? blockAwPanel() : blockAwCats()}</div>`;
}

/** The whole AWARDS tab. js/views/plexus.js calls exactly this. */
export function blockAwards(error) {
  if (!canAwards()) {
    return `
    <div data-block="awTable" style="border:1px solid ${HAIR};background:#fff;margin-top:22px">
      <div style="padding:14px 20px;border-bottom:1px solid ${HAIR12}"><span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${COPY_AW.cats.title}</span></div>
      <div style="padding:10px 0">${ui.lockedBlock(perms.label(AW_SECTION))}</div>
    </div>`;
  }
  if (error) {
    return `
    <div data-block="awTable" style="border:1px solid ${HAIR};background:#fff;margin-top:22px">
      <div style="padding:14px 20px;border-bottom:1px solid ${HAIR12}"><span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${COPY_AW.cats.title}</span></div>
      <div style="padding:10px 0">${error.isLocked ? ui.lockedBlock(perms.label(error.section)) : `<div style="padding:16px 20px;font-size:12.5px;color:#9b1b22">${esc(error.message || COPY_AW.err)}</div>`}</div>
    </div>`;
  }
  return `${blockAwStats()}${blockAwBody()}${blockAwDrawer()}`;
}

// ================================================================ HANDLERS
const val = (role) => { const el = H && H.rootEl && H.rootEl() && H.rootEl().querySelector(`[data-role="${role}"]`); return el ? String(el.value || '').trim() : ''; };
const raw = (role) => { const el = H && H.rootEl && H.rootEl() && H.rootEl().querySelector(`[data-role="${role}"]`); return el ? String(el.value || '') : ''; };
const checked = (role) => { const el = H && H.rootEl && H.rootEl() && H.rootEl().querySelector(`[data-role="${role}"]`); return !!(el && el.checked); };
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; }
  catch (e) {
    try { const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); return true; }
    catch (e2) { return false; }
  }
}
function scrollDrawer() { const el = H && H.rootEl && H.rootEl() && H.rootEl().querySelector('#awDrawer'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }

/** Read-only-safe actions: everything that only LOOKS. plexus.js merges this into its RO set. */
export const AW_RO_SAFE = ['awOpen', 'awClose', 'awRank', 'awEntry', 'awCsv', 'awRoster', 'awOnePager',
  'awFilter', 'awDrawerClose', 'awCopy', 'awPdf', 'awReviewers', 'awNotifyPreview'];

export const awardsHandlers = {
  awOpen: async (el) => { S.cat = el.dataset.id; S.filter = ''; S.term = ''; S.drawer = null; paintAll(); await reloadCategory(S.cat); },
  awClose: () => { S.cat = null; S.data = null; S.drawer = null; paintAll(); },
  awFilter: (el) => { S.filter = el.dataset.id || ''; paintPanel(); },

  awEntry: async (el) => {
    S.drawer = 'entry'; S.entry = null; paintDrawer(); scrollDrawer();
    try { S.entry = await api.get(opsUrl('/entries/' + encodeURIComponent(el.dataset.id))); }
    catch (e) { ui.toast(e.message, { kind: 'error' }); S.drawer = null; }
    paintDrawer();
  },

  awStatus: async (el) => {
    const status = el.dataset.status;
    try {
      const r = await api.post(opsUrl('/entries/' + encodeURIComponent(el.dataset.id) + '/status'), { status });
      ui.toast(COPY_AW.drawer.statusDone(COPY_AW.status[status] || status.toUpperCase()));
      if (r && r.gala_seat && r.gala_seat.created) ui.toast('GALA SEAT CREATED — COMP, ON THE GUEST LIST');
      await reloadOverview();
      if (S.cat) await reloadCategory(S.cat);
      if (S.drawer === 'entry' && S.entry) { S.entry = await api.get(opsUrl('/entries/' + encodeURIComponent(el.dataset.id))); }
      if (S.drawer === 'rank' && S.rank) { S.rank = await api.get(opsUrl('/categories/' + encodeURIComponent(S.rank.category.id) + '/ranking')); }
      paintAll();
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },

  awSaveNote: async (el) => {
    try {
      await api.post(opsUrl('/entries/' + encodeURIComponent(el.dataset.id) + '/notes'), { notes: raw('awNote') });
      ui.toast(COPY_AW.drawer.saved);
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },

  // window.open cannot carry the Bearer header, so it answered 401 and opened a blank tab of JSON
  // error. Ask the route for the signed link instead (?json=1) and hand THAT to the browser.
  awPdf: async (el) => {
    try {
      const r = await api.get(opsUrl('/entries/' + encodeURIComponent(el.dataset.id) + '/attachment') + '?json=1');
      if (!r || !r.url) throw new Error(COPY_AW.drawer.pdfMissing);
      dlHref(r.url, r.name || 'entry.pdf');
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },

  awMerge: async (el) => {
    const key = el.dataset.id;
    if (!S.mergeFrom) { S.mergeFrom = key; ui.toast(COPY_AW.drawer.mergePick); return; }
    if (S.mergeFrom === key) { S.mergeFrom = null; return; }
    const from = (S.data.candidates || []).find(c => c.key === S.mergeFrom);
    const into = (S.data.candidates || []).find(c => c.key === key);
    const ok = await ui.confirm({ title: COPY_AW.drawer.mergeAsk((from && from.name) || S.mergeFrom, (into && into.name) || key), ok: COPY_AW.drawer.mergeOk, cancel: COPY_AW.drawer.mergeKeep });
    if (!ok) { S.mergeFrom = null; return; }
    try {
      await api.post(opsUrl('/categories/' + encodeURIComponent(S.cat) + '/merge'), { from: S.mergeFrom, into: key });
      S.mergeFrom = null;
      await reloadOverview(); await reloadCategory(S.cat); paintAll();
    } catch (e) { S.mergeFrom = null; ui.toast(e.message, { kind: 'error' }); }
  },

  awRank: async (el) => {
    S.drawer = 'rank'; S.rank = null; paintDrawer(); scrollDrawer();
    try { S.rank = await api.get(opsUrl('/categories/' + encodeURIComponent(el.dataset.id) + '/ranking')); }
    catch (e) { ui.toast(e.message, { kind: 'error' }); S.drawer = null; }
    paintDrawer();
  },

  awSettings: (el) => { S.drawer = 'settings'; S.drawerCat = el.dataset.id; paintDrawer(); scrollDrawer(); },
  awSaveSettings: async (el) => {
    const max = parseInt(val('awSMax'), 10);
    try {
      await api.put(opsUrl('/categories/' + encodeURIComponent(el.dataset.id)), {
        name: val('awSName'), name_hr: val('awSNameHr'),
        citation: val('awSCite'), citation_hr: val('awSCiteHr'),
        opens_at: val('awSOpens'), closes_at: val('awSCloses'),
        laureates_max: Number.isFinite(max) ? max : 2,
        allow_self: checked('awSSelf'),
        criteria_md: raw('awSCrit'), criteria_md_hr: raw('awSCritHr')
      });
      ui.toast(COPY_AW.settings.saved);
      await reloadOverview(); paintAll();
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },

  awLaureate: (el) => { S.drawer = 'laureate'; S.drawerCat = el.dataset.id; paintDrawer(); scrollDrawer(); },
  awSaveLaureate: async (el) => {
    const name = val('awLName');
    if (!name) { ui.toast(COPY_AW.laureate.nameFirst); return; }
    try {
      await api.post(opsUrl('/categories/' + encodeURIComponent(el.dataset.id) + '/laureates'), {
        name, institution: val('awLInst'), email: val('awLEmail'), photo_url: val('awLPhoto'), citation: raw('awLCite')
      });
      ui.toast(COPY_AW.laureate.added);
      S.drawer = null;
      await reloadOverview();
      if (S.cat) await reloadCategory(S.cat);
      paintAll();
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  awDelLaureate: async (el) => {
    const ok = await ui.confirm({ title: COPY_AW.laureate.removeAsk(el.dataset.name || 'this laureate'), ok: COPY_AW.laureate.removeOk, cancel: COPY_AW.laureate.removeKeep });
    if (!ok) return;
    try {
      await api.del(opsUrl('/laureates/' + encodeURIComponent(el.dataset.id)));
      ui.toast(COPY_AW.laureate.removed);
      await reloadOverview();
      if (S.cat) await reloadCategory(S.cat);
      paintAll();
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },

  awNotify: (el) => { S.drawer = 'notify'; S.notify = { catId: el.dataset.id, drafts: null }; paintDrawer(); scrollDrawer(); },
  awNotifyPreview: async (el) => { await stageNotify(el.dataset.id, true); },
  awNotifyStage: async (el) => { await stageNotify(el.dataset.id, false); },

  awReviewers: () => { S.drawer = 'reviewers'; paintDrawer(); scrollDrawer(); },
  awAddReviewer: async () => {
    const name = val('awRevName'), email = val('awRevEmail');
    if (!name || !email) { ui.toast(COPY_AW.reviewers.nameFirst); return; }
    const root = H.rootEl();
    const picked = [...root.querySelectorAll('[data-role="awRevCat"]')].filter(x => x.checked).map(x => x.value);
    if (!picked.length) { ui.toast(COPY_AW.reviewers.catFirst); return; }
    try {
      const r = await api.post(opsUrl('/reviewers') + edQ(), { name, email, categories: picked });
      ui.toast(r && r.invited ? COPY_AW.reviewers.sent : 'READER ADDED');
      await reloadOverview(); paintAll();
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  awResend: async (el) => {
    try { const r = await api.post(opsUrl('/reviewers/' + encodeURIComponent(el.dataset.id) + '/resend'), {}); ui.toast(r && r.sent ? COPY_AW.reviewers.sent : 'COULD NOT SEND — COPY THE LINK INSTEAD'); }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  awRevoke: async (el) => {
    const ok = await ui.confirm({ title: COPY_AW.reviewers.revokeAsk(el.dataset.name || 'this reader'), ok: COPY_AW.reviewers.revokeOk, cancel: COPY_AW.reviewers.revokeKeep });
    if (!ok) return;
    try { await api.del(opsUrl('/reviewers/' + encodeURIComponent(el.dataset.id))); await reloadOverview(); paintAll(); }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },

  awCopy: async (el) => { ui.toast(await copyText(el.dataset.id) ? COPY_AW.reviewers.copied : el.dataset.id); },
  awDrawerClose: () => { S.drawer = null; S.entry = null; S.rank = null; paintDrawer(); },

  awCsv: async (el) => {
    try { dl(await fetchBlob(opsUrl('/categories/' + encodeURIComponent(el.dataset.id) + '/entries.csv')), 'medx-awards-entries.csv'); }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  awRoster: async () => {
    try { dl(await fetchBlob(opsUrl('/roster.csv') + edQ()), 'medx-awards-gala-roster.csv'); }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  // Same 401 as awPdf: window.open sends no Authorization header, so the MC's sheet opened as a
  // blank tab. Fetch it WITH the header and save the page — it prints from disk with the same
  // PRINT button, and the file is what the MC actually wants to carry.
  awOnePager: async () => {
    try { dl(await fetchBlob(opsUrl('/one-pager') + edQ()), 'medx-awards-running-order.html'); }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
  }
};

async function stageNotify(catId, preview) {
  const body = {
    preview: !!preview,
    winners: checked('awNWin'), shortlisted: checked('awNShort'),
    declined: checked('awNDecl'), nominators: checked('awNNoms')
  };
  try {
    const r = await api.post(opsUrl('/categories/' + encodeURIComponent(catId) + '/notify'), body);
    S.notify = { catId, drafts: r.drafts || [] };
    if (!preview) {
      ui.toast(r.staged ? COPY_AW.notify.staged(r.staged) : COPY_AW.notify.none);
      await reloadOverview();
      if (S.cat) await reloadCategory(S.cat);
    }
    paintDrawer();
  } catch (e) { ui.toast(e.message, { kind: 'error' }); }
}

// The search box repaints only its own block, so typing never loses focus mid-word.
export function awardsOnInput(e) {
  const t = e.target;
  if (!t || !t.matches || !t.matches('[data-role="awSearch"]')) return false;
  S.term = t.value;
  const rows = H.rootEl().querySelector('[data-block="awPanel"]');
  if (rows) {
    const pos = t.selectionStart;
    H.paintPart('[data-block="awPanel"]', blockAwPanel());
    const again = H.rootEl().querySelector('[data-role="awSearch"]');
    if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch (err) {} }
  }
  return true;
}

export default { initAwards, setAwardsData, loadAwards, blockAwards, awardsHandlers, awardsOnInput, AW_SECTION, AW_RO_SAFE, COPY_AW, canAwards };
