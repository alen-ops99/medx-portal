// Source: Admin Inbox.dc.html — the approval-outbox spine (README notes 2 + 24).
// Blocks (artboard order): "Inbox title row" › "Tabs" › EMAIL & OUTBOX ("WAITING FOR YOUR OK" ·
// "EMAIL EVERYONE REGISTERED" + "HOW IT WILL LOOK") › MEMBER MESSAGES (threads · conversation) ›
// ANNOUNCEMENTS (composer · bell preview · "RECENT ANNOUNCEMENTS") › NEWSLETTER ("SUBSCRIBERS" ·
// "DRAFTS & HISTORY" · "WRITE THE NEWSLETTER") › TEAM CHAT ("CHANNELS" · channel pane).
// The header is js/chrome.js; the TEAM CHAT header pill lands on /inbox/chat.
//
// Every email path goes THROUGH the outbox: the composer and the newsletter stage
// pending_approval batches (/api/v2/inbox/*), and the only human click that releases them is
// POST /api/admin/outbox/:batch/approve — the existing drainer delivers. Announcements write
// user_notifications via the existing admin route (the member bell). Team chat is the existing
// /api/teamchat surface (channels · reply-to · attachments · meeting polls → outbox invites).
// MEMBER MESSAGES (team review Aug 2026): replies go through POST /api/v2/inbox/threads/:key/reply
// so the row carries sender_name — members see "LAURA · MED&X" ("MED&X TEAM" on older rows); the
// SAVED REPLIES picker manages v2_canned_replies via /api/v2/inbox/canned; ONE image/PDF ≤ 5 MB
// per message uploads through POST /api/v2/messages/attach (thread reading stays the existing
// GET /api/admin/messages/:key, which marks inbound read).
// UX audit 2026-09-02 (#4 + #6): the MEMBER MESSAGES tab badge counts threads WAITING ON A REPLY
// (GET /api/v2/inbox/needs-reply — unread alone missed guests whose thread was opened but never
// answered); a broken attachment thumbnail hides itself and leaves the labelled chip; Enter in the
// member reply box is a NEWLINE — only the SEND button sends. Weekly pulses get DISCARD ALL n
// (confirm first, pending batches only — the same /cancel the per-row DISCARD uses, so approved
// and sent history is never touched) plus an age flag on stale rows.
import { api } from '../api.js';
import { session } from '../state.js';
import { ui, esc, fmt } from '../ui.js';
import { FACTS } from '../facts.js';
import { chrome } from '../chrome.js';
import router from '../router.js';

export const SOURCE = 'Admin Inbox.dc.html';

export const COPY = {
  title: 'Inbox',
  sub: 'every way you reach members and guests — emails wait for your OK before they send',
  tabs: { outbox: 'EMAIL & OUTBOX', messages: 'MEMBER MESSAGES', announce: 'ANNOUNCEMENTS', news: 'NEWSLETTER', chat: 'TEAM CHAT' },
  outbox: {
    waiting: 'WAITING FOR YOUR OK', waitingSub: 'the portal never emails anyone on its own — every batch stops here first',
    empty: 'Outbox is clear — nothing waiting to send.',
    approve: 'APPROVE & SEND', later: 'SEND LATER', discard: 'DISCARD', sureDiscard: 'SURE? DISCARD',
    approveAll: (n) => `APPROVE ALL ${n} →`, cancel: 'CANCEL',
    // bulk discard for piled-up weekly pulses (UX audit #6) — pending drafts only, never history
    discardAll: (n) => `DISCARD ALL ${n}`,
    discardAllEyebrow: 'EMAIL & OUTBOX · WEEKLY PULSES',
    discardAllTitle: 'Discard the waiting weekly pulses?',
    discardAllBody: (n) => `Discards ${n} stale draft${n === 1 ? '' : 's'} — nothing is sent. Everything already approved or sent stays exactly as it is.`,
    discardAllCancel: 'KEEP THEM',
    discardedAll: (n) => `DISCARDED ${n} DRAFT${n === 1 ? '' : 'S'} — NOTHING WAS SENT`,
    weeksOld: (w) => w === 1 ? '1 WEEK OLD' : `${w} WEEKS OLD`,
    sends: (label) => `SENDS ${label}`,
    kinds: { pulse: 'WEEKLY PULSES — ROUTINE', guest: 'GUEST & MEMBER MESSAGES', survey: 'SURVEYS & FOLLOW-UPS', newsletter: 'NEWSLETTERS', other: 'ONE-OFF EMAILS' },
    to: (to, n) => `to ${to}${n > 1 ? ` +${n - 1} more` : ''}`,
    sent: (n) => `SENT TO ${n} RECIPIENT${n === 1 ? '' : 'S'} — DELIVERING NOW`,
    sentAll: (b, n) => `SENT ${b} BATCHES · ${n} RECIPIENTS — DELIVERING NOW`,
    discarded: 'DISCARDED — NOTHING WAS SENT',
    scheduled: 'SCHEDULED — SENDS TOMORROW 09:00',
    backToWaiting: 'BACK IN THE WAITING LIST — NOTHING WAS SENT',
    previewTitle: 'Click a row to preview the exact email and its recipients',
    recipients: 'RECIPIENTS', edit: 'EDIT', close: '✕ CLOSE', saveEdit: 'SAVE CHANGES', edited: 'BATCH UPDATED — STILL WAITING FOR YOUR OK'
  },
  compose: {
    title: 'EMAIL EVERYONE REGISTERED', who: 'WHO', filter: 'ONLY THOSE WHO…',
    filters: [['', 'No filter — everyone'], ['unpaid', 'Haven’t paid yet'], ['checked_in', 'Are checked in'], ['not_checked_in', 'Are not checked in']],
    manual: '✓ PICK PEOPLE BY HAND', manualOff: 'or tick exactly who gets it, person by person',
    manualOn: (p, t) => `${p} of ${t} picked by hand — ticks override the dropdowns`,
    subject: 'SUBJECT', subjectPh: 'e.g. Plexus 2026 — final details',
    message: 'MESSAGE', messagePh: 'Plain text. Each empty line starts a new paragraph. Every recipient is greeted by their own first name automatically.',
    queue: 'PUT IN OUTBOX', test: 'SEND A TEST TO MYSELF',
    note: (n) => `${n} recipient${n === 1 ? '' : 's'} after filters · test rows excluded`,
    noteManual: (n) => `${n} hand-picked recipient${n === 1 ? '' : 's'} · test rows excluded`,
    queued: 'QUEUED — WAITING FOR YOUR OK ABOVE', writeFirst: 'WRITE A SUBJECT OR MESSAGE FIRST',
    testSent: (to) => `TEST SENT TO ${to.toUpperCase()}`,
    how: 'HOW IT WILL LOOK', previewEmpty: 'Start typing the message to see it rendered here…',
    greetNote: 'Each recipient is greeted with their own first name.',
    replyNote: 'Test rows are excluded automatically. Replies go to your Med&X address.'
  },
  messages: {
    needsReply: 'NEEDS A REPLY', all: 'ALL', archived: 'ARCHIVED',
    empty: { line: 'No member messages yet.', why: 'When a member writes from their portal, the thread lands here with its topic — and your reply lands back in their portal inbox.' },
    none: 'Nothing needs a reply — switch to ALL to browse every thread.',
    markRead: 'MARK READ', markUnread: 'MARK UNREAD', archive: 'ARCHIVE', unarchive: 'UNARCHIVE',
    viewPerson: 'VIEW PERSON →', replyPh: 'Write your reply — nothing goes out until you click SEND…', send: 'SEND',
    badgeTitle: (n) => `${fmt.plural(n, 'member thread')} waiting for a reply`,
    sentToast: 'REPLY SENT — LANDS IN THEIR PORTAL INBOX',
    archivedToast: 'THREAD ARCHIVED — HIDDEN, NEVER DELETED', unarchivedToast: 'THREAD IS BACK IN THE LIST',
    // staff identity on replies (team review ask 1) — members see the same attribution
    teamFallback: 'MED&X TEAM',                                       // rows from before sender_name existed
    staffTag: name => `${String(name).toUpperCase()} · MED&X`,
    identityNote: name => `Replying as ${name} · Med&X — members see your name on this reply.`,
    // SAVED REPLIES picker (team review ask 2)
    saved: 'SAVED REPLIES', savedTitle: 'Saved replies', savedEyebrow: 'MEMBER MESSAGES · SAVED REPLIES',
    savedSub: 'Click one to drop it into the reply box — {first_name} becomes the member’s first name.',
    savedUse: 'USE', savedEdit: 'EDIT', savedDel: 'DELETE', savedSureDel: 'SURE?',
    savedNew: '+ NEW SAVED REPLY', savedSave: 'SAVE', savedCancel: 'CANCEL',
    savedTitlePh: 'e.g. Dietary requirements',
    savedBodyPh: 'The reply text — {first_name} becomes the member’s first name.',
    savedEmpty: 'No saved replies yet — add the first one.',
    savedSaved: 'SAVED REPLY STORED', savedDeleted: 'SAVED REPLY DELETED',
    // ONE attachment per message (team review ask 4)
    attachTitle: 'Attach one image or PDF — up to 5 MB',
    attachTooBig: 'THAT FILE IS OVER 5 MB', attachBadType: 'IMAGES (JPG, PNG, WEBP, GIF) OR PDF ONLY',
    file: 'FILE'
  },
  announce: {
    title: 'POST TO MEMBERS’ NOTIFICATION BELL', who: 'WHO SHOULD SEE THIS?',
    audiences: [['all', 'Everyone'], ['plexus', 'Plexus followers'], ['gala', 'Gala guests'], ['accelerator', 'Accelerator followers'], ['forum', 'Forum members'], ['bridges', 'Building Bridges followers']],
    t: 'TITLE', tPh: 'e.g. Gala early-bird ends September 15', m: 'MESSAGE', mPh: 'Write the details members should read.',
    link: 'LINK (OPTIONAL)', linkPh: 'e.g. the Gala page', until: 'SHOW UNTIL',
    untils: [['', 'Removed by hand'], ['7', 'One week'], ['14', 'Two weeks'], ['event', 'The event date']],
    push: 'Also send a push notification to followers’ phones',
    publish: 'PUBLISH ANNOUNCEMENT', published: 'PUBLISHED TO THE MEMBER BELL', titleFirst: 'GIVE THE ANNOUNCEMENT A TITLE FIRST',
    howTitle: 'HOW MEMBERS SEE IT — THE BELL, TOP RIGHT OF THEIR PORTAL', bell: 'NOTIFICATIONS', oneNew: '1 new',
    prevTitle: 'No title yet — this preview updates as you type.', prevBody: 'No message yet — members will see exactly what you write here.',
    justNow: (aud) => `JUST NOW · ${aud.toUpperCase()}`, alsoInbox: 'It also lands in their Messages, so nothing disappears.',
    recent: 'RECENT ANNOUNCEMENTS', remove: 'REMOVE', sureRemove: 'SURE? REMOVE', removed: 'ANNOUNCEMENT REMOVED FROM THE BELL',
    recentEmpty: 'Nothing published yet — the first announcement shows here.'
  },
  news: {
    subs: 'SUBSCRIBERS', subsSub: 'people pick topics when they subscribe',
    newBtn: '+ NEW NEWSLETTER', anyone: 'Anyone can subscribe from the portal home or medx.hr.',
    drafts: 'DRAFTS & HISTORY', nothing: 'Nothing sent yet — the first newsletter is ready when you are.',
    edit: 'EDIT', inOutbox: 'IN OUTBOX →',
    stateWaiting: (n) => `Waiting for your OK · ${n} email${n === 1 ? '' : 's'}`,
    stateScheduled: 'Approved — on its way', stateSent: (n) => `Sent · ${n} email${n === 1 ? '' : 's'}`, stateCancelled: 'Discarded',
    portalPosted: '· posted in the portal', portalPending: '· portal post waits for the OK',
    write: 'WRITE THE NEWSLETTER', closeBtn: '✕ CLOSE',
    subject: 'SUBJECT', subjectPh: 'e.g. Med&X in September — Boston, early birds, new faces',
    to: 'TO', message: 'MESSAGE', messagePh: 'Same plain-text rules as emails — the branded header and footer are added automatically.',
    asEmail: 'Send as email', asPortal: 'Post in the member portal', queue: 'QUEUE IN OUTBOX →',
    waitsNote: 'It waits in “Waiting for your OK” like everything else — nothing sends by itself.',
    queued: 'QUEUED — WAITING FOR YOUR OK', topicOption: (label, n) => `${label} — ${n}`, allOption: (n) => `All subscribers — ${n}`
  },
  chat: {
    channels: 'CHANNELS', add: 'ADD', addPh: 'channel name', nameFirst: 'TYPE A CHANNEL NAME FIRST',
    note: 'your Med&X team, in real time — members never see this',
    propose: 'PROPOSE A MEETING', del: '✕', sureDel: 'DELETE?', delTitle: 'Delete channel — for everyone, messages included',
    deleted: 'CHANNEL DELETED — FOR EVERYONE', created: (n) => `# ${n.toUpperCase()} CREATED`,
    empty: 'No messages yet — say hello, share a file, or propose a meeting.',
    replying: 'Replying to', filePosted: 'FILE POSTED TO THE CHANNEL',
    msgPh: (n) => `Message # ${n}… — Enter sends`, send: 'SEND', attachTitle: 'Attach files or pictures — or just drag them into the chat',
    pollPosted: (n) => `MEETING POLL POSTED TO # ${n.toUpperCase()}`,
    pollClosed: 'CALENDAR INVITES QUEUED IN THE OUTBOX — APPROVE THEM THERE',
    vote: 'VOTE', voted: '✓ VOTED', closePoll: 'CLOSE POLL → QUEUE INVITES', pollClosedTag: 'CLOSED',
    meetTitle: 'Propose a meeting', meetName: 'WHAT IS IT ABOUT?', meetNamePh: 'e.g. Gala seating review', meetTimes: 'CANDIDATE TIMES (EUROPE/ZAGREB)', meetGo: 'POST THE POLL',
    onlyGeneralStays: 'general is permanent — history and channels people rely on stay put'
  }
};

