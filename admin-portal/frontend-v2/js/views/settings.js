// Source: Admin Settings.dc.html — PARTIAL: the "SYSTEM HEALTH" card is real (it is the door behind the
// Today status pill, note 0b); the rest of the screen (TEAM ACCESS · ORGANISATION & PAYMENTS · WHAT THE
// PUBLIC & MEMBERS SEE · MAKE & STORE → STUDIO · AUDIT LOG · TEAM LIBRARY) is still IN PROGRESS.
// Tabs (/settings/:tab) are anchors on this one page: health · team · org · audit · library.
import { api } from '../api.js';
import { ui, esc, fmt } from '../ui.js';
import { health } from '../health.js';
import { perms } from '../perms.js';
import { state } from '../state.js';

export const SOURCE = 'Admin Settings.dc.html';
export const COPY = {
  title: 'Settings &amp; tools', sub: 'the once-in-a-while things — everything is here, nothing was deleted',
  health: { title: 'SYSTEM HEALTH', tag: (o, w, f) => `${o} OK · ${w} TO CHECK · ${f} FAILING`, lastRun: at => at ? 'last run ' + at : 'not run yet', run: 'RUN CHECKS AGAIN', running: 'CHECKING…',
    note: 'Run this before every event and any time something seems off — it checks email, payments, database and event setup in one go.',
    probes: { admin: 'Admin backend', member: 'Member portal', report: 'Health report' }, ran: (o, w, f) => `ALL ${o + w + f} CHECKS RAN — ${w} WANT A LOOK${f ? `, ${f} FAILING` : ''}`, locked: 'The health report needs System & Tech access — the two reachability probes still run.' },
  rest: { eyebrow: 'IN PROGRESS', line: 'The rest of Settings is on its way.', why: 'Team access, organisation & payments, website and portal text, audit log and the team library are being built from Admin Settings.dc.html.' }
};
const DOT = { ok: '#2f7d4f', warn: '#b7791f', fail: '#9b1b22' };
let rootEl = null, unbind = null, running = false, off = null;

