// Source: Accelerator.dc.html · Accelerator Application.dc.html
// Route /app/accelerator/:tab? — '' = Overview, 'apply' = My Application (the EXISTING 7-step
// wizard, restyled shell per the artboard; fields/validation/draft/upload/submit ported verbatim
// from the legacy SPA — user-portal/frontend/index.html #ax-panel-apply + app.part9.js
// AcceleratorPortal — do not invent or drop fields).
// Blocks (artboard order) — Overview: "Breadcrumb" › "Tabs" › "Hero" › "Stats band" ›
// "01 · THE PROGRAM" (+ "HOST LABS & CLINICS") › "02 · WHAT'S INCLUDED" › "03 · HOW SELECTION
// WORKS" › "04 · YOUR APPLICATION" (+ "RESULTS LOOKUP") › "05 · THE TEAM" (+ "PREVIOUS
// COHORTS") › "06 · FREQUENTLY ASKED" › "Footer · MESSAGE US".
// Apply: "Breadcrumb" › "Tabs" › "Header band" › "Stepper" › wizard panel + "APPLICATION
// CHECKLIST" rail › "Results footnote". Before applications open the apply tab shows the
// GET-NOTIFIED capture instead of the wizard; `?preview=1` keeps the wizard reachable.
// Data: intake window + countdown + program + institutions/sites + overview-config +
// notify-topics + my-applications + portal-content FAQ + v2 alumni (see load()). FACTS fills
// gaps and wording only.
import { api } from '../api.js';
import { session } from '../state.js';
import { ui, esc, fmt } from '../ui.js';
import { FACTS } from '../facts.js';
import { chrome } from '../chrome.js';
import router from '../router.js';

export const SOURCE = 'Accelerator.dc.html · Accelerator Application.dc.html';

// ---- COPY: every string that may change in a revision (dates/prices via FACTS or the API) ----
export const COPY = {
  crumbs: { projects: 'PROJECTS', name: 'THE ACCELERATOR', mine: 'MY APPLICATION' },
  tabs: { overview: 'OVERVIEW', apply: 'MY APPLICATION' },
  hero: {
    pill: (opens, placement) => `APPLICATIONS OPEN ${opens} · ${placement} PLACEMENTS`,
    pillOpen: placement => `APPLICATIONS OPEN NOW · ${placement} PLACEMENTS`,
    pillClosed: placement => `APPLICATIONS CLOSED · ${placement} PLACEMENTS`,
    title: 'The Med&amp;X <i style="color:#c9a962">Accelerator</i>',
    sub: 'For Croatian medical and biomedical students, young researchers, and young physicians. Summer research internships at Cleveland Clinic, Mayo Clinic, Columbia, and the University of Zurich.',
    notify: 'GET NOTIFIED WHEN APPLICATIONS OPEN',
    notified: '✓ ON THE LIST — WE’LL EMAIL YOU AT OPENING',
    start: 'START YOUR APPLICATION →',
    resume: 'CONTINUE YOUR APPLICATION →',
    view: 'VIEW YOUR APPLICATION →',
    followLine: on => `GET UPDATES FROM THE ACCELERATOR · ${on ? 'ON' : 'OFF'}`,
    followSub: 'Email + portal alerts · manage topics in Profile &amp; settings',
    notedToast: 'Noted — we’ll email you the day applications open.',
    followOnToast: 'Accelerator updates on — email + portal alerts.',
    followOffToast: 'Accelerator updates off.'
  },
  band: {
    openIn: 'APPLICATIONS OPEN IN', closeIn: 'APPLICATIONS CLOSE IN', open: 'APPLICATIONS', openNow: 'NOW', closed: 'CLOSED',
    days: 'DAYS', duration: '8–12 WEEKS', hosts: n => `${n} HOST INSTITUTIONS · USA &amp; EUROPE`,
    positions: r => `${r} POSITIONS`, stipend: '€800–1,000 STIPEND'
  },
  program: {
    n: '01', title: 'THE PROGRAM',
    body: 'A prestigious summer research program placing exceptional Croatian students and early-career researchers at world-renowned labs and clinics. The mission goes beyond the internship: experience an amazing institution, grow professionally and personally, and bring that knowledge home · building lasting bridges in biomedicine between Croatia and the world.',
    whoTitle: 'WHO IT’S FOR', whoSub: 'Croatian citizens at the start of their careers — wherever in the world you study or work.',
    chips: ['SENIOR MEDICAL STUDENTS', 'BIOCHEMISTRY &amp; BIOMEDICAL ENGINEERING STUDENTS', 'EARLY-CAREER RESEARCHERS · 0–3 YRS POST-GRADUATION'],
    chipGold: 'CROATIAN CITIZENSHIP REQUIRED',
    hostsTitle: 'HOST LABS &amp; CLINICS', hostsSub: 'Click an institution to learn more · specific placements depend on mentor availability.',
    positions: n => `${n} ${Number(n) === 1 ? 'position' : 'positions'}`, positionsTbc: 'Positions TBC', site: 'Website →'
  },
  included: {
    n: '02', title: 'WHAT’S INCLUDED', stipend: '€800–1,000',
    stipendSub: 'fellowship stipend for travel, living expenses, and health insurance',
    chips: ['VISA DOCUMENTATION', 'HOUSING ASSISTANCE', 'TRAVEL ARRANGEMENTS', 'ONBOARDING SUPPORT', 'MENTORSHIP PROGRAM', 'CERTIFICATE OF COMPLETION']
  },
  selection: {
    n: '03', title: 'HOW SELECTION WORKS',
    steps: opens => [
      { n: '1', t: 'Submit your application', d: `Online form with your CV, mentor letter, and required documents · opens ${opens}.` },
      { n: '2', t: 'Document review', d: 'Two-phase document review by the selection committee; shortlisted candidates advance.' },
      { n: '3', t: 'Interview round', d: 'Interviews with two Croatian biomedical professionals, scheduled after document review.' },
      { n: '4', t: 'Selection & onboarding', d: 'Results arrive by email with your access code · fellowship paperwork begins.' }
    ],
    note: 'Being selected by Med&amp;X does not guarantee placement · final acceptance is subject to the host institution’s approval.'
  },
  application: {
    n: '04', title: 'YOUR APPLICATION',
    noneLine: opens => `No application yet · they open ${opens}.`,
    noneOpenLine: 'No application yet · applications are open.',
    closedLine: 'Applications for this cycle have closed.',
    noneWhy: 'Ready your CV and a mentor letter, plus a one-line summary of your project. Your application and its status will live here.',
    openWhy: 'Have your CV, a mentor letter, and a one-line project summary ready — your progress saves automatically.',
    draftLine: pct => `Your draft is saved · ${pct}% complete.`,
    draftWhy: 'Pick up where you left off — your progress saves automatically as you type.',
    subLine: (num, when) => `Application ${num} submitted${when ? ' ' + when : ''}.`,
    subWhy: 'We emailed a confirmation. The committee will reach you here and by email at every stage.',
    reviewWhy: 'The selection committee is reviewing your documents. You will hear from us by email at every stage.',
    resultLine: 'Your result is ready.',
    resultWhy: 'Results arrive by email with your access code — look yours up below.',
    notify: 'GET NOTIFIED →', notified: '✓ ON THE LIST', preview: 'PREVIEW THE APPLICATION →',
    start: 'START YOUR APPLICATION →', resume: 'CONTINUE YOUR APPLICATION →', view: 'VIEW YOUR APPLICATION →',
    payFee: 'PAY THE €75 FEE →', feeNote: 'Processing fee pending — your application stays valid either way.',
    statusWord: { submitted: 'SUBMITTED', review: 'UNDER REVIEW', accepted: 'ACCEPTED', waitlisted: 'WAITLISTED', rejected: 'NOT SELECTED', draft: 'DRAFT' }
  },
  results: {
    label: 'RESULTS LOOKUP', placeholder: 'AX26-XXXX', view: 'VIEW RESULTS',
    hint: 'Access codes arrive by email after the review completes.',
    empty: 'Enter the access code from your email.',
    malformed: 'Access codes look like AX26-XXXX — check the email.',
    unknown: 'We don’t recognise that code — check the email or message us.',
    notYet: 'No results yet — the review has not completed.',
    failed: 'Results are unavailable right now — try again in a minute.',
    none: 'No results are published for this code yet.',
    title: y => `RESULTS${y ? ' · ' + y : ''}`, yours: 'YOURS',
    cols: ['RANK', 'APPLICATION №', 'OBJECTIVE', 'INTERVIEW', 'TOTAL', 'STATUS'],
    note: 'Results are anonymised — find your row by the application number from your confirmation email.'
  },
  team: {
    n: '05', title: 'THE TEAM',
    people: [
      { init: 'MP', bg: '#9b1b22', fg: '#f7f1e6', name: 'Marija Pranjić', role: 'Program Director · coordinates partner institutions and mentors across Europe and the US' },
      { init: 'MV', bg: '#191512', fg: '#f7f1e6', name: 'Miro Vuković, MD', role: 'Vice President · strategic lead for Med&amp;X partnerships' },
      { init: 'MG', bg: '#9b1b22', fg: '#f7f1e6', name: 'Marina Grubić, MD', role: 'Vice President, Human Resources · fellow onboarding and mentor relations' },
      { init: 'AJ', bg: '#c9a962', fg: '#191512', name: 'Alen Juginović, MD', role: 'Founder &amp; President, Med&amp;X · sleep neuroscientist at Harvard Medical School' },
      { init: 'LS', bg: '#191512', fg: '#f7f1e6', name: 'Lucija Skejić', role: 'Program team · design &amp; member experience' }
    ]
  },
  cohorts: {
    title: 'PREVIOUS COHORTS', sub: 'The people who went — and where.',
    // UXFIX-M2 #7 (2026-09-02): real photos replace the striped placeholders. Sources: medx.hr
    // live-site mirror (acc_25_2 = MGH Boston arrival, acc_25 = lab day), recompressed ≤300KB.
    photo1: { src: '/assets/ax-cohort-arrival.jpg', alt: 'A fellow arriving at Massachusetts General Hospital, Boston' },
    photo2: { src: '/assets/ax-lab-day.jpg', alt: 'Two fellows in the lab at their host institution' },
    fellowsLabel: range => `FELLOWS ${range}`, range: '2024–2026',
    foot: n => `${n} fellows across the 2024–2026 cohorts · placed at our host institutions.`,
    classOf: y => `CLASS OF ${y}`,
    // published 2024–25 alumni names (README note 15) — COPY fallback until the admin list
    // (GET /api/v2/accelerator/alumni) has rows
    fallback: [
      { name: 'Stela Lara Tenšek', where: 'CLASS OF 2025' }, { name: 'Katarina Kordić', where: 'CLASS OF 2025' },
      { name: 'Sara Bonet', where: 'CLASS OF 2025' }, { name: 'Dora Softić', where: 'CLASS OF 2025' },
      { name: 'Filip Jakov Klisović', where: 'CLASS OF 2025' }, { name: 'Dejana Vujnović', where: 'CLASS OF 2025' },
      { name: 'Gracia Grabarić', where: 'CLASS OF 2024' }, { name: 'Karlo Dužević', where: 'CLASS OF 2024' }
    ]
  },
  faq: {
    n: '06', title: 'FREQUENTLY ASKED',
    // COPY fallback — admin-editable rows come from GET /api/portal-content/published/accelerator-faq
    list: opens => [
      { q: 'What are the eligibility requirements?', a: 'Croatian citizenship is required. The program is aimed at senior medical, biochemistry-related, and biomedical engineering students, and early-career researchers up to three years post-graduation — wherever in the world you currently study or work.' },
      { q: 'Is the program paid? What funding is available?', a: 'Yes — fellows receive a €800–1,000 stipend toward travel, living costs, and health insurance, plus visa documentation, housing assistance, travel arrangements, and onboarding support.' },
      { q: 'How competitive is the selection process?', a: 'Highly — 5–10 positions are awarded per cycle across all host institutions. A strong mentor letter and a clear one-line summary of your project matter most.' },
      { q: 'What is the application timeline?', a: `Applications open ${opens} and stay open for a limited window. Document review then runs in two phases, shortlisted candidates are interviewed, and results arrive by email with your access code.` },
      { q: 'Can I apply to multiple institutions?', a: 'You submit one application and state your preferences — the selection committee matches selected fellows with host institutions, subject to mentor availability and final host approval.' }
    ]
  },
  footer: {
    line: 'Questions about applying, placements, or eligibility?',
    sub: 'Message us · the coordinators reply right here in your portal inbox.',
    cta: 'MESSAGE US →'
  },
  wiz: {
    eyebrow: placement => `MED&amp;X ACCELERATOR · ${placement}`,
    pillDraft: 'DRAFT · NOT YET SUBMITTED', pillSubmitted: when => `SUBMITTED${when ? ' · ' + when.toUpperCase() : ''}`,
    pillPreview: opens => `PREVIEW · OPENS ${opens}`,
    closes: d => `CLOSES ${d}`, opens: d => `OPENS ${d}`, open: 'APPLICATIONS OPEN', closed: 'APPLICATIONS CLOSED',
    title: 'My <i style="color:#c9a962">Application</i>',
    sub: 'Your progress saves automatically · leave and come back any time.',
    subDone: 'Submitted — the committee takes it from here. We’ll reach you by email at every stage.',
    steps: ['PERSONAL', 'EDUCATION', 'PROGRAM', 'SUPPLEMENTARY', 'DOCUMENTS', 'CONSENT', 'REVIEW'],
    stepTitles: ['Personal Information', 'Education', 'Program Preferences', 'Supplementary', 'Documents', 'Consent', 'Review & Submit'],
    required: 'Fields marked <span style="color:#9b1b22">*</span> are required.',
    prev: '← PREVIOUS', next: 'CONTINUE →', submit: 'SUBMIT APPLICATION', submitting: 'SUBMITTING…',
    submitHint: 'Enabled once every section is complete.', pdf: 'PREVIEW AS PDF',
    saved: { saving: 'Saving…', just: 'Saved just now', at: t => `Saved at ${t}`, none: 'Autosaves as you type' },
    reviewSub: 'Check each section before submitting · you can still edit until the deadline.',
    reviewStatus: { done: 'COMPLETE', todo: 'INCOMPLETE' }, edit: 'EDIT →',
    summaryTitle: 'APPLICATION SUMMARY',
    summaryNote: 'Once submitted, you receive a confirmation email and can track the status here.',
    checklist: { title: 'APPLICATION CHECKLIST', complete: 'COMPLETE' },
    items: ['Personal info completed', 'Education details added', 'Institution preferences selected', 'Motivation statement written', 'Documents uploaded', 'Application reviewed'],
    before: { title: 'BEFORE YOU START', body: 'Have your CV, a mentor letter, and a one-line project summary ready · you’ll upload them in Documents.' },
    stuck: { line: 'Stuck on a question?', body: 'Message us · the coordinators reply right here in your portal inbox.', cta: 'MESSAGE US →' },
    footnote: 'Results arrive by emailed access code (AX26–XXXX) · look them up any time on ',
    footnoteLink: 'the Accelerator page',
    submittedLine: num => `Application ${num} is in.`,
    submittedWhy: email => `We emailed a confirmation${email ? ' to ' + email : ''}. Track the status here and in Your application on the overview.`,
    docsFailed: types => `Heads up — ${types} did not upload. Retry from the overview or message us.`,
    gate: {
      line: opens => `Applications open ${opens}.`,
      closedLine: 'Applications for this cycle have closed.',
      why: 'Ready your CV, a mentor letter, and a one-line project summary — the seven-step form will live right here.',
      preview: 'PREVIEW THE APPLICATION →'
    },
    fee: {
      eyebrow: 'ACCELERATOR · APPLICATION RECEIVED',
      body: '<p>To complete your submission, pay the non-refundable <strong>€75 processing fee</strong>. You can also pay later from the Accelerator overview — your application stays saved either way.</p>',
      pay: 'PAY €75 NOW', later: 'PAY LATER',
      redirect: 'Taking you to the secure payment page…',
      unavailable: 'The payment system is unavailable right now — you can pay later from the Accelerator overview.'
    },
    // validation — verbatim from the legacy wizard (app.part9.js › validateStep)
    v: {
      s1: 'Please fill in all required fields',
      s2: 'Please fill in all required education fields',
      s3: 'Please select at least your first choice institution and describe your research interests',
      s3distinct: 'Please select different institutions for each choice',
      s4: 'Personal statement is required',
      s5: 'Please upload your CV/Resume (PDF required)',
      s6: 'Please accept all consent checkboxes to continue'
    },
    gdpr: 'Your personal data will be processed in accordance with GDPR. Data will be shared with collaborating institutions only for the purpose of evaluating your application. You may withdraw your application and request data deletion at any time by contacting accelerator@medx.hr.',
    consents: [
      'I consent to Med&amp;X processing my personal data for the Accelerator program application',
      'I consent to my data being shared with selected collaborating institutions',
      'I confirm that all information provided is accurate and complete'
    ],
    upload: { click: 'CLICK TO UPLOAD', drag: ' or drag and drop', pdf: 'PDF up to 5MB', remove: '× REMOVE', tooBig: 'That file is over 5MB — export a lighter PDF.', notPdf: 'PDF only, please.' },
    submitFail: 'Submission failed. Please try again.',
    submitOk: 'Application submitted successfully!'
  }
};