// route slug ↔ artboard tab id
const SLUG_TO_TAB = { '': 'outbox', outbox: 'outbox', email: 'outbox', messages: 'messages', announcements: 'announce', announce: 'announce', newsletter: 'news', news: 'news', chat: 'chat' };
const TAB_TO_SLUG = { outbox: 'outbox', messages: 'messages', announce: 'announcements', news: 'newsletter', chat: 'chat' };
const TAB_ORDER = ['outbox', 'messages', 'announce', 'news', 'chat'];
const KIND_OF_ENGINE = {
  'weekly-pulse': 'pulse', 'nag-digest': 'pulse',
  'gala-guest-msg': 'guest', 'gala-command-center': 'guest', 'guest-pass': 'guest', 'event-invite': 'guest', 'auto-reply': 'guest', 'meeting-invite': 'guest', 'accelerator-decision': 'guest', 'speaker-itinerary': 'guest',
  'morning-after': 'survey', 'survey': 'survey', 'event-campaign': 'survey',
  'v2-newsletter': 'newsletter', 'newsletter': 'newsletter',
  'admin-compose': 'other'
};
const KIND_ORDER = ['pulse', 'guest', 'survey', 'newsletter', 'other'];
const INPUT = 'border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:9px 11px;font:400 13px Inter,sans-serif;color:#201b16';
const LABEL = 'font:600 9.5px Inter,sans-serif;letter-spacing:.14em;color:#6d6459';

let D = null, st = null, unbind = null, rootEl = null, timers = [];

function whenShort(v, now = new Date()) {
  const d = fmt.toDate(v); if (!d) return '';
  const days = fmt.daysSince(d, now);
  if (days === 0) return 'TODAY';
  if (days != null && days > 0 && days < 7) return ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][d.getDay()];
  return fmt.dayLabel(d);
}
function deferLabel(iso) {
  const d = fmt.toDate(String(iso || '').replace(' ', 'T'));
  if (!d) return 'LATER';
  const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  const days = fmt.daysUntil(d);
  if (days === 1 && hm === '09:00') return 'TOMORROW 09:00';
  if (days === 0) return 'TODAY ' + hm;
  if (days === 1) return 'TOMORROW ' + hm;
  return fmt.dayLabel(d) + ' ' + hm;
}
const cap = s => { const v = String(s || ''); return v ? v[0].toUpperCase() + v.slice(1) : v; };

function futureBatches(list) {
  const now = new Date(Date.now() + 30 * 1000).toISOString().slice(0, 19);
  return (Array.isArray(list) ? list : []).filter(b => b.earliest_scheduled_for
    && String(b.earliest_scheduled_for).replace(' ', 'T').slice(0, 19) > now);
}

// ---------------------------------------------------------------- data
async function load(tab) {
  const want = {
    badges: api.get('/api/v2/inbox/badges'),
    needs: api.get('/api/v2/inbox/needs-reply'),        // MEMBER MESSAGES tab badge (audit #4)
    chat: api.get('/api/teamchat/overview')
  };
  if (tab === 'outbox') {
    want.pending = api.get('/api/admin/outbox?status=pending_approval');
    want.scheduled = api.get('/api/admin/outbox?status=scheduled');
    want.audiences = api.get('/api/v2/inbox/audiences');
  }
  if (tab === 'messages') want.threads = api.get('/api/v2/inbox/threads');
  if (tab === 'announce') want.recent = api.get('/api/admin/notifications/user-notifications?limit=100');
  if (tab === 'news') want.nl = api.get('/api/v2/inbox/newsletter');
  const r = await api.settle(want);
  const chatChannels = r.chat ? [...(r.chat.channels || [])].filter(c => String(c.name || '').indexOf('dm:') !== 0) : [];
  const threads = r.threads && Array.isArray(r.threads.threads) ? r.threads.threads : [];
  return {
    errors: r.$errors,
    badges: r.badges || { outbox_batches: 0, outbox_emails: 0, unread_messages: 0 },
    // NEEDS A REPLY count for the tab badge; an older backend without the route falls back to
    // the loaded threads (messages tab) or the plain unread count (a floor, never an overcount)
    needsReply: r.needs ? Number(r.needs.count) || 0
      : (r.threads ? countNeedsReply(threads) : Number((r.badges || {}).unread_messages) || 0),
    chat: r.chat || null,
    chatChannels,
    chatUnread: r.chat ? [...(r.chat.channels || []), ...(r.chat.dms || [])].reduce((n, c) => n + Number(c.unread || 0), 0) : 0,
    pending: r.pending && Array.isArray(r.pending.batches) ? r.pending.batches : [],
    deferred: r.scheduled ? futureBatches(r.scheduled.batches) : [],
    audiences: r.audiences && Array.isArray(r.audiences.groups) ? r.audiences.groups : [],
    threads,
    recent: r.recent && Array.isArray(r.recent.notifications) ? r.recent.notifications : [],
    nl: r.nl || { total_active: 0, topics: [], history: [], sends: [] }
  };
}
// same rule as visibleThreads('needs') — kept in step with the backend's /needs-reply route
function countNeedsReply(threads) {
  return (threads || []).filter(t => !t.archived && (t.unread > 0 || !t.last.mine)).length;
}

// ---------------------------------------------------------------- shared blocks
function blockTitle() {
  return `
  <!-- dc: Admin Inbox.dc.html › "Inbox title row" -->
  <div style="display:flex;align-items:baseline;gap:14px;flex-wrap:wrap">
    <span class="mx-display-30" style="font-family:Fraunces,serif;font-size:30px">${COPY.title}</span>
    <span style="font-size:12.5px;color:#6d6459">${COPY.sub}</span>
  </div>
  <!-- /dc -->`;
}
function blockTabs() {
  const badges = {
    outbox: D.badges.outbox_batches || 0,
    // NEEDS A REPLY count, not raw unread — an opened-but-unanswered guest thread still shows (audit #4)
    messages: D.needsReply || 0,
    announce: 0, news: 0,
    chat: D.chatUnread || 0
  };
  return `
  <!-- dc: Admin Inbox.dc.html › "Tabs" -->
  <div class="mx-inbox-tabs" data-block="tabs" style="display:flex;gap:0;border-bottom:1px solid rgba(32,27,22,.18)">
    ${TAB_ORDER.map(id => {
      const on = st.tab === id;
      const b = badges[id];
      const tip = id === 'messages' && b ? ` title="${esc(COPY.messages.badgeTitle(b))}"` : '';
      return `<a href="/inbox/${TAB_TO_SLUG[id]}"${tip} style="padding:10px 16px;font:600 10.5px Inter,sans-serif;letter-spacing:.14em;cursor:pointer;color:${on ? '#201b16' : '#6d6459'};border-bottom:${on ? '2px solid #9b1b22' : '2px solid transparent'};margin-bottom:-1px;display:flex;align-items:center;gap:7px;white-space:nowrap" data-hover="color:#201b16">${COPY.tabs[id]}${b ? `<span style="min-width:16px;height:16px;padding:0 4px;background:#9b1b22;color:#fff;font:600 10px Inter,sans-serif;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box">${b}</span>` : ''}</a>`;
    }).join('\n    ')}
  </div>
  <!-- /dc -->`;
}

