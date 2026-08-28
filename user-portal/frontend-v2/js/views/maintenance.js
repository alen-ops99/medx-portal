// Source: System Pages.dc.html › "02 · MAINTENANCE"
// Full-viewport version of the artboard's maintenance sheet. Route: /app/maintenance (bare layout).
export const SOURCE = 'System Pages.dc.html';
export const COPY = {
  kicker: 'BACK SHORTLY',
  headline: "We're setting the room for the <i style=\"color:#c9a962\">next act</i>.",
  why: 'Scheduled maintenance — the portal returns within the hour. Your tickets and registrations are safe.',
  urgent: 'Urgent? Write to us — replies land in your portal inbox once we\'re back.'
};
export const layout = 'bare';

export default {
  title: 'Back shortly',
  render(root) {
    root.innerHTML = `
<div data-screen-label="System Pages" style="font-family:Inter,sans-serif;color:#191512;min-height:100vh">
  <!-- dc: System Pages.dc.html › "02 · MAINTENANCE" -->
  <div style="min-height:100vh;position:relative;overflow:hidden;display:flex;flex-direction:column">
    <img src="/assets/photo-ballroom.jpg" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">
    <div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(25,21,18,.78) 0%,rgba(25,21,18,.9) 100%)"></div>
    <div style="position:relative;flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:30px;color:#f7f1e6">
      <img src="/assets/logo-white.png" alt="med&amp;X" style="height:26px;display:block">
      <span style="font:600 10px Inter,sans-serif;letter-spacing:.24em;color:#c9a962;margin-top:16px">${COPY.kicker}</span>
      <div style="font-family:Fraunces,serif;font-size:34px;line-height:1.15;margin-top:14px;max-width:560px">${COPY.headline}</div>
      <div style="font-size:13.5px;color:rgba(247,241,230,.8);line-height:1.6;max-width:440px;margin-top:12px">${COPY.why}</div>
      <span style="width:28px;height:1px;background:#9b1b22;margin-top:20px"></span>
      <div style="font-size:11.5px;color:rgba(247,241,230,.55);margin-top:14px">${COPY.urgent}</div>
    </div>
  </div>
  <!-- /dc -->
</div>`;
  },
  destroy() {}
};
