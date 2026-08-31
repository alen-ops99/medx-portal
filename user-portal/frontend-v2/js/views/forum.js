// Source: Biomedical Forum.dc.html
// Blocks (artboard order): "Breadcrumb" › "Hero" › "Facts band" › "01 · THE NETWORK" ›
// "FROM THE FORUM" (featured + grid) › "02 · THE ANNUAL GATHERING" › "03 · GATHERING SPEAKERS" ›
// "04 · YOUR MEMBERSHIP" (3-stage indicator · code entry / member / confirmed · v2 venue vote) › "Message us".
// Data: GET /api/v2/forum/state (membership · gathering · registration · vote · schedule · speakers)
// + GET /api/v2/forum/feed (the "From the Forum" store: v2 composer table ∪ legacy forum_news).
// Actions: POST /api/v2/forum/redeem-code (UNLOCK REGISTRATION — distinct empty/unknown/expired/used/
// member errors) · POST /api/v2/forum/register (COMPLETE REGISTRATION — annual terms required) ·
// POST /api/v2/forum/vote (Split-or-Zagreb, one changeable vote per member). MESSAGE US → /app/messages.
// The Auth "Invitation code" screen stores a guest-checked code in sessionStorage.medx_forum_code;
// this view redeems it on arrival (see "Requested shared changes" in the build report).
import { api } from '../api.js';
import { session } from '../state.js';
import { ui, esc, fmt } from '../ui.js';
import { FACTS } from '../facts.js';
import { chrome } from '../chrome.js';
import router from '../router.js';

export const SOURCE = 'Biomedical Forum.dc.html';
const PENDING_CODE_KEY = 'medx_forum_code';   // written by js/views/auth.js after a guest check-code