const DRAFT_KEY = 'medx_accelerator_draft';           // legacy key on purpose — an old draft carries over
const STEP_KEY = 'medx_accelerator_step';
const CODE_RE = FACTS.accelerator.codeFormat;         // /^AX26-[A-Z0-9]{4}$/

// legacy hard-coded institution slugs (app.part9.js › AcceleratorPortal.institutions) —
// used only when GET /api/accelerator/institutions is empty, and to translate old draft values
const LEGACY_INSTITUTIONS = {
  harvard: 'Harvard Medical School', yale: 'Yale School of Medicine', mayo: 'Mayo Clinic',
  cleveland: 'Cleveland Clinic', mit: 'MIT', mgh: 'Massachusetts General Hospital',
  stanford: 'Stanford Medicine', jhopkins: 'Johns Hopkins'
};
const DEGREES = [['md', 'MD / Medicine'], ['phd', 'PhD'], ['msc', 'Master’s'], ['bsc', 'Bachelor’s'], ['md-phd', 'MD-PhD']];
const YEARS = [['1', '1st Year'], ['2', '2nd Year'], ['3', '3rd Year'], ['4', '4th Year'], ['5', '5th Year'], ['6', '6th Year'], ['graduated', 'Graduated']];
// legacy COUNTRIES list (app.part9.js:3092) — ISO code values, Croatia first
const COUNTRIES = ('HR:Croatia|AF:Afghanistan|AL:Albania|DZ:Algeria|AD:Andorra|AO:Angola|AG:Antigua and Barbuda|AR:Argentina|AM:Armenia|AU:Australia|AT:Austria|AZ:Azerbaijan|BS:Bahamas|BH:Bahrain|BD:Bangladesh|BB:Barbados|BY:Belarus|BE:Belgium|BZ:Belize|BJ:Benin|BT:Bhutan|BO:Bolivia|BA:Bosnia and Herzegovina|BW:Botswana|BR:Brazil|BN:Brunei|BG:Bulgaria|BF:Burkina Faso|BI:Burundi|CV:Cabo Verde|KH:Cambodia|CM:Cameroon|CA:Canada|CF:Central African Republic|TD:Chad|CL:Chile|CN:China|CO:Colombia|KM:Comoros|CG:Congo|CD:Congo (DRC)|CR:Costa Rica|CI:Cote d’Ivoire|CU:Cuba|CY:Cyprus|CZ:Czech Republic|DK:Denmark|DJ:Djibouti|DM:Dominica|DO:Dominican Republic|EC:Ecuador|EG:Egypt|SV:El Salvador|GQ:Equatorial Guinea|ER:Eritrea|EE:Estonia|SZ:Eswatini|ET:Ethiopia|FJ:Fiji|FI:Finland|FR:France|GA:Gabon|GM:Gambia|GE:Georgia|DE:Germany|GH:Ghana|GR:Greece|GD:Grenada|GT:Guatemala|GN:Guinea|GW:Guinea-Bissau|GY:Guyana|HT:Haiti|HN:Honduras|HU:Hungary|IS:Iceland|IN:India|ID:Indonesia|IR:Iran|IQ:Iraq|IE:Ireland|IL:Israel|IT:Italy|JM:Jamaica|JP:Japan|JO:Jordan|KZ:Kazakhstan|KE:Kenya|KI:Kiribati|KP:Korea (North)|KR:Korea (South)|XK:Kosovo|KW:Kuwait|KG:Kyrgyzstan|LA:Laos|LV:Latvia|LB:Lebanon|LS:Lesotho|LR:Liberia|LY:Libya|LI:Liechtenstein|LT:Lithuania|LU:Luxembourg|MG:Madagascar|MW:Malawi|MY:Malaysia|MV:Maldives|ML:Mali|MT:Malta|MH:Marshall Islands|MR:Mauritania|MU:Mauritius|MX:Mexico|FM:Micronesia|MD:Moldova|MC:Monaco|MN:Mongolia|ME:Montenegro|MA:Morocco|MZ:Mozambique|MM:Myanmar|NA:Namibia|NR:Nauru|NP:Nepal|NL:Netherlands|NZ:New Zealand|NI:Nicaragua|NE:Niger|NG:Nigeria|MK:North Macedonia|NO:Norway|OM:Oman|PK:Pakistan|PW:Palau|PS:Palestine|PA:Panama|PG:Papua New Guinea|PY:Paraguay|PE:Peru|PH:Philippines|PL:Poland|PT:Portugal|QA:Qatar|RO:Romania|RU:Russia|RW:Rwanda|KN:Saint Kitts and Nevis|LC:Saint Lucia|VC:Saint Vincent and the Grenadines|WS:Samoa|SM:San Marino|ST:Sao Tome and Principe|SA:Saudi Arabia|SN:Senegal|RS:Serbia|SC:Seychelles|SL:Sierra Leone|SG:Singapore|SK:Slovakia|SI:Slovenia|SB:Solomon Islands|SO:Somalia|ZA:South Africa|SS:South Sudan|ES:Spain|LK:Sri Lanka|SD:Sudan|SR:Suriname|SE:Sweden|CH:Switzerland|SY:Syria|TW:Taiwan|TJ:Tajikistan|TZ:Tanzania|TH:Thailand|TL:Timor-Leste|TG:Togo|TO:Tonga|TT:Trinidad and Tobago|TN:Tunisia|TR:Turkey|TM:Turkmenistan|TV:Tuvalu|UG:Uganda|UA:Ukraine|AE:United Arab Emirates|GB:United Kingdom|US:United States|UY:Uruguay|UZ:Uzbekistan|VU:Vanuatu|VA:Vatican City|VE:Venezuela|VN:Vietnam|YE:Yemen|ZM:Zambia|ZW:Zimbabwe')
  .split('|').map(s => { const i = s.indexOf(':'); return [s.slice(0, i), s.slice(i + 1)]; });

// step-1 input/label vocabulary (Accelerator Application.dc.html) — applied to every step
const F = {
  group: 'display:flex;flex-direction:column;gap:6px',
  label: 'font:600 10px Inter,sans-serif;letter-spacing:.14em;color:#4a4239;text-transform:uppercase',
  input: 'border:1px solid rgba(25,21,18,.25);background:#f7f1e6;padding:10px 12px;font-size:13px;color:#191512;font-family:Inter,sans-serif;width:100%;box-sizing:border-box;border-radius:0',
  req: '<span style="color:#9b1b22">*</span>'
};

// ---- view state ----
let D = null;                       // loaded data
let st = null;                      // overview ui state { follow, notified, host, faqOpen, cohortPage, results, codeErr }
let W = null;                       // wizard state { step, values, files, consents, submitted, busy }
let rootEl = null, unbind = null, timers = [], saveTimer = null, cleanupFns = [];
let cache = null;                   // { at, data } — tab switches inside 30 s reuse the load

function injectCss() {
  if (document.getElementById('mx-css-accelerator')) return;
  const l = document.createElement('link');
  l.id = 'mx-css-accelerator'; l.rel = 'stylesheet'; l.href = '/css/views/accelerator.css';
  document.head.appendChild(l);
}

// ---------------------------------------------------------------- data
const soft = p => p.catch(e => (e && e.status === 404 ? null : Promise.reject(e)));   // expected-404s stay quiet

async function load(force) {
  if (!force && cache && Date.now() - cache.at < 30000) return cache.data;
  const r = await api.settle({
    me: api.get('/api/auth/me'),
    program: soft(api.get('/api/accelerator/program', { noAuth: true })),
    institutions: api.get('/api/accelerator/institutions', { noAuth: true }),
    sites: api.get('/api/accelerator/sites', { noAuth: true }),
    overview: api.get('/api/accelerator/overview-config', { noAuth: true }),
    countdown: api.get('/api/accelerator/countdown', { noAuth: true }),
    intake: api.get('/api/accelerator/intake', { noAuth: true }),
    topics: api.get('/api/notify-topics'),
    mine: api.get('/api/accelerator/my-applications'),
    faq: soft(api.get('/api/portal-content/published/accelerator-faq', { noAuth: true })),
    alumni: soft(api.get('/api/v2/accelerator/alumni', { noAuth: true }))
  });
  if (r.me) session.update(Object.assign({}, r.me, { email_verified: (session.user || {}).email_verified }));
  const data = {
    me: session.user || r.me || {},
    program: r.program || null,
    hosts: buildHosts(r.sites, r.institutions),
    overview: r.overview || {},
    countdown: r.countdown && r.countdown.target ? r.countdown : null,
    intake: r.intake || null,
    followed: !!(r.topics && (r.topics.projects || []).includes('accelerator')),
    mine: Array.isArray(r.mine) ? r.mine : [],
    faq: Array.isArray(r.faq) && r.faq.length ? r.faq.map(x => ({ q: x.title || '', a: x.content || '' })) : null,
    alumni: r.alumni && Array.isArray(r.alumni.alumni) && r.alumni.alumni.length
      ? r.alumni.alumni.map(a => ({ name: a.name, where: a.year ? COPY.cohorts.classOf(a.year) : (a.placement_institution || '') }))
      : null,
    alumniYears: r.alumni && r.alumni.years ? r.alumni.years : null
  };
  cache = { at: Date.now(), data };
  return data;
}

// Host cards: accelerator_sites (admin "Where you could go" board) merged with
// accelerator_institutions (blurb/logo/website/positions) by name; institutions without a site
// row still get a card; both lists empty → the canonical four hosts as COPY.
function buildHosts(sitesRes, instRes) {
  const sites = (sitesRes && Array.isArray(sitesRes.sites)) ? sitesRes.sites : [];
  const insts = Array.isArray(instRes) ? instRes : [];
  const mentorOk = m => m && !/example|tbd/i.test(m);           // legacy render rule — hide seeded placeholders
  const cards = [];
  const instByName = new Map(insts.map(i => [String(i.name || '').toLowerCase(), i]));
  const usedInst = new Set();
  sites.forEach(s => {
    const inst = instByName.get(String(s.institution || '').toLowerCase()) || null;
    if (inst) usedInst.add(inst.id);
    cards.push({
      key: 's:' + s.id,
      abbr: (inst && inst.short_name) || abbrOf(s.institution),
      name: s.institution || '',
      city: [s.city, s.country].filter(Boolean).join(', '),
      blurb: (inst && inst.description) || '',
      lab: s.lab_or_clinic || '', mentor: mentorOk(s.mentor_line) ? s.mentor_line : '',
      spots: (s.spots === null || s.spots === undefined || s.spots === '') ? null : Number(s.spots),
      logo: (inst && inst.logo_url) || null, website: (inst && inst.website_url) || null,
      instId: inst ? inst.id : null
    });
  });
  insts.forEach(i => {
    if (usedInst.has(i.id)) return;
    cards.push({
      key: 'i:' + i.id, abbr: i.short_name || abbrOf(i.name), name: i.name || '',
      city: [i.city, i.country].filter(Boolean).join(', '), blurb: i.description || '',
      lab: '', mentor: '', spots: (i.available_spots === null || i.available_spots === undefined) ? null : Number(i.available_spots),
      logo: i.logo_url || null, website: i.website_url || null, instId: i.id
    });
  });
  if (cards.length) return cards;
  return FACTS.accelerator.hosts.map(n => ({ key: 'f:' + n, abbr: abbrOf(n), name: n, city: '', blurb: '', lab: '', mentor: '', spots: null, logo: null, website: null, instId: null }));
}
function abbrOf(name) {
  const words = String(name || '').replace(/[^A-Za-z ]/g, '').split(/\s+/).filter(w => w && !/^(of|the|and)$/i.test(w));
  return (words.length >= 2 ? words.map(w => w[0]).join('').slice(0, 4) : String(name || '').slice(0, 4)).toUpperCase();
}

