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
import { api } from '../api.js';
import { session } from '../state.js';
import { ui, esc, fmt } from '../ui.js';
import router from '../router.js';

export const SOURCE = 'Messages.dc.html';

export const COPY = {
  crumb: { a: 'NETWORK', b: 'MESSAGES' },
  tabs: { people: 'PEOPLE', messages: 'MESSAGES', card: 'MY CARD' },
  inboxTitle: 'Inbox',
  newMessage: 'NEW MESSAGE →',
  searchPh: 'Search conversations…',
  footer: name => `You're signed in as <strong style="color:#191512">${name}</strong> · replies also arrive by email if you're away.`,
  team: { name: 'Med&X Coordinators', sub: 'Official team inbox', init: 'MX', tag: 'OFFICIAL · MED&amp;X TEAM',
          meta: 'MED&X TEAM',                                        // rows from before sender_name existed (ask 1 backfill)
          staff: name => `${String(name).toUpperCase()} · MED&X`,     // staff identity on replies — "LAURA · MED&X"
          nudge: 'Write to the team — replies land here, not in your email.' },
  composer: { ph: 'Write a message…', attach: 'ATTACH', attachTitle: 'Attach one image or PDF — up to 5 MB', send: 'SEND →', topicLabel: 'TOPIC' },
  // topic keys must match user-portal/backend/v2/messages.js › TOPICS
  topics: [['general', 'GENERAL'], ['plexus', 'PLEXUS'], ['gala', 'GALA'], ['accelerator', 'ACCELERATOR'], ['bridges', 'BUILDING BRIDGES'], ['forum', 'FORUM'], ['membership', 'MEMBERSHIP']],
  empty: {
    line: 'No messages — yet.',
    why: 'Write to the Med&amp;X team about anything — tickets, programs, travel. Replies land right here, not in your email.',
    cta: 'START A MESSAGE →'
  },
  emptyDm: name => `Say hello — this is the start of your conversation with ${name}.`,
  you: 'YOU', read: 'READ', today: 'TODAY', yesterday: 'YESTERDAY',
  back: '← INBOX',
  archive: 'ARCHIVE', unarchive: 'UNARCHIVE',
  archivedToast: 'Conversation archived — it comes back the moment something new arrives.',
  unarchivedToast: 'Conversation restored.',
  archivedTag: 'ARCHIVED',
  showArchived: n => `SHOW ARCHIVED (${n})`, hideArchived: 'HIDE ARCHIVED',
  attachTooBig: 'That file is over 5 MB — pick a smaller one.',
  attachBadType: 'Images (JPG, PNG, WebP, GIF) or PDF only.',
  fileFallback: 'FILE',
  sent: 'Message sent.',
  teamSent: 'Sent to the Med&X team — the reply lands right here.',
  pickTopic: 'Pick a topic for your message.',
  emptyDraft: 'Write a message first.',
  loadFail: 'Your inbox could not be loaded.', retry: 'TRY AGAIN',
  newModal: { eyebrow: 'MESSAGES · NEW', title: 'Who is it for?', teamSub: 'Official team inbox — tickets, programs, travel, anything.', noConns: 'Message your accepted connections — meet people in the Network first.', openNetwork: 'OPEN THE NETWORK →', connsFail: 'Your connections could not be loaded right now.' },
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
let st = null;         // { cur, msgs, msgsKey, drafts, topic, filter, showArchived, mobileOpen, peer, sending, attach }
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
function whenLabel(v) {           // thread list: TODAY · FRI · JUL 28
  const d = sqlDate(v); if (!d) return '';
  const n = daysApart(d);
  if (n <= 0) return COPY.today;
  if (n === 1) return COPY.yesterday;
  if (n < 7) return DAY3[d.getDay()];
  return fmt.shortDate(d);
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
function threadSub(t) { return t.kind === 'team' ? COPY.team.sub : (t.institution || COPY.memberFallbackSub); }
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
  <div class="mx-gutter" style="display:flex;align-items:center;gap:13px;padding:10px 36px;border-bottom:1px solid rgba(25,21,18,.16)">
    <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#4a4239">${COPY.crumb.a}</span>
    <span style="color:rgba(25,21,18,.35);font-size:10px">→</span>
    <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#191512">${COPY.crumb.b}</span>
  </div>
  <!-- /dc -->`; }

function blockTabs() { return `
  <!-- dc: Messages.dc.html › "Network tabs" -->
  <div class="mx-gutter" style="display:flex;align-items:center;justify-content:center;gap:26px;padding:13px 36px;border-bottom:1px solid rgba(25,21,18,.16);flex-wrap:wrap">
    <a href="/app/network" style="font:600 10px Inter,sans-serif;letter-spacing:.15em;color:#4a4239" data-hover="color:#191512">${COPY.tabs.people}</a>
    <span style="font:600 10px Inter,sans-serif;letter-spacing:.15em;color:#9b1b22;border-bottom:2px solid #9b1b22;padding-bottom:3px;cursor:default">${COPY.tabs.messages}</span>
    <a href="/app/me" style="font:600 10px Inter,sans-serif;letter-spacing:.15em;color:#4a4239" data-hover="color:#191512">${COPY.tabs.card}</a>
  </div>
  <!-- /dc -->`; }

function threadRow(t, i) {
  const cur = t.key === st.cur;
  const unread = t.unread > 0 && !cur;
  const av = avatarOf(t);
  const when = t.archived ? `<span style="color:#6e5626">${COPY.archivedTag}</span>` : esc(whenLabel(t.last && t.last.created_at));
  return `
      <div data-act="open" data-key="${esc(t.key)}" role="listitem" aria-current="${cur}" style="display:flex;gap:13px;align-items:flex-start;padding:14px 22px;cursor:pointer;border-top:1px solid rgba(25,21,18,.1);background:${cur ? 'rgba(201,169,98,.12)' : 'transparent'};border-left:2px solid ${cur ? '#c9a962' : 'transparent'}" data-hover="background:rgba(25,21,18,.04)">
        <span style="width:36px;height:36px;background:${av.bg};color:${av.fg};display:inline-flex;align-items:center;justify-content:center;font:600 12px Fraunces,serif;flex:none">${esc(threadInit(t))}</span>
        <span style="flex:1;min-width:0">
          <span style="display:flex;align-items:baseline;gap:8px">
            <span style="font-size:13px;font-weight:600;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(threadName(t))}</span>
            <span style="font:600 9px Inter,sans-serif;letter-spacing:.1em;color:#4a4239;flex:none">${when}</span>
          </span>
          <span style="display:block;font-size:11px;color:#4a4239;margin-top:2px">${esc(threadSub(t))}</span>
          <span style="display:block;font-size:12px;color:${unread ? '#191512' : '#4a4239'};margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:${unread ? '600' : '400'}">${esc(previewOf(t))}</span>
        </span>
        ${unread ? '<span style="width:7px;height:7px;background:#9b1b22;flex:none;margin-top:5px"></span>' : ''}
      </div>`;
}

function blockList() {
  const rows = visibleThreads();
  const archivedCount = allThreads().filter(t => t.archived).length;
  return `
  <!-- dc: Messages.dc.html › "Inbox" -->
  <div class="mx-msg-list" style="border-right:1px solid rgba(25,21,18,.16);display:flex;flex-direction:column;min-height:0">
    <div style="display:flex;align-items:center;gap:12px;padding:16px 22px 12px">
      <span style="font-family:Fraunces,serif;font-size:22px">${COPY.inboxTitle}</span>
      <div style="flex:1"></div>
      <span data-act="newMsg" style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#9b1b22;cursor:pointer;white-space:nowrap">${COPY.newMessage}</span>
    </div>
    <div style="padding:0 22px 12px">
      <input data-role="search" type="search" placeholder="${COPY.searchPh}" value="${esc(st.filter || '')}" aria-label="Search conversations" style="width:100%;box-sizing:border-box;border:1px solid rgba(25,21,18,.25);background:#fdfaf3;padding:9px 12px;font-size:12.5px;color:#191512">
    </div>
    <div data-role="rows" data-v2="scrolling thread list (replaces the artboard's flex spacer)" role="list" aria-label="Conversations" style="flex:1;overflow-y:auto;min-height:0">
      ${rows.map((t, i) => threadRow(t, i)).join('')}
      ${!rows.length ? `<div style="padding:18px 22px;font-size:12px;color:#4a4239;border-top:1px solid rgba(25,21,18,.1)">${st.filter ? 'Nothing matches your search.' : 'No conversations yet.'}</div>` : ''}
      ${archivedCount ? `<div data-v2="archived toggle" style="padding:12px 22px;border-top:1px solid rgba(25,21,18,.1)"><span data-act="toggleArchived" style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:#6e5626;cursor:pointer">${st.showArchived ? COPY.hideArchived : COPY.showArchived(archivedCount)}</span></div>` : ''}
    </div>
    <div style="padding:14px 22px;border-top:1px solid rgba(25,21,18,.16);font-size:11px;color:#4a4239;line-height:1.5">${COPY.footer(esc(session.displayName()))}</div>
  </div>
  <!-- /dc -->`;
}

function dayDivider(label) { return `
        <div data-v2="day divider" style="display:flex;align-items:center;gap:10px;margin:2px 0">
          <span style="flex:1;height:1px;background:rgba(25,21,18,.1)"></span>
          <span style="font:600 8.5px Inter,sans-serif;letter-spacing:.16em;color:#9b8f80">${esc(label)}</span>
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
  return `${img}<a href="${esc(url)}" target="_blank" rel="noopener" data-v2="attachment download (served with Content-Disposition: attachment)" style="display:inline-flex;align-items:center;gap:6px;margin-top:8px;padding:6px 10px;border:1px solid ${bd};font:600 9px Inter,sans-serif;letter-spacing:.12em;color:inherit;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">\u2295 ${esc(name)}</a>`;
}
function bubble(m, meta, thread) {
  const mine = !!m.mine;
  const side = mine ? 'flex-end' : 'flex-start';
  const bg = mine ? '#191512' : '#f7f1e6';
  const fg = mine ? '#f7f1e6' : '#191512';
  const bd = mine ? '#191512' : 'rgba(25,21,18,.2)';
  const title = (!mine && m.title && thread.kind === 'team') ? `<strong style="display:block;margin-bottom:4px">${esc(m.title)}</strong>` : '';
  return `
        <div style="display:flex;flex-direction:column;gap:4px;align-self:${side};max-width:62%;align-items:${side}">
          <span style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:#4a4239">${esc(meta)}</span>
          <span style="padding:12px 15px;font-size:13px;line-height:1.55;background:${bg};color:${fg};border:1px solid ${bd};white-space:pre-wrap;word-break:break-word">${title}${esc(m.content)}${bubbleAttachment(m, mine)}</span>
        </div>`;
}

function convMessages(thread) {
  const msgs = st.msgs || [];
  if (!msgs.length) {
    if (thread.kind === 'team') return `
        <!-- dc: Empty States.dc.html › "MESSAGES · EMPTY INBOX" -->
        <div class="empty" style="margin:auto">
          <span style="width:28px;height:1px;background:#c9a962;margin-bottom:6px"></span>
          <span style="font-family:Fraunces,serif;font-style:italic;font-size:17px">${COPY.empty.line}</span>
          <span style="font-size:12.5px;color:#4a4239;max-width:400px;line-height:1.55">${COPY.empty.why}</span>
          <span data-act="startMsg" style="margin-top:8px;padding:11px 20px;background:#9b1b22;color:#f7f1e6;font:600 10px Inter,sans-serif;letter-spacing:.16em;cursor:pointer">${COPY.empty.cta}</span>
        </div>
        <!-- /dc -->`;
    if (thread.virtual && st.peer && !st.peer.connected) return `
        <div class="empty" style="margin:auto" data-v2="connection gate (POST /api/messages requires an accepted connection)">
          <span style="width:28px;height:1px;background:#c9a962;margin-bottom:6px"></span>
          <span style="font-family:Fraunces,serif;font-style:italic;font-size:17px">${esc(COPY.gate.line(memberName(thread)))}</span>
          <span style="font-size:12.5px;color:#4a4239;max-width:400px;line-height:1.55">${st.peer.pending === 'received' ? esc(COPY.gate.pendingIn(threadName(thread))) : COPY.gate.why}</span>
          ${st.peer.pending ? (st.peer.pending === 'received'
            ? `<a href="/app/network" style="margin-top:8px;padding:11px 20px;background:#9b1b22;color:#f7f1e6;font:600 10px Inter,sans-serif;letter-spacing:.16em">${COPY.gate.openNet}</a>`
            : `<span style="margin-top:8px;padding:11px 20px;border:1px solid rgba(25,21,18,.3);color:#4a4239;font:600 10px Inter,sans-serif;letter-spacing:.16em">${COPY.gate.pending}</span>`)
            : `<span data-act="connectPeer" style="margin-top:8px;padding:11px 20px;background:#9b1b22;color:#f7f1e6;font:600 10px Inter,sans-serif;letter-spacing:.16em;cursor:pointer">${COPY.gate.cta}</span>`}
        </div>`;
    return `<div class="empty" style="margin:auto" data-v2="empty 1:1 thread"><span style="font-family:Fraunces,serif;font-style:italic;font-size:15px;color:#4a4239">${esc(COPY.emptyDm(memberName(thread)))}</span></div>`;
  }
  const out = [];
  let lastDay = null;
  let lastReadMine = null;
  msgs.forEach(m => { if (m.mine && m.read) lastReadMine = m; });
  msgs.forEach(m => {
    const d = sqlDate(m.created_at);
    const dk = d ? d.toDateString() : '';
    if (dk !== lastDay) { out.push(dayDivider(dayLabel(d))); lastDay = dk; }
    const who = m.mine ? COPY.you
      : (thread.kind === 'team' ? (m.sender_name ? COPY.team.staff(m.sender_name) : COPY.team.meta) : memberName(thread).toUpperCase());
    let meta = who + ' · ' + timeLabel(m.created_at);
    if (m.mine && m.topic) { const t = COPY.topics.find(x => x[0] === m.topic); if (t) meta += ' · ' + t[1]; }
    if (lastReadMine && m.id === lastReadMine.id) meta += ' · ' + COPY.read;
    out.push(bubble(m, meta, thread));
  });
  return out.join('');
}

function topicChips() {
  return `
    <div data-v2="topic picker (team messages carry a topic — admin README note 24)" data-role="topics" style="border-top:1px solid rgba(25,21,18,.16);padding:12px 26px 0;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
      <span style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:#4a4239;margin-right:2px">${COPY.composer.topicLabel}</span>
      ${COPY.topics.map(([key, label]) => `<span data-act="topic" data-topic="${key}" class="chip${st.topic === key ? ' on' : ''}" role="radio" aria-checked="${st.topic === key}">${label}</span>`).join('')}
    </div>`;
}

function blockConv() {
  const t = currentThread();
  if (!t) return `<div class="mx-msg-conv" style="display:flex;flex-direction:column;background:#fdfaf3;min-height:0"></div>`;
  const av = avatarOf(t);
  const isTeam = t.kind === 'team';
  const canWrite = isTeam || !t.virtual || (st.peer && st.peer.connected);
  const attachChip = (isTeam && st.attach) ? `
    <div data-v2="pending attachment — uploads on SEND via POST /api/v2/messages/attach" style="display:flex;align-items:center;gap:10px;padding:10px 26px 0">
      <span style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#6e5626;background:rgba(201,169,98,.18);padding:5px 10px;max-width:70%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">\u2295 ${esc(st.attach.name)}</span>
      <span data-act="attachClear" role="button" aria-label="Remove attachment" style="font:600 11px Inter,sans-serif;color:#4a4239;cursor:pointer" data-hover="color:#9b1b22">\u2715</span>
    </div>` : '';
  return `
  <!-- dc: Messages.dc.html › "Conversation" -->
  <div class="mx-msg-conv" style="display:flex;flex-direction:column;background:#fdfaf3;min-height:0">
    <div style="display:flex;align-items:center;gap:13px;padding:14px 26px;border-bottom:1px solid rgba(25,21,18,.16)">
      <span data-act="backList" class="mx-msg-back" data-v2="mobile back to list" aria-label="Back to inbox" style="font:600 9.5px Inter,sans-serif;letter-spacing:.14em;color:#9b1b22;cursor:pointer;white-space:nowrap;align-items:center">${COPY.back}</span>
      <span style="width:34px;height:34px;background:${av.bg};color:${av.fg};display:inline-flex;align-items:center;justify-content:center;font:600 12px Fraunces,serif">${esc(threadInit(t))}</span>
      <span style="display:flex;flex-direction:column;line-height:1.3;min-width:0">
        <span style="font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(threadName(t))}</span>
        <span style="font-size:11px;color:#4a4239;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(threadSub(t))}</span>
      </span>
      <div style="flex:1"></div>
      ${isTeam ? `<span style="padding:3px 9px;border:1px solid rgba(201,169,98,.65);color:#6e5626;font:600 9px Inter,sans-serif;letter-spacing:.14em;white-space:nowrap">${COPY.team.tag}</span>` : ''}
      ${t.virtual ? '' : `<span data-act="archive" data-v2="archive = hide, never delete" style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:#4a4239;cursor:pointer;white-space:nowrap" data-hover="color:#191512">${t.archived ? COPY.unarchive : COPY.archive}</span>`}
    </div>
    <div data-role="msgs" aria-live="polite" style="flex:1;padding:22px 26px;display:flex;flex-direction:column;gap:14px;overflow-y:auto">${convMessages(t)}</div>
    ${canWrite ? `${isTeam ? topicChips() : ''}${attachChip}
    <div style="display:flex;gap:12px;align-items:flex-end;padding:16px 26px 20px;${isTeam ? '' : 'border-top:1px solid rgba(25,21,18,.16)'}">
      <textarea data-role="draft" placeholder="${COPY.composer.ph}" rows="2" aria-label="${COPY.composer.ph}" style="flex:1;border:1px solid rgba(25,21,18,.25);background:#f7f1e6;padding:11px 13px;font-size:13px;color:#191512;resize:none">${esc(st.drafts[t.key] || '')}</textarea>
      ${isTeam ? `<label data-v2="ONE image/PDF per message — label wraps the hidden input so the OS picker opens without ui.bind's preventDefault (the profile-photo trap)" title="${COPY.composer.attachTitle}" style="font:600 9.5px Inter,sans-serif;letter-spacing:.14em;color:#4a4239;cursor:pointer;padding-bottom:12px" data-hover="color:#191512">${COPY.composer.attach}<input type="file" data-role="attachFile" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf" style="display:none"></label>` : ''}
      <span data-act="send" role="button" aria-label="Send message" ${st.sending ? 'aria-disabled="true"' : ''} style="padding:12px 18px;background:#9b1b22;color:#f7f1e6;font:600 10px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;white-space:nowrap" data-hover="background:#7e151b">${COPY.composer.send}</span>
    </div>` : ''}
  </div>
  <!-- /dc -->`;
}

function template() {
  if (!D || !D.threads) return `
<div data-screen-label="Messages" style="font-family:Inter,sans-serif;color:#191512;background:#f7f1e6;min-height:100vh">
  ${blockCrumb()}
  ${blockTabs()}
  <div class="empty" style="padding:64px 22px" data-v2="inbox unavailable">
    <span style="width:28px;height:1px;background:#c9a962;margin-bottom:6px"></span>
    <span style="font-family:Fraunces,serif;font-style:italic;font-size:17px">${COPY.loadFail}</span>
    <span data-act="retry" style="margin-top:8px;padding:11px 20px;border:1px solid rgba(25,21,18,.3);color:#191512;font:600 10px Inter,sans-serif;letter-spacing:.16em;cursor:pointer">${COPY.retry}</span>
  </div>
</div>`;
  return `
<div data-screen-label="Messages" style="font-family:Inter,sans-serif;color:#191512;background:#f7f1e6;min-height:100vh;display:flex;flex-direction:column">
  ${blockCrumb()}
  ${blockTabs()}
  <div data-role="grid" class="mx-msg-grid${st.mobileOpen ? ' mx-msg-open' : ''}" style="display:grid;grid-template-columns:340px 1fr;align-items:stretch;min-height:560px">
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
  const ta = rootEl && rootEl.querySelector('[data-role="draft"]');
  if (keepDraft && ta && st.cur) st.drafts[st.cur] = ta.value;
  rr('.mx-msg-conv', blockConv());
  const grid = rootEl && rootEl.querySelector('[data-role="grid"]');
  if (grid) grid.classList.toggle('mx-msg-open', !!st.mobileOpen);
  wireConv();
  scrollMsgs();
}
function scrollMsgs() { const m = rootEl && rootEl.querySelector('[data-role="msgs"]'); if (m) m.scrollTop = m.scrollHeight; }
function sizeGrid() {
  const g = rootEl && rootEl.querySelector('[data-role="grid"]'); if (!g) return;
  const tab = document.getElementById('mx-tabbar');
  const tabH = tab && getComputedStyle(tab).display !== 'none' ? tab.offsetHeight : 0;
  const small = window.matchMedia('(max-width: 700px)').matches;
  const h = Math.max(small ? 430 : 560, window.innerHeight - g.getBoundingClientRect().top - tabH);
  g.style.height = h + 'px';
}

function wireList() {
  const s = rootEl && rootEl.querySelector('[data-role="search"]');
  if (s) {
    s.addEventListener('input', () => { st.filter = s.value; const rows = rootEl.querySelector('[data-role="rows"]'); if (rows) { const keep = visibleThreads(); rows.innerHTML = keep.map((t, i) => threadRow(t, i)).join('') + (!keep.length ? `<div style="padding:18px 22px;font-size:12px;color:#4a4239;border-top:1px solid rgba(25,21,18,.1)">Nothing matches your search.</div>` : ''); } });
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
  ta.addEventListener('input', () => { if (st.cur) st.drafts[st.cur] = ta.value; });
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handlers.send(); }   // Enter sends · Shift+Enter = newline
  });
  const af = rootEl.querySelector('[data-role="attachFile"]');
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
  st.cur = key;
  if (mobile) st.mobileOpen = true;
  const t = currentThread();
  renderList(); renderConv();
  if (!t) return;
  try {
    st.msgs = await fetchThreadMessages(t, { mark: !document.hidden });
    st.msgsKey = key;
    t.unread = 0;
    if (t.last && !t.last.mine) t.last.read = true;
  } catch (e) {
    st.msgs = [];
    if (e && e.status !== 401) ui.toast(e.message, { kind: 'error' });
  }
  if (st.cur !== key) return;                       // switched while loading
  renderList(); renderConv();
  if (focus) { const ta = rootEl && rootEl.querySelector('[data-role="draft"]'); if (ta) ta.focus(); }
}

async function refreshThreads() {
  try {
    const r = await api.get('/api/v2/messages/threads');
    if (!st) return;
    D.threads = r.threads || [];
    if (st.msgsKey === st.cur) {                    // the open thread stays read
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
    if (t && !t.virtual) {
      const msgs = await fetchThreadMessages(t, { mark: true });
      if (st && st.cur === t.key) {
        const grew = msgs.length !== (st.msgs || []).length;
        const lastRead = JSON.stringify((st.msgs || []).map(m => m.read)) !== JSON.stringify(msgs.map(m => m.read));
        if (grew || lastRead) { st.msgs = msgs; renderConv(); }
      }
    }
  } finally { pollBusy = false; }
}

const handlers = {
  open: (el) => openThread(el.dataset.key, { focus: false }),
  backList: () => { st.mobileOpen = false; const grid = rootEl.querySelector('[data-role="grid"]'); if (grid) grid.classList.remove('mx-msg-open'); renderList(); const first = rootEl.querySelector('[data-role="rows"] [data-act="open"]'); if (first) first.focus(); },
  retry: () => module.render(rootEl, { params: {}, query: {}, path: '/app/messages' }),
  toggleArchived: () => { st.showArchived = !st.showArchived; renderList(); },
  startMsg: () => { const ta = rootEl.querySelector('[data-role="draft"]'); if (ta) ta.focus(); },
  attachClear: () => { st.attach = null; renderConv(); },
  topic: (el) => { st.topic = el.dataset.topic; const box = rootEl.querySelector('[data-role="topics"]'); if (box) { box.outerHTML = topicChips(); } },
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
    st.sending = true;
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
      renderConv();
      ui.toast(e.message, { kind: 'error' });
    }
  },
  newMsg: () => {
    const myId = String((D.me && D.me.id) || '');
    const conns = (D.conns || []).map(c => {
      const pid = String(c.requester_id) === myId ? c.receiver_id : c.requester_id;
      return { id: pid, name: [c.first_name, c.last_name].filter(Boolean).join(' ') || COPY.unknownMember,
               init: fmt.initials(c.first_name, c.last_name) || 'M', inst: c.institution || '' };
    }).filter(c => c.id && c.id !== myId);
    const row = (act, extra, avBg, avFg, init, name, sub) => `
      <div data-act="${act}" ${extra} role="button" tabindex="0" style="display:flex;gap:12px;align-items:center;padding:11px 2px;border-bottom:1px solid rgba(25,21,18,.1);cursor:pointer">
        <span style="width:32px;height:32px;background:${avBg};color:${avFg};display:inline-flex;align-items:center;justify-content:center;font:600 11px Fraunces,serif;flex:none">${esc(init)}</span>
        <span style="min-width:0"><span style="display:block;font-size:13px;font-weight:600;color:#191512">${esc(name)}</span><span style="display:block;font-size:11px;color:#4a4239">${esc(sub)}</span></span>
      </div>`;
    const body = `
      <div>
        ${row('pickTeam', '', AV_TEAM.bg, AV_TEAM.fg, COPY.team.init, COPY.team.name, COPY.newModal.teamSub)}
        ${conns.length
          ? conns.map((c, i) => row('pickConn', `data-id="${esc(c.id)}"`, AV_MEMBER[i % 2].bg, AV_MEMBER[i % 2].fg, c.init, c.name, c.inst || COPY.memberFallbackSub)).join('')
          : `<div style="padding:14px 2px 4px;font-size:12.5px;color:#4a4239;line-height:1.55">${D.conns ? COPY.newModal.noConns : COPY.newModal.connsFail}</div>
             <div style="padding:10px 2px 2px"><a href="/app/network" data-act="closeModal" style="display:inline-block;padding:10px 16px;border:1px solid rgba(25,21,18,.35);font:600 9.5px Inter,sans-serif;letter-spacing:.15em;color:#191512">${COPY.newModal.openNetwork}</a></div>`}
      </div>`;
    const m = ui.modal({ eyebrow: COPY.newModal.eyebrow, title: COPY.newModal.title, body });
    ui.bind(m.el, {
      pickTeam: () => { m.close(); openThread(TEAM, { focus: true }); },
      pickConn: (el) => { m.close(); openThread(el.dataset.id, { focus: true }); },
      closeModal: () => m.close()
    });
  }
};

// ---------------------------------------------------------------- module
const module = {
  title: 'Messages',
  async render(root, ctx) {
    rootEl = root;
    if (!document.querySelector('link[data-view-css="messages"]')) {
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/css/views/messages.css'; l.setAttribute('data-view-css', 'messages');
      document.head.appendChild(l);
    }
    D = await load();
    if (rootEl !== root) return;
    const q = ctx.query || {};
    // ?topic=<key> (existing) and ?about=<tag> (the MESSAGE US context tag from other pages —
    // gala, plexus, bridges, accelerator, forum) both preselect the team topic
    const topicQ = String(q.topic || q.about || '').toLowerCase();
    st = { cur: TEAM, msgs: [], msgsKey: null, drafts: {}, filter: '',
           topic: COPY.topics.some(t => t[0] === topicQ) ? topicQ : 'general',
           showArchived: false, mobileOpen: false, peer: null, sending: false, attach: null };
    root.innerHTML = template();
    unbind = ui.bind(root, handlers);
    if (!D.threads) return;                                   // backend route unavailable — retry UI only
    wireList();

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
    rootEl = null; D = null; st = null; pollBusy = false;
  }
};
export default module;
