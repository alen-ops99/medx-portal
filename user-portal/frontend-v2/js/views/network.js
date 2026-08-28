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
import { api } from '../api.js';
import { session } from '../state.js';
import { ui, esc, fmt } from '../ui.js';
import router from '../router.js';

export const SOURCE = 'Network.dc.html';

export const COPY = {
  crumb: { a: 'NETWORK', b: 'PEOPLE' },
  tabs: { people: 'PEOPLE', messages: 'MESSAGES', card: 'MY CARD' },
  hero: {
    eyebrow: 'RESEARCHERS &amp; CLINICIANS, WORLDWIDE',
    line: 'Your next collaborator is <i style="color:#9b1b22">already here</i>.',
    sub: 'Find them, say hello, trade what you know. A message here has started collaborations, warm intros, and more than one paper.',
    placeholder: 'Try anything — a name, a city, ‘sleep’, ‘oncology, Zagreb’…',
    button: 'SEARCH',
    hint: 'One field, every angle — names, institutions, specialties, cities, and programs all match.'
  },
  forum: { label: 'FROM THE FORUM', open: 'OPEN FEED →', tag: 'FORUM UPDATE', spotlightTag: 'MEMBER SPOTLIGHT' },
  forYou: {
    n: '01', title: 'PEOPLE FOR YOU', sub: 'Requests first, then members worth a hello.',
    requestChip: 'REQUEST', requestSub: 'Wants to connect with you',
    accept: 'ACCEPT', decline: 'DECLINE', message: 'MESSAGE',
    emptyLine: 'No one to suggest just yet.',
    emptyWhy: 'Suggestions sharpen as profiles fill in — add your specialty, institution and city, then check back.',
    emptyCta: 'COMPLETE YOUR PROFILE →'
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
    emptyCta: 'SEE SUGGESTIONS →'
  },
  browse: { label: n => `BROWSE ALL ${n} MEMBERS ↓`, close: 'CLOSE THE DIRECTORY ↑', or: 'or search above.', prev: '← PREV', next: 'NEXT →', page: (a, b) => `PAGE ${a} OF ${b}` },
  results: {
    n: '01', title: 'SEARCH RESULTS', count: (a, b) => `${a} of ${b} members match`,
    noneLine: q => `No members match "${q}".`, noneWhy: 'Try a name, institution, specialty, or city.',
    matches: f => `matches ${f}`
  },
  btn: { connect: 'CONNECT', sent: 'REQUEST SENT', connected: 'CONNECTED ✓', accept: 'ACCEPT', declined: 'DECLINED' },
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
  peek: { eyebrow: 'MEMBER · NETWORK', close: 'CLOSE' },
  matchedLabels: { name: 'name', institution: 'institution', specialty: 'specialty', city: 'city', country: 'country', title: 'title', bio: 'bio', interests: 'interests', program: 'a program' }
};

const AV = [['#191512', '#f7f1e6'], ['#9b1b22', '#f7f1e6'], ['#c9a962', '#191512']];   // artboard avatar cycle
const PAGE_SIZE = 20;

let D = null, st = null, CS = null, rootEl = null, unbind = null, debounceT = null, seq = 0;

function ago(v) {
  const d = fmt.toDate(v); if (!d) return '';
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 3600) return Math.max(1, Math.round(s / 60)) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  const days = Math.round(s / 86400); return days === 1 ? 'yesterday' : days < 30 ? days + ' days ago' : fmt.shortDate(d);
}
function photoUrl(p) { return p ? (String(p).startsWith('/') ? api.url(p) : p) : ''; }
function initialsOf(name) { return String(name || '').split(' ').filter(Boolean).map(w => w[0]).join('').replace(/[^A-ZŠĐČĆŽa-zšđčćž]/g, '').toUpperCase().slice(0, 2) || 'M'; }
function portraitLabel(c) {
  const f = (c.first_name || '').trim(), l = (c.last_name || '').trim();
  return ('PORTRAIT · ' + ((f[0] ? f[0] + '. ' : '') + (l || f)).trim()).toUpperCase();
}
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
    feed: api.get('/api/feed/home')
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
    return { cid: c.id, id: pid, name: [c.first_name, c.last_name].filter(Boolean).join(' ') || 'Member',
      institution: c.institution || '', bio: c.bio || '', photo_url: c.photo_url || '' };
  });
  // keep only fresh candidates at load time; once shown, a card STAYS through connect
  // (its button face flips to REQUEST SENT — the artboard behaviour) instead of vanishing
  const sugg = ((r.sugg && r.sugg.results) || []).filter(s => !s.connection || s.connection.state === 'none');
  return {
    total: (r.summary && r.summary.members) || 0,
    pending, conns, sugg,
    forumTop: (((r.feed && r.feed.items) || []).find(i => i.source === 'forum')) || null,
    q: q || ''
  };
}

