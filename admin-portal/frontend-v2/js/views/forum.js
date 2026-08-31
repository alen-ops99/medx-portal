// Source: Admin Forum Hub.dc.html
// Blocks (artboard order): "Projects sub-nav" › "Title row" › "Overview band" (MEMBERS · CANDIDATES ·
// WHERE THE NETWORK IS · gathering/codes strip) › "FORUM FEED" (composer + LIVE IN THE FEED) ›
// "RECRUITMENT PIPELINE" + "MEMBERS" (left) › "INVITATION CODES" + "REQUEST-CONSIDERATION FORM" +
// "THE GATHERING · MAY 2027" (right). The header is js/chrome.js; toasts are ui.toast.
// Data: /api/v2/forum/hub (admin v2 — shared v2_forum_* tables with the member portal; carries
// `nominations`: members' put-a-colleague-forward rows, rendered INSIDE the recruitment pipeline
// as NOMINATED stage rows with SHORTLIST / DECLINE + the statement expandable) +
// /api/admin/forum/candidates (legacy pipeline) + /api/admin/forum/events/:id (gathering edit).
// SEND CODE queues the personal invitation in the approval Outbox — nothing emails without the OK there.
// SHORTLIST on a nomination writes the same forum_candidates row ADD does, and emails the nominating member.
import cfg from '../config.js';
import { api } from '../api.js';
import { ui, esc, fmt } from '../ui.js';
import { FACTS } from '../facts.js';

export const SOURCE = 'Admin Forum Hub.dc.html';

export const COPY = {
  title: 'Biomedical Forum',
  eyebrow: 'BY INVITATION ONLY',
  sub: gather => `The senior leaders network — gathers once a year · next gathering ${gather}`,
  manage: 'WHAT MEMBERS SEE — MANAGE ↗',
  band: {
    members: 'MEMBERS', membersSub: (n, cap) => `${cap - n} of ${cap} seats open`, atCap: cap => `at the ${cap}-member cap`,
    cands: 'CANDIDATES', candsSub: 'in the pipeline below',
    map: 'WHERE THE NETWORK IS', mapHint: 'counts update as members join',
    mapFoot: 'Live counts per country — this grows into an interactive world map as the network fills.',
    mapEmpty: 'No members on the map yet.', mapEmptyWhy: 'The first admission draws the first bar.',
    gathering: (label, days) => `next gathering · ${days} day${days === 1 ? '' : 's'}`,
    codes: 'invitation codes out', calendar: 'CALENDAR →'
  },
  feed: {
    title: 'FORUM FEED', sub: 'what members see in the portal — a spotlight or a note goes live the moment you publish',
    open: 'OPEN THE MEMBER FEED ↗',
    chips: { spotlight: '★ MEMBER SPOTLIGHT', news: 'FORUM NEWS', note: 'NOTE' },
    phName: 'Member name — e.g. Dr. Iva Šarić', phRole: 'Their institution / role', phTitle: 'Headline', phBody: 'Write the highlight…',
    publish: 'PUBLISH TO FEED →', publishNote: 'Members see it instantly · unpublishing hides it, never deletes it.',
    live: 'LIVE IN THE FEED', posts: n => `${n} post${n === 1 ? '' : 's'} live`,
    needSpot: 'NAME AND TEXT ARE BOTH NEEDED', needNews: 'HEADLINE AND TEXT ARE BOTH NEEDED',
    published: 'PUBLISHED — LIVE ON THE MEMBER FORUM PAGE',
    unpub: 'UNPUBLISH', sure: 'SURE? UNPUBLISH', repub: 'REPUBLISH',
    unpublished: 'UNPUBLISHED — HIDDEN FROM MEMBERS, NEVER DELETED', republished: 'REPUBLISHED — BACK ON THE MEMBER PAGE',
    hiddenTag: 'HIDDEN', empty: 'Nothing in the feed yet.', emptyWhy: 'The first spotlight you publish lands on the member Forum page instantly.'
  },
  pipeline: {
    title: 'RECRUITMENT PIPELINE', sub: 'from shortlist to member, one row each',
    waiting: n => `${n} form request${n === 1 ? '' : 's'} waiting`,
    sendCode: 'SEND CODE', addPh: 'Add a candidate — e.g. Prof. Ivica Grković, igrkovic@mefst.hr', add: 'ADD',
    foot: 'SEND CODE mints a personal invitation code and queues the email in the Outbox — one OK there sends it from president@medx.hr, no copy-pasting into Gmail.',
    roleFallback: 'Add details on their profile', typeFirst: 'TYPE A NAME AND EMAIL FIRST',
    queued: 'CODE QUEUED — APPROVE IT IN THE OUTBOX', added: 'CANDIDATE ADDED TO THE PIPELINE',
    needEmail: 'ADD AN EMAIL FOR THIS CANDIDATE FIRST — EDIT THE ROW IN PEOPLE',
    showAll: n => `SHOW ALL ${n} →`, showFewer: 'SHOW FEWER', empty: 'The pipeline is clear.', emptyWhy: 'Add a candidate below or wait for the public form — requests land here.',
    nomWaiting: n => `${n} member nomination${n === 1 ? '' : 's'} waiting`,
    nomBy: who => `put forward by ${who}`,
    nomStage: 'NOMINATED',
    nomRead: 'THE STATEMENT ▾', nomHide: 'THE STATEMENT ▴',
    nomStatementTag: who => `THEIR STANDING AND CHARACTER — IN ${who ? who.toUpperCase() + '\'S' : 'THE MEMBER\'S'} WORDS`,
    nomShortlist: 'SHORTLIST', nomDecline: 'DECLINE', nomSureDecline: 'SURE? DECLINE',
    nomShortlisted: 'MOVED TO SHORTLIST — THE NOMINATING MEMBER HAS BEEN EMAILED',
    nomDeclined: 'NOMINATION DECLINED — THE ROW STAYS FOR THE AUDIT TRAIL'
  },
  members: {
    title: 'MEMBERS', sub: (n, cap) => `the approved network · ${n} of ${cap}`,
    profile: 'PROFILE →', until: d => `runs until ${d}`, noExpiry: 'no expiry set — annual from admission',
    lapsed: 'LAPSED', renew: 'RENEW +1 YEAR', renewed: 'MEMBERSHIP RENEWED FOR A YEAR',
    empty: 'The network is empty.', emptyWhy: 'Send the first invitation code — the member appears here the moment they redeem it.',
    showAll: n => `SHOW ALL ${n} →`, showFewer: 'SHOW FEWER'
  },
  codes: {
    title: 'INVITATION CODES',
    explain: 'A code is a personal key — the invitee enters it on the member portal and joins the Forum. One code, one person, expires in 30 days.',
    copy: 'COPY', copied: '✓ COPIED', send: 'QUEUE EMAIL', resend: 'RE-QUEUE', revoke: '✕',
    unassigned: 'reserved — not yet assigned',
    queuedFor: (who, d) => `${who} · queued in the Outbox${d ? ' · expires ' + d : ''}`,
    assignedTo: (who, d) => `${who}${d ? ' · expires ' + d : ''}`,
    usedBy: (who, d) => `${who} · joined${d ? ' ' + d : ''}`,
    expired: who => `${who} · expired`,
    mint: 'GENERATE A NEW CODE', minted: 'NEW CODE MINTED — EXPIRES IN 30 DAYS',
    codeCopied: c => `CODE ${c} COPIED`,
    revokeTitle: 'Revoke this code?', revokeBody: 'The invitee will no longer be able to join with it. The row stays for the audit trail.',
    revokeOk: 'REVOKE', revokeKeep: 'KEEP', revoked: 'CODE REVOKED',
    outbox: 'OUTBOX →'
  },
  form: {
    title: 'REQUEST-CONSIDERATION FORM', customise: '✎ CUSTOMISE', customiseTitle: 'Add, remove or reorder the questions candidates answer',
    explain: 'The public "Request consideration" form on medx.hr — submissions land in the pipeline above as candidates.',
    remove: 'REMOVE', addPh: 'New question — e.g. LinkedIn profile', add: 'ADD',
    copyLink: 'COPY PUBLIC LINK', linkCopied: '✓ LINK COPIED', url: 'medx.hr/forum/request-consideration', fullUrl: 'https://medx.hr/forum/request-consideration',
    qAdded: 'QUESTION ADDED — LIVE ON THE PUBLIC FORM', qRemoved: 'QUESTION REMOVED', typeFirst: 'TYPE THE QUESTION FIRST', lastQ: 'THE FORM NEEDS AT LEAST ONE QUESTION',
    linkToast: 'PUBLIC LINK COPIED'
  },
  gathering: {
    title: y => `THE GATHERING · ${y}`,
    body: 'Venue scouting in progress — members vote between Split and Zagreb. Program, invitations and reminders will run from this hub with the same tools as Plexus.',
    calendar: 'SEE IT ON THE CALENDAR →', edit: '✎ EDIT', close: 'CLOSE',
    facts: (label, where, regs, cap) => `${label} · ${where} · ${regs} registered${cap ? ' of ' + cap : ''}`,
    vote: 'SPLIT / ZAGREB — THE MEMBERS\' VOTE', votes: n => `${n} vote${n === 1 ? '' : 's'} in`, noVotes: 'No votes yet — members vote on their Forum page.',
    save: 'SAVE', saved: 'GATHERING SAVED — LIVE FOR MEMBERS', lWhere: 'WHERE', lStart: 'START', lEnd: 'END', lCap: 'CAPACITY'
  }
};

