// Source: Network.dc.html
// Blocks (artboard order): "Breadcrumb" › "Section tabs" › "Hero + smart search" › (no search:)
// "FROM THE FORUM" › "01 · PEOPLE FOR YOU" › "02 · MY NETWORK" › "Browse all" [+ v2 directory list]
// › (searching:) "01 · SEARCH RESULTS" [+ v2 pager]. Empty states from Empty States.dc.html › NETWORK.
// Data: search/suggestions/directory/summary → /api/v2/network/* (user-portal/backend/v2/network.js);
// CONNECT / ACCEPT / DECLINE → the EXISTING /api/networking/connections* routes; cancel / remove /
// clear-decline → DELETE /api/v2/network/connections/:id. MESSAGE → /app/messages?to=<id> once
// connected (POST /api/messages only allows accepted connections — mirrored client-side).
// v2 additions beyond the artboard (each marked data-v2 / <!-- v2 -->): REMOVE on My-network rows,
// the paginated directory list under BROWSE ALL, result/directory pagers, the profile-peek modal
// on member names, and the "— matches <field>" note on results matched via a field the row hides.
// REPORT + BLOCK (App Store 1.2 — js/views/_safety.js · backend v2/safety.js): a quiet ⋯ on every person
// (card name line, list rows) and REPORT · BLOCK in the profile peek; a blocked member leaves every list
// here at once (the server already keeps the pair out of each other's directory, search and suggestions)
// and BLOCKED MEMBERS · n at the foot of the page opens the list with UNBLOCK.
import { api } from '../api.js';
import { session } from '../state.js';
import { ui, esc, fmt } from '../ui.js';
import router from '../router.js';
import { SAFETY, ensureCss as ensureSafetyCss, moreButton, openMenu, reportSheet, blockFlow, openBlockedList, rememberBlocks } from './_safety.js';

export const SOURCE = 'Network.dc.html';

export const COPY = {
  crumb: { a: 'NETWORK', b: 'PEOPLE' },
  tabs: { people: 'PEOPLE', messages: 'MESSAGES', card: 'MY CARD' },
  hero: {
    eyebrow: 'RESEARCHERS &amp; CLINICIANS, WORLDWIDE',
    line: 'Your next collaborator is <i style="color:#9b1b22">already here</i>.',
    sub: 'Find them, say hello, trade what you know. A message here has started collaborations, warm intros, and more than one paper.',
    placeholder: 'Try anything — a name, a city, ‘sleep’, ‘oncology, Zagreb’…',
    // at 390px the long one truncated mid-word ("…a city, ‘sle") — a phone gets a phone-sized prompt
    placeholderShort: 'Name, city, or specialty…',
    button: 'SEARCH',
    hint: 'One field, every angle — names, institutions, specialties, cities, and programs all match.',
    title: 'People', lede: 'Researchers and clinicians, worldwide.'
  },
  forum: { label: 'FROM THE FORUM', open: 'OPEN FEED →', tag: 'FORUM UPDATE', spotlightTag: 'MEMBER SPOTLIGHT' },
  forYou: {
    n: '01', title: 'PEOPLE FOR YOU', sub: 'Requests first, then members worth a hello.',
    requestChip: 'REQUEST', requestSub: 'Wants to connect with you',
    accept: 'ACCEPT', decline: 'DECLINE', message: 'MESSAGE',
    emptyLine: 'No one to suggest just yet.',
    emptyWhy: 'Suggestions sharpen as profiles fill in — add your specialty, institution and city, then check back.',
    emptyCta: 'COMPLETE YOUR PROFILE →',
    titleT: 'For you', requestTag: 'Wants to connect', emptyWhyT: 'Suggestions sharpen as profiles fill in.', emptyCtaT: 'Complete your profile'
  },
  reasons: {  // server sends why_label too; this map keeps wording in one place
    mutual: n => `MUTUAL CONTACTS · ${n}`, institution: 'SAME INSTITUTION', specialty: 'SHARED FIELD',
    city: 'SAME CITY', country: 'SAME COUNTRY', plexus: 'ATTENDS PLEXUS', forum: 'FORUM MEMBER',
    team: 'MED&X TEAM', new: 'NEW MEMBER', member: 'MED&X MEMBER'
  },
  net: {
    n: '02', title: 'MY NETWORK',
    zero: 'The people you’ve connected with.', count: n => `${n} ${n === 1 ? 'connection' : 'connections'}`,
    connected: 'CONNECTED ✓', message: 'MESSAGE', remove: 'REMOVE',
    emptyLine: 'No connections yet.',
    emptyWhy: 'Accept a request or say hello above — everyone you connect with lives here.',
    emptyCta: 'SEE SUGGESTIONS →',
    titleT: 'My network', emptyWhyT: 'Everyone you connect with lives here.'
  },
  browse: { label: n => `BROWSE ALL ${n} MEMBERS ↓`, close: 'CLOSE THE DIRECTORY ↑', or: 'or search above.', prev: '← PREV', next: 'NEXT →', page: (a, b) => `PAGE ${a} OF ${b}`,
    labelT: n => `Browse all ${n} members`, closeT: 'Close the directory', pageT: (a, b) => `Page ${a} of ${b}`, loading: 'Loading the directory…' },
  results: {
    n: '01', title: 'SEARCH RESULTS', count: (a, b) => `${a} of ${b} members match`,
    noneLine: q => `No members match "${q}".`, noneWhy: 'Try a name, institution, specialty, or city.',
    matches: f => `matches ${f}`,
    titleT: 'Results', countT: n => `${n} found`, searching: 'Searching…'
  },
  btn: { connect: 'CONNECT', sent: 'REQUEST SENT', connected: 'CONNECTED ✓', accept: 'ACCEPT', declined: 'DECLINED' },
  // the small row actions (sentence case, phone calm pass)
  row: { connect: 'Connect', sent: 'Requested', connected: 'Connected', accept: 'Accept', ignore: 'Ignore', declined: 'Declined', message: 'Message', remove: 'REMOVE' },
  toast: {
    sent: n => `Request sent to ${n}.`, cancelled: 'Request cancelled.',
    accepted: n => `You are now connected with ${n}.`, declined: 'Request declined.',
    removed: n => `${n} was removed from your network.`,
    already: 'Already connected — send a message.',
    theyDeclined: 'They passed on this request — the ball is in their court.',
    locked: 'Messages open once you are connected — send a request first.',
    reopened: 'Cleared — send a new request when ready.'
  },
  confirm: {
    cancel: { eyebrow: 'NETWORK · REQUEST', title: 'Cancel this request?', body: 'They will not be notified — you can send a new one any time.', ok: 'CANCEL REQUEST', no: 'KEEP IT' },
    remove: n => ({ eyebrow: 'NETWORK · CONNECTION', title: `Remove ${n}?`, body: 'You will disappear from each other’s network and the message channel closes. No one is notified.', ok: 'REMOVE', no: 'KEEP' }),
    reopen: { eyebrow: 'NETWORK · REQUEST', title: 'Connect after all?', body: 'You declined their request earlier. Clearing it lets a fresh request go out from you now.', ok: 'SEND REQUEST', no: 'NOT NOW' }
  },
  peek: { eyebrow: 'MEMBER', close: 'CLOSE', connect: 'CONNECT', message: 'MESSAGE', accept: 'ACCEPT', empty: 'This member has not filled in their profile yet.' },
  matchedLabels: { name: 'name', institution: 'institution', specialty: 'specialty', city: 'city', country: 'country', title: 'title', bio: 'bio', interests: 'interests', program: 'a program' }
};

