// js/views/_portraits.js — one clean face crop per known speaker, for every page that shows one
// (Gala, Plexus overview + program, the event app).
//
// Why: the photos the server hands out come in every shape. Three of the Gala's backend files are
// pre-cut circles on cream corners with a gold ring baked in (the iPhone app loads them from the API
// origin and drew "circles cut completely wrongly" inside square frames), one is a full-length shot
// with a 12 px face, and one 404s on the web origin. The member pages never show those files for a
// speaker we know: a tight, face-centred square crop is bundled with the front end instead
// (assets/pages/pt_<key>.jpg, 384 px — 4x a 96 px circle), and it is passed as a RELATIVE path,
// never through api.url(), so the web portal and the iOS app both load the same bundled file.
// Anyone we do not know keeps the server's photo, and ui.portrait() swaps a broken one to initials.
//
//   import { portraitSrc } from './_portraits.js';
//   portraitSrc({ key: 'coburn' })                       → '/assets/pages/pt_coburn.jpg'
//   portraitSrc({ name: 'Dr Marcela del Carmen' })      → '/assets/pages/pt_delcarmen.jpg'
//   portraitSrc({ name: 'A. Guest', image: '/x.jpg' })  → '/x.jpg' (unknown: the server's own file)

const CROPS = Object.freeze({
  smith_finsbury: '/assets/pages/pt_smith_finsbury.jpg',
  coburn: '/assets/pages/pt_coburn.jpg',
  boland: '/assets/pages/pt_boland.jpg',
  delcarmen: '/assets/pages/pt_delcarmen.jpg',
  kevin_smith: '/assets/pages/pt_kevin_smith.jpg',
  spisso: '/assets/pages/pt_spisso.jpg',
  anderson: '/assets/pages/pt_anderson.jpg'
});

// name → key, on the letters alone ("Dr. Giles Boland", "Dr Giles Boland" and "GILES BOLAND" are one person).
// Each test names the person, not a surname alone: two different Smiths speak.
const NAMES = [
  [/smithoffinsbury|lordsmith/, 'smith_finsbury'],
  [/kevinsmith/, 'kevin_smith'],
  [/chriscoburn|christophercoburn/, 'coburn'],
  [/gilesboland/, 'boland'],
  [/marceladelcarmen/, 'delcarmen'],
  [/johnesespisso/, 'spisso'],
  [/paulanderson/, 'anderson']
];
const letters = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');

export function portraitKey(p) {
  const k = String((p && p.key) || '').toLowerCase();
  if (CROPS[k]) return k;
  const n = letters(p && p.name);
  if (!n) return '';
  const hit = NAMES.find(([re]) => re.test(n));
  return hit ? hit[1] : '';
}

// The photo to show for a person: the bundled crop when we know them, else whatever image field the
// server sent (image · photo_url · photo), else '' (ui.portrait draws initials). `resolve` (api.url)
// is applied to the server's file only — a bundled crop always stays relative.
export function portraitSrc(p, resolve) {
  const key = portraitKey(p);
  if (key) return CROPS[key];
  const own = String((p && (p.image || p.photo_url || p.photo || p.image_url)) || '');
  return own && typeof resolve === 'function' ? resolve(own) : own;
}

export default { portraitSrc, portraitKey };