const TOP_ROWS = 8;
let D = null, st = null, unbind = null, rootEl = null;

function ensureCss() {
  if (!document.querySelector('link[href="/css/views/forum-hub.css"]')) {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/css/views/forum-hub.css'; document.head.appendChild(l);
  }
}
function rel(ts) {
  const t = new Date(String(ts || '').replace(' ', 'T')).getTime();
  if (!t) return '';
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 2) return 'just now';
  if (m < 60) return m + ' min ago';
  const h = Math.round(m / 60);
  if (h < 24) return h + ' h ago';
  const d = Math.round(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 21) return d + ' days ago';
  return fmt.dayShort(new Date(t));
}
const chip = on => on ? { bg: '#201b16', fg: '#fff', bd: '#201b16' } : { bg: '#f6f2ea', fg: '#6d6459', bd: 'rgba(32,27,22,.25)' };
const STAGE_STYLE = {
  NOMINATED: { bg: '#201b16', fg: '#c9a962' }, // member-nominated — the ink chip marks the fresh arrivals
  SHORTLIST: { bg: '#eee9df', fg: '#4a4239' }, CONTACTED: { bg: '#f8f1e2', fg: '#7a6432' }, REPLIED: { bg: '#f8f1e2', fg: '#7a6432' },
  'CODE SENT': { bg: '#e4efe7', fg: '#22563a' }, ACCEPTED: { bg: '#e4efe7', fg: '#22563a' }, JOINED: { bg: '#e4efe7', fg: '#22563a' },
  ESCALATED: { bg: '#f7e3e4', fg: '#9b1b22' }, DECLINED: { bg: '#eee9df', fg: '#9a9086' }
};
function candStage(c) {
  const inv = (D.hub.invites || []).find(i => i.email && c.email && i.email.toLowerCase() === String(c.email).toLowerCase());
  if (inv) return inv.status === 'used' ? 'JOINED' : 'CODE SENT';
  const map = { imported: 'SHORTLIST', verifying: 'SHORTLIST', verified: 'SHORTLIST', queued: 'SHORTLIST', invited: 'CONTACTED', followed_up: 'CONTACTED', replied: 'REPLIED', accepted: 'ACCEPTED', declined: 'DECLINED', rejected: 'DECLINED', escalated: 'ESCALATED' };
  return map[String(c.status || '').toLowerCase()] || 'SHORTLIST';
}
function gatherLabel() {
  const g = D.hub.gathering;
  if (g && g.start_date) return `${fmt.rangeLabel(g.start_date, g.end_date)}, ${String(g.start_date).slice(0, 4)}`;
  return FACTS.forum.gathering.label.toUpperCase();
}

// ---------------------------------------------------------------- data
async function load() {
  const r = await api.settle({
    hub: api.get('/api/v2/forum/hub'),
    cands: api.get('/api/admin/forum/candidates?status=all'),
    questions: api.get('/api/v2/forum/consideration-questions')
  });
  return {
    errors: r.$errors,
    hub: r.hub || { cap: FACTS.forum.cap, members: [], expired_members: [], countries: [], invites: [], codes_out: 0, vote: { counts: { split: 0, zagreb: 0 }, total: 0 }, feed: [], gathering: null, considerations_pending: 0, members_count: 0, nominations: [] },
    cands: (r.cands && Array.isArray(r.cands.candidates)) ? r.cands.candidates : [],
    questions: (r.questions && r.questions.questions) || []
  };
}

