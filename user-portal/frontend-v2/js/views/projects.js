// Source: Mobile Portal.dc.html › "Five projects, one membership." (the PROJECTS tab)
// The mobile tab bar's second tab. Works at any width: one column on a phone, and on a wider screen (the
// breadcrumb PROJECTS on every project page lands here) the five cards stand side by side in the page gutter
// instead of a 640 px phone strip in the middle of the window. Home › "01 · OUR PROJECTS" carries the same five.
import { api } from '../api.js';
import { esc, fmt } from '../ui.js';
import { FACTS, routeFor, CTA } from '../facts.js';

export const SOURCE = 'Mobile Portal.dc.html';
export const COPY = {
  headline: 'One membership, <i style="color:#9b1b22">every project</i>.',
  sub: 'Apply, register, and follow everything from here.',
  cards: {
    plexus: { name: 'Plexus Conference 2026', accent: '#9b1b22', img: 'photo-hall.jpg' },   // same card as Home › "01 · OUR PROJECTS"
    gala: { name: 'Gala Evening', accent: '#c9a962', img: 'photo-ballroom.jpg' },
    accelerator: { name: 'The Accelerator', accent: '#191512', img: 'photo-candlelit.jpg' },
    forum: { name: 'Biomedical Forum', accent: '#191512', img: 'photo-stage.jpg' },
    bridges: { name: 'Building Bridges', accent: '#9b1b22', img: 'photo-bridges.jpg' }
  },
  // a member who already holds the ticket / the seat is never asked to register again (Home's cards agree)
  mine: { plexus: 'MY TICKET', gala: 'YOUR SEAT' }
};

export default {
  title: 'Projects',
  reveal: true,        // sections below the fold rise in on scroll (router › ui.revealOnScroll)
  async render(root) {
    const [status, next] = await Promise.all([
      api.get('/api/public/status', { noAuth: true }).catch(() => null),
      api.get('/api/me/next-event').catch(() => null)
    ]);
    const byKey = {}; ((status && status.projects) || []).forEach(p => { byKey[p.project_key] = p; });
    const held = { plexus: !!(next && next.registered), gala: !!(next && next.has_gala) };
    const cta = (key, p) => held[key] ? COPY.mine[key] : key === 'plexus' ? CTA.register : fmt.upper(p.cta_label || 'Open');
    const to = (key, p) => key === 'plexus' && held.plexus ? '/app/plexus/mine' : routeFor(p.cta_target || key, routeFor(key));
    root.innerHTML = `
<div data-screen-label="Projects" style="font-family:Inter,sans-serif;color:#191512;background:#f7f1e6;min-height:100vh">
  <!-- dc: Mobile Portal.dc.html › "Five projects, one membership." -->
  <div class="mx-gutter" style="padding:24px 36px 10px">
    <div style="font-family:Fraunces,serif;font-size:27px;line-height:1.12">${COPY.headline}</div>
    <div style="font-size:12.5px;color:#4a4239;margin-top:6px">${COPY.sub}</div>
  </div>
  <div class="mx-gutter" style="padding:6px 36px 26px;display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px">
    ${FACTS.projectOrder.map(key => { const p = byKey[key] || {}; const c = COPY.cards[key]; return `
    <a href="${to(key, p)}" class="mx-card-link" style="position:relative;overflow:hidden;cursor:pointer;border:1px solid rgba(25,21,18,.16);display:flex;flex-direction:column;color:#191512">
      <span class="mx-ph"><img src="/assets/${c.img}" alt="" style="width:100%;height:110px;object-fit:cover;display:block"></span>
      <div class="mx-projx-body" style="background:#fdfaf3;padding:13px 15px;display:flex;align-items:center;gap:12px;border-top:2px solid ${c.accent};flex:1">
        <span style="flex:1;min-width:0"><span style="display:block;font-family:Fraunces,serif;font-size:17px">${c.name}</span><span style="display:block;font-size:11px;color:#4a4239;margin-top:2px">${esc(fmt.detail(p.detail_line || p.status_label || ''))}</span></span>
        <span style="font:600 8.5px Inter,sans-serif;letter-spacing:.13em;color:#9b1b22;white-space:nowrap">${esc(cta(key, p))} →</span>
      </div>
    </a>`; }).join('')}
  </div>
  <!-- /dc -->
</div>`;
  },
  destroy() {}
};
