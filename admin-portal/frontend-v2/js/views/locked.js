// Locked-state screen (IMPLEMENTATION_CONTRACT §3.4): rendered by the router when a destination's
// permission sections are missing on this admin, and reachable by any view that meets a 403 { section }.
// Clean state, never a broken page: names the section, points at the founder, one CTA.
import { esc } from '../ui.js';
import { perms } from '../perms.js';

export default {
  title: 'Locked',
  render(root, ctx) {
    const section = ctx.lockedSection || (ctx.query && ctx.query.section) || '';
    const c = perms.lockedCopy(section);
    root.innerHTML = `
<div data-screen-label="Locked" style="min-height:100vh;background:#f6f2ea;color:#201b16;font-family:Inter,sans-serif">
  <div class="mx-gutter" style="max-width:1180px;margin:0 auto;padding:54px 28px 60px">
    <div style="border:1px solid rgba(32,27,22,.14);background:#fff;max-width:560px;margin:0 auto">
      <div class="empty" style="padding:38px 22px 40px">
        <span style="font:600 9px Inter,sans-serif;letter-spacing:.12em;background:#f8f1e2;color:#7a6432;padding:3px 8px">LOCKED · ${esc(perms.label(section).toUpperCase())}</span>
        <span class="empty-line" style="margin-top:6px">${esc(c.line)}</span>
        <span class="empty-why">${esc(c.why)}</span>
        <a href="/today" style="margin-top:8px;padding:9px 14px;background:#9b1b22;color:#fff;font:600 10px Inter,sans-serif;letter-spacing:.14em;white-space:nowrap" data-hover="background:#7e151b;color:#fff">${esc(c.cta)}</a>
      </div>
    </div>
  </div>
</div>`;
  },
  destroy() {}
};
