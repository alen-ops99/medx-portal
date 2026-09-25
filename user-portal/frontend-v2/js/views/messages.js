// Source: Messages.dc.html
// Blocks (artboard order): "Breadcrumb" › "Network tabs" › "Inbox" (list pane: header ·
// search · thread rows · signed-in footer) › "Conversation" (header · messages · composer).
// Empty inbox voice from Empty States.dc.html › "MESSAGES · EMPTY INBOX". ≤700px the panes
// stack (Mobile Portal.dc.html INBOX pattern) — css/views/messages.css, injected here.
//
// Data (verified routes): GET /api/v2/messages/threads · GET/POST /api/v2/messages/team ·
// POST /api/v2/messages/threads/:key/archive · GET /api/v2/messages/peer/:userId (all in
// user-portal/backend/v2/messages.js) + the EXISTING member DM pair GET /api/messages/:userId
// (marks read server-side) and POST /api/messages (accepted-connection rule enforced there).
// ?to=<userId> opens/creates the 1:1 thread · ?topic=<tag> / ?about=<tag> (the MESSAGE US
// context tag: gala, plexus, bridges, accelerator, forum) preselect the team topic; the send
// stamps it on the thread. Team messages take ONE attachment (image/PDF ≤ 5 MB) via
// POST /api/v2/messages/attach; admin replies carry sender_name → "LAURA · MED&X" attribution
// ("MED&X TEAM" for rows from before staff identity existed). Team review Aug 2026.
// Live updates: 15 s poll while the screen is open (skipped while the tab is hidden).
// REPORT + BLOCK (App Store 1.2 — js/views/_safety.js · backend v2/safety.js): every message the member
// RECEIVED in a member thread carries a small ⋯ (REPORT that message — the server keeps a copy with the
// sender's other recent messages); the thread header's quiet ⋯ reports or blocks the PERSON (BLOCK
// ends the thread for you). A thread whose partner cannot be resolved (a closed account, or a legacy row
// keyed by email) has no header ⋯ — its messages keep their own. The Med&X team thread never has either.
// ?to=<someone you blocked> opens a "You blocked …" state with UNBLOCK (GET /api/v2/messages/peer/:userId
// answers blocked:true). A send the server refuses with 403 (suspended account, blocked pair) or 422 (the
// content filter) keeps the draft and says why under the composer.
import { api } from '../api.js';
import { session } from '../state.js';
import { ui, esc, fmt } from '../ui.js';
import router, { settled, step } from '../router.js';
import { SAFETY, ensureCss as ensureSafetyCss, moreButton, msgMoreButton, openMenu, reportSheet, blockFlow, forgetBlocks } from './_safety.js';

export const SOURCE = 'Messages.dc.html';

export const COPY = {
  crumb: { a: 'NETWORK', b: 'MESSAGES' },
  tabs: { people: 'PEOPLE', messages: 'MESSAGES', card: 'MY CARD' },
  inboxTitle: 'Inbox',
  newMessage: 'NEW MESSAGE →', newMessageT: 'New message',
  searchPh: 'Search conversations…',
  // where replies arrive — one sentence across the portal: the team's reply is written into this inbox (and
  // pushed to the member's devices); no email copy goes out
  footer: name => `You're signed in as <strong style="color:#191512">${name}</strong> · replies land right here in your portal inbox.`,
  team: { name: 'Med&X Coordinators', sub: 'Official team inbox', init: 'MX', tag: 'OFFICIAL · MED&amp;X TEAM',
          meta: 'MED&X TEAM',                                        // rows from before sender_name existed (ask 1 backfill)
          staff: name => `${String(name).toUpperCase()} · MED&X`,     // staff identity on replies — "LAURA · MED&X"
          nudge: 'Ask us anything' },
  composer: { ph: 'Write a message…', attach: 'ATTACH', attachTitle: 'Attach one image or PDF — up to 5 MB', send: 'SEND →', topicLabel: 'TOPIC', topicT: 'Topic: ', topicSheet: 'TOPIC', topicTitle: 'Topic' },
  // topic keys must match user-portal/backend/v2/messages.js › TOPICS
  topics: [['general', 'GENERAL'], ['plexus', 'PLEXUS'], ['gala', 'GALA'], ['accelerator', 'ACCELERATOR'], ['bridges', 'BUILDING BRIDGES'], ['forum', 'FORUM'], ['membership', 'MEMBERSHIP']],
  empty: {
    line: 'No messages yet.',
    why: 'Write to the Med&amp;X team about anything — tickets, programs, travel. Replies land right here in your portal inbox.',
    cta: 'START A MESSAGE →',
    whyT: 'Tickets, programs, travel: the team replies right here.', ctaT: 'Write a message'
  },
  emptyDm: name => `Say hello — this is the start of your conversation with ${name}.`,
  you: 'YOU', read: 'READ', today: 'TODAY', yesterday: 'YESTERDAY', youT: 'You', readT: 'Read',
  back: '← INBOX',
  archive: 'Archive', unarchive: 'Restore', moreT: 'More options',
  archivedToast: 'Conversation archived — it comes back the moment something new arrives.',
  unarchivedToast: 'Conversation restored.',
  archivedTag: 'ARCHIVED',
  showArchived: n => `Show archived (${n})`, hideArchived: 'Hide archived',
  attachTooBig: 'That file is over 5 MB — pick a smaller one.',
  attachBadType: 'Images (JPG, PNG, WebP, GIF) or PDF only.',
  fileFallback: 'FILE',
  sent: 'Message sent.',
  teamSent: 'Sent to the Med&X team — the reply lands right here.',
  pickTopic: 'Pick a topic for your message.',
  emptyDraft: 'Write a message first.',
  loadFail: 'Your inbox could not be loaded.', retry: 'TRY AGAIN',
  newModal: { eyebrow: 'MESSAGES · NEW', title: 'Who is it for?', teamSub: 'Tickets, programs, travel, anything.', noConns: 'Message your accepted connections — meet people in the Network first.', openNetwork: 'OPEN THE NETWORK →', openNetworkT: 'Open the network', connsFail: 'Your connections could not be loaded right now.' },
  blockedGate: {
    line: name => `You blocked ${name}.`,
    why: 'Unblock them to find each other again — then a new connection opens messaging.',
    cta: 'UNBLOCK', done: name => `${name} is unblocked.`
  },
  gate: {
    line: name => `You and ${name} are not connected yet.`,
    why: 'Messaging opens once a connection is accepted — send the request from here.',
    cta: 'SEND CONNECTION REQUEST', pending: 'REQUEST SENT — WAITING', pendingIn: name => `${name} already asked to connect — accept in the Network.`,
    sent: 'Connection request sent — messaging opens once it is accepted.', openNet: 'OPEN NETWORK →'
  },
  memberFallbackSub: 'Med&X member', unknownMember: 'Med&X member'
};

