// System page: 404 in the admin voice (README note 21: italic Fraunces line · one sentence · one CTA). No admin artboard — built from tokens.
export default {
  title: 'Page not found',
  render(root, ctx) {
    root.innerHTML = `
<div data-screen-label="404" style="min-height:100vh;background:#f6f2ea;color:#201b16;font-family:Inter,sans-serif">
  <div class="mx-gutter" style="max-width:1180px;margin:0 auto;padding:54px 28px 60px;text-align:center">
    <span style="display:inline-block;width:28px;height:1px;background:#c9a962"></span>
    <div class="mx-display-30" style="font-family:Fraunces,serif;font-size:30px;line-height:1.15;margin-top:14px">That page isn't <i style="color:#9b1b22">here</i>.</div>
    <div style="font-size:13px;color:#6d6459;line-height:1.6;max-width:420px;margin:12px auto 0">The address <span style="font:600 12px ui-monospace,Menlo,monospace;color:#201b16">${ctx.path}</span> matches no admin destination — the search field finds every screen and person.</div>
    <div style="display:flex;gap:12px;margin-top:24px;justify-content:center"><a href="/today" style="padding:10px 16px;background:#9b1b22;color:#fff;font:600 10px Inter,sans-serif;letter-spacing:.14em;white-space:nowrap" data-hover="background:#7e151b;color:#fff">BACK TO TODAY →</a></div>
  </div>
</div>`;
  },
  destroy() {}
};
