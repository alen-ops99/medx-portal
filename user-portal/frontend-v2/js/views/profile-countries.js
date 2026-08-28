// Source: Profile.dc.html — the artboard's `countryList` verbatim (Croatia · United States ·
// United Kingdom · Germany first, then A–Z), plus an ISO-3166-1 alpha-2 map so the values the
// LEGACY portal wrote into users.country (codes from app.part9.js › COUNTRIES, e.g. 'AT', plus
// free-text like 'USA') still resolve to a display name. This file belongs to the Profile screen
// (js/views/profile.js); other screens may import it read-only.
export const COUNTRIES = [
  'Croatia', 'United States', 'United Kingdom', 'Germany', 'Afghanistan', 'Albania',
  'Algeria', 'Andorra', 'Angola', 'Argentina', 'Armenia', 'Australia',
  'Austria', 'Azerbaijan', 'Bahamas', 'Bahrain', 'Bangladesh', 'Barbados',
  'Belarus', 'Belgium', 'Belize', 'Benin', 'Bhutan', 'Bolivia',
  'Bosnia and Herzegovina', 'Botswana', 'Brazil', 'Brunei', 'Bulgaria', 'Burkina Faso',
  'Burundi', 'Cabo Verde', 'Cambodia', 'Cameroon', 'Canada', 'Central African Republic',
  'Chad', 'Chile', 'China', 'Colombia', 'Comoros', 'Congo',
  'Costa Rica', 'Côte d’Ivoire', 'Cuba', 'Cyprus', 'Czechia', 'Denmark',
  'Djibouti', 'Dominica', 'Dominican Republic', 'DR Congo', 'Ecuador', 'Egypt',
  'El Salvador', 'Equatorial Guinea', 'Eritrea', 'Estonia', 'Eswatini', 'Ethiopia',
  'Fiji', 'Finland', 'France', 'Gabon', 'Gambia', 'Georgia',
  'Ghana', 'Greece', 'Grenada', 'Guatemala', 'Guinea', 'Guinea-Bissau',
  'Guyana', 'Haiti', 'Honduras', 'Hungary', 'Iceland', 'India',
  'Indonesia', 'Iran', 'Iraq', 'Ireland', 'Israel', 'Italy',
  'Jamaica', 'Japan', 'Jordan', 'Kazakhstan', 'Kenya', 'Kiribati',
  'Kosovo', 'Kuwait', 'Kyrgyzstan', 'Laos', 'Latvia', 'Lebanon',
  'Lesotho', 'Liberia', 'Libya', 'Liechtenstein', 'Lithuania', 'Luxembourg',
  'Madagascar', 'Malawi', 'Malaysia', 'Maldives', 'Mali', 'Malta',
  'Marshall Islands', 'Mauritania', 'Mauritius', 'Mexico', 'Micronesia', 'Moldova',
  'Monaco', 'Mongolia', 'Montenegro', 'Morocco', 'Mozambique', 'Myanmar',
  'Namibia', 'Nauru', 'Nepal', 'Netherlands', 'New Zealand', 'Nicaragua',
  'Niger', 'Nigeria', 'North Korea', 'North Macedonia', 'Norway', 'Oman',
  'Pakistan', 'Palau', 'Palestine', 'Panama', 'Papua New Guinea', 'Paraguay',
  'Peru', 'Philippines', 'Poland', 'Portugal', 'Qatar', 'Romania',
  'Russia', 'Rwanda', 'Saint Kitts and Nevis', 'Saint Lucia', 'Saint Vincent and the Grenadines', 'Samoa',
  'San Marino', 'São Tomé and Príncipe', 'Saudi Arabia', 'Senegal', 'Serbia', 'Seychelles',
  'Sierra Leone', 'Singapore', 'Slovakia', 'Slovenia', 'Solomon Islands', 'Somalia',
  'South Africa', 'South Korea', 'South Sudan', 'Spain', 'Sri Lanka', 'Sudan',
  'Suriname', 'Sweden', 'Switzerland', 'Syria', 'Taiwan', 'Tajikistan',
  'Tanzania', 'Thailand', 'Timor-Leste', 'Togo', 'Tonga', 'Trinidad and Tobago',
  'Tunisia', 'Turkey', 'Turkmenistan', 'Tuvalu', 'Uganda', 'Ukraine',
  'United Arab Emirates', 'Uruguay', 'Uzbekistan', 'Vanuatu', 'Vatican City', 'Venezuela',
  'Vietnam', 'Yemen', 'Zambia', 'Zimbabwe'
];

