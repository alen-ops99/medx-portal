# PHOTO PLACEMENT PLAN - Med&X Member Portal (redesign 2026-08-28)

Source folder: `/Users/alen/Downloads/MedX Slike` - 278 files (+2 .DS_Store), 280 entries inventoried READ-ONLY on 2026-08-29.
Nothing was copied, uploaded, modified, or deleted. This document is inventory + plan only.

Target design: `design/handoff/member-portal-2026-08-28/` (Home rotating hero, per-event ALL PHOTOS galleries,
Bridges past-city recap cards + per-edition galleries, Accelerator cohort gallery, speaker portraits + institution
logos, supporters strip). Current placeholders in `user-portal/frontend-v2/assets/` (photo-ballroom / bridges /
candlelit / gala / hall / stage.jpg and `assets/gala/*`) are low-res darkened crops OF THIS SAME CORPUS - the plan
below replaces each with its full-res original.

Legend: `*` = image opened and verified by eye; `~` = description from filename/series context (not opened).
Aspect: ratio W/H with L(andscape) / P(ortrait) / SQ. Flags: SMALL = <800 px wide (too small for heroes),
WEBP = needs conversion, EXT-MISMATCH = actual format differs from extension, DUP = byte-identical twin,
STRIP = pre-cropped banner. No HEIC files exist anywhere in the folder.

---

## 1. Full inventory by subfolder

### 0_Logotipovi (27 images)

| # | File | Px | Aspect | Type / size | Description | Flags |
|---|------|----|--------|-------------|-------------|-------|
| 1 | `.DS_Store` | - | - | .DS_Store 8 KB | ~ macOS system file | NOT-PHOTO; delete-ignore |
| 2 | `Logo_Accelerator.png` | 2044x1182 | 1.73 L | PNG 222 KB | * Accelerator logo SHEET: 3 lockups (grey/white/black bands) with fast-forward mark | NOT-PHOTO; needs crop to single lockup |
| 3 | `Logo_Biomedical-Forum.png` | 1280x720 | 1.78 L | PNG 89 KB | * Biomedical Forum by med&x wordmark, grey/black on transparent | NOT-PHOTO; DUP=4_Biomedical_Forum/Forum_logo.png |
| 4 | `Logo_Building-Bridges.png` | 1667x322 | 5.18 L | PNG 99 KB | * Building Bridges in biomedicine wordmark + red bridge roundel | NOT-PHOTO; DUP=5_Building_Bridges/BB_logo.png |
| 5 | `Logo_HMPA.png` | 1425x786 | 1.81 L | PNG 240 KB | * Harvard Medical Postdoc Association logo, visibly soft/upscaled | NOT-PHOTO; blurry - small render only |
| 6 | `Logo_Harvard-HMS.png` | 1674x425 | 3.94 L | PNG 345 KB | * Harvard Medical School shield + wordmark on WHITE (not transparent) | NOT-PHOTO; white bg - box it or re-source |
| 7 | `Logo_Plexus.png` | 1050x600 | 1.75 L | PNG 68 KB | * Plexus wordmark + gold lightbulb, tagline 'Inspiring Change, One Light at a Time' | NOT-PHOTO |
| 8 | `Logo_medX-dark.png` | 903x199 | 4.54 L | PNG 15 KB | * med&X dark wordmark (black text, gold X, red dot) on transparent - for light grounds | NOT-PHOTO |
| 9 | `Logo_medX-tamna-podloga.png` | 2500x505 | 4.95 L | PNG 102 KB | * med&X wordmark, highest-res master (2500 px) | NOT-PHOTO |
| 10 | `Logo_medX-white.png` | 593x134 | 4.43 L | PNG 6 KB | * all-white med&X wordmark on transparent (renders invisible on white) - dark grounds | NOT-PHOTO; SMALL 593w |
| 11 | `Logo_medX-zagrade.png` | 515x115 | 4.48 L | PNG 5 KB | * white med&X bracket variant on transparent - dark grounds only | NOT-PHOTO; SMALL 515w |
| 12 | `Logo_medX.png` | 903x199 | 4.54 L | WEBP 4 KB | * med&X dark wordmark - file is WEBP with .png extension | NOT-PHOTO; EXT-MISMATCH WEBP; convert |
| 13 | `Podrzavatelji_i_partneri/aci.png` | 128x76 | 1.68 L | PNG 2 KB | * ACI marinas flag mark, tiny | LOGO; SMALL 128w - request vector |
| 14 | `Podrzavatelji_i_partneri/british-embassy-zagreb.png` | 480x401 | 1.20 L | PNG 60 KB | * UK royal coat of arms only - no 'British Embassy' text in image | LOGO; name NOT readable in art - needs caption |
| 15 | `Podrzavatelji_i_partneri/cambridge.png` | 1920x2246 | 0.85 P | PNG 744 KB | * University of Cambridge shield only - no wordmark text | LOGO; name NOT readable in art - needs caption |
| 16 | `Podrzavatelji_i_partneri/hrvatska-turisticka-zajednica.png` | 340x147 | 2.31 L | PNG 13 KB | * HRVATSKA (Croatian NTB) logo; white tagline clips on light grounds | LOGO; SMALL 340w; part-white text |
| 17 | `Podrzavatelji_i_partneri/hrvatski-lijecnicki-zbor.png` | 332x336 | 0.99 SQ | PNG 49 KB | * Croatian Medical Association round seal, 'HRVATSKI LIJECNICKI ZBOR 1874' readable | LOGO; SMALL 332w |
| 18 | `Podrzavatelji_i_partneri/mehun.png` | 400x400 | 1.00 SQ | PNG 22 KB | * MEHUN abstract red/green circular mark - no organization name in art | LOGO; SMALL 400w; name NOT readable |
| 19 | `Podrzavatelji_i_partneri/mgb.png` | 1280x181 | 7.07 L | PNG 24 KB | * Mass General Brigham wordmark, readable | LOGO |
| 20 | `Podrzavatelji_i_partneri/mgh.png` | 1920x2241 | 0.86 P | PNG 179 KB | * Massachusetts General Hospital shield + name, readable | LOGO; tall 1920x2241 |
| 21 | `Podrzavatelji_i_partneri/poliklinika-aviva.png` | 346x151 | 2.29 L | PNG 11 KB | * Poliklinika Aviva logo - white lettering, invisible on light grounds | LOGO; SMALL 346w; needs dark chip |
| 22 | `Podrzavatelji_i_partneri/sredisnji-drzavni-ured.png` | 393x72 | 5.46 L | PNG 6 KB | * Croatian State Office for Croats Abroad - coat of arms + full name, tiny type | LOGO; SMALL 393x72 |
| 23 | `Podrzavatelji_i_partneri/tportal.png` | 374x108 | 3.46 L | PNG 9 KB | * tportal wordmark, readable | LOGO; SMALL 374w |
| 24 | `Podrzavatelji_i_partneri/tz-grada-splita.png` | 280x224 | 1.25 L | PNG 12 KB | * Visit Split - Split Tourist Board ribbon logo, readable | LOGO; SMALL 280w |
| 25 | `Podrzavatelji_i_partneri/tz-grada-zagreba.png` | 296x154 | 1.92 L | PNG 10 KB | * Zagreb Tourist Board logo (licitar hearts), readable | LOGO; SMALL 296w |
| 26 | `Podrzavatelji_i_partneri/tz-splitsko-dalmatinske-zupanije.png` | 600x287 | 2.09 L | PNG 21 KB | * Central Dalmatia (Split-Dalmatia County TB) logo, readable | LOGO; SMALL 600w |
| 27 | `Podrzavatelji_i_partneri/ucla-health.png` | 3840x839 | 4.58 L | PNG 52 KB | * UCLA Health wordmark, readable, wide 3840 px | LOGO |
| 28 | `Podrzavatelji_i_partneri/uhn.png` | 721x138 | 5.22 L | PNG 33 KB | * UHN (University Health Network) wordmark, readable | LOGO; SMALL 721w |

### 1_Plexus (99 images)

