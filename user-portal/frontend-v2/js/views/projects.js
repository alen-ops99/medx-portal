// Source: Mobile Portal.dc.html › "Five projects, one membership." (the PROJECTS tab)
// The mobile tab bar's second tab. Works at any width (a plain list of the five project cards);
// on desktop the same content lives on Home › "01 · OUR PROJECTS".
import { api } from '../api.js';
import { esc, fmt } from '../ui.js';
import { FACTS, routeFor } from '../facts.js';

export const SOURCE = 'Mobile Portal.dc.html';
export const COPY = {
  headline: 'Five projects, <i style="color:#9b1b22">one membership</i>.',
  sub: 'Apply, register, and follow everything from here.',
  cards: {
    plexus: { name: 'Plexus Conference 2026', accent: '#9b1b22', img: 'photo-hall.jpg' },
    gala: { name: 'Gala Evening', accent: '#c9a962', img: 'photo-ballroom.jpg' },
    accelerator: { name: 'The Accelerator', accent: '#191512', img: 'photo-candlelit.jpg' },
    forum: { name: 'Biomedical Forum', accent: '#191512', img: 'photo-stage.jpg' },
    bridges: { name: 'Building Bridges', accent: '#9b1b22', img: 'photo-bridges.jpg' }
  }
};

export default {
  title: 'Projects',
  async render(root) {
    const status = await api.get('/api/public/status', { noAuth: true }).catch(() => null);
    const byKey = {}; ((status && status.projects) || []).forEach(p => { byKey[p.project_key] = p; });
    root.innerHTML = `
<div data-screen-label="Projects" style="font-family:Inter,sans-serif;color:#191512;background:#f7f1e6;min-height:100vh;max-width:640px;margin:0 auto">
  <!-- dc: Mobile Portal.dc.html › "Five projects, one membership." -->
  <div style="padding:24px 18px 10px">
    <div style="font-family:Fraunces,serif;font-size:27px;line-height:1.12">${COPY.headline}</div>
    <div style="font-size:12.5px;color:#4a4239;margin-top:6px">${COPY.sub}</div>
  </div>
  <div style="padding:6px 18px 18px;display:flex;flex-direction:column;gap:11px">
    ${FACTS.projectOrder.map(key => { const p = byKey[key] || {}; const c = COPY.cards[key]; return `
    <a href="${routeFor(p.cta_target || key, routeFor(key))}" style="position:relative;overflow:hidden;cursor:pointer;border:1px solid rgba(25,21,18,.16);display:block;color:#191512">
      <img src="/assets/${c.img}" alt="" style="width:100%;height:110px;object-fit:cover;display:block">
      <div style="background:#fdfaf3;padding:13px 15px;display:flex;align-items:center;gap:12px;border-top:2px solid ${c.accent}">
        <span style="flex:1;min-width:0"><span style="display:block;font-family:Fraunces,serif;font-size:17px">${c.name}</span><span style="display:block;font-size:11px;color:#4a4239;margin-top:2px">${esc(fmt.detail(p.detail_line || p.status_label || ''))}</span></span>
        <span style="font:600 8.5px Inter,sans-serif;letter-spacing:.13em;color:#9b1b22;white-space:nowrap">${esc(fmt.upper(p.cta_label || 'Open'))} →</span>
      </div>
    </a>`; }).join('')}
  </div>
  <!-- /dc -->
</div>`;
  },
  destroy() {}
};