// ---------------------------------------------------------------- blocks (artboard order)
function blockCrumb() { return `
  <!-- dc: Network.dc.html › "NETWORK → PEOPLE" -->
  <div class="mx-gutter" style="display:flex;align-items:center;gap:13px;padding:10px 36px;border-bottom:1px solid rgba(25,21,18,.16)">
    <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#4a4239">${COPY.crumb.a}</span>
    <span style="color:rgba(25,21,18,.35);font-size:10px">→</span>
    <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#191512">${COPY.crumb.b}</span>
  </div>
  <!-- /dc -->`; }

function blockTabs() { return `
  <!-- dc: Network.dc.html › "PEOPLE · MESSAGES · MY CARD" -->
  <div class="mx-gutter" style="display:flex;align-items:center;justify-content:center;gap:26px;padding:13px 36px;border-bottom:1px solid rgba(25,21,18,.16);flex-wrap:wrap">
    <span style="font:600 10px Inter,sans-serif;letter-spacing:.15em;color:#9b1b22;border-bottom:2px solid #9b1b22;padding-bottom:3px;cursor:pointer">${COPY.tabs.people}</span>
    <a href="/app/messages" style="font:600 10px Inter,sans-serif;letter-spacing:.15em;color:#4a4239" data-hover="color:#191512">${COPY.tabs.messages}</a>
    <a href="/app/me" style="font:600 10px Inter,sans-serif;letter-spacing:.15em;color:#4a4239" data-hover="color:#191512">${COPY.tabs.card}</a>
  </div>
  <!-- /dc -->`; }

function blockHero() { return `
  <!-- dc: Network.dc.html › "RESEARCHERS & CLINICIANS, WORLDWIDE" -->
  <div class="mx-gutter mx-pad-hero" style="border-bottom:1px solid rgba(25,21,18,.16);padding:40px 36px 30px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:10px">
    <span style="font:600 11px Inter,sans-serif;letter-spacing:.18em;color:#9b1b22">${COPY.hero.eyebrow}</span>
    <span class="mx-net-h1" style="font-family:Fraunces,serif;font-size:36px;line-height:1.15;white-space:nowrap">${COPY.hero.line}</span>
    <span style="font-size:13.5px;color:#4a4239;max-width:520px;line-height:1.6">${COPY.hero.sub}</span>
    <div class="mx-net-search" style="display:flex;gap:10px;margin-top:8px;width:100%;max-width:640px">
      <input data-role="q" value="${esc(st.q)}" placeholder="${esc(COPY.hero.placeholder)}" aria-label="Search the member directory" autocomplete="off" style="flex:1;border:1px solid rgba(25,21,18,.3);background:#fdfaf3;padding:13px 16px;font-size:13.5px;color:#191512">
      <span data-act="search" class="mx-net-act" style="padding:13px 20px;background:#9b1b22;color:#f7f1e6;font:600 10px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;white-space:nowrap;align-self:stretch;display:inline-flex;align-items:center" data-hover="background:#7e151b">${COPY.hero.button}</span>
    </div>
    <span style="font-size:11px;color:#4a4239">${COPY.hero.hint}</span>
  </div>
  <!-- /dc -->`; }

