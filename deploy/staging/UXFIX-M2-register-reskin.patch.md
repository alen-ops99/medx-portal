# UXFIX-M2 — /plexus registration form reskin (audit #3) · ready-to-apply patch

Target file: `user-portal/backend/server.js` (owned by the backend agent — NOT edited by M2).
Implements UX-AUDIT-MEMBER-2026-09-02 item 3: the one server-rendered form every REGISTER /
RESERVE / PRE-REGISTER CTA opens snaps from the cream editorial portal into a navy generic-SaaS
card UI. This patch reskins it **in place** with the portal house tokens — ink `#191512`, cream
`#f7f1e6`, card `#fdfaf3`, crimson `#9b1b22`, gold `#c9a962` / gold-dark `#6e5626`, Fraunces
display, Inter micro-labels, hairline rules, square corners — the same form-styling language as
`git show main:user-portal/backend/boston.js` (Fraunces+Inter Google-Fonts head, uppercase
tracked micro-labels, hairline-bordered inputs, cream sheet), but with the portal's exact palette
and zero-radius vocabulary from `frontend-v2/css/tokens.css`.

**Structure, ids, class names, and the inline client JS contract are unchanged** —
`plexToggle`/`plexRecompute`/`plexSubmit`/`plexGuestFields` keep working untouched. One-form rule
respected (standing decision): nothing is rebuilt, only skinned.

Companion change already landed in M2's own tree: `user-portal/frontend-v2/assets/gala/` now
contains `kn512_smith_finsbury.jpg`, `kn512_delcarmen.jpg`, `kn512_spisso.jpg`,
`kn512_kevin_smith.jpg`, `mus512_singer.jpg`, `mus512_guitarist.jpg` (copied from
`user-portal/frontend/assets/gala/`, each ≤60 KB). The audit's "empty grey speaker-photo boxes"
were these images 404-ing on the Netlify origin (the /plexus HTML is proxied from Render, but the
browser resolves `/assets/gala/…` against the portal origin, where frontend-v2 lacked them). With
the files in place the keynote photos render; the `onerror` handlers below now collapse
(`display:none`) rather than reserve empty space, so no grey rectangles can recur on any origin.

Line numbers below are as of 2026-09-02 (branch `redesign/member-portal`). Apply top-to-bottom by
anchor text, not line number, if the file has drifted. After applying: `node --check user-portal/backend/server.js`.

---

## Block 1 — `galaKeynoteBlock` gains a `light` variant (≈ lines 695–722)

The block is shared by three surfaces. The two invite pages keep the dark look (no call-site
change); only /plexus passes `light=true` (Block 3).

**OLD** (whole function, from the comment above it):