export const COPY = {
  crumb: { projects: 'PROJECTS', here: 'BIOMEDICAL FORUM' },
  hero: {
    badge: 'AN INVITATION-ONLY NETWORK · GATHERS ONCE A YEAR',
    headline: 'The Biomedical <i style="color:#c9a962">Forum</i>',
    line: (label, where) => `Annual gathering · ${label} · ${where} — venue announced with your invitation`,
    blurb: 'A standing network of leaders in medicine, science, and industry. Members stay connected in the portal all year — and meet in person once a year, over two days closing with a gala evening.',
    join: 'JOIN WITH YOUR CODE →', member: 'YOUR MEMBERSHIP →'
  },
  band: ['SPLIT OR ZAGREB · MEMBERS VOTE ON THE VENUE', '150–200 SENIOR GUESTS', 'ANNUAL MEMBERSHIP · RENEWED EACH YEAR', 'GALA DINNER &amp; ANNUAL AWARDS'],
  network: {
    n: '01', title: 'THE NETWORK',
    intro: cap => `The Forum is a network, not just an event — the leadership of Croatian and international biomedicine, limited to ${cap} members so every relationship stays personal. Membership is by invitation: your code arrives by email, and joining unlocks the member circle here in the portal along with registration for the annual gathering.`,
    directory: 'Forum members appear alongside your connections in <a href="/app/network">the member network</a> — message and connect year-round.',
    cards: cap => [
      { tag: 'THE CIRCLE', title: `${cap} members, by invitation`, body: 'The leadership of Croatian and international biomedicine — heads of clinics, labs, and companies, reachable in the portal year-round.' },
      { tag: 'THE GATHERING', title: 'Two days, once a year', body: 'Every May the Forum meets in person, closing with a gala evening. Members register first.' },
      { tag: 'THE MEMBERSHIP', title: 'Annual, renewable', body: `Membership runs for one year and renews annually — the full terms arrive with your registration. The cap stays at ${cap} so every relationship stays personal.` }
    ]
  },
  feed: {
    mark: '◆', title: 'FROM THE FORUM', sub: 'New highlights from the network — posted by the Med&amp;X team.',
    by: 'from the Med&amp;X team',
    emptyLine: 'Quiet week at the Forum.',
    emptyWhy: 'Highlights from the network — member spotlights, Forum news, things worth reading — appear here as the Med&amp;X team posts them.',
    emptyCta: 'MEET THE NETWORK →'
  },
  gathering: {
    n: '02', title: 'THE ANNUAL GATHERING',
    sub: 'Two days each May · the closing gala evening runs like this — the full program follows with your invitation.',
    // Shown only when GET /api/v2/forum/state carries no schedule rows (the artboard's default evening run-of-show)
    fallback: [
      { time: '18:00', title: 'Welcome Reception', note: 'Champagne reception and networking' },
      { time: '19:00', title: 'Opening Remarks', note: 'Alen Juginović, MD — President of Med&X' },
      { time: '19:30', title: 'Keynote Address', note: 'The Future of Biomedicine · Vision 2030' },
      { time: '20:30', title: 'Gala Dinner', note: 'Four-course dinner with wine pairing' },
      { time: '22:00', title: 'Awards Ceremony', note: 'Recognition of outstanding achievements' },
      { time: '23:00', title: 'Evening Entertainment', note: 'Live music and continued networking' }
    ]
  },
  speakers: {
    n: '03', title: 'GATHERING SPEAKERS', sub: 'Announced with the program — Forum members hear first.',
    emptyLine: y => `Speakers for the ${y} gathering are announced with the program.`,
    emptyWhy: 'Watch this page — and your inbox — as May approaches.'
  },
  membership: {
    n: '04', title: 'YOUR MEMBERSHIP',
    stages: ['JOIN THE NETWORK', 'GATHERING REGISTRATION', 'CONFIRMED'],
    inviteLine: 'Received an invitation? Enter your code to join the Forum network.',
    codePlaceholder: 'FORUM CODE', unlock: 'UNLOCK REGISTRATION →', checking: 'CHECKING…',
    note: cap => `Annual membership, renewed each year · capped at ${cap} members. No code yet? Message us below.`,
    emptyCode: 'Enter the code from your invitation email.',
    memberTag: 'FORUM MEMBER',
    welcome: first => `Welcome to the Forum${first ? ', ' + first : ''}.`,
    memberBody: 'You\'re in the network — register for the annual gathering to confirm your seat. Your QR pass will appear in My Med&amp;X once confirmed.',
    complete: 'COMPLETE REGISTRATION →',
    renews: d => `Annual membership · renews ${d}`, renewsOpen: 'Annual membership · renewed each year',
    lapsed: 'Your membership has lapsed — enter this year\'s code to renew it.',
    confirmedHead: first => `Your seat is confirmed${first ? ', ' + first : ''}.`,
    confirmedBody: ref => `Reference <span style="font:600 12px ui-monospace,Menlo,monospace;letter-spacing:.08em;color:#f7f1e6">${ref}</span> · your QR pass is in My Med&amp;X. The full program follows with your invitation.`,
    myMedx: 'MY MED&amp;X →', addCal: 'ADD TO CALENDAR', icsFile: 'medx-forum-gathering.ics',
    icsDone: 'Calendar file downloaded — open it to add the gathering.',
    noEvent: 'Registration for the next gathering opens here — Forum members hear first.'
  },
  reg: {
    eyebrow: 'BIOMEDICAL FORUM · GATHERING REGISTRATION',
    title: 'Confirm your seat.',
    intro: (label, where) => `The annual gathering · ${label} · ${where} — the venue follows the members' vote.`,
    name: 'NAME', institution: 'INSTITUTION', dietary: 'DIETARY NOTES · OPTIONAL',
    dietaryPh: 'Vegetarian, allergies…',
    termsTitle: 'ANNUAL MEMBERSHIP · THE TERMS',
    termsBody: cap => `Forum membership is annual and renewable — it runs for one year from the day you join and renews each year with your invitation. Registering confirms your seat at the gathering; the circle stays capped at ${cap} members so every relationship stays personal.`,
    termsAccept: 'I accept the annual, renewable membership terms.',
    termsNeeded: 'Please accept the annual membership terms to register.',
    cancel: 'NOT NOW', submit: 'CONFIRM MY SEAT →', busy: 'CONFIRMING…',
    done: 'Your seat at the gathering is confirmed.'
  },
  vote: {
    eyebrow: 'SPLIT OR ZAGREB · MEMBERS VOTE ON THE VENUE',
    line: 'Where shall the Forum meet in 2027?',
    note: 'One vote per member — you can change it any time before the venue is announced.',
    labels: { split: 'SPLIT', zagreb: 'ZAGREB' },
    counted: 'Vote counted.', updated: 'Vote updated.'
  },
  contact: {
    line: 'Questions about your invitation, the program, or sponsorship?',
    sub: 'Message us · replies land right here in your portal inbox.',
    cta: 'MESSAGE US →'
  }
};

let D = null, st = null, unbind = null, rootEl = null, timers = [];

function ago(v) {
  const d = fmt.toDate(v); if (!d) return '';
  if (d.getTime() > Date.now() + 60000) return fmt.shortDate(d); // future-dated (scheduled/display date) → show the date
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 3600) return Math.max(1, Math.round(s / 60)) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  const days = Math.round(s / 86400);
  if (days === 1) return 'yesterday';
  if (days < 7) return days + ' days ago';
  if (days < 30) return Math.round(days / 7) + (Math.round(days / 7) === 1 ? ' week ago' : ' weeks ago');
  return fmt.shortDate(d);
}
function ensureCss() {
  if (!document.getElementById('mx-css-forum')) {
    const l = document.createElement('link');
    l.id = 'mx-css-forum'; l.rel = 'stylesheet'; l.href = '/css/views/forum.css';
    document.head.appendChild(l);
  }
}

// ---------------------------------------------------------------- data
async function load() {
  const r = await api.settle({ state: api.get('/api/v2/forum/state'), feed: api.get('/api/v2/forum/feed?limit=12') });
  const state = r.state || { stage: 1, cap: FACTS.forum.cap, membership: { is_member: false }, gathering: null, registration: null, vote: null, schedule: [], speakers: [], user: {} };
  const g = state.gathering;
  return {
    state,
    stage: state.stage || 1,
    cap: state.cap || FACTS.forum.cap,
    feed: (r.feed && r.feed.items) || [],
    gatherLabel: g && g.start_date ? fmt.longRange(g.start_date, g.end_date) : FACTS.forum.gathering.label,
    gatherWhere: (g && g.location_name && g.location_name.split('—')[0].trim()) || FACTS.forum.gathering.where,
    gatherYear: String((g && g.start_date) || FACTS.forum.gathering.start).slice(0, 4),
    schedule: (state.schedule && state.schedule.length) ? state.schedule : COPY.gathering.fallback,
    first: (state.user && state.user.first_name) || (session.user || {}).first_name || ''
  };
}
const mkFeed = p => ({ tag: p.tag || '', when: ago(p.published_at), body: p.body || '', headline: p.name || p.title || '', sub: p.role || '', init: p.init || '', isSpot: p.kind === 'spotlight' });