function blockForumTeaser() {
  const f = D.forumTop;
  if (!f) return `<!-- dc: Network.dc.html › "FROM THE FORUM" --><!-- hidden: no forum post in GET /api/feed/home (no fallback names by decision) --><!-- /dc -->`;
  const isSpot = f.type === 'spotlight';
  return `
    <!-- dc: Network.dc.html › "FROM THE FORUM" -->
    <a href="/app/forum" style="display:flex;align-items:center;gap:14px;border:1px solid rgba(25,21,18,.16);border-left:3px solid #c9a962;background:#fdfaf3;padding:14px 18px;margin-top:20px;color:#191512" data-hover="background:#f7efdf">
      <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#6e5626;flex:none">${COPY.forum.label}</span>
      <span style="width:1px;height:26px;background:rgba(25,21,18,.15);flex:none"></span>
      ${isSpot && f.init ? `<span style="width:34px;height:34px;flex:none;background:#191512;color:#c9a962;display:inline-flex;align-items:center;justify-content:center;font:600 12px Fraunces,serif">${esc(f.init)}</span>` : ''}
      <span style="flex:1;min-width:0"><span style="display:block;font:600 8px Inter,sans-serif;letter-spacing:.14em;color:#9b1b22">${isSpot ? COPY.forum.spotlightTag : COPY.forum.tag}</span><span style="display:block;font-family:Fraunces,serif;font-size:16px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(f.title)}</span></span>
      <span style="font-size:11px;color:#4a4239;white-space:nowrap;flex:none">${esc(ago(f.posted_at))}</span>
      <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#9b1b22;flex:none;white-space:nowrap">${COPY.forum.open}</span>
    </a>
    <!-- /dc -->`;
}

// CONNECT-button face for a member card/row — extends the artboard's two states (CONNECT /
// CONNECTED ✓) with the live ones the server knows: pending_out · pending_in · declined.
function connFace(c) {
  const s = cstate(c).state;
  if (s === 'connected') return { label: COPY.btn.connected, bg: 'transparent', fg: '#6e5626', bd: 'rgba(201,169,98,.65)' };
  if (s === 'pending_out') return { label: COPY.btn.sent, bg: 'transparent', fg: '#4a4239', bd: 'rgba(25,21,18,.25)' };
  if (s === 'pending_in') return { label: COPY.btn.accept, bg: '#9b1b22', fg: '#f7f1e6', bd: '#9b1b22' };
  if (s === 'declined' || s === 'declined_by_me') return { label: COPY.btn.declined, bg: 'transparent', fg: 'rgba(25,21,18,.45)', bd: 'rgba(25,21,18,.18)' };
  return { label: COPY.btn.connect, bg: '#9b1b22', fg: '#f7f1e6', bd: '#9b1b22' };
}

function cardRequest(m) { return `
          <div data-card="${esc(m.id)}" style="border:1px solid rgba(155,27,34,.45);background:#fdfaf3;display:flex;flex-direction:column">
            <div style="height:130px;background:repeating-linear-gradient(45deg,rgba(25,21,18,.07) 0 10px,rgba(25,21,18,.03) 10px 20px);display:flex;align-items:center;justify-content:center;font:600 9px ui-monospace,Menlo,monospace;color:#4a4239;position:relative;overflow:hidden">${m.photo_url ? `<img src="${esc(photoUrl(m.photo_url))}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">` : esc(portraitLabel(m))}<span style="position:absolute;top:10px;left:10px;padding:2px 7px;border:1px solid #9b1b22;background:#9b1b22;color:#f7f1e6;font:600 8.5px Inter,sans-serif;letter-spacing:.14em">${COPY.forYou.requestChip}</span></div>
            <div style="padding:13px 15px 15px;display:flex;flex-direction:column;gap:5px;flex:1">
              <span data-act="peek" data-id="${esc(m.id)}" style="font-family:Fraunces,serif;font-size:16.5px;line-height:1.2">${esc(m.name)}</span>
              <span style="font-size:11.5px;color:#4a4239;line-height:1.4">${esc(COPY.forYou.requestSub)}${m.institution ? ' · ' + esc(m.institution) : ''}</span>
              <span style="display:flex;gap:7px;border-top:1px solid rgba(25,21,18,.1);padding-top:10px;margin-top:auto">
                <span data-act="accept" data-cid="${esc(m.cid)}" data-id="${esc(m.id)}" class="mx-net-act" style="flex:1;text-align:center;padding:9px 0;background:#9b1b22;color:#f7f1e6;font:600 8.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap" data-hover="background:#7e151b">${COPY.forYou.accept}</span>
                <span data-act="decline" data-cid="${esc(m.cid)}" data-id="${esc(m.id)}" class="mx-net-act" style="flex:1;text-align:center;padding:9px 0;border:1px solid rgba(25,21,18,.25);font:600 8.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap" data-hover="border-color:#191512">${COPY.forYou.decline}</span>
              </span>
            </div>
          </div>`; }