| # | File | Px | Aspect | Type / size | Description | Flags |
|---|------|----|--------|-------------|-------------|-------|
| 1 | `.DS_Store` | - | - | .DS_Store 10 KB | ~ macOS system file | NOT-PHOTO |
| 2 | `Plexus2022_dvorana-split.jpg` | 6422x4281 | 1.50 L | JPEG 4.3 MB | * Ornate white hall in Split from balcony: stage interview, red seats, HR+EU flags, med&X roll-up | HERO-GRADE |
| 3 | `Plexus2022_govornik.jpg` | 2500x1667 | 1.50 L | JPEG 282 KB | ~ Speaker on stage, Plexus 2022 Split |  |
| 4 | `Plexus2022_panel.jpg` | 2500x1667 | 1.50 L | JPEG 669 KB | ~ Panel discussion, Plexus 2022 Split |  |
| 5 | `Plexus2023_george-daley.jpg` | 6499x4333 | 1.50 L | JPEG 2.8 MB | * HMS Dean George Q. Daley on big screen (remote talk), purple-lit hall, Plexus banner |  |
| 6 | `Plexus2025_006_medx-roll-up-banner.jpg` | 5996x3989 | 1.50 L | JPEG 8.3 MB | * Close-up of med&X roll-up banner, blurred stage bokeh - brand detail |  |
| 7 | `Plexus2025_012_christos-christou-i-publika.jpg` | 5572x3707 | 1.50 L | JPEG 7.8 MB | ~ Christos Christou (MSF Intl President) with audience |  |
| 8 | `Plexus2025_013_govornik-na-pozornici.jpg` | 6048x4024 | 1.50 L | JPEG 11.3 MB | ~ Speaker on stage, Plexus 2025 |  |
| 9 | `Plexus2025_025_christos-christou-keynote-naslovnica.jpg` | 5799x3858 | 1.50 L | JPEG 5.4 MB | * B&W: title screen 'Christos Christou MD - Leadership Under Pressure' + med&x roll-up | B&W |
| 10 | `Plexus2025_029_publika-1.jpg` | 5597x3724 | 1.50 L | JPEG 9.0 MB | ~ Audience, Plexus 2025 |  |
| 11 | `Plexus2025_036_panel-diskusija.jpg` | 6048x4024 | 1.50 L | JPEG 10.2 MB | ~ Panel discussion, Plexus 2025 |  |
| 12 | `Plexus2025_039_govornik-u-publici.jpg` | 5683x3781 | 1.50 L | JPEG 9.3 MB | ~ Speaker taking audience question |  |
| 13 | `Plexus2025_045_govornica-plexus-banner.jpg` | 3844x5777 | 0.67 P | JPEG 6.6 MB | ~ Female speaker at lectern with Plexus banner (portrait) |  |
| 14 | `Plexus2025_054_puna-dvorana.jpg` | 6048x4024 | 1.50 L | JPEG 14.6 MB | * Full modern hall, audience member asking question at mic | HERO-GRADE |
| 15 | `Plexus2025_060_networking-portret-par.jpg` | 5656x3763 | 1.50 L | JPEG 9.6 MB | ~ Networking portrait, two attendees |  |
| 16 | `Plexus2025_068_networking-lampice.jpg` | 6048x4024 | 1.50 L | JPEG 8.5 MB | * Networking under warm string lights, smiling attendee center | HERO-GRADE |
| 17 | `Plexus2025_070_grupa-pod-lampicama.jpg` | 3627x5452 | 0.67 P | JPEG 9.0 MB | ~ Group under string lights (portrait) |  |
| 18 | `Plexus2025_074_govornik-plexus-banner.jpg` | 3534x5312 | 0.67 P | JPEG 7.2 MB | ~ Speaker beside Plexus banner (portrait) |  |
| 19 | `Plexus2025_077_govornica-sara-vidovic-trstic.jpg` | 5677x3777 | 1.50 L | JPEG 8.1 MB | ~ Sara Vidovic Trstic speaking at lectern |  |
| 20 | `Plexus2025_081_predavanje-i-publika.jpg` | 4361x2902 | 1.50 L | JPEG 5.7 MB | ~ Lecture with audience |  |
| 21 | `Plexus2025_087_dvorana-siroki-kadar.jpg` | 4830x3214 | 1.50 L | JPEG 10.4 MB | * Wide hall shot: speaker at lectern right w/ Plexus roll-up, audience left | HERO-GRADE |
| 22 | `Plexus2025_104_catering-slastice.jpg` | 5460x3633 | 1.50 L | JPEG 6.2 MB | ~ Catering desserts detail |  |
| 23 | `Plexus2025_116_networking-grupa-1.jpg` | 5956x3963 | 1.50 L | JPEG 7.4 MB | ~ Networking group 1 |  |
| 24 | `Plexus2025_122_networking-grupa-2.jpg` | 5863x3901 | 1.50 L | JPEG 8.0 MB | ~ Networking group 2 |  |
| 25 | `Plexus2025_133_networking-trio.jpg` | 6048x4024 | 1.50 L | JPEG 8.1 MB | ~ Networking, three attendees |  |
| 26 | `Plexus2025_141_networking-grupa-3.jpg` | 6048x4024 | 1.50 L | JPEG 8.4 MB | ~ Networking group 3 |  |
| 27 | `Plexus2025_152_networking-lampice-grupa.jpg` | 5726x3810 | 1.50 L | JPEG 8.2 MB | ~ Networking group under string lights |  |
| 28 | `Plexus2025_156_networking-par.jpg` | 5985x3982 | 1.50 L | JPEG 8.0 MB | ~ Networking, two attendees |  |
| 29 | `Plexus2025_158_networking-razgovor-troje.jpg` | 5827x3877 | 1.50 L | JPEG 6.6 MB | ~ Conversation, three attendees |  |
| 30 | `Plexus2025_175_plexus-registracijski-pult.jpg` | 5600x3726 | 1.50 L | JPEG 7.2 MB | ~ Plexus registration desk |  |
| 31 | `Plexus2025_180_govornik-esplanade-plexus.jpg` | 3638x5468 | 0.67 P | JPEG 9.4 MB | ~ Speaker at Esplanade with Plexus branding (portrait) |  |
| 32 | `Plexus2025_188_publika-esplanade.jpg` | 6048x4024 | 1.50 L | JPEG 10.2 MB | * Audience in ornate Esplanade room, warm tones |  |
| 33 | `Plexus2025_206_keynote-mihic.jpg` | 5900x3926 | 1.50 L | JPEG 9.1 MB | ~ Mihic keynote |  |
| 34 | `Plexus2025_209_publika-izbliza.jpg` | 6048x4024 | 1.50 L | JPEG 10.8 MB | ~ Audience close-up |  |
| 35 | `Plexus2025_227_govornica-plexus-banner-2.jpg` | 1971x2963 | 0.67 P | JPEG 2.7 MB | ~ Female speaker + Plexus banner (portrait, 1971w) |  |
| 36 | `Plexus2025_236_predavanje-plexus-banner.jpg` | 5815x3869 | 1.50 L | JPEG 11.5 MB | ~ Lecture with Plexus banner |  |
| 37 | `Plexus2025_246_christos-christou-medx-banner.jpg` | 5923x3941 | 1.50 L | JPEG 10.4 MB | * Christos Christou speaking beside med&X banner, Esplanade room |  |
| 38 | `Plexus2025_261_coffee-break-guzva.jpg` | 5914x3935 | 1.50 L | JPEG 9.0 MB | ~ Coffee-break crowd |  |
| 39 | `Plexus2025_264_razgovor-za-koktel-stolom.jpg` | 6048x4024 | 1.50 L | JPEG 9.5 MB | ~ Conversation at cocktail table |  |
| 40 | `Plexus2025_270_networking-uz-kavu.jpg` | 5701x3793 | 1.50 L | JPEG 9.4 MB | ~ Networking over coffee |  |
| 41 | `Plexus2025_277_networking-pauza.jpg` | 6048x4024 | 1.50 L | JPEG 13.5 MB | ~ Networking during break |  |
| 42 | `Plexus2025_292_portret-smijeh.jpg` | 6048x4024 | 1.50 L | JPEG 8.3 MB | ~ Attendee portrait, laughing |  |
| 43 | `Plexus2025_298_panel-tri-govornika.jpg` | 5774x3842 | 1.50 L | JPEG 10.9 MB | ~ Panel, three speakers |  |
| 44 | `Plexus2025_303_publika-2.jpg` | 6048x4024 | 1.50 L | JPEG 12.0 MB | ~ Audience 2 |  |
| 45 | `Plexus2025_305_panel-skugor-i-hank.jpg` | 5807x3864 | 1.50 L | JPEG 11.9 MB | ~ Panel with Mario Skugor and Hank |  |
| 46 | `Plexus2025_abraham-predavanje.jpg` | 5475x3643 | 1.50 L | JPEG 8.7 MB | ~ Abraham lecture, Plexus 2025 |  |
| 47 | `Plexus2025_britanski-ambasador-foto-zid.jpg` | 3933x5911 | 0.67 P | JPEG 12.8 MB | * Group of five with British Ambassador at med&X photo wall (portrait) |  |
| 48 | `Plexus2025_panel-glavni.jpg` | 5809x3865 | 1.50 L | JPEG 12.9 MB | * Four-person panel under 'Welcome to Gala Evening - Plexus Conference 2025' screen, Esplanade ballroom | HERO-GRADE; actually Gala-evening scene |
| 49 | `Plexus_arhiva_dan1-publika.jpg` | 6637x4425 | 1.50 L | JPEG 3.3 MB | ~ Archive: day-1 audience |  |
| 50 | `Plexus_arhiva_dan2-grupna.jpg` | 5717x3811 | 1.50 L | JPEG 4.2 MB | ~ Archive: day-2 group photo |  |
| 51 | `Plexus_arhiva_prezentacija-tko-smo-mi.jpg` | 2500x3750 | 0.67 P | JPEG 818 KB | ~ Archive: 'who we are' presentation (portrait) |  |
| 52 | `Plexus_britanski-ambasador-grupa.jpeg` | 1600x1199 | 1.33 L | JPEG 312 KB | ~ British Ambassador group (1600w) |  |
| 53 | `Plexus_networking-kurirano.jpg` | 5857x3897 | 1.50 L | JPEG 3.9 MB | ~ Curated networking shot |  |
| 54 | `Plexus_pozornica-ekran.png` | 1846x1062 | 1.74 L | PNG 4.1 MB | * Esplanade gala stage: moderator + remote speaker in white coat on screen, Plexus roll-up, Christmas tree | PNG still |
| 55 | `Plexus_prezentacija-kurirano.jpg` | 5959x3965 | 1.50 L | JPEG 5.2 MB | * Curated presentation shot | DUP=4_Biomedical_Forum/Forum_plexus-koristeno-u-pozivnici.jpg |
| 56 | `Plexus_publika-nyc.png` | 790x484 | 1.63 L | PNG 690 KB | * BB New York scene: audience on folding chairs, NYC-skyline TV (Croatian Consulate) | SMALL 790w; belongs to BB NYC |
| 57 | `Arhiva_Split/PlexusSplit_catering.jpg` | 2500x1667 | 1.50 L | JPEG 876 KB | ~ Split archive: catering |  |
| 58 | `Arhiva_Split/PlexusSplit_druzenje-u-podrumima.jpg` | 2500x1666 | 1.50 L | JPEG 958 KB | ~ Split archive: socializing in Diocletian basements |  |
| 59 | `Arhiva_Split/PlexusSplit_govornica-pozornica.jpg` | 2500x1667 | 1.50 L | JPEG 671 KB | ~ Split archive: lectern/stage |  |
| 60 | `Arhiva_Split/PlexusSplit_govornik-mikrofon.jpg` | 2500x3750 | 0.67 P | JPEG 1.3 MB | ~ Split archive: speaker with mic (portrait) |  |
| 61 | `Arhiva_Split/PlexusSplit_grupna-1.jpg` | 2500x1667 | 1.50 L | JPEG 764 KB | ~ Split archive: group photo 1 |  |
| 62 | `Arhiva_Split/PlexusSplit_grupna-2.jpg` | 2500x1667 | 1.50 L | JPEG 716 KB | ~ Split archive: group photo 2 |  |
| 63 | `Arhiva_Split/PlexusSplit_grupna-kamena-dvorana.jpg` | 2500x1667 | 1.50 L | JPEG 919 KB | ~ Split archive: group in stone hall |  |
| 64 | `Arhiva_Split/PlexusSplit_grupna-plexus-backdrop.jpg` | 2500x1667 | 1.50 L | JPEG 574 KB | * Five participants w/ badges before Plexus 'Split, Croatia' backdrop |  |
| 65 | `Arhiva_Split/PlexusSplit_grupna-sa-zastavama.jpg` | 2500x1667 | 1.50 L | JPEG 655 KB | ~ Split archive: group with flags |  |
| 66 | `Arhiva_Split/PlexusSplit_grupna-slavlje.jpg` | 2500x1667 | 1.50 L | JPEG 854 KB | ~ Split archive: celebration group |  |
| 67 | `Arhiva_Split/PlexusSplit_heldin-vodopivec-chalfie-mohr-u-splitu.jpeg` | 2500x3333 | 0.75 P | JPEG 1.7 MB | ~ Heldin, Vodopivec, Chalfie, Mohr in Split (portrait) |  |
| 68 | `Arhiva_Split/PlexusSplit_networking.jpg` | 2500x1667 | 1.50 L | JPEG 560 KB | ~ Split archive: networking |  |
| 69 | `Arhiva_Split/PlexusSplit_organizatori-i-prezenteri.jpg` | 2500x1667 | 1.50 L | JPEG 669 KB | ~ Split archive: organizers and presenters |  |
| 70 | `Arhiva_Split/PlexusSplit_panel-za-stolom.jpg` | 2500x1667 | 1.50 L | JPEG 449 KB | ~ Split archive: table panel |  |
| 71 | `Arhiva_Split/PlexusSplit_portret.jpg` | 1613x2420 | 0.67 P | JPEG 633 KB | ~ Split archive: attendee portrait (1613w) |  |
| 72 | `Arhiva_Split/PlexusSplit_pozornica-razgovor-1.jpg` | 2500x1667 | 1.50 L | JPEG 610 KB | ~ Split archive: stage conversation 1 |  |
| 73 | `Arhiva_Split/PlexusSplit_pozornica-razgovor-2.jpg` | 2500x1667 | 1.50 L | JPEG 478 KB | ~ Split archive: stage conversation 2 |  |
| 74 | `Arhiva_Split/PlexusSplit_predavanje.jpg` | 2500x1667 | 1.50 L | JPEG 459 KB | ~ Split archive: lecture |  |
| 75 | `Arhiva_Split/PlexusSplit_prezentacija-1.jpg` | 2500x1667 | 1.50 L | JPEG 401 KB | ~ Split archive: presentation |  |
| 76 | `Arhiva_Split/PlexusSplit_publika-crvena-sjedala.jpg` | 2500x1667 | 1.50 L | JPEG 635 KB | ~ Split archive: audience, red seats |  |
| 77 | `Arhiva_Split/Plexus_arhiva_dan1-publika-2.jpg` | 2500x1306 | 1.91 L | JPEG 505 KB | ~ Split archive: day-1 audience 2 (2500x1306) |  |
| 78 | `Govornici_portreti/Govornik_Abraham.jpg` | 352x469 | 0.75 P | JPEG 39 KB | * Abraham - full-body event snapshot (grey suit, bow tie, Plexus lanyard), NOT a headshot | SMALL 352w; crop weak |
| 79 | `Govornici_portreti/Govornik_Chalfie-Martin.png` | 492x490 | 1.00 SQ | PNG 199 KB | * Martin Chalfie (Nobel laureate 2008, Columbia) pro headshot | SMALL 492w |
| 80 | `Govornici_portreti/Govornik_Christou-Christos.png` | 474x714 | 0.66 P | PNG 509 KB | * Christos Christou (President, MSF International) editorial portrait | SMALL 474w |
| 81 | `Govornici_portreti/Govornik_Daley-George.png` | 492x490 | 1.00 SQ | PNG 221 KB | * George Q. Daley (Dean, Harvard Medical School) pro headshot | SMALL 492w |
| 82 | `Govornici_portreti/Govornik_DelCarmen.jpg` | 2200x2184 | 1.01 SQ | JPEG 633 KB | * Marcela del Carmen (President, MGH) white-coat portrait - high quality |  |
| 83 | `Govornici_portreti/Govornik_Heldin-Carl-Henrik.jpg` | 806x944 | 0.85 P | JPEG 133 KB | * Carl-Henrik Heldin (Uppsala; Nobel Foundation chair) headshot |  |
| 84 | `Govornici_portreti/Govornik_Kabrhel-Christopher.jpg` | 460x460 | 1.00 SQ | JPEG 35 KB | * Christopher Kabrhel (MGH) headshot | SMALL 460w |
| 85 | `Govornici_portreti/Govornik_Khatri-Jaikirshan.png` | 500x500 | 1.00 SQ | PNG 276 KB | * Jaikirshan Khatri headshot | SMALL 500w |
| 86 | `Govornici_portreti/Govornik_Langer-Robert.png` | 492x490 | 1.00 SQ | PNG 205 KB | * Robert Langer (MIT) headshot, QEPrize backdrop | SMALL 492w |
| 87 | `Govornici_portreti/Govornik_Lefkowitz-Robert.jpg` | 1200x1402 | 0.86 P | JPEG 223 KB | * Robert Lefkowitz (Nobel laureate 2012, Duke) warm studio headshot |  |
| 88 | `Govornici_portreti/Govornik_Luetic.jpg` | 432x576 | 0.75 P | JPEG 44 KB | * Kresimir Luetic - podium speech shot (ornate hall), not studio headshot | SMALL 432w |
| 89 | `Govornici_portreti/Govornik_Mihic.jpg` | 492x436 | 1.13 SQ | JPEG 29 KB | * Mihic holding trophy before WINNERS wall - casual video-still look | SMALL 492x436 |
| 90 | `Govornici_portreti/Govornik_Mohr-Catherine.png` | 492x490 | 1.00 SQ | PNG 154 KB | * Catherine Mohr studio portrait | SMALL 492w |
| 91 | `Govornici_portreti/Govornik_Nair-Ravi.jpg` | 235x235 | 1.00 SQ | JPEG 8 KB | * Ravi Nair (Cleveland Clinic) headshot | SMALL 235w - list size only |
| 92 | `Govornici_portreti/Govornik_Pusic-Martin.jpg` | 250x250 | 1.00 SQ | JPEG 10 KB | * Martin Pusic headshot | SMALL 250w - list size only |
| 93 | `Govornici_portreti/Govornik_Reic.jpeg` | 800x800 | 1.00 SQ | JPEG 116 KB | * Reic - professional female headshot | 800w borderline |
| 94 | `Govornici_portreti/Govornik_Rhew-David.jpg` | 1000x1010 | 0.99 SQ | JPEG 82 KB | * David Rhew (Global CMO, Microsoft) headshot |  |
| 95 | `Govornici_portreti/Govornik_Skugor-Mario.png` | 200x200 | 1.00 SQ | PNG 29 KB | * Mario Skugor (Cleveland Clinic) white-coat cutout headshot | SMALL 200w - list size only |
| 96 | `Govornici_portreti/Govornik_Smith-Finsbury.jpg` | 1200x800 | 1.50 L | JPEG 177 KB | * Lord (Chris) Smith of Finsbury in ceremonial robes, Cambridge Senate House - landscape | needs tight head crop |
| 97 | `Govornici_portreti/Govornik_Smith-George-P.jpg` | 300x300 | 1.00 SQ | JPEG 16 KB | * George P. Smith (Nobel laureate 2018) headshot | SMALL 300w - list size only |
| 98 | `Govornici_portreti/Govornik_Smith-Kevin.jpg` | 2200x1466 | 1.50 L | JPEG 509 KB | * Kevin Smith (President and CEO, UHN) seated portrait - high quality, landscape |  |
| 99 | `Govornici_portreti/Govornik_Spisso.jpg` | 1466x2200 | 0.67 P | JPEG 837 KB | * Johnese Spisso (President, UCLA Health) portrait - high quality |  |
| 100 | `Govornici_portreti/Govornik_Swaminathan-Soumya.jpg` | 482x528 | 0.91 SQ | JPEG 42 KB | * Soumya Swaminathan (former WHO Chief Scientist), flags backdrop; thin black frame edges | SMALL 482w |