// ---- open/close state (intake window is the admin source; FACTS is the fallback wording) ----
function zagrebDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  try { return d.toLocaleDateString('en-US', { timeZone: 'Europe/Zagreb', month: 'long', day: 'numeric', year: 'numeric' }); }
  catch (e) { return fmt.longRange(d); }
}
function openState() {
  if (D.intake && D.intake.state) return D.intake.state;        // 'before' | 'open' | 'closed'
  return Date.now() >= Date.parse(FACTS.accelerator.opens + 'T09:00:00+01:00') ? 'open' : 'before';
}
function opensInfo() {
  if (D.intake && D.intake.opens_at) { const l = zagrebDate(D.intake.opens_at); if (l) return { at: D.intake.opens_at, label: l }; }
  if (D.countdown && D.countdown.source === 'intake_opens') { const l = zagrebDate(D.countdown.target); if (l) return { at: D.countdown.target, label: l }; }
  return { at: FACTS.accelerator.opens + 'T09:00:00+01:00', label: FACTS.accelerator.opensLabel };
}
function placementLabel() {
  const y = new Date(opensInfo().at).getFullYear() || FACTS.year;
  return 'SUMMER ' + (y + 1);
}
function countdownInfo() {
  const state = openState();
  if (D.countdown && new Date(D.countdown.target) > new Date()) {
    const label = D.countdown.source === 'intake_opens' ? COPY.band.openIn
      : (D.countdown.source === 'intake_closes' || D.countdown.source === 'program_deadline') ? COPY.band.closeIn
      : fmt.upper(esc(D.countdown.label || '')) + ' IN';
    return { target: D.countdown.target, label };
  }
  if (state === 'before') return { target: opensInfo().at, label: COPY.band.openIn };
  return { target: null, label: COPY.band.open, big: state === 'closed' ? COPY.band.closed : COPY.band.openNow };
}
const daysTo = t => String(Math.max(0, Math.ceil((new Date(t) - new Date()) / 86400000)));

// ---- my-application state ----
function draftValues() { try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { return null; } }
function draftHasContent(v) { return !!v && Object.keys(v).some(k => String(v[k] || '').trim() !== ''); }
function appState() {
  const rows = D.mine;
  const row = rows.find(r => r.status !== 'draft') || null;
  if (row) {
    const s = String(row.status || '').toLowerCase();
    if (['accepted', 'waitlisted', 'rejected'].includes(s)) return { kind: 'result', row, decision: s };
    if (row.validity_status || row.reviewed_at) return { kind: 'review', row };
    return { kind: 'submitted', row };
  }
  const v = draftValues();
  if (draftHasContent(v)) return { kind: 'draft', pct: completionFor(v).pct };
  if (rows.length) return { kind: 'draft', row: rows[0], pct: 0 };
  return { kind: 'none' };
}

// ---- ONE completion source (checklist % + Review rows + stepper marks; README note 4) ----
function completionFor(values, files, submitted, consents) {
  const v = values || {}; const f = files || {}; const c = consents || {};
  const has = id => String(v[id] || '').trim() !== '';
  const items = [
    { key: 'personal', label: COPY.wiz.items[0], step: 1, done: has('axFirstName') && has('axLastName') && has('axEmail') && has('axDob') },
    { key: 'education', label: COPY.wiz.items[1], step: 2, done: has('axInstitution') && has('axDegree') && has('axYear') },
    { key: 'institutions', label: COPY.wiz.items[2], step: 3, done: has('axChoice1') },
    { key: 'motivation', label: COPY.wiz.items[3], step: 4, done: has('axStatement') },
    { key: 'documents', label: COPY.wiz.items[4], step: 5, done: !!(f.cv || submitted) },
    { key: 'review', label: COPY.wiz.items[5], step: 6, done: !!submitted }     // completes only on submit
  ];
  const done = items.filter(i => i.done).length;
  return { items, done, pct: Math.round((done / items.length) * 100), consentsDone: !!(c.c1 && c.c2 && c.c3) };
}
const completion = () => completionFor(W.values, W.files, W.submitted, W.consents);

