# PHOTO PLACEMENT — DONE (2026-08-29)

Executed from `PHOTO-PLACEMENT-PLAN.md`. Sources read untouched from `/Users/alen/Downloads/_MedX Slike/`
(folder renamed with leading underscore mid-task; a temporary symlink kept the old path alive).
Processing: PIL — heroes max 2000 px JPEG q82, gallery 1600 px, portraits square 640 px (small sources kept
native, never upscaled), logos PNG ≤600 px with transparency, EXIF stripped everywhere.
Frontend deployed: build `2a763bc` → https://medx-member-portal-v2.netlify.app (deploy 6a92e8aef57b8f7f26ddcbc3).

## 1. Static assets replaced (same filenames — zero code edits)

`user-portal/frontend-v2/assets/` — used by the Home rotation + project cards, and as page heroes
(plexus/gala/bridges/accelerator/forum views hardcode these):

| Asset | New source (in `_MedX Slike`) | Result |
|---|---|---|
| photo-ballroom.jpg | 2_Gala/Gala2025_342_emerald-dvorana-siroko.jpg | 2000x1331, 496 KB |
| photo-hall.jpg | 1_Plexus/Plexus2025_087_dvorana-siroki-kadar.jpg | 2000x1331 |
| photo-candlelit.jpg | 1_Plexus/Plexus2025_068_networking-lampice.jpg | 2000x1331 |
| photo-gala.jpg | 2_Gala/Gala2025_468_puna-dvorana-s-pozornice.jpg | 2000x1331 |
| photo-stage.jpg | 1_Plexus/Plexus2025_panel-glavni.jpg | 2000x1331 |
| photo-bridges.jpg | 5_Building_Bridges/BB_NYC_panel.jpg | 2000x1500 |

`assets/gala/` (640/440 px square crops):
- gala_keynote_delcarmen.jpg ← Govornik_DelCarmen.jpg
- gala_keynote_kevin_smith.jpg ← Govornik_Smith-Kevin.jpg (square crop from landscape)
- gala_keynote_smith_finsbury.jpg ← Govornik_Smith-Finsbury.jpg (tight head crop)
- gala_keynote_spisso.jpg ← Govornik_Spisso.jpg (top-biased square)
- gala_keynote_anderson.jpg — UNCHANGED (no source portrait exists; see Needs-Alen)

Note: no view in frontend-v2 currently references `assets/gala/*` — the speaker cards read
`speakers.photo_url` from the API instead. Upgraded anyway as design-handoff assets, 1:1 filenames.

Plan rows 4 and 8 of the Home rotation (Plexus2022_dvorana-split, Accelerator_panel-na-gali-2025) were
NOT added: home.js's PHOTOS list contains only the six filenames above and adding new entries would
require a code edit (out of scope). Both files are otherwise placed (Split 2022 shot is in the Plexus
gallery below).

## 2. Staging content (https://medx-staging.onrender.com, seeded review DB)

All uploads went through the member backend `POST /api/upload/:type` (member-side admin token,
pjero.bacic@medx.hr) → `/uploads/<type>/<uuid>.<ext>`; every URL verified HTTP 200 with image
content-type. Full local-file → URL map: scratch `photos/manifest.json` (session-local).

### Speaker portraits — `speakers.photo_url` via `PUT /__admin/api/admin/plexus/speakers/:id`
The staging speakers table holds exactly 4 rows; all matched and set (replacing external
medx-website-preview.netlify.app URLs):

| Speaker | File | Verified URL |
|---|---|---|
| Dr Marcela del Carmen | Govornik_DelCarmen.jpg | /uploads/speakers/6b276154-e47c-4b97-afba-7dbd7fd7976d.jpg |
| Dr Kevin Smith | Govornik_Smith-Kevin.jpg | /uploads/speakers/6eb249ed-90b1-4d94-9392-69da8a469186.jpg |
| Lord Smith of Finsbury | Govornik_Smith-Finsbury.jpg | /uploads/speakers/f5c04e42-3ae0-4003-b512-91c0ab6055f1.jpg |
| Johnese Spisso, MPA | Govornik_Spisso.jpg | /uploads/speakers/16d8dc3b-15b1-4267-b83a-049f1cec968e.jpg |