// ---------------------------------------------------------------- blocks
function blockCrumb() { return `
  <!-- dc: Biomedical Forum.dc.html › "Breadcrumb" -->
  <div class="mx-gutter" style="display:flex;align-items:center;gap:13px;padding:10px 36px;border-bottom:1px solid rgba(25,21,18,.16)">
    <span data-nav="/app/projects" style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#4a4239" data-hover="color:#191512">${COPY.crumb.projects}</span>
    <span style="color:rgba(25,21,18,.35);font-size:10px">→</span>
    <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#191512">${COPY.crumb.here}</span>
  </div>
  <!-- /dc -->`; }

function blockHero() {
  const isMember = D.stage >= 2;
  return `
  <!-- dc: Biomedical Forum.dc.html › "Hero" -->
  <div style="position:relative;overflow:hidden">
    <img src="/assets/photo-bridges.jpg" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">
    <div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(25,21,18,.74) 0%,rgba(25,21,18,.58) 55%,rgba(25,21,18,.86) 100%)"></div>
    <div class="mx-pad-hero" style="position:relative;padding:56px 36px 46px;display:flex;flex-direction:column;align-items:center;text-align:center">
      <span style="padding:6px 12px;border:1px solid rgba(201,169,98,.7);color:#c9a962;font:600 10px Inter,sans-serif;letter-spacing:.18em;text-align:center">${COPY.hero.badge}</span>
      <div class="mx-display-52" style="font-family:Fraunces,serif;font-size:52px;line-height:1.08;color:#f7f1e6;margin-top:20px">${COPY.hero.headline}</div>
      <div style="font-family:Fraunces,serif;font-style:italic;font-size:21px;color:#c9a962;margin-top:14px">${esc(COPY.hero.line(D.gatherLabel, D.gatherWhere))}</div>
      <div style="font-size:15px;color:rgba(247,241,230,.85);margin-top:10px;max-width:620px">${COPY.hero.blurb}</div>
      <div style="display:flex;gap:13px;margin-top:26px;justify-content:center;flex-wrap:wrap">
        <a href="#forum-invitation" data-act="join" style="padding:13px 22px;background:#c9a962;color:#191512;font:600 10.5px Inter,sans-serif;letter-spacing:.16em;white-space:nowrap" data-hover="background:#d9bd7f">${isMember ? COPY.hero.member : COPY.hero.join}</a>
      </div>
    </div>
  </div>
  <!-- /dc -->`;
}

function blockBand() {
  const sep = '<span style="width:1px;height:18px;background:rgba(247,241,230,.25)"></span>';
  const item = (t, gold) => `<span style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:${gold ? '#c9a962' : 'rgba(247,241,230,.9)'};text-align:center">${t}</span>`;
  return `
  <!-- dc: Biomedical Forum.dc.html › "Facts band" -->
  <div class="mx-wrap-center mx-pad-band" style="display:flex;align-items:center;justify-content:center;gap:26px;padding:13px 36px;background:#191512;color:#f7f1e6;flex-wrap:wrap">
    ${item(COPY.band[0])}${sep}${item(COPY.band[1])}${sep}${item(COPY.band[2])}${sep}${item(COPY.band[3], true)}
  </div>
  <!-- /dc -->`;
}

function blockNetwork() {
  const card = c => `
      <div style="border:1px solid rgba(25,21,18,.16);border-top:2px solid #c9a962;background:#fdfaf3;padding:16px 18px;display:flex;flex-direction:column;gap:6px">
        <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#6e5626">${c.tag}</span>
        <span style="font-family:Fraunces,serif;font-size:15.5px;line-height:1.25">${c.title}</span>
        <span style="font-size:12px;color:#4a4239;line-height:1.55">${c.body}</span>
      </div>`;
  return `
    <!-- dc: Biomedical Forum.dc.html › "01 · THE NETWORK" -->
    <div style="display:flex;align-items:baseline;gap:14px;padding:26px 0 10px">
      <span style="font-family:Fraunces,serif;font-weight:600;font-size:14px;color:#9b1b22">${COPY.network.n}</span>
      <span style="font:600 14px Inter,sans-serif;letter-spacing:.14em">${COPY.network.title}</span>
    </div>
    <div style="font-size:13.5px;color:#4a4239;line-height:1.65;max-width:860px">${COPY.network.intro(D.cap)}</div>
    <div style="display:flex;gap:14px;align-items:baseline;padding:10px 0 0">
      <span style="font-size:12px;color:#4a4239">${COPY.network.directory}</span>
    </div>
    <div class="mx-grid-3" style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;padding:18px 0 8px;max-width:960px">
      ${COPY.network.cards(D.cap).map(card).join('')}
    </div>
    <!-- /dc -->`;
}