// ---------------------------------------------------------------- shared blocks
function blockCrumbs(applyTab) {
  return `
  <!-- dc: ${applyTab ? 'Accelerator Application' : 'Accelerator'}.dc.html › "Breadcrumb" -->
  <div class="mx-crumbs mx-gutter" style="display:flex;align-items:center;gap:13px;padding:10px 36px;border-bottom:1px solid rgba(25,21,18,.16)">
    <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#4a4239">${COPY.crumbs.projects}</span>
    <span style="color:rgba(25,21,18,.35);font-size:10px">→</span>
    ${applyTab
      ? `<a href="/app/accelerator" style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em">${COPY.crumbs.name}</a>
    <span style="color:rgba(25,21,18,.35);font-size:10px">→</span>
    <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#191512">${COPY.crumbs.mine}</span>`
      : `<span style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#191512">${COPY.crumbs.name}</span>`}
  </div>
  <!-- /dc -->`;
}
function blockTabs(applyTab) {
  const on = 'font:600 10px Inter,sans-serif;letter-spacing:.15em;color:#9b1b22;border-bottom:2px solid #9b1b22;padding-bottom:3px;cursor:pointer;white-space:nowrap';
  const off = 'font:600 10px Inter,sans-serif;letter-spacing:.15em;color:#4a4239;text-decoration:none;white-space:nowrap';
  return `
  <!-- dc: Accelerator.dc.html › "Tabs" -->
  <div class="mx-tabs mx-gutter" style="display:flex;align-items:center;justify-content:center;gap:26px;padding:13px 36px;border-bottom:1px solid rgba(25,21,18,.16);flex-wrap:wrap">
    ${applyTab ? `<a href="/app/accelerator" style="${off}" data-hover="color:#191512">${COPY.tabs.overview}</a>` : `<span style="${on}" aria-current="page">${COPY.tabs.overview}</span>`}
    ${applyTab ? `<span style="${on}" aria-current="page">${COPY.tabs.apply}</span>` : `<a href="/app/accelerator/apply" style="${off}" data-hover="color:#191512">${COPY.tabs.apply}</a>`}
  </div>
  <!-- /dc -->`;
}

// ---------------------------------------------------------------- overview blocks
function heroCta() {
  const state = openState(); const a = appState();
  if (state === 'open') {
    const label = a.kind === 'none' ? COPY.hero.start : (a.kind === 'draft' ? COPY.hero.resume : COPY.hero.view);
    return `<span data-act="goApply" style="padding:13px 22px;background:#9b1b22;color:#f7f1e6;font:600 10.5px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;white-space:nowrap" data-hover="background:#7e151b">${label}</span>`;
  }
  if (a.kind !== 'none' && a.kind !== 'draft') {
    return `<span data-act="goApply" style="padding:13px 22px;background:#9b1b22;color:#f7f1e6;font:600 10.5px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;white-space:nowrap" data-hover="background:#7e151b">${COPY.hero.view}</span>`;
  }
  return `<span data-act="notify" style="padding:13px 22px;background:#9b1b22;color:#f7f1e6;font:600 10.5px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;white-space:nowrap" data-hover="background:#7e151b">${st.notified ? COPY.hero.notified : COPY.hero.notify}</span>`;
}
function blockHero() {
  const state = openState();
  const pill = state === 'open' ? COPY.hero.pillOpen(placementLabel())
    : state === 'closed' ? COPY.hero.pillClosed(placementLabel())
    : COPY.hero.pill(fmt.upper(esc(opensInfo().label)), placementLabel());
  return `
  <!-- dc: Accelerator.dc.html › "Hero" -->
  <div data-block="hero" style="position:relative;overflow:hidden">
    <img src="/assets/photo-hall.jpg" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">
    <div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(25,21,18,.72) 0%,rgba(25,21,18,.55) 55%,rgba(25,21,18,.85) 100%)"></div>
    <div class="mx-pad-hero" style="position:relative;padding:54px 36px 44px;display:flex;flex-direction:column;align-items:center;text-align:center">
      <span style="padding:6px 12px;border:1px solid rgba(201,169,98,.7);color:#c9a962;font:600 10px Inter,sans-serif;letter-spacing:.18em">${pill}</span>
      <div class="mx-ax-display-52" style="font-family:Fraunces,serif;font-size:52px;line-height:1.08;color:#f7f1e6;margin-top:20px">${COPY.hero.title}</div>
      <div style="font-size:15px;color:rgba(247,241,230,.85);margin-top:10px;max-width:560px">${COPY.hero.sub}</div>
      <div style="display:flex;gap:13px;margin-top:26px;justify-content:center;flex-wrap:wrap">${heroCta()}</div>
      <div style="display:flex;align-items:center;gap:10px;margin-top:20px">
        <span data-act="tgFollow" role="switch" aria-checked="${st.follow}" aria-label="Get updates from the Accelerator" style="width:34px;height:18px;flex:none;cursor:pointer;background:${st.follow ? '#9b1b22' : 'rgba(247,241,230,.3)'};position:relative;transition:background .3s"><span style="position:absolute;top:2px;width:14px;height:14px;background:#f7f1e6;transition:left .3s;left:${st.follow ? '18px' : '2px'}"></span></span>
        <span style="display:flex;flex-direction:column;gap:3px;text-align:left"><span style="font:600 10px Inter,sans-serif;letter-spacing:.16em;color:rgba(247,241,230,.8)">${COPY.hero.followLine(st.follow)}</span><span style="font-size:10.5px;color:rgba(247,241,230,.5)">${COPY.hero.followSub}</span></span>
      </div>
    </div>
  </div>
  <!-- /dc -->`;
}
function blockBand() {
  const cd = countdownInfo();
  const ov = D.overview || {};
  const duration = ov.programDuration ? fmt.upper(esc(fmt.dash(ov.programDuration))) : COPY.band.duration;
  const positions = COPY.band.positions(ov.positionsRange ? esc(fmt.dash(ov.positionsRange)) : '5–10');
  const sep = '<span style="width:1px;height:18px;background:rgba(247,241,230,.25)"></span>';
  return `
  <!-- dc: Accelerator.dc.html › "Stats band" -->
  <div class="mx-ax-band mx-pad-band" style="display:flex;align-items:center;justify-content:center;gap:26px;padding:13px 36px;background:#191512;color:#f7f1e6;flex-wrap:wrap">
    <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.18em;color:#c9a962">${cd.label}</span>
    <span style="display:flex;align-items:baseline;gap:6px"><span data-cd="opendays" style="font-family:Fraunces,serif;font-size:24px">${cd.target ? daysTo(cd.target) : cd.big}</span>${cd.target ? `<span style="font:600 8.5px Inter,sans-serif;letter-spacing:.14em;color:rgba(247,241,230,.65)">${COPY.band.days}</span>` : ''}</span>
    ${sep}
    <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:rgba(247,241,230,.9)">${duration}</span>
    ${sep}
    <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:rgba(247,241,230,.9)">${COPY.band.hosts(D.hosts.length)}</span>
    ${sep}
    <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:rgba(247,241,230,.9)">${positions}</span>
    ${sep}
    <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#c9a962">${COPY.band.stipend}</span>
  </div>
  <!-- /dc -->`;
}
function hostCards() {
  const cards = D.hosts.map((h, i) => `
      <div data-act="pickHost" data-i="${i}" aria-expanded="${st.host === i}" style="border:1px solid ${st.host === i ? '#191512' : 'rgba(25,21,18,.16)'};background:#fdfaf3;padding:16px;display:flex;gap:13px;align-items:center;cursor:pointer" data-hover="border-color:#191512">
        ${h.logo ? `<img src="${esc(h.logo)}" alt="" style="width:46px;height:46px;object-fit:contain;background:#191512;flex:none">` : `<span style="width:46px;height:46px;background:#191512;color:#c9a962;display:inline-flex;align-items:center;justify-content:center;font:600 11px Fraunces,serif;flex:none">${esc(h.abbr)}</span>`}
        <span style="min-width:0"><span style="display:block;font-family:Fraunces,serif;font-size:14.5px;line-height:1.2">${esc(h.name)}</span><span style="display:block;font-size:11px;color:#4a4239;margin-top:2px">${esc(h.city)}</span></span>
      </div>`).join('');
  const h = st.host !== null ? D.hosts[st.host] : null;
  const detailBits = h ? [
    h.blurb ? esc(h.blurb) : '',
    h.lab ? esc(h.lab) : '',
    h.mentor ? esc(h.mentor) : '',
    h.spots !== null && !isNaN(h.spots) ? esc(COPY.program.positions(h.spots)) : COPY.program.positionsTbc
  ].filter(Boolean).join(' · ') : '';
  const detail = h ? `
    <div style="border:1px solid rgba(25,21,18,.16);border-left:3px solid #9b1b22;background:#fdfaf3;padding:14px 18px;margin-bottom:14px;display:flex;gap:14px;align-items:baseline">
      <span style="font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#9b1b22;flex:none">${esc(h.name)}</span>
      <span style="font-size:12.5px;color:#4a4239;line-height:1.55;flex:1">${detailBits}${h.website ? ` · <a href="${esc(h.website)}" target="_blank" rel="noopener">${COPY.program.site}</a>` : ''}</span>
      <span data-act="closeHost" aria-label="Close" style="color:#4a4239;cursor:pointer;flex:none">×</span>
    </div>` : '';
  return `<div class="mx-ax-hosts" style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;padding-bottom:14px">${cards}</div>${detail}`;
}
function blockProgram() {
  const about = (D.overview && D.overview.aboutProgram) ? esc(D.overview.aboutProgram) : COPY.program.body;
  return `
  <!-- dc: Accelerator.dc.html › "01 · THE PROGRAM" -->
  <div class="mx-gutter" style="padding:0 36px">
    <div style="display:flex;align-items:baseline;gap:14px;padding:26px 0 10px">
      <span style="font-family:Fraunces,serif;font-weight:600;font-size:14px;color:#9b1b22">${COPY.program.n}</span>
      <span style="font:600 14px Inter,sans-serif;letter-spacing:.14em">${COPY.program.title}</span>
    </div>
    <div style="font-size:13.5px;color:#4a4239;line-height:1.65;max-width:860px">${about}</div>
    <div class="mx-wrap-row" style="display:flex;align-items:baseline;gap:14px;padding:16px 0 8px"><span style="font:600 11px Inter,sans-serif;letter-spacing:.16em;color:#c9a962">${COPY.program.whoTitle}</span><span style="font-size:12px;color:#4a4239">${COPY.program.whoSub}</span></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;padding:0 0 18px">
      ${COPY.program.chips.map(c => `<span style="padding:6px 11px;border:1px solid rgba(25,21,18,.22);font:600 9.5px Inter,sans-serif;letter-spacing:.14em;white-space:nowrap">${c}</span>`).join('\n      ')}
      <span style="padding:6px 11px;border:1px solid rgba(201,169,98,.65);color:#6e5626;font:600 9.5px Inter,sans-serif;letter-spacing:.14em;white-space:nowrap">${COPY.program.chipGold}</span>
    </div>
    <!-- dc: Accelerator.dc.html › "HOST LABS & CLINICS" -->
    <div id="acc-hosts" class="mx-wrap-row" style="display:flex;align-items:baseline;gap:14px;padding:4px 0 12px">
      <span style="font:600 11px Inter,sans-serif;letter-spacing:.16em;color:#c9a962">${COPY.program.hostsTitle}</span>
      <span style="font-size:12px;color:#4a4239">${COPY.program.hostsSub}</span>
    </div>
    <div data-block="hosts">${hostCards()}</div>
    <!-- /dc -->
    <div style="padding-bottom:14px"></div>
  </div>
  <!-- /dc -->`;
}
function blockIncluded() {
  return `
  <!-- dc: Accelerator.dc.html › "02 · WHAT'S INCLUDED" -->
  <div class="mx-gutter" style="padding:0 36px">
    <div style="display:flex;align-items:baseline;gap:14px;padding:24px 0 14px">
      <span style="font-family:Fraunces,serif;font-weight:600;font-size:14px;color:#9b1b22">${COPY.included.n}</span>
      <span style="font:600 14px Inter,sans-serif;letter-spacing:.14em">${COPY.included.title}</span>
    </div>
  </div>
  <div class="mx-pad-36" style="background:#191512;color:#f7f1e6;padding:30px 36px 32px;display:flex;flex-direction:column;align-items:center;gap:16px;text-align:center">
    <span style="display:flex;align-items:baseline;gap:12px;justify-content:center;flex-wrap:wrap"><span style="font-family:Fraunces,serif;font-size:36px;color:#c9a962">${COPY.included.stipend}</span><span style="font-size:13px;color:rgba(247,241,230,.7)">${COPY.included.stipendSub}</span></span>
    <span style="display:flex;gap:9px;flex-wrap:wrap;justify-content:center;font:600 9px Inter,sans-serif;letter-spacing:.14em">
      ${COPY.included.chips.map(c => `<span style="padding:6px 11px;border:1px solid rgba(247,241,230,.25);color:rgba(247,241,230,.85);white-space:nowrap">${c}</span>`).join('\n      ')}
    </span>
  </div>
  <!-- /dc -->`;
}
function blockSelection() {
  return `
  <!-- dc: Accelerator.dc.html › "03 · HOW SELECTION WORKS" -->
    <div id="acc-selection" style="display:flex;align-items:baseline;gap:14px;padding:24px 0 14px">
      <span style="font-family:Fraunces,serif;font-weight:600;font-size:14px;color:#9b1b22">${COPY.selection.n}</span>
      <span style="font:600 14px Inter,sans-serif;letter-spacing:.14em">${COPY.selection.title}</span>
    </div>
    <div class="mx-ax-selection" style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px">
      ${COPY.selection.steps(esc(opensInfo().label)).map(s => `
      <div style="border:1px solid rgba(25,21,18,.16);background:#fdfaf3;padding:18px;display:flex;flex-direction:column;gap:6px">
        <span style="font-family:Fraunces,serif;font-size:22px;color:#9b1b22">${s.n}</span>
        <span style="font-family:Fraunces,serif;font-size:15.5px">${esc(s.t)}</span>
        <span style="font-size:12px;color:#4a4239;line-height:1.5">${s.d}</span>
      </div>`).join('')}
    </div>
    <div style="font-family:Fraunces,serif;font-style:italic;font-size:13.5px;color:#4a4239;padding:14px 0 22px">${COPY.selection.note}</div>
  <!-- /dc -->`;
}
function applicationCard() {
  const state = openState(); const a = appState();
  const ghost = 'padding:10px 16px;border:1px solid rgba(25,21,18,.3);font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#191512;cursor:pointer;white-space:nowrap;text-decoration:none';
  const primary = 'padding:10px 16px;background:#9b1b22;color:#f7f1e6;font:600 10px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;white-space:nowrap';
  const previewBtn = `<a href="/app/accelerator/apply?preview=1" style="${ghost}" data-hover="border-color:#191512">${COPY.application.preview}</a>`;
  if (a.kind === 'none' || (a.kind === 'draft' && state !== 'open' && !a.row && !draftHasContent(draftValues()))) {
    const line = state === 'open' ? COPY.application.noneOpenLine : state === 'closed' ? COPY.application.closedLine : COPY.application.noneLine(esc(opensInfo().label));
    const actions = state === 'open'
      ? `<span data-act="goApply" style="${primary}" data-hover="background:#7e151b">${COPY.application.start}</span>`
      : `<span data-act="notify" style="${primary}" data-hover="background:#7e151b">${st.notified ? COPY.application.notified : COPY.application.notify}</span>${previewBtn}`;
    return `
        <div style="border:1px solid rgba(25,21,18,.16);background:#fdfaf3;padding:24px;display:flex;flex-direction:column;align-items:center;gap:9px;text-align:center">
          <span style="width:28px;height:1px;background:#c9a962"></span>
          <span style="font-family:Fraunces,serif;font-style:italic;font-size:17px;color:#4a4239">${line}</span>
          <span style="font-size:12.5px;color:#4a4239;max-width:380px">${state === 'open' ? COPY.application.openWhy : COPY.application.noneWhy}</span>
          <span style="margin-top:6px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;justify-content:center">${actions}</span>
        </div>`;
  }
  if (a.kind === 'draft') {
    const pct = a.pct !== undefined ? a.pct : 0;
    return `
        <div style="border:1px solid rgba(25,21,18,.16);background:#fdfaf3;padding:24px;display:flex;flex-direction:column;align-items:center;gap:9px;text-align:center">
          <span style="padding:3px 9px;border:1px solid rgba(201,169,98,.65);color:#6e5626;font:600 9px Inter,sans-serif;letter-spacing:.14em">${COPY.application.statusWord.draft}</span>
          <span style="font-family:Fraunces,serif;font-style:italic;font-size:17px;color:#4a4239">${COPY.application.draftLine(pct)}</span>
          <span style="font-size:12.5px;color:#4a4239;max-width:380px">${COPY.application.draftWhy}</span>
          <span style="margin-top:6px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;justify-content:center"><span data-act="goApply" style="${primary}" data-hover="background:#7e151b">${COPY.application.resume}</span></span>
        </div>`;
  }
  const row = a.row; const s = a.kind; const num = row.application_number || 'Your application';
  const when = row.submitted_at || row.created_at ? fmt.longRange(String(row.submitted_at || row.created_at).slice(0, 10)) : '';
  const chipWord = s === 'result' ? COPY.application.statusWord[a.decision] : s === 'review' ? COPY.application.statusWord.review : COPY.application.statusWord.submitted;
  const chipStyle = s === 'result' ? 'border:1px solid rgba(201,169,98,.85);color:#6e5626' : 'border:1px solid rgba(201,169,98,.65);color:#6e5626';
  const line = s === 'result' ? COPY.application.resultLine : COPY.application.subLine(esc(num), when ? esc(when) : '');
  const why = s === 'result' ? COPY.application.resultWhy : s === 'review' ? COPY.application.reviewWhy : COPY.application.subWhy;
  const feePending = String(row.status) === 'submitted' && String(row.payment_status || '') !== 'paid';
  return `
        <div style="border:1px solid rgba(25,21,18,.16);background:#fdfaf3;padding:24px;display:flex;flex-direction:column;align-items:center;gap:9px;text-align:center">
          <span style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:center">
            <span style="padding:3px 9px;${chipStyle};font:600 9px Inter,sans-serif;letter-spacing:.14em">${s === 'result' ? 'RESULT AVAILABLE' : chipWord}</span>
            ${s === 'result' ? `<span style="padding:3px 9px;border:1px solid rgba(25,21,18,.25);color:#191512;font:600 9px Inter,sans-serif;letter-spacing:.14em">${chipWord}</span>` : ''}
            ${row.institution_name ? `<span style="font-size:11px;color:#4a4239">${esc(row.institution_name)}</span>` : ''}
          </span>
          <span style="font-family:Fraunces,serif;font-style:italic;font-size:17px;color:#4a4239">${line}</span>
          <span style="font-size:12.5px;color:#4a4239;max-width:400px">${why}</span>
          <span style="margin-top:6px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;justify-content:center">
            <span data-act="goApply" style="${ghost}" data-hover="border-color:#191512">${COPY.application.view}</span>
            ${feePending ? `<span data-act="payFee" data-app="${esc(row.id)}" style="${primary}" data-hover="background:#7e151b">${COPY.application.payFee}</span>` : ''}
          </span>
          ${feePending ? `<span style="font-size:11px;color:#4a4239">${COPY.application.feeNote}</span>` : ''}
        </div>`;
}
function resultsBlock() {
  if (!st.results) return '';
  const rows = st.results.rows;
  if (!rows.length) return `<div data-v2="results" class="mx-ax-results" style="border:1px solid rgba(25,21,18,.16);background:#fdfaf3;padding:14px 18px;margin-bottom:14px;font-size:12.5px;color:#4a4239">${COPY.results.none}</div>`;
  const mineNums = new Set(D.mine.map(r => r.application_number).filter(Boolean));
  const cell = 'padding:8px 12px;font-size:12px;color:#191512;border-bottom:1px solid rgba(25,21,18,.1)';
  const num = v => (v === null || v === undefined || v === '' || isNaN(Number(v))) ? '—' : Number(v).toFixed(1);
  return `
      <div data-v2="results" class="mx-ax-results" style="border:1px solid rgba(25,21,18,.16);background:#fdfaf3;margin-bottom:14px">
        <div style="display:flex;align-items:baseline;gap:10px;padding:12px 18px;border-bottom:1px solid rgba(25,21,18,.16)">
          <span style="font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#9b1b22">${COPY.results.title(st.results.year || '')}</span>
          <span style="font-size:11.5px;color:#4a4239">${COPY.results.note}</span>
        </div>
        <table>
          <thead><tr>${COPY.results.cols.map(c => `<th style="${cell};font:600 9px Inter,sans-serif;letter-spacing:.14em;color:#4a4239;text-align:left;white-space:nowrap">${c}</th>`).join('')}</tr></thead>
          <tbody>
          ${rows.map((r, i) => {
            const own = mineNums.has(r.application_number);
            return `<tr${own ? ' style="background:#f7efdf"' : ''}>
              <td style="${cell};font-family:Fraunces,serif;font-size:14px">${esc(r.rank_position || i + 1)}</td>
              <td style="${cell};font:600 11px ui-monospace,Menlo,monospace;letter-spacing:.06em">${esc(r.application_number || '—')}${own ? ` <span style="font:600 8px Inter,sans-serif;letter-spacing:.14em;color:#9b1b22">${COPY.results.yours}</span>` : ''}</td>
              <td style="${cell}">${num(r.objective_score)}</td>
              <td style="${cell}">${num(r.interview_score)}</td>
              <td style="${cell};font-weight:600">${num(r.total_score)}</td>
              <td style="${cell};font:600 9px Inter,sans-serif;letter-spacing:.14em;color:${r.status === 'accepted' ? '#6e5626' : r.status === 'waitlisted' ? '#4a4239' : '#9b8f80'}">${esc(fmt.upper(r.status || '—'))}</td>
            </tr>`;
          }).join('')}
          </tbody>
        </table>
      </div>`;
}
function blockApplication() {
  return `
  <!-- dc: Accelerator.dc.html › "04 · YOUR APPLICATION" -->
    <div style="border-top:1px solid rgba(25,21,18,.16);padding-bottom:8px">
      <div data-block="application">${appSectionInner()}</div>
  <!-- /dc -->`;
}
function fellowsList() {
  const list = D.alumni || COPY.cohorts.fallback;
  const pages = Math.max(1, Math.ceil(list.length / 4));
  const pg = st.cohortPage % pages;
  const slice = list.slice(pg * 4, pg * 4 + 4);
  return `
            <div style="display:flex;align-items:baseline;gap:10px">
              <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.18em;color:#c9a962">${COPY.cohorts.fellowsLabel(D.alumniYears ? (D.alumniYears.from === D.alumniYears.to ? String(D.alumniYears.from) : `${D.alumniYears.from}–${D.alumniYears.to}`) : COPY.cohorts.range)}</span>
              <div style="flex:1"></div>
              <span style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:rgba(247,241,230,.55)">${pg + 1} / ${pages}</span>
            </div>
            <div class="mx-ax-fellows" style="display:flex;flex-direction:column;margin-top:10px">
              ${slice.map(f => `
              <div style="display:flex;gap:12px;align-items:baseline;padding:6px 0;border-bottom:1px solid rgba(247,241,230,.12)">
                <span style="font-family:Fraunces,serif;font-size:14px;flex:1">${esc(f.name)}</span>
                <span style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:rgba(247,241,230,.6);white-space:nowrap">${esc(f.where)}</span>
              </div>`).join('')}
            </div>
            <div style="margin-top:auto;font-size:10.5px;color:rgba(247,241,230,.5);padding-top:10px">${COPY.cohorts.foot(FACTS.accelerator.fellows)}</div>`;
}
function blockTeam() {
  return `
  <!-- dc: Accelerator.dc.html › "05 · THE TEAM" -->
      <div>
        <div style="display:flex;align-items:baseline;gap:14px;padding:24px 0 8px">
          <span style="font-family:Fraunces,serif;font-weight:600;font-size:14px;color:#9b1b22">${COPY.team.n}</span>
          <span style="font:600 14px Inter,sans-serif;letter-spacing:.14em">${COPY.team.title}</span>
        </div>
        ${COPY.team.people.map((p, i) => `
        <div style="display:flex;gap:16px;align-items:center;padding:10px 0;${i < COPY.team.people.length - 1 ? 'border-bottom:1px solid rgba(25,21,18,.12)' : ''}">
          <span style="width:36px;height:36px;background:${p.bg};color:${p.fg};display:inline-flex;align-items:center;justify-content:center;font:600 12px Fraunces,serif;flex:none">${p.init}</span>
          <span style="flex:1"><span style="display:block;font-size:13.5px;font-weight:600">${esc(p.name)}</span><span style="display:block;font-size:11.5px;color:#4a4239">${p.role}</span></span>
        </div>`).join('')}
        <!-- dc: Accelerator.dc.html › "PREVIOUS COHORTS" -->
        <div class="mx-wrap-row" style="display:flex;align-items:baseline;gap:14px;padding:20px 0 10px">
          <span style="font:600 11px Inter,sans-serif;letter-spacing:.16em;color:#c9a962">${COPY.cohorts.title}</span>
          <span style="font-size:12px;color:#4a4239">${COPY.cohorts.sub}</span>
        </div>
        <div class="mx-ax-cohorts" style="display:grid;grid-template-columns:1fr 1fr 1.2fr;grid-auto-rows:220px;gap:12px;padding-bottom:24px">
          <div style="position:relative;overflow:hidden;background:repeating-linear-gradient(45deg,rgba(25,21,18,.08) 0 10px,rgba(25,21,18,.03) 10px 20px)"><img data-role="cohort-photo" src="${COPY.cohorts.photo1.src}" alt="${COPY.cohorts.photo1.alt}" loading="lazy" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 30%;display:block"></div>
          <div style="position:relative;overflow:hidden;background:repeating-linear-gradient(45deg,rgba(25,21,18,.08) 0 10px,rgba(25,21,18,.03) 10px 20px)"><img data-role="cohort-photo" src="${COPY.cohorts.photo2.src}" alt="${COPY.cohorts.photo2.alt}" loading="lazy" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 30%;display:block"></div>
          <div style="background:#191512;color:#f7f1e6;padding:18px 22px;display:flex;flex-direction:column">
            <div data-block="fellows" style="display:flex;flex-direction:column;flex:1;min-height:0">${fellowsList()}</div>
          </div>
        </div>
        <!-- /dc -->
      </div>
    </div>
  <!-- /dc -->`;
}
function faqRows() {
  const list = D.faq || COPY.faq.list(esc(opensInfo().label));
  return list.map((f, i) => `
        <div style="border-bottom:1px solid rgba(25,21,18,.12)">
          <div data-act="faq" data-i="${i}" aria-expanded="${st.faqOpen === i}" style="display:flex;gap:12px;align-items:center;padding:11px 0;cursor:pointer"><span style="font-size:13px;flex:1">${D.faq ? esc(f.q) : f.q}</span><span style="color:#9b1b22;font-size:11px">${st.faqOpen === i ? '▲' : '▾'}</span></div>
          ${st.faqOpen === i ? `<div style="font-size:12.5px;color:#4a4239;line-height:1.6;padding:0 0 14px;max-width:520px">${D.faq ? esc(f.a) : f.a}</div>` : ''}
        </div>`).join('');
}
function blockFaq() {
  return `
  <!-- dc: Accelerator.dc.html › "06 · FREQUENTLY ASKED" -->
    <div style="border-top:1px solid rgba(25,21,18,.16)">
      <div style="display:flex;align-items:baseline;gap:14px;padding:24px 0 8px">
        <span style="font-family:Fraunces,serif;font-weight:600;font-size:14px;color:#9b1b22">${COPY.faq.n}</span>
        <span style="font:600 14px Inter,sans-serif;letter-spacing:.14em">${COPY.faq.title}</span>
      </div>
      <div data-block="faq" class="mx-ax-faq" style="display:grid;grid-template-columns:1fr 1fr;gap:0 44px;align-items:start;padding-bottom:24px">${faqRows()}</div>
    </div>
  <!-- /dc -->`;
}
function blockFooter() {
  return `
  <!-- dc: Accelerator.dc.html › "Footer · MESSAGE US" -->
  <div class="mx-gutter mx-wrap-row" style="display:flex;align-items:center;gap:20px;padding:18px 36px 30px;border-top:1px solid rgba(25,21,18,.16);flex-wrap:wrap">
    <span style="font-family:Fraunces,serif;font-style:italic;font-size:16px;color:#4a4239">${COPY.footer.line}</span>
    <span style="font-size:12px;color:#4a4239">${COPY.footer.sub}</span>
    <div style="flex:1"></div>
    <a href="/app/messages?about=accelerator" style="padding:10px 16px;background:#9b1b22;color:#f7f1e6;font:600 10px Inter,sans-serif;letter-spacing:.16em;white-space:nowrap" data-hover="background:#7e151b;color:#f7f1e6">${COPY.footer.cta}</a>
  </div>
  <!-- /dc -->`;
}
function overviewTemplate() {
  return `
<div data-screen-label="Accelerator" style="font-family:Inter,sans-serif;color:#191512;background:#f7f1e6;min-height:100vh">
  ${blockCrumbs(false)}
  ${blockTabs(false)}
  ${blockHero()}
  ${blockBand()}
  ${blockProgram()}
  ${blockIncluded()}
  <div class="mx-gutter" style="padding:0 36px">
    ${blockSelection()}
    ${blockApplication()}
    ${blockTeam()}
    ${blockFaq()}
  </div>
  ${blockFooter()}
</div>`;
}