```js
// Fully self-contained (inline styles only) so it renders identically on every public
// surface — the /plexus page, the croatians-abroad invite, and the gala invite — none of
// which share the same CSS class definitions.
function galaKeynoteBlock() {
    const label = 'font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#c9a962;';
    // Centered card: large circular photo on top, name + role/place beneath. object-fit:cover
    // fills the whole circle (no gap inside the ring); object-position:center top keeps faces framed.
    const cards = GALA_KEYNOTES_2026.map(k => `
            <div style="display:flex;flex-direction:column;align-items:center;text-align:center;padding:16px 12px;background:rgba(255,255,255,0.025);border:1px solid rgba(201,169,98,0.16);border-radius:14px;">
                <img src="${k.img}" alt="${escapeHtml(k.name)}" loading="lazy" style="width:90px;height:90px;border-radius:50%;object-fit:cover;object-position:center;border:3px solid #c9a962;background:#1e293b;display:block;box-shadow:0 4px 14px rgba(0,0,0,0.28);" onerror="this.style.visibility='hidden'">
                <div style="font-size:14.5px;font-weight:600;color:#fff;line-height:1.25;margin-top:13px;">${escapeHtml(k.name)}</div>
                <div style="font-size:12px;font-style:italic;color:#e8c97a;margin-top:4px;line-height:1.4;">${escapeHtml(k.role)}${k.place ? '<br>' + escapeHtml(k.place) : ''}</div>
            </div>`).join('');
    return `<div style="background:linear-gradient(135deg,rgba(201,169,98,0.10),rgba(201,169,98,0.02));border:1px solid rgba(201,169,98,0.28);border-radius:14px;padding:18px;margin:0 0 20px;">
            <div style="${label}margin-bottom:14px;text-align:center;">Gala Evening &middot; Keynote Speakers</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(225px,1fr));gap:12px;">${cards}</div>
            <div style="margin-top:16px;padding-top:15px;border-top:1px solid rgba(201,169,98,0.18);display:flex;gap:14px;align-items:center;justify-content:center;">
                <div style="display:flex;align-items:center;">
                    <img src="/assets/gala/mus512_singer.jpg" alt="Tatiana Cameron" loading="lazy" style="width:50px;height:50px;border-radius:50%;object-fit:cover;object-position:center;border:2.5px solid #c9a962;background:#1e293b;" onerror="this.style.visibility='hidden'">
                    <img src="/assets/gala/mus512_guitarist.jpg" alt="Ante Gelo" loading="lazy" style="width:50px;height:50px;border-radius:50%;object-fit:cover;object-position:center;border:2.5px solid #c9a962;background:#1e293b;margin-left:-16px;" onerror="this.style.visibility='hidden'">
                </div>
                <div>
                    <div style="${label}margin-bottom:3px;">Live Music</div>
                    <div style="font-size:14px;font-weight:600;color:#fff;">Tatiana &lsquo;Taj&#269;i&rsquo; Cameron &amp; Ante Gelo</div>
                </div>
            </div>
        </div>`;
}
```

**NEW**:

```js
// Fully self-contained (inline styles only) so it renders identically on every public
// surface — the /plexus page, the croatians-abroad invite, and the gala invite — none of
// which share the same CSS class definitions. `light=true` renders the cream house-token
// variant for the reskinned /plexus page (UXFIX-M2 #3); the default keeps the dark tokens
// for the two ink-shelled invite surfaces. Broken images now collapse (display:none) instead
// of reserving empty space — no grey rectangles on any origin.
function galaKeynoteBlock(light) {
    const T = light ? {
        label: '#6e5626', name: '#191512', role: '#6e5626', imgBg: '#f7f1e6', shadow: '',
        wrap: 'background:#fdfaf3;border:1px solid rgba(201,169,98,.5);border-radius:0;',
        card: 'background:#f7f1e6;border:1px solid rgba(25,21,18,.12);border-radius:0;',
        rule: 'rgba(25,21,18,.12)'
    } : {
        label: '#c9a962', name: '#fff', role: '#e8c97a', imgBg: '#1e293b', shadow: 'box-shadow:0 4px 14px rgba(0,0,0,0.28);',
        wrap: 'background:linear-gradient(135deg,rgba(201,169,98,0.10),rgba(201,169,98,0.02));border:1px solid rgba(201,169,98,0.28);border-radius:14px;',
        card: 'background:rgba(255,255,255,0.025);border:1px solid rgba(201,169,98,0.16);border-radius:14px;',
        rule: 'rgba(201,169,98,0.18)'
    };
    const label = `font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${T.label};`;
    // Centered card: large circular photo on top, name + role/place beneath. object-fit:cover
    // fills the whole circle (no gap inside the ring).
    const cards = GALA_KEYNOTES_2026.map(k => `
            <div style="display:flex;flex-direction:column;align-items:center;text-align:center;padding:16px 12px;${T.card}">
                <img src="${k.img}" alt="${escapeHtml(k.name)}" loading="lazy" style="width:90px;height:90px;border-radius:50%;object-fit:cover;object-position:center;border:3px solid #c9a962;background:${T.imgBg};display:block;${T.shadow}" onerror="this.style.display='none'">
                <div style="font-size:14.5px;font-weight:600;color:${T.name};line-height:1.25;margin-top:13px;">${escapeHtml(k.name)}</div>
                <div style="font-size:12px;font-style:italic;color:${T.role};margin-top:4px;line-height:1.4;">${escapeHtml(k.role)}${k.place ? '<br>' + escapeHtml(k.place) : ''}</div>
            </div>`).join('');
    return `<div style="${T.wrap}padding:18px;margin:0 0 20px;">
            <div style="${label}margin-bottom:14px;text-align:center;">Gala Evening &middot; Keynote Speakers</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(225px,1fr));gap:12px;">${cards}</div>
            <div style="margin-top:16px;padding-top:15px;border-top:1px solid ${T.rule};display:flex;gap:14px;align-items:center;justify-content:center;">
                <div style="display:flex;align-items:center;">
                    <img src="/assets/gala/mus512_singer.jpg" alt="Tatiana Cameron" loading="lazy" style="width:50px;height:50px;border-radius:50%;object-fit:cover;object-position:center;border:2.5px solid #c9a962;background:${T.imgBg};" onerror="this.style.display='none'">
                    <img src="/assets/gala/mus512_guitarist.jpg" alt="Ante Gelo" loading="lazy" style="width:50px;height:50px;border-radius:50%;object-fit:cover;object-position:center;border:2.5px solid #c9a962;background:${T.imgBg};margin-left:-16px;" onerror="this.style.display='none'">
                </div>
                <div>
                    <div style="${label}margin-bottom:3px;">Live Music</div>
                    <div style="font-size:14px;font-weight:600;color:${T.name};">Tatiana &lsquo;Taj&#269;i&rsquo; Cameron &amp; Ante Gelo</div>
                </div>
            </div>
        </div>`;
}
```