function cardSuggestion(m) {
  const face = connFace(m);
  const why = m.why_label || (COPY.reasons[m.why] ? (typeof COPY.reasons[m.why] === 'function' ? COPY.reasons[m.why]((m.reasons && m.reasons[0] && m.reasons[0].n) || 1) : COPY.reasons[m.why]) : '');
  return `
          <div data-card="${esc(m.id)}" style="border:1px solid rgba(25,21,18,.16);background:#fdfaf3;display:flex;flex-direction:column">
            <div style="height:130px;background:repeating-linear-gradient(45deg,rgba(25,21,18,.07) 0 10px,rgba(25,21,18,.03) 10px 20px);display:flex;align-items:center;justify-content:center;font:600 9px ui-monospace,Menlo,monospace;color:#4a4239;position:relative;overflow:hidden">${m.photo_url ? `<img src="${esc(photoUrl(m.photo_url))}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">` : esc(portraitLabel(m))}<span style="position:absolute;top:10px;left:10px;padding:2px 7px;border:1px solid rgba(201,169,98,.65);background:#fdfaf3;color:#6e5626;font:600 8.5px Inter,sans-serif;letter-spacing:.14em">${esc(why)}</span></div>
            <div style="padding:13px 15px 15px;display:flex;flex-direction:column;gap:5px;flex:1">
              <span data-act="peek" data-id="${esc(m.id)}" style="font-family:Fraunces,serif;font-size:16.5px;line-height:1.2">${esc(m.name)}</span>
              <span style="font-size:11.5px;color:#4a4239;line-height:1.4">${esc(subLine(m))}</span>
              <span style="display:flex;gap:7px;border-top:1px solid rgba(25,21,18,.1);padding-top:10px;margin-top:auto">
                <span data-act="connect" data-id="${esc(m.id)}" class="mx-net-act" style="flex:1;text-align:center;padding:9px 0;background:${face.bg};color:${face.fg};border:1px solid ${face.bd};font:600 8.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap">${face.label}</span>
                <span data-act="message" data-id="${esc(m.id)}" class="mx-net-act" style="flex:1;text-align:center;padding:9px 0;border:1px solid rgba(25,21,18,.25);font:600 8.5px Inter,sans-serif;letter-spacing:.13em;color:#191512;cursor:pointer;white-space:nowrap" data-hover="border-color:#191512">${COPY.forYou.message}</span>
              </span>
            </div>
          </div>`;
}

function blockForYou() {
  const requests = D.pending;
  const suggestions = D.sugg.slice(0, Math.max(0, 8 - requests.length));
  const cards = requests.map(cardRequest).concat(suggestions.map(cardSuggestion));
  return `
      <!-- dc: Network.dc.html › "01 · PEOPLE FOR YOU" -->
      <div id="foryou" class="mx-wrap-row" style="display:flex;align-items:baseline;gap:14px;padding:22px 0 12px">
        <span style="font-family:Fraunces,serif;font-weight:600;font-size:14px;color:#9b1b22">${COPY.forYou.n}</span>
        <span style="font:600 14px Inter,sans-serif;letter-spacing:.14em">${COPY.forYou.title}</span>
        <span style="font-size:12px;color:#4a4239">${COPY.forYou.sub}</span>
      </div>
      ${cards.length ? `<div class="mx-grid-4" style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;padding-bottom:10px">${cards.join('')}</div>` : `
      <!-- v2: Empty States.dc.html pattern (no requests, no suggestions) -->
      <div class="empty" style="border:1px solid rgba(25,21,18,.16);background:#fdfaf3;margin-bottom:10px">
        <span class="rule-gold" style="margin-bottom:6px"></span>
        <span class="empty-line">${COPY.forYou.emptyLine}</span>
        <span class="empty-why">${COPY.forYou.emptyWhy}</span>
        <a href="/app/profile" style="margin-top:8px;padding:11px 20px;border:1px solid rgba(25,21,18,.3);font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#191512;white-space:nowrap" data-hover="border-color:#191512;color:#191512">${COPY.forYou.emptyCta}</a>
      </div>`}
      <!-- /dc -->`;
}