// ISO alpha-2 → the display name used above (AG kept for legacy rows although the artboard list omits it)
export const ISO2 = {
  AD: 'Andorra', AE: 'United Arab Emirates', AF: 'Afghanistan', AG: 'Antigua and Barbuda', AL: 'Albania',
  AM: 'Armenia', AO: 'Angola', AR: 'Argentina', AT: 'Austria', AU: 'Australia',
  AZ: 'Azerbaijan', BA: 'Bosnia and Herzegovina', BB: 'Barbados', BD: 'Bangladesh', BE: 'Belgium',
  BF: 'Burkina Faso', BG: 'Bulgaria', BH: 'Bahrain', BI: 'Burundi', BJ: 'Benin',
  BN: 'Brunei', BO: 'Bolivia', BR: 'Brazil', BS: 'Bahamas', BT: 'Bhutan',
  BW: 'Botswana', BY: 'Belarus', BZ: 'Belize', CA: 'Canada', CD: 'DR Congo',
  CF: 'Central African Republic', CG: 'Congo', CH: 'Switzerland', CI: 'Côte d’Ivoire', CL: 'Chile',
  CM: 'Cameroon', CN: 'China', CO: 'Colombia', CR: 'Costa Rica', CU: 'Cuba',
  CV: 'Cabo Verde', CY: 'Cyprus', CZ: 'Czechia', DE: 'Germany', DJ: 'Djibouti',
  DK: 'Denmark', DM: 'Dominica', DO: 'Dominican Republic', DZ: 'Algeria', EC: 'Ecuador',
  EE: 'Estonia', EG: 'Egypt', ER: 'Eritrea', ES: 'Spain', ET: 'Ethiopia',
  FI: 'Finland', FJ: 'Fiji', FM: 'Micronesia', FR: 'France', GA: 'Gabon',
  GB: 'United Kingdom', GD: 'Grenada', GE: 'Georgia', GH: 'Ghana', GM: 'Gambia',
  GN: 'Guinea', GQ: 'Equatorial Guinea', GR: 'Greece', GT: 'Guatemala', GW: 'Guinea-Bissau',
  GY: 'Guyana', HN: 'Honduras', HR: 'Croatia', HT: 'Haiti', HU: 'Hungary',
  ID: 'Indonesia', IE: 'Ireland', IL: 'Israel', IN: 'India', IQ: 'Iraq',
  IR: 'Iran', IS: 'Iceland', IT: 'Italy', JM: 'Jamaica', JO: 'Jordan',
  JP: 'Japan', KE: 'Kenya', KG: 'Kyrgyzstan', KH: 'Cambodia', KI: 'Kiribati',
  KM: 'Comoros', KN: 'Saint Kitts and Nevis', KP: 'North Korea', KR: 'South Korea', KW: 'Kuwait',
  KZ: 'Kazakhstan', LA: 'Laos', LB: 'Lebanon', LC: 'Saint Lucia', LI: 'Liechtenstein',
  LK: 'Sri Lanka', LR: 'Liberia', LS: 'Lesotho', LT: 'Lithuania', LU: 'Luxembourg',
  LV: 'Latvia', LY: 'Libya', MA: 'Morocco', MC: 'Monaco', MD: 'Moldova',
  ME: 'Montenegro', MG: 'Madagascar', MH: 'Marshall Islands', MK: 'North Macedonia', ML: 'Mali',
  MM: 'Myanmar', MN: 'Mongolia', MR: 'Mauritania', MT: 'Malta', MU: 'Mauritius',
  MV: 'Maldives', MW: 'Malawi', MX: 'Mexico', MY: 'Malaysia', MZ: 'Mozambique',
  NA: 'Namibia', NE: 'Niger', NG: 'Nigeria', NI: 'Nicaragua', NL: 'Netherlands',
  NO: 'Norway', NP: 'Nepal', NR: 'Nauru', NZ: 'New Zealand', OM: 'Oman',
  PA: 'Panama', PE: 'Peru', PG: 'Papua New Guinea', PH: 'Philippines', PK: 'Pakistan',
  PL: 'Poland', PS: 'Palestine', PT: 'Portugal', PW: 'Palau', PY: 'Paraguay',
  QA: 'Qatar', RO: 'Romania', RS: 'Serbia', RU: 'Russia', RW: 'Rwanda',
  SA: 'Saudi Arabia', SB: 'Solomon Islands', SC: 'Seychelles', SD: 'Sudan', SE: 'Sweden',
  SG: 'Singapore', SI: 'Slovenia', SK: 'Slovakia', SL: 'Sierra Leone', SM: 'San Marino',
  SN: 'Senegal', SO: 'Somalia', SR: 'Suriname', SS: 'South Sudan', ST: 'São Tomé and Príncipe',
  SV: 'El Salvador', SY: 'Syria', SZ: 'Eswatini', TD: 'Chad', TG: 'Togo',
  TH: 'Thailand', TJ: 'Tajikistan', TL: 'Timor-Leste', TM: 'Turkmenistan', TN: 'Tunisia',
  TO: 'Tonga', TR: 'Turkey', TT: 'Trinidad and Tobago', TV: 'Tuvalu', TW: 'Taiwan',
  TZ: 'Tanzania', UA: 'Ukraine', UG: 'Uganda', US: 'United States', UY: 'Uruguay',
  UZ: 'Uzbekistan', VA: 'Vatican City', VC: 'Saint Vincent and the Grenadines', VE: 'Venezuela', VN: 'Vietnam',
  VU: 'Vanuatu', WS: 'Samoa', XK: 'Kosovo', YE: 'Yemen', ZA: 'South Africa',
  ZM: 'Zambia', ZW: 'Zimbabwe'
};