---

## Block 2 — `PLEXUS_SHELL`: navy SaaS shell → house shell (≈ lines 1159–1291)

Replace the **entire** `const PLEXUS_SHELL = (inner, title) => …;` template-literal constant.
Anchors: it starts at `const PLEXUS_SHELL = (inner, title) => \`<!DOCTYPE html>` and ends at the
line `</div></body></html>\`;` immediately before `const plexusNoticePage = …`.

What changes: Fraunces+Inter Google-Fonts links added to the head (the boston.js pattern); the
`linear-gradient(160deg,#0f172a,#1e293b)` navy ground becomes flat cream; every panel becomes a
cream card with a `rgba(25,21,18,.16)` hairline and **zero radius**; the hero becomes the house
ink band with a gold hairline and an italic Fraunces headline; labels become uppercase tracked
Inter micro-labels; inputs become hairline fields with the portal's crimson focus ring; the green
`FREE` chip becomes a gold-dark micro-label; the submit becomes the crimson primary button; the
white-inverted logo becomes an ink mark. The 880/768/480 responsive structure, all selectors, and
the iOS ≥16px input rule are preserved.

**NEW** (full replacement):

```js
const PLEXUS_SHELL = (inner, title) => `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${title || 'Plexus 2026'}</title><link rel="icon" type="image/png" href="/assets/favicon-x.png"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,400;1,9..144,500&family=Inter:wght@400;500;600&display=swap" rel="stylesheet"><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css"><style>
    /* UXFIX-M2 #3 (2026-09-02): reskinned in place with the member-portal house tokens —
       ink #191512 / cream #f7f1e6 / card #fdfaf3 / crimson #9b1b22 / gold #c9a962 / #6e5626,
       Fraunces display, Inter micro-labels, hairline rules, square corners. All class names,
       ids and breakpoints are unchanged; the inline client JS is untouched. */
    * { margin:0; padding:0; box-sizing:border-box; }
    body { min-height:100vh; background:#f7f1e6; font-family:Inter,-apple-system,BlinkMacSystemFont,system-ui,sans-serif; color:#191512; padding:32px 16px; -webkit-font-smoothing:antialiased; }
    /* Wide on desktop (was a fixed 640px strip — that's why it didn't use desktop space). */
    .container { max-width:1080px; margin:0 auto; }
    @media (min-width:1280px) { .container { max-width:1200px; } }
    .logo { text-align:center; margin-bottom:24px; }
    .logo img { height:38px; width:auto; display:inline-block; filter:brightness(0); }
    .logo span { font-family:Fraunces,serif; font-size:28px; font-weight:600; color:#191512; letter-spacing:-0.5px; }
    .logo span em { font-style:normal; color:#6e5626; }
    .card { background:#fdfaf3; border:1px solid rgba(25,21,18,.16); border-radius:0; padding:28px 26px; min-width:0; max-width:100%; }
    /* Hero header band — house ink card with a gold hairline, italic Fraunces headline. */
    .hero { background:#191512; color:#f7f1e6; border:1px solid rgba(201,169,98,.55); border-radius:0; padding:38px 28px; text-align:center; margin-bottom:20px; }
    .hero .lede { max-width:640px; margin:0 auto; color:rgba(247,241,230,.8); }
    /* Two-column layout on desktop: events on the left, the form on the right. */
    .plex-layout { display:grid; grid-template-columns:minmax(0,1.25fr) minmax(0,1fr); gap:20px; align-items:start; }
    .form-col { position:sticky; top:24px; }
    .badge { display:inline-block; font:600 10px Inter,sans-serif; letter-spacing:.18em; text-transform:uppercase; color:#c9a962; margin-bottom:14px; padding:6px 12px; border:1px solid rgba(201,169,98,.65); border-radius:0; }
    h1 { font-family:Fraunces,serif; font-weight:500; font-size:26px; color:#191512; margin-bottom:6px; line-height:1.15; letter-spacing:-.3px; }
    .hero h1 { color:#f7f1e6; font-style:italic; font-size:clamp(28px,4.2vw,44px); }
    .lede { font-size:14px; color:#4a4239; margin-bottom:8px; line-height:1.6; }
    .section-label { font:600 11px Inter,sans-serif; letter-spacing:.16em; text-transform:uppercase; color:#6e5626; margin:22px 0 12px; }
    .plex-cal-row { margin-top:16px; padding-top:16px; border-top:1px solid rgba(25,21,18,.16); display:flex; flex-wrap:wrap; align-items:center; gap:10px; }
    .plex-cal-label { font:600 10px Inter,sans-serif; letter-spacing:.16em; text-transform:uppercase; color:#4a4239; }
    .plex-cal-links { display:flex; flex-wrap:wrap; gap:8px; }
    .plex-cal-btn { display:inline-flex; align-items:center; gap:7px; padding:9px 14px; border:1px solid rgba(25,21,18,.3); border-radius:0; background:transparent; color:#191512; font:600 10px Inter,sans-serif; letter-spacing:.14em; text-transform:uppercase; text-decoration:none; transition:border-color .15s ease; }
    .plex-cal-btn:hover { border-color:#191512; }
    .plex-cal-btn i { color:#6e5626; font-size:12px; }
    .event-option { background:#fdfaf3; border:1px solid rgba(25,21,18,.16); border-radius:0; padding:16px; margin-bottom:10px; display:flex; gap:14px; cursor:pointer; transition:border-color .15s ease; position:relative; overflow:hidden; }
    .event-option::before { content:''; position:absolute; left:0; top:0; bottom:0; width:3px; background:transparent; transition:background .15s ease; }
    .event-option:hover { border-color:rgba(25,21,18,.45); }
    .event-option.selected { border-color:#191512; }
    .event-option.evt-conference.selected::before { background:#9b1b22; }
    .event-option.evt-bridges.selected::before { background:#191512; }
    .event-option.evt-gala.selected::before { background:#c9a962; }
    .event-checkbox { flex-shrink:0; width:20px; height:20px; border:1px solid rgba(25,21,18,.35); border-radius:0; background:#fdfaf3; display:flex; align-items:center; justify-content:center; margin-top:2px; transition:background .15s ease,border-color .15s ease; }
    .event-option.evt-conference.selected .event-checkbox { background:#9b1b22; border-color:#9b1b22; }
    .event-option.evt-bridges.selected .event-checkbox { background:#191512; border-color:#191512; }
    .event-option.evt-gala.selected .event-checkbox { background:#c9a962; border-color:#c9a962; }
    .event-checkbox i { color:#f7f1e6; font-size:11px; display:none; }
    .event-option.evt-gala.selected .event-checkbox i { color:#191512; }
    .event-option.selected .event-checkbox i { display:block; }
    .event-body { flex:1; }
    .event-title-row { display:flex; justify-content:space-between; gap:10px; align-items:baseline; margin-bottom:4px; }
    .event-name { font-family:Fraunces,serif; font-size:17px; font-weight:500; color:#191512; }
    .event-price { font:600 10px Inter,sans-serif; letter-spacing:.14em; text-transform:uppercase; color:#6e5626; white-space:nowrap; }
    .event-price.free { color:#6e5626; }
    .event-meta { font-size:12.5px; color:#4a4239; line-height:1.5; }
    .event-status { display:inline-block; font:600 8.5px Inter,sans-serif; letter-spacing:.14em; text-transform:uppercase; color:#6e5626; border:1px solid rgba(201,169,98,.65); background:transparent; padding:3px 9px; border-radius:0; margin:2px 0 6px; }
    .event-date { font-size:12.5px; font-weight:600; color:#191512; margin-bottom:4px; }
    /* Gala keynote highlight — used by the legacy single-keynote card only; the four-keynote
       block is galaKeynoteBlock(true) (light variant). */
    .keynote-card { background:#fdfaf3; border:1px solid rgba(201,169,98,.5); border-radius:0; padding:16px 18px; margin-top:14px; display:flex; gap:16px; align-items:center; }
    .keynote-card img { width:72px; height:72px; border-radius:50%; object-fit:cover; object-position:center 22%; border:2px solid #c9a962; flex-shrink:0; }
    .keynote-card .kc-label { font:600 9px Inter,sans-serif; letter-spacing:.2em; text-transform:uppercase; color:#6e5626; margin-bottom:4px; }
    .keynote-card .kc-name { font-family:Fraunces,serif; font-size:16px; font-weight:500; color:#191512; line-height:1.2; }
    .keynote-card .kc-role { font-size:12.5px; font-style:italic; color:#6e5626; margin-top:3px; }
    .form-grid { display:grid; gap:14px; margin-top:6px; }
    .form-row { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
    label { display:block; font:600 10px Inter,sans-serif; letter-spacing:.14em; text-transform:uppercase; color:#4a4239; margin-bottom:6px; }
    input, select, textarea { width:100%; padding:11px 12px; border:1px solid rgba(25,21,18,.25); border-radius:0; background:#fdfaf3; color:#191512; font-size:13.5px; font-family:Inter,sans-serif; }
    input:focus, select:focus, textarea:focus { outline:1px solid #9b1b22; outline-offset:-1px; box-shadow:none; }
    input::placeholder, textarea::placeholder { color:#9b8f80; }
    textarea { resize:vertical; min-height:60px; }
    .total-display { display:none; justify-content:space-between; align-items:center; padding:14px 16px; background:#191512; color:#f7f1e6; border:1px solid rgba(201,169,98,.55); border-radius:0; margin-top:16px; }
    .total-display.show { display:flex; }
    .total-display .label { font:600 10px Inter,sans-serif; letter-spacing:.16em; text-transform:uppercase; color:rgba(247,241,230,.75); }
    .total-display .amount { font-family:Fraunces,serif; font-size:24px; font-weight:500; color:#c9a962; }
    .submit-btn { width:100%; margin-top:16px; padding:15px 20px; border:0; border-radius:0; background:#9b1b22; color:#f7f1e6; font:600 11px Inter,sans-serif; letter-spacing:.16em; text-transform:uppercase; cursor:pointer; transition:background .15s ease; }
    .submit-btn:hover { background:#7e151b; }
    .submit-btn:disabled { opacity:.55; cursor:not-allowed; }
    .msg { margin-top:14px; padding:12px 14px; border-radius:0; font-size:13px; display:none; }
    .msg.err { display:block; background:rgba(155,27,34,.06); border:1px solid rgba(155,27,34,.35); color:#7e151b; }
    .foot { text-align:center; font-size:12px; color:#4a4239; margin-top:20px; }
    .foot a { color:#9b1b22; text-decoration:none; }
    .foot a:hover { color:#191512; }
    /* Mid widths — drop the two-column split to a single stacked column. */
    @media (max-width: 880px) {
        .plex-layout { grid-template-columns: minmax(0, 1fr); }
        .form-col { position: static; }
    }
    /* Tablet / large phone — stack the form to one column, tighten the cards (mirrors the Gala
       page's 768px breakpoint so the layout adapts the same way). */
    @media (max-width: 768px) {
        body { padding: 22px 12px; }
        .container { max-width: 100%; }
        .card { padding: 22px 18px; }
        .logo span { font-size: 24px; }
        h1 { font-size: 22px; }
        .lede { font-size: 13.5px; }
        .event-option { padding: 14px; gap: 12px; }
        .event-name { font-size: 16px; }
        .event-price { white-space: normal; }
        .event-meta { font-size: 12px; }
        .form-row { grid-template-columns: 1fr; gap: 12px; }
        .submit-btn { padding: 14px; }
        /* iOS Safari auto-zooms any focused control whose font-size is < 16px.
           Bump form controls to 16px on phones/tablets only (desktop keeps 13.5px). */
        input, select, textarea { font-size: 16px; }
        /* Comfortable 44px touch targets for the add-to-calendar chips. */
        .plex-cal-btn { min-height: 44px; }
    }
    /* Small phone — further compaction, touch targets kept comfortable. */
    @media (max-width: 480px) {
        body { padding: 16px 10px; }
        .card { padding: 18px 14px; }
        h1 { font-size: 20px; margin-bottom: 8px; }
        .lede { font-size: 12.5px; line-height: 1.55; }
        .event-title-row { flex-wrap: wrap; gap: 4px; }
        .event-name { font-size: 15px; }
        .section-label { font-size: 10px; margin: 18px 0 10px; }
        .total-display .amount { font-size: 20px; }
        .foot { font-size: 11px; }
    }
</style></head><body><div class="container">
    <div class="logo"><img src="${MEDX_LOGO_URL}" alt="Med&amp;X" onerror="this.outerHTML='<span>med<em>&amp;</em>X</span>'" /></div>
    ${inner}
    <div class="foot">Questions? <a href="mailto:laura.rodman@medx.hr">laura.rodman@medx.hr</a> &middot; <a href="https://medx.hr">medx.hr</a><br>
        <span style="display:inline-block;margin-top:8px;">
            <a href="https://www.linkedin.com/company/med-x-association/">LinkedIn</a> &middot;
            <a href="https://www.instagram.com/medx_association/">Instagram</a> &middot;
            <a href="https://www.facebook.com/profile.php?id=61554188818525">Facebook</a>
        </span>
    </div>
</div></body></html>`;
```

Notes on the two look-bearing deltas inside the body wrapper: the logo drops
`filter:brightness(0) invert(1)` (white-forcing, for navy) in favour of `filter:brightness(0)`
(ink mark on cream — safe whatever colours the CDN PNG carries) and gains the same typeset
fallback the invite page uses.

---

## Block 3 — notice-page heading, red → crimson (≈ line 1293)

**OLD**
```js
const plexusNoticePage = (heading, body) => PLEXUS_SHELL(`<div class="card" style="text-align:center;"><h1 style="color:#ef4444;">${heading}</h1><p class="lede" style="margin-top:10px;">${body}</p></div>`, heading);
```
**NEW**
```js
const plexusNoticePage = (heading, body) => PLEXUS_SHELL(`<div class="card" style="text-align:center;"><h1 style="color:#9b1b22;">${heading}</h1><p class="lede" style="margin-top:10px;">${body}</p></div>`, heading);
```

## Block 4 — /plexus uses the light keynote block (≈ line 1385)

**OLD**
```js
        const keynoteCard = offered.includes('gala') ? galaKeynoteBlock() : '';
```
**NEW**
```js
        const keynoteCard = offered.includes('gala') ? galaKeynoteBlock(true) : '';
```

## Block 5 — signed-in note: green chip → house banner (≈ line 1413)

**OLD**
```js
                        ${showMemberCard ? `<div id="plexLinkNote" style="display:none;margin-bottom:14px;padding:11px 14px;border:1px solid rgba(34,197,94,.35);border-radius:10px;background:rgba(34,197,94,.07);font-size:12.5px;color:#a7f3d0;line-height:1.5;"></div>` : ''}
```
**NEW**
```js
                        ${showMemberCard ? `<div id="plexLinkNote" style="display:none;margin-bottom:14px;padding:11px 14px;border:1px solid rgba(201,169,98,.5);border-radius:0;background:#f1e8d3;font-size:12.5px;color:#191512;line-height:1.5;"></div>` : ''}
```

## Block 6 — muted inline hints, slate → house muted (lines ≈ 1426, 1433, 1497)

Three occurrences of `color:#64748b` inside the form markup (guest-count hint, discount-code
hint, guest-email hint). Replace each:

**OLD** `<span style="color:#64748b;font-weight:400;">` → **NEW** `<span style="color:#9b8f80;font-weight:400;">`

(One is inside the `plexGuestFields` client JS string — same substitution.)

## Block 7 — discount-code Apply button: gold gradient pill → house gold button (≈ line 1436)

The audit's #4 kills the *rewards points→coupon economy*; this field is the separate
admin-issued discount-code input on the gala price and **stays**, restyled.

**OLD**
```js
                                    <button type="button" id="pf_couponBtn" onclick="plexApplyCoupon()" style="padding:11px 16px;border:none;border-radius:9px;background:linear-gradient(135deg,#c9a962,#b8965a);color:#0f172a;font-weight:700;cursor:pointer;white-space:nowrap;">Apply</button>
```
**NEW**
```js
                                    <button type="button" id="pf_couponBtn" onclick="plexApplyCoupon()" style="padding:11px 16px;border:0;border-radius:0;background:#c9a962;color:#191512;font:600 10px Inter,sans-serif;letter-spacing:.16em;text-transform:uppercase;cursor:pointer;white-space:nowrap;">Apply</button>
```

## Block 8 — guest cards inside `plexGuestFields` (≈ line 1493)

**OLD**
```js
                html += '<div style="border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;margin-top:10px;">'
```
**NEW**
```js
                html += '<div style="border:1px solid rgba(25,21,18,.16);border-radius:0;padding:12px 14px;margin-top:10px;background:#f7f1e6;">'
```

## Block 9 — coupon-message colours in `plexApplyCoupon` (≈ lines 1527–1534)

Dark-theme feedback colours → light-theme. Three `'#fca5a5'` (error rose) → `'#9b1b22'`; one
`'#5eead4'` (success teal) → `'#6e5626'`:

- `if (!code) { … m.style.color = '#fca5a5'; … }` → `'#9b1b22'`
- `if (d.valid) { … m.style.color = '#5eead4'; … }` → `'#6e5626'`
- `else { … m.style.color = '#fca5a5'; … }` → `'#9b1b22'`
- `catch(e) { … m.style.color = '#fca5a5'; … }` → `'#9b1b22'`

## Block 10 — success card: green check → gold, Fraunces heading picks up automatically (≈ line 1582)

**OLD** (inside `plexSubmit`)
```js
                document.getElementById('plexMain').innerHTML = '<div class="card" style="text-align:center;max-width:640px;margin:0 auto;padding:36px 28px;"><div style="font-size:46px;color:#22c55e;margin-bottom:10px;"><i class="fas fa-circle-check"></i></div><h1>You are registered</h1><p class="lede" style="margin-top:10px;">Thank you, ' + plexEsc(body.first_name) + '. A confirmation email with your check-in QR code is on its way to ' + plexEsc(body.email) + '. We look forward to welcoming you to Plexus 2026 in Zagreb.</p></div>';
```
**NEW**
```js
                document.getElementById('plexMain').innerHTML = '<div class="card" style="text-align:center;max-width:640px;margin:0 auto;padding:36px 28px;"><div style="font-size:46px;color:#c9a962;margin-bottom:10px;"><i class="fas fa-circle-check"></i></div><h1>You are registered</h1><p class="lede" style="margin-top:10px;">Thank you, ' + plexEsc(body.first_name) + '. A confirmation email with your check-in QR code is on its way to ' + plexEsc(body.email) + '. We look forward to welcoming you to Plexus 2026 in Zagreb.</p></div>';
```

## Block 11 — payment-fallback box: dark tokens → house tokens (≈ lines 1592–1597)

**OLD** (inside `plexPayFallback`)
```js
            box.innerHTML =
                '<div style="margin-top:14px;padding:20px 18px;border:1px solid rgba(201,169,98,0.4);border-radius:14px;background:rgba(201,169,98,0.06);text-align:left;">'
                + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;"><i class="fas fa-shield-halved" style="color:#c9a962;"></i><strong style="color:#e8e2d4;font-size:14px;">We could not open secure checkout</strong></div>'
                + '<p style="font-size:13px;color:#94a3b8;line-height:1.6;margin:0 0 14px;">Your details are safe and nothing has been charged. This is usually a brief connection issue. Try again, or reach us and we will send you a secure payment link.</p>'
                + '<div style="display:flex;flex-wrap:wrap;gap:8px;">'
                + '<button type="button" onclick="plexRetry()" style="display:inline-flex;align-items:center;gap:6px;padding:10px 16px;border:none;border-radius:9px;background:linear-gradient(135deg,#c9a962,#b8965a);color:#0f172a;font-weight:700;cursor:pointer;font-size:13px;"><i class="fas fa-rotate-right"></i> Try again</button>'
                + '<a href="mailto:laura.rodman@medx.hr?subject=Plexus%202026%20registration%20%E2%80%94%20payment%20help" style="display:inline-flex;align-items:center;gap:6px;padding:10px 16px;border:1px solid rgba(201,169,98,0.5);border-radius:9px;color:#e8e2d4;font-weight:600;text-decoration:none;font-size:13px;"><i class="fas fa-envelope"></i> laura.rodman@medx.hr</a>'
                + '</div></div>';
```
**NEW**
```js
            box.innerHTML =
                '<div style="margin-top:14px;padding:20px 18px;border:1px solid rgba(201,169,98,.5);border-radius:0;background:#f1e8d3;text-align:left;">'
                + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;"><i class="fas fa-shield-halved" style="color:#6e5626;"></i><strong style="color:#191512;font-size:14px;">We could not open secure checkout</strong></div>'
                + '<p style="font-size:13px;color:#4a4239;line-height:1.6;margin:0 0 14px;">Your details are safe and nothing has been charged. This is usually a brief connection issue. Try again, or reach us and we will send you a secure payment link.</p>'
                + '<div style="display:flex;flex-wrap:wrap;gap:8px;">'
                + '<button type="button" onclick="plexRetry()" style="display:inline-flex;align-items:center;gap:6px;padding:10px 16px;border:0;border-radius:0;background:#9b1b22;color:#f7f1e6;font:600 10px Inter,sans-serif;letter-spacing:.16em;text-transform:uppercase;cursor:pointer;"><i class="fas fa-rotate-right"></i> Try again</button>'
                + '<a href="mailto:laura.rodman@medx.hr?subject=Plexus%202026%20registration%20%E2%80%94%20payment%20help" style="display:inline-flex;align-items:center;gap:6px;padding:10px 16px;border:1px solid rgba(25,21,18,.3);border-radius:0;color:#191512;font-weight:600;text-decoration:none;font-size:13px;"><i class="fas fa-envelope"></i> laura.rodman@medx.hr</a>'
                + '</div></div>';
```

---

## After applying

1. `node --check user-portal/backend/server.js`
2. Load `/plexus` (staging portal origin): cream ground, ink hero with italic Fraunces
   "Reserve your place", gold-hairline badge, three hairline event cards with gold-dark
   `FREE`/price micro-labels, four keynote photos rendering (assets landed in
   frontend-v2/assets/gala — see head note), crimson `COMPLETE REGISTRATION`.
3. Select the Gala → ink total band shows gold Fraunces amount; apply a bad discount code →
   crimson message on cream (not rose-on-navy).
4. Check `/plexus/<some-revoked-token>` → notice page renders on cream with a crimson heading.
5. Confirm the croatians-abroad invite and VIP invite pages are pixel-unchanged (they call
   `galaKeynoteBlock()` with no argument → dark variant, plus their own shells).

Scope guard: nothing in this patch touches routes, payloads, validation, Stripe flow, or the
`/api/croatians-abroad/register` contract — presentation only.