// ---------------------------------------------------------------- blocks
function blockSubnav() {
  return `
  <!-- dc: Admin Forum Hub.dc.html › "Projects sub-nav" -->
  <div style="background:#fff;border-bottom:1px solid rgba(32,27,22,.14)">
    <div class="mx-subnav mx-gutter" style="max-width:1180px;margin:0 auto;padding:0 28px;height:44px;display:flex;align-items:center;gap:20px">
      <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#6d6459">PROJECTS</span>
      <a href="/projects/plexus" style="font:600 11px Inter,sans-serif;letter-spacing:.13em;color:#6d6459;height:100%;display:flex;align-items:center" data-hover="color:#201b16">PLEXUS WEEK 2026</a>
      <a href="/projects/accelerator" style="font:600 11px Inter,sans-serif;letter-spacing:.13em;color:#6d6459;height:100%;display:flex;align-items:center" data-hover="color:#201b16">ACCELERATOR</a>
      <span style="font:600 11px Inter,sans-serif;letter-spacing:.13em;color:#201b16;border-bottom:2px solid #9b1b22;height:100%;display:flex;align-items:center;box-sizing:border-box">BIOMEDICAL FORUM</span>
      <a href="/projects/bridges" style="font:600 11px Inter,sans-serif;letter-spacing:.13em;color:#6d6459;height:100%;display:flex;align-items:center" data-hover="color:#201b16">BUILDING BRIDGES</a>
    </div>
  </div>
  <!-- /dc -->`;
}
function blockTitle() {
  return `
    <!-- dc: Admin Forum Hub.dc.html › "Title row" -->
    <div style="display:flex;align-items:flex-end;gap:16px;flex-wrap:wrap">
      <div>
        <div style="display:flex;align-items:center;gap:10px">
          <span class="mx-display-30" style="font-family:Fraunces,serif;font-size:30px">Biomedical <i>Forum</i></span>
          <span style="font:600 9px Inter,sans-serif;letter-spacing:.15em;background:#eee9df;color:#4a4239;padding:4px 8px">${COPY.eyebrow}</span>
        </div>
        <div style="font-size:12.5px;color:#6d6459;margin-top:4px">${esc(COPY.sub(fmt.longRange(D.hub.gathering && D.hub.gathering.start_date || FACTS.forum.gathering.start, D.hub.gathering && D.hub.gathering.end_date || FACTS.forum.gathering.end)))}</div>
      </div>
      <div style="flex:1"></div>
      <a href="/member-pages/forum" style="padding:10px 16px;border:2px solid #9b1b22;background:#fff;color:#9b1b22;font:600 10px Inter,sans-serif;letter-spacing:.14em;white-space:nowrap" data-hover="background:#9b1b22;color:#fff">${COPY.manage}</a>
    </div>
    <!-- /dc -->`;
}
function blockBand() {
  const h = D.hub, b = COPY.band;
  const countries = (h.countries || []).slice(0, 6);
  const max = Math.max(1, ...countries.map(c => c.count));
  const gDays = Math.max(0, fmt.daysUntil((h.gathering && h.gathering.start_date) || FACTS.forum.gathering.start) || 0);
  const atCap = h.members_count >= h.cap;
  return `
    <!-- dc: Admin Forum Hub.dc.html › "Overview band" -->
    <div data-block="band" style="border:1px solid rgba(32,27,22,.14);background:#fff">
      <div class="fh-band" style="display:grid;grid-template-columns:.75fr .75fr 1.7fr">
        <a href="#forum-members" style="padding:16px 20px;border-right:1px solid rgba(32,27,22,.1);display:block;color:#201b16" data-hover="background:#fdfbf6;color:#201b16">
          <div style="font:600 9px Inter,sans-serif;letter-spacing:.15em;color:#6d6459">${b.members}</div>
          <div style="font-family:Fraunces,serif;font-size:30px;margin-top:3px">${h.members_count}</div>
          <div style="font-size:11px;color:${atCap ? '#9b1b22' : '#6d6459'}">${esc(atCap ? b.atCap(h.cap) : b.membersSub(h.members_count, h.cap))}</div>
        </a>
        <a href="#forum-pipeline" style="padding:16px 20px;border-right:1px solid rgba(32,27,22,.1);display:block;color:#201b16" data-hover="background:#fdfbf6;color:#201b16">
          <div style="font:600 9px Inter,sans-serif;letter-spacing:.15em;color:#6d6459">${b.cands}</div>
          <div style="font-family:Fraunces,serif;font-size:30px;margin-top:3px">${D.cands.length}</div>
          <div style="font-size:11px;color:#6d6459">${b.candsSub}</div>
        </a>
        <div style="padding:16px 20px">
          <div style="display:flex;align-items:baseline;gap:10px"><span style="font:600 9px Inter,sans-serif;letter-spacing:.15em;color:#6d6459">${b.map}</span><span style="font-size:11px;color:#9a9086">${b.mapHint}</span></div>
          ${countries.length ? `<div style="display:flex;flex-direction:column;gap:6px;margin-top:9px">
            ${countries.map((c, i) => `<div style="display:flex;align-items:center;gap:10px"><span style="width:98px;flex:none;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.country)}</span><span style="flex:1;height:9px;background:rgba(32,27,22,.06)"><span style="display:block;width:${Math.max(6, Math.round(c.count / max * 100))}%;height:100%;background:${i % 2 ? '#c9a962' : '#9b1b22'}"></span></span><span style="font:600 11px Inter,sans-serif;width:16px;text-align:right">${c.count}</span></div>`).join('')}
          </div>
          <div style="font-size:11px;color:#6d6459;margin-top:8px">${b.mapFoot}</div>`
          : `<div class="empty" style="padding:10px 0 2px"><span class="empty-line" style="font-family:Fraunces,serif;font-style:italic;font-size:14px">${b.mapEmpty}</span><span class="empty-why" style="font-size:11px;color:#6d6459">${b.mapEmptyWhy}</span></div>`}
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px 22px;border-top:1px solid rgba(32,27,22,.1);padding:11px 20px;flex-wrap:wrap">
        <span style="display:flex;align-items:center;gap:7px;font-size:12px;white-space:nowrap"><span style="width:7px;height:7px;background:#c9a962;flex:none"></span><b>${esc(gatherLabel())}</b>&nbsp;${esc(b.gathering(gatherLabel(), gDays))}</span>
        <a href="#forum-codes" style="display:flex;align-items:center;gap:7px;font-size:12px;white-space:nowrap;color:#201b16" data-hover="color:#9b1b22"><span style="width:7px;height:7px;background:#9b1b22;flex:none"></span><b>${h.codes_out}</b>&nbsp;${b.codes}</a>
        <div style="flex:1"></div>
        <a href="/calendar" style="font:600 9px Inter,sans-serif;letter-spacing:.14em;white-space:nowrap">${b.calendar}</a>
      </div>
    </div>
    <!-- /dc -->`;
}
function blockFeed() {
  const c = COPY.feed;
  const feed = D.hub.feed || [];
  const liveCount = feed.filter(p => p.published).length;
  const chips = { spotlight: chip(st.kind === 'spotlight'), news: chip(st.kind === 'news'), note: chip(st.kind === 'note') };
  return `
    <!-- dc: Admin Forum Hub.dc.html › "FORUM FEED" -->
    <div data-block="feed" style="border:1px solid rgba(32,27,22,.14);background:#fff">
      <div style="display:flex;align-items:center;gap:10px;padding:14px 20px;border-bottom:1px solid rgba(32,27,22,.12);flex-wrap:wrap">
        <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${c.title}</span>
        <span style="font-size:11.5px;color:#6d6459">${c.sub}</span>
        <div style="flex:1"></div>
        <a href="${esc((cfg.memberPortalUrl || '') + '/app/forum')}" target="_blank" rel="noopener" style="font:600 9px Inter,sans-serif;letter-spacing:.14em;white-space:nowrap">${c.open}</a>
      </div>
      <div class="fh-feed" style="display:grid;grid-template-columns:1fr 1fr">
        <div style="padding:18px 20px;display:flex;flex-direction:column;gap:12px;border-right:1px solid rgba(32,27,22,.1)">
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <span data-act="setSpot" role="radio" aria-checked="${st.kind === 'spotlight'}" style="padding:7px 12px;font:600 9px Inter,sans-serif;letter-spacing:.1em;cursor:pointer;background:${chips.spotlight.bg};color:${chips.spotlight.fg};border:1px solid ${chips.spotlight.bd}">${c.chips.spotlight}</span>
            <span data-act="setNews" role="radio" aria-checked="${st.kind === 'news'}" style="padding:7px 12px;font:600 9px Inter,sans-serif;letter-spacing:.1em;cursor:pointer;background:${chips.news.bg};color:${chips.news.fg};border:1px solid ${chips.news.bd}">${c.chips.news}</span>
            <span data-act="setNote" role="radio" aria-checked="${st.kind === 'note'}" style="padding:7px 12px;font:600 9px Inter,sans-serif;letter-spacing:.1em;cursor:pointer;background:${chips.note.bg};color:${chips.note.fg};border:1px solid ${chips.note.bd}">${c.chips.note}</span>
          </div>
          ${st.kind === 'spotlight' ? `
          <input data-role="fName" value="${esc(st.fName)}" placeholder="${esc(c.phName)}" aria-label="Member name" style="border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:9px 11px;font:400 13px Inter,sans-serif;color:#201b16">
          <input data-role="fRole" value="${esc(st.fRole)}" placeholder="${esc(c.phRole)}" aria-label="Institution or role" style="border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:9px 11px;font:400 13px Inter,sans-serif;color:#201b16">` : `
          <input data-role="fTitle" value="${esc(st.fTitle)}" placeholder="${esc(c.phTitle)}" aria-label="Headline" style="border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:9px 11px;font:400 13px Inter,sans-serif;color:#201b16">`}
          <textarea data-role="fBody" placeholder="${esc(c.phBody)}" aria-label="Post body" style="border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:10px 11px;font:400 13px Inter,sans-serif;color:#201b16;min-height:72px;resize:vertical;box-sizing:border-box">${esc(st.fBody)}</textarea>
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
            <span data-act="publish" style="padding:10px 18px;background:#9b1b22;color:#fff;font:600 10px Inter,sans-serif;letter-spacing:.14em;cursor:pointer;white-space:nowrap" data-hover="background:#7e151b">${c.publish}</span>
            <span style="font-size:11px;color:#6d6459">${c.publishNote}</span>
          </div>
        </div>
        <div style="padding:18px 20px">
          <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:4px"><span style="font:600 9.5px Inter,sans-serif;letter-spacing:.14em;color:#6d6459">${c.live}</span><span style="font-size:11px;color:#9a9086">${esc(c.posts(liveCount))}</span></div>
          ${feed.slice(0, 8).map(p => `
          <div data-row="${esc(p.id)}" style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(32,27,22,.08);${p.published ? '' : 'opacity:.55'}">
            <span style="width:6px;height:6px;border-radius:50%;background:${p.published ? '#1e6e42' : '#9a9086'};flex:none"></span>
            <span style="flex:1;min-width:0"><span style="display:block;font:600 8px Inter,sans-serif;letter-spacing:.14em;color:#9b1b22">${esc(p.tag || '')}${p.published ? '' : ` · <span style="color:#9a9086">${c.hiddenTag}</span>`}</span><span style="display:block;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.name || p.title || '')}</span></span>
            <span style="font-size:10.5px;color:#9a9086;white-space:nowrap">${esc(rel(p.published_at))}</span>
            ${p.published
              ? `<span data-act="unpub" data-id="${esc(p.id)}" style="font:600 9px Inter,sans-serif;letter-spacing:.06em;color:${st.unpubConfirm === p.id ? '#9b1b22' : '#9a9086'};cursor:pointer;white-space:nowrap" data-hover="color:#9b1b22">${st.unpubConfirm === p.id ? c.sure : c.unpub}</span>`
              : `<span data-act="repub" data-id="${esc(p.id)}" style="font:600 9px Inter,sans-serif;letter-spacing:.06em;color:#1e6e42;cursor:pointer;white-space:nowrap" data-hover="color:#201b16">${c.repub}</span>`}
          </div>`).join('')}
          ${!feed.length ? `<div class="empty" style="padding:18px 0"><span class="empty-line" style="font-family:Fraunces,serif;font-style:italic;font-size:15px">${c.empty}</span><span class="empty-why" style="font-size:11.5px;color:#6d6459">${c.emptyWhy}</span></div>` : ''}
        </div>
      </div>
    </div>
    <!-- /dc -->`;
}
function blockPipeline() {
  const c = COPY.pipeline;
  const rows = st.candsAll ? D.cands : D.cands.slice(0, TOP_ROWS);
  const noms = D.hub.nominations || [];
  const pending = D.hub.considerations_pending || 0;
  // v2: member nominations (v2_forum_nominations, status 'new') open the SAME pipeline list as
  // NOMINATED rows — nominee · "put forward by <member>" · the statement expandable · SHORTLIST/DECLINE.
  const nomRow = nm => {
    const s = STAGE_STYLE.NOMINATED;
    const open = st.nomOpen === nm.id;
    return `
          <div data-row="${esc(nm.id)}" style="border-bottom:1px solid rgba(32,27,22,.07)">
            <div style="display:flex;align-items:center;gap:12px;padding:12px 20px">
              <span style="flex:1;min-width:0"><span style="display:block;font-size:13.5px;font-weight:600">${esc(nm.nominee_name)}</span><span style="display:block;font-size:11px;color:#6d6459;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc([nm.institution, c.nomBy(nm.nominated_by)].filter(Boolean).join(' · '))}</span></span>
              <span data-act="nomStatement" data-id="${esc(nm.id)}" style="font:600 8.5px Inter,sans-serif;letter-spacing:.1em;color:${open ? '#201b16' : '#7a6432'};cursor:pointer;white-space:nowrap" data-hover="color:#201b16">${open ? c.nomHide : c.nomRead}</span>
              <span style="font:600 8.5px Inter,sans-serif;letter-spacing:.1em;padding:3px 8px;background:${s.bg};color:${s.fg};white-space:nowrap">${c.nomStage}</span>
              <span data-act="nomShortlist" data-id="${esc(nm.id)}" style="padding:7px 12px;background:#9b1b22;color:#fff;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap" data-hover="background:#7e151b">${c.nomShortlist}</span>
              <span data-act="nomDecline" data-id="${esc(nm.id)}" style="font:600 9px Inter,sans-serif;letter-spacing:.06em;color:${st.nomDeclineConfirm === nm.id ? '#9b1b22' : '#9a9086'};cursor:pointer;white-space:nowrap" data-hover="color:#9b1b22">${st.nomDeclineConfirm === nm.id ? c.nomSureDecline : c.nomDecline}</span>
            </div>
            ${open ? `<div style="margin:0 20px 12px;border:1px solid rgba(201,169,98,.5);background:#fdfbf6;padding:10px 12px"><span style="display:block;font:600 8px Inter,sans-serif;letter-spacing:.14em;color:#7a6432;margin-bottom:5px">${esc(c.nomStatementTag(nm.nominated_by))}</span><span style="font-size:12.5px;line-height:1.6;color:#4a4239;white-space:pre-wrap">${esc(nm.statement)}</span></div>` : ''}
          </div>`;
  };
  return `
        <!-- dc: Admin Forum Hub.dc.html › "RECRUITMENT PIPELINE" -->
        <div data-block="pipeline" id="forum-pipeline" style="border:1px solid rgba(32,27,22,.14);background:#fff">
          <div style="display:flex;align-items:center;gap:10px;padding:14px 20px;border-bottom:1px solid rgba(32,27,22,.12);flex-wrap:wrap">
            <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${c.title}</span>
            <span style="font-size:11.5px;color:#6d6459">${c.sub}</span>
            <div style="flex:1"></div>
            ${noms.length ? `<span style="font:600 8.5px Inter,sans-serif;letter-spacing:.1em;background:#201b16;color:#c9a962;padding:3px 8px;white-space:nowrap">${esc(c.nomWaiting(noms.length))}</span>` : ''}
            ${pending ? `<span style="font:600 8.5px Inter,sans-serif;letter-spacing:.1em;background:#f8f1e2;color:#7a6432;padding:3px 8px;white-space:nowrap">${esc(c.waiting(pending))}</span>` : ''}
          </div>
          ${noms.map(nomRow).join('')}
          ${rows.map(cd => { const stage = candStage(cd); const s = STAGE_STYLE[stage] || STAGE_STYLE.SHORTLIST; const canInvite = !!cd.email && !['CODE SENT', 'JOINED', 'DECLINED'].includes(stage); return `
          <div data-row="${esc(cd.id)}" style="display:flex;align-items:center;gap:12px;padding:12px 20px;border-bottom:1px solid rgba(32,27,22,.07)">
            <span style="flex:1;min-width:0"><span style="display:block;font-size:13.5px;font-weight:600">${esc(cd.name || cd.email || 'Candidate')}</span><span style="display:block;font-size:11px;color:#6d6459;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc([cd.institution, cd.field].filter(Boolean).join(' · ') || c.roleFallback)}</span></span>
            <span style="font:600 8.5px Inter,sans-serif;letter-spacing:.1em;padding:3px 8px;background:${s.bg};color:${s.fg};white-space:nowrap">${stage}</span>
            ${canInvite ? `<span data-act="sendCode" data-id="${esc(cd.id)}" style="padding:7px 12px;background:#9b1b22;color:#fff;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap" data-hover="background:#7e151b">${c.sendCode}</span>` : ''}
          </div>`; }).join('')}
          ${!D.cands.length && !noms.length ? `<div class="empty" style="padding:22px 20px"><span class="empty-line" style="font-family:Fraunces,serif;font-style:italic;font-size:15px">${c.empty}</span><span class="empty-why" style="font-size:11.5px;color:#6d6459">${c.emptyWhy}</span></div>` : ''}
          ${D.cands.length > TOP_ROWS ? `<div style="padding:10px 20px;border-bottom:1px solid rgba(32,27,22,.07)"><span data-act="candsAll" style="font:600 10px Inter,sans-serif;letter-spacing:.14em;color:#9b1b22;cursor:pointer">${st.candsAll ? c.showFewer : c.showAll(D.cands.length)}</span></div>` : ''}
          <div style="display:flex;gap:10px;padding:14px 20px 6px">
            <input data-role="candDraft" value="${esc(st.candDraft)}" placeholder="${esc(c.addPh)}" aria-label="Add a candidate" style="flex:1;border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:9px 11px;font:400 13px Inter,sans-serif;color:#201b16;min-width:0">
            <span data-act="addCand" style="padding:9px 14px;background:#201b16;color:#f6f2ea;font:600 10px Inter,sans-serif;letter-spacing:.14em;cursor:pointer;display:flex;align-items:center;white-space:nowrap" data-hover="background:#000">${c.add}</span>
          </div>
          <div style="padding:0 20px 14px;font-size:11px;color:#6d6459">${c.foot}</div>
        </div>
        <!-- /dc -->`;
}
function blockMembers() {
  const c = COPY.members;
  const h = D.hub;
  const active = st.membersAll ? h.members : (h.members || []).slice(0, TOP_ROWS);
  const lapsed = h.expired_members || [];
  const row = (m, isLapsed) => `
          <div data-row="${esc(m.id)}" style="display:flex;align-items:center;gap:12px;padding:12px 20px;border-bottom:1px solid rgba(32,27,22,.07);${isLapsed ? 'opacity:.65' : ''}">
            <span style="width:30px;height:30px;background:#191512;color:#c9a962;display:inline-flex;align-items:center;justify-content:center;font:600 11px Fraunces,serif;flex:none">${esc(m.initials)}</span>
            <span style="flex:1;min-width:0"><span style="display:block;font-size:13.5px;font-weight:600">${esc(m.name)}</span><span style="display:block;font-size:11px;color:#6d6459;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc([m.institution, m.specialty || m.position].filter(Boolean).join(' · ') || (m.email || ''))}</span></span>
            ${isLapsed
              ? `<span style="font:600 8.5px Inter,sans-serif;letter-spacing:.1em;background:#f7e3e4;color:#9b1b22;padding:3px 8px;white-space:nowrap">${c.lapsed}</span><span data-act="renew" data-id="${esc(m.id)}" style="font:600 9.5px Inter,sans-serif;letter-spacing:.12em;color:#9b1b22;cursor:pointer;white-space:nowrap" data-hover="color:#201b16">${c.renew}</span>`
              : `<span style="font:600 8px Inter,sans-serif;letter-spacing:.08em;color:#9a9086;white-space:nowrap" data-v2="validity">${esc(m.valid_until ? c.until(fmt.dayShort(m.valid_until) + ' ' + String(m.valid_until).slice(0, 4)) : c.noExpiry)}</span>
            <a href="/people" style="font:600 9.5px Inter,sans-serif;letter-spacing:.12em;color:#9b1b22;white-space:nowrap" data-hover="color:#201b16">${c.profile}</a>`}
          </div>`;
  return `
        <!-- dc: Admin Forum Hub.dc.html › "MEMBERS" -->
        <div data-block="members" id="forum-members" style="border:1px solid rgba(32,27,22,.14);background:#fff">
          <div style="display:flex;align-items:center;gap:10px;padding:14px 20px;border-bottom:1px solid rgba(32,27,22,.12)">
            <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${c.title}</span>
            <span style="font-size:11.5px;color:#6d6459">${esc(c.sub(h.members_count, h.cap))}</span>
          </div>
          ${active.map(m => row(m, false)).join('')}
          ${(h.members || []).length > TOP_ROWS ? `<div style="padding:10px 20px;border-bottom:1px solid rgba(32,27,22,.07)"><span data-act="membersAll" style="font:600 10px Inter,sans-serif;letter-spacing:.14em;color:#9b1b22;cursor:pointer">${st.membersAll ? c.showFewer : c.showAll(h.members.length)}</span></div>` : ''}
          ${lapsed.map(m => row(m, true)).join('')}
          ${!(h.members || []).length && !lapsed.length ? `<div class="empty" style="padding:22px 20px"><span class="empty-line" style="font-family:Fraunces,serif;font-style:italic;font-size:15px">${c.empty}</span><span class="empty-why" style="font-size:11.5px;color:#6d6459">${c.emptyWhy}</span></div>` : ''}
        </div>
        <!-- /dc -->`;
}
function blockCodes() {
  const c = COPY.codes;
  const invites = (D.hub.invites || []).slice(0, 10);
  const line = i => {
    const who = i.name || i.email || '';
    const exp = i.expires_at ? fmt.dayShort(i.expires_at) : '';
    if (i.status === 'used') return c.usedBy(who || 'redeemed', i.used_at ? fmt.dayShort(i.used_at) : '');
    if (i.status === 'expired') return c.expired(who || 'unassigned');
    if (!who) return c.unassigned;
    return i.sent_at ? c.queuedFor(who, exp) : c.assignedTo(who, exp);
  };
  return `
        <!-- dc: Admin Forum Hub.dc.html › "INVITATION CODES" -->
        <div data-block="codes" id="forum-codes" style="border:1px solid rgba(32,27,22,.14);border-top:2px solid #c9a962;background:#fff">
          <div style="padding:13px 20px;border-bottom:1px solid rgba(32,27,22,.1)"><span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${c.title}</span></div>
          <div style="padding:14px 20px 16px;display:flex;flex-direction:column;gap:10px">
          <span style="font-size:12px;color:#6d6459;line-height:1.55">${c.explain}</span>
          ${invites.map(i => `
            <div data-row="${esc(i.id)}" style="border:1px solid rgba(32,27,22,.1);background:#f6f2ea;padding:10px 12px;display:flex;align-items:center;gap:10px;${i.status === 'open' ? '' : 'opacity:.6'}">
              <span style="font:600 12px ui-monospace,monospace;letter-spacing:.08em;flex:none">${esc(i.code)}</span>
              <span style="font-size:11px;color:#6d6459;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(line(i))}</span>
              ${i.status === 'open' && i.sent_at ? `<a href="/inbox/outbox" style="font:600 8.5px Inter,sans-serif;letter-spacing:.1em;color:#7a6432;white-space:nowrap" title="The invitation email waits for approval there">${c.outbox}</a>` : ''}
              <span data-act="copyCode" data-code="${esc(i.code)}" style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:${st.copiedCode === i.code ? '#1e6e42' : '#9b1b22'};cursor:pointer;white-space:nowrap">${st.copiedCode === i.code ? c.copied : c.copy}</span>
              ${i.status === 'open' && i.email ? `<span data-act="queueInvite" data-id="${esc(i.id)}" style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#9b1b22;cursor:pointer;white-space:nowrap" data-hover="color:#201b16">${i.sent_at ? c.resend : c.send}</span>` : ''}
              ${i.status === 'open' ? `<span data-act="revoke" data-id="${esc(i.id)}" title="Revoke this code" style="font:600 11px Inter,sans-serif;color:#9a9086;cursor:pointer" data-hover="color:#9b1b22">${c.revoke}</span>` : ''}
            </div>`).join('')}
          <span data-act="mintCode" style="padding:10px 16px;background:#9b1b22;color:#fff;font:600 10px Inter,sans-serif;letter-spacing:.14em;cursor:pointer;text-align:center" data-hover="background:#7e151b">${c.mint}</span>
          </div>
        </div>
        <!-- /dc -->`;
}
function blockForm() {
  const c = COPY.form;
  return `
        <!-- dc: Admin Forum Hub.dc.html › "REQUEST-CONSIDERATION FORM" -->
        <div data-block="form" style="border:1px solid rgba(32,27,22,.14);background:#fff">
          <div style="display:flex;align-items:center;gap:10px;padding:13px 20px;border-bottom:1px solid rgba(32,27,22,.1)"><span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${c.title}</span><div style="flex:1"></div><span data-act="formToggle" title="${esc(c.customiseTitle)}" style="font:600 8.5px Inter,sans-serif;letter-spacing:.13em;color:${st.formEditing ? '#201b16' : '#6d6459'};cursor:pointer" data-hover="color:#201b16">${c.customise}</span></div>
          <div style="padding:12px 20px 16px;display:flex;flex-direction:column;gap:7px">
            <span style="font-size:12px;color:#6d6459;line-height:1.55">${c.explain}</span>
            ${D.questions.map((qt, i) => `
              <div style="display:flex;gap:10px;align-items:center;padding:7px 0;border-bottom:1px solid rgba(32,27,22,.06)"><span style="font:600 9px Inter,sans-serif;color:#9a9086;width:14px">${i + 1}</span><span style="font-size:12.5px;flex:1">${esc(qt)}</span>${st.formEditing ? `<span data-act="removeQ" data-i="${i}" style="font:600 9px Inter,sans-serif;color:#9a9086;cursor:pointer" data-hover="color:#9b1b22">${c.remove}</span>` : ''}</div>`).join('')}
            ${st.formEditing ? `
              <div style="display:flex;gap:8px;padding-top:4px">
                <input data-role="formDraft" value="${esc(st.formDraft)}" placeholder="${esc(c.addPh)}" aria-label="New question" style="flex:1;border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:8px 10px;font-size:12px;color:#201b16;min-width:0">
                <span data-act="addQ" style="padding:8px 12px;background:#9b1b22;color:#fff;font:600 9px Inter,sans-serif;letter-spacing:.12em;cursor:pointer;white-space:nowrap">${c.add}</span>
              </div>` : ''}
            <span data-act="copyLink" style="font:600 9px Inter,sans-serif;letter-spacing:.13em;color:${st.linkCopied ? '#1e6e42' : '#9b1b22'};cursor:pointer">${st.linkCopied ? c.linkCopied : c.copyLink}</span>
            <span style="font:400 10.5px ui-monospace,monospace;color:#9a9086">${c.url}</span>
          </div>
        </div>
        <!-- /dc -->`;
}
function blockGathering() {
  const c = COPY.gathering;
  const g = D.hub.gathering;
  const v = D.hub.vote || { counts: { split: 0, zagreb: 0 }, total: 0 };
  const year = g && g.start_date ? String(g.start_date).slice(0, 4) : String(FACTS.forum.gathering.start).slice(0, 4);
  const total = Math.max(1, v.total);
  const facts = g ? c.facts(fmt.longRange(g.start_date, g.end_date), g.location_name || FACTS.forum.gathering.where, g.registrations_count, g.capacity) : '';
  return `
        <!-- dc: Admin Forum Hub.dc.html › "THE GATHERING · MAY 2027" -->
        <div data-block="gathering" style="border:1px solid rgba(32,27,22,.14);background:#fff;padding:16px 20px;display:flex;flex-direction:column;gap:8px">
          <div style="display:flex;align-items:center;gap:10px"><span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${esc(c.title(fmt.rangeLabel((g && g.start_date) || FACTS.forum.gathering.start, (g && g.end_date) || FACTS.forum.gathering.end) + ', ' + year))}</span><div style="flex:1"></div>${g ? `<span data-act="gatherToggle" style="font:600 8.5px Inter,sans-serif;letter-spacing:.13em;color:#6d6459;cursor:pointer" data-hover="color:#201b16">${st.gatherEdit ? c.close : c.edit}</span>` : ''}</div>
          <span style="font-size:12.5px;color:#6d6459;line-height:1.6">${c.body}</span>
          ${g ? `<span style="font-size:12px;color:#201b16" data-v2="gathering-facts">${esc(facts)}</span>` : ''}
          ${g && st.gatherEdit ? `
          <!-- v2: inline gathering editor (writes the live forum_events row) -->
          <div data-v2="gathering-edit" style="display:flex;flex-direction:column;gap:7px;background:#fdfbf6;border:1px solid rgba(32,27,22,.08);padding:10px 12px">
            <label style="font:600 8.5px Inter,sans-serif;letter-spacing:.12em;color:#6d6459">${c.lWhere}<input data-role="gWhere" value="${esc(g.location_name || '')}" style="display:block;width:100%;box-sizing:border-box;border:1px solid rgba(32,27,22,.25);background:#fff;padding:7px 9px;font:400 12.5px Inter,sans-serif;color:#201b16;margin-top:3px"></label>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <label style="font:600 8.5px Inter,sans-serif;letter-spacing:.12em;color:#6d6459;flex:1;min-width:110px">${c.lStart}<input data-role="gStart" type="date" value="${esc(String(g.start_date || '').slice(0, 10))}" style="display:block;width:100%;box-sizing:border-box;border:1px solid rgba(32,27,22,.25);background:#fff;padding:6px 9px;font:400 12.5px Inter,sans-serif;color:#201b16;margin-top:3px"></label>
              <label style="font:600 8.5px Inter,sans-serif;letter-spacing:.12em;color:#6d6459;flex:1;min-width:110px">${c.lEnd}<input data-role="gEnd" type="date" value="${esc(String(g.end_date || '').slice(0, 10))}" style="display:block;width:100%;box-sizing:border-box;border:1px solid rgba(32,27,22,.25);background:#fff;padding:6px 9px;font:400 12.5px Inter,sans-serif;color:#201b16;margin-top:3px"></label>
              <label style="font:600 8.5px Inter,sans-serif;letter-spacing:.12em;color:#6d6459;width:90px">${c.lCap}<input data-role="gCap" type="number" min="1" value="${esc(g.capacity == null ? '' : g.capacity)}" style="display:block;width:100%;box-sizing:border-box;border:1px solid rgba(32,27,22,.25);background:#fff;padding:6px 9px;font:400 12.5px Inter,sans-serif;color:#201b16;margin-top:3px"></label>
            </div>
            <span data-act="gatherSave" style="padding:8px 13px;background:#9b1b22;color:#fff;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;align-self:flex-start" data-hover="background:#7e151b">${c.save}</span>
          </div>` : ''}
          <!-- v2: Split / Zagreb vote tally (v2_forum_votes read) -->
          <div data-v2="vote-tally" style="display:flex;flex-direction:column;gap:6px;border-top:1px solid rgba(32,27,22,.08);padding-top:9px">
            <div style="display:flex;align-items:baseline;gap:8px"><span style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:#6d6459">${c.vote}</span><span style="font-size:11px;color:#9a9086">${v.total ? esc(c.votes(v.total)) : c.noVotes}</span></div>
            <div style="display:flex;align-items:center;gap:10px"><span style="width:60px;flex:none;font-size:12px">Split</span><span style="flex:1;height:9px;background:rgba(32,27,22,.06)"><span style="display:block;width:${Math.round((v.counts.split || 0) / total * 100)}%;height:100%;background:#9b1b22"></span></span><span style="font:600 11px Inter,sans-serif;width:20px;text-align:right">${v.counts.split || 0}</span></div>
            <div style="display:flex;align-items:center;gap:10px"><span style="width:60px;flex:none;font-size:12px">Zagreb</span><span style="flex:1;height:9px;background:rgba(32,27,22,.06)"><span style="display:block;width:${Math.round((v.counts.zagreb || 0) / total * 100)}%;height:100%;background:#c9a962"></span></span><span style="font:600 11px Inter,sans-serif;width:20px;text-align:right">${v.counts.zagreb || 0}</span></div>
          </div>
          <a href="/calendar" style="font:600 10px Inter,sans-serif;letter-spacing:.14em">${c.calendar}</a>
        </div>
        <!-- /dc -->`;
}
function template() {
  return `
<div data-screen-label="Admin Forum Hub" style="min-height:100vh;background:#f6f2ea;color:#201b16;font-family:Inter,sans-serif">
  ${blockSubnav()}
  <div class="mx-gutter" style="max-width:1180px;margin:0 auto;padding:30px 28px 48px;display:flex;flex-direction:column;gap:24px">
    ${blockTitle()}
    ${blockBand()}
    ${blockFeed()}
    <div class="mx-two" style="display:grid;grid-template-columns:1.5fr 1fr;gap:22px;align-items:start">
      <div style="display:flex;flex-direction:column;gap:22px">
        ${blockPipeline()}
        ${blockMembers()}
      </div>
      <div style="display:flex;flex-direction:column;gap:22px">
        ${blockCodes()}
        ${blockForm()}
        ${blockGathering()}
      </div>
    </div>
  </div>
</div>`;
}