// common non-ISO spellings seen in the shared users.country column and in pasted CVs
const ALIASES = {
  'usa': 'United States', 'us': 'United States', 'u.s.': 'United States', 'u.s.a.': 'United States',
  'united states of america': 'United States', 'america': 'United States',
  'uk': 'United Kingdom', 'u.k.': 'United Kingdom', 'great britain': 'United Kingdom', 'england': 'United Kingdom',
  'czech republic': 'Czechia', 'congo (drc)': 'DR Congo', 'democratic republic of the congo': 'DR Congo',
  'korea (south)': 'South Korea', 'korea (north)': 'North Korea', 'republic of korea': 'South Korea',
  "cote d'ivoire": 'Côte d’Ivoire', 'ivory coast': 'Côte d’Ivoire', 'sao tome and principe': 'São Tomé and Príncipe',
  'russian federation': 'Russia', 'viet nam': 'Vietnam', 'macedonia': 'North Macedonia', 'hrvatska': 'Croatia',
  'the netherlands': 'Netherlands', 'holland': 'Netherlands', 'uae': 'United Arab Emirates', 'burma': 'Myanmar',
  'swaziland': 'Eswatini', 'east timor': 'Timor-Leste', 'cape verde': 'Cabo Verde'
};

const fold = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\u2019/g, "'").toLowerCase().trim();
const BY_FOLD = new Map(COUNTRIES.map(n => [fold(n), n]));
Object.keys(ISO2).forEach(c => BY_FOLD.set(fold(ISO2[c]), ISO2[c]));

/** Normalise whatever sits in users.country (name, ISO-2 code, alias) to a display name.
 *  Unknown values come back unchanged so nothing a member typed is ever lost. */
export function countryName(value) {
  const v = String(value == null ? '' : value).trim();
  if (!v) return '';
  if (/^[A-Za-z]{2}$/.test(v) && ISO2[v.toUpperCase()]) return ISO2[v.toUpperCase()];
  const f = fold(v);
  return BY_FOLD.get(f) || ALIASES[f] || v;
}
export default COUNTRIES;