function blockFeed() {
  const feed = D.feed.map(mkFeed);
  const featured = feed[0] || null;
  const rest = feed.slice(1);
  const head = `
    <div class="mx-wrap-row" style="display:flex;align-items:baseline;gap:14px;padding:30px 0 10px;flex-wrap:wrap">
      <span style="font-family:Fraunces,serif;font-weight:600;font-size:14px;color:#9b1b22">${COPY.feed.mark}</span>
      <span style="font:600 14px Inter,sans-serif;letter-spacing:.14em">${COPY.feed.title}</span>
      <span style="font-size:12.5px;color:#4a4239">${COPY.feed.sub}</span>
    </div>`;
  if (!featured) return `
    <!-- dc: Biomedical Forum.dc.html › "FROM THE FORUM" -->${head}
    <div style="border:1px solid rgba(25,21,18,.16);background:#fdfaf3;max-width:960px">
      <div class="empty">
        <span style="width:28px;height:1px;background:#c9a962;margin-bottom:6px"></span>
        <span style="font-family:Fraunces,serif;font-style:italic;font-size:17px">${COPY.feed.emptyLine}</span>
        <span style="font-size:12.5px;color:#4a4239;max-width:400px;line-height:1.55">${COPY.feed.emptyWhy}</span>
        <span data-nav="/app/network" style="margin-top:8px;padding:11px 20px;border:1px solid rgba(25,21,18,.3);font:600 10px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;color:#191512;white-space:nowrap">${COPY.feed.emptyCta}</span>
      </div>
    </div>
    <!-- /dc -->`;
  return `
    <!-- dc: Biomedical Forum.dc.html › "FROM THE FORUM" -->${head}
    <div style="border:1px solid rgba(25,21,18,.16);border-top:2px solid #c9a962;background:#fdfaf3;padding:22px 24px;max-width:960px">
      <span style="font:600 9px Inter,sans-serif;letter-spacing:.16em;color:#9b1b22">${esc(featured.tag)}</span>
      <div style="display:flex;gap:16px;align-items:center;margin-top:14px">
        ${featured.isSpot && featured.init ? `<span style="width:52px;height:52px;flex:none;background:#191512;color:#c9a962;display:inline-flex;align-items:center;justify-content:center;font:600 18px Fraunces,serif">${esc(featured.init)}</span>` : ''}
        <span style="min-width:0"><span style="display:block;font-family:Fraunces,serif;font-size:22px;line-height:1.15">${esc(featured.headline)}</span>${featured.sub ? `<span style="display:block;font-size:12.5px;color:#4a4239;margin-top:3px">${esc(featured.sub)}</span>` : ''}</span>
      </div>
      <div style="font-size:14px;color:#191512;line-height:1.65;margin-top:14px;max-width:720px;text-wrap:pretty">${esc(featured.body)}</div>
      <div style="font-size:11px;color:#6d6459;margin-top:13px;letter-spacing:.02em">${esc(featured.when)} · ${COPY.feed.by}</div>
    </div>
    ${rest.length ? `
    <div class="mx-grid-2" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;max-width:960px;margin-top:16px;padding-bottom:6px">
      ${rest.map(f => `
        <div style="border:1px solid rgba(25,21,18,.14);background:#fdfaf3;padding:16px 18px;display:flex;flex-direction:column;gap:9px">
          <span style="font:600 8.5px Inter,sans-serif;letter-spacing:.16em;color:#9b1b22">${esc(f.tag)}</span>
          <div style="display:flex;gap:11px;align-items:center">
            ${f.isSpot && f.init ? `<span style="width:34px;height:34px;flex:none;background:#191512;color:#c9a962;display:inline-flex;align-items:center;justify-content:center;font:600 12px Fraunces,serif">${esc(f.init)}</span>` : ''}
            <span style="font-family:Fraunces,serif;font-size:15.5px;line-height:1.2;min-width:0">${esc(f.headline)}</span>
          </div>
          <span style="font-size:12.5px;color:#4a4239;line-height:1.55;text-wrap:pretty">${esc(f.body)}</span>
          <span style="font-size:10.5px;color:#6d6459;letter-spacing:.02em">${esc(f.when)}</span>
        </div>`).join('')}
    </div>` : ''}
    <!-- /dc -->`;
}

function blockSchedule() {
  return `
    <!-- dc: Biomedical Forum.dc.html › "02 · THE ANNUAL GATHERING" -->
    <div id="forum-schedule" class="mx-wrap-row" style="display:flex;align-items:baseline;gap:14px;padding:26px 0 6px">
      <span style="font-family:Fraunces,serif;font-weight:600;font-size:14px;color:#9b1b22">${COPY.gathering.n}</span>
      <span style="font:600 14px Inter,sans-serif;letter-spacing:.14em">${COPY.gathering.title}</span>
      <span style="font-size:12.5px;color:#4a4239">${COPY.gathering.sub}</span>
    </div>
    <div style="max-width:860px">
      ${D.schedule.map(row => `
        <div class="mx-forum-schedrow" style="display:flex;gap:20px;align-items:baseline;padding:12px 0;border-bottom:1px solid rgba(25,21,18,.12)">
          <span style="font:600 10px Inter,sans-serif;letter-spacing:.14em;color:#c9a962;flex:none;width:48px">${esc(row.time)}</span>
          <span style="font-family:Fraunces,serif;font-size:16.5px;flex:none;min-width:210px" class="mx-forum-schedtitle">${esc(row.title)}</span>
          <span style="font-size:12.5px;color:#4a4239">${esc(row.note)}</span>
        </div>`).join('')}
    </div>
    <!-- /dc -->`;
}