// ---------------------------------------------------------------- wizard blocks
function wizHosts() {                       // institution options for the choice selects
  const opts = [];
  const seen = new Set();
  D.hosts.forEach(h => { if (h.instId && !seen.has(h.instId)) { seen.add(h.instId); opts.push({ id: h.instId, name: h.name }); } });
  if (!opts.length) Object.keys(LEGACY_INSTITUTIONS).forEach(k => opts.push({ id: k, name: LEGACY_INSTITUTIONS[k] }));
  return opts;
}
function choiceName(v) {
  if (!v) return '';
  const hit = wizHosts().find(o => o.id === v);
  return hit ? hit.name : (LEGACY_INSTITUTIONS[v] || v);
}
function normalizeChoice(v) {               // old drafts stored legacy slugs — map them onto live ids
  if (!v) return '';
  const opts = wizHosts();
  if (opts.some(o => o.id === v)) return v;
  const name = LEGACY_INSTITUTIONS[v];
  const byName = name && opts.find(o => o.name.toLowerCase() === name.toLowerCase());
  return byName ? byName.id : v;
}
function countryCode(v) {
  if (!v) return '';
  const s = String(v).trim();
  if (COUNTRIES.some(([c]) => c === s.toUpperCase())) return s.toUpperCase();
  const byName = COUNTRIES.find(([, n]) => n.toLowerCase() === s.toLowerCase());
  return byName ? byName[0] : '';
}

function initWizard() {
  if (W) { W.submitted = (appState().kind !== 'none' && appState().kind !== 'draft') ? appState().row : W.submitted; return; }
  const a = appState();
  const saved = draftValues() || {};
  const me = D.me || {};
  const v = {};                              // legacy field ids, verbatim (collectFormData)
  ['axFirstName', 'axLastName', 'axEmail', 'axPhone', 'axDob', 'axNationality', 'axCountry', 'axInstitution', 'axDegree', 'axYear',
    'axField', 'axGraduation', 'axChoice1', 'axChoice2', 'axChoice3', 'axResearchInterests', 'axStatement', 'axExperience', 'axPublications']
    .forEach(k => { v[k] = saved[k] !== undefined && saved[k] !== null ? String(saved[k]) : ''; });
  // prefill from the member profile where the draft is empty (legacy prefillUserData)
  if (!v.axFirstName) v.axFirstName = me.first_name || '';
  if (!v.axLastName) v.axLastName = me.last_name || '';
  if (!v.axEmail) v.axEmail = me.email || '';
  if (!v.axPhone) v.axPhone = me.phone || '';
  if (!v.axCountry) v.axCountry = countryCode(me.country);
  if (!v.axInstitution) v.axInstitution = me.institution || '';
  v.axChoice1 = normalizeChoice(v.axChoice1); v.axChoice2 = normalizeChoice(v.axChoice2); v.axChoice3 = normalizeChoice(v.axChoice3);
  let step = 1;
  try { step = Math.min(7, Math.max(1, parseInt(localStorage.getItem(STEP_KEY) || '1', 10) || 1)); } catch (e) {}
  const submittedRow = (a.kind === 'submitted' || a.kind === 'review' || a.kind === 'result') ? a.row : null;
  W = { step: submittedRow ? 7 : step, values: v, files: { cv: null, transcript: null, recommendation: null }, consents: { c1: false, c2: false, c3: false }, submitted: submittedRow, busy: false, savedAt: null, saving: false };
}
function persistDraft() {
  if (W.submitted) return;
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(W.values)); localStorage.setItem(STEP_KEY, String(W.step)); } catch (e) {}
  W.saving = false; W.savedAt = Date.now();
  const el = rootEl && rootEl.querySelector('[data-role="saved"]'); if (el) el.textContent = savedLabel();
}
function scheduleSave() {
  W.saving = true;
  const el = rootEl && rootEl.querySelector('[data-role="saved"]'); if (el) el.textContent = COPY.wiz.saved.saving;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistDraft, 600);
}
function savedLabel() {
  if (W.submitted) { const d = W.submitted.submitted_at || W.submitted.created_at; return 'Submitted' + (d ? ' ' + fmt.longRange(String(d).slice(0, 10)) : ''); }
  if (W.saving) return COPY.wiz.saved.saving;
  if (!W.savedAt) return draftHasContent(draftValues()) ? COPY.wiz.saved.just : COPY.wiz.saved.none;
  const ago = Date.now() - W.savedAt;
  return ago < 60000 ? COPY.wiz.saved.just : COPY.wiz.saved.at(new Date(W.savedAt).toTimeString().slice(0, 5));
}

function blockWizHeader(preview) {
  const state = openState();
  const sub = W.submitted ? COPY.wiz.subDone : COPY.wiz.sub;
  const pill = W.submitted
    ? COPY.wiz.pillSubmitted(W.submitted.submitted_at || W.submitted.created_at ? fmt.longRange(String(W.submitted.submitted_at || W.submitted.created_at).slice(0, 10)) : '')
    : (preview && state !== 'open') ? COPY.wiz.pillPreview(fmt.upper(esc(opensInfo().label)))
    : COPY.wiz.pillDraft;
  const right = state === 'open'
    ? (D.intake && D.intake.closes_at ? COPY.wiz.closes(fmt.upper(esc(zagrebDate(D.intake.closes_at)))) : COPY.wiz.open)
    : state === 'closed' ? COPY.wiz.closed
    : COPY.wiz.opens(fmt.upper(esc(opensInfo().label)));
  return `
  <!-- dc: Accelerator Application.dc.html › "Header band" -->
  <div class="mx-pad-36" style="background:#191512;color:#f7f1e6;padding:26px 36px 22px">
    <div style="display:flex;align-items:baseline;gap:16px;flex-wrap:wrap">
      <span style="font:600 10px Inter,sans-serif;letter-spacing:.18em;color:#c9a962">${COPY.wiz.eyebrow(placementLabel())}</span>
      <span style="padding:3px 9px;border:1px solid rgba(201,169,98,.65);color:#c9a962;font:600 9px Inter,sans-serif;letter-spacing:.14em">${pill}</span>
      <div style="flex:1"></div>
      <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.14em;color:rgba(247,241,230,.65)">${right}</span>
    </div>
    <div class="mx-ax-display-34" style="font-family:Fraunces,serif;font-size:34px;margin-top:8px">${COPY.wiz.title}</div>
    <div style="font-size:12.5px;color:rgba(247,241,230,.7);margin-top:5px">${sub}</div>
  </div>
  <!-- /dc -->`;
}
function blockStepper() {
  const c = completion();
  const doneByStep = { 1: c.items[0].done, 2: c.items[1].done, 3: c.items[2].done, 4: c.items[3].done, 5: c.items[4].done, 6: c.consentsDone || !!W.submitted, 7: !!W.submitted };
  return `
  <!-- dc: Accelerator Application.dc.html › "Stepper" -->
  <div data-block="stepper" class="mx-ax-stepper" style="display:flex;justify-content:center;gap:0;padding:18px 36px 0;border-bottom:1px solid rgba(25,21,18,.16);flex-wrap:wrap">
    ${COPY.wiz.steps.map((label, i) => {
      const n = i + 1, cur = n === W.step, done = doneByStep[n] && !cur;
      return `
    <div data-act="go" data-step="${n}" role="tab" aria-selected="${cur}" aria-label="Step ${n} · ${label}" style="display:flex;flex-direction:column;align-items:center;gap:7px;padding:0 18px 14px;cursor:pointer;position:relative">
      <span style="width:30px;height:30px;display:inline-flex;align-items:center;justify-content:center;font:600 13px Fraunces,serif;background:${cur ? '#9b1b22' : done ? '#191512' : 'transparent'};color:${cur || done ? '#f7f1e6' : '#4a4239'};border:1px solid ${cur ? '#9b1b22' : done ? '#191512' : 'rgba(25,21,18,.3)'}">${done ? '✓' : n}</span>
      <span style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:${cur ? '#9b1b22' : done ? '#191512' : '#4a4239'}">${label}</span>
      <span style="position:absolute;left:0;right:0;bottom:-1px;height:2px;background:${cur ? '#9b1b22' : 'transparent'}"></span>
    </div>`;
    }).join('')}
  </div>
  <!-- /dc -->`;
}