### 2_Gala (65 images)

| # | File | Px | Aspect | Type / size | Description | Flags |
|---|------|----|--------|-------------|-------------|-------|
| 1 | `Gala2025_323_foto-zid-par.jpg` | 3748x5633 | 0.67 P | JPEG 10.2 MB | ~ Photo-wall couple (portrait) |  |
| 2 | `Gala2025_326_foto-zid-crvena-haljina.jpg` | 3764x5657 | 0.67 P | JPEG 8.2 MB | ~ Photo wall, red dress (portrait) |  |
| 3 | `Gala2025_329_grupa-uz-bozicno-drvce.jpg` | 3754x5642 | 0.67 P | JPEG 10.6 MB | ~ Group by Christmas tree (portrait) |  |
| 4 | `Gala2025_332_kuvert-detalj.jpg` | 6048x4024 | 1.50 L | JPEG 9.9 MB | ~ Place-setting detail |  |
| 5 | `Gala2025_342_emerald-dvorana-siroko.jpg` | 5800x3859 | 1.50 L | JPEG 17.1 MB | * Emerald Ballroom (Esplanade) wide symmetric: set tables, red uplights, dome | HERO-GRADE; best ballroom shot |
| 6 | `Gala2025_344_dvorana-plexus-banner.jpg` | 6048x4024 | 1.50 L | JPEG 19.0 MB | ~ Ballroom with Plexus banner |  |
| 7 | `Gala2025_347_dvorana-plexus-2.jpg` | 6048x4024 | 1.50 L | JPEG 18.6 MB | ~ Ballroom with Plexus banner 2 |  |
| 8 | `Gala2025_349_pozornica-plexus-banner.jpg` | 5939x3951 | 1.50 L | JPEG 18.4 MB | * Gala stage with prominent Plexus roll-up, empty set ballroom | HERO-GRADE |
| 9 | `Gala2025_371_abraham-steffen-hank-skugor.jpg` | 4739x3153 | 1.50 L | JPEG 8.2 MB | ~ Abraham, Steffen, Hank, Skugor at gala |  |
| 10 | `Gala2025_400_foto-zid-grupa.jpg` | 5218x3472 | 1.50 L | JPEG 10.4 MB | ~ Photo-wall group |  |
| 11 | `Gala2025_409_grupa-dama.jpg` | 5000x3327 | 1.50 L | JPEG 9.7 MB | ~ Group of ladies |  |
| 12 | `Gala2025_412_koktel-recepcija.jpg` | 5438x3618 | 1.50 L | JPEG 9.9 MB | * Crowded cocktail reception, warm light |  |
| 13 | `Gala2025_425_recepcija-siroko.jpg` | 6048x4024 | 1.50 L | JPEG 14.9 MB | ~ Reception wide |  |
| 14 | `Gala2025_433_recepcija-guzva.jpg` | 5857x3897 | 1.50 L | JPEG 13.2 MB | * Reception crowd | DUP=4_Biomedical_Forum/Forum_networking-koristeno-u-pozivnici.jpg |
| 15 | `Gala2025_445_kuvert-s-menijem.jpg` | 5506x3663 | 1.50 L | JPEG 11.4 MB | ~ Place setting with menu |  |
| 16 | `Gala2025_446_dvorana-se-puni.jpg` | 6001x3993 | 1.50 L | JPEG 18.6 MB | ~ Ballroom filling up |  |
| 17 | `Gala2025_447_gosti-za-stolom-1.jpg` | 4574x3043 | 1.50 L | JPEG 10.4 MB | ~ Guests at table 1 |  |
| 18 | `Gala2025_449_dvorana-siroko-2.jpg` | 5667x3770 | 1.50 L | JPEG 17.5 MB | ~ Ballroom wide 2 |  |
| 19 | `Gala2025_452_gosti-i-arhitektura-dvorane.jpg` | 6048x4024 | 1.50 L | JPEG 20.3 MB | ~ Guests + ballroom architecture |  |
| 20 | `Gala2025_468_puna-dvorana-s-pozornice.jpg` | 5384x3582 | 1.50 L | JPEG 16.0 MB | * Full gala ballroom seen from stage during dinner | HERO-GRADE |
| 21 | `Gala2025_477_dvorana-i-podij.jpg` | 5908x3931 | 1.50 L | JPEG 17.9 MB | * Ballroom and podium |  |
| 22 | `Gala2025_489_luetic-govor-plexus-ekran.jpg` | 5897x3924 | 1.50 L | JPEG 10.4 MB | ~ Kresimir Luetic speech, Plexus screen |  |
| 23 | `Gala2025_493_domacini-medx-banner.jpg` | 6048x4024 | 1.50 L | JPEG 14.0 MB | ~ Hosts at med&X banner |  |
| 24 | `Gala2025_501_gosti-za-stolom-2.jpg` | 6048x4024 | 1.50 L | JPEG 12.3 MB | ~ Guests at table 2 |  |
| 25 | `Gala2025_512_plexus-ekran-i-dvorana.jpg` | 5975x3975 | 1.50 L | JPEG 13.8 MB | ~ Plexus screen + ballroom |  |
| 26 | `Gala2025_517_plexus-ekran-govornik.jpg` | 5906x3930 | 1.50 L | JPEG 10.2 MB | ~ Speaker at Plexus screen |  |
| 27 | `Gala2025_526_gosti-smijeh.jpg` | 5955x3962 | 1.50 L | JPEG 11.8 MB | ~ Guests laughing |  |
| 28 | `Gala2025_533_networking-gala.jpg` | 4878x3246 | 1.50 L | JPEG 8.2 MB | ~ Gala networking |  |
| 29 | `Gala2025_541_kanapei-detalj.jpg` | 5023x3342 | 1.50 L | JPEG 7.1 MB | ~ Canape detail |  |
| 30 | `Gala2025_545_pozornica-sponzorski-ekran.jpg` | 5557x3697 | 1.50 L | JPEG 10.1 MB | ~ Stage with sponsor screen |  |
| 31 | `Gala2025_549_gala-panel-cetiri-govornika.jpg` | 5885x3916 | 1.50 L | JPEG 13.5 MB | ~ Gala panel, four speakers |  |
| 32 | `Gala2025_557_panel-izbliza.jpg` | 5846x3890 | 1.50 L | JPEG 10.2 MB | ~ Panel close-up |  |
| 33 | `Gala2025_561_sponzorski-ekran-dvorana.jpg` | 5794x3855 | 1.50 L | JPEG 12.7 MB | ~ Sponsor screen + ballroom |  |
| 34 | `Gala2025_569_puna-dvorana-2.jpg` | 5872x3907 | 1.50 L | JPEG 16.8 MB | ~ Full ballroom 2 |  |
| 35 | `Gala2025_575_dodjela-priznanja.jpg` | 5863x3901 | 1.50 L | JPEG 18.7 MB | * Recognition award handover (framed artwork) in ballroom |  |
| 36 | `Gala2025_583_panel-pet-govornika.jpg` | 6048x4024 | 1.50 L | JPEG 14.5 MB | ~ Gala panel, five speakers |  |
| 37 | `Gala2025_585_govornica-s-mikrofonom.jpg` | 1623x2439 | 0.67 P | JPEG 2.3 MB | ~ Female speaker with mic (portrait, 1623w) |  |
| 38 | `Gala2025_588_panel-plexus-banner.jpg` | 5888x3918 | 1.50 L | JPEG 13.1 MB | ~ Panel with Plexus banner |  |
| 39 | `Gala2025_598_buffet-detalj.jpg` | 5990x3985 | 1.50 L | JPEG 10.7 MB | ~ Buffet detail |  |
| 40 | `Gala2025_610_govornik-medx-podij.jpg` | 5732x3814 | 1.50 L | JPEG 11.8 MB | ~ Speaker at med&X podium |  |
| 41 | `Gala2025_617_plexus-ekran-pozornica.jpg` | 6048x4024 | 1.50 L | JPEG 12.7 MB | ~ Plexus screen + stage |  |
| 42 | `Gala2025_623_gosti-portret-za-stolom.jpg` | 3903x2597 | 1.50 L | JPEG 7.8 MB | ~ Guests portrait at table |  |
| 43 | `Gala2025_629_nazdravljanje-za-stolom.jpg` | 5987x3983 | 1.50 L | JPEG 18.0 MB | ~ Toast at table |  |
| 44 | `Gala2025_631_velika-grupna-1.jpg` | 5670x3773 | 1.50 L | JPEG 17.3 MB | ~ Large group photo 1 |  |
| 45 | `Gala2025_638_velika-grupna-2-glavna.jpg` | 5733x3814 | 1.50 L | JPEG 17.5 MB | * MAIN large group (~18 speakers+team incl. Swaminathan) under Gala welcome screen |  |
| 46 | `Gala2025_645_gosti-uz-plexus-banner.jpg` | 3733x5611 | 0.67 P | JPEG 15.8 MB | ~ Guests by Plexus banner (portrait) |  |
| 47 | `Gala2025_656_organizacijski-odbor-bozicno-drvce.jpg` | 5817x3870 | 1.50 L | JPEG 16.0 MB | ~ Organizing committee by Christmas tree |  |
| 48 | `Gala2025_dvorana-kurirano-1.jpg` | 5959x3965 | 1.50 L | JPEG 18.0 MB | * Curated ballroom shot 1 | DUP=4_Biomedical_Forum/Forum_gala-govornik-koristeno-u-pozivnici.jpg |
| 49 | `Gala2025_dvorana-kurirano-2.jpg` | 5732x3814 | 1.50 L | JPEG 15.8 MB | ~ Curated ballroom shot 2 |  |
| 50 | `Gala2025_tom-govor.jpg` | 5876x3910 | 1.50 L | JPEG 19.1 MB | * Gala dinner, remote keynote (white coat) on screen ('Tom' speech) |  |
| 51 | `Gala_Esplanade_smaragdna-dvorana.jpg` | 2500x1407 | 1.78 L | JPEG 486 KB | * Emerald Ballroom promo: blue-lit dome, set tables, stage (venue press style) |  |
| 52 | `Gala_Split_dioklecijanovi-podrumi.jpg` | 2500x1667 | 1.50 L | JPEG 1023 KB | * Large colorful group, Diocletian's Palace basements, purple/green uplights |  |
| 53 | `Gala_Split_velika-grupna.webp` | 2500x1667 | 1.50 L | WEBP 911 KB | * Near-same Split basements group, wider frame | WEBP convert; NEAR-DUP of dioklecijanovi-podrumi |
| 54 | `Gala_arhiva_dvorana-1.jpeg` | 2500x1667 | 1.50 L | JPEG 979 KB | ~ Archive gala hall |  |
| 55 | `Gala_arhiva_gosti-portret-2.jpg` | 2500x1667 | 1.50 L | JPEG 631 KB | ~ Archive guests portrait 2 |  |
| 56 | `Gala_arhiva_gosti-portret.jpeg` | 2500x1667 | 1.50 L | JPEG 613 KB | ~ Archive guests portrait |  |
| 57 | `Gala_arhiva_govornik.jpg` | 2500x1667 | 1.50 L | JPEG 356 KB | ~ Archive gala speaker |  |
| 58 | `Gala_arhiva_medx-ekran-dvorana.jpeg` | 2500x1667 | 1.50 L | JPEG 689 KB | ~ Archive med&X screen + hall |  |
| 59 | `Gala_dvorana-kurirano-3.jpg` | 5984x3981 | 1.50 L | JPEG 4.8 MB | ~ Curated ballroom shot 3 |  |
| 60 | `Gala_dvorana-kurirano-4.png` | 1994x1324 | 1.51 L | PNG 5.8 MB | ~ Curated ballroom shot 4 (PNG, 1994w) | PNG - convert to JPG |
| 61 | `Gala_dvorana-kurirano-5.jpg` | 1200x500 | 2.40 L | JPEG 188 KB | * Pre-cropped wide strip: gala dinner + Plexus screen (1200x500) | STRIP only |
| 62 | `Gala_foto-zid-grupa-kurirano.jpg` | 5120x3413 | 1.50 L | JPEG 1.2 MB | ~ Curated photo-wall group |  |
| 63 | `Gala_nastup-ante-gelo.jpg` | 645x645 | 1.00 SQ | JPEG 61 KB | * Ante Gelo (guitarist, gala performer) studio headshot | SMALL 645w |
| 64 | `Gala_nastup-tajci.jpg` | 600x600 | 1.00 SQ | JPEG 83 KB | * Tajci (Tatjana Cameron) singing at mic - performer press photo | SMALL 600w |
| 65 | `Gala_stol-gosti.png` | 510x352 | 1.45 L | PNG 394 KB | * Guests at gala table no. 10 | SMALL 510w; PNG |

