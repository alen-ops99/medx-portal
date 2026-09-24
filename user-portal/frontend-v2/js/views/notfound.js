// Source: System Pages.dc.html › "01 · 404 — PAGE NOT FOUND"
// The artboard shows the page as a 1100×560 sheet in a gallery; here the sheet IS the page
// (full viewport, same ink header, same centred body). Rendered without the portal chrome.
import { esc, ui } from '../ui.js';

export const SOURCE = 'System Pages.dc.html';
export const COPY = {
  kicker: 'MEMBER PORTAL', code: '404',
  headline: "This door isn't on the <i style=\"color:#9b1b22\">guest list</i>.",
  why: 'The page moved, or the link is off by a letter. Everything you need is one step away.',
  home: 'BACK TO HOME →', message: 'MESSAGE US'
};
export const layout = 'bare';

// Entrance (shared with maintenance.js): the centred copy rises in line by line and a background photo
// settles, all inside half a second. It runs from here, through the Web Animations API with the house ease
// (as ui.js's motion helpers do), because these pages paint synchronously: a view stylesheet still loading
// would either hold the paint or land after it and replay the text. Nothing moves under reduced motion;
// fill `backwards`, so nothing is held hidden once the entrance has run (or if animate() is unavailable).
const EASE = 'cubic-bezier(.22,1,.36,1)';
const STAGGER = [0, 40, 70, 100, 120, 140];   // ms — the last line lands by ~500 ms
export function enterSystem(root) {
  if (!root || ui.reducedMotion()) return;
  const play = (el, frames, opts) => { try { el.animate(frames, Object.assign({ easing: EASE, fill: 'backwards' }, opts)); } catch (e) { /* no WAAPI: stays still */ } };
  root.querySelectorAll('[data-enter="rise"] > *').forEach((el, i) =>
    play(el, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 360, delay: STAGGER[Math.min(i, STAGGER.length - 1)] }));
  root.querySelectorAll('[data-enter="settle"]').forEach(el =>
    play(el, [{ transform: 'scale(1.05)' }, { transform: 'none' }], { duration: 900 }));
}

export default {
  title: 'Page not found',
  async render(root, ctx) {
    if (ctx && ctx.ready && !(await ctx.ready())) return;   // the router moved on
    root.innerHTML = `
<div data-screen-label="System Pages" style="font-family:Inter,sans-serif;color:#191512;background:#f7f1e6;min-height:100vh;display:flex;flex-direction:column">
  <!-- dc: System Pages.dc.html › "01 · 404 — PAGE NOT FOUND" -->
  <div style="min-height:100vh;background:#f7f1e6;display:flex;flex-direction:column;overflow:hidden">
    <div style="background:#191512;padding:16px 32px;display:flex;align-items:center">
      <a href="/app/home"><img src="/assets/logo-white.png" alt="med&amp;X" style="height:18px;display:block"></a>
      <div style="flex:1"></div>
      <span style="font:600 9px Inter,sans-serif;letter-spacing:.2em;color:#c9a962">${COPY.kicker}</span>
    </div>
    <div data-enter="rise" style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:30px">
      <span style="font-family:Fraunces,serif;font-style:italic;font-size:90px;line-height:1;color:rgba(25,21,18,.14)">${COPY.code}</span>
      <span style="width:28px;height:1px;background:#c9a962;margin:18px 0 14px"></span>
      <div class="mx-display-30" style="font-family:Fraunces,serif;font-size:30px;line-height:1.15">${COPY.headline}</div>
      <div style="font-size:13.5px;color:#4a4239;line-height:1.6;max-width:420px;margin-top:12px">${COPY.why}</div>
      <div style="display:flex;gap:12px;margin-top:24px;flex-wrap:wrap;justify-content:center">
        <a href="/app/home" style="padding:13px 24px;background:#9b1b22;color:#f7f1e6;font:600 10.5px Inter,sans-serif;letter-spacing:.16em;white-space:nowrap" data-hover="background:#7e151b;color:#f7f1e6">${COPY.home}</a>
        <a href="/app/messages" style="padding:13px 24px;border:1px solid rgba(25,21,18,.3);color:#191512;font:600 10.5px Inter,sans-serif;letter-spacing:.16em;white-space:nowrap" data-hover="border-color:#191512;color:#191512">${COPY.message}</a>
      </div>
    </div>
  </div>
  <!-- /dc -->
</div>`;
    enterSystem(root);
  },
  destroy() {}
};