13 more portraits were processed and are ready in scratch (Lefkowitz, Rhew, Reic, Heldin, Chalfie,
Christou, Daley, Langer, Mohr, Khatri, Kabrhel, Swaminathan, Luetic) but have NO speaker rows on
staging to attach to — creating speaker records is content entry, not photo placement.

### Institution logos — `v2_speaker_meta` via `PUT /api/v2/plexus/speakers/:id/meta`
- del Carmen ← mgh.png → /uploads/photos/94d09059-54dc-40dd-b352-caf30ce861df.png
- Kevin Smith ← uhn.png → /uploads/photos/de868844-7d84-46f5-97d9-ec470574f56d.png
- Spisso ← ucla-health.png → /uploads/photos/7913ec2b-0305-46e7-8019-e4ce108bdda9.png
- Smith of Finsbury ← cambridge.png (shield, no wordmark — card shows institution name text beside it) → /uploads/photos/d81a9c57-cb75-48eb-82a3-c41924de4536.png

### Plexus gallery — 14 photos via `POST /api/v2/plexus/photos` (conference_photos, is_public=1)
Sort 10→140: Plexus2025 087 (hall in session), 054 (question from the floor), 013 (on stage),
036 (panel), 012 + 246 (Christos Christou), 188 (Esplanade audience), 068 + 152 (networking under
lights), 175 (registration desk); archive: Plexus2022_dvorana-split, Plexus2023_george-daley,
PlexusSplit_grupna-plexus-backdrop, Gala_Split_dioklecijanovi-podrumi (the JPEG chosen over its
WEBP near-dup). All serve 200 under /uploads/photos/…; titles as listed in the ALL PHOTOS modal.

### Building Bridges — `v2_bridges_editions.photos_json` via `PUT /api/v2/bridges/editions/:id`
- Washington DC (a6878c3c, 5): veleposlanstvo (cover), sala-2, sala-1, sala-3, grupna
- London (47fa0cc3, 2): panel (cover), grupa — grupa-sa-zastavama near-dup skipped
- New York (23cd4651, 4): NYC_panel (cover), konferencija, networking, prezentacija
- Zürich (84bc09a6, 4): 2026-06-09 grupna (cover), medx-ekran-govornik, networking, publika
Captions name venues only (embassy/consulate/Zunfthaus), per plan.

### Extension-mismatch fixes
The 4 WEBP-inside-wrong-extension files (Logo_medX.png, Institucija_Harvard-zgrada.jpg,
Institucija_MGH-zgrada.jpg, Forum_portret-alen-bw.jpg) were re-encoded to true PNG/JPEG in scratch
`photos/fixed/`. None has a live slot in this build (see skips), so they were not placed; re-encode
before any future use.

## 3. Verification (Playwright, 1280 px; screenshots in `user-portal/frontend-v2/_qa/photos/`)

- Home: all six rotation photos load at 2000 px (rot-a/rot-b live DOM check + per-file load probe);
  project cards show the new imagery. `home-top.png`, `home-hero-rotation[-next].png`.
- /app/plexus: hero is the new stage shot; 4 speaker portraits render (naturalWidth 640/440); 4
  institution logos render on speaker cards; ALL PHOTOS modal shows the 14 uploaded gallery photos
  with captions. `plexus-top.png`, `plexus-speakers[-cards].png`, `plexus-gallery.png`.
- /app/bridges: all four WHERE WE'VE BEEN recap cards show cover photos; per-edition gallery modal
  renders. `bridges-top.png`, `bridges-cards.png`, `bridges-gallery-modal.png`.
- /app/gala: new hero + export photos render. `gala-top.png`.
- Broken images: 0 across home/plexus/bridges/gala (every `img.complete && naturalWidth===0` swept).
- Console errors: 0 on all four pages.

