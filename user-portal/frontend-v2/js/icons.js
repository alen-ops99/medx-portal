// js/icons.js — the portal's one line-icon set (24-unit grid, 1.5 stroke, currentColor, square caps to match
// the house corner). ui.icon(name, size) wraps a path in an <svg>; every icon is decorative (aria-hidden), so
// the control that holds it carries the name.
//
//   import { ICONS, iconSvg } from './icons.js';
//   iconSvg('calendar', 20)  →  '<svg class="mx-ic" …>…</svg>'
//
// Names: calendar clock pin tie ticket euro users user mail bell search home grid inbox card qr wallet download
// external check plus chevron-right chevron-left chevron-down edit clip send award mic music globe
// + x more compose lock cog help logout seal star sparkle arrow-right image heart shield

export const ICONS = {
  calendar: '<rect x="3.75" y="5.25" width="16.5" height="15" rx="0"/><path d="M3.75 9.75h16.5M8.25 3v4.5M15.75 3v4.5"/>',
  clock: '<circle cx="12" cy="12" r="8.25"/><path d="M12 7.5V12l3 2"/>',
  pin: '<path d="M12 21s-6.75-6.2-6.75-11.25a6.75 6.75 0 0 1 13.5 0C18.75 14.8 12 21 12 21z"/><circle cx="12" cy="9.75" r="2.25"/>',
  tie: '<path d="M9.75 3h4.5l-.9 3.4 2.4 9.35L12 21l-3.75-5.25 2.4-9.35z"/><path d="M10.65 6.4h2.7"/>',
  ticket: '<path d="M3.75 7.5h16.5v3a1.5 1.5 0 0 0 0 3v3H3.75v-3a1.5 1.5 0 0 0 0-3z"/><path d="M14.25 7.5v9" stroke-dasharray="1.5 1.8"/>',
  euro: '<path d="M17.25 6.4A6.75 6.75 0 1 0 17.25 17.6"/><path d="M4.5 10.5h8.25M4.5 13.5h8.25"/>',
  users: '<circle cx="9" cy="8.25" r="3.25"/><path d="M3 19.5c.6-3.3 3-5.25 6-5.25s5.4 1.95 6 5.25"/><path d="M15 5.2a3.25 3.25 0 0 1 0 6.1M17.25 14.6c1.9.7 3.3 2.4 3.75 4.9"/>',
  user: '<circle cx="12" cy="8.25" r="3.75"/><path d="M4.5 20.25c.75-4 3.75-6.25 7.5-6.25s6.75 2.25 7.5 6.25"/>',
  mail: '<rect x="3" y="5.25" width="18" height="13.5"/><path d="m3.5 6 8.5 7 8.5-7"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.75"/><path d="m15.5 15.5 5.25 5.25"/>',
  home: '<path d="M3.75 10.5 12 3.75l8.25 6.75"/><path d="M5.75 9v11.25h4.5v-6h3.5v6h4.5V9"/>',
  grid: '<rect x="3.75" y="3.75" width="6.75" height="6.75"/><rect x="13.5" y="3.75" width="6.75" height="6.75"/><rect x="3.75" y="13.5" width="6.75" height="6.75"/><rect x="13.5" y="13.5" width="6.75" height="6.75"/>',
  inbox: '<path d="M3.75 13.5 6 4.5h12l2.25 9v6H3.75z"/><path d="M3.75 13.5h4.5l1.5 2.25h4.5l1.5-2.25h4.5"/>',
  card: '<rect x="3" y="5.25" width="18" height="13.5"/><circle cx="8.6" cy="11" r="2"/><path d="M5.6 16c.45-1.6 1.6-2.4 3-2.4s2.55.8 3 2.4M14.25 9.75h4.5M14.25 12.75h3"/>',
  qr: '<rect x="3.75" y="3.75" width="6" height="6"/><rect x="14.25" y="3.75" width="6" height="6"/><rect x="3.75" y="14.25" width="6" height="6"/><path d="M14.25 14.25h2.25v2.25h-2.25zM18 18h2.25v2.25H18zM18 14.25h2.25M14.25 18v2.25"/>',
  wallet: '<path d="M3.75 6.75h15v12.75H3.75z"/><path d="M3.75 6.75 15.75 3.75v3"/><path d="M14.25 11.25h6v4.5h-6z"/>',
  download: '<path d="M12 3.75v11.25M7.5 10.5 12 15l4.5-4.5"/><path d="M4.5 16.5v3.75h15V16.5"/>',
  external: '<path d="M13.5 4.5h6v6M19.5 4.5l-8.25 8.25"/><path d="M17.25 13.5v6H4.5V6.75h6"/>',
  check: '<path d="m4.5 12.75 4.5 4.5 10.5-10.5"/>',
  plus: '<path d="M12 4.5v15M4.5 12h15"/>',
  'chevron-right': '<path d="m9 5.25 6.75 6.75L9 18.75"/>',
  'chevron-left': '<path d="M15 5.25 8.25 12 15 18.75"/>',
  'chevron-down': '<path d="M5.25 9 12 15.75 18.75 9"/>',
  edit: '<path d="M15.75 4.5 19.5 8.25 8.25 19.5H4.5v-3.75z"/><path d="m13.5 6.75 3.75 3.75"/>',
  clip: '<path d="M19.5 11.25 11.8 18.95a4.5 4.5 0 0 1-6.35-6.35l8.1-8.1a3 3 0 0 1 4.25 4.25l-8.1 8.1a1.5 1.5 0 0 1-2.1-2.1l7.35-7.35"/>',
  send: '<path d="M20.25 3.75 3.75 10.5l6.75 3 3 6.75z"/><path d="m10.5 13.5 9.75-9.75"/>',
  award: '<circle cx="12" cy="9" r="5.25"/><path d="m8.6 13 -1.6 7.75L12 18l5 2.75L15.4 13"/>',
  mic: '<rect x="9" y="3" width="6" height="11.25" rx="3"/><path d="M5.25 11.25a6.75 6.75 0 0 0 13.5 0M12 18v3"/>',
  music: '<path d="M9 18V5.25l11.25-2.25v12.75"/><circle cx="6.75" cy="18" r="2.25"/><circle cx="18" cy="15.75" r="2.25"/>',
  globe: '<circle cx="12" cy="12" r="8.25"/><path d="M3.75 12h16.5M12 3.75c2.25 2.25 3.25 5 3.25 8.25S14.25 18 12 20.25C9.75 18 8.75 15.25 8.75 12S9.75 6 12 3.75z"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  more: '<circle cx="5.25" cy="12" r=".9" fill="currentColor"/><circle cx="12" cy="12" r=".9" fill="currentColor"/><circle cx="18.75" cy="12" r=".9" fill="currentColor"/>',
  compose: '<path d="M11.25 4.5H4.5v15h15v-6.75"/><path d="M17.25 3.75 20.25 6.75 12 15H9v-3z"/>',
  lock: '<rect x="5.25" y="10.5" width="13.5" height="9.75"/><path d="M8.25 10.5V7.5a3.75 3.75 0 0 1 7.5 0v3"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.25M12 18.75V21M3 12h2.25M18.75 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M5.6 18.4l1.6-1.6M16.8 7.2l1.6-1.6"/>',
  help: '<circle cx="12" cy="12" r="8.25"/><path d="M9.75 9.4a2.25 2.25 0 1 1 3.3 2c-.7.4-1.05.9-1.05 1.6v.5"/><circle cx="12" cy="16.6" r=".8" fill="currentColor" stroke="none"/>',
  logout: '<path d="M14.25 4.5H4.5v15h9.75"/><path d="M10.5 12h10.5M17.25 8.25 21 12l-3.75 3.75"/>',
  seal: '<circle cx="12" cy="10.5" r="6"/><circle cx="12" cy="10.5" r="3" /><path d="m8.25 15.25-1.5 5.5L12 18.5l5.25 2.25-1.5-5.5"/>',
  star: '<path d="m12 3.75 2.5 5.25 5.75.75-4.2 3.95 1.05 5.7L12 16.6l-5.1 2.8 1.05-5.7-4.2-3.95 5.75-.75z"/>',
  sparkle: '<path d="M12 3.75 13.9 10.1 20.25 12l-6.35 1.9L12 20.25l-1.9-6.35L3.75 12l6.35-1.9z"/>',
  'arrow-right': '<path d="M4.5 12h15M13.5 6l6 6-6 6"/>',
  image: '<rect x="3.75" y="4.5" width="16.5" height="15"/><circle cx="9" cy="9.75" r="1.5"/><path d="m3.75 17.25 5.25-4.5 4.5 3.75 2.25-2.25 4.5 3.75"/>',
  heart: '<path d="M12 19.5s-7.5-4.5-7.5-10.1A3.9 3.9 0 0 1 12 7.2a3.9 3.9 0 0 1 7.5 2.2C19.5 15 12 19.5 12 19.5z"/>',
  shield: '<path d="M12 3.75 19.5 6.75v5.25c0 4.5-3.2 7.5-7.5 8.25-4.3-.75-7.5-3.75-7.5-8.25V6.75z"/>'
};

// `size` in px; the stroke stays 1.5 units of the 24 grid (≈1.25 px at 20). Unknown names draw nothing.
export function iconSvg(name, size = 20, cls = '') {
  const p = ICONS[name];
  if (!p) return '';
  const s = Number(size) || 20;
  return `<svg class="mx-ic${cls ? ' ' + cls : ''}" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true" focusable="false">${p}</svg>`;
}

export default ICONS;
