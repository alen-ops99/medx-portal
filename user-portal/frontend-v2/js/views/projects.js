// Source: Mobile Portal.dc.html › "Five projects, one membership." (the PROJECTS tab) — phone calm pass 2026-09-25.
// The mobile tab bar's second tab, and the landing of every project page's PROJECTS crumb on a wider screen.
// One card per project (DESIGN-RULES §11 › /app/projects): a 16:9 photo on the scrim with a status chip top-left and
// the name bottom-left; under it one facts line (date · place, the price or "Free" on the right), one line of what it
// is, and the action as a text row. The whole card is the link, to the same place it always went (to() below).
// Home › "Your projects" draws the same five from projectCard(), so the two never disagree.
import { api } from '../api.js';
import { ui, esc, fmt } from '../ui.js';
import { FACTS, routeFor, CTA, setLiveGalaPrice, galaPriceNow } from '../facts.js';

export const SOURCE = 'Mobile Portal.dc.html';
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dObj = iso => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const dm = iso => { const d = dObj(iso); return d ? d.getDate() + ' ' + MON[d.getMonth()] : ''; };             // '5 Dec'
const range = (a, b) => { const x = dObj(a), y = dObj(b); if (!x) return ''; if (!y || +x === +y) return dm(a); return x.getMonth() === y.getMonth() ? `${x.getDate()}–${y.getDate()} ${MON[x.getMonth()]}` : `${dm(a)} – ${dm(b)}`; };

export const COPY = {
  title: 'Projects',
  lede: 'Five projects, one membership.',
  // name, photo (+ focal point), and the one line that says what it is
  cards: {
    plexus: { name: 'Plexus Conference', img: 'photo-hall.jpg', pos: '50% 60%', line: 'Two days of talks, panels and people.' },
    gala: { name: 'Gala Evening', img: 'photo-ballroom.jpg', pos: '50% 55%', line: 'A black-tie dinner and the Med&amp;X Awards.' },
    accelerator: { name: 'The Accelerator', img: 'ax-hero-boston-2026.jpg', pos: '50% 72%', line: 'Summer placements in leading labs and clinics.' },
    forum: { name: 'Biomedical Forum', img: 'photo-candlelit.jpg', pos: '50% 40%', line: 'A circle of 200 leaders that meets every May.' },
    bridges: { name: 'Building Bridges', img: 'photo-bridges.jpg', pos: '50% 50%', line: 'Evenings that connect Croatian biomedicine worldwide.' }
  },
  // a member who already holds the ticket / the seat is never asked to register again (Home's cards agree)
  mine: { plexus: 'MY TICKET', gala: 'YOUR SEAT' },
  free: 'Free', plexusWeek: 'Plexus Week', duringWeek: 'During Plexus Week',
  // a chip is a status, never an action (the admin label "Reserve your seat" sat on the Gala photo like a button)
  status: { gala: 'Seats limited', other: 'Registration open' }
};