function blockSpeakers() {
  const sp = (D.state.speakers || []);
  const filled = sp.length ? `
    <!-- v2: speakers grid (the artboard ships the empty state; cards appear when the admin confirms speakers) -->
    <div class="mx-grid-3" style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;max-width:860px;margin-bottom:26px">
      ${sp.map(s => `
      <div style="border:1px solid rgba(25,21,18,.16);background:#fdfaf3;padding:16px 18px;display:flex;gap:13px;align-items:center">
        ${s.photo_url ? `<img src="${esc(s.photo_url)}" alt="" style="width:44px;height:44px;object-fit:cover;flex:none">` : `<span style="width:44px;height:44px;flex:none;background:#191512;color:#c9a962;display:inline-flex;align-items:center;justify-content:center;font:600 15px Fraunces,serif">${esc((s.name || '·').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase())}</span>`}
        <span style="min-width:0;display:flex;flex-direction:column;gap:2px">
          <span style="font-family:Fraunces,serif;font-size:15.5px;line-height:1.2">${esc(s.name)}</span>
          <span style="font-size:11.5px;color:#4a4239">${esc([s.title, s.institution].filter(Boolean).join(' · '))}</span>
          ${s.talk_title ? `<span style="font-size:11px;color:#6e5626;font-style:italic">${esc(s.talk_title)}</span>` : ''}
        </span>
      </div>`).join('')}
    </div>` : `
    <div style="border:1px solid rgba(25,21,18,.16);background:#fdfaf3;padding:24px;display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center;max-width:860px;margin-bottom:26px">
      <span style="width:28px;height:1px;background:#c9a962"></span>
      <span style="font-family:Fraunces,serif;font-style:italic;font-size:16px;color:#4a4239">${esc(COPY.speakers.emptyLine(D.gatherYear))}</span>
      <span style="font-size:12px;color:#4a4239">${COPY.speakers.emptyWhy}</span>
    </div>`;
  return `
    <!-- dc: Biomedical Forum.dc.html › "03 · GATHERING SPEAKERS" -->
    <div class="mx-wrap-row" style="display:flex;align-items:baseline;gap:14px;padding:26px 0 12px">
      <span style="font-family:Fraunces,serif;font-weight:600;font-size:14px;color:#9b1b22">${COPY.speakers.n}</span>
      <span style="font:600 14px Inter,sans-serif;letter-spacing:.14em">${COPY.speakers.title}</span>
      <span style="font-size:12.5px;color:#4a4239">${COPY.speakers.sub}</span>
    </div>
    ${filled}
    <!-- /dc -->`;
}

function stageIndicator() {
  const stage = D.stage;
  return COPY.membership.stages.map((label, i) => {
    const n = i + 1, cur = n === stage, done = n < stage;
    const bg = cur ? '#c9a962' : done ? 'rgba(201,169,98,.25)' : 'transparent';
    const fg = cur ? '#191512' : done ? '#c9a962' : 'rgba(247,241,230,.6)';
    const bd = cur || done ? '#c9a962' : 'rgba(247,241,230,.3)';
    const lc = cur ? '#c9a962' : done ? 'rgba(201,169,98,.8)' : 'rgba(247,241,230,.55)';
    return `
        <div style="display:flex;align-items:center">
          <div style="display:flex;flex-direction:column;align-items:center;gap:7px;padding:0 22px">
            <span style="width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;font:600 12px Fraunces,serif;background:${bg};color:${fg};border:1px solid ${bd}">${done ? '✓' : n}</span>
            <span style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:${lc};white-space:nowrap">${label}</span>
          </div>
          ${i < 2 ? `<span class="mx-forum-stageline" style="width:56px;height:1px;background:rgba(247,241,230,.25);margin-bottom:16px"></span>` : ''}
        </div>`;
  }).join('');
}