const TEAM = 'team';
// avatar colours — the artboard's thread palette (team crimson; members alternate ink / gold)
const AV_TEAM = { bg: '#9b1b22', fg: '#f7f1e6' };
const AV_MEMBER = [{ bg: '#191512', fg: '#f7f1e6' }, { bg: '#c9a962', fg: '#191512' }];

// ---- view state ----
let D = null;          // { me, threads, conns }
let st = null;         // { cur, msgs, msgsKey, drafts, topic, filter, showArchived, mobileOpen, peer, sending, attach, shownKey, shownIds, dotAt }
let timers = [];
let unbind = null, unbindDoc = [];
let rootEl = null;
let pollBusy = false;

// ---------------------------------------------------------------- time helpers
// SQL timestamps from both backends are UTC 'YYYY-MM-DD HH:MM:SS' — parse as UTC, render local.
function sqlDate(v) {
  if (!v) return null;
  const s = String(v);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (m && !/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(s)) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)));
  const d = new Date(s.replace(' ', 'T'));
  return isNaN(d) ? null : d;
}
const DAY3 = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const DAYF = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
function daysApart(d) { const a = new Date(); a.setHours(0, 0, 0, 0); const b = new Date(d); b.setHours(0, 0, 0, 0); return Math.round((a - b) / 86400000); }
const sent1 = w => String(w).charAt(0) + String(w).slice(1).toLowerCase();
function whenLabel(v) {           // thread list: 14:05 · Yesterday · Fri · Jul 28
  const d = sqlDate(v); if (!d) return '';
  const n = daysApart(d);
  if (n <= 0) return timeLabel(v);
  if (n === 1) return sent1(COPY.yesterday);
  if (n < 7) return sent1(DAY3[d.getDay()]);
  return fmt.shortDate(d).replace(/^([A-Z])([A-Z]+)/, (x, a, b) => a + b.toLowerCase());
}
function dayLabel(d) {            // conversation day divider: TODAY · YESTERDAY · FRIDAY · JUL 28
  if (!d) return '';
  const n = daysApart(d);
  if (n <= 0) return COPY.today;
  if (n === 1) return COPY.yesterday;
  if (n < 7) return DAYF[d.getDay()];
  return fmt.shortDate(d) + (d.getFullYear() !== new Date().getFullYear() ? ', ' + d.getFullYear() : '');
}
function timeLabel(v) { const d = sqlDate(v); return d ? String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') : ''; }

// ---------------------------------------------------------------- thread helpers
function memberName(t) { return [t.first_name, t.last_name].filter(Boolean).join(' ') || COPY.unknownMember; }
function threadName(t) { return t.kind === 'team' ? COPY.team.name : memberName(t); }
function threadSub(t) { return t.kind === 'team' ? '' : (t.institution || COPY.memberFallbackSub); }
function threadInit(t) { return t.kind === 'team' ? COPY.team.init : (fmt.initials(t.first_name, t.last_name) || 'M'); }
function avatarOf(t) {                       // artboard palette: team crimson, members alternate ink → gold (stable per member)
  if (t.kind === 'team') return AV_TEAM;
  const members = allThreads().filter(x => x.kind === 'member');
  return AV_MEMBER[Math.max(0, members.findIndex(x => x.key === t.key)) % AV_MEMBER.length];
}
function allThreads() {
  const list = (D && D.threads) ? D.threads.slice() : [];
  if (st && st.peer && !list.some(t => t.key === st.peer.id)) {
    list.splice(1, 0, { key: st.peer.id, kind: 'member', partner_id: st.peer.id, first_name: st.peer.first_name, last_name: st.peer.last_name,
      institution: st.peer.institution, official: false, count: 0, unread: 0, last: null, archived: false, virtual: true });
  }
  return list;
}
function currentThread() { return allThreads().find(t => t.key === st.cur) || null; }
// a member thread whose partner is a live account we can name by id — REPORT / BLOCK of the person need one.
// Closed accounts and legacy rows keyed by the sender's EMAIL (partner_id is an address) have none.
function partnerResolved(t) { return !!t && t.kind === 'member' && !t.gone && !String(t.key || '').includes('@'); }
function visibleThreads() {
  const q = (st.filter || '').trim().toLowerCase();
  return allThreads().filter(t => (st.showArchived ? true : !t.archived) || t.key === st.cur)
    .filter(t => !q || (threadName(t) + ' ' + threadSub(t) + ' ' + ((t.last && t.last.content) || '')).toLowerCase().includes(q));
}
function previewOf(t) {
  if (!t.last) return t.kind === 'team' ? COPY.team.nudge : '';
  const text = String(t.last.content || '').replace(/\s+/g, ' ').trim();
  return text || (t.last.attachment_name ? '\u2295 ' + t.last.attachment_name : '');
}

// ---------------------------------------------------------------- templates
function blockCrumb() { return `
  <!-- dc: Messages.dc.html › "Breadcrumb" -->
  <div class="mx-gutter mx-crumbs" style="display:flex;align-items:center;gap:13px;padding:10px 36px;border-bottom:1px solid rgba(25,21,18,.16)">
    <span style="font:600 12px Inter,sans-serif;letter-spacing:.12em;color:#4a4239">${COPY.crumb.a}</span>
    <span style="color:rgba(25,21,18,.35);font-size:12px">→</span>
    <span style="font:600 12px Inter,sans-serif;letter-spacing:.12em;color:#191512">${COPY.crumb.b}</span>
  </div>
  <!-- /dc -->`; }

function blockTabs() { return `
  <!-- dc: Messages.dc.html › "Network tabs" -->
  <!-- the shared section-tab strip (app.css › .mx-tab), keyed like Network's so the underline slides across -->
  <div class="mx-tabs mx-gutter mx-net-tabs" data-tabs="network" style="display:flex;align-items:center;justify-content:center;gap:26px;padding:13px 36px;border-bottom:1px solid rgba(25,21,18,.16);flex-wrap:wrap">
    <a href="/app/network" class="mx-tab" style="font:600 12px Inter,sans-serif;letter-spacing:.12em;color:#4a4239" data-hover="color:#191512">${COPY.tabs.people}</a>
    <span class="mx-tab is-on" aria-current="page" style="font:600 12px Inter,sans-serif;letter-spacing:.12em;color:#9b1b22;cursor:default">${COPY.tabs.messages}</span>
  </div>
  <!-- /dc -->`; }

// The unread dot pops in only when it is NEW — the first time a thread shows one, or when an unread
// message arrives after it was read. The list is repainted by every 15 s poll, every keystroke in the
// conversation search, every open and every send; a dot already on screen stays still through all of them.
// st.dotAt = when each thread's current dot first appeared (a row filtered out keeps its entry). A repaint
// that lands mid-pop (the arrival paints the list twice in one go) picks the pop up where it stood.
const DOT_POP = 300;   // ms — css .mx-msg-dot-in
function unreadDot(key, unread) {
  if (!unread) { st.dotAt.delete(key); return ''; }
  const now = performance.now();
  if (!st.dotAt.has(key)) st.dotAt.set(key, now);
  const age = Math.round(now - st.dotAt.get(key)), popping = age < DOT_POP;
  return `<span class="mx-msg-dot${popping ? ' mx-msg-dot-in' : ''}"${popping ? ` style="animation-delay:-${age}ms"` : ''} aria-label="Unread"></span>`;
}
// a thread's circle: the team is an ink circle with the real X mark; a member is ui.portrait (their photo, else initials)
function threadPic(t, size) {
  if (t.kind === 'team') return `<span class="mx-pic mx-pic-${size} mx-msg-team" aria-hidden="true"><img src="/assets/mark-x.png" alt="" class="mx-msg-x"></span>`;
  const src = t.photo_url || t.profile_photo || '';
  return ui.portrait({ name: memberName(t), src: src ? (String(src).startsWith('/') ? api.url(src) : src) : '', size, alt: '' });
}
function threadRow(t, i) {
  // the stacked phone list shows no "current" row: the open thread is not beside it (a tint and a gold rail on
  // the first row read as selected while nothing was open), and that row keeps its unread dot
  const cur = t.key === st.cur && (!stacked() || !!st.mobileOpen);
  const unread = t.unread > 0 && !cur;
  const when = t.archived ? `<span class="mx-msg-arch">${COPY.archivedTag}</span>` : esc(whenLabel(t.last && t.last.created_at));
  return `
      <div data-act="open" data-key="${esc(t.key)}" role="listitem" aria-current="${cur}" class="mx-msg-row${cur ? ' is-cur' : ''}${unread ? ' is-unread' : ''}">
        ${threadPic(t, 44)}
        <span class="mx-msg-row-text">
          <span class="mx-msg-row-top"><span class="mx-msg-row-name">${esc(threadName(t))}</span><span class="mx-msg-row-when">${when}</span></span>
          <span class="mx-msg-row-prev">${unreadDot(t.key, unread)}<span>${esc(previewOf(t))}</span></span>
        </span>
      </div>`;
}

function blockList() {
  const rows = visibleThreads();
  const archivedCount = allThreads().filter(t => t.archived).length;
  return `
  <!-- dc: Messages.dc.html › "Inbox" (phone calm pass: a large title, a compose button, one search field, rows) -->
  <div class="mx-msg-list">
    <div class="mx-msg-list-head">
      <h1 class="mx-msg-title">${COPY.inboxTitle}</h1>
      <span data-act="newMsg" role="button" tabindex="0" aria-label="${COPY.newMessageT}" title="${COPY.newMessageT}" class="mx-iconbtn mx-msg-compose">${ui.icon('compose', 22)}</span>
    </div>
    <div class="mx-msg-search">
      <label class="mx-msg-searchbox">${ui.icon('search', 18)}<input data-role="search" type="search" class="mx-msg-field" placeholder="${COPY.searchPh}" value="${esc(st.filter || '')}" aria-label="Search conversations"></label>
    </div>
    <div data-role="rows" data-v2="scrolling thread list (replaces the artboard's flex spacer)" role="list" aria-label="Conversations" class="mx-msg-rows">
      ${rows.map((t, i) => threadRow(t, i)).join('')}
      ${!rows.length ? `<div class="mx-msg-none">${st.filter ? 'Nothing matches your search.' : 'No conversations yet.'}</div>` : ''}
      ${archivedCount ? `<div data-v2="archived toggle" class="mx-msg-archtoggle"><span data-act="toggleArchived" class="mx-msg-link">${st.showArchived ? COPY.hideArchived : COPY.showArchived(archivedCount)}</span></div>` : ''}
    </div>
  </div>
  <!-- /dc -->`;
}

function dayDivider(label) { return `
        <div data-v2="day divider" style="display:flex;align-items:center;gap:10px;margin:2px 0">
          <span style="flex:1;height:1px;background:rgba(25,21,18,.1)"></span>
          <span style="font:600 12px Inter,sans-serif;letter-spacing:.1em;color:#6d6459">${esc(label)}</span>
          <span style="flex:1;height:1px;background:rgba(25,21,18,.1)"></span>
        </div>`; }

// ONE attachment per message (team review Aug 2026) — thumbnail for images, a labelled chip for PDFs.
// Paths are relative ('/uploads/messages/…', both backends serve them) or absolute (Cloudinary).
function attachHref(m) { const p = m.attachment_path || m.attachment_url; return p ? (String(p).startsWith('/') ? api.url(p) : p) : null; }
function attachIsImage(m) { return /\.(jpe?g|png|webp|gif)(\s|\?|$)/i.test(String(m.attachment_name || '') + ' ' + String(m.attachment_path || m.attachment_url || '')); }
function bubbleAttachment(m, mine) {
  const url = attachHref(m);
  if (!url) return '';
  const name = m.attachment_name || COPY.fileFallback;
  const bd = mine ? 'rgba(247,241,230,.4)' : 'rgba(25,21,18,.25)';
  const img = attachIsImage(m) ? `<a href="${esc(url)}" target="_blank" rel="noopener" style="display:block;margin-top:9px"><img src="${esc(url)}" alt="${esc(name)}" loading="lazy" style="max-width:100%;max-height:180px;border:1px solid ${bd};display:block"></a>` : '';
  return `${img}<a href="${esc(url)}" target="_blank" rel="noopener" data-v2="attachment download (served with Content-Disposition: attachment)" style="display:inline-flex;align-items:center;gap:6px;margin-top:8px;padding:6px 10px;border:1px solid ${bd};font:500 14px Inter,sans-serif;color:inherit;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${ui.icon('clip', 16)}${esc(name)}</a>`;
}
function bubble(m, meta, thread, isNew) {
  const mine = !!m.mine;
  const side = mine ? 'flex-end' : 'flex-start';
  const bg = mine ? '#191512' : '#f7f1e6';
  const fg = mine ? '#f7f1e6' : '#191512';
  const bd = mine ? '#191512' : 'rgba(25,21,18,.2)';
  const title = (!mine && m.title && thread.kind === 'team') ? `<strong style="display:block;margin-bottom:4px">${esc(m.title)}</strong>` : '';
  // App Store 1.2: a message another MEMBER sent you can be reported on its own (never the team's, never yours)
  const report = (!mine && thread.kind === 'member' && m.id != null) ? msgMoreButton({ id: m.id, name: threadName(thread) }) : '';
  return `
        <div class="mx-msg-bubble${mine ? ' mx-msg-mine' : ''}${isNew ? ' mx-msg-new' : ''}"${report ? ` data-mid="${esc(m.id)}"` : ''} style="display:flex;flex-direction:column;gap:4px;align-self:${side};max-width:78%;align-items:${side}">
          <span class="mx-msg-meta" style="display:inline-flex;align-items:center;font:500 12px Inter,sans-serif;letter-spacing:.04em;color:#4a4239">${esc(meta)}${report}</span>
          <span class="mx-msg-text" style="padding:12px 15px;font-size:16px;line-height:1.5;background:${bg};color:${fg};border:1px solid ${bd};white-space:pre-wrap;word-break:break-word">${title}${esc(m.content)}${bubbleAttachment(m, mine)}</span>
        </div>`;
}

// a message's identity across re-renders (team rows and DMs both carry an id; the fallback never collides in practice)
const msgKey = m => String(m.id != null ? m.id : `${m.created_at}|${String(m.content || '').slice(0, 40)}`);

function convMessages(thread) {
  // The open thread's messages have not arrived yet: a quiet gold hairline (after a beat, so a fast
  // answer shows nothing) instead of the PREVIOUS thread's bubbles under the new header.
  if (st.msgsKey !== thread.key) return `<div class="mx-msg-wait" aria-hidden="true"><span></span></div>`;
  const msgs = st.msgs || [];
  // a bubble is NEW when this thread has already been painted and its id was not in that paint —
  // it rises in (css .mx-msg-new); a thread's first paint fades in as a whole (.mx-msg-fresh)
  const repaint = st.shownKey === thread.key;
  if (!msgs.length) {
    if (thread.kind === 'team') return `
        <!-- dc: Empty States.dc.html › "MESSAGES · EMPTY INBOX" -->
        <div class="empty" style="margin:auto">
          <span class="empty-line">${COPY.empty.line}</span>
        </div>
        <!-- /dc -->`;
    if (thread.virtual && st.peer && st.peer.blocked) return `
        <div class="empty" style="margin:auto" data-v2="blocked peer (App Store 1.2 — v2/safety.js)">
          <span class="empty-line">${esc(COPY.blockedGate.line(memberName(thread)))}</span>
          <span class="empty-why">${COPY.blockedGate.why}</span>
          <span data-act="unblockPeer" role="button" tabindex="0" class="btn-ghost btn-sm mx-msg-btn">${COPY.blockedGate.cta}</span>
        </div>`;
    if (thread.virtual && st.peer && !st.peer.connected) return `
        <div class="empty" style="margin:auto" data-v2="connection gate (POST /api/messages requires an accepted connection)">
          <span class="empty-line">${esc(COPY.gate.line(memberName(thread)))}</span>
          <span class="empty-why">${st.peer.pending === 'received' ? esc(COPY.gate.pendingIn(threadName(thread))) : COPY.gate.why}</span>
          ${st.peer.pending ? (st.peer.pending === 'received'
            ? `<a href="/app/network" class="btn-primary btn-sm mx-msg-btn">${COPY.gate.openNet}</a>`
            : `<span class="btn-ghost btn-sm" aria-disabled="true">${COPY.gate.pending}</span>`)
            : `<span data-act="connectPeer" role="button" tabindex="0" class="btn-primary btn-sm mx-msg-btn">${COPY.gate.cta}</span>`}
        </div>`;
    return `<div class="empty" style="margin:auto" data-v2="empty 1:1 thread"><span class="empty-why">${esc(COPY.emptyDm(memberName(thread)))}</span></div>`;
  }
  const out = [];
  let lastDay = null;
  let lastReadMine = null;
  msgs.forEach(m => { if (m.mine && m.read) lastReadMine = m; });
  msgs.forEach(m => {
    const d = sqlDate(m.created_at);
    const dk = d ? d.toDateString() : '';
    if (dk !== lastDay) { out.push(dayDivider(dayLabel(d))); lastDay = dk; }
    const who = m.mine ? COPY.youT
      : (thread.kind === 'team' ? (m.sender_name ? COPY.team.staff(m.sender_name) : COPY.team.meta) : memberName(thread).toUpperCase());
    let meta = who + ' · ' + timeLabel(m.created_at);
    if (m.mine && m.topic) { const t = COPY.topics.find(x => x[0] === m.topic); if (t) meta += ' · ' + topicName(t[1]); }
    if (lastReadMine && m.id === lastReadMine.id) meta += ' · ' + COPY.readT;
    out.push(bubble(m, meta, thread, repaint && !st.shownIds.has(msgKey(m))));
  });
  return out.join('');
}

const topicName = label => String(label).charAt(0) + String(label).slice(1).toLowerCase().replace(/\bbridges\b/, 'Bridges');
// the topic is ONE control ("Topic: General ▾") that opens a sheet with the same seven values (data-act="topic")
function topicChips() {
  const cur = COPY.topics.find(t => t[0] === st.topic);
  return `
    <div data-v2="topic picker (team messages carry a topic — admin README note 24)" data-role="topics" class="mx-msg-topicrow">
      <span data-act="topicOpen" role="button" tabindex="0" aria-haspopup="dialog" class="mx-msg-topic">${COPY.composer.topicT}<b>${esc(cur ? topicName(cur[1]) : '—')}</b>${ui.icon('chevron-down', 16)}</span>
    </div>`;
}

function blockConv() {
  const t = currentThread();
  if (!t) return `<div class="mx-msg-conv" style="display:flex;flex-direction:column;background:#fdfaf3;min-height:0"></div>`;
  const isTeam = t.kind === 'team';
  const canWrite = isTeam || !t.virtual || (st.peer && st.peer.connected);
  const attachChip = (isTeam && st.attach) ? `
    <div data-v2="pending attachment — uploads on SEND via POST /api/v2/messages/attach" class="mx-msg-attached">
      <span class="mx-msg-attached-name">${ui.icon('clip', 16)}<span>${esc(st.attach.name)}</span></span>
      <span data-act="attachClear" role="button" tabindex="0" aria-label="Remove attachment" class="mx-iconbtn">${ui.icon('x', 18)}</span>
    </div>` : '';
  return `
  <!-- dc: Messages.dc.html › "Conversation" (phone calm pass: a 32 circle header, 16px bubbles, an icon composer) -->
  <div class="mx-msg-conv" style="display:flex;flex-direction:column;background:#fdfaf3;min-height:0">
    <div class="mx-msg-head">
      <span data-act="backList" class="mx-msg-back mx-iconbtn" data-v2="mobile back to list" role="button" tabindex="0" aria-label="Back to inbox">${ui.icon('chevron-left', 24)}</span>
      ${threadPic(t, 32)}
      <span class="mx-msg-head-text">
        <span class="mx-msg-head-name">${esc(threadName(t))}</span>
        ${threadSub(t) ? `<span class="mx-msg-head-sub">${esc(threadSub(t))}</span>` : ''}
      </span>
      ${t.virtual ? '' : `<span data-act="archive" role="button" tabindex="0" data-v2="archive = hide, never delete" class="mx-msg-link mx-msg-archlink">${t.archived ? COPY.unarchive : COPY.archive}</span>`}
      ${isTeam || (t.virtual && st.peer && st.peer.blocked) || !partnerResolved(t)
        ? (t.virtual ? '' : `<span data-act="more" role="button" tabindex="0" aria-haspopup="menu" aria-expanded="false" aria-label="${COPY.moreT}" class="mx-iconbtn mx-msg-more mx-msg-more--phone" data-v2="phones: Archive lives in this menu (the header keeps back · photo · name · ⋯)">${ui.icon('more', 22)}</span>`)
        : moreButton({ id: t.key, name: threadName(t), cls: 'mx-msg-more' })}
    </div>
    <div data-role="msgs" aria-live="polite" class="mx-msg-pane${st.msgsKey === t.key && st.shownKey !== t.key ? ' mx-msg-fresh' : ''}" style="flex:1;padding:20px 20px calc(20px + var(--mx-compose-h, 0px));display:flex;flex-direction:column;gap:14px;overflow-y:auto">${convMessages(t)}</div>
    ${canWrite ? `<div class="mx-msg-compose-wrap mx-glass" data-role="compose">${isTeam ? topicChips() : ''}${attachChip}
    ${st.sendError && st.sendError.key === t.key ? `<p data-role="sendErr" role="alert" data-v2="a send the server refused (403 suspended / blocked · 422 content filter) — the draft stays" class="mx-msg-err">${esc(st.sendError.text)}</p>` : ''}
    <div class="mx-msg-composer">
      ${isTeam ? `<label class="mx-msg-attach mx-iconbtn" tabindex="0" role="button" aria-label="${COPY.composer.attachTitle}" data-v2="ONE image/PDF per message — label wraps the hidden input so the OS picker opens without ui.bind's preventDefault (the profile-photo trap)" title="${COPY.composer.attachTitle}">${ui.icon('clip', 22)}<input type="file" data-role="attachFile" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf" style="display:none"></label>` : ''}
      <textarea data-role="draft" data-key="${esc(t.key)}" class="mx-msg-field mx-msg-draft" placeholder="${COPY.composer.ph}" rows="1" aria-label="${COPY.composer.ph}">${esc(st.drafts[t.key] || '')}</textarea>
      <span data-act="send" role="button" tabindex="0" aria-label="Send message" ${st.sending ? 'aria-disabled="true"' : ''} class="mx-msg-btn mx-iconbtn mx-iconbtn--fill mx-msg-send">${ui.icon('send', 22)}</span>
    </div></div>` : ''}
  </div>
  <!-- /dc -->`;
}

function template() {
  if (!D || !D.threads) return `
<div data-screen-label="Messages" class="mx-msg-screen" style="font-family:Inter,sans-serif;color:#191512;background:#f7f1e6;min-height:100vh">
  ${blockCrumb()}
  ${blockTabs()}
  <div class="empty" style="padding:64px 22px" data-v2="inbox unavailable">
    <span class="empty-line">${COPY.loadFail}</span>
    <span data-act="retry" role="button" tabindex="0" class="btn-ghost btn-sm mx-msg-btn">${COPY.retry}</span>
  </div>
</div>`;
  return `
<div data-screen-label="Messages" class="mx-msg-screen" style="font-family:Inter,sans-serif;color:#191512;background:#f7f1e6;min-height:100vh;display:flex;flex-direction:column">
  ${blockCrumb()}
  ${blockTabs()}
  <div data-role="grid" class="mx-msg-grid${st.mobileOpen ? ' mx-msg-open' : ''}" style="display:grid;grid-template-columns:340px minmax(0,1fr);align-items:stretch">
    ${blockList()}
    ${blockConv()}
  </div>
</div>`;
}

// ---------------------------------------------------------------- data
async function load() {
  const r = await api.settle({ threads: api.get('/api/v2/messages/threads'), conns: api.get('/api/networking/connections') });
  return { me: (r.threads && r.threads.me) || { id: (session.user || {}).id }, threads: r.threads ? r.threads.threads : null, conns: r.conns || [] };
}

function normalizeDm(rows) {
  const myId = String((D.me && D.me.id) || '');
  return (rows || []).map(m => ({ id: m.id, mine: String(m.sender_id) === myId, content: m.content || '', created_at: m.created_at, read: !!m.read_at }));
}

// The conversation is on screen: always beside the list on a wide screen; in the stacked phone layout (≤700 px)
// only once opened. Reading a thread marks it read on the server (?mark=1, and GET /api/messages/:id always
// does), so a phone showing only the list never fetches with a mark.
function convShown() { return !!st && (st.mobileOpen || !window.matchMedia('(max-width: 700px)').matches); }
async function fetchThreadMessages(t, { mark } = {}) {
  if (t.kind === 'team') {
    const r = await api.get('/api/v2/messages/team' + (mark ? '?mark=1' : ''));
    return r.messages || [];
  }
  if (t.virtual && st.peer && !st.peer.connected) return [];
  // existing route — marks the partner's messages read server-side
  return normalizeDm(await api.get('/api/messages/' + encodeURIComponent(t.key) + '?limit=200'));
}

// ---------------------------------------------------------------- rendering plumbing
function rr(sel, html) { const el = rootEl && rootEl.querySelector(sel); if (el) { el.outerHTML = html; } }
function renderList() { rr('.mx-msg-list', blockList()); wireList(); }
function renderConv({ keepDraft = true } = {}) {
  // the draft on screen is saved under the thread it was TYPED in (its data-key) — openThread() moves st.cur
  // before this runs, and saving under st.cur carried a DM's text into the next thread's composer
  const ta = rootEl && rootEl.querySelector('[data-role="draft"]');
  if (keepDraft && ta && ta.dataset.key) st.drafts[ta.dataset.key] = ta.value;
  rr('.mx-msg-conv', blockConv());
  if (st.cur && st.msgsKey === st.cur) { st.shownKey = st.cur; st.shownIds = new Set((st.msgs || []).map(msgKey)); }
  const grid = rootEl && rootEl.querySelector('[data-role="grid"]');
  if (grid) grid.classList.toggle('mx-msg-open', !!st.mobileOpen);
  wireConv();
  fitComposer();
  scrollMsgs();
}
// the inbox and the conversation stack (one shows at a time) at ≤700 px — messages.css
const stacked = () => { try { return window.matchMedia('(max-width: 700px)').matches; } catch (e) { return false; } };
function scrollMsgs() { const m = rootEl && rootEl.querySelector('[data-role="msgs"]'); if (m) m.scrollTop = m.scrollHeight; }
// The space bottom-anchored things keep free for the tab bar (GLASS-RULES §1.10, §2.1): --mx-tabbar-h, set by the web
// bar's own rule or by the iOS layer (0px while the keyboard is up). Its computed value can be an unresolved calc()
// (the web bar's rule adds the safe area), so a hidden probe resolves it to pixels. The web bar where it stands on screen
// now counts too (the larger of the two wins): that covers a tree where the variable is not defined yet, and a bar that
// slid away for the keyboard or is hidden in the app counts nothing.
let tbProbe = null;
function tabbarSpace() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--mx-tabbar-h').trim();
  let v = 0;
  if (/^-?[\d.]+px$/.test(raw)) v = parseFloat(raw);
  else if (raw) {
    if (!tbProbe || !tbProbe.isConnected) {
      tbProbe = document.createElement('div');
      tbProbe.setAttribute('aria-hidden', 'true');
      tbProbe.style.cssText = 'position:fixed;left:0;top:0;width:0;visibility:hidden;pointer-events:none;height:var(--mx-tabbar-h, 0px)';
      document.body.appendChild(tbProbe);
    }
    v = tbProbe.offsetHeight;
  }
  const tab = document.getElementById('mx-tabbar');
  let bar = 0;
  if (tab && getComputedStyle(tab).display !== 'none') {
    const top = tab.getBoundingClientRect().top;
    if (top < window.innerHeight) bar = window.innerHeight - top;
  }
  return Math.max(v, bar);
}
// the floating composer's height, so the last bubble can scroll clear of it (the pane pads by --mx-compose-h)
function fitComposer() {
  const conv = rootEl && rootEl.querySelector('.mx-msg-conv'); if (!conv) return;
  const wrap = conv.querySelector('[data-role="compose"]');
  const pane = conv.querySelector('[data-role="msgs"]');
  const atFoot = pane ? pane.scrollHeight - pane.scrollTop - pane.clientHeight < 8 : false;
  conv.style.setProperty('--mx-compose-h', (wrap ? wrap.offsetHeight + 8 : 0) + 'px');
  if (pane && atFoot) pane.scrollTop = pane.scrollHeight;
}
function sizeGrid() {
  const g = rootEl && rootEl.querySelector('[data-role="grid"]'); if (!g) return;
  const tabH = tabbarSpace();
  const small = window.matchMedia('(max-width: 700px)').matches;
  // the grid's DOCUMENT offset: render() runs before the router's scroll-to-top, so a viewport offset taken
  // from a screen left scrolled down came out hundreds of px short and pushed the composer under the tab bar
  const top = g.getBoundingClientRect().top + window.scrollY;
  // phones: the grid ends exactly at the tab bar, whatever the screen height (a 430 or 560 floor put the
  // composer under the tab bar on a 568–667 px tall iPhone); only a tiny landscape phone gets a 240 floor
  const h = Math.max(small ? 240 : 560, window.innerHeight - top - tabH);
  g.style.height = h + 'px';
}