// ---- fields (step-1 vocabulary applied to every step; ids/types/limits verbatim from the legacy wizard) ----
function fld({ id, label, req = false, type = 'text', ph = '', span = false, ac = '', max = '', min = '', maxd = '' }) {
  return `
          <label class="mx-ax-field" style="${F.group}${span ? ';grid-column:1 / -1' : ''}">
            <span style="${F.label}">${label}${req ? ' ' + F.req : ''}</span>
            <input type="${type}" data-field="${id}" value="${esc(W.values[id] || '')}"${ph ? ` placeholder="${esc(ph)}"` : ''}${ac ? ` autocomplete="${ac}"` : ''}${max ? ` maxlength="${max}"` : ''}${min ? ` min="${min}"` : ''}${maxd ? ` max="${maxd}"` : ''}${req ? ' required' : ''} style="${F.input}">
          </label>`;
}
function area({ id, label, req = false, rows = 3, ph = '', span = true }) {
  return `
          <label class="mx-ax-field" style="${F.group}${span ? ';grid-column:1 / -1' : ''}">
            <span style="${F.label}">${label}${req ? ' ' + F.req : ''}</span>
            <textarea data-field="${id}" rows="${rows}" maxlength="2000"${ph ? ` placeholder="${esc(ph)}"` : ''} style="${F.input};resize:vertical;line-height:1.5">${esc(W.values[id] || '')}</textarea>
          </label>`;
}
function sel({ id, label, req = false, opts, ph, span = false }) {
  const v = W.values[id] || '';
  const known = opts.some(o => o[0] === v);
  return `
          <label class="mx-ax-field" style="${F.group}${span ? ';grid-column:1 / -1' : ''}">
            <span style="${F.label}">${label}${req ? ' ' + F.req : ''}</span>
            <select data-field="${id}" style="${F.input}">
              <option value="">${esc(ph)}</option>
              ${opts.map(o => `<option value="${esc(o[0])}"${o[0] === v ? ' selected' : ''}>${esc(o[1])}</option>`).join('')}
              ${v && !known ? `<option value="${esc(v)}" selected>${esc(choiceName(v))}</option>` : ''}
            </select>
          </label>`;
}
function docZone(key, label, req) {
  const file = W.files[key];
  const zone = file
    ? `<div class="mx-ax-drop" data-act="pickFile" data-doc="${key}" role="button" aria-label="Replace ${key} file" style="border:1px solid rgba(201,169,98,.75);background:#fdfaf3;padding:12px 14px;display:flex;align-items:center;gap:12px;cursor:pointer">
         <span style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:#6e5626;white-space:nowrap">PDF</span>
         <span style="font-size:12.5px;color:#191512;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(file.name)} <span style="color:#4a4239">(${(file.size / 1024).toFixed(1)} KB)</span></span>
         <span data-act="clearFile" data-doc="${key}" style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:#9b1b22;cursor:pointer;white-space:nowrap">${COPY.wiz.upload.remove}</span>
       </div>`
    : `<div class="mx-ax-drop" data-act="pickFile" data-doc="${key}" role="button" aria-label="Upload ${key}" style="border:1px dashed rgba(25,21,18,.3);background:#f7f1e6;padding:18px 14px;display:flex;flex-direction:column;align-items:center;gap:5px;cursor:pointer;text-align:center">
         <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.15em;color:#9b1b22">${COPY.wiz.upload.click}<span style="color:#4a4239;letter-spacing:.06em;text-transform:none;font-weight:400">${COPY.wiz.upload.drag}</span></span>
         <span style="font-size:11px;color:#4a4239">${COPY.wiz.upload.pdf}</span>
       </div>`;
  return `
          <div class="mx-ax-field" style="${F.group};grid-column:1 / -1">
            <span style="${F.label}">${label}${req ? ' ' + F.req : ''}</span>
            ${zone}
            <input type="file" data-role="file-${key}" accept=".pdf,application/pdf" style="display:none" aria-hidden="true" tabindex="-1">
          </div>`;
}

function stepHead(n, title, subHtml) {
  return `
        <div class="mx-ax-panel-pad" style="padding:24px 28px 8px">
          <div style="display:flex;align-items:baseline;gap:14px">
            <span style="font-family:Fraunces,serif;font-weight:600;font-size:14px;color:#9b1b22">0${n}</span>
            <span style="font-family:Fraunces,serif;font-size:22px">${title}</span>
          </div>
          ${subHtml ? `<div style="font-size:12px;color:#4a4239;margin-top:4px">${subHtml}</div>` : ''}
        </div>`;
}
const GRID2 = 'display:grid;grid-template-columns:1fr 1fr;gap:16px 20px;padding:18px 28px 26px';
function stepPanel() {
  const s = W.step;
  if (W.submitted && s === 7) return panelSubmitted();
  if (s === 1) return `${stepHead(1, COPY.wiz.stepTitles[0], COPY.wiz.required)}
        <div class="mx-ax-fields mx-ax-panel-pad" style="${GRID2}">
          ${fld({ id: 'axFirstName', label: 'FIRST NAME', req: true, ac: 'given-name', max: 100 })}
          ${fld({ id: 'axLastName', label: 'LAST NAME', req: true, ac: 'family-name', max: 100 })}
          ${fld({ id: 'axEmail', label: 'EMAIL', req: true, type: 'email', ac: 'email', max: 254, span: true })}
          ${fld({ id: 'axPhone', label: 'PHONE', type: 'tel', ph: '+1 234 567 8900', max: 50 })}
          ${fld({ id: 'axDob', label: 'DATE OF BIRTH', req: true, type: 'date', min: '1900-01-01', maxd: '2015-12-31' })}
          ${fld({ id: 'axNationality', label: 'NATIONALITY', req: true, ph: 'e.g. Croatian', ac: 'country-name', max: 100 })}
          ${sel({ id: 'axCountry', label: 'COUNTRY OF RESIDENCE', req: true, opts: COUNTRIES, ph: 'Select country' })}
        </div>`;
  if (s === 2) return `${stepHead(2, COPY.wiz.stepTitles[1], COPY.wiz.required)}
        <div class="mx-ax-fields mx-ax-panel-pad" style="${GRID2}">
          ${fld({ id: 'axInstitution', label: 'CURRENT INSTITUTION', req: true, ph: 'University name', ac: 'organization', max: 200, span: true })}
          ${sel({ id: 'axDegree', label: 'DEGREE PROGRAM', req: true, opts: DEGREES, ph: 'Select degree' })}
          ${sel({ id: 'axYear', label: 'YEAR OF STUDY', req: true, opts: YEARS, ph: 'Select year' })}
          ${fld({ id: 'axField', label: 'FIELD OF STUDY', req: true, ph: 'e.g. Neuroscience, Oncology, Public Health', max: 200, span: true })}
          ${fld({ id: 'axGraduation', label: 'EXPECTED GRADUATION', type: 'month' })}
        </div>`;
  if (s === 3) { const opts = wizHosts().map(o => [o.id, o.name]); return `${stepHead(3, COPY.wiz.stepTitles[2], 'Select up to 3 institutions in order of preference.')}
        <div class="mx-ax-fields mx-ax-panel-pad" style="${GRID2}">
          ${sel({ id: 'axChoice1', label: 'FIRST CHOICE', req: true, opts, ph: 'Select institution', span: true })}
          ${sel({ id: 'axChoice2', label: 'SECOND CHOICE', opts, ph: 'Select institution', span: true })}
          ${sel({ id: 'axChoice3', label: 'THIRD CHOICE', opts, ph: 'Select institution', span: true })}
          ${area({ id: 'axResearchInterests', label: 'RESEARCH INTEREST AREAS', req: true, rows: 3, ph: 'Describe your research interests...' })}
        </div>`; }
  if (s === 4) return `${stepHead(4, COPY.wiz.stepTitles[3], COPY.wiz.required)}
        <div class="mx-ax-fields mx-ax-panel-pad" style="${GRID2}">
          ${area({ id: 'axStatement', label: 'PERSONAL STATEMENT (MAX 500 WORDS)', req: true, rows: 6, ph: 'Why do you want to participate in the Accelerator program? What do you hope to achieve?' })}
          ${area({ id: 'axExperience', label: 'RESEARCH EXPERIENCE', rows: 4, ph: 'Describe any previous research experience...' })}
          ${area({ id: 'axPublications', label: 'PUBLICATIONS / PRESENTATIONS (IF ANY)', rows: 3, ph: 'List any publications, conference presentations, or posters...' })}
        </div>`;
  if (s === 5) return `${stepHead(5, COPY.wiz.stepTitles[4], 'PDF up to 5MB each · they upload when you submit.')}
        <div class="mx-ax-fields mx-ax-panel-pad" style="${GRID2}">
          ${docZone('cv', 'CV / RESUME (PDF)', true)}
          ${docZone('transcript', 'TRANSCRIPT (PDF)', true)}
          ${docZone('recommendation', 'LETTER OF RECOMMENDATION (OPTIONAL, PDF)', false)}
        </div>`;
  if (s === 6) return `${stepHead(6, COPY.wiz.stepTitles[5], '')}
        <div class="mx-ax-panel-pad" style="padding:14px 28px 26px;display:flex;flex-direction:column;gap:16px">
          <div style="border:1px solid rgba(25,21,18,.16);border-left:3px solid #c9a962;background:#f7f1e6;padding:14px 16px;font-size:12.5px;color:#4a4239;line-height:1.6">${COPY.wiz.gdpr}</div>
          ${COPY.wiz.consents.map((c, i) => `
          <label style="display:flex;align-items:flex-start;gap:12px;cursor:pointer">
            <input type="checkbox" data-consent="c${i + 1}"${W.consents['c' + (i + 1)] ? ' checked' : ''} style="margin-top:3px;width:16px;height:16px;flex:none">
            <span style="font-size:13px;color:#191512;line-height:1.55">${c} ${F.req}</span>
          </label>`).join('')}
        </div>`;
  return panelReview();
}
function panelReview() {
  const c = completion();
  const canSubmit = c.items.slice(0, 5).every(i => i.done) && c.consentsDone;
  const v = W.values;
  const docs = [W.files.cv && 'CV', W.files.transcript && 'Transcript', W.files.recommendation && 'Recommendation'].filter(Boolean);
  const sumRow = (l, val) => `<div style="display:flex;justify-content:space-between;gap:18px;padding:5px 0"><span style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:#4a4239;white-space:nowrap">${l}</span><span style="font-size:12.5px;color:#191512;text-align:right;min-width:0;overflow-wrap:anywhere">${val || '—'}</span></div>`;
  const degree = (DEGREES.find(d => d[0] === v.axDegree) || [])[1] || '';
  return `${stepHead(7, COPY.wiz.stepTitles[6], COPY.wiz.reviewSub)}
        <div class="mx-ax-panel-pad" style="padding:14px 28px 26px">
          ${c.items.map((it, i) => `
          <div style="display:flex;gap:14px;align-items:center;padding:12px 0;border-bottom:1px solid rgba(25,21,18,.12)">
            <span style="width:12px;height:12px;border:1px solid ${it.done ? '#c9a962' : 'rgba(25,21,18,.35)'};background:${it.done ? '#c9a962' : 'transparent'};flex:none"></span>
            <span style="font-family:Fraunces,serif;font-size:15.5px;flex:1">${it.label}</span>
            <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.14em;color:${it.done ? '#191512' : '#9b1b22'}">${it.done ? COPY.wiz.reviewStatus.done : COPY.wiz.reviewStatus.todo}</span>
            <span data-act="go" data-step="${it.step}" style="font:600 9.5px Inter,sans-serif;letter-spacing:.14em;color:#9b1b22;cursor:pointer;white-space:nowrap">${COPY.wiz.edit}</span>
          </div>`).join('')}
          <!-- v2: legacy Application Summary (app.part9.js › updateReview), quiet definition list -->
          <div style="border:1px solid rgba(25,21,18,.16);background:#f7f1e6;padding:14px 18px;margin-top:16px">
            <div style="font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#c9a962;padding-bottom:6px">${COPY.wiz.summaryTitle}</div>
            ${sumRow('NAME', esc([v.axFirstName, v.axLastName].filter(Boolean).join(' ')))}
            ${sumRow('EMAIL', esc(v.axEmail))}
            ${sumRow('INSTITUTION', esc(v.axInstitution))}
            ${sumRow('DEGREE', esc(degree))}
            ${sumRow('FIRST CHOICE', esc(choiceName(v.axChoice1)))}
            ${sumRow('SECOND CHOICE', esc(choiceName(v.axChoice2)))}
            ${sumRow('DOCUMENTS', esc(docs.length ? docs.join(', ') : 'None uploaded'))}
          </div>
          <div style="display:flex;align-items:center;gap:14px;padding-top:18px;flex-wrap:wrap">
            <span data-act="submit" role="button" aria-disabled="${canSubmit && !W.busy ? 'false' : 'true'}" style="padding:12px 20px;background:${canSubmit && !W.busy ? '#9b1b22' : 'rgba(155,27,34,.35)'};color:#f7f1e6;font:600 10px Inter,sans-serif;letter-spacing:.16em;cursor:${canSubmit && !W.busy ? 'pointer' : 'not-allowed'};white-space:nowrap"${canSubmit && !W.busy ? ' data-hover="background:#7e151b"' : ''}>${W.busy ? COPY.wiz.submitting : COPY.wiz.submit}</span>
            <span data-act="pdf" style="padding:12px 20px;border:1px solid rgba(25,21,18,.3);font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#191512;cursor:pointer;white-space:nowrap" data-hover="border-color:#191512">${COPY.wiz.pdf}</span>
            <span style="font-size:11.5px;color:#4a4239">${canSubmit ? COPY.wiz.summaryNote : COPY.wiz.submitHint}</span>
          </div>
        </div>`;
}
function panelSubmitted() {
  const r = W.submitted;
  const when = r && (r.submitted_at || r.created_at) ? fmt.longRange(String(r.submitted_at || r.created_at).slice(0, 10)) : '';
  const feePending = r && String(r.status) === 'submitted' && String(r.payment_status || '') !== 'paid';
  return `${stepHead(7, COPY.wiz.stepTitles[6], '')}
        <div class="mx-ax-panel-pad" style="padding:10px 28px 26px;display:flex;flex-direction:column;align-items:center;gap:9px;text-align:center">
          <span style="width:28px;height:1px;background:#c9a962"></span>
          <span style="font-family:Fraunces,serif;font-style:italic;font-size:19px;color:#191512">${COPY.wiz.submittedLine(esc(r && r.application_number || 'received'))}</span>
          <span style="font-size:12.5px;color:#4a4239;max-width:420px">${COPY.wiz.submittedWhy(esc((r && r.email) || ''))}${when ? ` Submitted ${esc(when)}.` : ''}</span>
          <span style="margin-top:8px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;justify-content:center">
            <a href="/app/accelerator" style="padding:10px 16px;border:1px solid rgba(25,21,18,.3);font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#191512;white-space:nowrap;text-decoration:none" data-hover="border-color:#191512">BACK TO THE OVERVIEW →</a>
            ${feePending ? `<span data-act="payFee" data-app="${esc(r.id)}" style="padding:10px 16px;background:#9b1b22;color:#f7f1e6;font:600 10px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;white-space:nowrap" data-hover="background:#7e151b">${COPY.application.payFee}</span>` : ''}
          </span>
          ${feePending ? `<span style="font-size:11px;color:#4a4239">${COPY.application.feeNote}</span>` : ''}
        </div>`;
}
function blockChecklist() {
  const c = completion();
  return `
      <div data-block="checklist" style="border:1px solid rgba(25,21,18,.16);background:#fdfaf3;padding:20px 22px">
        <div style="font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#c9a962">${COPY.wiz.checklist.title}</div>
        <div style="margin-top:12px;display:flex;flex-direction:column">
          ${c.items.map(it => `
          <div style="display:flex;gap:11px;align-items:center;padding:8px 0;border-bottom:1px solid rgba(25,21,18,.1)">
            <span style="width:11px;height:11px;border:1px solid ${it.done ? '#c9a962' : 'rgba(25,21,18,.35)'};background:${it.done ? '#c9a962' : 'transparent'};flex:none"></span>
            <span style="font-size:12px;color:${it.done ? '#191512' : '#4a4239'}">${it.label}</span>
          </div>`).join('')}
        </div>
        <div style="display:flex;align-items:baseline;gap:8px;padding-top:14px">
          <span style="font-family:Fraunces,serif;font-size:30px;color:#c9a962">${c.pct}%</span>
          <span style="font:600 9px Inter,sans-serif;letter-spacing:.16em;color:#4a4239">${COPY.wiz.checklist.complete}</span>
        </div>
        <div style="height:3px;background:rgba(25,21,18,.12);position:relative;margin-top:6px"><span style="position:absolute;left:0;top:0;bottom:0;background:#c9a962;width:${c.pct}%"></span></div>
      </div>`;
}
function blockRail() {
  return `
    <div style="display:flex;flex-direction:column;gap:14px">
      <!-- dc: Accelerator Application.dc.html › "APPLICATION CHECKLIST" -->
      ${blockChecklist()}
      <!-- /dc -->
      <!-- dc: Accelerator Application.dc.html › "BEFORE YOU START" -->
      <div style="border:1px solid rgba(25,21,18,.16);background:#fdfaf3;padding:18px 22px;display:flex;flex-direction:column;gap:8px">
        <span style="font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#c9a962">${COPY.wiz.before.title}</span>
        <span style="font-size:12px;color:#4a4239;line-height:1.55">${COPY.wiz.before.body}</span>
      </div>
      <!-- /dc -->
      <!-- dc: Accelerator Application.dc.html › "Stuck on a question?" -->
      <div style="border:1px solid rgba(25,21,18,.16);background:#fdfaf3;padding:18px 22px;display:flex;flex-direction:column;gap:9px;align-items:flex-start">
        <span style="font-family:Fraunces,serif;font-style:italic;font-size:14.5px;color:#4a4239">${COPY.wiz.stuck.line}</span>
        <span style="font-size:11.5px;color:#4a4239;line-height:1.5">${COPY.wiz.stuck.body}</span>
        <a href="/app/messages?about=accelerator" style="padding:9px 14px;background:#9b1b22;color:#f7f1e6;font:600 9.5px Inter,sans-serif;letter-spacing:.16em;white-space:nowrap" data-hover="background:#7e151b;color:#f7f1e6">${COPY.wiz.stuck.cta}</a>
      </div>
      <!-- /dc -->
    </div>`;
}
function blockWizFooterNav() {
  const first = W.step <= 1, last = W.step >= 7;
  return `
      <div class="mx-ax-footer" style="display:flex;align-items:center;padding:16px 28px;border-top:1px solid rgba(25,21,18,.16)">
        <span data-act="prev" role="button" aria-disabled="${first ? 'true' : 'false'}" style="padding:11px 18px;border:1px solid ${first ? 'rgba(25,21,18,.14)' : 'rgba(25,21,18,.3)'};font:600 10px Inter,sans-serif;letter-spacing:.16em;color:${first ? 'rgba(25,21,18,.3)' : '#191512'};cursor:${first ? 'default' : 'pointer'};white-space:nowrap">${COPY.wiz.prev}</span>
        <div style="flex:1"></div>
        <span data-role="saved" style="font-size:11px;color:#4a4239;margin-right:16px">${savedLabel()}</span>
        ${!last ? `<span data-act="next" role="button" style="padding:11px 20px;background:#9b1b22;color:#f7f1e6;font:600 10px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;white-space:nowrap" data-hover="background:#7e151b">${COPY.wiz.next}</span>` : ''}
      </div>`;
}
function wizardMain() {
  return `
  <div data-block="wizard" class="mx-ax-wizard mx-gutter" style="display:grid;grid-template-columns:1fr 280px;gap:26px;padding:26px 36px 10px;align-items:start">
    <!-- dc: Accelerator Application.dc.html › "Wizard · main panel" -->
    <div style="border:1px solid rgba(25,21,18,.16);background:#fdfaf3">
      <div data-block="panel">${stepPanel()}</div>
      <!-- dc: Accelerator Application.dc.html › "Footer nav" -->
      <div data-block="footnav">${blockWizFooterNav()}</div>
      <!-- /dc -->
    </div>
    <!-- /dc -->
    ${blockRail()}
  </div>`;
}
function gateCard(preview) {
  const state = openState();
  const line = state === 'closed' ? COPY.wiz.gate.closedLine : COPY.wiz.gate.line(esc(opensInfo().label));
  return `
  <!-- dc: Accelerator.dc.html › "04 · YOUR APPLICATION" (Get-notified capture — wizard hidden until applications open) -->
  <div class="mx-gutter" style="padding:26px 36px 10px">
    <div style="border:1px solid rgba(25,21,18,.16);background:#fdfaf3;padding:34px 24px;display:flex;flex-direction:column;align-items:center;gap:9px;text-align:center">
      <span style="width:28px;height:1px;background:#c9a962"></span>
      <span style="font-family:Fraunces,serif;font-style:italic;font-size:17px;color:#4a4239">${line}</span>
      <span style="font-size:12.5px;color:#4a4239;max-width:400px;line-height:1.55">${COPY.wiz.gate.why}</span>
      <span style="margin-top:8px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;justify-content:center">
        <span data-act="notify" style="padding:11px 20px;background:#9b1b22;color:#f7f1e6;font:600 10px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;white-space:nowrap" data-hover="background:#7e151b">${st.notified ? COPY.application.notified : COPY.application.notify}</span>
        <span data-act="toPreview" style="padding:11px 20px;border:1px solid rgba(25,21,18,.3);font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#191512;cursor:pointer;white-space:nowrap" data-hover="border-color:#191512">${COPY.wiz.gate.preview}</span>
      </span>
    </div>
  </div>
  <!-- /dc -->`;
}
function applyTemplate(preview) {
  const state = openState();
  const showWizard = state === 'open' || preview || !!W.submitted;
  return `
<div data-screen-label="Accelerator Application" style="font-family:Inter,sans-serif;color:#191512;background:#f7f1e6;min-height:100vh">
  ${blockCrumbs(true)}
  ${blockTabs(true)}
  ${blockWizHeader(preview)}
  ${showWizard ? blockStepper() + wizardMain() : gateCard(preview)}
  <!-- dc: Accelerator Application.dc.html › "Results footnote" -->
  <div class="mx-gutter" style="display:flex;align-items:center;gap:20px;padding:14px 36px 30px;flex-wrap:wrap">
    <span style="font-size:11.5px;color:#4a4239">${COPY.wiz.footnote}<a href="/app/accelerator">${COPY.wiz.footnoteLink}</a>.</span>
  </div>
  <!-- /dc -->
</div>`;
}