### 3_Accelerator (47 images)

| # | File | Px | Aspect | Type / size | Description | Flags |
|---|------|----|--------|-------------|-------------|-------|
| 1 | `Accelerator_MGH-natpis.jpeg` | 5120x3840 | 1.33 L | JPEG 2.8 MB | * Participant at MASSACHUSETTS GENERAL HOSPITAL fence sign |  |
| 2 | `Accelerator_cleveland-clinic-1.jpg` | 2500x1875 | 1.33 L | JPEG 1.1 MB | ~ Cleveland Clinic visit 1 |  |
| 3 | `Accelerator_cleveland-clinic-2.jpg` | 2040x1530 | 1.33 L | JPEG 451 KB | ~ Cleveland Clinic visit 2 |  |
| 4 | `Accelerator_cleveland-clinic-3.jpg` | 1440x1920 | 0.75 P | JPEG 716 KB | * Participant in scrubs at Cleveland Clinic sign + reflecting pool (portrait) |  |
| 5 | `Accelerator_harvard-kampus-1.jpg` | 2016x1512 | 1.33 L | JPEG 239 KB | * STANFORD Main Quad / Memorial Church - NOT Harvard despite filename | MISLABELED |
| 6 | `Accelerator_harvard-kampus-2.jpg` | 1512x2016 | 0.75 P | JPEG 938 KB | ~ 'Harvard campus 2' (portrait) - verify location before captioning | verify vs kampus-1 mislabel |
| 7 | `Accelerator_lab-dvije-polaznice.jpeg` | 1978x4284 | 0.46 P | JPEG 807 KB | * Dejana V. (3M lab coat) + colleague in lab - very tall thin crop | extreme 1:2.2 crop |
| 8 | `Accelerator_mgh-yawkey-center.jpg` | 2500x3333 | 0.75 P | JPEG 1.1 MB | * Participant at MGH Yawkey Center entrance (portrait) |  |
| 9 | `Accelerator_panel-na-gali-2025.jpg` | 6048x4024 | 1.50 L | JPEG 21.2 MB | * Accelerator alumni panel of six on Gala 2025 stage, lab photo on screen |  |
| 10 | `Accelerator_polaznice-institucija-1.jpg` | 2500x3333 | 0.75 P | JPEG 963 KB | ~ Participants at institution (portrait) |  |
| 11 | `Accelerator_polaznice-kampus.jpg` | 2500x3333 | 0.75 P | JPEG 1.9 MB | ~ Participants on campus (portrait) |  |
| 12 | `Accelerator_polaznici-ispred-zgrade.jpg` | 1440x1920 | 0.75 P | JPEG 573 KB | * Two participants at Whitehead Institute (MIT) entrance (portrait) |  |
| 13 | `Accelerator_portret-polaznice.jpg` | 1512x2016 | 0.75 P | JPEG 240 KB | * Studio-grade participant portrait, warm beige backdrop, crossed arms | best cohort portrait |
| 14 | `Accelerator_radionica-stolovi-1.jpg` | 2500x1667 | 1.50 L | JPEG 924 KB | * Plexus-branded coffee-break buffet with students - catering, not workshop | MISLABELED (catering) |
| 15 | `Accelerator_sara-lab-1.jpg` | 4000x3000 | 1.33 L | JPEG 4.3 MB | * Sara + two colleagues (white coat/scrubs) in US hospital workroom |  |
| 16 | `Accelerator_sara-lab-2.jpg` | 4000x3000 | 1.33 L | JPEG 6.0 MB | ~ Sara lab 2 |  |
| 17 | `Accelerator_yale-backdrop.jpeg` | 1600x1200 | 1.33 L | JPEG 177 KB | * Stela Lara Tensek at Yale RULER 2025 conference backdrop (badge readable) |  |
| 18 | `Institucija_Cleveland-Clinic-polaznici.webp` | 2500x1875 | 1.33 L | WEBP 1.0 MB | * Two participants in white coats at Cleveland Clinic sign + pool | WEBP convert |
| 19 | `Institucija_Cleveland-Clinic.webp` | 1000x525 | 1.90 L | WEBP 133 KB | ~ Cleveland Clinic building | WEBP convert; SMALL 1000w |
| 20 | `Institucija_Columbia.webp` | 750x563 | 1.33 L | WEBP 61 KB | ~ Columbia University | WEBP convert; SMALL 750w |
| 21 | `Institucija_Harvard-zgrada.jpg` | 1253x659 | 1.90 L | WEBP 284 KB | ~ Harvard building - file is WEBP with .jpg extension | EXT-MISMATCH WEBP; convert |
| 22 | `Institucija_Harvard.webp` | 1000x526 | 1.90 L | WEBP 185 KB | * HMS Gordon Hall quad, autumn, Harvard flag - clean card image | WEBP convert |
| 23 | `Institucija_Kings-College.webp` | 750x500 | 1.50 L | WEBP 107 KB | ~ King's College London | WEBP convert; SMALL 750w |
| 24 | `Institucija_MGH-zgrada.jpg` | 1280x995 | 1.29 L | WEBP 218 KB | ~ MGH building - file is WEBP with .jpg extension | EXT-MISMATCH WEBP; convert |
| 25 | `Institucija_MGH.webp` | 750x583 | 1.29 L | WEBP 98 KB | ~ MGH | WEBP convert; SMALL 750w |
| 26 | `Institucija_Mayo-Clinic.webp` | 612x408 | 1.50 L | WEBP 81 KB | * Mayo Clinic Gonda Building entrance sign (stock-style) | WEBP convert; SMALL 612w |
| 27 | `Institucija_Osaka-1.webp` | 1000x1333 | 0.75 P | WEBP 297 KB | * Croatian delegation of six at Expo 2025 Osaka cable-art installation (portrait) | WEBP convert; NEAR-DUP of Forum_delegacija |
| 28 | `Institucija_Osaka-panel.webp` | 1600x1200 | 1.33 L | WEBP 271 KB | * Croatian panel at Expo 2025 Osaka Theme Weeks studio (name cards readable) | WEBP convert |
| 29 | `Institucija_Yale.webp` | 1000x571 | 1.75 L | WEBP 105 KB | ~ Yale University | WEBP convert; SMALL 1000w |
| 30 | `Polaznici_portreti/Alumni_Dejana-Vujnovic.jpg` | 880x880 | 1.00 SQ | JPEG 113 KB | * Dejana Vujnovic - extreme close selfie/video still, casual | avatar-size only |
| 31 | `Polaznici_portreti/Alumni_Dora-Softic.jpg` | 880x880 | 1.00 SQ | JPEG 100 KB | * Dora Softic - tilted home selfie, casual | avatar-size only |
| 32 | `Polaznici_portreti/Alumni_Filip-Klisovic.jpg` | 880x880 | 1.00 SQ | JPEG 113 KB | * Filip Klisovic - low-angle selfie w/ earbuds, white coat | avatar-size only |
| 33 | `Polaznici_portreti/Alumni_Gracia-Grabaric.jpg` | 880x880 | 1.00 SQ | JPEG 175 KB | * Gracia Grabaric - outdoor portrait at stone building steps, decent casual |  |
| 34 | `Polaznici_portreti/Alumni_Karlo-Duzevic.jpg` | 880x880 | 1.00 SQ | JPEG 103 KB | * Karlo Duzevic - outdoor half-portrait at building entrance, good casual |  |
| 35 | `Polaznici_portreti/Alumni_Katarina-Kordic.jpg` | 896x896 | 1.00 SQ | JPEG 55 KB | * Katarina Kordic - clean white-shirt studio-look portrait (slightly smoothed) |  |
| 36 | `Polaznici_portreti/Alumni_Lucija-Skejic.jpg` | 2500x1667 | 1.50 L | JPEG 299 KB | * Lucija Skejic - professional portrait in glass skywalk corridor (landscape) - best alumni shot | crop to square |
| 37 | `Polaznici_portreti/Alumni_Marko-Gavrancic.jpg` | 880x880 | 1.00 SQ | JPEG 100 KB | * Marko Gavrancic - outdoor selfie at hospital EMERGENCY entrance | avatar-size only |
| 38 | `Polaznici_portreti/Alumni_Matea-Bagaric.jpg` | 880x880 | 1.00 SQ | JPEG 100 KB | * Matea Bagaric - outdoor casual, large sunglasses on | sunglasses; avatar-size only |
| 39 | `Polaznici_portreti/Alumni_Sara-Bonet.jpg` | 880x880 | 1.00 SQ | JPEG 80 KB | * Sara Bonet - close crop, red glasses, head slightly cut | avatar-size only |
| 40 | `Polaznici_portreti/Alumni_Stela-Tensek.jpg` | 880x880 | 1.00 SQ | JPEG 154 KB | * Stela Tensek - outdoor natural-light close portrait, good casual |  |
| 41 | `Polaznici_portreti/Alumni_Vinka-Potocki.jpg` | 880x880 | 1.00 SQ | JPEG 244 KB | * Vinka Potocki - selfie w/ King's College staff lanyard, second person at edge | edge intrusion; avatar-size |
| 42 | `Polaznici_portreti/Kohorta_Dominik-Lukicic.jpg` | 1100x1375 | 0.80 P | JPEG 167 KB | * Dominik Lukicic - quality indoor portrait, blurred lobby |  |
| 43 | `Polaznici_portreti/Kohorta_Eva-Knezevic.jpg` | 2500x3177 | 0.79 P | JPEG 835 KB | * Eva Knezevic - dim warm indoor selfie | avatar-size only |
| 44 | `Polaznici_portreti/Kohorta_Lara-Stricak.jpg` | 1100x1375 | 0.80 P | JPEG 127 KB | * Lara Stricak - clean studio white-bg portrait, black sweater - professional |  |
| 45 | `Polaznici_portreti/Kohorta_Lucija-Falamic.jpg` | 758x890 | 0.85 P | JPEG 83 KB | * Lucija Falamic - cafe window portrait, bystander visible | SMALL 758w |
| 46 | `Polaznici_portreti/Kohorta_Luka-Horvat.png` | 600x600 | 1.00 SQ | PNG 318 KB | * Luka Horvat - passport-style studio headshot on white | SMALL 600w; PNG |
| 47 | `Polaznici_portreti/Kohorta_Petra-Bolt.jpg` | 1100x1375 | 0.80 P | JPEG 349 KB | * Petra Bolt - bright selfie, curly hair | avatar-size only |