function wireList() {
  const s = rootEl && rootEl.querySelector('[data-role="search"]');
  if (s) {
    s.addEventListener('input', () => { st.filter = s.value; const rows = rootEl.querySelector('[data-role="rows"]'); if (rows) { const keep = visibleThreads(); rows.innerHTML = keep.map((t, i) => threadRow(t, i)).join('') + (!keep.length ? `<div class="mx-msg-none">Nothing matches your search.</div>` : ''); } });
    s.addEventListener('keydown', e => { if (e.key === 'ArrowDown') { const first = rootEl.querySelector('[data-role="rows"] [data-act="open"]'); if (first) { e.preventDefault(); first.focus(); } } });
  }
  const rows = rootEl && rootEl.querySelector('[data-role="rows"]');
  if (rows) rows.addEventListener('keydown', e => {                       // optional arrow-key walk
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = Array.from(rows.querySelectorAll('[data-act="open"]'));
    const i = items.indexOf(document.activeElement);
    const next = items[i + (e.key === 'ArrowDown' ? 1 : -1)];
    if (next) { e.preventDefault(); next.focus(); }
  });
}
function wireConv() {
  const ta = rootEl && rootEl.querySelector('[data-role="draft"]');
  if (!ta) return;
  // the field grows with what is typed, up to five lines, then scrolls
  const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 2, 132) + 'px'; fitComposer(); };
  grow();
  ta.addEventListener('input', () => {
    grow();
    const k = ta.dataset.key || st.cur; if (k) st.drafts[k] = ta.value;
    if (st.sendError) { st.sendError = null; const e = rootEl.querySelector('[data-role="sendErr"]'); if (e) { e.remove(); fitComposer(); } }
  });
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handlers.send(); }   // Enter sends · Shift+Enter = newline
  });
  const af = rootEl.querySelector('[data-role="attachFile"]');
  // the label is a keyboard stop too: Enter or Space opens the same picker a tap does
  const al = af && af.closest('label');
  if (al) al.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); af.click(); } });
  if (af) af.addEventListener('change', () => {                                       // validate client-side; the backend re-checks
    const f = af.files && af.files[0];
    af.value = '';
    if (!f) return;
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'].includes(f.type)) return ui.toast(COPY.attachBadType, { kind: 'error' });
    if (f.size > 5 * 1024 * 1024) return ui.toast(COPY.attachTooBig, { kind: 'error' });
    st.attach = f;
    renderConv();
  });
}