function blockMyNetwork() {
  const n = D.conns.length;
  return `
      <!-- dc: Network.dc.html › "02 · MY NETWORK" -->
      <div class="mx-wrap-row" style="display:flex;align-items:baseline;gap:14px;padding:16px 0 12px;border-top:1px solid rgba(25,21,18,.16)">
        <span style="font-family:Fraunces,serif;font-weight:600;font-size:14px;color:#9b1b22">${COPY.net.n}</span>
        <span style="font:600 14px Inter,sans-serif;letter-spacing:.14em">${COPY.net.title}</span>
        <span style="font-size:12px;color:#4a4239">${n === 0 ? COPY.net.zero : COPY.net.count(n)}</span>
      </div>
      ${n ? `<div style="max-width:960px">
        ${D.conns.map(m => `
          <div class="mx-net-row" data-card="${esc(m.id)}" style="display:flex;gap:16px;align-items:center;padding:12px 0;border-bottom:1px solid rgba(25,21,18,.12)">
            <span style="width:40px;height:40px;background:#191512;color:#f7f1e6;display:inline-flex;align-items:center;justify-content:center;font:600 13px Fraunces,serif;flex:none;overflow:hidden">${m.photo_url ? `<img src="${esc(photoUrl(m.photo_url))}" alt="" style="width:100%;height:100%;object-fit:cover">` : esc(initialsOf(m.name))}</span>
            <span class="mx-net-id" style="flex:1;min-width:0"><span data-act="peek" data-id="${esc(m.id)}" style="display:block;font-family:Fraunces,serif;font-size:16.5px;line-height:1.2">${esc(m.name)}</span><span style="display:block;font-size:11.5px;color:#4a4239;margin-top:2px">${esc(m.institution || 'Med&X member')}</span></span>
            <span style="padding:3px 9px;border:1px solid rgba(201,169,98,.65);color:#6e5626;font:600 8.5px Inter,sans-serif;letter-spacing:.14em;white-space:nowrap">${COPY.net.connected}</span>
            <span data-act="message" data-id="${esc(m.id)}" class="mx-net-act" style="padding:9px 15px;background:#9b1b22;color:#f7f1e6;font:600 9px Inter,sans-serif;letter-spacing:.14em;cursor:pointer;white-space:nowrap" data-hover="background:#7e151b;color:#f7f1e6">${COPY.net.message}</span>
            <span data-act="remove" data-cid="${esc(m.cid)}" data-id="${esc(m.id)}" data-name="${esc(m.name)}" data-v2="remove — required control, not on the artboard" class="mx-net-act" style="padding:9px 12px;border:1px solid rgba(25,21,18,.25);color:#4a4239;font:600 9px Inter,sans-serif;letter-spacing:.14em;cursor:pointer;white-space:nowrap" data-hover="border-color:#9b1b22;color:#9b1b22">${COPY.net.remove}</span>
          </div>`).join('')}
      </div>` : `
      <div style="border:1px solid rgba(25,21,18,.16);background:#fdfaf3;padding:22px;display:flex;flex-direction:column;align-items:center;gap:7px;text-align:center;max-width:960px">
        <span style="width:28px;height:1px;background:#c9a962"></span>
        <span style="font-family:Fraunces,serif;font-style:italic;font-size:16px;color:#4a4239">${COPY.net.emptyLine}</span>
        <span style="font-size:12px;color:#4a4239">${COPY.net.emptyWhy}</span>
        <span data-act="seeSugg" style="margin-top:8px;padding:11px 20px;border:1px solid rgba(25,21,18,.3);font:600 10px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;color:#191512;white-space:nowrap" data-hover="border-color:#191512">${COPY.net.emptyCta}</span>
      </div>`}
      <!-- /dc -->`;
}

