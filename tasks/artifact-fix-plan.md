# Artifact/branding fix plan (Audit C, 2026-07-25) — ranked by what a guest holds

REAL logo only in: council invitation (MedxInvite index.html:48342, the quality benchmark),
backend Print Suite PDFs (psLogo server.js:36363), user-portal ticket/membership card
(app.part9.js:1649+), press release (PRESS_LOGO_DATA_URI :26907, has logo toggle).
TYPED-TEXT brand everywhere else. Samples in /Users/alen/.claude/jobs/ad4f417d/tmp/artifact_audit/.

## Ranked fixes
1. Name badge psBadgeFace server.js:36207 — delete typed 'Med&X / BUILDING BRIDGES' fallback block (badge carries real logo AND fake lockup today)
2. Certificate app.part9.js:1288 — replace <div class="brand">Med&X</div> with real logo img + @page A4 landscape sizing + print /verify-certificate link (endpoint exists user-portal:21709); signature gap: use org signature (:36608)
3. Roll-up banner — MedxSignage index.html:47915 ctx.fillText('Med&X') → drawImage real logo (mirror MedxInvite :48404 ready() pattern); psBannerDoc :36301 drop typed watermark + fix layout (content only fills top 17% of 2m banner)
4. Attendance cards MedxCard index.html:47251 — no logo at all, brand is string 'evName · by Med&X'; load logo like MedxInvite
5. Accelerator PDFs admin :13094/:15429/:15606 + user-portal dupes :14491/:15596/:15775 — no brand mark, Helvetica, literal '[SEAL]' + underscores; add doc.image letterhead + org signature; dedupe generators
6. Gala program/door list index.html:40994/:40928 — typed 'MED&X' → logo image; fonts from /assets not Google CDN (print-to-PDF offline)
7. psRenderPdf server.js:35923 — NO output validation: ships Chrome ERR_ACCESS_DENIED pages as success ({"success":true} on garbage, reproduced). Assert page count/size, reject ERR_ content
8. Croatian invoice :25243 + travel order :25634 — <div class="logo">Med&X</div> gold text → real logo (financial documents to counterparties!)
9. Logo asset: only 750×165 (≈46 DPI on banner); preflight lies (printWmm hardcoded 300, actual ~409 → reports 64 DPI). Need ≥4000px or vector. ⚠ guest_picker/assets/logo.png AND admin frontend resources/assets/logo.png are WEBP with .png extension — broken data URIs on extension-trusting paths
10. Palette unify: ink #15110f, cream #fbf9f6, crimson #9b1b22, gold #c9a962; retire 3 invented navies (#0f1c2e/#0E2140/#0A1E3F) + gold variant #C9A227 in canvas renderers
11. User badge popup app.part9.js:11284 — Arial, hardcoded date, CDN libs, no logo: weakest artifact
12. Board pack :21885/:21901 typed brand → logo

Persistence: verified clean (accelerator_pdf_settings round-trip, gala schedule, content_studio_assets).
Customization today: Print Suite panel + press logo toggle + accelerator legal text only → build design
options (colors/layout) + AI assist on top of MedxCard/MedxSignage after rebranding.
