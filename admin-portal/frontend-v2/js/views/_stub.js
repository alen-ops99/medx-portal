// js/views/_stub.js — placeholder view factory for destinations not yet built.
// A stub renders the destination title + an "IN PROGRESS" note in the empty-state voice
// (italic Fraunces line · one sentence · one CTA) so every route in js/routes.js resolves.
// Replace the stub file with the real module (same file name, same default export shape).
import { esc } from '../ui.js';

export function makeStub({ source, title, headline, tabs = [], eyebrow = 'IN PROGRESS' }) {
  return {
    title,
    render(root, ctx) {
      const tab = ctx.params && (ctx.params.tab || ctx.params.view);
      const active = tabs.find(t => t.key === (tab || '')) || tabs[0];
      root.innerHTML = `
<div data-screen-label="${esc(title)}" style="min-height:100vh;background:#f6f2ea;color:#201b16;font-family:Inter,sans-serif">
  ${tabs.length ? `<div style="background:#fff;border-bottom:1px solid rgba(32,27,22,.14)"><div class="mx-subnav mx-gutter" style="max-width:1180px;margin:0 auto;padding:0 28px;display:flex;gap:24px;align-items:center;height:44px;overflow-x:auto">
    ${tabs.map(t => t === active ? `<span style="font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#201b16;border-bottom:2px solid #9b1b22;padding:15px 0 13px;white-space:nowrap">${esc(t.label)}</span>` : `<a href="${t.to}" style="font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#9a9086;white-space:nowrap" data-hover="color:#201b16">${esc(t.label)}</a>`).join('')}
  </div></div>` : ''}
  <div class="mx-gutter" style="max-width:1180px;margin:0 auto;padding:34px 28px 60px">
    <div style="display:flex;align-items:baseline;gap:14px;flex-wrap:wrap">
      <span class="mx-display-30" style="font-family:Fraunces,serif;font-size:30px">${headline}</span>
      <span style="font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#b7791f">${esc(eyebrow)}${active && active.label ? ' · ' + esc(active.label) : ''}</span>
    </div>
    <div style="border:1px solid rgba(32,27,22,.14);background:#fff;margin-top:22px">
      <div class="empty" style="padding:38px 22px 40px">
        <span style="width:28px;height:1px;background:#c9a962"></span>
        <span class="empty-line">This screen is on its way.</span>
        <span class="empty-why">It is being built from <span style="font:600 12px ui-monospace,Menlo,monospace;color:#201b16">${esc(source)}</span> — the design is final, the wiring follows.</span>
        <a href="/today" style="margin-top:8px;padding:9px 14px;border:1px solid rgba(32,27,22,.2);font:600 10px Inter,sans-serif;letter-spacing:.14em;color:#201b16;white-space:nowrap" data-hover="border-color:#201b16">BACK TO TODAY</a>
      </div>
    </div>
  </div>
</div>`;
    },
    destroy() {}
  };
}