function stageBody() {
  const m = D.state.membership || {};
  if (D.stage === 1) {
    return `
      <div style="display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center">
        <span style="font-family:Fraunces,serif;font-style:italic;font-size:17px;color:rgba(247,241,230,.85)">${COPY.membership.inviteLine}</span>
        ${m.expired ? `<span style="font-size:12px;color:#c9a962">${COPY.membership.lapsed}</span>` : ''}
        <form data-form="code" style="display:contents">
          <div class="mx-forum-coderow" style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">
            <input data-role="code" name="code" value="${esc(st.prefill || '')}" placeholder="${COPY.membership.codePlaceholder}" aria-label="Forum invitation code" autocomplete="off" spellcheck="false" style="border:1px solid rgba(247,241,230,.3);background:transparent;color:#f7f1e6;padding:11px 14px;font:600 11px ui-monospace,Menlo,monospace;letter-spacing:.12em;width:180px">
            <span data-act="unlock" style="padding:11px 18px;background:#c9a962;color:#191512;font:600 10px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;white-space:nowrap" data-hover="background:#d9bd7f">${COPY.membership.unlock}</span>
          </div>
        </form>
        <div data-role="codeError" role="alert" style="display:none;font-size:12.5px;line-height:1.5;color:#e0a9ad;max-width:420px"></div>
        <span style="font-size:11.5px;color:rgba(247,241,230,.6)">${COPY.membership.note(D.cap)}</span>
      </div>`;
  }
  const renewLine = m.valid_until ? COPY.membership.renews(fmt.longRange(m.valid_until, m.valid_until)) : COPY.membership.renewsOpen;
  if (D.stage === 2) {
    const g = D.state.gathering;
    return `
      <div style="display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center">
        <span style="padding:4px 10px;border:1px solid rgba(201,169,98,.65);color:#c9a962;font:600 9px Inter,sans-serif;letter-spacing:.16em">${COPY.membership.memberTag}</span>
        <span style="font-family:Fraunces,serif;font-size:22px">${esc(COPY.membership.welcome(D.first))}</span>
        <span style="font-size:12.5px;color:rgba(247,241,230,.7);max-width:480px">${COPY.membership.memberBody}</span>
        ${g ? `<span data-act="register" style="margin-top:4px;padding:12px 20px;background:#9b1b22;color:#f7f1e6;font:600 10px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;white-space:nowrap" data-hover="background:#7e151b">${COPY.membership.complete}</span>`
            : `<span style="font-size:12px;color:rgba(247,241,230,.6)">${COPY.membership.noEvent}</span>`}
        <span style="font-size:11.5px;color:rgba(247,241,230,.55)">${esc(renewLine)}</span>
      </div>`;
  }
  const reg = D.state.registration || {};
  return `
      <!-- v2: stage 3 — confirmed state (no artboard counterpart; voice from the member block) -->
      <div style="display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center">
        <span style="padding:4px 10px;border:1px solid rgba(201,169,98,.65);color:#c9a962;font:600 9px Inter,sans-serif;letter-spacing:.16em">${COPY.membership.memberTag}</span>
        <span style="font-family:Fraunces,serif;font-size:22px">${esc(COPY.membership.confirmedHead(D.first))}</span>
        <span style="font-size:12.5px;color:rgba(247,241,230,.7);max-width:480px">${COPY.membership.confirmedBody(esc(reg.qr_code || ''))}</span>
        <div style="display:flex;gap:12px;margin-top:4px;flex-wrap:wrap;justify-content:center">
          <a href="/app/me" style="padding:12px 20px;background:#9b1b22;color:#f7f1e6;font:600 10px Inter,sans-serif;letter-spacing:.16em;white-space:nowrap" data-hover="background:#7e151b;color:#f7f1e6">${COPY.membership.myMedx}</a>
          <span data-act="addCal" style="padding:12px 20px;border:1px solid rgba(247,241,230,.35);color:#f7f1e6;font:600 10px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;white-space:nowrap" data-hover="border-color:#f7f1e6">${COPY.membership.addCal}</span>
        </div>
        <span style="font-size:11.5px;color:rgba(247,241,230,.55)">${esc(renewLine)}</span>
      </div>`;
}

function blockVote() {
  if (D.stage < 2 || !D.state.vote) return '';
  const v = D.state.vote;
  const btn = key => {
    const mine = v.mine === key;
    return `<span data-act="vote" data-choice="${key}" role="radio" aria-checked="${mine}" style="display:inline-flex;align-items:baseline;gap:9px;padding:11px 18px;border:1px solid ${mine ? '#c9a962' : 'rgba(247,241,230,.35)'};background:${mine ? '#c9a962' : 'transparent'};color:${mine ? '#191512' : '#f7f1e6'};font:600 10px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;white-space:nowrap" data-hover="border-color:#c9a962">${COPY.vote.labels[key]}<span style="font-family:Fraunces,serif;font-size:13px;color:${mine ? '#191512' : '#c9a962'}">${v.counts[key] || 0}</span></span>`;
  };
  return `
    <!-- v2: venue vote — makes the band's "MEMBERS VOTE ON THE VENUE" real (POST /api/v2/forum/vote) -->
    <div data-block="vote" style="margin-top:26px;padding-top:22px;border-top:1px solid rgba(247,241,230,.14);display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center">
      <span style="font:600 9px Inter,sans-serif;letter-spacing:.16em;color:#c9a962">${COPY.vote.eyebrow}</span>
      <span style="font-family:Fraunces,serif;font-style:italic;font-size:17px;color:rgba(247,241,230,.85)">${COPY.vote.line}</span>
      <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">${btn('split')}${btn('zagreb')}</div>
      <span style="font-size:11.5px;color:rgba(247,241,230,.55)">${COPY.vote.note}</span>
    </div>`;
}