### 4_Biomedical_Forum (13 images)

| # | File | Px | Aspect | Type / size | Description | Flags |
|---|------|----|--------|-------------|-------------|-------|
| 1 | `Forum_alen-prezentira.jpg` | 1152x2048 | 0.56 P | JPEG 215 KB | * Alen Juginovic presenting 'Where it all started' slide, dim seminar room (portrait) | DUP=5_Building_Bridges/BB_prezentacija-alen.jpg |
| 2 | `Forum_delegacija.webp` | 1200x1600 | 0.75 P | WEBP 404 KB | * Croatian delegation of six, Expo 2025 Osaka installation (portrait) | WEBP convert; NEAR-DUP of Institucija_Osaka-1 |
| 3 | `Forum_gala-govornik-koristeno-u-pozivnici.jpg` | 5959x3965 | 1.50 L | JPEG 18.0 MB | * Gala ballroom scene (used in Forum invitation) | DUP=2_Gala/Gala2025_dvorana-kurirano-1.jpg |
| 4 | `Forum_gala-vecer-koristeno-u-pozivnici.jpg` | 5984x3981 | 1.50 L | JPEG 17.1 MB | * Full red-lit Emerald Ballroom w/ Plexus screen at dinner (invitation image) | HERO-GRADE |
| 5 | `Forum_headshot-laura.jpg` | 3328x4660 | 0.71 P | JPEG 6.0 MB | * Laura Rodman - professional studio headshot, white blazer (portrait) | excellent |
| 6 | `Forum_logo.png` | 1280x720 | 1.78 L | PNG 89 KB | * Biomedical Forum logo | NOT-PHOTO; DUP=0_Logotipovi/Logo_Biomedical-Forum.png |
| 7 | `Forum_london-panel-koristeno-u-pozivnici.jpg` | 1152x2048 | 0.56 P | JPEG 286 KB | * Three-person BB panel at Croatian Embassy London (UK/HR/EU flags), portrait | DUP=5_Building_Bridges/BB_London_panel.jpg |
| 8 | `Forum_ministarstvo-zdravstva.png` | 550x716 | 0.77 P | PNG 518 KB | * Alen + official at Croatian Ministry of Health press wall (portrait) | SMALL 550w; PNG |
| 9 | `Forum_networking-koristeno-u-pozivnici.jpg` | 5857x3897 | 1.50 L | JPEG 13.2 MB | * Gala reception crowd (invitation image) | DUP=2_Gala/Gala2025_433_recepcija-guzva.jpg |
| 10 | `Forum_networking-razgovor.png` | 942x1274 | 0.74 P | PNG 1.6 MB | * Four dignitaries in evening-reception conversation, warm lounge (portrait) | PNG 942w |
| 11 | `Forum_plexus-koristeno-u-pozivnici.jpg` | 5959x3965 | 1.50 L | JPEG 5.2 MB | * Curated Plexus presentation shot (invitation image) | DUP=1_Plexus/Plexus_prezentacija-kurirano.jpg |
| 12 | `Forum_portret-alen-bw.jpg` | 1002x1337 | 0.75 P | WEBP 106 KB | * Alen Juginovic B&W editorial portrait (glasses, plaid suit) - WEBP with .jpg extension | EXT-MISMATCH WEBP; B&W |
| 13 | `Forum_s-premijerom.png` | 482x606 | 0.80 P | PNG 470 KB | * Alen shaking hands with Croatian PM Andrej Plenkovic | SMALL 482w; PNG |