// date · place · price for a card, from FACTS (the price of a Gala seat is the live one when a screen has read it)
function factsFor(key) {
  if (key === 'plexus') return { date: range(FACTS.plexus.start, FACTS.plexus.end), place: FACTS.plexus.city, price: COPY.free };
  if (key === 'gala') { const d = dObj(FACTS.gala.date); return { date: d ? `${WD[d.getDay()]} ${dm(FACTS.gala.date)}` : '', place: FACTS.gala.venue, price: fmt.eur(galaPriceNow()) }; }
  // the chip already says when applications open: the card names the summer the placements run
  if (key === 'accelerator') return { date: 'Summer ' + (Number(String(FACTS.accelerator.opens).slice(0, 4)) + 1), place: '', price: '' };
  if (key === 'forum') { const g = FACTS.forum.gathering; return { date: range(g.start, g.end) + ' ' + String(g.start).slice(0, 4), place: g.where, price: '' }; }
  // Bridges meets during Plexus Week and its chip already names the city and the month: the line says when, with no
  // calendar icon (the icon slot is for a date)
  if (key === 'bridges') return { date: '', place: '', note: COPY.duringWeek, price: COPY.free };
  return { date: '', place: '', price: '' };
}
// the status chip: the admin's label, shortened to fit a card ("Applications open 15 November" → "Opens 15 Nov");
// open = gold, soon = cream, info (by invitation, a place) = outline
function tagFor(p, key) {
  let text = String(p.status_label || '').trim();
  if (/^(reserve|register|book|join|apply now|sign up)\b/i.test(text)) text = key === 'gala' ? COPY.status.gala : COPY.status.other;
  if (text.length > 22) {
    const m = text.match(/(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)/i);
    text = m ? `Opens ${m[1]} ${m[2].slice(0, 3)}` : text.slice(0, 21).trim() + '…';
  }
  const kind = p.status_kind === 'open' ? 'gold' : p.status_kind === 'soon' ? 'cream' : 'line';
  return { text, kind };
}
// everything a project card shows, for Home and Projects alike. `held` = { plexus, gala } (the member's own ticket / seat)
export function projectCard(key, p = {}, held = {}) {
  const c = COPY.cards[key] || { name: key, img: 'photo-hall.jpg', pos: '50% 50%', line: '' };
  const cta = held[key] ? COPY.mine[key] : key === 'plexus' ? CTA.register : key === 'gala' ? CTA.reserve(fmt.eur(galaPriceNow())) : fmt.upper(p.cta_label || 'Open');
  const to = key === 'plexus' && held.plexus ? '/app/plexus/mine' : routeFor(p.cta_target || key, routeFor(key));
  return Object.assign({ key, name: c.name, img: '/assets/' + c.img, pos: c.pos, line: c.line, tag: tagFor(p, key), cta, to }, factsFor(key));
}
export function metaLine(f) {
  return `${f.note ? `<span>${esc(f.note)}</span>` : ''}${f.date ? `${ui.icon('calendar', 16)}<span>${esc(f.date)}</span>` : ''}${f.place ? `${f.date ? '<span class="mx-sep"></span>' : ''}${ui.icon('pin', 16)}<span>${esc(f.place)}</span>` : ''}${f.price ? `<span class="mx-pcard-price">${esc(f.price)}</span>` : ''}`;
}

function card(f) {
  return `
    <a href="${f.to}" class="mx-pcard">
      <div class="mx-media r-16x9"><img src="${esc(f.img)}" alt="" style="object-position:${f.pos}"><div class="mx-scrim"></div>
        ${f.tag.text ? `<span class="mx-tag mx-tag--${f.tag.kind}">${esc(f.tag.text)}</span>` : ''}
        <h3 class="mx-pcard-title">${esc(f.name)}</h3></div>
      <div class="mx-pcard-body">
        <div class="mx-pcard-meta">${metaLine(f)}</div>
        ${f.line ? `<p class="mx-pcard-line">${f.line}</p>` : ''}
        <span class="mx-pcard-cta">${esc(f.cta)} →</span>
      </div>
    </a>`;
}

export default {
  title: 'Projects',
  reveal: true,        // sections below the fold rise in on scroll (router › ui.revealOnScroll)
  async render(root, ctx) {
    const [status, next, site] = await Promise.all([
      api.get('/api/public/status', { noAuth: true }).catch(() => null),
      api.get('/api/me/next-event').catch(() => null),
      // the Gala seat price on the card is the server's (the same read Home makes), never a price by the clock alone
      api.get('/api/public/site', { noAuth: true }).catch(() => null)
    ]);
    if (ctx && ctx.ready && !(await ctx.ready())) return;   // the router moved on while loading
    if (site && site.price) setLiveGalaPrice(Object.assign({}, site.price, { flip_date: (site.deadline || {}).early_bird || null }));
    const byKey = {}; ((status && status.projects) || []).forEach(p => { byKey[p.project_key] = p; });
    const held = { plexus: !!(next && next.registered), gala: !!(next && next.has_gala) };
    root.innerHTML = `
<div data-screen-label="Projects" style="font-family:Inter,sans-serif;color:#191512;background:#f7f1e6;min-height:100vh">
  <!-- dc: Mobile Portal.dc.html › "Five projects, one membership." (phone calm pass) -->
  <div class="mx-p">
    <h1 class="mx-lt">${COPY.title}</h1>
    <p class="mx-lede">${COPY.lede}</p>
    <div class="mx-sec mx-sec--tight mx-proj-list">
      ${FACTS.projectOrder.map(key => card(projectCard(key, byKey[key] || {}, held))).join('')}
    </div>
  </div>
  <!-- /dc -->
</div>`;
  },
  destroy() {}
};