function rowMember(m, i, matched) {
  const face = connFace(m);
  const av = AV[i % AV.length];
  const s = cstate(m).state;
  // point out the match only when it hit a field the row does not already show (name / institution / city / country)
  const hidden = matched && m.matchedOn ? m.matchedOn.filter(f => !['name', 'institution', 'city', 'country'].includes(f)) : [];
  const matchNote = hidden.length
    ? ` <span style="color:#6e5626">— ${esc(COPY.results.matches(COPY.matchedLabels[hidden[0]] || hidden[0]))}</span>` : '';
  return `
        <div class="mx-net-row" data-card="${esc(m.id)}" style="display:flex;gap:16px;align-items:center;padding:12px 0;border-bottom:1px solid rgba(25,21,18,.12)">
          <span style="width:40px;height:40px;background:${av[0]};color:${av[1]};display:inline-flex;align-items:center;justify-content:center;font:600 13px Fraunces,serif;flex:none;overflow:hidden">${m.photo_url ? `<img src="${esc(photoUrl(m.photo_url))}" alt="" style="width:100%;height:100%;object-fit:cover">` : esc(m.initials || initialsOf(m.name))}</span>
          <span class="mx-net-id" style="flex:1;min-width:0"><span data-act="peek" data-id="${esc(m.id)}" style="display:block;font-family:Fraunces,serif;font-size:16.5px;line-height:1.2">${esc(m.name)}</span><span style="display:block;font-size:11.5px;color:#4a4239;margin-top:2px">${esc(subLine(m))}${matchNote}</span></span>
          <span data-act="connect" data-id="${esc(m.id)}" ${s === 'pending_in' ? `data-cid="${esc(cstate(m).id)}"` : ''} class="mx-net-act" style="padding:9px 15px;background:${face.bg};color:${face.fg};border:1px solid ${face.bd};font:600 9px Inter,sans-serif;letter-spacing:.14em;cursor:pointer;white-space:nowrap">${face.label}</span>
          <span data-act="message" data-id="${esc(m.id)}" class="mx-net-act" style="padding:9px 15px;border:1px solid rgba(25,21,18,.25);font:600 9px Inter,sans-serif;letter-spacing:.14em;color:#191512;cursor:pointer;white-space:nowrap" data-hover="border-color:#191512">${COPY.net.message}</span>
        </div>`;
}

function pager(act, page, pages) {
  if (pages <= 1) return '';
  return `<div data-v2="pager" style="display:flex;justify-content:center;align-items:center;gap:14px;padding:16px 0 4px">
      <span data-act="${act}" data-page="${page - 1}" ${page <= 1 ? 'aria-disabled="true"' : ''} style="padding:9px 14px;border:1px solid rgba(25,21,18,.3);font:600 9px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;white-space:nowrap" data-hover="border-color:#191512">${COPY.browse.prev}</span>
      <span style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:#4a4239;white-space:nowrap">${COPY.browse.page(page, pages)}</span>
      <span data-act="${act}" data-page="${page + 1}" ${page >= pages ? 'aria-disabled="true"' : ''} style="padding:9px 14px;border:1px solid rgba(25,21,18,.3);font:600 9px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;white-space:nowrap" data-hover="border-color:#191512">${COPY.browse.next}</span>
    </div>`;
}