### 5_Building_Bridges (27 images)

| # | File | Px | Aspect | Type / size | Description | Flags |
|---|------|----|--------|-------------|-------------|-------|
| 1 | `BB_2026-06-09_grupna.jpg` | 1600x920 | 1.74 L | JPEG 286 KB | * Zurich edition (9 Jun 2026): big waving group, ornate Zunfthaus guild hall, med& totes | Zurich; 1600w min-hero |
| 2 | `BB_2026-06-09_medx-ekran-govornik.jpg` | 1600x1200 | 1.33 L | JPEG 234 KB | * Miro Vukovic speaking at Zurich guild-hall podium, med&X slide on screen | Zurich |
| 3 | `BB_2026-06-09_networking.jpg` | 1600x1200 | 1.33 L | JPEG 329 KB | ~ Zurich edition networking | Zurich |
| 4 | `BB_2026-06-09_publika.jpg` | 1600x1200 | 1.33 L | JPEG 388 KB | ~ Zurich edition audience | Zurich |
| 5 | `BB_Boston_HMS-Gordon-Hall-1.jpg` | 2480x3508 | 0.71 P | JPEG 2.2 MB | * HMS Gordon Hall facade w/ crowd on steps (portrait) | Boston venue |
| 6 | `BB_Boston_HMS-Gordon-Hall-2.jpg` | 2480x3508 | 0.71 P | JPEG 2.3 MB | ~ HMS Gordon Hall (portrait) 2 | Boston venue |
| 7 | `BB_Boston_HMS-detalj.jpg` | 3000x4000 | 0.75 P | JPEG 1.8 MB | ~ HMS architectural detail (portrait) | Boston venue |
| 8 | `BB_Boston_HMS-jesen.jpg` | 1680x627 | 2.68 L | JPEG 421 KB | * HMS Gordon Hall autumn wide strip (1680x627) | Boston venue; STRIP |
| 9 | `BB_Boston_HMS-quad.jpg` | 3840x2880 | 1.33 L | JPEG 1.8 MB | * HMS Gordon Hall from quad, summer, US flag - clean venue shot | Boston venue |
| 10 | `BB_London_grupa-sa-zastavama.jpeg` | 750x1333 | 0.56 P | JPEG 182 KB | * Five organizers at Croatian Embassy London, flags + blue backdrop (portrait) | SMALL 750w; NEAR-DUP of BB_London_grupa |
| 11 | `BB_London_grupa.jpg` | 900x1600 | 0.56 P | JPEG 251 KB | * Same London five-person embassy group, better frame (portrait) | London |
| 12 | `BB_London_panel.jpg` | 1152x2048 | 0.56 P | JPEG 286 KB | * Three-person panel, Croatian Embassy London, UK/HR/EU flags (portrait) | London; DUP=Forum_london-panel |
| 13 | `BB_NYC_konferencija.jpeg` | 5120x3840 | 1.33 L | JPEG 1.3 MB | * Croatian Consulate NYC roundtable: 3 seated panelists + presenter, consulate roll-up | New York |
| 14 | `BB_NYC_networking.jpg` | 4032x3024 | 1.33 L | JPEG 1.5 MB | ~ NYC edition networking | New York |
| 15 | `BB_NYC_panel.jpg` | 5120x3840 | 1.33 L | JPEG 1.8 MB | * NYC roundtable wide: screen 'importance of international collaboration...', speakers incl. Miro Vukovic, Marija Pranjic (Harvard), Martina (Yale) | New York |
| 16 | `BB_NYC_prezentacija.jpg` | 4032x3024 | 1.33 L | JPEG 1.4 MB | ~ NYC edition presentation | New York |
| 17 | `BB_Washington_grupna.jpeg` | 1024x768 | 1.33 L | JPEG 101 KB | * Full group (~30) in Croatian Embassy DC salon under chandelier | Washington; SMALL-ish 1024w |
| 18 | `BB_Washington_veleposlanstvo-sala-1.jpeg` | 1600x1764 | 0.91 SQ | JPEG 440 KB | ~ Embassy DC salon 1 (portrait-ish) | Washington |
| 19 | `BB_Washington_veleposlanstvo-sala-2.jpeg` | 1500x2000 | 0.75 P | JPEG 437 KB | * Ambassador speaking at Embassy DC roundtable; slide dates edition 29 Apr 2026 (Prof. Drenjancevic) | Washington |
| 20 | `BB_Washington_veleposlanstvo-sala-3.jpeg` | 1600x1200 | 1.33 L | JPEG 336 KB | ~ Embassy DC salon 3 | Washington |
| 21 | `BB_Washington_veleposlanstvo.jpg` | 1920x1511 | 1.27 L | JPEG 1.1 MB | * Croatian Embassy Washington DC exterior with Mestrovic sculpture + flag | Washington |
| 22 | `BB_headshot-miro.jpg` | 2048x1365 | 1.50 L | JPEG 215 KB | * Miro Vukovic - professional headshot in glass skywalk corridor (landscape) | excellent; crop to square/4:5 |
| 23 | `BB_logo.png` | 1667x322 | 5.18 L | PNG 99 KB | * Building Bridges logo | NOT-PHOTO; DUP=0_Logotipovi/Logo_Building-Bridges.png |
| 24 | `BB_medx-networking.jpg` | 760x760 | 1.00 SQ | JPEG 171 KB | * Young attendees at Plexus-branded buffet (square) - Plexus scene filed under BB | SMALL 760w |
| 25 | `BB_medx-panel-traka.jpg` | 1680x400 | 4.20 L | JPEG 151 KB | * Wide strip: med&X fireside chat on wood-paneled concert-hall stage, HR/EU flags (1680x400) | STRIP |
| 26 | `BB_panel-traka-2.jpg` | 1200x500 | 2.40 L | JPEG 133 KB | * Wide strip: four-speaker gala panel with Plexus roll-up, gilded ballroom (1200x500) | STRIP |
| 27 | `BB_prezentacija-alen.jpg` | 1152x2048 | 0.56 P | JPEG 215 KB | * Alen presenting (portrait) | DUP=4_Biomedical_Forum/Forum_alen-prezentira.jpg |