// ---------------------------------------------------------------- behaviour
function rerender(sel, html) { const el = rootEl && rootEl.querySelector(sel); if (el) el.outerHTML = html; }
function val(role) { const el = rootEl && rootEl.querySelector(`[data-role="${role}"]`); return el ? el.value.trim() : ''; }
async function refreshHub() {
  try { const h = await api.get('/api/v2/forum/hub'); if (h && h.ok) D.hub = h; } catch (e) { /* keep the last read */ }
}
async function refreshCands() {
  try { const r = await api.get('/api/admin/forum/candidates?status=all'); D.cands = (r && Array.isArray(r.candidates)) ? r.candidates : D.cands; } catch (e) { /* keep */ }
}
function copyText(t) { try { navigator.clipboard.writeText(t); } catch (e) { /* clipboard blocked — the toast still confirms intent */ } }
async function saveQuestions(list, toastMsg) {
  try { const r = await api.put('/api/v2/forum/consideration-questions', { questions: list }); D.questions = r.questions || list; ui.toast(toastMsg); }
  catch (e) { ui.toast(e.message, { kind: 'error' }); }
  rerender('[data-block="form"]', blockForm());
}

const handlers = {
  setSpot: () => { st.kind = 'spotlight'; st.fBody = val('fBody'); rerender('[data-block="feed"]', blockFeed()); },
  setNews: () => { st.kind = 'news'; st.fBody = val('fBody'); rerender('[data-block="feed"]', blockFeed()); },
  setNote: () => { st.kind = 'note'; st.fBody = val('fBody'); rerender('[data-block="feed"]', blockFeed()); },
  publish: async (el) => {
    const isSpot = st.kind === 'spotlight';
    const body = val('fBody');
    const name = val('fName'), role = val('fRole'), title = val('fTitle');
    if (!body || (isSpot ? !name : !title)) { ui.toast(isSpot ? COPY.feed.needSpot : COPY.feed.needNews); return; }
    el.setAttribute('aria-disabled', 'true');
    try {
      await api.post('/api/v2/forum/feed', isSpot ? { kind: 'spotlight', name, role, body } : { kind: st.kind, title, body });
      st.fName = st.fRole = st.fTitle = st.fBody = '';
      await refreshHub();
      rerender('[data-block="feed"]', blockFeed());
      ui.toast(COPY.feed.published);
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  unpub: async (el) => {
    const id = el.dataset.id;
    if (st.unpubConfirm !== id) { st.unpubConfirm = id; rerender('[data-block="feed"]', blockFeed()); return; }
    st.unpubConfirm = null;
    try {
      await api.put('/api/v2/forum/feed/' + encodeURIComponent(id), { published: false });
      await refreshHub(); rerender('[data-block="feed"]', blockFeed());
      ui.toast(COPY.feed.unpublished, { undo: async () => { try { await api.put('/api/v2/forum/feed/' + encodeURIComponent(id), { published: true }); } catch (e) {} if (rootEl) { await refreshHub(); rerender('[data-block="feed"]', blockFeed()); } } });
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  repub: async (el) => {
    try { await api.put('/api/v2/forum/feed/' + encodeURIComponent(el.dataset.id), { published: true }); await refreshHub(); rerender('[data-block="feed"]', blockFeed()); ui.toast(COPY.feed.republished); }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  candsAll: () => { st.candsAll = !st.candsAll; st.candDraft = val('candDraft'); rerender('[data-block="pipeline"]', blockPipeline()); },
  sendCode: async (el) => {
    const cd = D.cands.find(x => x.id === el.dataset.id); if (!cd) return;
    if (!cd.email) { ui.toast(COPY.pipeline.needEmail); return; }
    el.setAttribute('aria-disabled', 'true');
    try {
      const r = await api.post('/api/v2/forum/invites', { email: cd.email, name: cd.name || '', note: 'pipeline · ' + (cd.institution || ''), queue: true });
      await refreshHub();
      rerender('[data-block="pipeline"]', blockPipeline()); rerender('[data-block="codes"]', blockCodes()); rerender('[data-block="band"]', blockBand());
      ui.toast((r && r.message) ? String(r.message).toUpperCase() : COPY.pipeline.queued);
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  addCand: async () => {
    const draft = val('candDraft');
    if (!draft) { ui.toast(COPY.pipeline.typeFirst); return; }
    const emailMatch = draft.match(/[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+/);
    const email = emailMatch ? emailMatch[0] : '';
    const name = draft.replace(email, '').replace(/[<>,;·—-]+\s*$/, '').replace(/\s*[<>,;·—]\s*$/, '').trim() || email;
    try {
      await api.post('/api/v2/forum/candidates', { name, email });
      st.candDraft = '';
      await refreshCands();
      rerender('[data-block="pipeline"]', blockPipeline()); rerender('[data-block="band"]', blockBand());
      ui.toast(COPY.pipeline.added);
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  nomStatement: (el) => { st.nomOpen = st.nomOpen === el.dataset.id ? null : el.dataset.id; st.candDraft = val('candDraft'); rerender('[data-block="pipeline"]', blockPipeline()); },
  nomShortlist: async (el) => {
    el.setAttribute('aria-disabled', 'true');
    try {
      const r = await api.post('/api/v2/forum/nominations/' + encodeURIComponent(el.dataset.id) + '/shortlist', {});
      if (st.nomOpen === el.dataset.id) st.nomOpen = null;
      st.nomDeclineConfirm = null;
      await refreshHub(); await refreshCands();
      rerender('[data-block="pipeline"]', blockPipeline()); rerender('[data-block="band"]', blockBand());
      ui.toast((r && r.message) ? String(r.message).toUpperCase() : COPY.pipeline.nomShortlisted);
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  nomDecline: async (el) => {
    const id = el.dataset.id;
    if (st.nomDeclineConfirm !== id) { st.nomDeclineConfirm = id; st.candDraft = val('candDraft'); rerender('[data-block="pipeline"]', blockPipeline()); return; }
    st.nomDeclineConfirm = null;
    try {
      await api.post('/api/v2/forum/nominations/' + encodeURIComponent(id) + '/decline', {});
      if (st.nomOpen === id) st.nomOpen = null;
      await refreshHub();
      rerender('[data-block="pipeline"]', blockPipeline());
      ui.toast(COPY.pipeline.nomDeclined);
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  membersAll: () => { st.membersAll = !st.membersAll; rerender('[data-block="members"]', blockMembers()); },
  renew: async (el) => {
    el.setAttribute('aria-disabled', 'true');
    try {
      const r = await api.put('/api/v2/forum/members/' + encodeURIComponent(el.dataset.id) + '/renew', {});
      await refreshHub();
      rerender('[data-block="members"]', blockMembers()); rerender('[data-block="band"]', blockBand());
      ui.toast((r && r.message) ? String(r.message).toUpperCase() : COPY.members.renewed);
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  copyCode: (el) => { copyText(el.dataset.code); st.copiedCode = el.dataset.code; rerender('[data-block="codes"]', blockCodes()); ui.toast(COPY.codes.codeCopied(el.dataset.code)); },
  mintCode: async (el) => {
    el.setAttribute('aria-disabled', 'true');
    try { await api.post('/api/v2/forum/invites', {}); await refreshHub(); rerender('[data-block="codes"]', blockCodes()); rerender('[data-block="band"]', blockBand()); ui.toast(COPY.codes.minted); }
    catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  queueInvite: async (el) => {
    el.setAttribute('aria-disabled', 'true');
    try { const r = await api.post('/api/v2/forum/invites/' + encodeURIComponent(el.dataset.id) + '/send', {}); await refreshHub(); rerender('[data-block="codes"]', blockCodes()); ui.toast((r && r.message ? String(r.message) : 'INVITATION QUEUED — APPROVE IT IN THE OUTBOX').toUpperCase()); }
    catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  revoke: async (el) => {
    const ok = await ui.confirm({ title: COPY.codes.revokeTitle, body: COPY.codes.revokeBody, ok: COPY.codes.revokeOk, cancel: COPY.codes.revokeKeep });
    if (!ok) return;
    try { await api.del('/api/v2/forum/invites/' + encodeURIComponent(el.dataset.id)); await refreshHub(); rerender('[data-block="codes"]', blockCodes()); rerender('[data-block="band"]', blockBand()); ui.toast(COPY.codes.revoked); }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  formToggle: () => { st.formEditing = !st.formEditing; st.formDraft = ''; rerender('[data-block="form"]', blockForm()); },
  removeQ: (el) => {
    if (D.questions.length <= 1) { ui.toast(COPY.form.lastQ); return; }
    const list = D.questions.filter((_, j) => j !== Number(el.dataset.i));
    saveQuestions(list, COPY.form.qRemoved);
  },
  addQ: () => {
    const draft = val('formDraft');
    if (!draft) { ui.toast(COPY.form.typeFirst); return; }
    st.formDraft = '';
    saveQuestions(D.questions.concat([draft]), COPY.form.qAdded);
  },
  copyLink: () => { copyText(COPY.form.fullUrl); st.linkCopied = true; rerender('[data-block="form"]', blockForm()); ui.toast(COPY.form.linkToast); },
  gatherToggle: () => { st.gatherEdit = !st.gatherEdit; rerender('[data-block="gathering"]', blockGathering()); },
  gatherSave: async (el) => {
    const g = D.hub.gathering; if (!g) return;
    const body = { location_name: val('gWhere'), start_date: val('gStart') || g.start_date, end_date: val('gEnd') || g.end_date };
    const cap = val('gCap'); if (cap) body.capacity = Number(cap);
    el.setAttribute('aria-disabled', 'true');
    try {
      await api.put('/api/admin/forum/events/' + encodeURIComponent(g.id), body);
      st.gatherEdit = false;
      await refreshHub();
      rerender('[data-block="gathering"]', blockGathering()); rerender('[data-block="band"]', blockBand());
      ui.toast(COPY.gathering.saved);
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  }
};

export default {
  title: 'Biomedical Forum',
  async render(root) {
    ensureCss();
    rootEl = root;
    st = { kind: 'spotlight', fName: '', fRole: '', fTitle: '', fBody: '', unpubConfirm: null, candDraft: '', candsAll: false, membersAll: false, copiedCode: null, formEditing: false, formDraft: '', linkCopied: false, gatherEdit: false, nomOpen: null, nomDeclineConfirm: null };
    D = await load();
    if (rootEl !== root) return; // navigated away while loading
    root.innerHTML = template();
    unbind = ui.bind(root, handlers);
  },
  destroy() { if (unbind) unbind(); unbind = null; rootEl = null; D = null; st = null; }
};