function blockBrowse() {
  const d = st.dir;
  return `
      <!-- dc: Network.dc.html › "BROWSE ALL 50 MEMBERS ↓" -->
      <div style="display:flex;justify-content:center;align-items:baseline;gap:14px;padding:20px 0 ${d.open ? '8px' : '30px'}">
        <span data-act="browse" class="mx-net-act" style="padding:11px 20px;border:1px solid rgba(25,21,18,.3);font:600 10px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;white-space:nowrap" data-hover="border-color:#191512">${d.open ? COPY.browse.close : COPY.browse.label(fmt.num(D.total))}</span>
        <span style="font-size:11.5px;color:#4a4239">${COPY.browse.or}</span>
      </div>
      ${d.open ? `
      <!-- v2: paginated directory list (no artboard section — rows reuse the artboard's search-result row) -->
      <div style="max-width:960px;margin:0 auto;padding-bottom:26px">
        ${d.loading ? `<div style="padding:18px 0;text-align:center;font-size:12px;color:#4a4239">Loading the directory…</div>`
          : (d.items || []).map((m, i) => rowMember(m, i, false)).join('') + pager('dirPage', d.page, d.pages)}
      </div>` : ''}
      <!-- /dc -->`;
}

function blockResults() {
  const r = st.res;
  return `
      <!-- dc: Network.dc.html › "01 · SEARCH RESULTS" -->
      <div class="mx-wrap-row" style="display:flex;align-items:baseline;gap:14px;padding:22px 0 12px">
        <span style="font-family:Fraunces,serif;font-weight:600;font-size:14px;color:#9b1b22">${COPY.results.n}</span>
        <span style="font:600 14px Inter,sans-serif;letter-spacing:.14em">${COPY.results.title}</span>
        <div style="flex:1"></div>
        <span style="font-size:11.5px;color:#4a4239">${r ? COPY.results.count(fmt.num(r.total), fmt.num(D.total)) : 'Searching…'}</span>
      </div>
      <div style="max-width:960px">
        ${r ? r.items.map((m, i) => rowMember(m, i, true)).join('') : ''}
      </div>
      ${r && r.total === 0 ? `
      <div style="border:1px solid rgba(25,21,18,.16);background:#fdfaf3;padding:26px;display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center;max-width:960px">
        <span style="font-family:Fraunces,serif;font-style:italic;font-size:16px;color:#4a4239">${COPY.results.noneLine(esc(st.q))}</span>
        <span style="font-size:12px;color:#4a4239">${COPY.results.noneWhy}</span>
      </div>` : ''}
      ${r ? pager('resPage', r.page, r.pages) : ''}
      <div style="padding:14px 0 30px"></div>
      <!-- /dc -->`;
}

function contentBlock() {
  const searching = !!st.q.trim();
  return `<div data-block="content">
    ${searching ? blockResults() : blockForumTeaser() + blockForYou() + blockMyNetwork() + blockBrowse()}
  </div>`;
}

function template() { return `
<div data-screen-label="Network" style="font-family:Inter,sans-serif;color:#191512;background:#f7f1e6;min-height:100vh">
  ${blockCrumb()}
  ${blockTabs()}
  ${blockHero()}
  <div class="mx-gutter" style="padding:0 36px 8px">
    ${contentBlock()}
  </div>
</div>`; }

// ---------------------------------------------------------------- behaviour
function rerenderContent() {
  const el = rootEl && rootEl.querySelector('[data-block="content"]');
  if (el) el.outerHTML = contentBlock();
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
    rerenderContent();
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
function refreshBackground() {   // re-sync lists after a mutation without blocking the optimistic UI
  load(st.q).then(fresh => {
    if (!rootEl) return;
    fresh.sugg = D.sugg;   // shown suggestion cards keep their place; only their button faces change (CS)
    D = fresh;
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
      const prev = CS.get(id); CS.set(id, { state: 'none', id: null }); rerenderContent();
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
    CS.set(id, { state: 'pending_out', id: null }); rerenderContent();
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
    CS.set(id, { state: 'connected', id: cid }); rerenderContent();
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

  peek: (el) => {
    const m = findMember(el.dataset.id);
    if (!m) return ui.toast('Profile details are not loaded for this member.');
    const parts = [m.title, m.institution, [m.city, m.country].filter(Boolean).join(', ')].filter(Boolean);
    const chips = (m.specialties || []).concat(m.tags || []);
    ui.modal({
      eyebrow: COPY.peek.eyebrow,
      title: esc(m.name),
      body: `${parts.length ? `<p style="margin:0 0 10px">${esc(parts.join(' · '))}</p>` : ''}
        ${chips.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 12px">${chips.map(t => `<span class="chip" style="cursor:default">${esc(t)}</span>`).join('')}</div>` : ''}
        ${m.bio ? `<p style="margin:0">${esc(m.bio)}</p>` : (parts.length || chips.length ? '' : '<p style="margin:0">This member has not filled in their profile yet.</p>')}`,
      actions: [{ label: COPY.peek.close }]
    });
  }
};

function wireSearchInput() {
  const input = rootEl.querySelector('[data-role="q"]');
  if (!input) return;
  input.addEventListener('input', () => {
    st.q = input.value; syncUrl();
    clearTimeout(debounceT);
    if (!st.q.trim()) { st.res = null; seq++; rerenderContent(); return; }
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
    const q0 = (ctx.query && ctx.query.q) || '';
    st = { q: q0, res: null, dir: { open: false, loading: false, items: [], page: 1, pages: 1 } };
    D = await load(q0);
    if (rootEl !== root) return;   // navigated away while loading
    root.innerHTML = template();
    unbind = ui.bind(root, handlers);
    wireSearchInput();
    if (q0.trim()) runSearch(1);
  },
  destroy() {
    clearTimeout(debounceT); debounceT = null; seq++;
    if (unbind) unbind(); unbind = null;
    rootEl = null; D = null; st = null; CS = null;
  }
};