Totals: 0_Logotipovi: 27 · 1_Plexus: 99 · 2_Gala: 65 · 3_Accelerator: 47 · 4_Biomedical_Forum: 13 · 5_Building_Bridges: 27 · grand total 278 images.

---

## 2. Placement plan

Upload mechanisms referenced below (verified in code, NOT used during this task):
- **U1 Generic admin upload** - `POST /api/upload/:type` (admin auth) -> returns an `/uploads/...` path (admin-portal/backend/server.js:19100). Static portal-chrome images instead ship in `user-portal/frontend-v2/assets/` at deploy.
- **U2 Plexus/Gala photo gallery** - `POST /api/v2/plexus/photos` (adminOnly) `{ file_path, title?, description?, photographer?, sort_order?, is_public? }` -> `conference_photos`; `DELETE /api/v2/plexus/photos/:id` (user-portal/backend/v2/plexus.js:215).
- **U3 Bridges editions** - `v2_bridges_editions.photos_json` = array of `{ url, caption }` (max 40) per edition, patched via the bridges admin endpoints; files first uploaded via U1 (user-portal/backend/v2/bridges.js).
- **U4 Speakers** - `speakers.photo_url` via the admin Plexus Speakers manager (incl. per-speaker send-upload-link); institution logo via `PUT /api/v2/plexus/speakers/:id/meta` `{ institution_logo_url }` (http(s) URL or `/uploads/` path) -> `v2_speaker_meta` (plexus.js:181-215).
- **U5 Supporters** - admin supporters manager feeding public `GET /api/public/supporters` (user-portal/backend/server.js:12123).

Global processing defaults: strip EXIF/GPS; heroes -> JPG quality ~80, 2400 px wide (~250-600 KB); gallery -> 1600 px, ~200-400 KB; headshots -> square or 4:5 crop, 640 px; logos -> transparent PNG padded to a uniform tile (e.g. 400x200), white-ink logos only on dark chips. Source masters stay in Downloads until Alen approves copying.

### 2a. Home rotating heroes (6-8 wide shots >= 1600 px)

| Order | Slot / mood | Chosen file | Fallbacks | Processing | Mechanism |
|---|---|---|---|---|---|
| 1 | Gala ballroom signature | `2_Gala/Gala2025_342_emerald-dvorana-siroko.jpg` (5800x3859) | Gala2025_449, Gala_Esplanade_smaragdna-dvorana | crop to hero band (~21:9), 2400w JPG | assets (photo-ballroom.jpg replacement) |
| 2 | Conference in session | `1_Plexus/Plexus2025_087_dvorana-siroki-kadar.jpg` (4830x3214) | Plexus2025_054, Plexus2025_188 | 2400w JPG | assets (photo-hall.jpg replacement) |
| 3 | Warm networking | `1_Plexus/Plexus2025_068_networking-lampice.jpg` (6048x4024) | Plexus2025_152, Plexus2025_270 | 2400w JPG | assets (photo-candlelit.jpg replacement) |
| 4 | Heritage / Split origin | `1_Plexus/Plexus2022_dvorana-split.jpg` (6422x4281) | PlexusSplit_publika-crvena-sjedala | 2400w JPG | assets (new) |
| 5 | Gala dinner atmosphere | `2_Gala/Gala2025_468_puna-dvorana-s-pozornice.jpg` (5384x3582) | Forum_gala-vecer-koristeno-u-pozivnici, Gala2025_446 | 2400w JPG | assets (photo-gala.jpg replacement) |
| 6 | Stage / speaker moment | `1_Plexus/Plexus2025_panel-glavni.jpg` (5809x3865) | Gala2025_349_pozornica-plexus-banner, Plexus2025_246 | 2400w JPG | assets (photo-stage.jpg replacement) |
| 7 | Diaspora / Bridges | `5_Building_Bridges/BB_NYC_panel.jpg` (5120x3840) | BB_2026-06-09_grupna (1600w, min), BB_Washington_veleposlanstvo | 2400w JPG | assets (photo-bridges.jpg replacement) |
| 8 | Next generation / Accelerator | `3_Accelerator/Accelerator_panel-na-gali-2025.jpg` (6048x4024) | Accelerator_MGH-natpis, Institucija_Cleveland-Clinic-polaznici | 2400w JPG | assets (new) |

Top 3 if the rotation is trimmed: rows 1, 2, 3.

### 2b. Plexus Conference page (hero + ALL PHOTOS gallery)

| Slot | Chosen file(s) | Fallbacks | Processing | Mechanism |
|---|---|---|---|---|
| Page hero | `Plexus2025_087_dvorana-siroki-kadar.jpg` | Plexus2025_054_puna-dvorana | 2400w JPG | assets or U2 `is_public` featured |
| Gallery - 2025 core (~18) | 006, 012, 013, 025 (B&W), 029, 036, 039, 054, 068, 077, 081, 104, 116, 133, 175, 188, 206, 246, 298, 303 | remaining Plexus2025_* numbered | 1600w JPG, sort_order = shot number | U2 |
| Gallery - portraits | 045, 070, 074, 180, 227, britanski-ambasador-foto-zid | 292_portret-smijeh | 1600h JPG | U2 |
| Gallery - archive (Split era) | Plexus2022_dvorana-split, Plexus2022_govornik, Plexus2022_panel, Plexus2023_george-daley + 8-10 best of `Arhiva_Split/` (grupna-plexus-backdrop, publika-crvena-sjedala, govornik-mikrofon, heldin-vodopivec-chalfie-mohr, druzenje-u-podrumima) | rest of Arhiva_Split | 1600w JPG, title-tag "Archive - Split" | U2 |
| Program/branding texture | Plexus2025_006_medx-roll-up-banner, Plexus_pozornica-ekran.png (convert JPG) | Plexus_prezentacija-kurirano | 1600w | assets |

### 2c. Gala Evening page (hero + gallery + keynotes + performers)

| Slot | Chosen file(s) | Fallbacks | Processing | Mechanism |
|---|---|---|---|---|
| Gala hero | `Gala2025_342_emerald-dvorana-siroko.jpg` | Gala2025_349, Gala_Esplanade_smaragdna-dvorana | 2400w JPG | assets |
| Gallery (~20) | 342, 349, 412, 425, 433, 445, 446, 452, 468, 477, 489, 493, 526, 533, 549, 575, 583, 598, 629, 631, 638 (main group), 656 | 323/326/329/645 portraits, tom-govor, kurirano 1-3 | 1600w JPG | U2 (tag gala) |
| Keynote headshots (assets/gala/) | delcarmen <- Govornik_DelCarmen.jpg; kevin_smith <- Govornik_Smith-Kevin.jpg (crop); smith_finsbury <- Govornik_Smith-Finsbury.jpg (tight head crop); spisso <- Govornik_Spisso.jpg | - | 640px square JPG | assets/gala/ (replace low-res) + U4 |
| `gala_keynote_anderson.jpg` | NO SOURCE in folder - **GAP: request Anderson portrait** | keep current placeholder | - | - |
| Performers | Gala_nastup-tajci.jpg (Tajci), Gala_nastup-ante-gelo.jpg (Ante Gelo) | - | display <= 300 px (600w sources) | assets / admin performers block |
| Split-era gala flavor | Gala_Split_dioklecijanovi-podrumi.jpg | Gala_Split_velika-grupna.webp (convert, near-dup - pick ONE) | 1600w JPG | U2 |

### 2d. Accelerator page (cohort gallery + host institutions)

| Slot | Chosen file(s) | Fallbacks | Processing | Mechanism |
|---|---|---|---|---|
| Experience gallery (striped placeholder in mock) | Accelerator_MGH-natpis, mgh-yawkey-center, cleveland-clinic-1..3, sara-lab-1/2, lab-dvije-polaznice, polaznice-kampus, polaznice-institucija-1, polaznici-ispred-zgrade (Whitehead/MIT), portret-polaznice, radionica-stolovi-1, yale-backdrop, panel-na-gali-2025 | Institucija_Cleveland-Clinic-polaznici, Institucija_Osaka-panel | 1600w JPG; captions name institution, NOT people unless confirmed | U2 or dedicated accelerator media (U1 + page config) |
| Host institution cards | Institucija_Harvard.webp, _MGH.webp (+_MGH-zgrada), _Cleveland-Clinic.webp, _Mayo-Clinic.webp, _Yale.webp, _Columbia.webp, _Kings-College.webp, _Osaka-panel.webp | Harvard-zgrada (webp-as-jpg) | convert WEBP->JPG; 800w cards (750w sources -> display <= 400 px) | U1 -> host cards config |
| Cohort portraits (Kohorta 2026) | Dominik-Lukicic, Eva-Knezevic, Lara-Stricak, Lucija-Falamic, Luka-Horvat, Petra-Bolt | - | square 640 crop; display <= 200 px (several are casual selfies) | U1 -> cohort gallery |
| Alumni portraits | Dejana-Vujnovic, Dora-Softic, Filip-Klisovic, Gracia-Grabaric, Karlo-Duzevic, Katarina-Kordic, Lucija-Skejic (crop from landscape - best), Marko-Gavrancic, Matea-Bagaric, Sara-Bonet, Stela-Tensek, Vinka-Potocki | - | square 640 crop; display <= 200 px | U1 -> alumni gallery |
| CAUTION | `Accelerator_harvard-kampus-1.jpg` is STANFORD Main Quad (mislabeled) - never caption as Harvard; verify kampus-2 before use | - | - | - |

