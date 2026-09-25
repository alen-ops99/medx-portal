// Source: Biomedical Forum.dc.html, redrawn to the phone calm rules (DESIGN-RULES.md 2026-09-25).
// Blocks, top to bottom: "Breadcrumb" (desktop) › "Hero" (eyebrow · title · date · ONE action) › "Facts" (the
// circle, the gathering, the venue vote, the membership — each said once) › "01 · The network" (three rows +
// what membership includes) › "From the Forum" (posts as accordions) › "02 · The annual gathering" ›
// "03 · Gathering speakers" › "04 · Your membership" (stages · code entry / member / confirmed · venue vote) ›
// "Put a colleague forward" (the form folded into one row) › "Message us".
// Data: GET /api/v2/forum/state (membership · gathering · registration · vote · schedule · speakers)
// + GET /api/v2/forum/feed (the "From the Forum" store: v2 composer table ∪ legacy forum_news).
// Actions: POST /api/v2/forum/redeem-code (UNLOCK REGISTRATION — distinct empty/unknown/expired/used/
// member errors) · POST /api/v2/forum/register (COMPLETE REGISTRATION — annual terms required) ·
// POST /api/v2/forum/vote (Split-or-Zagreb, one changeable vote per member) ·
// POST /api/v2/forum/nominate ("PUT A COLLEAGUE FORWARD" — medx.hr's "put forward by a member who can speak to a
// colleague's standing and character" route; /app/forum is auth-gated by the router, so every viewer is signed in).
// MESSAGE US → /app/messages.
// The Auth "Invitation code" screen stores a guest-checked code in sessionStorage.medx_forum_code;
// this view redeems it on arrival.
// FROZEN (DESIGN-RULES §8): the code card's controls, the registration and its paid hand-off are unchanged.
import { api } from '../api.js';
import { session } from '../state.js';
import { ui, esc, fmt } from '../ui.js';
import { FACTS } from '../facts.js';
import { chrome } from '../chrome.js';
import router from '../router.js';

export const SOURCE = 'Biomedical Forum.dc.html';
const PENDING_CODE_KEY = 'medx_forum_code';   // written by js/views/auth.js after a guest check-code
const NOMINATION_MIN = 120;                   // statement floor — mirrors the backend's NOMINATION_STATEMENT_MIN

