// js/views/_stub.js — placeholder view factory for screens not yet built.
// A stub renders the screen title + an "in progress" note in the empty-state voice
// (italic Fraunces line · one sentence · one CTA) so every route in js/routes.js resolves.
// Replace the stub file with the real module (same file name, same default export shape).
//
// Audit C3: this used to print the caller's `source` — an internal build note such as
// "(current-portal Mentorship page — no artboard; restyle at implementation)" — straight onto the
// member's screen. Every word here is member-facing copy; build notes stay in the module comment.
// `source` is still accepted so the stub modules keep their metadata export, but it is NEVER
// rendered. Nothing else may be rendered from it either.
import { esc } from '../ui.js';

// Phone calm pass (2026-09-25): a large title, one line, and one ghost "Message us" (DESIGN-RULES §11).
export function makeStub({ source, title, headline, tabs = [], eyebrow = 'COMING SOON', note, lede }) {
  return {
    title,
    async render(root, ctx) {
      if (ctx && ctx.ready && !(await ctx.ready())) return;   // the router moved on
      const tab = ctx.params && (ctx.params.tab || ctx.params.view);
      const active = tabs.find(t => t.key === (tab || '')) || tabs[0];
      root.innerHTML = `
<div data-screen-label="${esc(title)}" style="font-family:Inter,sans-serif;color:#191512;background:#f7f1e6;min-height:100vh">
  ${tabs.length ? `<div class="mx-gutter" style="display:flex;gap:22px;padding:0 36px;border-bottom:1px solid rgba(25,21,18,.16);overflow-x:auto">
    ${tabs.map(t => `<a href="${t.to}" style="padding:14px 0;font:600 12px Inter,sans-serif;letter-spacing:.12em;white-space:nowrap;color:${t === active ? '#191512' : '#4a4239'};border-bottom:2px solid ${t === active ? '#9b1b22' : 'transparent'}">${esc(t.label)}</a>`).join('')}
  </div>` : ''}
  <div class="mx-p">
    <span class="mx-stub-eyebrow">${esc(eyebrow.charAt(0) + eyebrow.slice(1).toLowerCase())}</span>
    <h1 class="mx-lt" style="margin-top:6px">${headline}</h1>
    <p class="mx-lede">${esc(lede || note || 'This part of your Med&X is on its way.')}</p>
    ${title === 'Messages' ? '' : `<a href="/app/messages" class="btn-ghost mx-stub-cta">MESSAGE US</a>`}
  </div>
</div>`;
    },
    destroy() {}
  };
}