### 2e. Biomedical Forum page

| Slot | Chosen file(s) | Fallbacks | Processing | Mechanism |
|---|---|---|---|---|
| Forum hero | Forum_gala-vecer-koristeno-u-pozivnici.jpg | Forum_networking-razgovor.png (portrait, convert) | 2400w JPG | assets |
| Team headshots | Forum_headshot-laura.jpg (Laura Rodman - excellent); Forum_portret-alen-bw.jpg (Alen, B&W; convert WEBP) | BB_headshot-miro.jpg (Miro) | 4:5 crop 800px | U1 / speakers-style cards |
| Credibility strip | Forum_s-premijerom.png (with PM Plenkovic), Forum_ministarstvo-zdravstva.png (Ministry of Health), Forum_delegacija.webp (Expo 2025 Osaka - convert) | Institucija_Osaka-1.webp (near-dup - pick ONE) | small sizes only (482-550w PNGs); display <= 260 px | U1 |
| From-the-Forum feed imagery | reuse U2 gala/plexus gallery photos (dups already prove this pattern: 5 of 13 Forum files are byte-copies of Plexus/Gala/BB shots) | - | - | U2 refs |

### 2f. Building Bridges page (next-event + past-city recap cards + per-edition galleries via photos_json)

| Edition card | Chosen file(s) (photos_json order) | Fallbacks | Processing | Mechanism |
|---|---|---|---|---|
| Washington, D.C. (29 Apr 2026) | BB_Washington_veleposlanstvo.jpg (cover), veleposlanstvo-sala-2, sala-1, sala-3, grupna | - | 1600w JPG; captions "Croatian Embassy, Washington D.C." | U3 |
| London | BB_London_panel.jpg (cover), BB_London_grupa.jpg | grupa-sa-zastavama (near-dup of grupa - pick ONE), BB_panel-traka-2 (strip use only) | 1600h JPG (all portrait) | U3 |
| New York | BB_NYC_panel.jpg (cover), NYC_konferencija, NYC_networking, NYC_prezentacija | Plexus_publika-nyc.png (790w - thumbnail only) | 1600w JPG; captions "Croatian Consulate General, New York" | U3 |
| Zurich (9 Jun 2026) | BB_2026-06-09_grupna.jpg (cover), _medx-ekran-govornik, _networking, _publika | - | 1600w JPG (sources are 1600w - keep as-is) | U3 |
| Boston (next event / countdown photo) | BB_Boston_HMS-quad.jpg (card photo) | HMS-Gordon-Hall-1/2, HMS-jesen (strip), HMS-detalj | 1600w JPG | U3 / next-event config |
| BB host headshot | BB_headshot-miro.jpg (Miro Vukovic) | - | 4:5 crop 800 px | U1 |
| Page texture / banner | BB_medx-panel-traka.jpg (1680x400), BB_panel-traka-2.jpg (1200x500) | BB_Boston_HMS-jesen | use only in strip slots | assets |

### 2g. Supporters / partner logos (each must read as the organization)

| Tier | Files (org name readable in artwork) | Processing | Mechanism |
|---|---|---|---|
| Ready - name readable | mgb (Mass General Brigham), mgh (MGH), ucla-health, uhn, hrvatski-lijecnicki-zbor, tportal, tz-grada-splita, tz-grada-zagreba, tz-splitsko-dalmatinske-zupanije, sredisnji-drzavni-ured (tiny type - min width 220 px) | pad to uniform transparent tile 400x200 PNG; keep aspect | U5 |
| White-ink - needs dark chip | poliklinika-aviva (white lettering), hrvatska-turisticka-zajednica (white tagline clips) | place on dark chip or add name label under tile | U5 |
| Mark only - name NOT in artwork | british-embassy-zagreb (royal arms), cambridge (shield), mehun (abstract mark) | REQUIRE visible text label next to logo (portal renders name caption), or request full lockup files | U5 |
| Too small | aci (128x76) | request vector/larger; do not upscale | U5 (blocked) |

### 2h. Portal brand logos (chrome, project cards)

| Slot | File | Processing |
|---|---|---|
| Light-ground logo (`assets/logo.png`) | 0_Logotipovi/Logo_medX-dark.png (or 2500px Logo_medX-tamna-podloga.png master) | PNG as-is; never redraw/stretch (BRAND-BRIEF) |
| Dark-ground logo (`assets/logo-white.png`) | Logo_medX-white.png / Logo_medX-zagrade.png | dark grounds only (invisible on white) |
| Logo_medX.png | WEBP masquerading as .png - convert or discard in favor of Logo_medX-dark | - |
| Project cards | Logo_Plexus.png, Logo_Building-Bridges.png, Logo_Biomedical-Forum.png; Logo_Accelerator.png needs CROP to one lockup from the 3-band sheet | transparent PNG tiles |
| Partner-institution headers | Logo_Harvard-HMS.png (white bg - keep in white box), Logo_HMPA.png (blurry - footer size only) | - |

### 2i. Speaker records (speakers.photo_url + v2_speaker_meta.institution_logo_url)

Quality tiers for `Govornici_portreti/` (23 files):
- **Full-size OK (>=800 px):** DelCarmen (MGH - pair logo mgh.png), Smith-Kevin (UHN - uhn.png), Spisso (UCLA Health - ucla-health.png), Lefkowitz, Rhew, Reic, Heldin.
- **Card size (400-800 px):** Chalfie, Christou, Daley (Harvard-HMS logo), Langer, Mohr, Khatri, Kabrhel, Swaminathan, Luetic, Smith-Finsbury (crop from landscape ceremonial shot; Cambridge shield as logo).
- **List/thumb only (<400 px):** Nair (235), Pusic (250), Skugor (200), Smith-George-P (300), Abraham (352 - event snapshot, not a headshot; request real portrait), Mihic (492x436 trophy still - request real portrait).
- Processing: 4:5 or square crop, 640 px target, consistent background treatment; upload via U4; logos via `institution_logo_url` after U1.

---

## 3. Not usable / unclear

1. `.DS_Store` x2 (0_Logotipovi, 1_Plexus) - system files, skip.
2. `gala_keynote_anderson.jpg` slot in portal has NO source portrait anywhere in the folder - request from Laura.
3. `Govornik_Abraham.jpg` (352w event snapshot) and `Govornik_Mihic.jpg` (trophy video-still) - not headshots; usable only as last-resort thumbs; request proper portraits.
4. `Govornik_Skugor-Mario.png` 200 px, `Govornik_Nair-Ravi.jpg` 235 px, `Govornik_Pusic-Martin.jpg` 250 px, `Govornik_Smith-George-P.jpg` 300 px - below avatar-quality bar for the new design's speaker cards; fine at <=120 px list size.
5. `Accelerator_harvard-kampus-1.jpg` - Stanford Main Quad, mislabeled; do not caption as Harvard. `Accelerator_harvard-kampus-2.jpg` unverified - check before captioning.
6. `Accelerator_radionica-stolovi-1.jpg` - filename says workshop; image is Plexus coffee-break catering. Re-caption if used.
7. Alumni/Kohorta casual selfies (Dejana, Dora, Filip, Marko, Sara-Bonet, Matea w/ sunglasses, Vinka w/ edge intrusion, Eva dim, Petra) - avatar size only; a reshoot request would lift the cohort gallery to design bar.
8. Sub-800-px event photos - thumbnail-only: Gala_stol-gosti.png (510), Gala_nastup-tajci (600), Gala_nastup-ante-gelo (645), BB_medx-networking (760), BB_London_grupa-sa-zastavama (750), Plexus_publika-nyc.png (790), Forum_s-premijerom.png (482), Forum_ministarstvo-zdravstva.png (550), Kohorta_Luka-Horvat (600), Kohorta_Lucija-Falamic (758), Institucija_Mayo-Clinic (612), Institucija_Columbia/Kings-College/MGH (750).
9. Banner strips only fit strip slots: Gala_dvorana-kurirano-5 (1200x500), BB_medx-panel-traka (1680x400), BB_panel-traka-2 (1200x500), BB_Boston_HMS-jesen (1680x627).
10. Exact duplicates (7 byte-identical pairs) - upload ONE of each: Forum_logo=Logo_Biomedical-Forum; BB_logo=Logo_Building-Bridges; Forum_plexus-koristeno=Plexus_prezentacija-kurirano; Forum_networking-koristeno=Gala2025_433; Forum_gala-govornik-koristeno=Gala2025_dvorana-kurirano-1; BB_prezentacija-alen=Forum_alen-prezentira; BB_London_panel=Forum_london-panel-koristeno.
11. Near-duplicates - pick one per pair: BB_London_grupa vs grupa-sa-zastavama; Gala_Split_dioklecijanovi-podrumi vs Gala_Split_velika-grupna.webp; Institucija_Osaka-1 vs Forum_delegacija.
12. WEBP conversion queue (13): all 10 `Institucija_*.webp`, Gala_Split_velika-grupna.webp, Forum_delegacija.webp + 3 extension-mismatch files (Logo_medX.png, Institucija_Harvard-zgrada.jpg, Institucija_MGH-zgrada.jpg, Forum_portret-alen-bw.jpg are WEBP inside). No HEIC found.
13. `Logo_medX-white.png` / `Logo_medX-zagrade.png` render invisible on light grounds - correct behavior, dark grounds only; `Logo_Harvard-HMS.png` has baked white background; `Logo_HMPA.png` is soft/upscaled; `Logo_Accelerator.png` is a 3-variant sheet needing a crop; `aci.png` too small at 128 px.
14. Portrait-heavy London/NYC-consulate sets and 1600w Zurich set cap out below the 2400w hero spec - gallery use is fine, avoid full-bleed heroes.

## 4. Open items for Alen / Laura

- Anderson keynote portrait (assets/gala gap), proper Abraham + Mihic headshots, larger ACI + full lockups for British Embassy / Cambridge / MEHUN, optional better cohort selfies.
- Decide Split-era gala group: JPG basements shot vs WEBP wide variant.
- Confirm whether `Accelerator_harvard-kampus-2.jpg` is actually Harvard before captioning.