function blockMembership() {
  return `
  <!-- dc: Biomedical Forum.dc.html › "04 · YOUR MEMBERSHIP" -->
  <div id="forum-invitation" data-block="membership" class="mx-pad-36" style="background:#191512;color:#f7f1e6;padding:34px 36px 38px">
    <div style="display:flex;align-items:baseline;gap:14px;padding-bottom:14px">
      <span style="font-family:Fraunces,serif;font-weight:600;font-size:14px;color:#c9a962">${COPY.membership.n}</span>
      <span style="font:600 14px Inter,sans-serif;letter-spacing:.14em">${COPY.membership.title}</span>
    </div>
    <div style="display:flex;justify-content:center;gap:0;padding-bottom:22px;flex-wrap:wrap">
      ${stageIndicator()}
    </div>
    ${stageBody()}
    ${blockVote()}
  </div>
  <!-- /dc -->`;
}

function blockContact() {
  return `
  <!-- dc: Biomedical Forum.dc.html › "Message us" -->
  <div class="mx-wrap-row mx-gutter" style="display:flex;align-items:center;gap:20px;padding:18px 36px 30px;flex-wrap:wrap">
    <span style="font-family:Fraunces,serif;font-style:italic;font-size:16px;color:#4a4239">${COPY.contact.line}</span>
    <span style="font-size:12px;color:#4a4239">${COPY.contact.sub}</span>
    <div style="flex:1"></div>
    <a href="/app/messages?about=forum" style="padding:10px 16px;background:#9b1b22;color:#f7f1e6;font:600 10px Inter,sans-serif;letter-spacing:.16em;white-space:nowrap" data-hover="background:#7e151b;color:#f7f1e6">${COPY.contact.cta}</a>
  </div>
  <!-- /dc -->`;
}

function template() {
  return `
<div data-screen-label="Biomedical Forum" style="font-family:Inter,sans-serif;color:#191512;background:#f7f1e6;min-height:100vh">
  ${blockCrumb()}
  ${blockHero()}
  ${blockBand()}
  <div class="mx-gutter" style="padding:0 36px">
    ${blockNetwork()}
    ${blockFeed()}
    ${blockSchedule()}
    ${blockSpeakers()}
  </div>
  ${blockMembership()}
  ${blockContact()}
</div>`;
}

