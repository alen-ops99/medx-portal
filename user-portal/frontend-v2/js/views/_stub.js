// js/views/_stub.js — placeholder view factory for screens not yet built.
// A stub renders the screen title + an "in progress" note in the empty-state voice
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
<div data-screen-label="${esc(title)}" style="font-family:Inter,sans-serif;color:#191512;background:#f7f1e6;min-height:100vh">
  ${tabs.length ? `<div class="mx-gutter" style="display:flex;gap:22px;padding:0 36px;border-bottom:1px solid rgba(25,21,18,.16);overflow-x:auto">
    ${tabs.map(t => `<a href="${t.to}" style="padding:14px 0;font:600 10px Inter,sans-serif;letter-spacing:.16em;white-space:nowrap;color:${t === active ? '#191512' : '#4a4239'};border-bottom:2px solid ${t === active ? '#9b1b22' : 'transparent'}">${esc(t.label)}</a>`).join('')}
  </div>` : ''}
  <div class="mx-pad-hero" style="padding:54px 36px 46px;display:flex;flex-direction:column;align-items:center;text-align:center">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
      <span style="width:28px;height:1px;background:#c9a962"></span>
      <span style="font:600 11px Inter,sans-serif;letter-spacing:.18em;color:#9b1b22">${esc(eyebrow)} · ${esc((active && active.label) || title).toUpperCase()}</span>
      <span style="width:28px;height:1px;background:#c9a962"></span>
    </div>
    <div class="mx-display-46" style="font-family:Fraunces,serif;font-size:46px;line-height:1.08;max-width:720px">${headline}</div>
    <div style="font-size:15px;line-height:1.6;color:#4a4239;max-width:460px;margin-top:14px">This screen is being built from <span style="font:600 12px ui-monospace,Menlo,monospace;color:#191512">${esc(source)}</span> — the design is final, the wiring is on its way.</div>
    <div style="display:flex;gap:12px;margin-top:26px;flex-wrap:wrap;justify-content:center">
      <a href="/app/home" style="padding:12px 20px;border:1px solid rgba(25,21,18,.35);font:600 10.5px Inter,sans-serif;letter-spacing:.16em;color:#191512;text-decoration:none;white-space:nowrap" data-hover="border-color:#191512;color:#191512">BACK TO HOME</a>
      ${title === 'Messages' ? '' : `<a href="/app/messages" style="padding:12px 20px;border:1px solid rgba(25,21,18,.35);font:600 10.5px Inter,sans-serif;letter-spacing:.16em;color:#191512;text-decoration:none;white-space:nowrap" data-hover="border-color:#191512;color:#191512">MESSAGE US</a>`}
    </div>
  </div>
</div>`;
    },
    destroy() {}
  };
}