// ---------------------------------------------------------------- actions
async function openThread(key, { focus = false, mobile = true } = {}) {
  if (st.cur !== key) st.sendError = null;
  st.cur = key;
  if (mobile) st.mobileOpen = true;
  const t = currentThread();
  renderList(); renderConv();
  if (!t) return;
  try {
    const seen = convShown() && !document.hidden;
    if (t.kind !== 'team' && !convShown()) { if (st.cur === key) { st.msgs = []; st.msgsKey = null; } return; }   // a member thread: reading it marks it
    st.msgs = await fetchThreadMessages(t, { mark: seen });
    st.msgsKey = key;
    if (seen) { t.unread = 0; if (t.last && !t.last.mine) t.last.read = true; }
  } catch (e) {
    st.msgs = [];
    st.msgsKey = key;                               // show the thread's empty state, not the loading hairline
    if (e && e.status !== 401) ui.toast(e.message, { kind: 'error' });
  }
  if (st.cur !== key) return;                       // switched while loading
  renderList(); renderConv();
  if (focus) { const ta = rootEl && rootEl.querySelector('[data-role="draft"]'); if (ta) settled().then(() => { if (ta.isConnected && rootEl) ta.focus(); }); }
}

async function refreshThreads() {
  try {
    const r = await api.get('/api/v2/messages/threads');
    if (!st) return;
    D.threads = r.threads || [];
    if (st.msgsKey === st.cur && convShown()) {     // the open thread stays read (while it is on screen)
      const t = currentThread();
      if (t && !document.hidden) t.unread = 0;
    }
    renderList();
  } catch (e) { /* poll errors stay quiet */ }
}