// ---------------------------------------------------------------- behaviour
function showCodeError(msg) {
  const el = rootEl && rootEl.querySelector('[data-role="codeError"]');
  if (!el) return;
  el.textContent = msg || '';
  el.style.display = msg ? 'block' : 'none';
}
async function refresh({ scrollToMembership = false } = {}) {
  const fresh = await load();
  if (!rootEl) return;
  D = fresh;
  rootEl.innerHTML = template();
  wireForms();
  if (scrollToMembership) {
    const el = rootEl.querySelector('#forum-invitation');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
function wireForms() {
  const f = rootEl && rootEl.querySelector('form[data-form="code"]');
  if (f && !f.dataset.wired) { f.dataset.wired = '1'; f.addEventListener('submit', e => { e.preventDefault(); handlers.unlock(rootEl.querySelector('[data-act="unlock"]')); }); }
}
async function redeem(code, el) {
  showCodeError('');
  if (!code) return showCodeError(COPY.membership.emptyCode);
  if (el) { el.setAttribute('aria-disabled', 'true'); el.textContent = COPY.membership.checking; }
  try {
    const r = await api.post('/api/v2/forum/redeem-code', { code });
    ui.toast((r && r.message) || 'Code accepted — welcome to the Forum network.');
    chrome.refresh();
    await refresh({ scrollToMembership: true });
  } catch (e) {
    if (el) { el.removeAttribute('aria-disabled'); el.textContent = COPY.membership.unlock; }
    showCodeError(e.message);
    ui.toast(e.message, { kind: 'error', ms: 4500 });
  }
}
function openRegistration() {
  const g = D.state.gathering;
  if (!g) return ui.toast(COPY.membership.noEvent, { kind: 'error' });
  const u = D.state.user || {};
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ');
  const IN = 'border:1px solid rgba(25,21,18,.25);background:#fdfaf3;padding:11px 12px;font-size:13px;color:#191512;width:100%;box-sizing:border-box';
  const LB = 'font:600 10px Inter,sans-serif;letter-spacing:.14em;color:#4a4239';
  const m = ui.modal({
    eyebrow: COPY.reg.eyebrow,
    title: esc(COPY.reg.title),
    body: `
      <div style="font-size:12.5px;color:#4a4239;line-height:1.55;margin-bottom:14px">${esc(COPY.reg.intro(D.gatherLabel, D.gatherWhere))}</div>
      <div style="display:flex;flex-direction:column;gap:12px">
        <span style="display:flex;flex-direction:column;gap:6px"><span style="${LB}">${COPY.reg.name}</span><input data-role="regName" value="${esc(name)}" aria-label="Name" style="${IN}"></span>
        <span style="display:flex;flex-direction:column;gap:6px"><span style="${LB}">${COPY.reg.institution}</span><input data-role="regInst" value="${esc(u.institution || '')}" aria-label="Institution" style="${IN}"></span>
        <span style="display:flex;flex-direction:column;gap:6px"><span style="${LB}">${COPY.reg.dietary}</span><input data-role="regDiet" placeholder="${esc(COPY.reg.dietaryPh)}" aria-label="Dietary notes" style="${IN}"></span>
        <div style="border:1px solid rgba(201,169,98,.65);background:#fdfaf3;padding:13px 15px;display:flex;flex-direction:column;gap:7px">
          <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#6e5626">${COPY.reg.termsTitle}</span>
          <span style="font-size:12px;color:#4a4239;line-height:1.55">${esc(COPY.reg.termsBody(D.cap))}</span>
          <label style="display:flex;gap:9px;align-items:flex-start;cursor:pointer;font-size:12.5px;color:#191512;line-height:1.5"><input data-role="regTerms" type="checkbox" style="margin-top:2px;accent-color:#9b1b22">${esc(COPY.reg.termsAccept)}</label>
        </div>
        <div data-role="regError" role="alert" style="display:none;font-size:12.5px;color:#9b1b22;line-height:1.5"></div>
      </div>`,
    actions: [
      { label: COPY.reg.cancel },
      { label: COPY.reg.submit, kind: 'primary', onClick: () => { submitRegistration(m); return false; } }
    ]
  });
  return m;
}
async function submitRegistration(m) {
  const val = r => { const el = m.el.querySelector(`[data-role="${r}"]`); return el ? el.value.trim() : ''; };
  const err = m.el.querySelector('[data-role="regError"]');
  const show = t => { if (err) { err.textContent = t || ''; err.style.display = t ? 'block' : 'none'; } };
  show('');
  const terms = m.el.querySelector('[data-role="regTerms"]');
  if (!terms || !terms.checked) return show(COPY.reg.termsNeeded);
  const btn = m.el.querySelector('.mx-modal-foot .btn-primary');
  if (btn) { btn.setAttribute('aria-disabled', 'true'); btn.textContent = COPY.reg.busy; }
  try {
    const r = await api.post('/api/v2/forum/register', { terms_accepted: true, name: val('regName'), institution: val('regInst'), dietary: val('regDiet') });
    if (r && r.requires_payment && D.state.gathering) {
      // Paid gathering (admin-configurable): hand off to the existing Stripe flow for forum events.
      const s = await api.post(`/api/forum/events/${D.state.gathering.id}/checkout-session`, { registration_id: r.registration.id });
      if (s && s.url) { window.location.assign(s.url); return; }
    }
    m.close();
    ui.toast((r && r.message) || COPY.reg.done);
    chrome.refresh();
    await refresh({ scrollToMembership: true });
  } catch (e) {
    if (btn) { btn.removeAttribute('aria-disabled'); btn.textContent = COPY.reg.submit; }
    show(e.message);
  }
}

const handlers = {
  join: () => {
    const sec = rootEl.querySelector('#forum-invitation');
    if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const input = rootEl.querySelector('[data-role="code"]');
    if (input) setTimeout(() => input.focus({ preventScroll: true }), 450);
  },
  unlock: (el) => {
    const input = rootEl.querySelector('[data-role="code"]');
    redeem(input ? input.value.toUpperCase().replace(/\s+/g, '') : '', el);
  },
  register: () => openRegistration(),
  vote: async (el) => {
    const choice = el.dataset.choice;
    el.setAttribute('aria-disabled', 'true');
    try {
      const r = await api.post('/api/v2/forum/vote', { choice });
      if (D.state) D.state.vote = r.vote;
      const block = rootEl.querySelector('[data-block="vote"]');
      if (block) block.outerHTML = blockVote();
      ui.toast(r.message || COPY.vote.counted);
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  addCal: () => {
    const g = D.state.gathering; if (!g || !g.start_date) return ui.toast(COPY.membership.noEvent, { kind: 'error' });
    const end = new Date(fmt.toDate(g.end_date || g.start_date)); end.setDate(end.getDate() + 1);
    ui.downloadIcs(COPY.membership.icsFile, [{ uid: 'forum-gathering-' + (g.slug || g.id), start: fmt.ymd(g.start_date), end: fmt.ymd(end), summary: g.title || 'Biomedical Forum gathering', location: g.location_name || '' }]);
    ui.toast(COPY.membership.icsDone);
  }
};

export default {
  title: 'Biomedical Forum',
  async render(root, ctx) {
    rootEl = root;
    ensureCss();
    D = await load();
    if (rootEl !== root) return; // navigated away while loading
    st = { prefill: '' };
    // A code can arrive from the Auth "Invitation code" screen (guest flow) or an emailed ?code= link.
    let pending = '';
    try { pending = sessionStorage.getItem(PENDING_CODE_KEY) || ''; } catch (e) {}
    const fromQuery = (ctx.query && ctx.query.code) ? String(ctx.query.code) : '';
    if (D.stage === 1 && fromQuery) st.prefill = fromQuery.toUpperCase();
    root.innerHTML = template();
    unbind = ui.bind(root, handlers);
    wireForms();
    chrome.refresh();
    if (pending) {
      try { sessionStorage.removeItem(PENDING_CODE_KEY); } catch (e) {}
      if (D.stage === 1) await redeem(pending.toUpperCase().replace(/\s+/g, ''), root.querySelector('[data-act="unlock"]'));
    }
  },
  destroy() {
    timers.forEach(s => { try { s(); } catch (e) {} }); timers = [];
    if (unbind) unbind(); unbind = null; rootEl = null; D = null; st = null;
  }
};