## 4. Skipped and why

1. `Accelerator_harvard-kampus-1.jpg` — Stanford Main Quad mislabeled as Harvard; excluded entirely.
2. Sub-400 px speaker thumbs (Nair 235, Pusic 250, Skugor 200, Smith-George-P 300) — below quality
   bar; also no staging speaker rows exist for them.
3. Abraham (352 px event snapshot) and Mihic (trophy video-still) — not headshots; not uploaded.
4. Gala server gallery — none exists: `js/views/gala.js` renders its gallery from the static export
   photos (`photo-candlelit/ballroom/hall/stage.jpg`), which were upgraded; there is no gala photos
   endpoint/table to fill. Gala flavor lives in the Plexus gallery (Split basements shot) instead.
5. Accelerator experience gallery — the view hardcodes striped placeholder divs; no server mechanism.
6. Accelerator cohort/alumni portraits — `/api/v2/accelerator/alumni` supports photo_url but the view
   renders names only (no images) and the table is empty; adding rows = content entry, not placement.
7. Forum team headshots / credibility strip — no upload-backed slot in the forum view (feed + state only).
8. Supporters/partner logos — `GET /api/public/supporters` is fed by seeded rows pointing at
   `user-portal/frontend/assets/supporters/*` (v1 assets); frontend-v2 never calls this endpoint and
   there is no clean dedicated admin route for supporter logos → left alone per instructions.
9. Boston next-event photo — the bridges next-event card has no photo field (renders the "ANNOUNCED
   SOON" placeholder by design); `bridges_events` has no photo column.
10. Exact/near duplicates — one of each pair used (Forum_* invitation copies, BB/Forum dups,
    London grupa-sa-zastavama, Gala_Split WEBP, Osaka near-dups not needed this build).

## 5. Prod notes (Cloudinary / durability)

- Staging accepts disk uploads only because the launcher strips `RENDER*` env and sets
  `NODE_ENV=staging` — `STORAGE_IS_EPHEMERAL` stays false. In PRODUCTION without `CLOUDINARY_URL`,
  every multipart POST (both backends) returns 503 by design; all 33 file uploads done here would be
  refused. Before repeating this on prod: configure `CLOUDINARY_URL`, and note upload responses will
  then be Cloudinary URLs, not `/uploads/...` paths.
- Staging durability: uploaded files live on the service's ephemeral disk. They survive free-tier
  sleep/wake but NOT a redeploy/restart of the Render service — after one, the DB reseeds (file-DB
  mode) or keeps rows whose image files are gone (Turso mode). Re-running the upload script restores
  everything: scratch `photos/{process.py,upload.py}` are idempotent-ish (gallery inserts skip by
  title; speaker/meta/edition PUTs simply overwrite).
- Member `/uploads` static is served with `Content-Disposition: attachment` + sandbox CSP —
  `<img>` embeds render fine (verified), but opening an upload URL directly downloads it. Intentional.
- Speaker photo_url / meta logo / bridges+gallery paths are stored RELATIVE (`/uploads/...`) — they
  work on the Netlify front (proxied by `_redirects`) and on the Render origin; they would carry to
  prod cleanly only if prod serves the same paths (with Cloudinary they will be absolute anyway).

## 6. Needs Alen / Laura

- **Anderson keynote portrait** — no source anywhere in the corpus; `gala_keynote_anderson.jpg` is
  still the old 400 px placeholder.
- **Proper headshots for Abraham and Mihic** (current files are an event snapshot and a trophy still).
- **Larger/vector logos**: ACI (128 px unusable); full lockups with the organization NAME for British
  Embassy Zagreb, Cambridge (wordmark version), MEHUN.
- Confirm `Accelerator_harvard-kampus-2.jpg` really is Harvard before captioning anywhere.
- Optional: reshoot the casual cohort/alumni selfies if the Accelerator page gets a real gallery.
- 13 speaker portraits are processed and ready the moment those speakers get records (or the plan's
  full speaker roster is seeded on staging).