export const COPY = {
  crumb: { projects: 'PROJECTS', here: 'BIOMEDICAL FORUM' },
  hero: {
    eyebrow: 'By invitation',
    headline: 'The Biomedical <i>Forum</i>',
    date: (label, where) => `${label} · ${where}`,
    join: 'JOIN WITH YOUR CODE →', member: 'YOUR MEMBERSHIP →'
  },
  facts: {
    cap: n => `Capped at ${n} members`, capSub: 'Leaders of Croatian and international biomedicine',
    gather: 'Two days each May', gatherSub: 'Closing dinner and the annual awards',
    vote: 'Members vote on the venue', annual: 'Annual membership', annualSub: 'Renewed each year with your invitation'
  },
  network: {
    n: '01', title: 'The network',
    rows: [
      { icon: 'users', v: 'Members, by invitation', s: 'Heads of clinics, labs and companies' },
      { icon: 'mail', v: 'Reachable year-round', s: 'Message members in the network', href: '/app/network' },
      { icon: 'calendar', v: 'First call on the gathering', s: 'Members register first' }
    ],
    // What a member actually gets — stated once, so nobody reads the Forum's dinner as a Plexus Gala ticket
    // or expects a Gala seat with their membership (2026-09-17).
    includes: {
      title: 'What membership includes',
      points: [
        'The members’ network and directory, year-round',
        'First call on seats at the annual May gathering',
        'The Plexus Gala at the early-bird price (€150), whatever the date'
      ],
      note: 'The Gala itself is a separate ticket.'
    }
  },
  feed: {
    title: 'From the Forum', by: 'from the Med&amp;X team',
    empty: 'Highlights from the network appear here as the Med&amp;X team posts them.'
  },
  gathering: {
    n: '02', title: 'The annual gathering',
    sub: 'The full program follows with your invitation.',
    more: 'About the gathering',
    // gathering.description from GET /api/v2/forum/state when the admin has written one, else this text (2026-09-17)
    fallback: 'Once a year the Forum leaves the portal and meets in person — two days each May, for the members and guests who lead Croatian and international biomedicine. The days are built for conversation rather than lectures: closed sessions on where medicine and science are heading, time with colleagues you would otherwise only read about, and a closing evening of dinner and the Forum\'s annual awards. Members register first. The venue and the full program follow with your invitation.'
  },
  speakers: {
    n: '03', title: 'Gathering speakers',
    emptyLine: y => `Speakers for ${y} are announced with the program.`
  },
  membership: {
    n: '04', title: 'Your membership',
    stages: ['Join', 'Register', 'Confirmed'],
    inviteLine: 'Received an invitation? Enter your code to join.',
    codePlaceholder: 'FORUM CODE', unlock: 'UNLOCK REGISTRATION →', checking: 'CHECKING…',
    note: cap => `Annual membership · capped at ${cap} members. No code yet? Message us below.`,
    emptyCode: 'Enter the code from your invitation email.',
    memberTag: 'FORUM MEMBER',
    welcome: first => `Welcome to the Forum${first ? ', ' + first : ''}.`,
    memberBody: 'Register for the annual gathering to confirm your seat. Your QR pass appears in My Med&amp;X.',
    complete: 'COMPLETE REGISTRATION →',
    renews: d => `Annual membership · renews ${d}`, renewsOpen: 'Annual membership · renewed each year',
    lapsed: 'Your membership has lapsed — enter this year\'s code to renew it.',
    confirmedHead: first => `Your seat is confirmed${first ? ', ' + first : ''}.`,
    confirmedBody: ref => `Reference <span class="mx-fo-ref">${ref}</span> · your QR pass is in My Med&amp;X.`,
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
    cancel: 'NOT NOW', submit: 'REGISTER FOR THE MAY GATHERING →', busy: 'REGISTERING…',
    done: 'Your seat at the gathering is confirmed.'
  },
  vote: {
    eyebrow: 'Members vote on the venue',
    line: 'Where shall the Forum meet in 2027?',
    note: 'One vote per member; change it any time before the venue is announced.',
    labels: { split: 'SPLIT', zagreb: 'ZAGREB' },
    counted: 'Vote counted.', updated: 'Vote updated.'
  },
  nominate: {
    row: 'Put a colleague forward', rowSub: 'Members put members forward',
    intro: 'If someone belongs in this room, tell us who they are and speak for their standing and character.',
    name: 'COLLEAGUE\'S NAME', email: 'COLLEAGUE\'S EMAIL', institution: 'INSTITUTION',
    statement: 'THEIR STANDING AND CHARACTER',
    statementPh: 'What they have built, how they carry themselves, why the Forum is better with them in it…',
    statementWhy: min => `At least ${min} characters · the Office of the Forum reads this first.`,
    counter: (n, min) => n >= min ? `${n} characters — thank you for the detail` : `${n} / ${min} characters minimum`,
    submit: 'PUT THEM FORWARD →', busy: 'SENDING…',
    needName: 'Tell us your colleague\'s name.',
    needEmail: 'Add your colleague\'s email address so the Office of the Forum can reach them.',
    needInstitution: 'Add their institution — it helps the Office place them.',
    shortStatement: min => `The statement is the part the Office of the Forum reads first — give it at least ${min} characters on their standing and character, in your own words.`,
    sentTag: 'NOMINATION RECEIVED',
    sentHead: 'Your nomination is with the <i>Office of the Forum</i>.',
    sentBody: 'We treat these seriously and reply to you either way.',
    another: 'PUT ANOTHER COLLEAGUE FORWARD →'
  },
  contact: {
    ask: 'Message us', sub: 'Invitation, program, sponsorship',
    // medx.hr has no #sponsorship anchor (checked 2026-08-30), so this links the homepage rather than a dead fragment
    sponsor: 'Sponsorship', sponsorSub: 'Starts on medx.hr',
    sponsorUrl: 'https://medx.hr'
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
  const d1 = g && fmt.toDate(g.start_date), d2 = g && fmt.toDate(g.end_date);
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return {
    state,
    stage: state.stage || 1,
    cap: state.cap || FACTS.forum.cap,
    feed: (r.feed && r.feed.items) || [],
    gatherLabel: g && g.start_date ? fmt.longRange(g.start_date, g.end_date) : FACTS.forum.gathering.label,
    // '28–29 May 2027' for the hero and the facts
    gatherShort: d1 ? `${d1.getDate()}${d2 && d2.getTime() !== d1.getTime() ? '–' + d2.getDate() : ''} ${MON[d1.getMonth()]} ${d1.getFullYear()}` : FACTS.forum.gathering.label,
    gatherWhere: (g && g.location_name && g.location_name.split('—')[0].trim()) || FACTS.forum.gathering.where,
    gatherYear: String((g && g.start_date) || FACTS.forum.gathering.start).slice(0, 4),
    gatherAbout: (g && g.description && String(g.description).trim()) || COPY.gathering.fallback,
    first: (state.user && state.user.first_name) || (session.user || {}).first_name || ''
  };
}
const mkFeed = p => ({ tag: p.tag || '', when: ago(p.published_at), body: p.body || '', headline: p.name || p.title || '', sub: p.role || '', init: p.init || '', isSpot: p.kind === 'spotlight' });

// ---------------------------------------------------------------- kit helpers
const icon = (n, s) => ui.icon(n, s || 20);
const chev = () => ui.icon('chevron-right', 18);
function sectionHead(n, title, right) {
  return `<div class="mx-sh">${n ? `<span class="mx-sh-n">${n}</span>` : ''}<h2 class="mx-sh-t">${title}</h2>${right || ''}</div>`;
}
function fact({ ic, v, s, href }) {
  const inner = `${icon(ic)}<div class="mx-fact-body"><span class="mx-fact-v">${v}</span>${s ? `<span class="mx-fact-s">${s}</span>` : ''}</div>`;
  return href ? `<li><a class="mx-fact" href="${href}">${inner}${chev()}</a></li>` : `<li class="mx-fact">${inner}</li>`;
}

// ---------------------------------------------------------------- blocks
function blockCrumb() { return `
  <!-- dc: Biomedical Forum.dc.html › "Breadcrumb" (desktop; phones carry back in the top bar) -->
  <div class="mx-crumbs mx-gutter" style="display:flex;align-items:center;gap:13px;padding:10px 36px;border-bottom:1px solid rgba(25,21,18,.16)">
    <a href="/app/projects" data-dir="back" style="font:600 12px Inter,sans-serif;letter-spacing:.12em;color:#4a4239" data-hover="color:#191512">${COPY.crumb.projects}</a>
    <span style="color:rgba(25,21,18,.35);font-size:12px">→</span>
    <span style="font:600 12px Inter,sans-serif;letter-spacing:.12em;color:#191512">${COPY.crumb.here}</span>
  </div>
  <!-- /dc -->`; }

// §6: eyebrow · title · one date line · ONE action (the same #forum-invitation link and join act as before)
function blockHero() {
  const isMember = D.stage >= 2;
  return `
  <!-- dc: Biomedical Forum.dc.html › "Hero" -->
  <section class="mx-hero mx-ink mx-fo-hero">
    <img class="mx-hero-photo" src="/assets/photo-forum.jpg" alt="" style="object-position:55% 40%">
    <div class="mx-scrim"></div>
    <div class="mx-hero-body">
      <span class="mx-hero-eyebrow">${COPY.hero.eyebrow}</span>
      <h1 class="mx-hero-title">${COPY.hero.headline}</h1>
      <p class="mx-hero-date">${esc(COPY.hero.date(D.gatherShort, D.gatherWhere))}</p>
      <div class="mx-hero-cta"><a href="#forum-invitation" data-act="join" class="btn-gold btn-block">${isMember ? COPY.hero.member : COPY.hero.join}</a></div>
    </div>
  </section>
  <!-- /dc -->`;
}

// the facts the hero, the band and three paragraphs used to repeat — once each
function blockFacts() {
  return `
  <!-- dc: Biomedical Forum.dc.html › "Facts band" -->
  <section class="mx-sec mx-sec--tight" data-block="facts">
    <ul class="mx-facts">
      ${fact({ ic: 'users', v: esc(COPY.facts.cap(D.cap)), s: COPY.facts.capSub })}
      ${fact({ ic: 'calendar', v: COPY.facts.gather, s: COPY.facts.gatherSub })}
      ${fact({ ic: 'pin', v: esc(D.gatherWhere), s: COPY.facts.vote })}
      ${fact({ ic: 'card', v: COPY.facts.annual, s: COPY.facts.annualSub })}
    </ul>
  </section>
  <!-- /dc -->`;
}

function blockNetwork() {
  return `
  <!-- dc: Biomedical Forum.dc.html › "01 · THE NETWORK" -->
  <section class="mx-sec" data-block="network">
    ${sectionHead(COPY.network.n, COPY.network.title)}
    <ul class="mx-facts">${COPY.network.rows.map(r => fact({ ic: r.icon, v: r.v, s: r.s, href: r.href })).join('')}</ul>
    <!-- v2: what membership includes — the three benefits and the one thing it is not (2026-09-17) -->
    <div data-block="includes" class="mx-fo-includes">
      <h3 class="mx-fo-h3">${COPY.network.includes.title}</h3>
      <ul class="mx-checks">${COPY.network.includes.points.map(t => `<li>${icon('check')}<span>${t}</span></li>`).join('')}</ul>
      <p class="mx-fo-note">${COPY.network.includes.note}</p>
    </div>
  </section>
  <!-- /dc -->`;
}

// posts as accordions: the headline and when; the body opens under it (the newest one open)
function blockFeed() {
  const feed = D.feed.map(mkFeed);
  return `
  <!-- dc: Biomedical Forum.dc.html › "FROM THE FORUM" -->
  <section class="mx-sec" data-block="feed">
    ${sectionHead('', COPY.feed.title)}
    ${feed.length ? `<div class="mx-accs">${feed.map((f, i) => `
      <details class="mx-acc mx-fo-post"${i === 0 ? ' open' : ''}>
        <summary>${f.isSpot && f.init ? ui.portrait({ name: f.headline, size: 44, alt: '' }) : ''}<span class="mx-fo-post-h"><span class="mx-fo-post-t">${esc(f.headline)}</span><span class="mx-fo-post-s">${esc([f.tag, f.when].filter(Boolean).join(' · '))}</span></span></summary>
        <div class="mx-acc-a">${f.sub ? `<p class="mx-fo-post-role">${esc(f.sub)}</p>` : ''}<p>${esc(f.body)}</p><p class="mx-fo-note">${COPY.feed.by}</p></div>
      </details>`).join('')}</div>`
      : `<p class="mx-sh-sub">${COPY.feed.empty}</p>`}
  </section>
  <!-- /dc -->`;
}

function blockSchedule() {
  return `
  <!-- dc: Biomedical Forum.dc.html › "02 · THE ANNUAL GATHERING" -->
  <section class="mx-sec" id="forum-schedule" data-block="gathering">
    ${sectionHead(COPY.gathering.n, COPY.gathering.title)}
    <p class="mx-sh-sub">${esc(D.gatherShort)} · ${COPY.gathering.sub}</p>
    <div class="mx-accs"><details class="mx-acc"><summary>${COPY.gathering.more}</summary><div class="mx-acc-a">${esc(D.gatherAbout)}</div></details></div>
  </section>
  <!-- /dc -->`;
}

function blockSpeakers() {
  const sp = (D.state.speakers || []);
  return `
  <!-- dc: Biomedical Forum.dc.html › "03 · GATHERING SPEAKERS" -->
  <section class="mx-sec" data-block="speakers">
    ${sectionHead(COPY.speakers.n, COPY.speakers.title)}
    ${sp.length ? `<div class="mx-person-rows">${sp.map(s => `
      <div class="mx-person-row">${ui.portrait({ name: s.name, src: s.photo_url ? api.url(s.photo_url) : '', size: 64, alt: '' })}<span class="mx-person-text"><span class="mx-person-name">${esc(s.name)}</span><span class="mx-person-role">${esc([s.title, s.institution].filter(Boolean).join(' · '))}</span>${s.talk_title ? `<span class="mx-person-tag">${esc(s.talk_title)}</span>` : ''}</span></div>`).join('')}</div>`
      : `<p class="mx-sh-sub">${esc(COPY.speakers.emptyLine(D.gatherYear))}</p>`}
  </section>
  <!-- /dc -->`;
}

function stageIndicator() {
  const stage = D.stage;
  return COPY.membership.stages.map((label, i) => {
    const n = i + 1, cur = n === stage, done = n < stage;
    return `<div class="mx-fo-stage${cur ? ' is-cur' : done ? ' is-done' : ''}"><span class="mx-fo-stage-n">${done ? '✓' : n}</span><span class="mx-fo-stage-l">${label}</span></div>`;
  }).join('');
}

function stageBody() {
  const m = D.state.membership || {};
  if (D.stage === 1) {
    return `
      <div class="mx-fo-body">
        <span class="mx-fo-line">${COPY.membership.inviteLine}</span>
        ${m.expired ? `<span class="mx-fo-gold">${COPY.membership.lapsed}</span>` : ''}
        <form data-form="code" style="display:contents">
          <div class="mx-forum-coderow">
            <input data-role="code" name="code" value="${esc(st.prefill || '')}" placeholder="${COPY.membership.codePlaceholder}" aria-label="Forum invitation code" autocomplete="off" spellcheck="false" class="mx-fo-code">
            <span data-act="unlock" role="button" class="btn-gold btn-block">${COPY.membership.unlock}</span>
          </div>
        </form>
        <div data-role="codeError" role="alert" class="mx-fo-err" style="display:none"></div>
        <span class="mx-fo-small">${COPY.membership.note(D.cap)}</span>
      </div>`;
  }
  const renewLine = m.valid_until ? COPY.membership.renews(fmt.longRange(m.valid_until, m.valid_until)) : COPY.membership.renewsOpen;
  if (D.stage === 2) {
    const g = D.state.gathering;
    return `
      <div class="mx-fo-body">
        <span class="mx-tag mx-tag--line">${COPY.membership.memberTag}</span>
        <span class="mx-fo-head">${esc(COPY.membership.welcome(D.first))}</span>
        <span class="mx-fo-line">${COPY.membership.memberBody}</span>
        ${g ? `<span data-act="register" role="button" class="btn-gold btn-block">${COPY.membership.complete}</span>`
            : `<span class="mx-fo-small">${COPY.membership.noEvent}</span>`}
        <span class="mx-fo-small">${esc(renewLine)}</span>
      </div>`;
  }
  const reg = D.state.registration || {};
  return `
      <!-- v2: stage 3 — confirmed state -->
      <div class="mx-fo-body">
        <span class="mx-tag mx-tag--line">${COPY.membership.memberTag}</span>
        <span class="mx-fo-head">${esc(COPY.membership.confirmedHead(D.first))}</span>
        <span class="mx-fo-line">${COPY.membership.confirmedBody(esc(reg.qr_code || ''))}</span>
        <div class="mx-fo-acts">
          <a href="/app/me" class="btn-gold btn-sm">${COPY.membership.myMedx}</a>
          <span data-act="addCal" role="button" class="btn-ghost-ink btn-sm">${COPY.membership.addCal}</span>
        </div>
        <span class="mx-fo-small">${esc(renewLine)}</span>
      </div>`;
}

function blockVote() {
  if (D.stage < 2 || !D.state.vote) return '';
  const v = D.state.vote;
  const btn = key => {
    const mine = v.mine === key;
    return `<span data-act="vote" data-choice="${key}" role="radio" aria-checked="${mine}" class="mx-fo-vote${mine ? ' is-on' : ''}">${COPY.vote.labels[key]}<b>${v.counts[key] || 0}</b></span>`;
  };
  return `
    <!-- v2: venue vote — makes "members vote on the venue" real (POST /api/v2/forum/vote) -->
    <div data-block="vote" class="mx-fo-voteblock">
      <span class="mx-fo-gold">${COPY.vote.eyebrow}</span>
      <span class="mx-fo-head">${COPY.vote.line}</span>
      <div class="mx-fo-votes" role="radiogroup">${btn('split')}${btn('zagreb')}</div>
      <span class="mx-fo-small">${COPY.vote.note}</span>
    </div>`;
}

function blockMembership() {
  return `
  <!-- dc: Biomedical Forum.dc.html › "04 · YOUR MEMBERSHIP" -->
  <section class="mx-sec" id="forum-invitation" data-block="membership-sec">
    ${sectionHead(COPY.membership.n, COPY.membership.title)}
    <div data-block="membership" class="mx-ink mx-fo-card">
      <div class="mx-forum-stages">${stageIndicator()}</div>
      ${stageBody()}
      ${blockVote()}
    </div>
  </section>
  <!-- /dc -->`;
}

// the nomination form lives folded in one row; sent, the row opens on the confirmation
function blockNominate() {
  const c = COPY.nominate;
  const inner = st.nomSent ? `
      <div class="mx-fo-sent">
        <span class="mx-tag mx-tag--gold">${c.sentTag}</span>
        <span class="mx-fo-sent-h">${c.sentHead}</span>
        <span class="mx-fo-line">${c.sentBody}</span>
        <span data-act="nomAgain" role="button" class="mx-fo-textbtn">${c.another}</span>
      </div>` : `
      <p class="mx-fo-line">${c.intro}</p>
      <form data-form="nominate" class="mx-fo-form">
        <label class="mx-fo-field"><span class="label">${c.name}</span><input class="input" data-role="nomName" aria-label="Colleague's name" autocomplete="off"></label>
        <label class="mx-fo-field"><span class="label">${c.email}</span><input class="input" data-role="nomEmail" type="email" aria-label="Colleague's email" autocomplete="off"></label>
        <label class="mx-fo-field"><span class="label">${c.institution}</span><input class="input" data-role="nomInst" aria-label="Colleague's institution" autocomplete="off"></label>
        <label class="mx-fo-field mx-fo-wide">
          <span class="label">${c.statement}</span>
          <textarea class="input" data-role="nomStatement" aria-label="Their standing and character, in your words" placeholder="${esc(c.statementPh)}"></textarea>
          <span class="mx-fo-count"><span>${esc(c.statementWhy(NOMINATION_MIN))}</span><span data-role="nomCount">${esc(c.counter(0, NOMINATION_MIN))}</span></span>
        </label>
        <div data-role="nomError" role="alert" class="mx-fo-err mx-fo-wide" style="display:none"></div>
        <span data-act="nominate" role="button" class="btn-primary btn-block mx-fo-wide">${c.submit}</span>
      </form>`;
  return `
  <!-- dc: Biomedical Forum.dc.html › "PUT A COLLEAGUE FORWARD" -->
  <section class="mx-sec mx-sec--tight" data-block="nominate">
    <div class="mx-list"><details class="mx-acc mx-fo-nom"${st.nomSent || st.nomOpen ? ' open' : ''}><summary>${icon('user')}<span class="mx-row-l">${c.row}<span class="mx-row-s">${c.rowSub}</span></span></summary>
      <div class="mx-acc-a">${inner}</div>
    </details></div>
  </section>
  <!-- /dc -->`;
}

function blockContact() {
  return `
  <!-- dc: Biomedical Forum.dc.html › "Message us" + sponsorship -->
  <section class="mx-sec">
    <div class="mx-list">
      <a class="mx-row" href="/app/messages?about=forum">${icon('mail')}<span class="mx-row-l">${COPY.contact.ask}<span class="mx-row-s">${COPY.contact.sub}</span></span>${chev()}</a>
      <a class="mx-row" href="${COPY.contact.sponsorUrl}" target="_blank" rel="noopener">${icon('heart')}<span class="mx-row-l">${COPY.contact.sponsor}<span class="mx-row-s">${COPY.contact.sponsorSub}</span></span>${icon('external', 18)}</a>
    </div>
  </section>
  <!-- /dc -->`;
}

function template() {
  return `
<div data-screen-label="Biomedical Forum" class="mx-fo">
  ${blockCrumb()}
  ${blockHero()}
  <div class="mx-p">
    ${blockFacts()}
    ${blockNetwork()}
    ${blockFeed()}
    ${blockSchedule()}
    ${blockSpeakers()}
    ${blockMembership()}
    ${blockNominate()}
    ${blockContact()}
  </div>
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
  const nf = rootEl && rootEl.querySelector('form[data-form="nominate"]');
  if (nf && !nf.dataset.wired) { nf.dataset.wired = '1'; nf.addEventListener('submit', e => { e.preventDefault(); handlers.nominate(rootEl.querySelector('[data-act="nominate"]')); }); }
  const ta = rootEl && rootEl.querySelector('[data-role="nomStatement"]');
  if (ta && !ta.dataset.wired) {
    ta.dataset.wired = '1';
    ta.addEventListener('input', () => {
      const n = ta.value.trim().length; // trimmed, to match what the backend measures
      const el = rootEl && rootEl.querySelector('[data-role="nomCount"]');
      if (el) { el.textContent = COPY.nominate.counter(n, NOMINATION_MIN); el.style.color = n >= NOMINATION_MIN ? '#6e5626' : '#6d6459'; }
    });
  }
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
  const IN = 'border:1px solid rgba(25,21,18,.25);background:#fdfaf3;padding:13px 14px;min-height:52px;font-size:16px;color:#191512;width:100%;box-sizing:border-box';
  const LB = 'font:600 12px Inter,sans-serif;letter-spacing:.12em;color:#4a4239';
  const m = ui.modal({
    eyebrow: COPY.reg.eyebrow,
    title: esc(COPY.reg.title),
    body: `
      <div style="font-size:14px;color:#4a4239;line-height:1.5;margin-bottom:14px">${esc(COPY.reg.intro(D.gatherLabel, D.gatherWhere))}</div>
      <div style="display:flex;flex-direction:column;gap:12px">
        <span style="display:flex;flex-direction:column;gap:6px"><span style="${LB}">${COPY.reg.name}</span><input data-role="regName" value="${esc(name)}" aria-label="Name" style="${IN}"></span>
        <span style="display:flex;flex-direction:column;gap:6px"><span style="${LB}">${COPY.reg.institution}</span><input data-role="regInst" value="${esc(u.institution || '')}" aria-label="Institution" style="${IN}"></span>
        <span style="display:flex;flex-direction:column;gap:6px"><span style="${LB}">${COPY.reg.dietary}</span><input data-role="regDiet" placeholder="${esc(COPY.reg.dietaryPh)}" aria-label="Dietary notes" style="${IN}"></span>
        <div style="border:1px solid rgba(201,169,98,.65);background:#fdfaf3;padding:13px 15px;display:flex;flex-direction:column;gap:7px">
          <span style="font:600 12px Inter,sans-serif;letter-spacing:.12em;color:#6e5626">${COPY.reg.termsTitle}</span>
          <span style="font-size:14px;color:#4a4239;line-height:1.5">${esc(COPY.reg.termsBody(D.cap))}</span>
          <label style="display:flex;gap:10px;align-items:flex-start;cursor:pointer;font-size:16px;color:#191512;line-height:1.5;min-height:44px"><input data-role="regTerms" type="checkbox" style="margin-top:3px;width:20px;height:20px;accent-color:#9b1b22">${esc(COPY.reg.termsAccept)}</label>
        </div>
        <div data-role="regError" role="alert" style="display:none;font-size:14px;color:#9b1b22;line-height:1.5"></div>
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
  nominate: async (el) => {
    const val = r => { const x = rootEl && rootEl.querySelector(`[data-role="${r}"]`); return x ? x.value.trim() : ''; };
    const err = rootEl && rootEl.querySelector('[data-role="nomError"]');
    const show = t => { if (err) { err.textContent = t || ''; err.style.display = t ? 'block' : 'none'; } };
    show('');
    const name = val('nomName'), email = val('nomEmail'), institution = val('nomInst'), statement = val('nomStatement');
    if (!name) return show(COPY.nominate.needName);
    if (!email) return show(COPY.nominate.needEmail);
    if (!institution) return show(COPY.nominate.needInstitution);
    if (statement.length < NOMINATION_MIN) return show(COPY.nominate.shortStatement(NOMINATION_MIN));
    if (el) { el.setAttribute('aria-disabled', 'true'); el.textContent = COPY.nominate.busy; }
    try {
      const r = await api.post('/api/v2/forum/nominate', { name, email, institution, statement });
      st.nomSent = true;
      const block = rootEl && rootEl.querySelector('[data-block="nominate"]');
      if (block) block.outerHTML = blockNominate();
      ui.toast((r && r.message) || 'Your nomination is with the Office of the Forum — we treat these seriously and reply to you either way.', { ms: 5000 });
    } catch (e) {
      if (el) { el.removeAttribute('aria-disabled'); el.textContent = COPY.nominate.submit; }
      show(e.message);
      ui.toast(e.message, { kind: 'error', ms: 4500 });
    }
  },
  nomAgain: () => {
    st.nomSent = false; st.nomOpen = true;
    const block = rootEl && rootEl.querySelector('[data-block="nominate"]');
    if (block) { block.outerHTML = blockNominate(); wireForms(); }
  },
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
  reveal: true,        // sections below the fold rise in on scroll (router › ui.revealOnScroll)
  async render(root, ctx) {
    rootEl = root;
    ensureCss();
    D = await load();
    if (rootEl !== root || (ctx.ready && !(await ctx.ready()))) return; // navigated away while loading, or the router moved on
    st = { prefill: '', nomSent: false };
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