function healthCard() {
  const h = state.get().health;
  const groups = h && h.groups ? h.groups : [];
  const probes = h ? [['admin', h.probes.admin], ['member', h.probes.member]] : [];
  const counts = h ? { ok: h.ok, warn: h.warn, fail: h.fail } : { ok: 0, warn: 0, fail: 0 };
  return `
    <!-- dc: Admin Settings.dc.html › "SYSTEM HEALTH" -->
    <div id="health" data-block="health" style="border:1px solid rgba(32,27,22,.14);background:#fff">
      <div style="display:flex;align-items:center;gap:12px;padding:14px 20px;border-bottom:1px solid rgba(32,27,22,.12);flex-wrap:wrap">
        <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${COPY.health.title}</span>
        <span style="font:600 9px Inter,sans-serif;letter-spacing:.12em;background:${h && h.state === 'fail' ? '#f5e4e5' : '#f8f1e2'};color:${h && h.state === 'fail' ? '#9b1b22' : '#7a6432'};padding:3px 8px">${h ? COPY.health.tag(counts.ok, counts.warn, counts.fail) : 'CHECKING…'}</span>
        <span style="font-size:11px;color:#6d6459">${esc(COPY.health.lastRun(h && h.at ? fmt.when(h.at).toLowerCase() : ''))}</span>
        <div style="flex:1"></div>
        <span data-act="run" style="padding:8px 13px;border:1px solid rgba(32,27,22,.2);font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap" data-hover="border-color:#201b16">${running ? COPY.health.running : COPY.health.run}</span>
      </div>
      <div style="padding:6px 20px 14px">
        ${probes.map(([k, p]) => `
        <div style="display:flex;align-items:baseline;gap:12px;padding:8px 0;border-bottom:1px solid rgba(32,27,22,.06)">
          <span style="width:8px;height:8px;background:${p.ok ? DOT.ok : DOT.fail};flex:none;transform:translateY(-1px)"></span>
          <span style="font-size:13px;font-weight:600;width:230px;flex:none">${COPY.health.probes[k]}</span>
          <span style="font-size:12px;color:#6d6459;flex:1">${esc(p.detail || (p.ok ? 'reachable' : 'unreachable'))}</span>
        </div>`).join('')}
        ${h && h.probes.report && !h.probes.report.ok && h.probes.report.locked ? `<div style="padding:10px 0;font-size:12px;color:#6d6459">${COPY.health.locked}</div>` : ''}
        ${groups.map(g => `
        <div style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:#6d6459;padding:14px 0 4px">${esc(String(g.group || '').toUpperCase())}</div>
        ${(g.checks || []).map(c => `
        <div style="display:flex;align-items:baseline;gap:12px;padding:8px 0;border-bottom:1px solid rgba(32,27,22,.06)">
          <span style="width:8px;height:8px;background:${DOT[c.status] || DOT.warn};flex:none;transform:translateY(-1px)"></span>
          <span style="font-size:13px;font-weight:600;width:230px;flex:none">${esc(c.name)}</span>
          <span style="font-size:12px;color:#6d6459;flex:1">${esc(c.detail || '')}${c.fix ? ` <span style="color:#7a6432">· ${esc(c.fix)}</span>` : ''}</span>
        </div>`).join('')}`).join('')}
        <span style="display:block;font-size:11.5px;color:#6d6459;margin-top:10px">${COPY.health.note}</span>
      </div>
    </div>
    <!-- /dc -->`;
}
function template() {
  return `
<div data-screen-label="Admin Settings" style="min-height:100vh;background:#f6f2ea;color:#201b16;font-family:Inter,sans-serif">
  <div class="mx-gutter" style="max-width:1180px;margin:0 auto;padding:30px 28px 48px;display:flex;flex-direction:column;gap:22px">
    <div style="display:flex;align-items:baseline;gap:14px;flex-wrap:wrap">
      <span class="mx-display-30" style="font-family:Fraunces,serif;font-size:30px">${COPY.title}</span>
      <span style="font-size:12.5px;color:#6d6459">${COPY.sub}</span>
    </div>
    ${healthCard()}
    <div id="team" style="border:1px solid rgba(32,27,22,.14);background:#fff">
      <div class="empty" style="padding:34px 22px 36px">
        <span style="font:600 9px Inter,sans-serif;letter-spacing:.12em;background:#f8f1e2;color:#7a6432;padding:3px 8px">${COPY.rest.eyebrow}</span>
        <span class="empty-line" style="margin-top:6px">${COPY.rest.line}</span>
        <span class="empty-why">${COPY.rest.why}</span>
        <a href="/today" style="margin-top:8px;padding:9px 14px;border:1px solid rgba(32,27,22,.2);font:600 10px Inter,sans-serif;letter-spacing:.14em;color:#201b16;white-space:nowrap" data-hover="border-color:#201b16">BACK TO TODAY</a>
      </div>
    </div>
  </div>
</div>`;
}
const handlers = {
  run: async (el) => {
    if (running) return; running = true; el.textContent = COPY.health.running;
    const h = await health.refresh({ force: true });
    running = false;
    if (h) ui.toast(COPY.health.ran(h.ok, h.warn, h.fail));
  }
};
export default {
  title: 'Settings & tools',
  async render(root, ctx) {
    rootEl = root;
    root.innerHTML = template();
    unbind = ui.bind(root, handlers);
    off = state.subscribe((s, keys) => { if (keys.includes('health') && rootEl) { const el = rootEl.querySelector('[data-block="health"]'); if (el) el.outerHTML = healthCard(); } });
    health.refresh({ force: !state.get().health });
    const anchor = ctx.params.tab === 'health' ? '#health' : ctx.params.tab ? '#team' : '';
    if (anchor) { const t = root.querySelector(anchor); if (t) t.scrollIntoView({ block: 'start' }); }
  },
  destroy() { if (unbind) unbind(); unbind = null; if (off) off(); off = null; rootEl = null; }
};