const PAGE_SIZE = 20;

let D = null, st = null, CS = null, rootEl = null, unbind = null, debounceT = null, seq = 0;
// motion: `fresh` names the region of the next content paint that holds NEW people, so only that region
// settles in (css .mx-net-fresh): 'dir' = a directory page (BROWSE ALL, PREV / NEXT), 'res' = a search
// answer, 'all' = the suggestions coming back after a cleared search. Cards the member has already read
// stay still. The first paint is left to the shared screen entrance (app.css › #view.mx-enter cascades the
// card grid); a re-paint after connect/accept/remove leaves it null, so nothing replays under the cursor.
let fresh = null;
let changed = null;   // { id, t } — the card/row the member just acted on (css .mx-net-changed)

function ago(v) {
  const d = fmt.toDate(v); if (!d) return '';
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 3600) return Math.max(1, Math.round(s / 60)) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  const days = Math.round(s / 86400); return days === 1 ? 'yesterday' : days < 30 ? days + ' days ago' : fmt.shortDate(d);
}
function photoUrl(p) { return p ? (String(p).startsWith('/') ? api.url(p) : p) : ''; }
function initialsOf(name) { return String(name || '').split(' ').filter(Boolean).map(w => w[0]).join('').replace(/[^A-ZŠĐČĆŽa-zšđčćž]/g, '').toUpperCase().slice(0, 2) || 'M'; }
function subLine(c) {
  return [c.institution, c.city || c.country].filter(Boolean).join(' · ') || (c.specialties && c.specialties[0]) || 'Med&X member';
}
// connection state for a member id: live map first, then what the card carried
function cstate(c) { return CS.get(c.id) || c.connection || { state: 'none', id: null }; }