// ---------------------------------------------------------------- EMAIL & OUTBOX
function batchTitle(b) {
  return (b.sample && b.sample.subject) || b.template || (b.source_engine || 'email').replace(/[-_]/g, ' ');
}
function outboxGroups() {
  const groups = [];
  KIND_ORDER.forEach(kind => {
    const items = D.pending.filter(b => (KIND_OF_ENGINE[b.source_engine] || 'other') === kind);
    const deferred = D.deferred.filter(b => (KIND_OF_ENGINE[b.source_engine] || 'other') === kind);
    if (!items.length && !deferred.length) return;
    groups.push({ kind, label: COPY.outbox.kinds[kind], items, deferred });
  });
  return groups;
}
// the sandboxed preview iframe has an opaque origin — absolute backend asset URLs get
// CORP-blocked there, so point them at this origin's copies (real emails keep the absolute URLs)
function previewSafeHtml(html) {
  return String(html || '')
    .replace(/https?:\/\/[^"'\s>]+\/assets\/email-logo\.png/g, '/assets/logo-white.png')
    .replace(/https?:\/\/[^"'\s>]+\/assets\//g, '/assets/');
}
function previewDrawer(b) {
  if (st.previewBatch !== b.batch_id) return '';
  const p = st.previewData;
  if (!p) return `<div class="mx-outbox-preview" data-v2="batch preview" style="padding:14px 20px 18px;background:#fdfbf6;border-bottom:1px solid rgba(32,27,22,.08);font-size:12px;color:#6d6459">Loading the preview…</div>`;
  const recips = (p.items || []).map(i => esc(i.to)).join(' · ');
  return `
    <div class="mx-outbox-preview" data-v2="batch preview + edit — per-item preview under the batch row" style="padding:14px 20px 18px;background:#fdfbf6;border-bottom:1px solid rgba(32,27,22,.08);display:flex;flex-direction:column;gap:10px">
      <div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap">
        <span style="${LABEL}">${COPY.outbox.recipients} · ${p.count}</span>
        <span style="font-size:11.5px;color:#6d6459;flex:1;min-width:0">${recips}</span>
        ${p.editable ? `<span data-act="editToggle" style="font:600 9.5px Inter,sans-serif;letter-spacing:.13em;color:#9b1b22;cursor:pointer;white-space:nowrap">${st.editOpen ? COPY.outbox.close : COPY.outbox.edit}</span>` : ''}
        <span data-act="preview" data-batch="${esc(b.batch_id)}" style="font:600 9.5px Inter,sans-serif;letter-spacing:.13em;color:#6d6459;cursor:pointer;white-space:nowrap" data-hover="color:#201b16">${COPY.outbox.close}</span>
      </div>
      ${st.editOpen && p.editable ? `
      <div style="display:flex;flex-direction:column;gap:8px">
        <input data-role="editSubject" value="${esc(st.editSubject)}" aria-label="Subject" style="${INPUT}">
        <textarea data-role="editBody" rows="4" aria-label="Message" style="${INPUT};resize:vertical">${esc(st.editBody)}</textarea>
        <span data-act="editSave" data-batch="${esc(b.batch_id)}" style="align-self:flex-start;padding:8px 14px;background:#201b16;color:#f6f2ea;font:600 10px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap" data-hover="background:#000">${COPY.outbox.saveEdit}</span>
      </div>` : ''}
      ${p.preview && p.preview.html ? `<iframe sandbox="" title="Email preview" srcdoc="${esc(previewSafeHtml(p.preview.html))}"></iframe>` : `<span style="font-size:12px;color:#6d6459">${esc((p.preview && p.preview.body_text) || 'This batch carries no stored preview.')}</span>`}
    </div>`;
}
function blockWaiting() {
  const groups = outboxGroups();
  // stale-pulse age flag (audit #6): a weekly pulse a week or more old is flagged in weeks
  const ageChip = (b, g) => {
    if (g.kind !== 'pulse' || b._deferred || !b.created_at) return '';
    const days = fmt.daysSince(b.created_at);
    if (days == null || days < 7) return '';
    return `<span data-v2="stale-pulse age flag (audit #6)" style="padding:4px 8px;background:#f8f1e2;color:#7a6432;font:600 8.5px Inter,sans-serif;letter-spacing:.11em;white-space:nowrap">${COPY.outbox.weeksOld(Math.floor(days / 7))}</span>`;
  };
  const row = (b, g) => `
      <div class="mx-outbox-row" style="display:flex;align-items:center;gap:14px;padding:13px 20px;border-bottom:1px solid rgba(32,27,22,.08)">
        <span style="font-family:Fraunces,serif;font-size:18px;width:30px;text-align:center;flex:none">${Number(b.count) || 0}</span>
        <span class="mx-outbox-text" data-act="preview" data-batch="${esc(b.batch_id)}" title="${COPY.outbox.previewTitle}" style="flex:1;min-width:0;cursor:pointer">
          <span style="display:block;font-size:13.5px;font-weight:600">${esc(batchTitle(b))}</span>
          <span style="display:block;font-size:11.5px;color:#6d6459;margin-top:2px">${esc(COPY.outbox.to((b.sample && b.sample.to) || '—', Number(b.count) || 0))}</span>
        </span>
        ${ageChip(b, g)}
        ${b._deferred ? `
        <span class="mx-defer" style="padding:7px 11px;background:#f8f1e2;color:#7a6432;font:600 9px Inter,sans-serif;letter-spacing:.12em;white-space:nowrap">${esc(COPY.outbox.sends(deferLabel(b.earliest_scheduled_for)))}</span>
        <span data-act="cancelLater" data-batch="${esc(b.batch_id)}" style="font:600 9.5px Inter,sans-serif;letter-spacing:.12em;color:#6d6459;cursor:pointer;white-space:nowrap" data-hover="color:#201b16">${COPY.outbox.cancel}</span>` : `
        <span data-act="approve" data-batch="${esc(b.batch_id)}" data-count="${Number(b.count) || 0}" style="padding:8px 14px;background:#9b1b22;color:#fff;font:600 10px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap" data-hover="background:#7e151b">${COPY.outbox.approve}</span>
        <span data-act="later" data-batch="${esc(b.batch_id)}" style="padding:8px 12px;border:1px solid rgba(32,27,22,.2);font:600 10px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;color:#6d6459;white-space:nowrap" data-hover="color:#201b16;border-color:#201b16">${COPY.outbox.later}</span>
        <span data-act="discard" data-batch="${esc(b.batch_id)}" style="font:600 10px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;color:${st.discardConfirm === b.batch_id ? '#9b1b22' : '#6d6459'};white-space:nowrap" data-hover="color:#9b1b22">${st.discardConfirm === b.batch_id ? COPY.outbox.sureDiscard : COPY.outbox.discard}</span>`}
      </div>
      ${previewDrawer(b)}`;
  return `
    <!-- dc: Admin Inbox.dc.html › "WAITING FOR YOUR OK" -->
    <div data-block="waiting" style="border:1px solid rgba(32,27,22,.14);background:#fff">
      <div style="display:flex;align-items:center;gap:10px;padding:14px 20px;border-bottom:1px solid rgba(32,27,22,.12)">
        <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${COPY.outbox.waiting}</span>
        <span style="font-size:11.5px;color:#6d6459">${COPY.outbox.waitingSub}</span>
      </div>
      ${groups.map(g => `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 20px;background:#fdfbf6;border-bottom:1px solid rgba(32,27,22,.08)">
        <span style="font:600 8.5px Inter,sans-serif;letter-spacing:.16em;color:#6d6459">${g.label}</span>
        <div style="flex:1"></div>
        ${g.items.length > 1 ? `<span data-act="approveAll" data-kind="${g.kind}" style="font:600 9px Inter,sans-serif;letter-spacing:.13em;color:#1e6e42;cursor:pointer;white-space:nowrap" data-hover="color:#201b16">${COPY.outbox.approveAll(g.items.length)}</span>` : ''}
        ${g.kind === 'pulse' && g.items.length > 1 ? `<span data-act="discardAllPulse" data-v2="bulk discard for piled-up weekly pulses (audit #6) — confirm first, pending only" style="font:600 9px Inter,sans-serif;letter-spacing:.13em;color:#9b1b22;cursor:pointer;white-space:nowrap" data-hover="color:#7e151b">${COPY.outbox.discardAll(g.items.length)}</span>` : ''}
      </div>
      ${g.items.map(b => row(b, g)).join('')}
      ${g.deferred.map(b => row(Object.assign({ _deferred: true }, b), g)).join('')}`).join('')}
      ${!groups.length ? `<div style="padding:26px 20px;text-align:center;font-size:13px;color:#6d6459">${COPY.outbox.empty}</div>` : ''}
    </div>
    <!-- /dc -->`;
}
function currentAudience() {
  return D.audiences.find(g => g.key === st.audience) || D.audiences[0] || { key: 'everyone', label: 'Everyone', people: [], count: 0 };
}
function filteredPeople() {
  let people = currentAudience().people.slice();
  if (st.filter === 'unpaid') people = people.filter(p => p.paid === false);
  else if (st.filter === 'checked_in') people = people.filter(p => p.checked_in === true);
  else if (st.filter === 'not_checked_in') people = people.filter(p => p.checked_in === false);
  return people;
}
function pickCount() { return st.picked.size; }
function blockCompose() {
  const c = COPY.compose;
  const people = filteredPeople();
  const allPeople = []; const seen = new Set();
  D.audiences.forEach(g => g.people.forEach(p => { if (!seen.has(p.key)) { seen.add(p.key); allPeople.push(p); } }));
  const chip = st.manual ? { bg: '#201b16', fg: '#fff', bd: '#201b16' } : { bg: '#f6f2ea', fg: '#6d6459', bd: 'rgba(32,27,22,.25)' };
  const note = st.manual ? c.noteManual(pickCount()) : c.note(people.length);
  const manualNote = st.manual ? c.manualOn(pickCount(), allPeople.length) : c.manualOff;
  const optLabel = g => `${g.label} — ${fmt.plural(g.count, 'person', 'people')}${g.sub ? ` (${g.sub})` : ''}`;
  return `
    <!-- dc: Admin Inbox.dc.html › "EMAIL EVERYONE REGISTERED" + "HOW IT WILL LOOK" -->
    <div class="mx-inbox-split" data-block="compose" style="display:grid;grid-template-columns:1fr 340px;gap:22px;align-items:start">
      <div id="compose" style="border:1px solid rgba(32,27,22,.14);background:#fff;padding:18px 20px;display:flex;flex-direction:column;gap:12px">
        <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${c.title}</span>
        <div class="mx-inbox-split" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <label style="display:flex;flex-direction:column;gap:5px"><span style="${LABEL}">${c.who}</span><select data-role="qAudience" style="${INPUT}">${D.audiences.map(g => `<option value="${esc(g.key)}"${g.key === st.audience ? ' selected' : ''}>${esc(optLabel(g))}</option>`).join('')}</select></label>
          <label style="display:flex;flex-direction:column;gap:5px"><span style="${LABEL}">${c.filter}</span><select data-role="qFilter" style="${INPUT}">${c.filters.map(f => `<option value="${f[0]}"${f[0] === st.filter ? ' selected' : ''}>${esc(f[1])}</option>`).join('')}</select></label>
        </div>
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <span data-act="manualTg" style="padding:7px 12px;font:600 9px Inter,sans-serif;letter-spacing:.12em;cursor:pointer;background:${chip.bg};color:${chip.fg};border:1px solid ${chip.bd}">${c.manual}</span>
          <span style="font-size:11.5px;color:#6d6459">${esc(manualNote)}</span>
        </div>
        ${st.manual ? `
        <div style="border:1px solid rgba(32,27,22,.12);background:#fdfbf6;padding:8px 14px;max-height:172px;overflow:auto">
          ${allPeople.map(p => `
          <label style="display:flex;align-items:center;gap:10px;font-size:12.5px;padding:6px 0;border-bottom:1px solid rgba(32,27,22,.05);cursor:pointer"><input type="checkbox" data-act="pickTg" data-key="${esc(p.key)}"${st.picked.has(p.key) ? ' checked' : ''}><span style="flex:1;min-width:0">${esc(p.name)}</span><span style="font:600 8px Inter,sans-serif;letter-spacing:.11em;color:#9a9086;white-space:nowrap">${esc(p.tag)}</span></label>`).join('')}
          ${!allPeople.length ? `<span style="font-size:12px;color:#6d6459;font-style:italic">No registrants yet.</span>` : ''}
        </div>` : ''}
        <label style="display:flex;flex-direction:column;gap:5px"><span style="${LABEL}">${c.subject}</span><input data-role="qSubject" value="${esc(st.subject)}" placeholder="${esc(c.subjectPh)}" style="${INPUT}"></label>
        <label style="display:flex;flex-direction:column;gap:5px"><span style="${LABEL}">${c.message}</span><textarea data-role="qBody" rows="5" placeholder="${esc(c.messagePh)}" style="${INPUT};resize:vertical">${esc(st.body)}</textarea></label>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <span data-act="queueEmail" style="padding:10px 16px;background:#9b1b22;color:#fff;font:600 10px Inter,sans-serif;letter-spacing:.14em;cursor:pointer;white-space:nowrap" data-hover="background:#7e151b">${c.queue}</span>
          <span data-act="sendTest" style="padding:10px 14px;border:1px solid rgba(32,27,22,.2);font:600 10px Inter,sans-serif;letter-spacing:.14em;cursor:pointer;color:#201b16;white-space:nowrap" data-hover="border-color:#201b16">${c.test}</span>
          <span data-role="audienceNote" style="font-size:11.5px;color:#6d6459">${esc(note)}</span>
        </div>
      </div>
      <div style="border:1px solid rgba(32,27,22,.14);background:#fff;padding:18px 20px;display:flex;flex-direction:column;gap:10px">
        <span style="font:600 10px Inter,sans-serif;letter-spacing:.15em;color:#6d6459">${c.how}</span>
        <div style="border:1px solid rgba(32,27,22,.12)">
          <div style="background:#191512;padding:13px 16px"><img src="/assets/logo-white.png" alt="Med&amp;X" style="height:15px;display:block"></div>
          <div style="padding:14px 16px;display:flex;flex-direction:column;gap:8px">
            <span style="font-size:12.5px">Dear ${esc(session.firstName())},</span>
            <span data-role="previewBody" style="font-size:12.5px;color:#6d6459;line-height:1.55;white-space:pre-line">${esc(st.body.trim() || c.previewEmpty)}</span>
            <span style="font-size:10.5px;color:#6d6459;border-top:1px solid rgba(32,27,22,.1);padding-top:8px">${c.greetNote}</span>
          </div>
        </div>
        <span style="font-size:11.5px;color:#6d6459;line-height:1.5">${c.replyNote}</span>
      </div>
    </div>
    <!-- /dc -->`;
}
function tabOutbox() {
  return `<div style="display:flex;flex-direction:column;gap:22px">${blockWaiting()}${blockCompose()}</div>`;
}

// ---------------------------------------------------------------- MEMBER MESSAGES
function visibleThreads() {
  if (st.msgFilter === 'all') return D.threads;
  return D.threads.filter(t => !t.archived && (t.unread > 0 || !t.last.mine));
}
function openThreadObj() { return D.threads.find(t => t.key === st.openKey) || null; }
function blockThreadList() {
  const m = COPY.messages;
  const rows = visibleThreads();
  const chipOn = 'font:600 10px Inter,sans-serif;letter-spacing:.13em;background:#201b16;color:#f6f2ea;padding:6px 10px;cursor:pointer';
  const chipOff = 'font:600 10px Inter,sans-serif;letter-spacing:.13em;color:#6d6459;padding:6px 10px;cursor:pointer';
  return `
      <div data-block="threadlist" style="border:1px solid rgba(32,27,22,.14);background:#fff">
        <div style="padding:12px 16px;border-bottom:1px solid rgba(32,27,22,.12);display:flex;gap:8px">
          <span data-act="msgNeeds" style="${st.msgFilter === 'needs' ? chipOn : chipOff}" ${st.msgFilter === 'needs' ? '' : 'data-hover="color:#201b16"'}>${m.needsReply}</span>
          <span data-act="msgAll" style="${st.msgFilter === 'all' ? chipOn : chipOff}" ${st.msgFilter === 'all' ? '' : 'data-hover="color:#201b16"'}>${m.all}</span>
        </div>
        <div class="mx-inbox-list">
        ${rows.map(t => `
        <div data-act="openThread" data-key="${esc(t.key)}" style="padding:13px 16px;border-bottom:1px solid rgba(32,27,22,.08);cursor:pointer;background:${t.key === st.openKey ? '#f6f2ea' : '#fff'};${t.archived ? 'opacity:.6' : ''}">
          <div style="display:flex;gap:8px;align-items:center">${t.unread ? `<span style="width:7px;height:7px;border-radius:50%;background:#9b1b22;flex:none"></span>` : ''}<span style="font-size:13px;font-weight:600;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.name)}</span>${t.archived ? `<span style="font:600 8px Inter,sans-serif;letter-spacing:.1em;background:#eee9df;color:#4a4239;padding:2px 6px;white-space:nowrap">${m.archived}</span>` : t.topic ? `<span style="font:600 8px Inter,sans-serif;letter-spacing:.1em;background:#eee9df;color:#4a4239;padding:2px 6px;white-space:nowrap">${esc(String(t.topic).toUpperCase())}</span>` : ''}<span style="font:600 9px Inter,sans-serif;color:#6d6459;white-space:nowrap">${whenShort(t.last.at)}</span></div>
          <div style="font-size:11.5px;color:#6d6459;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.last.content || (t.last.attachment_name ? '\u2295 ' + t.last.attachment_name : ''))}</div>
        </div>`).join('')}
        ${!rows.length ? `<div style="padding:20px 16px;font-size:12px;color:#6d6459">${D.threads.length ? m.none : m.empty.why}</div>` : ''}
        </div>
      </div>`;
}
function blockConversation() {
  const m = COPY.messages;
  const t = openThreadObj();
  if (!t) return `
      <div data-block="conv" style="border:1px solid rgba(32,27,22,.14);background:#fff;display:flex;flex-direction:column;min-height:380px">
        <div class="empty" style="margin:auto"><span style="width:28px;height:1px;background:#c9a962"></span><span class="empty-line">${m.empty.line}</span><span class="empty-why">${m.empty.why}</span></div>
      </div>`;
  const meta = [t.topic ? String(t.topic).toUpperCase() : null, t.institution ? String(t.institution).toUpperCase() : null].filter(Boolean).join(' · ');
  const msgs = st.thread || [];
  return `
      <div data-block="conv" style="border:1px solid rgba(32,27,22,.14);background:#fff;display:flex;flex-direction:column;min-height:380px">
        <div style="padding:13px 20px;border-bottom:1px solid rgba(32,27,22,.12);display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <span style="font-size:14px;font-weight:600">${esc(t.name)}</span>
          <span style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#6d6459">${esc(meta)}</span>
          <div style="flex:1"></div>
          <span data-act="toggleRead" style="padding:6px 10px;border:1px solid rgba(32,27,22,.2);font:600 9px Inter,sans-serif;letter-spacing:.12em;cursor:pointer;color:#6d6459;white-space:nowrap" data-hover="color:#201b16;border-color:#201b16">${t.unread ? m.markRead : m.markUnread}</span>
          <span data-act="archiveThread" style="padding:6px 10px;border:1px solid rgba(32,27,22,.2);font:600 9px Inter,sans-serif;letter-spacing:.12em;cursor:pointer;color:#6d6459;white-space:nowrap" data-hover="color:#9b1b22;border-color:#9b1b22">${t.archived ? m.unarchive : m.archive}</span>
          <a href="/people" style="font:600 10px Inter,sans-serif;letter-spacing:.13em;white-space:nowrap">${m.viewPerson}</a>
        </div>
        <div class="mx-inbox-log" style="flex:1;padding:18px 20px;display:flex;flex-direction:column;gap:12px" data-role="msgLog">
          ${msgs.map(x => {
            const mine = String(x.sender_type || 'user') === 'admin';
            const who = mine ? (x.sender_name ? m.staffTag(x.sender_name) : m.teamFallback) : '';
            return `<div style="max-width:70%;align-self:${mine ? 'flex-end' : 'flex-start'};background:${mine ? '#191512' : '#f6f2ea'};color:${mine ? '#f6f2ea' : '#201b16'};padding:10px 14px;font-size:13px;line-height:1.5">${who ? `<span data-v2="staff identity (direct_messages.sender_name)" style="display:block;font:600 8.5px Inter,sans-serif;letter-spacing:.12em;margin-bottom:4px;opacity:.65">${esc(who)}</span>` : ''}<span style="white-space:pre-wrap;word-break:break-word">${esc(x.content || '')}</span>${msgAttachment(x, mine)}<span style="display:block;font:600 9px Inter,sans-serif;letter-spacing:.1em;margin-top:5px;opacity:.6">${whenShort(x.created_at)} ${esc(String(x.created_at || '').slice(11, 16))}</span></div>`;
          }).join('')}
        </div>
        ${st.msgAttach ? `
        <div data-v2="pending attachment — uploads on SEND via POST /api/v2/messages/attach" style="display:flex;align-items:center;gap:10px;padding:8px 20px;border-top:1px solid rgba(32,27,22,.12);background:#fdfbf6">
          <span style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#7a6432;background:#f8f1e2;padding:5px 10px;max-width:70%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">\u2295 ${esc(st.msgAttach.name)}</span>
          <span data-act="attachClear" role="button" aria-label="Remove attachment" style="font:600 11px Inter,sans-serif;color:#6d6459;cursor:pointer" data-hover="color:#9b1b22">\u2715</span>
        </div>` : ''}
        <div style="padding:14px 20px;border-top:1px solid rgba(32,27,22,.12);display:flex;flex-direction:column;gap:7px">
          <div style="display:flex;gap:10px;align-items:flex-end">
            <span data-act="cannedOpen" data-v2="SAVED REPLIES picker (v2_canned_replies)" title="${esc(m.savedTitle)}" style="padding:10px 12px;border:1px solid rgba(32,27,22,.2);font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#6d6459;cursor:pointer;white-space:nowrap" data-hover="border-color:#201b16;color:#201b16">${m.saved}</span>
            <label data-v2="ONE image/PDF per message — label wraps the hidden input so the OS picker opens without ui.bind's preventDefault" title="${esc(m.attachTitle)}" style="padding:10px 12px;border:1px solid rgba(32,27,22,.2);font:600 12px Inter,sans-serif;color:#6d6459;cursor:pointer;display:flex;align-items:center" data-hover="border-color:#201b16;color:#201b16">\u2295<input type="file" data-role="msgFile" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf" style="display:none"></label>
            <textarea data-role="reply" rows="2" placeholder="${esc(m.replyPh)}" aria-label="Reply" style="flex:1;${INPUT};padding:10px 12px;resize:none">${esc(st.replyDraft || '')}</textarea>
            <span data-act="sendReply" ${st.replySending ? 'aria-disabled="true"' : ''} style="padding:10px 16px;background:#9b1b22;color:#fff;font:600 10px Inter,sans-serif;letter-spacing:.14em;cursor:pointer;display:flex;align-items:center" data-hover="background:#7e151b">${m.send}</span>
          </div>
          <span data-v2="staff identity note" style="font-size:10.5px;color:#9a9086">${esc(m.identityNote(session.firstName()))}</span>
        </div>
      </div>`;
}
// ONE attachment per message — thumbnail for images, a labelled chip otherwise. Paths are relative
// ('/uploads/messages/…' — this backend mirrors the member portal's route) or absolute (Cloudinary).
// AUDIT #4 — the broken preview: a locally stored '/uploads/messages/…' file does not survive a
// redeploy (that disk is ephemeral — only the Cloudinary copy is permanent), so its <img> renders
// as the browser's broken-image glyph inside the bubble. The thumbnail now HIDES ITSELF on error
// (same onerror pattern the Studio photo tiles use) and the labelled chip below — the part that
// still opens or downloads the file — stays. Non-images never got a thumbnail to begin with.
function attUrl(p) { return p ? (String(p).startsWith('/') ? api.url(p) : p) : ''; }
function attIsImage(x) { return /\.(jpe?g|png|webp|gif)(\s|\?|$)/i.test(String(x.attachment_name || '') + ' ' + String(x.attachment_path || x.attachment_url || '')); }
function msgAttachment(x, mine) {
  const p = x.attachment_path || x.attachment_url;
  if (!p) return '';
  const name = x.attachment_name || COPY.messages.file;
  const url = attUrl(p);
  const bd = mine ? 'rgba(246,242,234,.4)' : 'rgba(32,27,22,.2)';
  const img = attIsImage(x) ? `<a href="${esc(url)}" target="_blank" rel="noopener" data-v2="thumbnail hides itself when the file can't render (audit #4) — the chip below stays" style="display:block;margin-top:8px"><img src="${esc(url)}" alt="${esc(name)}" loading="lazy" onerror="this.parentNode.style.display='none'" style="max-width:220px;max-height:160px;border:1px solid ${bd};display:block"></a>` : '';
  return `${img}<a href="${esc(url)}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:6px;margin-top:6px;padding:6px 10px;border:1px solid ${bd};font:600 9px Inter,sans-serif;letter-spacing:.1em;color:inherit;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">\u2295 ${esc(name)}</a>`;
}
function tabMessages() {
  return `
    <!-- dc: Admin Inbox.dc.html › "MEMBER MESSAGES" -->
    <div class="mx-inbox-split" data-block="messages" style="display:grid;grid-template-columns:340px 1fr;gap:22px;align-items:start">
      ${blockThreadList()}
      ${blockConversation()}
    </div>
    <!-- /dc -->`;
}

// ---------------------------------------------------------------- ANNOUNCEMENTS
function annAudienceLabel() {
  const found = COPY.announce.audiences.find(a => a[0] === st.annWho);
  return found ? found[1] : 'Everyone';
}
function blockAnnouncer() {
  const a = COPY.announce;
  return `
    <!-- dc: Admin Inbox.dc.html › "POST TO MEMBERS’ NOTIFICATION BELL" + bell preview -->
    <div class="mx-inbox-split" data-block="announcer" style="display:grid;grid-template-columns:1fr 380px;gap:22px;align-items:start">
      <div style="border:1px solid rgba(32,27,22,.14);background:#fff;padding:18px 20px;display:flex;flex-direction:column;gap:12px">
        <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${a.title}</span>
        <label style="display:flex;flex-direction:column;gap:5px"><span style="${LABEL}">${a.who}</span><select data-role="annWho" style="${INPUT}">${a.audiences.map(x => `<option value="${x[0]}"${st.annWho === x[0] ? ' selected' : ''}>${esc(x[1])}</option>`).join('')}</select></label>
        <label style="display:flex;flex-direction:column;gap:5px"><span style="${LABEL}">${a.t}</span><input data-role="annTitle" value="${esc(st.annTitle)}" placeholder="${esc(a.tPh)}" style="${INPUT}"></label>
        <label style="display:flex;flex-direction:column;gap:5px"><span style="${LABEL}">${a.m}</span><textarea data-role="annBody" rows="4" placeholder="${esc(a.mPh)}" style="${INPUT};resize:vertical">${esc(st.annBody)}</textarea></label>
        <div class="mx-inbox-split" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <label style="display:flex;flex-direction:column;gap:5px"><span style="${LABEL}">${a.link}</span><input data-role="annLink" value="${esc(st.annLink)}" placeholder="${esc(a.linkPh)}" style="${INPUT}"></label>
          <label style="display:flex;flex-direction:column;gap:5px"><span style="${LABEL}">${a.until}</span><select data-role="annUntil" style="${INPUT}">${a.untils.map(x => `<option value="${x[0]}"${st.annUntil === x[0] ? ' selected' : ''}>${esc(x[1])}</option>`).join('')}</select></label>
        </div>
        <label style="display:flex;align-items:center;gap:8px;font-size:12.5px;color:#4a4239;cursor:pointer"><input type="checkbox" data-role="annPush"${st.annPush ? ' checked' : ''}>${a.push}</label>
        <span data-act="annPublish" style="padding:11px 16px;background:#9b1b22;color:#fff;font:600 10px Inter,sans-serif;letter-spacing:.14em;cursor:pointer;text-align:center" data-hover="background:#7e151b">${a.publish}</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:14px">
        <div style="border:1px solid rgba(32,27,22,.14);background:#fff;padding:16px 18px;display:flex;flex-direction:column;gap:8px">
          <span style="font:600 10px Inter,sans-serif;letter-spacing:.15em;color:#6d6459">${a.howTitle}</span>
          <div style="border:1px solid rgba(32,27,22,.12)">
            <div style="background:#191512;padding:9px 14px;display:flex;align-items:center;gap:8px"><span style="font:600 8.5px Inter,sans-serif;letter-spacing:.18em;color:#c9a962">${a.bell}</span><span style="font-size:10px;color:rgba(246,242,234,.55)">${a.oneNew}</span></div>
            <div style="padding:12px 14px;display:flex;gap:10px">
              <span style="width:8px;height:8px;border-radius:50%;background:#9b1b22;flex:none;margin-top:5px"></span>
              <span style="flex:1;min-width:0">
                <span data-role="annPrevTitle" style="display:block;font-size:13.5px;font-weight:600">${esc(st.annTitle.trim() || a.prevTitle)}</span>
                <span data-role="annPrevBody" style="display:block;font-size:12px;color:#6d6459;line-height:1.5;margin-top:2px">${esc(st.annBody.trim() || a.prevBody)}</span>
                <span data-role="annPrevMeta" style="display:block;font:600 8.5px Inter,sans-serif;letter-spacing:.12em;color:#9a9086;margin-top:5px">${esc(a.justNow(annAudienceLabel()))}</span>
              </span>
            </div>
          </div>
          <span style="font-size:11.5px;color:#6d6459">${a.alsoInbox}</span>
        </div>
      </div>
    </div>
    <!-- /dc -->`;
}
function blockRecentAnn() {
  const a = COPY.announce;
  const rows = D.recent.slice(0, 8);
  return `
    <!-- dc: Admin Inbox.dc.html › "RECENT ANNOUNCEMENTS" -->
    <div data-block="recentAnn" style="border:1px solid rgba(32,27,22,.14);background:#fff">
      <div style="padding:12px 18px;border-bottom:1px solid rgba(32,27,22,.12);font:600 10px Inter,sans-serif;letter-spacing:.15em;color:#6d6459">${a.recent}</div>
      ${rows.map(r => `
      <div style="display:flex;align-items:center;gap:10px;padding:11px 18px;border-bottom:1px solid rgba(32,27,22,.08)">
        <span style="flex:1;min-width:0"><span style="display:block;font-size:12.5px;font-weight:600">${esc(r.title)}</span><span style="display:block;font-size:11px;color:#6d6459;margin-top:2px">${esc([cap(r.project || (r.user_group === 'all' ? 'Everyone' : r.user_group)), fmt.dayShort(r.created_at), r.expires_at ? 'until ' + fmt.dayShort(r.expires_at) : null].filter(Boolean).join(' · '))}</span></span>
        <span data-act="annRemove" data-id="${esc(r.id)}" style="font:600 9.5px Inter,sans-serif;letter-spacing:.12em;color:${st.annConfirm === r.id ? '#9b1b22' : '#6d6459'};cursor:pointer;white-space:nowrap" data-hover="color:#9b1b22">${st.annConfirm === r.id ? a.sureRemove : a.remove}</span>
      </div>`).join('')}
      ${!rows.length ? `<div style="padding:18px;font-size:12.5px;color:#6d6459;text-align:center">${a.recentEmpty}</div>` : ''}
    </div>
    <!-- /dc -->`;
}
function tabAnnounce() { return blockAnnouncer() + blockRecentAnn(); }

// ---------------------------------------------------------------- NEWSLETTER
function blockNlCards() {
  const n = COPY.news;
  const topics = D.nl.topics || [];
  const max = Math.max(1, ...topics.map(t => Number(t.count) || 0));
  const hist = (D.nl.history || []).slice(0, 6);
  const histRow = h => {
    const stateLine = h.status === 'pending_approval' ? n.stateWaiting(h.count)
      : h.status === 'scheduled' ? n.stateScheduled
      : h.status === 'sent' ? n.stateSent(h.count)
      : n.stateCancelled;
    const portal = h.portal === 'posted' ? ' ' + n.portalPosted : h.portal === 'pending' ? ' ' + n.portalPending : '';
    return `
      <div style="display:flex;align-items:center;gap:10px;padding:13px 18px;border-bottom:1px solid rgba(32,27,22,.08)">
        <span style="flex:1;min-width:0"><span style="display:block;font-size:13px;font-weight:600">${esc(h.subject || 'Untitled newsletter')}</span><span style="display:block;font-size:11px;color:#6d6459;margin-top:2px">${esc(stateLine + portal)}</span></span>
        ${h.status === 'pending_approval' ? `<span data-act="nlEdit" data-batch="${esc(h.batch_id)}" style="padding:7px 12px;border:1px solid rgba(32,27,22,.2);font:600 10px Inter,sans-serif;letter-spacing:.13em;cursor:pointer" data-hover="border-color:#201b16">${n.edit}</span>
        <a href="/inbox/outbox" style="font:600 9.5px Inter,sans-serif;letter-spacing:.12em;white-space:nowrap">${n.inOutbox}</a>` : ''}
      </div>`;
  };
  return `
    <!-- dc: Admin Inbox.dc.html › "SUBSCRIBERS" + "DRAFTS & HISTORY" -->
    <div class="mx-inbox-split" data-block="nlcards" style="display:grid;grid-template-columns:1fr 1fr;gap:22px;align-items:start">
      <div style="border:1px solid rgba(32,27,22,.14);background:#fff">
        <div style="display:flex;align-items:center;gap:10px;padding:14px 20px;border-bottom:1px solid rgba(32,27,22,.1)"><span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${n.subs}</span><div style="flex:1"></div><span style="font-size:11px;color:#6d6459">${n.subsSub}</span></div>
        <div style="padding:10px 20px 6px">
          ${topics.map(t => `
          <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(32,27,22,.06)">
            <span style="width:130px;flex:none;font-size:12.5px">${esc(t.label)}</span>
            <span style="flex:1;height:9px;background:rgba(32,27,22,.06)"><span style="display:block;width:${Math.round((Number(t.count) || 0) / max * 100)}%;height:100%;background:#c9a962"></span></span>
            <span style="font:600 11px Inter,sans-serif;width:20px;text-align:right">${Number(t.count) || 0}</span>
          </div>`).join('')}
        </div>
        <div style="padding:10px 20px 16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <span data-act="nlOpen" style="padding:11px 16px;background:#9b1b22;color:#fff;font:600 10px Inter,sans-serif;letter-spacing:.14em;cursor:pointer" data-hover="background:#7e151b">${n.newBtn}</span>
          <span style="font-size:11.5px;color:#6d6459">${n.anyone}</span>
        </div>
      </div>
      <div style="border:1px solid rgba(32,27,22,.14);background:#fff">
        <div style="padding:12px 18px;border-bottom:1px solid rgba(32,27,22,.12);font:600 10px Inter,sans-serif;letter-spacing:.15em;color:#6d6459">${n.drafts}</div>
        ${hist.map(histRow).join('')}
        ${!hist.length ? `<div style="padding:22px 18px;font-size:12.5px;color:#6d6459;text-align:center">${n.nothing}</div>` : ''}
      </div>
    </div>
    <!-- /dc -->`;
}
function blockNlCompose() {
  const n = COPY.news;
  if (!st.nlCompose) return `<!-- dc: Admin Inbox.dc.html › "WRITE THE NEWSLETTER" --><div data-block="nlcompose"></div><!-- /dc -->`;
  const topics = D.nl.topics || [];
  const opt = t => t.key === 'all' ? n.allOption(t.count) : n.topicOption(t.label + ' topic', t.count);
  return `
    <!-- dc: Admin Inbox.dc.html › "WRITE THE NEWSLETTER" -->
    <div data-block="nlcompose" style="border:1px solid rgba(32,27,22,.14);border-top:2px solid #c9a962;background:#fff;padding:18px 20px;display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;align-items:center;gap:10px"><span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${n.write}</span><div style="flex:1"></div><span data-act="nlClose" style="font:600 10px Inter,sans-serif;letter-spacing:.12em;color:#6d6459;cursor:pointer" data-hover="color:#9b1b22">${n.closeBtn}</span></div>
      <div class="mx-inbox-split" style="display:grid;grid-template-columns:2fr 1fr;gap:12px">
        <label style="display:flex;flex-direction:column;gap:5px"><span style="${LABEL}">${n.subject}</span><input data-role="nlSubject" value="${esc(st.nlSubject)}" placeholder="${esc(n.subjectPh)}" style="${INPUT}"></label>
        <label style="display:flex;flex-direction:column;gap:5px"><span style="${LABEL}">${n.to}</span><select data-role="nlTopic" style="${INPUT}">${topics.map(t => `<option value="${esc(t.key)}"${st.nlTopic === t.key ? ' selected' : ''}>${esc(opt(t))}</option>`).join('')}</select></label>
      </div>
      <label style="display:flex;flex-direction:column;gap:5px"><span style="${LABEL}">${n.message}</span><textarea data-role="nlBody" rows="5" placeholder="${esc(n.messagePh)}" style="${INPUT};resize:vertical">${esc(st.nlBody)}</textarea></label>
      <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
        <label style="display:flex;align-items:center;gap:7px;font-size:12.5px;color:#4a4239;cursor:pointer"><input type="checkbox" data-role="nlEmail"${st.nlEmail ? ' checked' : ''}>${n.asEmail}</label>
        <label style="display:flex;align-items:center;gap:7px;font-size:12.5px;color:#4a4239;cursor:pointer"><input type="checkbox" data-role="nlPortal"${st.nlPortal ? ' checked' : ''}>${n.asPortal}</label>
        <div style="flex:1"></div>
        <span data-act="nlQueue" style="padding:10px 16px;background:#9b1b22;color:#fff;font:600 10px Inter,sans-serif;letter-spacing:.14em;cursor:pointer" data-hover="background:#7e151b">${n.queue}</span>
      </div>
      <span style="font-size:11px;color:#6d6459">${n.waitsNote}</span>
    </div>
    <!-- /dc -->`;
}
function tabNews() { return blockNlCards() + blockNlCompose(); }

// ---------------------------------------------------------------- TEAM CHAT
function chatChannelName(c) { return c.project ? `${c.project} — ${c.display_name || c.name}` : (c.display_name || c.name); }
function openChannel() { return D.chatChannels.find(c => c.id === st.chOpen) || D.chatChannels[0] || null; }
function blockChannels() {
  const c = COPY.chat;
  const open = openChannel();
  return `
      <div data-block="channels" style="border:1px solid rgba(32,27,22,.14);background:#fff">
        <div style="padding:12px 16px;border-bottom:1px solid rgba(32,27,22,.12);display:flex;align-items:center;gap:8px"><span style="font:600 10px Inter,sans-serif;letter-spacing:.15em;color:#6d6459">${c.channels}</span><div style="flex:1"></div><span data-act="chAddToggle" title="New channel" style="font:600 14px Inter,sans-serif;color:#6d6459;cursor:pointer" data-hover="color:#201b16">+</span></div>
        ${st.chAdding ? `
        <div style="display:flex;gap:6px;padding:10px 12px;border-bottom:1px solid rgba(32,27,22,.08);background:#fdfbf6">
          <input data-role="chNew" value="${esc(st.chNew)}" placeholder="${esc(c.addPh)}" aria-label="Channel name" style="flex:1;min-width:0;border:1px solid rgba(32,27,22,.25);background:#fff;padding:7px 9px;font:400 12px Inter,sans-serif;color:#201b16">
          <span data-act="chCreate" style="padding:7px 10px;background:#9b1b22;color:#fff;font:600 9px Inter,sans-serif;letter-spacing:.1em;cursor:pointer;display:flex;align-items:center" data-hover="background:#7e151b">${c.add}</span>
        </div>` : ''}
        <div class="mx-inbox-list">
        ${D.chatChannels.map(ch => {
          const isOpen = open && ch.id === open.id;
          const canDel = ch.scope === 'team' && !Number(ch.is_all);
          const unread = !isOpen && Number(ch.unread) ? String(ch.unread) : null;
          return `
        <div data-act="chOpenC" data-id="${esc(ch.id)}" title="${canDel ? '' : esc(c.onlyGeneralStays)}" style="display:flex;align-items:center;gap:9px;padding:10px 16px;cursor:pointer;background:${isOpen ? '#f6f2ea' : '#fff'};border-bottom:1px solid rgba(32,27,22,.06)">
          <span style="font:600 11px Inter,sans-serif;color:#6d6459">#</span>
          <span style="font-size:13px;flex:1;min-width:0;font-weight:${isOpen ? '600' : '400'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(chatChannelName(ch))}</span>
          ${unread ? `<span style="min-width:16px;height:16px;padding:0 4px;background:#9b1b22;color:#fff;font:600 10px Inter,sans-serif;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box">${unread}</span>` : ''}
          ${canDel ? `<span data-act="chDel" data-id="${esc(ch.id)}" title="${esc(c.delTitle)}" style="font:600 10px Inter,sans-serif;color:${st.chDelConfirm === ch.id ? '#9b1b22' : '#c9beb2'};cursor:pointer" data-hover="color:#9b1b22">${st.chDelConfirm === ch.id ? c.sureDel : c.del}</span>` : ''}
        </div>`; }).join('')}
        </div>
      </div>`;
}
function pollBlock(m) {
  const c = COPY.chat;
  const p = m.poll;
  if (!p) return '';
  const closed = p.status === 'closed';
  const mine = D.chat && D.chat.me && p.created_by === D.chat.me.id;
  return `
      <div data-v2="meeting poll (existing /api/teamchat/polls)" style="border:1px solid rgba(32,27,22,.14);background:#fdfbf6;padding:10px 12px;margin-top:6px;display:flex;flex-direction:column;gap:6px">
        <span style="font:600 8.5px Inter,sans-serif;letter-spacing:.14em;color:${closed ? '#6d6459' : '#7a6432'}">MEETING POLL${closed ? ' · ' + c.pollClosedTag : ''} · ${p.duration_min || 60} MIN</span>
        ${(p.options || []).map(o => `
        <div style="display:flex;align-items:center;gap:10px;font-size:12.5px">
          <span style="flex:1;min-width:0${closed && p.winning_index === o.index ? ';font-weight:600' : ''}">${esc(deferLabel(o.start))}${closed && p.winning_index === o.index ? ' ✓' : ''}</span>
          <span style="font:600 9px Inter,sans-serif;color:#6d6459">${o.count} vote${o.count === 1 ? '' : 's'}</span>
          ${!closed ? `<span data-act="pollVote" data-poll="${esc(p.id)}" data-i="${o.index}" style="padding:4px 9px;border:1px solid ${o.mine ? '#1e6e42' : 'rgba(32,27,22,.2)'};color:${o.mine ? '#1e6e42' : '#6d6459'};font:600 8.5px Inter,sans-serif;letter-spacing:.1em;cursor:pointer;white-space:nowrap" data-hover="border-color:#201b16;color:#201b16">${o.mine ? c.voted : c.vote}</span>` : ''}
        </div>`).join('')}
        ${!closed && mine ? `<span data-act="pollClose" data-poll="${esc(p.id)}" style="align-self:flex-start;font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#9b1b22;cursor:pointer">${c.closePoll}</span>` : ''}
      </div>`;
}
function blockChatPane() {
  const c = COPY.chat;
  const open = openChannel();
  const name = open ? chatChannelName(open) : 'general';
  const log = st.chMsgs || [];
  return `
      <div data-block="chatpane" style="border:1px solid rgba(32,27,22,.14);background:#fff;display:flex;flex-direction:column;min-height:400px">
        <div style="padding:13px 20px;border-bottom:1px solid rgba(32,27,22,.12);display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <span style="font-size:14px;font-weight:600"># ${esc(name)}</span>
          <span style="font-size:11px;color:#6d6459">${c.note}</span>
          <div style="flex:1"></div>
          <span data-act="proposeMeeting" style="padding:7px 12px;border:1px solid rgba(32,27,22,.2);font:600 10px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap" data-hover="border-color:#201b16">${c.propose}</span>
        </div>
        <div class="mx-inbox-log" data-role="chLog" style="flex:1;padding:18px 20px;display:flex;flex-direction:column;gap:12px">
          ${!log.length ? `<div style="font-size:12.5px;color:#6d6459;font-style:italic">${c.empty}</div>` : ''}
          ${log.map(m => `
          <div style="display:flex;gap:10px">
            <span style="width:28px;height:28px;background:${esc(m.avatar_color || '#201b16')};color:#fff;display:inline-flex;align-items:center;justify-content:center;font:600 10px Inter,sans-serif;flex:none">${esc(fmt.initials(m.sender_name || '?'))}</span>
            <span style="flex:1;min-width:0">
              <span style="font-size:12.5px;font-weight:600">${esc(m.sender_name || 'Teammate')} <span style="font:400 10px Inter,sans-serif;color:#6d6459;margin-left:6px">${whenShort(m.created_at)} ${esc(String(m.created_at || '').slice(11, 16))}</span></span>
              ${m.reply_message ? `<span style="display:block;font-size:11px;color:#6d6459;border-left:2px solid #c9a962;padding-left:8px;margin-top:3px">↩ ${esc((m.reply_sender_name ? m.reply_sender_name + ': ' : '') + String(m.reply_message).slice(0, 90))}</span>` : ''}
              ${m.message ? `<span style="display:block;font-size:13px;line-height:1.5;margin-top:2px;${m.kind === 'system' ? 'color:#6d6459;font-style:italic' : ''}">${esc(m.message)}</span>` : ''}
              ${(m.attachments || []).map(a => a.kind === 'image'
                ? `<a href="${esc(a.url)}" target="_blank" rel="noopener" style="display:block;margin-top:6px"><img src="${esc(a.url)}" alt="${esc(a.name || 'image')}" style="max-width:260px;max-height:180px;border:1px solid rgba(32,27,22,.14);display:block"></a>`
                : `<a href="${esc(a.url)}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:6px;margin-top:6px;padding:6px 10px;border:1px solid rgba(32,27,22,.2);font:600 9px Inter,sans-serif;letter-spacing:.1em;color:#201b16;white-space:nowrap">⊕ ${esc(a.name || 'FILE')}</a>`).join('')}
              ${pollBlock(m)}
            </span>
            ${m.kind !== 'system' ? `<span data-act="chReplyPick" data-id="${esc(m.id)}" data-who="${esc(m.sender_name || 'Teammate')}" data-text="${esc(String(m.message || '').slice(0, 60))}" title="Reply to this message" style="font:600 11px Inter,sans-serif;color:#c9beb2;cursor:pointer;flex:none" data-hover="color:#9b1b22">↩</span>` : ''}
          </div>`).join('')}
        </div>
        ${st.replyTo ? `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 20px;border-top:1px solid rgba(32,27,22,.12);background:#fdfbf6">
          <span style="font-size:11.5px;color:#6d6459;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.replying} <b>${esc(st.replyTo.who)}: “${esc(st.replyTo.text)}${st.replyTo.text.length >= 60 ? '…' : ''}”</b></span>
          <span data-act="clearReply" style="font:600 10px Inter,sans-serif;color:#6d6459;cursor:pointer" data-hover="color:#9b1b22">✕</span>
        </div>` : ''}
        <div style="padding:14px 20px;border-top:1px solid rgba(32,27,22,.12);display:flex;gap:10px">
          <label title="${esc(c.attachTitle)}" style="padding:10px 12px;border:1px solid rgba(32,27,22,.2);font:600 12px Inter,sans-serif;color:#6d6459;cursor:pointer;display:flex;align-items:center" data-hover="border-color:#201b16;color:#201b16">⊕<input type="file" data-role="chFile" style="display:none"></label>
          <input data-role="chDraft" value="${esc(st.chDraft)}" placeholder="${esc(c.msgPh(name))}" aria-label="Message" style="flex:1;${INPUT};padding:10px 12px">
          <span data-act="chSend" style="padding:10px 16px;background:#201b16;color:#f6f2ea;font:600 10px Inter,sans-serif;letter-spacing:.14em;cursor:pointer;display:flex;align-items:center" data-hover="background:#000">${c.send}</span>
        </div>
      </div>`;
}
function tabChat() {
  return `
    <!-- dc: Admin Inbox.dc.html › "TEAM CHAT" -->
    <div class="mx-inbox-split" data-block="chat" style="display:grid;grid-template-columns:250px 1fr;gap:22px;align-items:start">
      ${blockChannels()}
      ${blockChatPane()}
    </div>
    <!-- /dc -->`;
}

// ---------------------------------------------------------------- template + wiring
function template() {
  const body = st.tab === 'outbox' ? tabOutbox()
    : st.tab === 'messages' ? tabMessages()
    : st.tab === 'announce' ? tabAnnounce()
    : st.tab === 'news' ? tabNews()
    : tabChat();
  return `
<div data-screen-label="Admin Inbox" style="min-height:100vh;background:#f6f2ea;color:#201b16;font-family:Inter,sans-serif">
  <div class="mx-gutter" style="max-width:1180px;margin:0 auto;padding:30px 28px 48px;display:flex;flex-direction:column;gap:22px">
    ${blockTitle()}
    ${blockTabs()}
    ${body}
  </div>
</div>`;
}
function rerender(sel, html) { const el = rootEl && rootEl.querySelector(sel); if (el) { el.outerHTML = html; wire(); } }
function readRole(name) { const el = rootEl && rootEl.querySelector(`[data-role="${name}"]`); return el ? el.value : ''; }
function isChecked(name) { const el = rootEl && rootEl.querySelector(`[data-role="${name}"]`); return !!(el && el.checked); }

function wire() {
  if (!rootEl) return;
  const on = (role, ev, fn) => { const el = rootEl.querySelector(`[data-role="${role}"]`); if (el && !el._mx) { el._mx = 1; el.addEventListener(ev, fn); } };
  // live email preview
  on('qBody', 'input', e => { st.body = e.target.value; const p = rootEl.querySelector('[data-role="previewBody"]'); if (p) p.textContent = st.body.trim() || COPY.compose.previewEmpty; });
  on('qSubject', 'input', e => { st.subject = e.target.value; });
  on('qAudience', 'change', e => { st.audience = e.target.value; if (!st.manual) rerender('[data-block="compose"]', blockCompose()); else { const n = rootEl.querySelector('[data-role="audienceNote"]'); if (n) n.textContent = COPY.compose.note(filteredPeople().length); } });
  on('qFilter', 'change', e => { st.filter = e.target.value; if (!st.manual) { const n = rootEl.querySelector('[data-role="audienceNote"]'); if (n) n.textContent = COPY.compose.note(filteredPeople().length); } });
  // live bell preview
  on('annTitle', 'input', e => { st.annTitle = e.target.value; const p = rootEl.querySelector('[data-role="annPrevTitle"]'); if (p) p.textContent = st.annTitle.trim() || COPY.announce.prevTitle; });
  on('annBody', 'input', e => { st.annBody = e.target.value; const p = rootEl.querySelector('[data-role="annPrevBody"]'); if (p) p.textContent = st.annBody.trim() || COPY.announce.prevBody; });
  on('annWho', 'change', e => { st.annWho = e.target.value; const p = rootEl.querySelector('[data-role="annPrevMeta"]'); if (p) p.textContent = COPY.announce.justNow(annAudienceLabel()); });
  on('annLink', 'input', e => { st.annLink = e.target.value; });
  on('annUntil', 'change', e => { st.annUntil = e.target.value; });
  on('nlSubject', 'input', e => { st.nlSubject = e.target.value; });
  on('nlBody', 'input', e => { st.nlBody = e.target.value; });
  on('nlTopic', 'change', e => { st.nlTopic = e.target.value; });
  // MEMBER-BOUND reply box: Enter is a NEWLINE and the SEND button is the only way out (audit #4).
  // These replies leave the building — a half-typed line must never reach a member because a key
  // was hit while thinking. Team chat below keeps Enter-to-send: that one stays inside the team.
  // The draft survives re-renders via st.replyDraft.
  on('reply', 'input', e => { st.replyDraft = e.target.value; });
  on('msgFile', 'change', e => handlers.msgFilePicked(e.target));
  on('chDraft', 'input', e => { st.chDraft = e.target.value; });
  on('chDraft', 'keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handlers.chSend(); } });
  on('chNew', 'input', e => { st.chNew = e.target.value; });
  on('chNew', 'keydown', e => { if (e.key === 'Enter') { e.preventDefault(); handlers.chCreate(); } });
  on('chFile', 'change', e => handlers.chFilePicked(e.target));
  const log = rootEl.querySelector('[data-role="chLog"]'); if (log) log.scrollTop = log.scrollHeight;
  const mlog = rootEl.querySelector('[data-role="msgLog"]'); if (mlog) mlog.scrollTop = mlog.scrollHeight;
}

async function reloadOutbox() {
  const r = await api.settle({ pending: api.get('/api/admin/outbox?status=pending_approval'), scheduled: api.get('/api/admin/outbox?status=scheduled'), badges: api.get('/api/v2/inbox/badges') });
  if (!rootEl) return;
  D.pending = r.pending && Array.isArray(r.pending.batches) ? r.pending.batches : [];
  D.deferred = r.scheduled ? futureBatches(r.scheduled.batches) : [];
  if (r.badges) D.badges = r.badges;
  rerender('[data-block="waiting"]', blockWaiting());
  rerender('[data-block="tabs"]', blockTabs());
  chrome.refresh();
}
async function reloadThreads(keepOpen = true) {
  const r = await api.settle({ threads: api.get('/api/v2/inbox/threads'), badges: api.get('/api/v2/inbox/badges') });
  if (!rootEl) return;
  D.threads = r.threads && Array.isArray(r.threads.threads) ? r.threads.threads : [];
  if (r.badges) D.badges = r.badges;
  D.needsReply = countNeedsReply(D.threads);   // the tab badge follows the list we just loaded
  if (!keepOpen || !D.threads.some(t => t.key === st.openKey)) st.openKey = null;
  rerender('[data-block="messages"]', tabMessages());
  rerender('[data-block="tabs"]', blockTabs());
  chrome.refresh();
}
async function openThreadByKey(key) {
  st.openKey = key; st.thread = [];
  rerender('[data-block="messages"]', tabMessages());
  try {
    const msgs = await api.get('/api/admin/messages/' + encodeURIComponent(key));   // marks inbound read server-side
    if (!rootEl || st.openKey !== key) return;
    st.thread = Array.isArray(msgs) ? msgs : [];
    const t = openThreadObj(); if (t) t.unread = 0;
    D.badges.unread_messages = D.threads.reduce((n, x) => n + (x.archived ? 0 : x.unread), 0);
    D.needsReply = countNeedsReply(D.threads);   // opening a thread clears its unread, not its "needs a reply"
    rerender('[data-block="messages"]', tabMessages());
    rerender('[data-block="tabs"]', blockTabs());
    chrome.refresh();
  } catch (e) { ui.toast(e.message, { kind: 'error' }); }
}
async function loadChat(channelId) {
  const open = D.chatChannels.find(c => c.id === channelId) || openChannel();
  if (!open) return;
  st.chOpen = open.id;
  try {
    const msgs = await api.get('/api/teamchat/messages?channel_id=' + encodeURIComponent(open.id));
    if (!rootEl || st.chOpen !== open.id) return;
    st.chMsgs = Array.isArray(msgs) ? msgs : [];
    api.post('/api/teamchat/read', { channel_id: open.id }).catch(() => {});
    open.unread = 0;
    D.chatUnread = [...D.chatChannels, ...((D.chat && D.chat.dms) || [])].reduce((n, c) => n + Number(c.unread || 0), 0);
    rerender('[data-block="chat"]', tabChat());
    rerender('[data-block="tabs"]', blockTabs());
  } catch (e) { ui.toast(e.message, { kind: 'error' }); }
}
async function reloadChatOverview(openId) {
  try {
    const o = await api.get('/api/teamchat/overview');
    if (!rootEl) return;
    D.chat = o;
    D.chatChannels = [...(o.channels || [])].filter(c => String(c.name || '').indexOf('dm:') !== 0);
    D.chatUnread = [...(o.channels || []), ...(o.dms || [])].reduce((n, c) => n + Number(c.unread || 0), 0);
    await loadChat(openId || st.chOpen);
  } catch (e) { /* overview refresh is best-effort */ }
}

// ---------------------------------------------------------------- SAVED REPLIES modal (member messages)
// v2_canned_replies via /api/v2/inbox/canned — pick one into the reply box, or manage them in place.
function cannedForm(r) {
  const m = COPY.messages;
  return `
    <div style="display:flex;flex-direction:column;gap:8px;padding:10px 2px;border-bottom:1px solid rgba(32,27,22,.08)">
      <input data-role="cnTitle" value="${esc(r ? r.title : '')}" placeholder="${esc(m.savedTitlePh)}" aria-label="Title" style="${INPUT}">
      <textarea data-role="cnBody" rows="6" placeholder="${esc(m.savedBodyPh)}" aria-label="Reply text" style="${INPUT};resize:vertical">${esc(r ? r.body : '')}</textarea>
      <div style="display:flex;gap:10px">
        <span data-act="cannedSave" data-id="${esc(r ? r.id : '')}" style="padding:8px 14px;background:#201b16;color:#f6f2ea;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer">${m.savedSave}</span>
        <span data-act="cannedCancel" style="padding:8px 14px;border:1px solid rgba(32,27,22,.2);font:600 9.5px Inter,sans-serif;letter-spacing:.13em;color:#6d6459;cursor:pointer">${m.savedCancel}</span>
      </div>
    </div>`;
}
function cannedModalBody(mst) {
  const m = COPY.messages;
  const list = st.canned || [];
  const rows = list.map(r => mst.editing === r.id ? cannedForm(r) : `
    <div style="display:flex;gap:10px;align-items:flex-start;padding:10px 2px;border-bottom:1px solid rgba(32,27,22,.08)">
      <span data-act="cannedUse" data-id="${esc(r.id)}" role="button" tabindex="0" style="flex:1;min-width:0;cursor:pointer">
        <span style="display:block;font-size:13px;font-weight:600;color:#201b16">${esc(r.title)}</span>
        <span style="display:block;font-size:11.5px;color:#6d6459;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(String(r.body).replace(/\s+/g, ' ').slice(0, 90))}</span>
      </span>
      <span data-act="cannedUse" data-id="${esc(r.id)}" style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#9b1b22;cursor:pointer;white-space:nowrap">${m.savedUse}</span>
      <span data-act="cannedEdit" data-id="${esc(r.id)}" style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#6d6459;cursor:pointer;white-space:nowrap" data-hover="color:#201b16">${m.savedEdit}</span>
      <span data-act="cannedDel" data-id="${esc(r.id)}" style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:${mst.confirmDel === r.id ? '#9b1b22' : '#6d6459'};cursor:pointer;white-space:nowrap" data-hover="color:#9b1b22">${mst.confirmDel === r.id ? m.savedSureDel : m.savedDel}</span>
    </div>`).join('');
  return `
    <div style="display:flex;flex-direction:column">
      <span style="font-size:12px;color:#6d6459;padding-bottom:6px">${m.savedSub}</span>
      ${rows}
      ${!list.length && mst.editing !== 'new' ? `<div style="padding:12px 2px;font-size:12.5px;color:#6d6459">${m.savedEmpty}</div>` : ''}
      ${mst.editing === 'new' ? cannedForm(null) : `<div style="padding:12px 2px 2px"><span data-act="cannedNew" style="font:600 9.5px Inter,sans-serif;letter-spacing:.13em;color:#9b1b22;cursor:pointer">${m.savedNew}</span></div>`}
    </div>`;
}
function openCannedModal() {
  const m = COPY.messages;
  const mst = { editing: null, confirmDel: null };
  const wrap = ui.modal({ eyebrow: m.savedEyebrow, title: m.savedTitle, body: cannedModalBody(mst) });
  const repaint = () => {
    const b = wrap.el.querySelector('.mx-modal-body');
    if (b) b.innerHTML = `<div class="mx-modal-title">${m.savedTitle}</div>` + cannedModalBody(mst);
  };
  ui.bind(wrap.el, {
    cannedUse: (el) => {
      const r = (st.canned || []).find(x => x.id === el.dataset.id); if (!r) return;
      const t = openThreadObj();
      const first = t ? String(t.name || '').trim().split(/\s+/)[0] : '';
      const text = String(r.body).replace(/\{first_name\}/g, first || 'there');
      const ta = rootEl && rootEl.querySelector('[data-role="reply"]');
      const cur = (ta ? ta.value : (st.replyDraft || '')).replace(/\s+$/, '');
      st.replyDraft = cur ? cur + '\n\n' + text : text;
      if (ta) { ta.value = st.replyDraft; }
      wrap.close();
      if (ta) ta.focus();
    },
    cannedNew: () => { mst.editing = 'new'; mst.confirmDel = null; repaint(); },
    cannedEdit: (el) => { mst.editing = el.dataset.id; mst.confirmDel = null; repaint(); },
    cannedCancel: () => { mst.editing = null; repaint(); },
    cannedSave: async (el) => {
      const id = el.dataset.id;
      const title = ((wrap.el.querySelector('[data-role="cnTitle"]') || {}).value || '').trim();
      const body = ((wrap.el.querySelector('[data-role="cnBody"]') || {}).value || '').trim();
      try {
        if (id) await api.put('/api/v2/inbox/canned/' + encodeURIComponent(id), { title, body });
        else await api.post('/api/v2/inbox/canned', { title, body });
        const r = await api.get('/api/v2/inbox/canned');
        st.canned = (r && r.replies) || [];
        mst.editing = null;
        ui.toast(m.savedSaved);
        repaint();
      } catch (e) { ui.toast(e.message, { kind: 'error' }); }
    },
    cannedDel: async (el) => {
      const id = el.dataset.id;
      if (mst.confirmDel !== id) { mst.confirmDel = id; repaint(); return; }
      try {
        await api.del('/api/v2/inbox/canned/' + encodeURIComponent(id));
        st.canned = (st.canned || []).filter(x => x.id !== id);
        mst.confirmDel = null;
        ui.toast(m.savedDeleted);
        repaint();
      } catch (e) { ui.toast(e.message, { kind: 'error' }); }
    }
  });
}

// ---------------------------------------------------------------- handlers
const handlers = {
  // ----- outbox -----
  approve: async (el) => {
    const batch = el.dataset.batch; const count = Number(el.dataset.count) || 0;
    el.setAttribute('aria-disabled', 'true');
    try {
      await api.post('/api/admin/outbox/' + encodeURIComponent(batch) + '/approve', {});
      ui.toast(COPY.outbox.sent(count));
      st.previewBatch = null; st.discardConfirm = null;
      await reloadOutbox();
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  approveAll: async (el) => {
    const kind = el.dataset.kind;
    const items = D.pending.filter(b => (KIND_OF_ENGINE[b.source_engine] || 'other') === kind);
    if (!items.length) return;
    el.setAttribute('aria-disabled', 'true');
    let emails = 0, ok = 0;
    for (const b of items) {
      try { await api.post('/api/admin/outbox/' + encodeURIComponent(b.batch_id) + '/approve', {}); ok++; emails += Number(b.count) || 0; }
      catch (e) { ui.toast(e.message, { kind: 'error' }); }
    }
    if (ok) ui.toast(COPY.outbox.sentAll(ok, emails));
    await reloadOutbox();
  },
  // Bulk DISCARD for piled-up weekly pulses (audit #6). It cancels ONLY the batches that are
  // sitting in this pending group — the same POST /api/admin/outbox/:batch/cancel the per-row
  // DISCARD uses, which by definition touches rows still in 'pending_approval'. Anything already
  // approved, scheduled or sent is not in D.pending and is never addressed here, so DRAFTS &
  // HISTORY keeps its record. The confirm names the count and says plainly that nothing is sent.
  discardAllPulse: async (el) => {
    const items = D.pending.filter(b => (KIND_OF_ENGINE[b.source_engine] || 'other') === 'pulse');
    if (!items.length) return;
    const ok = await ui.confirm({
      eyebrow: COPY.outbox.discardAllEyebrow,
      title: COPY.outbox.discardAllTitle,
      body: COPY.outbox.discardAllBody(items.length),
      ok: COPY.outbox.discardAll(items.length),
      cancel: COPY.outbox.discardAllCancel
    });
    if (!ok) return;
    el.setAttribute('aria-disabled', 'true');
    let done = 0;
    for (const b of items) {
      try { await api.post('/api/admin/outbox/' + encodeURIComponent(b.batch_id) + '/cancel', {}); done++; }
      catch (e) { ui.toast(e.message, { kind: 'error' }); }
    }
    st.discardConfirm = null; st.previewBatch = null;
    if (done) ui.toast(COPY.outbox.discardedAll(done));
    await reloadOutbox();
  },
  later: async (el) => {
    const batch = el.dataset.batch;
    const d = new Date(); d.setDate(d.getDate() + 1);
    const when = fmt.ymd(d) + ' 09:00:00';
    el.setAttribute('aria-disabled', 'true');
    try {
      await api.post('/api/admin/outbox/' + encodeURIComponent(batch) + '/approve', { scheduled_for: when });
      ui.toast(COPY.outbox.scheduled);
      await reloadOutbox();
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  cancelLater: async (el) => {
    const batch = el.dataset.batch;
    el.setAttribute('aria-disabled', 'true');
    try { await api.post('/api/v2/inbox/outbox/' + encodeURIComponent(batch) + '/unschedule', {}); ui.toast(COPY.outbox.backToWaiting); await reloadOutbox(); }
    catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  discard: async (el) => {
    const batch = el.dataset.batch;
    if (st.discardConfirm !== batch) { st.discardConfirm = batch; rerender('[data-block="waiting"]', blockWaiting()); return; }
    try {
      await api.post('/api/admin/outbox/' + encodeURIComponent(batch) + '/cancel', {});
      st.discardConfirm = null; st.previewBatch = null;
      ui.toast(COPY.outbox.discarded);
      await reloadOutbox();
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  preview: async (el) => {
    const batch = el.dataset.batch;
    if (st.previewBatch === batch) { st.previewBatch = null; st.previewData = null; st.editOpen = false; rerender('[data-block="waiting"]', blockWaiting()); return; }
    st.previewBatch = batch; st.previewData = null; st.editOpen = false;
    rerender('[data-block="waiting"]', blockWaiting());
    try {
      const p = await api.get('/api/v2/inbox/outbox/' + encodeURIComponent(batch));
      if (st.previewBatch !== batch) return;
      st.previewData = p;
      st.editSubject = (p.preview && p.preview.subject) || '';
      st.editBody = (p.preview && p.preview.body_text) || '';
      rerender('[data-block="waiting"]', blockWaiting());
    } catch (e) { st.previewBatch = null; ui.toast(e.message, { kind: 'error' }); rerender('[data-block="waiting"]', blockWaiting()); }
  },
  editToggle: () => { st.editOpen = !st.editOpen; rerender('[data-block="waiting"]', blockWaiting()); },
  editSave: async (el) => {
    const batch = el.dataset.batch;
    const subject = readRole('editSubject').trim(); const body = readRole('editBody').trim();
    el.setAttribute('aria-disabled', 'true');
    try {
      await api.post('/api/v2/inbox/outbox/' + encodeURIComponent(batch) + '/edit', { subject, body });
      st.editOpen = false; st.previewData = null;
      ui.toast(COPY.outbox.edited);
      const p = await api.get('/api/v2/inbox/outbox/' + encodeURIComponent(batch));
      st.previewData = p; await reloadOutbox();
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  // ----- compose -----
  manualTg: () => {
    st.manual = !st.manual;
    if (st.manual && !st.picked.size) filteredPeople().forEach(p => st.picked.add(p.key));
    rerender('[data-block="compose"]', blockCompose());
  },
  pickTg: (el) => {
    const k = el.dataset.key;
    if (st.picked.has(k)) st.picked.delete(k); else st.picked.add(k);
    el.checked = st.picked.has(k);          // ui.bind preventDefault()s the click — reflect the tick by hand
    const n = rootEl.querySelector('[data-role="audienceNote"]'); if (n) n.textContent = COPY.compose.noteManual(pickCount());
    const chipNote = rootEl.querySelector('[data-block="compose"] [data-act="manualTg"] + span'); if (chipNote) chipNote.textContent = COPY.compose.manualOn(pickCount(), rootEl.querySelectorAll('[data-act="pickTg"]').length);
  },
  queueEmail: async (el) => {
    st.subject = readRole('qSubject').trim(); st.body = readRole('qBody');
    if (!st.subject && !st.body.trim()) { ui.toast(COPY.compose.writeFirst); return; }
    el.setAttribute('aria-disabled', 'true');
    try {
      const r = await api.post('/api/v2/inbox/compose', {
        subject: st.subject, body: st.body.trim(),
        audience: currentAudience().key, filter: st.filter,
        manual: st.manual, picked: st.manual ? Array.from(st.picked) : []
      });
      st.subject = ''; st.body = ''; st.manual = false; st.picked = new Set();
      ui.toast(COPY.compose.queued + (r && r.queued ? ` · ${r.queued}` : ''));
      rerender('[data-block="compose"]', blockCompose());
      await reloadOutbox();
      const w = rootEl.querySelector('[data-block="waiting"]'); if (w) w.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
    el.removeAttribute('aria-disabled');
  },
  sendTest: async (el) => {
    const subject = readRole('qSubject').trim(); const body = readRole('qBody').trim();
    if (!subject && !body) { ui.toast(COPY.compose.writeFirst); return; }
    el.setAttribute('aria-disabled', 'true');
    try { const r = await api.post('/api/v2/inbox/compose', { subject, body, test: true }); ui.toast(COPY.compose.testSent(r.to || 'you')); }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
    el.removeAttribute('aria-disabled');
  },
  // ----- messages -----
  msgNeeds: () => { st.msgFilter = 'needs'; rerender('[data-block="messages"]', tabMessages()); },
  msgAll: () => { st.msgFilter = 'all'; rerender('[data-block="messages"]', tabMessages()); },
  openThread: (el) => openThreadByKey(el.dataset.key),
  toggleRead: async () => {
    const t = openThreadObj(); if (!t) return;
    const read = t.unread > 0;
    try {
      await api.post('/api/v2/inbox/threads/' + encodeURIComponent(t.key) + '/read', { read });
      await reloadThreads();
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  archiveThread: async () => {
    const t = openThreadObj(); if (!t) return;
    const toArchived = !t.archived;
    try {
      await api.post('/api/v2/inbox/threads/' + encodeURIComponent(t.key) + '/archive', { archived: toArchived });
      await reloadThreads();
      if (toArchived) ui.toast(COPY.messages.archivedToast, { undo: async () => { try { await api.post('/api/v2/inbox/threads/' + encodeURIComponent(t.key) + '/archive', { archived: false }); } catch (e) {} if (rootEl) reloadThreads(); } });
      else ui.toast(COPY.messages.unarchivedToast);
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  // reply goes through the v2 route so the row carries sender_name ("Laura · Med&X" on the
  // member's side) and an optional attachment; upload first, then post (teamchat pattern)
  sendReply: async (el) => {
    const t = openThreadObj(); if (!t || st.replySending) return;
    const text = readRole('reply').trim();
    if (!text && !st.msgAttach) return;
    st.replySending = true;
    if (el && el.setAttribute) el.setAttribute('aria-disabled', 'true');
    try {
      let att = null;
      if (st.msgAttach) {
        const fd = new FormData(); fd.append('file', st.msgAttach);
        att = await api.post('/api/v2/messages/attach', fd);
      }
      await api.post('/api/v2/inbox/threads/' + encodeURIComponent(t.key) + '/reply', {
        body: text,
        attachment_path: att ? att.attachment_path : undefined,
        attachment_name: att ? att.attachment_name : undefined
      });
      st.replyDraft = ''; st.msgAttach = null; st.replySending = false;
      await openThreadByKey(t.key);
      ui.toast(COPY.messages.sentToast);
    } catch (e) {
      st.replySending = false;
      if (el && el.removeAttribute) el.removeAttribute('aria-disabled');
      ui.toast(e.message, { kind: 'error' });
    }
  },
  msgFilePicked: (input) => {                       // validate client-side; the backend re-checks
    const f = input && input.files && input.files[0];
    if (input) input.value = '';
    if (!f) return;
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'].includes(f.type)) return ui.toast(COPY.messages.attachBadType, { kind: 'error' });
    if (f.size > 5 * 1024 * 1024) return ui.toast(COPY.messages.attachTooBig, { kind: 'error' });
    st.replyDraft = readRole('reply');
    st.msgAttach = f;
    rerender('[data-block="conv"]', blockConversation());
  },
  attachClear: () => { st.replyDraft = readRole('reply'); st.msgAttach = null; rerender('[data-block="conv"]', blockConversation()); },
  cannedOpen: async () => {
    if (!st.canned) {
      try { const r = await api.get('/api/v2/inbox/canned'); st.canned = (r && r.replies) || []; }
      catch (e) { return ui.toast(e.message, { kind: 'error' }); }
    }
    openCannedModal();
  },
  // ----- announcements -----
  annPublish: async (el) => {
    st.annTitle = readRole('annTitle').trim(); st.annBody = readRole('annBody').trim();
    st.annLink = readRole('annLink').trim(); st.annWho = readRole('annWho') || 'all'; st.annUntil = readRole('annUntil');
    st.annPush = isChecked('annPush');
    if (!st.annTitle) { ui.toast(COPY.announce.titleFirst); return; }
    let expires = null;
    if (st.annUntil === '7' || st.annUntil === '14') { const d = new Date(); d.setDate(d.getDate() + Number(st.annUntil)); expires = fmt.ymd(d) + ' 23:59:59'; }
    else if (st.annUntil === 'event') expires = FACTS.plexus.start + ' 23:59:59';
    el.setAttribute('aria-disabled', 'true');
    try {
      await api.post('/api/admin/notifications/send', {
        user_group: st.annWho, category: 'announcement',
        project: st.annWho === 'all' ? null : st.annWho,
        title: st.annTitle, message: st.annBody, link: st.annLink || null,
        expires_at: expires, send_push: st.annPush, icon: 'fa-bullhorn'
      });
      st.annTitle = ''; st.annBody = ''; st.annLink = ''; st.annPush = false;
      ui.toast(COPY.announce.published);
      const r = await api.settle({ recent: api.get('/api/admin/notifications/user-notifications?limit=100') });
      if (r.recent && Array.isArray(r.recent.notifications)) D.recent = r.recent.notifications;
      rerender('[data-block="announcer"]', blockAnnouncer());
      rerender('[data-block="recentAnn"]', blockRecentAnn());
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
    el.removeAttribute('aria-disabled');
  },
  annRemove: async (el) => {
    const id = el.dataset.id;
    if (st.annConfirm !== id) { st.annConfirm = id; rerender('[data-block="recentAnn"]', blockRecentAnn()); return; }
    try {
      await api.del('/api/admin/notifications/user-notifications/' + encodeURIComponent(id));
      st.annConfirm = null;
      D.recent = D.recent.filter(r => r.id !== id);
      ui.toast(COPY.announce.removed);
      rerender('[data-block="recentAnn"]', blockRecentAnn());
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  // ----- newsletter -----
  nlOpen: () => { st.nlCompose = true; st.nlReplace = null; rerender('[data-block="nlcompose"]', blockNlCompose()); },
  nlClose: () => { st.nlCompose = false; rerender('[data-block="nlcompose"]', blockNlCompose()); },
  nlEdit: async (el) => {
    const batch = el.dataset.batch;
    try {
      const p = await api.get('/api/v2/inbox/outbox/' + encodeURIComponent(batch));
      st.nlCompose = true; st.nlReplace = batch;
      st.nlSubject = ((p.preview && p.preview.subject) || '').replace(/^\[Portal post\] /, '');
      st.nlBody = (p.preview && p.preview.body_text) || '';
      rerender('[data-block="nlcompose"]', blockNlCompose());
      const c = rootEl.querySelector('[data-block="nlcompose"]'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  nlQueue: async (el) => {
    st.nlSubject = readRole('nlSubject').trim(); st.nlBody = readRole('nlBody');
    const body = { subject: st.nlSubject, body: st.nlBody.trim(), topic: readRole('nlTopic') || 'all', email: isChecked('nlEmail'), portal: isChecked('nlPortal'), replace_batch: st.nlReplace || undefined };
    el.setAttribute('aria-disabled', 'true');
    try {
      await api.post('/api/v2/inbox/newsletter/queue', body);
      st.nlCompose = false; st.nlSubject = ''; st.nlBody = ''; st.nlReplace = null;
      ui.toast(COPY.news.queued);
      router.navigate('/inbox/outbox');
      return;
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
    el.removeAttribute('aria-disabled');
  },
  // ----- team chat -----
  chOpenC: (el, ev) => { if (ev.target.closest('[data-act="chDel"]')) return; st.chDelConfirm = null; st.replyTo = null; loadChat(el.dataset.id); },
  chAddToggle: () => { st.chAdding = !st.chAdding; rerender('[data-block="channels"]', blockChannels()); if (st.chAdding) { const i = rootEl.querySelector('[data-role="chNew"]'); if (i) i.focus(); } },
  chCreate: async () => {
    const name = readRole('chNew').trim();
    if (!name) { ui.toast(COPY.chat.nameFirst); return; }
    try {
      const r = await api.post('/api/teamchat/channels', { name });
      st.chAdding = false; st.chNew = '';
      ui.toast(COPY.chat.created(name));
      await reloadChatOverview(r && r.id);
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  chDel: async (el, ev) => {
    if (ev && ev.stopPropagation) ev.stopPropagation();
    const id = el.dataset.id;
    if (st.chDelConfirm !== id) { st.chDelConfirm = id; rerender('[data-block="channels"]', blockChannels()); return; }
    try {
      await api.del('/api/teamchat/channels/' + encodeURIComponent(id));
      st.chDelConfirm = null;
      if (st.chOpen === id) st.chOpen = null;
      ui.toast(COPY.chat.deleted);
      await reloadChatOverview();
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  chReplyPick: (el) => { st.replyTo = { id: el.dataset.id, who: el.dataset.who, text: el.dataset.text }; rerender('[data-block="chat"]', tabChat()); const i = rootEl.querySelector('[data-role="chDraft"]'); if (i) i.focus(); },
  clearReply: () => { st.replyTo = null; rerender('[data-block="chat"]', tabChat()); },
  chSend: async () => {
    const open = openChannel(); if (!open) return;
    const text = readRole('chDraft').trim();
    if (!text) return;
    try {
      await api.post('/api/teamchat/messages', { channel_id: open.id, message: text, reply_to: st.replyTo ? st.replyTo.id : null });
      st.chDraft = ''; st.replyTo = null;
      await loadChat(open.id);
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  chFilePicked: async (input) => {
    const open = openChannel(); const f = input && input.files && input.files[0];
    if (!open || !f) return;
    const fd = new FormData(); fd.append('file', f);
    try {
      const up = await api.post('/api/teamchat/upload', fd);
      await api.post('/api/teamchat/messages', { channel_id: open.id, message: '', reply_to: st.replyTo ? st.replyTo.id : null, attachment: up });
      st.replyTo = null;
      ui.toast(COPY.chat.filePosted);
      await loadChat(open.id);
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  proposeMeeting: () => {
    const open = openChannel(); if (!open) return;
    const c = COPY.chat;
    const pad = n => String(n).padStart(2, '0');
    const slot = (addDays, h, m) => { const d = new Date(); d.setDate(d.getDate() + addDays); return `${fmt.ymd(d)}T${pad(h)}:${pad(m)}`; };
    const defaults = [slot(2, 14, 0), slot(3, 9, 30), slot(4, 16, 0)];
    ui.modal({
      eyebrow: 'TEAM CHAT · # ' + chatChannelName(open).toUpperCase(),
      title: c.meetTitle,
      body: `
        <div style="display:flex;flex-direction:column;gap:10px">
          <label style="display:flex;flex-direction:column;gap:5px"><span style="${LABEL}">${c.meetName}</span><input data-role="meetTitle" value="" placeholder="${esc(c.meetNamePh)}" class="input" style="${INPUT}"></label>
          <span style="${LABEL}">${c.meetTimes}</span>
          ${defaults.map((d, i) => `<input data-role="meetT${i}" type="datetime-local" value="${d}" style="${INPUT}">`).join('')}
        </div>`,
      actions: [
        { label: 'CANCEL' },
        { label: c.meetGo, kind: 'primary', onClick: () => {
          const wrap = document.querySelector('.mx-modal');
          const title = wrap.querySelector('[data-role="meetTitle"]').value.trim() || 'Team meeting';
          const options = [0, 1, 2].map(i => wrap.querySelector(`[data-role="meetT${i}"]`).value).filter(Boolean);
          if (options.length < 2) { ui.toast('PICK AT LEAST TWO CANDIDATE TIMES'); return false; }
          api.post('/api/teamchat/polls', { channel_id: open.id, title, options, duration_min: 60 })
            .then(() => { ui.toast(COPY.chat.pollPosted(chatChannelName(open))); loadChat(open.id); })
            .catch(e => ui.toast(e.message, { kind: 'error' }));
        } }
      ]
    });
  },
  pollVote: async (el) => {
    try { await api.post('/api/teamchat/polls/' + encodeURIComponent(el.dataset.poll) + '/vote', { option_index: Number(el.dataset.i) }); await loadChat(st.chOpen); }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  pollClose: async (el) => {
    const ok = await ui.confirm({ eyebrow: 'MEETING POLL', title: 'Close the poll?', body: 'The winning time is confirmed and calendar invites are QUEUED IN THE OUTBOX — they only send after your Approve there.', ok: 'CLOSE & QUEUE', cancel: 'KEEP VOTING' });
    if (!ok) return;
    try {
      await api.post('/api/teamchat/polls/' + encodeURIComponent(el.dataset.poll) + '/close', {});
      ui.toast(COPY.chat.pollClosed);
      await loadChat(st.chOpen);
      chrome.refresh();
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  }
};

export default {
  title: 'Inbox',
  async render(root, ctx) {
    rootEl = root;
    if (!document.getElementById('mx-css-inbox')) {
      const l = document.createElement('link');
      l.id = 'mx-css-inbox'; l.rel = 'stylesheet'; l.href = '/css/views/inbox.css';
      document.head.appendChild(l);
    }
    const tab = SLUG_TO_TAB[String((ctx.params && ctx.params.tab) || '').toLowerCase()] || 'outbox';
    st = {
      tab, focusCompose: String((ctx.params && ctx.params.tab) || '') === 'email',
      audience: 'everyone', filter: '', manual: false, picked: new Set(), subject: '', body: '',
      msgFilter: 'needs', openKey: null, thread: [], replyDraft: '', msgAttach: null, replySending: false, canned: null,
      annWho: 'all', annTitle: '', annBody: '', annLink: '', annUntil: '', annPush: false, annConfirm: null,
      nlCompose: false, nlSubject: '', nlBody: '', nlTopic: 'all', nlEmail: true, nlPortal: true, nlReplace: null,
      chOpen: null, chAdding: false, chNew: '', chDraft: '', chMsgs: [], replyTo: null, chDelConfirm: null,
      previewBatch: null, previewData: null, editOpen: false, editSubject: '', editBody: '', discardConfirm: null
    };
    D = await load(tab);
    if (rootEl !== root) return;          // navigated away while loading
    root.innerHTML = template();
    unbind = ui.bind(root, handlers);
    wire();
    if (tab === 'messages') {
      const first = visibleThreads()[0] || D.threads[0];
      if (first) openThreadByKey(first.key);
    }
    if (tab === 'chat') {
      const general = D.chatChannels.find(c => Number(c.is_default)) || D.chatChannels.find(c => (c.display_name || c.name) === 'general') || D.chatChannels[0];
      if (general) loadChat(general.id);
      const poll = setInterval(() => { if (rootEl && st && st.tab === 'chat' && st.chOpen && !document.hidden) loadChat(st.chOpen); }, 8000);
      timers.push(() => clearInterval(poll));
    }
    if (st.focusCompose) { const c = root.querySelector('#compose'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    chrome.refresh();
  },
  destroy() {
    timers.forEach(stop => { try { stop(); } catch (e) {} }); timers = [];
    if (unbind) unbind(); unbind = null; rootEl = null; D = null; st = null;
  }
};