// ---------------------------------------------------------------- behaviour
function rerender(sel, html) { const el = rootEl && rootEl.querySelector(sel); if (el) el.outerHTML = html; }
function refreshWizardUi(full) {
  if (full) { rerender('[data-block="panel"]', `<div data-block="panel">${stepPanel()}</div>`); rerender('[data-block="footnav"]', `<div data-block="footnav">${blockWizFooterNav()}</div>`); wireWizardInputs(); }
  rerender('[data-block="stepper"]', blockStepper());
  rerender('[data-block="checklist"]', blockChecklist());
  if (!full && W.step === 7 && !W.submitted) rerender('[data-block="panel"]', `<div data-block="panel">${stepPanel()}</div>`);
  const el = rootEl && rootEl.querySelector('[data-role="saved"]'); if (el) el.textContent = savedLabel();
}
function goTo(n) {
  if (W.submitted) n = 7;
  W.step = Math.min(7, Math.max(1, n));
  try { localStorage.setItem(STEP_KEY, String(W.step)); } catch (e) {}
  refreshWizardUi(true);
  const first = rootEl.querySelector('[data-block="panel"] input:not([type=file]), [data-block="panel"] select, [data-block="panel"] textarea');
  if (first) first.focus({ preventScroll: true });
  const panel = rootEl.querySelector('[data-block="wizard"]');
  if (panel && panel.getBoundingClientRect().top < 0) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
// validation — verbatim rules from the legacy validateStep
function validateStep(step) {
  const v = W.values; const has = id => String(v[id] || '').trim() !== '';
  switch (step) {
    case 1: if (!(has('axFirstName') && has('axLastName') && has('axEmail') && has('axDob'))) return COPY.wiz.v.s1; break;
    case 2: if (!(has('axInstitution') && has('axDegree') && has('axYear') && has('axField'))) return COPY.wiz.v.s2; break;
    case 3: {
      if (!has('axChoice1') || !has('axResearchInterests')) return COPY.wiz.v.s3;
      const choices = [v.axChoice1, v.axChoice2, v.axChoice3].filter(Boolean);
      if (new Set(choices).size !== choices.length) return COPY.wiz.v.s3distinct;
      break;
    }
    case 4: if (!has('axStatement')) return COPY.wiz.v.s4; break;
    case 5: if (!W.files.cv) return COPY.wiz.v.s5; break;
    case 6: if (!(W.consents.c1 && W.consents.c2 && W.consents.c3)) return COPY.wiz.v.s6; break;
  }
  return null;
}
function pickFile(key) { const inp = rootEl.querySelector(`[data-role="file-${key}"]`); if (inp) inp.click(); }
function acceptFile(key, file) {
  if (!file) return;
  const isPdf = /pdf$/i.test(file.type) || /\.pdf$/i.test(file.name);
  if (!isPdf) return ui.toast(COPY.wiz.upload.notPdf, { kind: 'error' });
  if (file.size > 5 * 1024 * 1024) return ui.toast(COPY.wiz.upload.tooBig, { kind: 'error' });
  W.files[key] = file;
  refreshWizardUi(true);
}
async function startPayment(applicationId) {
  try {
    ui.toast(COPY.wiz.fee.redirect);
    const res = await api.post('/api/accelerator/checkout-session', { applicationId });
    if (res && res.url) { window.location.assign(res.url); return; }
    ui.toast((res && res.error) || COPY.wiz.fee.unavailable, { kind: 'error' });
  } catch (e) { ui.toast(e.message || COPY.wiz.fee.unavailable, { kind: 'error' }); }
}
function feeModal(applicationId, number, extra) {
  ui.modal({
    eyebrow: COPY.wiz.fee.eyebrow,
    title: COPY.wiz.submittedLine(esc(number || 'received')),
    body: `${extra ? `<p style="color:#9b1b22">${esc(extra)}</p>` : ''}${COPY.wiz.fee.body}`,
    actions: [
      { label: COPY.wiz.fee.later },
      { label: COPY.wiz.fee.pay, kind: 'primary', onClick: () => { startPayment(applicationId); } }
    ]
  });
}
// port of the legacy submit (app.part9.js › submitApplication): one POST with the exact payload
// mapping, then the per-type document uploads the backend defines (documents/:docType)
async function doSubmit() {
  if (W.busy || W.submitted) return;
  for (let s = 1; s <= 6; s++) { const err = validateStep(s); if (err) { ui.toast(err, { kind: 'error' }); goTo(s); return; } }
  W.busy = true; refreshWizardUi(true);
  const v = W.values;
  const payload = {
    year: (D.program && D.program.year) || FACTS.year,
    first_name: v.axFirstName, last_name: v.axLastName, email: v.axEmail, phone: v.axPhone,
    date_of_birth: v.axDob, nationality: v.axNationality, country_of_residence: v.axCountry,
    current_institution: v.axInstitution, degree_program: v.axDegree, year_of_study: v.axYear,
    program_type: v.axField,
    selected_institution: v.axChoice1, alternative_institution: v.axChoice2,
    previous_experience: [v.axExperience, v.axPublications].filter(Boolean).join('\n\n---\nPublications:\n') || '',
    special_arrangements: [
      v.axChoice3 ? `Third choice: ${v.axChoice3}` : '',
      v.axResearchInterests ? `Research interests: ${v.axResearchInterests}` : '',
      v.axStatement ? `Personal statement: ${v.axStatement}` : ''
    ].filter(Boolean).join('\n\n') || '',
    gdpr_consent: true, status: 'submitted', submitted_at: new Date().toISOString()
  };
  let res;
  try { res = await api.post('/api/accelerator/applications', payload); }
  catch (e) { W.busy = false; refreshWizardUi(true); ui.toast(e.message || COPY.wiz.submitFail, { kind: 'error' }); return; }
  const failed = [];
  for (const [type, file] of [['cv', W.files.cv], ['transcript', W.files.transcript], ['recommendation', W.files.recommendation]]) {
    if (!file) continue;
    const fd = new FormData(); fd.append('file', file, file.name);
    try { await api.post(`/api/accelerator/applications/${encodeURIComponent(res.id)}/documents/${type}`, fd); }
    catch (e) { failed.push(type); }
  }
  try { localStorage.removeItem(DRAFT_KEY); localStorage.removeItem(STEP_KEY); } catch (e) {}
  let mine = [];
  try { mine = await api.get('/api/accelerator/my-applications'); } catch (e) { mine = []; }
  D.mine = Array.isArray(mine) ? mine : [];
  cache = { at: Date.now(), data: D };
  W.submitted = D.mine.find(r => r.id === res.id) || { id: res.id, application_number: res.application_number, status: 'submitted', email: v.axEmail, created_at: new Date().toISOString() };
  W.busy = false; W.step = 7;
  ui.toast(COPY.wiz.submitOk);
  const preview = /[?&]preview=1/.test(location.search);
  rootEl.innerHTML = applyTemplate(preview);
  wireWizardInputs();
  feeModal(res.id, res.application_number, failed.length ? COPY.wiz.docsFailed(failed.join(', ')) : '');
}
// legacy "Preview as PDF" (print window), restyled to the brand faces
function previewPdf() {
  const v = W.values;
  const w = window.open('', '_blank');
  if (!w) return ui.toast('Allow pop-ups to preview your application.', { kind: 'error' });
  const degree = (DEGREES.find(d => d[0] === v.axDegree) || [])[1] || v.axDegree || '';
  const country = (COUNTRIES.find(c => c[0] === v.axCountry) || [])[1] || v.axCountry || '';
  const sections = [
    ['Personal Information', [['First name', v.axFirstName], ['Last name', v.axLastName], ['Email', v.axEmail], ['Phone', v.axPhone], ['Date of birth', v.axDob], ['Nationality', v.axNationality], ['Country of residence', country]]],
    ['Education', [['Institution', v.axInstitution], ['Degree program', degree], ['Year of study', (YEARS.find(y => y[0] === v.axYear) || [])[1] || v.axYear], ['Field of study', v.axField], ['Expected graduation', v.axGraduation]]],
    ['Institution Preferences', [['First choice', choiceName(v.axChoice1)], ['Second choice', choiceName(v.axChoice2)], ['Third choice', choiceName(v.axChoice3)]]],
    ['Experience & Motivation', [['Research experience', v.axExperience], ['Publications', v.axPublications], ['Research interests', v.axResearchInterests], ['Personal statement', v.axStatement]]],
    ['Documents', [['CV / Resume', W.files.cv ? W.files.cv.name : 'Not uploaded'], ['Transcript', W.files.transcript ? W.files.transcript.name : 'Not uploaded'], ['Recommendation letter', W.files.recommendation ? W.files.recommendation.name : 'Not uploaded']]]
  ];
  w.document.write(`<!DOCTYPE html><html><head><title>Med&X Accelerator — Application Preview</title><style>
    body{font-family:Georgia,serif;color:#191512;background:#fff;max-width:720px;margin:0 auto;padding:40px 28px}
    .head{text-align:center;border-bottom:2px solid #c9a962;padding-bottom:16px;margin-bottom:28px}
    .head h1{font-size:22px;margin:0}.head p{font-size:12px;color:#4a4239;margin:6px 0 0}
    h2{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#9b1b22;border-bottom:1px solid #eee;padding-bottom:6px;margin:26px 0 10px;font-family:Helvetica,Arial,sans-serif}
    .f{display:flex;padding:5px 0;font-size:13px}.f b{width:190px;flex:none;font-weight:600;color:#4a4239;font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:.06em;text-transform:uppercase;padding-top:2px}
    .f span{white-space:pre-wrap}.muted{color:#9b8f80;font-style:italic}
    .foot{margin-top:36px;border-top:1px solid #eee;padding-top:12px;text-align:center;font-size:11px;color:#9b8f80}
    @media print{body{padding:16px}}</style></head><body>
    <div class="head"><h1>Med&X Accelerator</h1><p>Application preview · generated ${esc(fmt.longRange(new Date()))} · not a submission confirmation</p></div>
    ${sections.map(([t, rows]) => `<h2>${esc(t)}</h2>${rows.map(([l, val]) => `<div class="f"><b>${esc(l)}</b><span>${val ? esc(val) : '<span class="muted">Not provided</span>'}</span></div>`).join('')}`).join('')}
    <div class="foot">Med&X · the Accelerator</div></body></html>`);
  w.document.close();
  setTimeout(() => { try { w.print(); } catch (e) {} }, 400);
}

// ---------------------------------------------------------------- handlers
async function setFollow(on, toastText) {
  try {
    await api.post('/api/notify-topics', { project: 'accelerator', on });
    st.follow = on; if (on) st.notified = true;
    ui.toast(toastText || (on ? COPY.hero.followOnToast : COPY.hero.followOffToast));
    rerender('[data-block="hero"]', blockHero());
    if (rootEl.querySelector('[data-block="application"]')) rerender('[data-block="application"]', `<div data-block="application">${appSectionInner()}</div>`);
    chrome.refresh();
  } catch (e) { ui.toast(e.message, { kind: 'error' }); }
}
const handlers = {
  goApply: () => router.navigate('/app/accelerator/apply'),
  toPreview: () => { router.navigate('/app/accelerator/apply?preview=1'); },
  notify: async (el) => {
    el.setAttribute('aria-disabled', 'true');
    try {
      await api.post('/api/notify-topics', { project: 'accelerator', on: true });
      st.follow = true; st.notified = true;
      ui.toast(COPY.hero.notedToast);
      if (rootEl.querySelector('[data-block="hero"]')) rerender('[data-block="hero"]', blockHero());
      const inApp = rootEl.querySelector('[data-block="application"]');
      if (inApp) rerender('[data-block="application"]', `<div data-block="application">${appSectionInner()}</div>`);
      const gateBtn = rootEl.querySelector('[data-screen-label="Accelerator Application"] [data-act="notify"]');
      if (gateBtn) gateBtn.textContent = COPY.application.notified;
      chrome.refresh();
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  tgFollow: () => setFollow(!st.follow),
  pickHost: (el) => { const i = parseInt(el.dataset.i, 10); st.host = st.host === i ? null : i; rerender('[data-block="hosts"]', `<div data-block="hosts">${hostCards()}</div>`); },
  closeHost: (el, ev) => { ev.stopPropagation(); st.host = null; rerender('[data-block="hosts"]', `<div data-block="hosts">${hostCards()}</div>`); },
  faq: (el) => { const i = parseInt(el.dataset.i, 10); st.faqOpen = st.faqOpen === i ? null : i; rerender('[data-block="faq"]', `<div data-block="faq" class="mx-ax-faq" style="display:grid;grid-template-columns:1fr 1fr;gap:0 44px;align-items:start;padding-bottom:24px">${faqRows()}</div>`); },
  viewResults: async (el) => {
    const input = rootEl.querySelector('[data-role="code"]');
    const raw = String((input && input.value) || '').trim().toUpperCase();
    const showErr = msg => { st.codeErr = msg; const e = rootEl.querySelector('[data-role="codeErr"]'); if (e) { e.textContent = msg; e.style.display = msg ? '' : 'none'; } if (msg) { ui.toast(msg, { kind: 'error' }); if (input) input.focus(); } };
    if (!raw) return showErr(COPY.results.empty);
    if (!CODE_RE.test(raw)) return showErr(COPY.results.malformed);
    showErr('');
    el.setAttribute('aria-disabled', 'true');
    try {
      const rows = await api.get('/api/accelerator/results?code=' + encodeURIComponent(raw), { noAuth: true });
      st.results = { rows: Array.isArray(rows) ? rows : [], code: raw, year: raw.slice(2, 4) ? '20' + raw.slice(2, 4) : '' };
      rerender('[data-block="results"]', `<div data-block="results">${resultsBlock()}</div>`);
      const block = rootEl.querySelector('[data-block="results"]'); if (block) block.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (e) {
      if (e.status === 404) showErr(/not available/i.test(e.message || '') ? COPY.results.notYet : COPY.results.unknown);
      else if (e.status === 400) showErr(COPY.results.empty);
      else showErr(COPY.results.failed);
    }
    el.removeAttribute('aria-disabled');
  },
  payFee: (el) => { const id = el.dataset.app; if (id) startPayment(id); },
  // wizard
  go: (el) => goTo(parseInt(el.dataset.step, 10) || 1),
  prev: (el) => { if (el.getAttribute('aria-disabled') === 'true') return; goTo(W.step - 1); },
  next: () => {
    const err = validateStep(W.step);
    if (err) { ui.toast(err, { kind: 'error' }); return; }
    goTo(W.step + 1);
  },
  submit: (el) => { if (el.getAttribute('aria-disabled') === 'true') { ui.toast(COPY.wiz.submitHint); return; } doSubmit(); },
  pdf: () => previewPdf(),
  pickFile: (el, ev) => { if (ev.target.closest('[data-act="clearFile"]')) return; pickFile(el.dataset.doc); },
  clearFile: (el, ev) => { ev.stopPropagation(); W.files[el.dataset.doc] = null; refreshWizardUi(true); }
};
function appSectionInner() {
  // UX audit 2026-09-02 › item 15 (third case, deferred by M1): the RESULTS LOOKUP field stood on
  // the page three months before applications even open — an affordance with nothing to look up.
  // It appears the moment applications open (live intake state; FACTS.accelerator.opens is the
  // fallback clock in openState()) and stays afterwards, which is when AX26-XXXX codes exist.
  const lookupLive = openState() !== 'before';
  return `
        <div id="acc-application" style="display:flex;align-items:baseline;gap:14px;padding:24px 0 12px">
          <span style="font-family:Fraunces,serif;font-weight:600;font-size:14px;color:#9b1b22">${COPY.application.n}</span>
          <span style="font:600 14px Inter,sans-serif;letter-spacing:.14em">${COPY.application.title}</span>
        </div>
        ${applicationCard()}
        ${lookupLive ? `
        <div class="mx-ax-lookup mx-wrap-row" style="display:flex;gap:12px;align-items:center;padding:14px 0 8px;flex-wrap:wrap">
          <span style="font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#c9a962;white-space:nowrap">${COPY.results.label}</span>
          <input data-role="code" placeholder="${COPY.results.placeholder}" aria-label="Results access code" maxlength="9" autocapitalize="characters" autocomplete="off" spellcheck="false" style="border:1px solid rgba(25,21,18,.25);padding:9px 13px;font:600 11px ui-monospace,Menlo,monospace;color:#191512;background:#fdfaf3;letter-spacing:.1em;width:110px;text-transform:uppercase;border-radius:0">
          <span data-act="viewResults" style="padding:10px 15px;background:#191512;color:#f7f1e6;font:600 9.5px Inter,sans-serif;letter-spacing:.15em;cursor:pointer;white-space:nowrap" data-hover="background:#2c2620">${COPY.results.view}</span>
          <span style="font-size:11.5px;color:#4a4239">${COPY.results.hint}</span>
        </div>
        <div data-role="codeErr" role="alert" style="font-size:11.5px;color:#9b1b22;padding:0 0 10px;${st.codeErr ? '' : 'display:none'}">${esc(st.codeErr || '')}</div>
        <div data-block="results">${resultsBlock()}</div>` : `
        <!-- v2: RESULTS LOOKUP hidden until applications open (openState() 'before' — intake state, FACTS.accelerator.opens fallback) — UX audit item 15 -->`}
        <div style="padding-bottom:12px"></div>`;
}

// wizard input wiring (delegated; survives partial rerenders of stepper/checklist)
function onFieldInput(e) {
  const el = e.target;
  if (el.matches && el.matches('[data-field]')) {
    W.values[el.dataset.field] = el.value;
    scheduleSave();
    refreshWizardUi(false);
  } else if (el.matches && el.matches('[data-consent]')) {
    W.consents[el.dataset.consent] = !!el.checked;
    refreshWizardUi(false);
  }
}
function onFileChange(e) {
  const el = e.target;
  if (!(el.matches && el.matches('[data-role^="file-"]'))) return;
  const key = el.getAttribute('data-role').slice(5);
  acceptFile(key, el.files && el.files[0]);
  el.value = '';
}
function wireWizardInputs() {
  rootEl.querySelectorAll('.mx-ax-drop').forEach(zone => {
    const key = zone.dataset.doc;
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('is-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
    zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('is-over'); acceptFile(key, e.dataTransfer.files && e.dataTransfer.files[0]); });
  });
}

function startTimers(applyTab) {
  if (!applyTab) {
    const cd = countdownInfo();
    if (cd.target) {
      timers.push(ui.countdown(cd.target, () => {
        const el = rootEl && rootEl.querySelector('[data-cd="opendays"]');
        if (el) el.textContent = daysTo(cd.target);
      }, 60000));
    }
    const list = D.alumni || COPY.cohorts.fallback;
    if (list.length > 4) {
      const id = setInterval(() => {
        st.cohortPage++;
        rerender('[data-block="fellows"]', `<div data-block="fellows" style="display:flex;flex-direction:column;flex:1;min-height:0">${fellowsList()}</div>`);
      }, 4500);
      timers.push(() => clearInterval(id));
    }
  }
}

export default {
  title(ctx) { return ctx && ctx.params && ctx.params.tab === 'apply' ? 'My Application' : 'The Accelerator'; },
  async render(root, ctx) {
    injectCss();
    rootEl = root;
    D = await load(false);
    if (rootEl !== root) return;                    // navigated away while loading
    const applyTab = ctx.params.tab === 'apply';
    const preview = ctx.query && ctx.query.preview === '1';
    if (!st) st = { follow: D.followed, notified: D.followed, host: null, faqOpen: null, cohortPage: 0, results: null, codeErr: '' };
    else { st.follow = D.followed || st.follow; }
    if (applyTab) {
      initWizard();
      root.innerHTML = applyTemplate(preview);
      wireWizardInputs();
      root.addEventListener('input', onFieldInput);
      root.addEventListener('change', onFieldInput);
      root.addEventListener('change', onFileChange);
      cleanupFns.push(() => { root.removeEventListener('input', onFieldInput); root.removeEventListener('change', onFieldInput); root.removeEventListener('change', onFileChange); });
    } else {
      root.innerHTML = overviewTemplate();
      // cohort photos degrade to the artboard's striped placeholder if an asset ever 404s
      // (same pattern as gala.js portrait fallback)
      root.querySelectorAll('img[data-role="cohort-photo"]').forEach(img => {
        img.addEventListener('error', () => img.remove(), { once: true });
        if (img.complete && img.naturalWidth === 0) img.remove();
      });
    }
    unbind = ui.bind(root, handlers);
    startTimers(applyTab);
    chrome.refresh();
  },
  destroy() {
    clearTimeout(saveTimer); saveTimer = null;
    if (W && !W.submitted && rootEl && rootEl.querySelector('[data-field]')) persistDraft();
    timers.forEach(stop => { try { stop(); } catch (e) {} }); timers = [];
    cleanupFns.forEach(fn => { try { fn(); } catch (e) {} }); cleanupFns = [];
    if (unbind) unbind(); unbind = null;
    rootEl = null;
  }
};