// ---------------------------------------------------------------- data
async function load(q) {
  const r = await api.settle({
    summary: api.get('/api/v2/network/summary'),
    pending: api.get('/api/networking/connections/pending'),
    conns: api.get('/api/networking/connections'),
    sugg: api.get('/api/v2/network/suggestions?limit=8'),
    feed: api.get('/api/feed/home'),
    blocks: api.get('/api/v2/safety/blocks')
  });
  const me = session.user || {};
  CS = new Map(CS || []);   // merge, never reset mid-session — optimistic pending_out states survive a background refresh
  const pending = (Array.isArray(r.pending) ? r.pending : []).map(p => {
    CS.set(p.requester_id, { state: 'pending_in', id: p.id });
    return { cid: p.id, id: p.requester_id, name: [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Member',
      first_name: p.first_name || '', last_name: p.last_name || '', institution: p.institution || '', photo_url: p.photo_url || '', message: p.message || '' };
  });
  const conns = (Array.isArray(r.conns) ? r.conns : []).map(c => {
    const pid = c.requester_id === me.id ? c.receiver_id : c.requester_id;
    CS.set(pid, { state: 'connected', id: c.id });
    // is_team: the legacy route's rows name the Med&X team (u.is_admin AS is_team) — BLOCK is never offered for them
    return { cid: c.id, id: pid, name: [c.first_name, c.last_name].filter(Boolean).join(' ') || 'Member',
      institution: c.institution || '', bio: c.bio || '', photo_url: c.photo_url || '',
      is_team: !!Number(c.is_team || c.is_admin || 0) };
  });
  if (r.blocks && Array.isArray(r.blocks.blocks)) rememberBlocks(r.blocks.blocks);   // the header search reads the same list
  // keep only fresh candidates at load time; once shown, a card STAYS through connect
  // (its button face flips to REQUEST SENT — the artboard behaviour) instead of vanishing
  const sugg = ((r.sugg && r.sugg.results) || []).filter(s => !s.connection || s.connection.state === 'none');
  return {
    total: (r.summary && r.summary.members) || 0,
    pending, conns, sugg,
    forumTop: (((r.feed && r.feed.items) || []).find(i => i.source === 'forum')) || null,
    blockedCount: ((r.blocks && r.blocks.blocks) || []).length,
    q: q || ''
  };
}

// ---------------------------------------------------------------- blocks (artboard order)
// Phone calm pass (2026-09-25, DESIGN-RULES §11 › /app/network): a large title, the search field and one line; people
// as rows (a 64 circle, the name, institution · country on one line, the reason as a 12 caps gold line) with ONE small
// action each — Connect / Requested / Accept, or Message once connected — and the ⋯ menu (report, block, and remove
// for a connection). Requests come first with Accept / Ignore. The crumb and the PEOPLE / MESSAGES strip stay for
// wider screens only (the tab bar says where you are on a phone).
function blockCrumb() { return `
  <!-- dc: Network.dc.html › "NETWORK → PEOPLE" (hidden on phones: app.css › .mx-crumbs) -->
  <div class="mx-gutter mx-crumbs" style="display:flex;align-items:center;gap:13px;padding:10px 36px;border-bottom:1px solid rgba(25,21,18,.16)">
    <span style="font:600 12px Inter,sans-serif;letter-spacing:.12em;color:#4a4239">${COPY.crumb.a}</span>
    <span style="color:rgba(25,21,18,.35);font-size:12px">→</span>
    <span style="font:600 12px Inter,sans-serif;letter-spacing:.12em;color:#191512">${COPY.crumb.b}</span>
  </div>
  <!-- /dc -->`; }

function blockTabs() { return `
  <!-- dc: Network.dc.html › "PEOPLE · MESSAGES" — the shared section-tab strip (app.css › .mx-tab): data-tabs="network" is
       shared with Messages, so the underline slides across between the two screens. Hidden on phones (network.css) -->
  <div class="mx-tabs mx-gutter mx-net-tabs" data-tabs="network" style="display:flex;align-items:center;justify-content:center;gap:26px;padding:13px 36px;border-bottom:1px solid rgba(25,21,18,.16);flex-wrap:wrap">
    <span class="mx-tab is-on" aria-current="page" style="font:600 12px Inter,sans-serif;letter-spacing:.12em;color:#9b1b22">${COPY.tabs.people}</span>
    <a href="/app/messages" class="mx-tab" style="font:600 12px Inter,sans-serif;letter-spacing:.12em;color:#4a4239" data-hover="color:#191512">${COPY.tabs.messages}</a>
  </div>
  <!-- /dc -->`; }

function searchPlaceholder() {
  const narrow = typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(max-width: 500px)').matches
    : false;
  return narrow ? COPY.hero.placeholderShort : COPY.hero.placeholder;
}
function blockHero() { return `
  <!-- dc: Network.dc.html › "RESEARCHERS & CLINICIANS, WORLDWIDE" (large title + the one search field) -->
  <h1 class="mx-lt">${COPY.hero.title}</h1>
  <p class="mx-lede">${COPY.hero.lede}</p>
  <div class="mx-net-search">
    <label class="mx-net-field">${ui.icon('search', 20)}<input data-role="q" type="search" enterkeyhint="search" value="${esc(st.q)}" placeholder="${esc(searchPlaceholder())}" aria-label="Search the member directory" autocomplete="off"></label>
    <span data-act="search" role="button" tabindex="0" class="btn-primary mx-net-go">${COPY.hero.button}</span>
  </div>
  <!-- /dc -->`; }

// the one small action on a person row, from the live connection state (same data-act, same handlers as before).
// Its word is the button's name; on a phone of 400px or less the word steps aside for a 44px icon (network.css), so
// a name keeps room to be read instead of "Alen Jugino…".
function netBtn(attrs, cls, ic, label) {
  return `<span ${attrs} aria-label="${label}" class="mx-net-btn${cls}">${ui.icon(ic, 20)}<span class="mx-net-btn-l">${label}</span></span>`;
}
function rowAction(m) {
  const s = cstate(m).state;
  const id = `data-id="${esc(m.id)}" role="button" tabindex="0"`;
  if (s === 'connected' && canMessage(m)) return netBtn(`data-act="message" ${id}`, '', 'chat', COPY.row.message);
  if (s === 'connected') return netBtn('aria-disabled="true"', ' is-quiet', 'check', COPY.row.connected);
  if (s === 'pending_in') return netBtn(`data-act="connect" ${id} data-cid="${esc(cstate(m).id)}"`, ' is-fill', 'check', COPY.row.accept);
  if (s === 'pending_out') return netBtn(`data-act="connect" ${id}`, ' is-quiet', 'clock', COPY.row.sent);
  if (s === 'declined' || s === 'declined_by_me') return netBtn(`data-act="connect" ${id}`, ' is-quiet', 'x', COPY.row.declined);
  return netBtn(`data-act="connect" ${id}`, '', 'user-plus', COPY.row.connect);
}
function reasonOf(m) {
  return m.why_label || (COPY.reasons[m.why] ? (typeof COPY.reasons[m.why] === 'function' ? COPY.reasons[m.why]((m.reasons && m.reasons[0] && m.reasons[0].n) || 1) : COPY.reasons[m.why]) : '');
}
// a person row: the circle and the words open the profile sheet; the action and the ⋯ sit at the end
function personRow(m, { sub, tag, action, extra = '' } = {}) {
  return `
          <div class="mx-person-row mx-net-row" data-card="${esc(m.id)}">
            <span class="mx-net-peek" data-act="peek" data-id="${esc(m.id)}" role="button" tabindex="0" aria-label="${esc(m.name)}">
              ${ui.portrait({ name: m.name, src: photoUrl(m.photo_url), size: 64, alt: '' })}
              <span class="mx-person-text"><span class="mx-person-name">${esc(m.name)}</span>${sub ? `<span class="mx-person-role">${sub}</span>` : ''}${tag ? `<span class="mx-person-tag">${esc(tag)}</span>` : ''}</span>
            </span>
            ${extra}
            <span class="mx-person-act">${action || ''}${moreButton({ id: m.id, name: m.name })}</span>
          </div>`;
}

function cardRequest(m) {
  return `
          <div class="mx-person-row mx-net-row is-request" data-card="${esc(m.id)}">
            <span class="mx-net-peek" data-act="peek" data-id="${esc(m.id)}" role="button" tabindex="0" aria-label="${esc(m.name)}">
              ${ui.portrait({ name: m.name, src: photoUrl(m.photo_url), size: 64, alt: '' })}
              <span class="mx-person-text"><span class="mx-person-name">${esc(m.name)}</span><span class="mx-person-role">${esc(COPY.forYou.requestSub)}${m.institution ? ' · ' + esc(m.institution) : ''}</span><span class="mx-person-tag">${COPY.forYou.requestTag}</span></span>
            </span>
            <span class="mx-person-act">${moreButton({ id: m.id, name: m.name })}</span>
            <span class="mx-net-reqbtns">
              <span data-act="accept" data-cid="${esc(m.cid)}" data-id="${esc(m.id)}" role="button" tabindex="0" class="mx-net-btn is-fill">${COPY.row.accept}</span>
              <span data-act="decline" data-cid="${esc(m.cid)}" data-id="${esc(m.id)}" role="button" tabindex="0" class="mx-net-btn">${COPY.row.ignore}</span>
            </span>
          </div>`;
}

// MESSAGE is offered where it can work — a connection (or a Med&X team account, which may write to anyone).
function canMessage(m) { return cstate(m).state === 'connected' || !!(session.user || {}).is_admin; }
function cardSuggestion(m) {
  return personRow(m, { sub: esc(subLine(m)), tag: reasonOf(m), action: rowAction(m) });
}

function sectionHead(n, title, sub, right = '') {
  return `<div class="mx-sh"><span class="mx-sh-n">${n}</span><h2 class="mx-sh-t">${title}</h2>${right}</div>${sub ? `<p class="mx-sh-sub">${sub}</p>` : ''}`;
}

function blockForYou() {
  const requests = D.pending;
  const suggestions = D.sugg.slice(0, Math.max(0, 8 - requests.length));
  const rows = requests.map(cardRequest).concat(suggestions.map(cardSuggestion));
  return `
      <!-- dc: Network.dc.html › "01 · PEOPLE FOR YOU" -->
      <section class="mx-sec mx-sec--tight" id="foryou">
        ${sectionHead(COPY.forYou.n, COPY.forYou.titleT)}
        ${rows.length ? `<div class="mx-person-rows">${rows.join('')}</div>` : `
        <div class="empty">
          <span class="empty-line">${COPY.forYou.emptyLine}</span>
          <span class="empty-why">${COPY.forYou.emptyWhyT}</span>
          <a href="/app/profile" class="btn-ghost btn-sm">${COPY.forYou.emptyCtaT}</a>
        </div>`}
      </section>
      <!-- /dc -->`;
}

function blockMyNetwork() {
  const n = D.conns.length;
  return `
      <!-- dc: Network.dc.html › "02 · MY NETWORK" -->
      <section class="mx-sec">
        ${sectionHead(COPY.net.n, COPY.net.titleT, '', n ? `<span class="mx-sh-count">${COPY.net.count(n)}</span>` : '')}
        ${n ? `<div class="mx-person-rows">
        ${D.conns.map(m => personRow(m, { sub: esc(m.institution || 'Med&X member'), action: `<span data-act="message" data-id="${esc(m.id)}" role="button" tabindex="0" class="mx-net-btn">${COPY.row.message}</span>` })).join('')}
        </div>` : `
        <div class="empty">
          <span class="empty-line">${COPY.net.emptyLine}</span>
          <span class="empty-why">${COPY.net.emptyWhyT}</span>
        </div>`}
      </section>
      <!-- /dc -->`;
}

function rowMember(m, i, matched) {
  // point out the match only when it hit a field the row does not already show (name / institution / city / country)
  const hidden = matched && m.matchedOn ? m.matchedOn.filter(f => !['name', 'institution', 'city', 'country'].includes(f)) : [];
  const tag = hidden.length ? COPY.results.matches(COPY.matchedLabels[hidden[0]] || hidden[0]) : '';
  return personRow(m, { sub: esc(subLine(m)), tag, action: rowAction(m) });
}

function pager(act, page, pages) {
  if (pages <= 1) return '';
  return `<div data-v2="pager" class="mx-net-pager">
      <span data-act="${act}" data-page="${page - 1}" ${page <= 1 ? 'aria-disabled="true"' : ''} role="button" tabindex="0" class="mx-iconbtn" aria-label="Previous page">${ui.icon('chevron-left', 20)}</span>
      <span class="mx-net-page">${COPY.browse.pageT(page, pages)}</span>
      <span data-act="${act}" data-page="${page + 1}" ${page >= pages ? 'aria-disabled="true"' : ''} role="button" tabindex="0" class="mx-iconbtn" aria-label="Next page">${ui.icon('chevron-right', 20)}</span>
    </div>`;
}

function blockBrowse() {
  const d = st.dir;
  return `
      <!-- dc: Network.dc.html › "BROWSE ALL 50 MEMBERS ↓" (one row) -->
      <section class="mx-sec">
        <div class="mx-list">
          <span class="mx-row" data-act="browse" role="button" tabindex="0" aria-expanded="${d.open}">${ui.icon('users')}<span class="mx-row-l">${d.open ? COPY.browse.closeT : COPY.browse.labelT(fmt.num(D.total))}</span>${ui.icon(d.open ? 'chevron-down' : 'chevron-right', 18)}</span>
        </div>
      ${d.open ? `
      <!-- v2: paginated directory list -->
      <div class="mx-person-rows mx-net-dir${fresh === 'dir' ? ' mx-net-fresh' : ''}">
        ${d.loading ? `<p class="mx-net-note">${COPY.browse.loading}</p>`
          : (d.items || []).map((m, i) => rowMember(m, i, false)).join('') + pager('dirPage', d.page, d.pages)}
      </div>` : ''}
      </section>
      <!-- /dc -->`;
}

function blockResults() {
  const r = st.res;
  return `
      <!-- dc: Network.dc.html › "01 · SEARCH RESULTS" -->
      <section class="mx-sec mx-sec--tight">
        ${sectionHead(COPY.results.n, COPY.results.titleT, '', `<span class="mx-sh-count">${r ? COPY.results.countT(fmt.num(r.total)) : COPY.results.searching}</span>`)}
        <div class="mx-person-rows${fresh === 'res' ? ' mx-net-fresh' : ''}">
          ${r ? r.items.map((m, i) => rowMember(m, i, true)).join('') : ''}
        </div>
        ${r && r.total === 0 ? `
        <div class="empty">
          <span class="empty-line">${COPY.results.noneLine(esc(st.q))}</span>
          <span class="empty-why">${COPY.results.noneWhy}</span>
        </div>` : ''}
        ${r ? pager('resPage', r.page, r.pages) : ''}
      </section>
      <!-- /dc -->`;
}

// v2 (App Store 1.2): the way back to anyone the member blocked — only when there is someone to unblock
function blockBlocked() {
  if (!D.blockedCount) return '';
  return `
      <div data-v2="blocked members — js/views/_safety.js" class="mx-net-blocked">
        <span data-act="blocked" class="mx-safe-link">${SAFETY.link(D.blockedCount)}</span>
      </div>`;
}

function contentBlock() {
  const searching = !!st.q.trim();
  const html = `<div data-block="content"${fresh === 'all' ? ' class="mx-net-fresh"' : ''}>
    ${searching ? blockResults() : blockForYou() + blockMyNetwork() + blockBrowse() + blockBlocked()}
  </div>`;
  fresh = null;
  return html;
}

function template() { return `
<div data-screen-label="Network" class="mx-net-screen" style="font-family:Inter,sans-serif;color:#191512;background:#f7f1e6;min-height:100vh">
  ${blockCrumb()}
  ${blockTabs()}
  <div class="mx-p">
    ${blockHero()}
    ${contentBlock()}
  </div>
</div>`; }

// ---------------------------------------------------------------- behaviour
function rerenderContent(changedId) {
  if (changedId) changed = { id: String(changedId), t: performance.now() };
  const el = rootEl && rootEl.querySelector('[data-block="content"]');
  if (el) el.outerHTML = contentBlock();
  // the member's own action: the card/row it touched acknowledges its new state (css .mx-net-changed).
  // A background re-sync that lands mid-acknowledgement re-marks the new node at the same point of the
  // animation (negative delay via --net-age) instead of flashing it again from the start.
  if (!changed || !rootEl) return;
  const age = performance.now() - changed.t;
  if (age > 900) { changed = null; return; }
  rootEl.querySelectorAll(`[data-card="${CSS.escape(changed.id)}"]`).forEach(n => {
    n.classList.add('mx-net-changed'); n.style.setProperty('--net-age', `-${Math.round(age)}ms`);
  });
}
function syncUrl() {
  const target = '/app/network' + (st.q.trim() ? '?q=' + encodeURIComponent(st.q.trim()) : '');
  try { history.replaceState(history.state, '', target); } catch (e) { /* sandboxed */ }
}
async function runSearch(page) {
  const query = st.q.trim();
  if (!query) { st.res = null; rerenderContent(); return; }
  const mySeq = ++seq;
  try {
    const r = await api.get('/api/v2/network/search?q=' + encodeURIComponent(query) + '&page=' + (page || 1) + '&size=' + PAGE_SIZE);
    if (mySeq !== seq || !rootEl) return;
    (r.results || []).forEach(m => { if (m.connection && !CS.has(m.id)) CS.set(m.id, m.connection); });
    if (r.members_total) D.total = r.members_total;
    st.res = { items: r.results || [], total: r.total || 0, page: r.page || 1, pages: r.pages || 1 };
    fresh = 'res'; rerenderContent();
  } catch (e) {
    if (mySeq !== seq) return;
    st.res = { items: [], total: 0, page: 1, pages: 1 };
    rerenderContent();
    ui.toast(e.message, { kind: 'error' });
  }
}
async function loadDirectory(page) {
  st.dir.open = true; st.dir.loading = true; rerenderContent();
  try {
    const r = await api.get('/api/v2/network/directory?page=' + (page || 1) + '&size=24');
    (r.results || []).forEach(m => { if (m.connection && !CS.has(m.id)) CS.set(m.id, m.connection); });
    st.dir = { open: true, loading: false, items: r.results || [], page: r.page || 1, pages: r.pages || 1 };
    fresh = 'dir';
    if (r.total != null) D.total = Math.max(D.total, r.total);
  } catch (e) {
    st.dir = { open: false, loading: false, items: [], page: 1, pages: 1 };
    ui.toast(e.message, { kind: 'error' });
  }
  rerenderContent();
}
function findMember(id) {
  const pools = [D.sugg, D.pending, D.conns, (st.res && st.res.items) || [], st.dir.items || []];
  for (const pool of pools) { const hit = pool.find(m => m.id === id); if (hit) return hit; }
  return null;
}
// the Med&X team is never offered BLOCK: any list that knows the person is on the team settles it (a connection
// row from an older backend carries no is_team, while the directory row for the same person does)
function isTeamMember(id) {
  const pools = [D.sugg, D.pending, D.conns, (st.res && st.res.items) || [], st.dir.items || []];
  return pools.some(pool => pool.some(m => m.id === id && m.is_team));
}
function refreshBackground() {   // re-sync lists after a mutation without blocking the optimistic UI
  load(st.q).then(next => {
    if (!rootEl) return;
    next.sugg = D.sugg;   // shown suggestion cards keep their place; only their button faces change (CS)
    D = next;
    if (!st.q.trim()) rerenderContent();
  }).catch(() => {});
}

const handlers = {
  search: () => { const el = rootEl.querySelector('[data-role="q"]'); st.q = el ? el.value : st.q; syncUrl(); rerenderContent(); runSearch(1); },
  seeSugg: () => { const el = rootEl.querySelector('#foryou'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
  browse: () => { if (st.dir.open) { st.dir.open = false; rerenderContent(); } else loadDirectory(1); },
  dirPage: (el) => { const p = parseInt(el.dataset.page, 10); if (p >= 1) loadDirectory(p); },
  resPage: (el) => { const p = parseInt(el.dataset.page, 10); if (p >= 1) runSearch(p); },

  connect: async (el) => {
    const id = el.dataset.id; const c = findMember(id) || { id, name: 'this member' };
    const s = cstate(c);
    if (s.state === 'connected') return ui.toast(COPY.toast.already);
    if (s.state === 'declined') return ui.toast(COPY.toast.theyDeclined);
    if (s.state === 'pending_in') return handlers.accept(el);   // rows show ACCEPT for incoming requests
    if (s.state === 'pending_out') {
      const c1 = COPY.confirm.cancel;
      if (!await ui.confirm({ eyebrow: c1.eyebrow, title: c1.title, body: c1.body, ok: c1.ok, cancel: c1.no })) return;
      const prev = CS.get(id); CS.set(id, { state: 'none', id: null }); rerenderContent(id);
      try { await api.del('/api/v2/network/connections/' + encodeURIComponent(s.id)); ui.toast(COPY.toast.cancelled); }
      catch (e) { CS.set(id, prev); rerenderContent(); ui.toast(e.message, { kind: 'error' }); }
      return;
    }
    if (s.state === 'declined_by_me') {
      const c2 = COPY.confirm.reopen;
      if (!await ui.confirm({ eyebrow: c2.eyebrow, title: c2.title, body: c2.body, ok: c2.ok, cancel: c2.no })) return;
      try { await api.del('/api/v2/network/connections/' + encodeURIComponent(s.id)); CS.set(id, { state: 'none', id: null }); }
      catch (e) { return ui.toast(e.message, { kind: 'error' }); }
    }
    // none → optimistic pending_out, rollback on error
    const prev = CS.get(id) || { state: 'none', id: null };
    CS.set(id, { state: 'pending_out', id: null }); rerenderContent(id);
    try {
      const r = await api.post('/api/networking/connections', { receiver_id: id });
      CS.set(id, { state: 'pending_out', id: r.id }); rerenderContent();
      ui.toast(COPY.toast.sent(c.name));
    } catch (e) {
      CS.set(id, prev); rerenderContent();
      ui.toast(e.message, { kind: 'error' });
      refreshBackground();   // a 409 means our state map is stale — resync
    }
  },

  accept: async (el) => {
    const id = el.dataset.id; const cid = el.dataset.cid || (cstate({ id }).id);
    if (!cid) return ui.toast('This request is not loaded any more — reload the page.', { kind: 'error' });
    const m = findMember(id) || { name: 'this member' };
    const prevPending = D.pending, prevConns = D.conns, prevState = CS.get(id);
    D.pending = D.pending.filter(p => p.cid !== cid);
    D.conns = D.conns.concat([{ cid, id, name: m.name, institution: m.institution || '', photo_url: m.photo_url || '' }]);
    CS.set(id, { state: 'connected', id: cid }); rerenderContent(id);
    try { await api.put('/api/networking/connections/' + encodeURIComponent(cid), { status: 'accepted' }); ui.toast(COPY.toast.accepted(m.name)); refreshBackground(); }
    catch (e) { D.pending = prevPending; D.conns = prevConns; CS.set(id, prevState || { state: 'pending_in', id: cid }); rerenderContent(); ui.toast(e.message, { kind: 'error' }); }
  },

  decline: async (el) => {
    const cid = el.dataset.cid, id = el.dataset.id;
    const prevPending = D.pending, prevState = CS.get(id);
    D.pending = D.pending.filter(p => p.cid !== cid);
    CS.set(id, { state: 'declined_by_me', id: cid }); rerenderContent();
    try { await api.put('/api/networking/connections/' + encodeURIComponent(cid), { status: 'rejected' }); ui.toast(COPY.toast.declined); }
    catch (e) { D.pending = prevPending; CS.set(id, prevState || { state: 'pending_in', id: cid }); rerenderContent(); ui.toast(e.message, { kind: 'error' }); }
  },

  remove: async (el) => {
    const cid = el.dataset.cid, id = el.dataset.id, name = el.dataset.name || 'this member';
    const c = COPY.confirm.remove(name);
    if (!await ui.confirm({ eyebrow: c.eyebrow, title: c.title, body: c.body, ok: c.ok, cancel: c.no })) return;
    const prevConns = D.conns, prevState = CS.get(id);
    D.conns = D.conns.filter(x => x.cid !== cid);
    CS.set(id, { state: 'none', id: null }); rerenderContent();
    try { await api.del('/api/v2/network/connections/' + encodeURIComponent(cid)); ui.toast(COPY.toast.removed(name)); refreshBackground(); }
    catch (e) { D.conns = prevConns; CS.set(id, prevState || { state: 'connected', id: cid }); rerenderContent(); ui.toast(e.message, { kind: 'error' }); }
  },

  message: (el) => {
    const id = el.dataset.id;
    const me = session.user || {};
    if (cstate({ id }).state === 'connected' || me.is_admin) return router.navigate('/app/messages?to=' + encodeURIComponent(id));
    ui.toast(COPY.toast.locked);
  },

  // the person sheet: the 96 circle, name, role, city, fields and bio; ONE primary (Connect / Accept, or Message
  // when allowed) with Message as a ghost beside Connect only when it can work; REPORT · BLOCK behind the ⋯ top-right;
  // the × closes (the same handlers as before: connect, accept, message, reportSheet, blockMember)
  peek: (el) => {
    const m = findMember(el.dataset.id);
    if (!m) return ui.toast('Profile details are not loaded for this member.');
    const role = [m.title, m.institution].filter(Boolean).join(' · ');
    const place = [m.city, m.country].filter(Boolean).join(', ');
    const fields = m.specialties || [];
    const caps = t => (String(t) === String(t).toUpperCase() ? String(t).toLowerCase().replace(/(^|\s|·)([a-zšđčćž])/g, (x, a, b) => a + b.toUpperCase()) : String(t));
    const events = (m.tags || []).map(caps);
    const s = cstate(m).state;
    const msgOk = canMessage(m);
    const primary = msgOk ? { label: COPY.peek.message, act: 'peekMsg' }
      : s === 'none' ? { label: COPY.peek.connect, act: 'peekConnect' }
      : s === 'pending_in' ? { label: COPY.peek.accept, act: 'peekAccept' } : null;
    const state = !primary ? (s === 'pending_out' ? COPY.row.sent : s === 'connected' ? COPY.row.connected : s.startsWith('declined') ? COPY.row.declined : '') : '';
    const md = ui.modal({
      eyebrow: COPY.peek.eyebrow,
      title: '',
      body: `<div class="mx-sheet-person">
          <span data-act="peekMore" role="button" tabindex="0" aria-haspopup="menu" aria-label="${esc(SAFETY.more(m.name))}" class="mx-iconbtn mx-sheet-more">${ui.icon('more', 22)}</span>
          ${ui.portrait({ name: m.name, src: photoUrl(m.photo_url), size: 96, alt: '' })}
          <h2 class="mx-sheet-name">${esc(m.name)}</h2>
          ${role ? `<p class="mx-sheet-role">${esc(role)}</p>` : ''}
          ${place ? `<p class="mx-sheet-line">${ui.icon('pin', 16)}<span>${esc(place)}</span></p>` : ''}
          ${fields.length ? `<p class="mx-sheet-line">${ui.icon('sparkle', 16)}<span>${esc(fields.slice(0, 4).join(' · '))}</span></p>` : ''}
          ${events.length ? `<p class="mx-sheet-line">${ui.icon('ticket', 16)}<span>${esc(events.slice(0, 4).join(' · '))}</span></p>` : ''}
          ${m.bio ? `<p class="mx-sheet-bio">${esc(m.bio)}</p>` : (role || place || fields.length || events.length ? '' : `<p class="mx-sheet-bio">${COPY.peek.empty}</p>`)}
          <div class="mx-sheet-acts">
            ${primary ? `<span data-act="${primary.act}" role="button" tabindex="0" class="btn-primary btn-block">${primary.label}</span>` : state ? `<span class="mx-sheet-state">${esc(state)}</span>` : ''}
          </div>
        </div>`,
      actions: []
    });
    ui.bind(md.el, {
      peekMsg: () => { md.close(); router.navigate('/app/messages?to=' + encodeURIComponent(m.id)); },
      peekConnect: () => { md.close(); handlers.connect({ dataset: { id: m.id } }); },
      peekAccept: () => { md.close(); handlers.accept({ dataset: { id: m.id, cid: cstate(m).id } }); },
      peekMore: (btn) => {
        const items = [{ label: SAFETY.menu.report, onPick: () => { md.close(); reportSheet({ kind: 'member', targetId: m.id, name: m.name }); } }];
        if (!m.is_team && !isTeamMember(m.id)) items.push({ label: SAFETY.menu.block, tone: 'danger', onPick: () => { md.close(); blockMember(m); } });
        openMenu(btn, items);
      }
    });
  },

  // ⋯ on a card / row → REPORT · BLOCK (the Med&X team is never offered BLOCK — the server refuses it too)
  more: (el) => {
    const m = findMember(el.dataset.id) || { id: el.dataset.id, name: 'this member' };
    const items = [{ label: SAFETY.menu.report, onPick: () => reportSheet({ kind: 'member', targetId: m.id, name: m.name }) }];
    // a connection's REMOVE lives in the same menu now (the row keeps one action: Message) — same handler
    const conn = D.conns.find(x => x.id === m.id);
    if (conn) items.unshift({ label: COPY.row.remove, onPick: () => handlers.remove({ dataset: { cid: conn.cid, id: conn.id, name: conn.name } }) });
    if (!m.is_team && !isTeamMember(m.id)) items.push({ label: SAFETY.menu.block, tone: 'danger', onPick: () => blockMember(m) });
    openMenu(el, items);
  },

  blocked: () => openBlockedList({ onUnblock: (id, left) => { if (!D) return; D.blockedCount = left; refreshBackground(); rerenderContent(); } })
};

// after a confirmed block: the member leaves every list on this screen at once; the background re-sync
// then brings the counts (BROWSE ALL <N>) in line with the server
async function blockMember(m) {
  const r = await blockFlow({ id: m.id, name: m.name });
  if (!r || !D) return;
  const id = m.id, keep = x => x.id !== id;
  D.sugg = D.sugg.filter(keep); D.pending = D.pending.filter(keep); D.conns = D.conns.filter(keep);
  if (st.res) { const before = st.res.items.length; st.res.items = st.res.items.filter(keep); st.res.total = Math.max(0, st.res.total - (before - st.res.items.length)); }
  if (st.dir.items) st.dir.items = st.dir.items.filter(keep);
  CS.delete(id);
  if (!r.already) D.blockedCount = (D.blockedCount || 0) + 1;
  rerenderContent();
  refreshBackground();
}

function wireSearchInput() {
  const input = rootEl.querySelector('[data-role="q"]');
  if (!input) return;
  input.addEventListener('input', () => {
    st.q = input.value; syncUrl();
    clearTimeout(debounceT);
    if (!st.q.trim()) { st.res = null; seq++; fresh = 'all'; rerenderContent(); return; }
    debounceT = setTimeout(() => { if (!st.res) rerenderContent(); runSearch(1); }, 300);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(debounceT); handlers.search(); } });
}

export default {
  title: 'Network',
  async render(root, ctx) {
    rootEl = root;
    if (!document.querySelector('link[data-view-css="network"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = '/css/views/network.css'; link.setAttribute('data-view-css', 'network');
      document.head.appendChild(link);
    }
    ensureSafetyCss();
    const q0 = (ctx.query && ctx.query.q) || '';
    st = { q: q0, res: null, dir: { open: false, loading: false, items: [], page: 1, pages: 1 } };
    D = await load(q0);
    if (rootEl !== root || (ctx.ready && !(await ctx.ready()))) return; // navigated away while loading, or the router moved on
    fresh = null;
    root.innerHTML = template();
    unbind = ui.bind(root, handlers);
    wireSearchInput();
    if (q0.trim()) runSearch(1);
  },
  destroy() {
    clearTimeout(debounceT); debounceT = null; seq++;
    if (unbind) unbind(); unbind = null;
    rootEl = null; D = null; st = null; CS = null; fresh = null; changed = null;
  }
};