async function poll() {
  if (!st || pollBusy || document.hidden) return;
  pollBusy = true;
  try {
    await refreshThreads();
    const t = currentThread();
    const seen = convShown();
    // a member thread can only be read by marking it — while the phone shows the list, it is left alone
    if (t && !t.virtual && (seen || t.kind === 'team')) {
      const msgs = await fetchThreadMessages(t, { mark: seen });
      if (st && st.cur === t.key) {
        const grew = msgs.length !== (st.msgs || []).length;
        const lastRead = JSON.stringify((st.msgs || []).map(m => m.read)) !== JSON.stringify(msgs.map(m => m.read));
        if (grew || lastRead || st.msgsKey !== t.key) { st.msgs = msgs; st.msgsKey = t.key; renderConv(); }
      }
    }
  } finally { pollBusy = false; }
}

const handlers = {
  // on a phone the inbox and a conversation are two stacked views: opening one is a push, ← INBOX a pop
  // (router.js › step), the way the screens themselves change; on wider screens both panes stay in place
  open: (el) => { const key = el.dataset.key; if (stacked() && !st.mobileOpen) step('forward', () => { openThread(key, { focus: false }); }); else openThread(key, { focus: false }); },
  backList: () => step(stacked() ? 'back' : 'fade', () => { st.mobileOpen = false; const grid = rootEl.querySelector('[data-role="grid"]'); if (grid) grid.classList.remove('mx-msg-open'); renderList(); const first = rootEl.querySelector('[data-role="rows"] [data-act="open"]'); if (first) first.focus({ preventScroll: true }); }),
  retry: () => module.render(rootEl, { params: {}, query: {}, path: '/app/messages' }),
  toggleArchived: () => { st.showArchived = !st.showArchived; renderList(); },
  startMsg: () => { const ta = rootEl.querySelector('[data-role="draft"]'); if (ta) ta.focus(); },
  attachClear: () => { st.attach = null; renderConv(); },
  topic: (el) => {
    st.topic = el.dataset.topic;
    const box = rootEl.querySelector('[data-role="topics"]'); if (!box) return;
    box.outerHTML = topicChips();
    const on = rootEl.querySelector(`[data-role="topics"] [data-topic="${CSS.escape(st.topic)}"]`);
    if (on) on.classList.add('mx-msg-pop');                                              // the picked chip settles in
  },
  // the topic sheet: the seven values as rows; a pick runs the same `topic` handler and closes the sheet
  topicOpen: () => {
    const body = `<div class="mx-list mx-list--plain mx-msg-topics">${COPY.topics.map(([key, label]) => `<span data-act="topic" data-topic="${key}" role="radio" aria-checked="${st.topic === key}" tabindex="0" class="mx-row"><span class="mx-row-l">${esc(topicName(label))}</span>${st.topic === key ? ui.icon('check', 20) : ''}</span>`).join('')}</div>`;
    const m = ui.modal({ eyebrow: '', title: COPY.composer.topicTitle, body });
    ui.bind(m.el, { topic: (el) => { handlers.topic(el); m.close(); } });
  },
  archive: async () => {
    const t = currentThread(); if (!t || t.virtual) return;
    const next = !t.archived;
    try {
      await api.post('/api/v2/messages/threads/' + encodeURIComponent(t.key) + '/archive', { archived: next });
      t.archived = next;
      ui.toast(next ? COPY.archivedToast : COPY.unarchivedToast);
      if (next && !st.showArchived) { st.mobileOpen = false; await openThread(TEAM, { mobile: false }); }
      else { renderList(); renderConv(); }
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  // ⋯ in a member thread header → REPORT the person · BLOCK (a single message is reported from its own ⋯)
  // (on a phone the ⋯ also carries Archive / Restore — the header has no room for the text link beside the name)
  more: (el) => {
    const t = currentThread(); if (!t) return;
    const name = threadName(t);
    const items = [];
    if (stacked() && !t.virtual) items.push({ label: t.archived ? COPY.unarchive : COPY.archive, onPick: () => handlers.archive() });
    if (partnerResolved(t)) items.push(
      { label: SAFETY.menu.report, onPick: () => reportSheet({ kind: 'member', targetId: t.key, name }) },
      { label: SAFETY.menu.block, tone: 'danger', onPick: () => blockThread(t) });
    if (items.length) openMenu(el, items);
  },
  // ⋯ on a received bubble → the report sheet for THAT message
  msgMore: (el) => {
    const t = currentThread(); if (!t || t.kind !== 'member') return;
    const m = (st.msgs || []).find(x => String(x.id) === String(el.dataset.id) && !x.mine);
    if (!m) return;
    reportSheet({ kind: 'message', targetId: m.id, name: threadName(t), excerpt: m.content });
  },
  unblockPeer: async (el) => {
    const t = currentThread(); if (!t || !st.peer) return;
    el.setAttribute('aria-disabled', 'true');
    try {
      await api.del('/api/v2/safety/block/' + encodeURIComponent(st.peer.id));
      forgetBlocks();
      ui.toast(COPY.blockedGate.done(memberName(t)));
      st.peer = await api.get('/api/v2/messages/peer/' + encodeURIComponent(st.peer.id));   // now: not connected → the connect gate
      renderConv();
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  connectPeer: async (el) => {
    if (!st.peer) return;
    el.setAttribute('aria-disabled', 'true');
    try {
      await api.post('/api/networking/connections', { receiver_id: st.peer.id });
      st.peer.pending = 'sent';
      ui.toast(COPY.gate.sent);
      renderConv();
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  send: async () => {
    const t = currentThread(); if (!t || st.sending) return;
    const ta = rootEl.querySelector('[data-role="draft"]');
    const text = ((ta && ta.value) || '').trim();
    const file = t.kind === 'team' ? st.attach : null;                    // attachments ride the team thread only
    if (!text && !file) return ui.toast(COPY.emptyDraft, { kind: 'error' });
    if (t.kind === 'team' && !st.topic) return ui.toast(COPY.pickTopic, { kind: 'error' });
    st.sending = true; st.sendError = null;
    const sendBtn = rootEl.querySelector('[data-act="send"]'); if (sendBtn) sendBtn.setAttribute('aria-disabled', 'true');
    try {
      if (t.kind === 'team') {
        let att = null;
        if (file) { const fd = new FormData(); fd.append('file', file); att = await api.post('/api/v2/messages/attach', fd); }
        await api.post('/api/v2/messages/team', { topic: st.topic, body: text,
          attachment_path: att ? att.attachment_path : undefined,
          attachment_name: att ? att.attachment_name : undefined });
      } else await api.post('/api/messages', { receiver_id: t.key, content: text });
      st.drafts[t.key] = '';
      st.attach = null;
      st.sending = false;
      st.msgs = await fetchThreadMessages(t, { mark: true });
      st.msgsKey = t.key;
      ui.toast(t.kind === 'team' ? COPY.teamSent : COPY.sent);
      await refreshThreads();
      renderConv({ keepDraft: false });
      const ta2 = rootEl.querySelector('[data-role="draft"]'); if (ta2) ta2.focus();
    } catch (e) {
      st.sending = false;
      // 403 (a suspended account · a blocked pair) and 422 (the content filter): the server's own words stay
      // under the composer and the draft stays in the box; anything else is a toast
      if (e && (e.status === 403 || e.status === 422)) st.sendError = { key: t.key, text: e.message };
      renderConv();
      if (!st.sendError) ui.toast(e.message, { kind: 'error' });
      else { const ta2 = rootEl && rootEl.querySelector('[data-role="draft"]'); if (ta2) ta2.focus(); }
    }
  },
  newMsg: () => {
    const myId = String((D.me && D.me.id) || '');
    const conns = (D.conns || []).map(c => {
      const pid = String(c.requester_id) === myId ? c.receiver_id : c.requester_id;
      return { id: pid, name: [c.first_name, c.last_name].filter(Boolean).join(' ') || COPY.unknownMember,
               init: fmt.initials(c.first_name, c.last_name) || 'M', inst: c.institution || '' };
    }).filter(c => c.id && c.id !== myId);
    const row = (act, extra, pic, name, sub) => `
      <div data-act="${act}" ${extra} role="button" tabindex="0" class="mx-msg-pick mx-person-row">
        ${pic}
        <span class="mx-person-text"><span class="mx-msg-pick-name">${esc(name)}</span><span class="mx-person-role">${esc(sub)}</span></span>
      </div>`;
    const body = `
      <div>
        ${row('pickTeam', '', threadPic({ kind: 'team' }, 44), COPY.team.name, COPY.newModal.teamSub)}
        ${conns.length
          ? conns.map(c => row('pickConn', `data-id="${esc(c.id)}"`, ui.portrait({ name: c.name, size: 44, alt: '' }), c.name, c.inst || COPY.memberFallbackSub)).join('')
          : `<p style="margin:14px 0 4px;font-size:14px;color:#4a4239;line-height:1.45">${D.conns ? COPY.newModal.noConns : COPY.newModal.connsFail}</p>
             <div style="padding:10px 0 2px"><a href="/app/network" data-act="closeModal" class="btn-ghost btn-sm mx-msg-btn">${COPY.newModal.openNetworkT}</a></div>`}
      </div>`;
    const m = ui.modal({ eyebrow: '', title: COPY.newModal.title, body });
    ui.bind(m.el, {
      pickTeam: () => { m.close(); openThread(TEAM, { focus: true }); },
      pickConn: (el) => { m.close(); openThread(el.dataset.id, { focus: true }); },
      closeModal: () => { m.close(); router.navigate('/app/network'); }   // the modal's only closeModal control is OPEN THE NETWORK →
    });
  }
};

// after a confirmed block: the thread leaves this inbox (the server hides it from now on), the member leaves
// the NEW MESSAGE picker, and the screen returns to the team thread
async function blockThread(t) {
  const id = t.key;
  const r = await blockFlow({ id, name: threadName(t) });
  if (!r || !st) return;
  const myId = String((D.me && D.me.id) || '');
  D.threads = (D.threads || []).filter(x => x.key !== id);
  D.conns = (D.conns || []).filter(c => (String(c.requester_id) === myId ? c.receiver_id : c.requester_id) !== id);
  if (st.peer && st.peer.id === id) st.peer = null;
  delete st.drafts[id];
  st.mobileOpen = false;
  await openThread(TEAM, { mobile: false });
}

// ---------------------------------------------------------------- module
const module = {
  title: 'Messages',
  async render(root, ctx) {
    rootEl = root;
    if (!document.querySelector('link[data-view-css="messages"]')) {
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/css/views/messages.css'; l.setAttribute('data-view-css', 'messages');
      document.head.appendChild(l);
    }
    ensureSafetyCss();
    D = await load();
    if (rootEl !== root || (ctx.ready && !(await ctx.ready()))) return; // navigated away while loading, or the router moved on
    const q = ctx.query || {};
    // ?topic=<key> (existing) and ?about=<tag> (the MESSAGE US context tag from other pages —
    // gala, plexus, bridges, accelerator, forum) both preselect the team topic
    const topicQ = String(q.topic || q.about || '').toLowerCase();
    st = { cur: TEAM, msgs: [], msgsKey: null, drafts: {}, filter: '',
           topic: COPY.topics.some(t => t[0] === topicQ) ? topicQ : 'general',
           showArchived: false, mobileOpen: false, peer: null, sending: false, attach: null, sendError: null,
           shownKey: null, shownIds: new Set(), dotAt: new Map() };
    root.innerHTML = template();
    unbind = ui.bind(root, handlers);
    if (!D.threads) return;                                   // backend route unavailable — retry UI only
    wireList();
    sizeGrid();                                               // the grid takes its height with the first paint, not after the thread loads

    // entry params: ?to=<userId> opens/creates the 1:1 thread · ?topic= preselects the team tag
    let openKey = TEAM, focus = false, mobile = false;
    const to = String(q.to || '').trim();
    if (to) {
      if (D.threads.some(t => t.key === to)) { openKey = to; focus = true; mobile = true; }
      else {
        try { st.peer = await api.get('/api/v2/messages/peer/' + encodeURIComponent(to)); openKey = to; focus = true; mobile = true; }
        catch (e) { ui.toast(e.message, { kind: 'error' }); }
      }
    } else if (topicQ) { focus = true; mobile = true; }
    await openThread(openKey, { focus, mobile });

    sizeGrid();
    const onResize = () => sizeGrid();
    window.addEventListener('resize', onResize);
    unbindDoc.push(() => window.removeEventListener('resize', onResize));
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', onResize);
      unbindDoc.push(() => window.visualViewport.removeEventListener('resize', onResize));
    }
    if (window.MutationObserver) {
      const mo = new MutationObserver(() => { if (rootEl) sizeGrid(); });
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
      unbindDoc.push(() => mo.disconnect());
    }
    // whatever sits above the grid can still change height after this first measure — the web fonts landing,
    // the chrome's stats strip or email banner arriving — so the grid is re-measured whenever it does
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => { if (rootEl) sizeGrid(); });
      const chromeEl = document.getElementById('chrome'); if (chromeEl) ro.observe(chromeEl);
      root.querySelectorAll('.mx-msg-screen > :not([data-role="grid"])').forEach(el => ro.observe(el));
      unbindDoc.push(() => ro.disconnect());
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (rootEl === root) sizeGrid(); });
    const onVis = () => { if (!document.hidden) poll(); };
    document.addEventListener('visibilitychange', onVis);
    unbindDoc.push(() => document.removeEventListener('visibilitychange', onVis));
    const iv = setInterval(poll, 15000);                       // live updates while the screen is open
    timers.push(() => clearInterval(iv));
  },
  destroy() {
    timers.forEach(stop => { try { stop(); } catch (e) {} }); timers = [];
    unbindDoc.forEach(off => { try { off(); } catch (e) {} }); unbindDoc = [];
    if (unbind) unbind(); unbind = null;
    if (tbProbe) { tbProbe.remove(); tbProbe = null; }
    rootEl = null; D = null; st = null; pollBusy = false;
  }
};
export default module;
