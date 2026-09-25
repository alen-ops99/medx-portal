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
  tabs: { overview: 'Overview', apply: 'My application' },
  hero: {
    title: 'The <i>Accelerator</i>',
    // the one line on the photo: "Summer 2027 · opens 15 Nov" (the placement and where the intake stands)
    line: (placement, state) => `${placement} · ${state}`,
    opens: d => `opens ${d}`, openNow: 'open now', closes: d => `closes ${d}`, closed: 'closed',
    followTitle: 'Updates',
    // 2026-09-17: the 2026 cohort on the Gordon Hall steps replaces the stock hall photo.
    photo: { src: '/assets/ax-hero-boston-2026.jpg', alt: 'The 2026 Accelerator fellows at Harvard Medical School, Boston' },
    notify: 'GET NOTIFIED →',
    notified: '✓ ON THE LIST',
    start: 'START YOUR APPLICATION →',
    resume: 'CONTINUE YOUR APPLICATION →',
    view: 'VIEW YOUR APPLICATION →',
    notedToast: 'Noted — we’ll email you the day applications open.',
    followOnToast: 'Accelerator updates on — email + portal alerts.',
    followOffToast: 'Accelerator updates off.'
  },
  band: {
    openIn: 'APPLICATIONS OPEN IN', closeIn: 'APPLICATIONS CLOSE IN', open: 'APPLICATIONS', openNow: 'NOW', closed: 'CLOSED',
    // the region is read from the host list (all eight are in the USA today — the band said USA & EUROPE)
    days: 'days', duration: '8–12',
    weeks: 'Weeks', hosts: 'Host institutions', hostsIn: region => `Hosts · ${region}`, places: 'Places', stipend: '€800–1,000', stipendL: 'Stipend'
  },
  program: {
    line: 'Summer research at <i>world-renowned</i> labs and clinics, for Croatia’s next generation.',
    more: 'About the program',
    eligible: ['Croatian citizenship', 'Senior medical students', 'Biochemistry and biomedical engineering students', 'Early-career researchers, 0–3 years after graduation'],
    body: 'A prestigious summer research program placing exceptional Croatian students and early-career researchers at world-renowned labs and clinics. The mission goes beyond the internship: experience an amazing institution, grow professionally and personally, and bring that knowledge home · building lasting bridges in biomedicine between Croatia and the world.',
    whoTitle: 'Who it’s for',
    hostsTitle: 'Hosts', allHosts: n => `All ${n} hosts`, shown: 6,
    positions: n => `${n} ${Number(n) === 1 ? 'position' : 'positions'}`, positionsTbc: 'Positions TBC', site: 'Website →',
    // The host drawer (2026-09-17): every field the public endpoints carry that holds something, one row
    // each — a panel of six "Details coming" rows read as unfinished. What is not filled in yet is said once.
    detail: {
      soon: 'Details coming', close: 'Close', more: opens => `Mentors, program type and dates for this host are published with the call on ${opens}.`,
      rows: [['about', 'ABOUT'], ['lab', 'LAB / CLINIC'], ['mentor', 'MENTOR'], ['fields', 'PROGRAM TYPE'], ['duration', 'DURATION'], ['spots', 'SPOTS'], ['year', 'YEAR'], ['website', 'WEBSITE']],
      extra: [['requirements', 'REQUIREMENTS'], ['stipend', 'STIPEND'], ['accommodation', 'ACCOMMODATION'], ['visa', 'VISA'], ['contact', 'CONTACT']]
    }
  },
  included: {
    title: 'What’s included', stipend: '€800–1,000',
    items: ['Stipend for travel, living and health insurance', 'Visa documentation', 'Housing assistance', 'Travel arrangements', 'Onboarding and mentorship', 'Certificate of completion'],
  },
  selection: {
    // step titles only on a phone (accelerator.css); the one-line descriptions return from 501px
    title: 'Selection',
    steps: opens => [
      { n: '01', t: 'Apply', d: 'CV, mentor letter and documents' },
      { n: '02', t: 'Document review', d: 'Two phases, then a shortlist' },
      { n: '03', t: 'Interview', d: 'With two Croatian biomedical professionals' },
      { n: '04', t: 'Selection & onboarding', d: 'Results by email with your access code' }
    ],
    note: 'Hosts give final approval.'
  },
  application: {
    title: 'Your application', resultAvail: 'RESULT AVAILABLE',   // no n: the page counter (.mx-p--num) numbers this head in order
    noneLine: () => 'No application yet.',
    noneOpenLine: 'No application yet · applications are open.',
    closedLine: 'Applications for this cycle have closed.',
    draftLine: pct => `Your draft is saved · ${pct}% complete.`,
    draftWhy: 'It saves as you type.',
    subLine: (num, when) => `Application ${num} submitted${when ? ' ' + when : ''}.`,
    subWhy: 'We emailed a confirmation. The committee reaches you here and by email.',
    reviewWhy: 'The committee is reviewing your documents. You hear from us by email.',
    resultLine: 'Your result is ready.',
    resultWhy: 'Your access code is in your email. Look your result up below.',
    notify: 'GET NOTIFIED →', notified: '✓ ON THE LIST', preview: 'PREVIEW →',
    start: 'START YOUR APPLICATION →', resume: 'CONTINUE YOUR APPLICATION →', view: 'VIEW YOUR APPLICATION →',
    payFee: 'PAY THE €75 FEE →', feeNote: 'Processing fee pending — your application stays valid either way.',
    statusWord: { submitted: 'SUBMITTED', review: 'UNDER REVIEW', accepted: 'ACCEPTED', waitlisted: 'WAITLISTED', rejected: 'NOT SELECTED', draft: 'DRAFT' }
  },
  results: {
    label: 'Results lookup', placeholder: 'AX26-XXXX', view: 'VIEW RESULTS',
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
    title: 'The team',
    people: [
      { name: 'Marija Pranjić', role: 'Program Director' },
      { name: 'Miro Vuković, MD', role: 'Vice President · partnerships' },
      { name: 'Marina Grubić, MD', role: 'Vice President, Human Resources' },
      { name: 'Alen Juginović, MD', role: 'Founder &amp; President, Med&amp;X' },
      { name: 'Lucija Skejić', role: 'Program team · member experience' }
    ]
  },
  cohorts: {
    // one closed accordion, "Past fellows · 20": a row per class inside, then the photos
    title: 'Past fellows',
    count: n => `${n} ${n === 1 ? 'fellow' : 'fellows'}`,
    // 2026-09-17: the list of fellows (from v2_accelerator_alumni, grouped by year) is the block;
    // the photos sit in a small gallery row beneath it. Sources: medx.hr live-site mirror
    // (acc_25_2 = MGH Boston arrival, acc_25 = lab day) + the 2026 cohort's Boston lounge shot.
    photos: [
      { src: '/assets/ax-boston-2026-lounge.jpg', alt: 'The 2026 cohort with hosts and mentors in Boston', pos: 'center 50%' },
      { src: '/assets/ax-cohort-arrival.jpg', alt: 'A fellow arriving at Massachusetts General Hospital, Boston', pos: 'center 30%' },
      { src: '/assets/ax-lab-day.jpg', alt: 'Two fellows in the lab at their host institution', pos: 'center 30%' }
    ],
    // The names, the classes and the count come from v2_accelerator_alumni and nowhere else: no names and no
    // cohort size are ever invented here (audit W6).
    classOf: y => `Class of ${y}`, unknownYear: 'Earlier cohorts',
    where: a => [a.placement_institution, a.city].filter(Boolean).join(', ')
  },
  faq: {
    title: 'Frequently asked',
    // COPY fallback — admin-editable rows come from GET /api/portal-content/published/accelerator-faq
    list: opens => [
      { q: 'Who can apply?', a: 'Croatian citizenship is required. The program is aimed at senior medical, biochemistry-related, and biomedical engineering students, and early-career researchers up to three years post-graduation — wherever in the world you currently study or work.' },
      { q: 'Is it funded?', a: 'Yes — fellows receive a €800–1,000 stipend toward travel, living costs, and health insurance, plus visa documentation, housing assistance, travel arrangements, and onboarding support.' },
      { q: 'How competitive is it?', a: 'Highly — 5–10 positions are awarded per cycle across all host institutions. A strong mentor letter and a clear one-line summary of your project matter most.' },
      { q: 'When does it open?', a: `Applications open ${opens} and stay open for a limited window. Document review then runs in two phases, shortlisted candidates are interviewed, and results arrive by email with your access code.` },
      { q: 'Can I apply to several hosts?', a: 'You submit one application and state your preferences — the selection committee matches selected fellows with host institutions, subject to mentor availability and final host approval.' }
    ]
  },
  footer: {
    ask: 'Message us'
  },
  wiz: {
    eyebrow: placement => `MED&amp;X ACCELERATOR · ${placement}`,
    pillDraft: 'DRAFT · NOT YET SUBMITTED', pillSubmitted: when => `SUBMITTED${when ? ' · ' + when.toUpperCase() : ''}`,
    pillPreview: opens => `PREVIEW · OPENS ${opens}`,
    closes: d => `CLOSES ${d}`, opens: d => `OPENS ${d}`, open: 'APPLICATIONS OPEN', closed: 'APPLICATIONS CLOSED',
    stepOf: n => `Step ${n} of 7`, gdprTitle: 'How your data is used',
    sub: 'Your progress saves automatically · leave and come back any time.',
    subDone: 'Submitted — the committee takes it from here. We’ll reach you by email at every stage.',
    steps: ['PERSONAL', 'EDUCATION', 'PROGRAM', 'SUPPLEMENTARY', 'DOCUMENTS', 'CONSENT', 'REVIEW'],
    stepTitles: ['Personal Information', 'Education', 'Program Preferences', 'Supplementary', 'Documents', 'Consent', 'Review & Submit'],
    required: 'Fields marked <span style="color:#9b1b22">*</span> are required.',
    prev: '← PREVIOUS', next: 'CONTINUE →', submit: 'SUBMIT APPLICATION', submitting: 'SUBMITTING…',
    submitHint: 'Enabled once every section is complete.', pdf: 'PREVIEW AS PDF',
    saved: { saving: 'Saving…', just: 'Saved just now', at: t => `Saved at ${t}`, none: 'Autosaves as you type' },
    reviewSub: 'Check each section before submitting · you can still edit until the deadline.',
    reviewStatus: { done: 'Complete', todo: 'To do' }, edit: 'EDIT →',
    summaryTitle: 'Application summary',
    summaryNote: 'Once submitted, you receive a confirmation email and can track the status here.',
    checklist: { title: 'Your checklist', complete: 'complete' },
    items: ['Personal info completed', 'Education details added', 'Institution preferences selected', 'Motivation statement written', 'Documents uploaded', 'Application reviewed'],
    before: { title: 'BEFORE YOU START', titleShort: 'Before you start', body: 'Have your CV, a mentor letter and a one-line project summary ready. You upload them in Documents.' },
    stuck: { line: 'Stuck on a question?', sub: 'Message the coordinators', body: 'Message us · the coordinators reply right here in your portal inbox.', cta: 'MESSAGE US →' },
    submittedLine: num => `Application ${num} is in.`,
    submittedWhy: email => `We emailed a confirmation${email ? ' to ' + email : ''}. Track the status here and in Your application on the overview.`,
    docsFailed: types => `Heads up — ${types} did not upload. Retry from the overview or message us.`,
    gate: {
      line: opens => `Applications open ${opens}.`,
      closedLine: 'Applications for this cycle have closed.',
      why: 'Have ready: CV, mentor letter, one-line summary.',
      preview: 'PREVIEW →'
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
  label: 'font:600 12px/16px Inter,sans-serif;letter-spacing:.12em;color:#4a4239;text-transform:uppercase',
  input: 'border:1px solid rgba(25,21,18,.25);background:#fdfaf3;padding:13px 14px;min-height:52px;font-size:16px;color:#191512;font-family:Inter,sans-serif;width:100%;box-sizing:border-box;border-radius:0',
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
    // Empty stays EMPTY (never null): an empty alumni table means the block is hidden, not that a
    // hardcoded list of names should stand in for it (audit W6).
    alumni: r.alumni && Array.isArray(r.alumni.alumni)
      ? r.alumni.alumni.map(a => ({ name: a.name, year: numOrNull(a.year), where: COPY.cohorts.where(a) }))
      : [],
    alumniYears: alumniYears(r.alumni)
  };
  cache = { at: Date.now(), data };
  return data;
}
function hostNames() { return ((D && D.hosts) || []).map(h => String(h.name || '').trim()).filter(Boolean); }
// True only when the alumni table has rows — no hardcoded names stand in (audit W6).
function hasAlumni() { return !!(D && Array.isArray(D.alumni) && D.alumni.length); }
// The year span comes from the rows themselves (the API's `years` first, else derived) — never a literal.
function alumniYears(res) {
  if (res && res.years && res.years.from && res.years.to) return res.years;
  const ys = ((res && res.alumni) || []).map(a => numOrNull(a.year)).filter(y => y !== null);
  return ys.length ? { from: Math.min.apply(null, ys), to: Math.max.apply(null, ys) } : null;
}
const yearRange = y => y ? (y.from === y.to ? String(y.from) : `${y.from}–${y.to}`) : '';

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
    const d = details(inst);
    cards.push(Object.assign({
      key: 's:' + s.id,
      abbr: (inst && inst.short_name) || abbrOf(s.institution),
      name: s.institution || '',
      city: [s.city, s.country].filter(Boolean).join(', '), country: s.country || (inst && inst.country) || '',
      blurb: (inst && inst.description) || '',
      lab: s.lab_or_clinic || '', mentor: mentorOk(s.mentor_line) ? s.mentor_line : d.mentor,
      spots: numOrNull(s.spots) !== null ? numOrNull(s.spots) : d.spots,
      year: numOrNull(s.year) !== null ? numOrNull(s.year) : d.year,
      logo: (inst && inst.logo_url) || null, website: (inst && inst.website_url) || null,
      instId: inst ? inst.id : null
    }, d.rest));
  });
  insts.forEach(i => {
    if (usedInst.has(i.id)) return;
    const d = details(i);
    cards.push(Object.assign({
      key: 'i:' + i.id, abbr: i.short_name || abbrOf(i.name), name: i.name || '',
      city: [i.city, i.country].filter(Boolean).join(', '), country: i.country || '', blurb: i.description || '',
      lab: '', mentor: d.mentor, spots: d.spots !== null ? d.spots : numOrNull(i.available_spots), year: d.year,
      logo: i.logo_url || null, website: i.website_url || null, instId: i.id
    }, d.rest));
  });
  if (cards.length) return cards;
  return FACTS.accelerator.hosts.map(n => ({ key: 'f:' + n, abbr: abbrOf(n), name: n, city: '', blurb: '', lab: '', mentor: '', spots: null, year: null, logo: null, website: null, instId: null }));
}
const numOrNull = v => (v === null || v === undefined || v === '' || isNaN(Number(v))) ? null : Number(v);
// The current year's accelerator_institution_details row, folded into GET /api/accelerator/institutions.
function details(inst) {
  const i = inst || {};
  const mentorOk = m => m && !/example|tbd/i.test(m);
  return {
    mentor: mentorOk(i.mentors) ? String(i.mentors) : '',
    spots: numOrNull(i.year_spots), year: numOrNull(i.details_year),
    rest: {
      fields: i.program_type || '', duration: i.internship_duration || '',
      requirements: i.requirements || '', stipend: i.stipend_info || '', accommodation: i.accommodation_info || '', visa: i.visa_requirements || '',
      contact: [i.contact_person, i.contact_email].filter(Boolean).join(' · ')
    }
  };
}
// institutions are not people: a neutral building glyph on the square ink mark (the letters HMS, Yale, MIT … went,
// GLASS-RULES §3.6), or the host's own logo when the admin has one on file
const HOST_GLYPH = '<svg class="mx-ic" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 9 12 4.5 20.5 9"/><path d="M4.5 9.5h15"/><path d="M6.5 12v5.5M10 12v5.5M14 12v5.5M17.5 12v5.5"/><path d="M4 20h16"/></svg>';
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
  return 'Summer ' + (y + 1);
}
// '15 Nov' in Zagreb time ('' when the date cannot be read): the hero line drops the year
function dayMonth(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  try { return d.toLocaleDateString('en-GB', { timeZone: 'Europe/Zagreb', day: 'numeric', month: 'short' }); }
  catch (e) { return ''; }
}
// '15 Nov 2026' in Zagreb time ('' when the date cannot be read)
function shortDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  try { return d.toLocaleDateString('en-GB', { timeZone: 'Europe/Zagreb', day: 'numeric', month: 'short', year: 'numeric' }); }
  catch (e) { return ''; }
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

// ---------------------------------------------------------------- kit helpers (DESIGN-RULES §10)
const icon = (n, s) => ui.icon(n, s || 20);
const chev = () => ui.icon('chevron-right', 18);
function sectionHead(title, right) {
  return `<div class="mx-sh"><h2 class="mx-sh-t">${title}</h2>${right || ''}</div>`;
}
const checks = items => `<ul class="mx-checks">${items.map(t => `<li>${icon('check')}<span>${t}</span></li>`).join('')}</ul>`;

// ---------------------------------------------------------------- shared blocks
function blockCrumbs(applyTab) {
  const L = 'font:600 12px Inter,sans-serif;letter-spacing:.12em';
  return `
  <!-- dc: ${applyTab ? 'Accelerator Application' : 'Accelerator'}.dc.html › "Breadcrumb" (desktop; phones carry back in the top bar) -->
  <div class="mx-crumbs mx-gutter" style="display:flex;align-items:center;gap:13px;padding:10px 36px;border-bottom:1px solid rgba(25,21,18,.16)">
    <a href="/app/projects" data-dir="back" style="${L};color:#4a4239" data-hover="color:#191512">${COPY.crumbs.projects}</a>
    <span style="color:rgba(25,21,18,.35);font-size:12px">→</span>
    ${applyTab
      ? `<a href="/app/accelerator" data-dir="back" style="${L}">${COPY.crumbs.name}</a>
    <span style="color:rgba(25,21,18,.35);font-size:12px">→</span>
    <span style="${L};color:#191512">${COPY.crumbs.mine}</span>`
      : `<span style="${L};color:#191512">${COPY.crumbs.name}</span>`}
  </div>
  <!-- /dc -->`;
}
// the two tabs as one segmented control (data-tabs keeps it lit and still while the tab changes)
function blockTabs(applyTab) {
  return `
  <!-- dc: Accelerator.dc.html › "Tabs" -->
  <nav class="mx-seg mx-ax-tabs" data-tabs="accelerator" aria-label="The Accelerator">
    ${applyTab ? `<a href="/app/accelerator">${COPY.tabs.overview}</a>` : `<span class="is-on" aria-current="page">${COPY.tabs.overview}</span>`}
    ${applyTab ? `<span class="is-on" aria-current="page">${COPY.tabs.apply}</span>` : `<a href="/app/accelerator/apply">${COPY.tabs.apply}</a>`}
  </nav>
  <!-- /dc -->`;
}

// ---------------------------------------------------------------- overview blocks
// FROZEN (DESIGN-RULES §8): the same data-acts (goApply · notify) and labels as before; the look is the house gold button
function heroCta() {
  const state = openState(); const a = appState();
  const cls = 'class="btn-gold btn-block" role="button"';
  if (state === 'open') {
    const label = a.kind === 'none' ? COPY.hero.start : (a.kind === 'draft' ? COPY.hero.resume : COPY.hero.view);
    return `<span data-act="goApply" ${cls}>${label}</span>`;
  }
  if (a.kind !== 'none' && a.kind !== 'draft') {
    return `<span data-act="goApply" ${cls}>${COPY.hero.view}</span>`;
  }
  return `<span data-act="notify" ${cls}>${st.notified ? COPY.hero.notified : COPY.hero.notify}</span>`;
}
// GLASS-RULES Q1: title · ONE line ("Summer 2027 · opens 15 Nov") · ONE action. The countdown is the hero's last
// child (the kit's glass chip on a phone, the band from 501px).
function heroLine() {
  const state = openState();
  const closes = state === 'open' && D.intake && D.intake.closes_at ? dayMonth(D.intake.closes_at) : '';
  const when = state === 'open' ? (closes ? COPY.hero.closes(closes) : COPY.hero.openNow)
    : state === 'closed' ? COPY.hero.closed
    : COPY.hero.opens(dayMonth(opensInfo().at) || opensInfo().label);
  return COPY.hero.line(placementLabel(), when);
}
function blockHero() {
  return `
  <!-- dc: Accelerator.dc.html › "Hero" -->
  <section data-block="hero" class="mx-hero mx-ink mx-ax-hero">
    <img class="mx-hero-photo" src="${COPY.hero.photo.src}" alt="${COPY.hero.photo.alt}" style="object-position:50% 85%">
    <div class="mx-scrim"></div>
    <div class="mx-hero-body">
      <h1 class="mx-hero-title">${COPY.hero.title}</h1>
      <p class="mx-hero-date">${esc(heroLine())}</p>
      <div data-role="hero-cta" class="mx-hero-cta">${heroCta()}</div>
    </div>
    ${blockCountdown()}
  </section>
  <!-- /dc -->`;
}
// the countdown: "12 days" to the close while applications are open (label "Applications close in", hidden on the
// chip). Before opening and once closed the hero line already says it, so on a phone the chip stays in the DOM but
// out of sight (.mx-ax-cd--quiet, accelerator.css); from 501px it is the band as before.
function blockCountdown() {
  const cd = countdownInfo();
  const quiet = !(cd.target && openState() === 'open');
  return `<div class="mx-countdown mx-countdown--chip mx-ax-cd${quiet ? ' mx-ax-cd--quiet' : ''}" role="timer"><span class="mx-cd-label">${cd.label}</span><span class="mx-cd-cell"><b class="mx-cd-num" data-cd="opendays">${cd.target ? daysTo(cd.target) : cd.big}</b>${cd.target ? `<i class="mx-cd-unit">${COPY.band.days}</i>` : ''}</span></div>`;
}
function blockTiles() {
  const ov = D.overview || {};
  const duration = ov.programDuration ? esc(fmt.dash(String(ov.programDuration).replace(/\s*weeks?\s*/i, ''))) : COPY.band.duration;
  const positions = ov.positionsRange ? esc(fmt.dash(ov.positionsRange)) : '5–10';
  const region = hostRegion();
  const tile = (n, l, cls) => `<div class="mx-tile${cls ? ' ' + cls : ''}"><span class="mx-tile-n">${n}</span><span class="mx-tile-l">${l}</span></div>`;
  return `
  <section class="mx-sec mx-sec--tight" data-block="tiles">
    <div class="mx-tiles mx-ax-tiles">
      ${tile(duration, COPY.band.weeks)}
      ${tile(esc(String(D.hosts.length)), region ? COPY.band.hostsIn(region) : COPY.band.hosts)}
      ${tile(positions, COPY.band.places)}
      ${tile(COPY.band.stipend, COPY.band.stipendL, 'mx-ax-tile-money')}
    </div>
  </section>`;
}
// a host card just re-drawn takes focus back (its tabindex is normally added a beat later by ui.js)
function focusCard(i) {
  const card = rootEl && rootEl.querySelector(`[data-act="pickHost"][data-i="${i}"]`);
  if (!card) return;
  if (!card.hasAttribute('tabindex')) { card.setAttribute('tabindex', '0'); card.setAttribute('role', 'button'); }
  try { card.focus({ preventScroll: true }); } catch (e) {}
}
// 'USA' · 'Europe' · 'USA & Europe' from the hosts' own countries ('' when none is on file)
function hostRegion() {
  const cs = (D.hosts || []).map(h => String(h.country || '').trim()).filter(Boolean);
  if (!cs.length) return '';
  const us = cs.filter(c => /^(usa|us|u\.s\.a?\.?|united states( of america)?|america)$/i.test(c)).length;
  return us === cs.length ? 'USA' : us ? 'USA &amp; Europe' : 'Europe';
}
// institutions are not people: a 44 SQUARE ink tile with the glyph (or the logo), never a circle. Six rows, then
// "All 8 hosts" opens the rest in place (GLASS-RULES Q8); data-i stays the index into D.hosts.
function hostCards() {
  const shown = st.allHosts || D.hosts.length <= COPY.program.shown ? D.hosts.length : COPY.program.shown;
  const rows = D.hosts.slice(0, shown).map((h, i) => `
      <div data-act="pickHost" data-i="${i}" aria-expanded="${st.host === i}" class="mx-row mx-ax-host${st.host === i ? ' is-open' : ''}">
        ${h.logo ? `<img class="mx-ax-hostmark" src="${esc(h.logo)}" alt="">` : `<span class="mx-ax-hostmark" aria-hidden="true">${HOST_GLYPH}</span>`}
        <span class="mx-row-l">${esc(h.name)}${h.city ? `<span class="mx-row-s">${esc(h.city)}</span>` : ''}</span>
        ${icon(st.host === i ? 'chevron-down' : 'chevron-right', 18)}
      </div>${st.host === i ? hostDetail(h) : ''}`).join('');
  const more = shown < D.hosts.length
    ? `<div data-act="allHosts" role="button" aria-expanded="false" class="mx-row mx-ax-allhosts"><span class="mx-row-l">${esc(COPY.program.allHosts(D.hosts.length))}</span>${icon('chevron-down', 18)}</div>` : '';
  return `<div class="mx-list mx-list--plain mx-ax-hosts">${rows}${more}</div>`;
}
// One drawer per host: every field the public endpoints carry that holds something, one row each; what is not
// filled in yet is said once.
function hostDetail(h) {
  const c = COPY.program.detail;
  const value = key => {
    if (key === 'about') return h.blurb ? esc(h.blurb) : '';
    if (key === 'spots') return h.spots !== null && !isNaN(h.spots) ? esc(COPY.program.positions(h.spots)) : '';
    if (key === 'year') return h.year ? esc(String(h.year)) : '';
    if (key === 'website') return h.website ? `<a href="${esc(h.website)}" target="_blank" rel="noopener">${esc(h.website.replace(/^https?:\/\//, '').replace(/\/$/, ''))} ↗</a>` : '';
    return h[key] ? esc(h[key]) : '';
  };
  const row = ([, label], v) => `<div class="mx-ax-dl"><span class="mx-ax-dt">${label}</span><span class="mx-ax-dd">${v}</span></div>`;
  const filled = c.rows.map(r => [r, value(r[0])]).filter(x => x[1]);
  const extras = c.extra.map(r => [r, value(r[0])]).filter(x => x[1]).map(([r, v]) => row(r, v)).join('');
  return `
      <div data-block="host-detail" class="mx-reveal mx-ax-hostdetail" tabindex="-1" aria-label="${esc(h.name)}">
        ${filled.map(([r, v]) => row(r, v)).join('')}${extras}
        ${filled.length < c.rows.length ? `<p class="mx-ax-note">${esc(c.more(opensInfo().label))}</p>` : ''}
        <span data-act="closeHost" role="button" class="mx-ax-textbtn">${c.close}</span>
      </div>`;
}
function blockProgram() {
  const about = (D.overview && D.overview.aboutProgram) ? esc(D.overview.aboutProgram) : COPY.program.body;
  return `
  <!-- dc: Accelerator.dc.html › "THE PROGRAM" (the statement needs no head) -->
  <section class="mx-sec" data-block="program">
    <p class="mx-ax-statement">${COPY.program.line}</p>
    <div class="mx-accs"><details class="mx-acc"><summary>${COPY.program.more}</summary><div class="mx-acc-a">${about}</div></details></div>
    <h3 class="mx-ax-h3">${COPY.program.whoTitle}</h3>
    ${checks(COPY.program.eligible)}
  </section>
  <!-- /dc -->
  <!-- dc: Accelerator.dc.html › "HOST LABS & CLINICS" -->
  <section class="mx-sec" id="acc-hosts" data-block="hosts-sec">
    ${sectionHead(COPY.program.hostsTitle, `<span class="mx-tag mx-tag--soft">${esc(String(D.hosts.length))}</span>`)}
    <div data-block="hosts">${hostCards()}</div>
  </section>
  <!-- /dc -->`;
}
function blockIncluded() {
  return `
  <!-- dc: Accelerator.dc.html › "WHAT'S INCLUDED" -->
  <section class="mx-sec" data-block="included">
    ${sectionHead(COPY.included.title)}
    ${checks(COPY.included.items)}
  </section>
  <!-- /dc -->`;
}
function blockSelection() {
  return `
  <!-- dc: Accelerator.dc.html › "HOW SELECTION WORKS" -->
  <section class="mx-sec" id="acc-selection" data-block="selection">
    ${sectionHead(COPY.selection.title)}
    <ol class="mx-timeline mx-ax-steps">${COPY.selection.steps(esc(shortDate(opensInfo().at) || opensInfo().label)).map(s => `
      <li class="mx-tl-row"><span class="mx-tl-time mx-ax-stepn">${s.n}</span><div class="mx-tl-body"><span class="mx-tl-title">${esc(s.t)}</span><span class="mx-tl-sub">${s.d}</span></div></li>`).join('')}
    </ol>
    <p class="mx-ax-note">${COPY.selection.note}</p>
  </section>
  <!-- /dc -->`;
}
// the application card keeps every state and every action it had, fee payment and the preview link included
function applicationCard() {
  const state = openState(); const a = appState();
  const previewBtn = `<a href="/app/accelerator/apply?preview=1" class="btn-ghost btn-sm">${COPY.application.preview}</a>`;
  const card = (tags, line, why, actions, foot) => `
        <div class="mx-ax-app">
          ${tags ? `<div class="mx-ax-apptags">${tags}</div>` : ''}
          <span class="mx-ax-appline">${line}</span>
          ${why ? `<span class="mx-ax-appwhy">${why}</span>` : ''}
          <div class="mx-ax-appact">${actions}</div>
          ${foot ? `<span class="mx-ax-note">${foot}</span>` : ''}
        </div>`;
  if (a.kind === 'none' || (a.kind === 'draft' && state !== 'open' && !a.row && !draftHasContent(draftValues()))) {
    const line = state === 'open' ? COPY.application.noneOpenLine : state === 'closed' ? COPY.application.closedLine : COPY.application.noneLine(esc(opensInfo().label));
    const actions = state === 'open'
      ? `<span data-act="goApply" role="button" class="btn-primary btn-sm">${COPY.application.start}</span>`
      : `<span data-act="notify" role="button" class="btn-ghost btn-sm">${st.notified ? COPY.application.notified : COPY.application.notify}</span>${previewBtn}`;
    return card('', line, '', actions);
  }
  if (a.kind === 'draft') {
    const pct = a.pct !== undefined ? a.pct : 0;
    return card(`<span class="mx-tag mx-tag--gold">${COPY.application.statusWord.draft}</span>`, COPY.application.draftLine(pct), COPY.application.draftWhy,
      `<span data-act="goApply" role="button" class="btn-primary btn-sm">${COPY.application.resume}</span>`);
  }
  const row = a.row; const s = a.kind; const num = row.application_number || 'Your application';
  const when = row.submitted_at || row.created_at ? fmt.longRange(String(row.submitted_at || row.created_at).slice(0, 10)) : '';
  const chipWord = s === 'result' ? COPY.application.statusWord[a.decision] : s === 'review' ? COPY.application.statusWord.review : COPY.application.statusWord.submitted;
  const line = s === 'result' ? COPY.application.resultLine : COPY.application.subLine(esc(num), when ? esc(when) : '');
  const why = s === 'result' ? COPY.application.resultWhy : s === 'review' ? COPY.application.reviewWhy : COPY.application.subWhy;
  const feePending = String(row.status) === 'submitted' && String(row.payment_status || '') !== 'paid';
  const tags = `<span class="mx-tag mx-tag--gold">${s === 'result' ? COPY.application.resultAvail : chipWord}</span>${s === 'result' ? `<span class="mx-tag mx-tag--soft">${chipWord}</span>` : ''}${row.institution_name ? `<span class="mx-ax-appinst">${esc(row.institution_name)}</span>` : ''}`;
  return card(tags, line, why,
    `<span data-act="goApply" role="button" class="btn-ghost btn-sm">${COPY.application.view}</span>
            ${feePending ? `<span data-act="payFee" data-app="${esc(row.id)}" role="button" class="btn-primary btn-sm">${COPY.application.payFee}</span>` : ''}`,
    feePending ? COPY.application.feeNote : '');
}
function resultsBlock() {
  if (!st.results) return '';
  const rows = st.results.rows;
  if (!rows.length) return `<div data-v2="results" class="mx-ax-results mx-ax-note">${COPY.results.none}</div>`;
  const mineNums = new Set(D.mine.map(r => r.application_number).filter(Boolean));
  const num = v => (v === null || v === undefined || v === '' || isNaN(Number(v))) ? '—' : Number(v).toFixed(1);
  return `
      <div data-v2="results" class="mx-ax-results">
        <div class="mx-ax-results-h"><span class="mx-ax-h3">${COPY.results.title(st.results.year || '')}</span><span class="mx-ax-note">${COPY.results.note}</span></div>
        <table>
          <thead><tr>${COPY.results.cols.map(c => `<th>${c}</th>`).join('')}</tr></thead>
          <tbody>
          ${rows.map((r, i) => {
            const own = mineNums.has(r.application_number);
            return `<tr${own ? ' class="is-own"' : ''}>
              <td class="mx-ax-rank">${esc(r.rank_position || i + 1)}</td>
              <td class="mx-ax-num">${esc(r.application_number || '—')}${own ? ` <span class="mx-ax-yours">${COPY.results.yours}</span>` : ''}</td>
              <td>${num(r.objective_score)}</td>
              <td>${num(r.interview_score)}</td>
              <td><strong>${num(r.total_score)}</strong></td>
              <td>${esc(r.status || '—')}</td>
            </tr>`;
          }).join('')}
          </tbody>
        </table>
      </div>`;
}
function blockApplication() {
  return `
  <!-- dc: Accelerator.dc.html › "YOUR APPLICATION" -->
  <section class="mx-sec" id="acc-application" data-block="application-sec">
    ${sectionHead(COPY.application.title)}
    <div data-block="application">${appSectionInner()}</div>
    <div class="mx-list mx-ax-followrow">
      <div class="mx-row" data-block="follow">${icon('bell')}<span class="mx-row-l">${COPY.hero.followTitle}</span><span data-act="tgFollow" role="switch" aria-checked="${st.follow}" aria-label="Get updates from the Accelerator" class="mx-switch"><span></span></span></div>
    </div>
  </section>
  <!-- /dc -->`;
}
// Fellows come from v2_accelerator_alumni and NOWHERE else (audit W6): one row per class (it opens on the names),
// newest first.
function cohortAccordions() {
  const list = D.alumni || [];
  const groups = [];
  list.forEach(f => {
    const key = f.year === null ? '' : String(f.year);
    let g = groups.find(x => x.key === key);
    if (!g) { g = { key, rows: [] }; groups.push(g); }
    g.rows.push(f);
  });
  return `<div class="mx-accs" data-block="fellows">${groups.map((g, i) => `
      <details class="mx-acc"${i === 0 ? '' : ''}><summary>${g.key ? COPY.cohorts.classOf(g.key) : COPY.cohorts.unknownYear}<span class="mx-ax-count">${esc(COPY.cohorts.count(g.rows.length))}</span></summary>
        <div class="mx-acc-a"><ul class="mx-ax-fellows">${g.rows.map(f => `<li><span class="mx-ax-fname">${esc(f.name)}</span>${f.where ? `<span class="mx-ax-fwhere">${esc(f.where)}</span>` : ''}</li>`).join('')}</ul></div>
      </details>`).join('')}</div>`;
}
// the team and the past fellows fold into two closed rows (GLASS-RULES §3.6): "The team" holds the five people,
// "Past fellows · 20" a row per class and the cohort photos. The count comes from the table.
function blockTeam() {
  return `
  <!-- dc: Accelerator.dc.html › "THE TEAM" + "PREVIOUS COHORTS" -->
  <section class="mx-sec" data-block="team">
    <div class="mx-accs">
      <details class="mx-acc"><summary>${COPY.team.title}</summary><div class="mx-acc-a">
        <div class="mx-person-rows">
          ${COPY.team.people.map(p => `<div class="mx-person-row">${ui.portrait({ name: p.name.replace(/,\s*MD$/, ''), size: 44, alt: '' })}<span class="mx-person-text"><span class="mx-person-name">${esc(p.name)}</span><span class="mx-person-role">${p.role}</span></span></div>`).join('')}
        </div>
      </div></details>
      <details class="mx-acc" data-block="cohorts"><summary>${COPY.cohorts.title}${hasAlumni() ? ` · ${esc(String(D.alumni.length))}` : ''}</summary><div class="mx-acc-a">
        ${hasAlumni() ? cohortAccordions() : ''}
        <div class="mx-shelf mx-ax-shelf" style="--w:260px">
          ${COPY.cohorts.photos.map(p => `<div class="mx-shelf-item"><div class="mx-media r-4x3"><img data-role="cohort-photo" src="${p.src}" alt="${p.alt}" loading="lazy" style="object-position:${p.pos}"></div></div>`).join('')}
        </div>
      </div></details>
    </div>
  </section>
  <!-- /dc -->`;
}
function blockFaq() {
  const list = D.faq || COPY.faq.list(esc(opensInfo().label));
  return `
  <!-- dc: Accelerator.dc.html › "FREQUENTLY ASKED" -->
  <section class="mx-sec" data-block="faq-sec">
    ${sectionHead(COPY.faq.title)}
    <div data-block="faq" class="mx-accs">${list.map(f => `
      <details class="mx-acc"><summary>${D.faq ? esc(f.q) : f.q}</summary><div class="mx-acc-a">${D.faq ? esc(f.a) : f.a}</div></details>`).join('')}
    </div>
  </section>
  <!-- /dc -->`;
}
function blockFooter() {
  return `
  <!-- dc: Accelerator.dc.html › "Footer · MESSAGE US" -->
  <section class="mx-sec">
    <div class="mx-list"><a class="mx-row" href="/app/messages?about=accelerator">${icon('mail')}<span class="mx-row-l">${COPY.footer.ask}</span>${chev()}</a></div>
  </section>
  <!-- /dc -->`;
}
function overviewTemplate() {
  return `
<div data-screen-label="Accelerator" class="mx-ax">
  ${blockCrumbs(false)}
  ${blockHero()}
  <div class="mx-p">
    <section class="mx-sec mx-sec--tight">${blockTabs(false)}</section>
    ${blockTiles()}
    ${blockProgram()}
    ${blockIncluded()}
    ${blockSelection()}
    ${blockApplication()}
    ${blockTeam()}
    ${blockFaq()}
    ${blockFooter()}
  </div>
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

// no large title (the seg says "My application"): the state tag and one line, and nothing at all before opening,
// where the gate card below says when applications open
function blockWizHeader(preview) {
  const state = openState();
  // DRAFT · NOT YET SUBMITTED only where a draft can exist (applications open, or one already saved)
  const gate = !W.submitted && !preview && state !== 'open' && appState().kind !== 'draft';
  const sub = W.submitted ? COPY.wiz.subDone : gate ? '' : COPY.wiz.sub;
  const pill = W.submitted
    ? COPY.wiz.pillSubmitted(W.submitted.submitted_at || W.submitted.created_at ? fmt.longRange(String(W.submitted.submitted_at || W.submitted.created_at).slice(0, 10)) : '')
    : (preview && state !== 'open') ? COPY.wiz.pillPreview(fmt.upper(esc(opensInfo().label)))
    : gate ? ''                       // the gate card below says it once ("Applications open 15 November 2026.")
    : COPY.wiz.pillDraft;
  const right = gate ? ''
    : state === 'open'
    ? (D.intake && D.intake.closes_at ? COPY.wiz.closes(fmt.upper(esc(zagrebDate(D.intake.closes_at)))) : '')
    : '';
  if (!pill && !right && !sub) return '';
  return `
  <!-- dc: Accelerator Application.dc.html › "Header band" -->
  <section class="mx-sec mx-sec--tight mx-ax-wizhead">
    ${pill || right ? `<div class="mx-ax-apptags">${pill ? `<span class="mx-tag mx-tag--gold">${pill}</span>` : ''}${right ? `<span class="mx-ax-appinst">${right}</span>` : ''}</div>` : ''}
    ${sub ? `<p class="mx-lede">${sub}</p>` : ''}
  </section>
  <!-- /dc -->`;
}
// "Step 2 of 7" over seven segments (the step's title heads the panel below); each segment still jumps to its step
function blockStepper() {
  const c = completion();
  const doneByStep = { 1: c.items[0].done, 2: c.items[1].done, 3: c.items[2].done, 4: c.items[3].done, 5: c.items[4].done, 6: c.consentsDone || !!W.submitted, 7: !!W.submitted };
  return `
  <!-- dc: Accelerator Application.dc.html › "Stepper" -->
  <div data-block="stepper" class="mx-ax-stepper">
    <div class="mx-ax-steplabel"><span>${COPY.wiz.stepOf(W.step)}</span></div>
    <div class="mx-ax-segs" role="tablist" aria-label="Application steps">
    ${COPY.wiz.steps.map((label, i) => {
      const n = i + 1, cur = n === W.step, done = doneByStep[n] && !cur;
      return `<span data-act="go" data-step="${n}" role="tab" aria-selected="${cur}" aria-label="Step ${n} · ${label}" class="mx-ax-seg${cur ? ' is-cur' : done ? ' is-done' : ''}"></span>`;
    }).join('')}
    </div>
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
         <span style="font:600 12px Inter,sans-serif;letter-spacing:.12em;color:#6e5626;white-space:nowrap">PDF</span>
         <span style="font-size:14px;color:#191512;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(file.name)} <span style="color:#4a4239">(${(file.size / 1024).toFixed(1)} KB)</span></span>
         <span data-act="clearFile" data-doc="${key}" style="display:inline-flex;align-items:center;min-height:44px;font:500 14px Inter,sans-serif;color:#9b1b22;cursor:pointer;white-space:nowrap">${COPY.wiz.upload.remove}</span>
       </div>`
    : `<div class="mx-ax-drop" data-act="pickFile" data-doc="${key}" role="button" aria-label="Upload ${key}" style="border:1px dashed rgba(25,21,18,.3);background:#f7f1e6;padding:18px 14px;display:flex;flex-direction:column;align-items:center;gap:5px;cursor:pointer;text-align:center">
         <span style="font:600 13px Inter,sans-serif;letter-spacing:.12em;color:#9b1b22">${COPY.wiz.upload.click}<span style="color:#4a4239;letter-spacing:0;text-transform:none;font-weight:400">${COPY.wiz.upload.drag}</span></span>
         <span style="font-size:14px;color:#4a4239">${COPY.wiz.upload.pdf}</span>
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
          <div style="font:400 22px/28px Fraunces,serif">${title}</div>
          ${subHtml ? `<div style="font-size:14px;line-height:20px;color:#4a4239;margin-top:4px">${subHtml}</div>` : ''}
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
          <details class="mx-acc mx-ax-gdpr"><summary>${COPY.wiz.gdprTitle}</summary><div class="mx-acc-a">${COPY.wiz.gdpr}</div></details>
          ${COPY.wiz.consents.map((c, i) => `
          <label style="display:flex;align-items:flex-start;gap:12px;cursor:pointer">
            <input type="checkbox" data-consent="c${i + 1}"${W.consents['c' + (i + 1)] ? ' checked' : ''} style="margin-top:2px;width:20px;height:20px;flex:none">
            <span style="font-size:16px;color:#191512;line-height:1.5">${c} ${F.req}</span>
          </label>`).join('')}
        </div>`;
  return panelReview();
}
function panelReview() {
  const c = completion();
  const canSubmit = c.items.slice(0, 5).every(i => i.done) && c.consentsDone;
  const v = W.values;
  const docs = [W.files.cv && 'CV', W.files.transcript && 'Transcript', W.files.recommendation && 'Recommendation'].filter(Boolean);
  const sumRow = (l, val) => `<div class="mx-ax-dl"><span class="mx-ax-dt">${l}</span><span class="mx-ax-dd">${val || '—'}</span></div>`;
  const degree = (DEGREES.find(d => d[0] === v.axDegree) || [])[1] || '';
  return `${stepHead(7, COPY.wiz.stepTitles[6], COPY.wiz.reviewSub)}
        <div class="mx-ax-panel-pad" style="padding:8px 28px 26px">
          <div class="mx-list mx-list--plain">
          ${c.items.map(it => `
            <span data-act="go" data-step="${it.step}" role="button" class="mx-row">${ui.icon(it.done ? 'check' : 'edit')}<span class="mx-row-l">${it.label}</span><span class="mx-row-v${it.done ? '' : ' mx-ax-todo'}">${it.done ? COPY.wiz.reviewStatus.done : COPY.wiz.reviewStatus.todo}</span>${ui.icon('chevron-right', 18)}</span>`).join('')}
          </div>
          <!-- v2: legacy Application Summary (app.part9.js › updateReview), quiet definition list -->
          <details class="mx-acc mx-ax-summary"><summary>${COPY.wiz.summaryTitle}</summary><div class="mx-acc-a">
            ${sumRow('Name', esc([v.axFirstName, v.axLastName].filter(Boolean).join(' ')))}
            ${sumRow('Email', esc(v.axEmail))}
            ${sumRow('Institution', esc(v.axInstitution))}
            ${sumRow('Degree', esc(degree))}
            ${sumRow('First choice', esc(choiceName(v.axChoice1)))}
            ${sumRow('Second choice', esc(choiceName(v.axChoice2)))}
            ${sumRow('Documents', esc(docs.length ? docs.join(', ') : 'None uploaded'))}
          </div></details>
          <div class="mx-ax-submitrow">
            <span data-act="submit" role="button" aria-disabled="${canSubmit && !W.busy ? 'false' : 'true'}" class="btn-primary btn-block mx-ax-submit">${W.busy ? COPY.wiz.submitting : COPY.wiz.submit}</span>
            <span data-act="pdf" role="button" class="btn-ghost btn-sm">${COPY.wiz.pdf}</span>
            <span class="mx-ax-note">${canSubmit ? COPY.wiz.summaryNote : COPY.wiz.submitHint}</span>
          </div>
        </div>`;
}
function panelSubmitted() {
  const r = W.submitted;
  const when = r && (r.submitted_at || r.created_at) ? fmt.longRange(String(r.submitted_at || r.created_at).slice(0, 10)) : '';
  const feePending = r && String(r.status) === 'submitted' && String(r.payment_status || '') !== 'paid';
  return `${stepHead(7, COPY.wiz.stepTitles[6], '')}
        <div class="mx-ax-panel-pad mx-ax-app mx-ax-app--flat" style="padding:10px 28px 26px">
          <span class="mx-ax-appline">${COPY.wiz.submittedLine(esc(r && r.application_number || 'received'))}</span>
          <span class="mx-ax-appwhy">${COPY.wiz.submittedWhy(esc((r && r.email) || ''))}${when ? ` Submitted ${esc(when)}.` : ''}</span>
          <div class="mx-ax-appact">
            <a href="/app/accelerator" class="btn-ghost btn-sm">BACK TO THE OVERVIEW →</a>
            ${feePending ? `<span data-act="payFee" data-app="${esc(r.id)}" role="button" class="btn-primary btn-sm">${COPY.application.payFee}</span>` : ''}
          </div>
          ${feePending ? `<span class="mx-ax-note">${COPY.application.feeNote}</span>` : ''}
        </div>`;
}
function blockChecklist() {
  const c = completion();
  return `
      <div data-block="checklist" class="mx-ax-rail-card">
        <div class="mx-ax-railhead"><span class="mx-ax-h3">${COPY.wiz.checklist.title}</span><span class="mx-ax-pct">${c.pct}%</span></div>
        <div class="mx-ax-bar"><span style="width:${c.pct}%"></span></div>
        <ul class="mx-checks mx-ax-railchecks">${c.items.map(it => `<li class="${it.done ? 'is-done' : ''}">${ui.icon(it.done ? 'check' : 'plus', 18)}<span>${it.label}</span></li>`).join('')}</ul>
      </div>`;
}
function blockRail() {
  return `
    <div class="mx-ax-rail">
      <!-- dc: Accelerator Application.dc.html › "APPLICATION CHECKLIST" -->
      ${blockChecklist()}
      <!-- /dc -->
      <!-- dc: Accelerator Application.dc.html › "BEFORE YOU START" + "Stuck on a question?" -->
      <div class="mx-list">
        <details class="mx-acc mx-ax-before"><summary>${ui.icon('help')}${COPY.wiz.before.titleShort}</summary><div class="mx-acc-a">${COPY.wiz.before.body}</div></details>
        <a class="mx-row" href="/app/messages?about=accelerator">${ui.icon('mail')}<span class="mx-row-l">${COPY.wiz.stuck.line}<span class="mx-row-s">${COPY.wiz.stuck.sub}</span></span>${ui.icon('chevron-right', 18)}</a>
      </div>
      <!-- /dc -->
    </div>`;
}
function blockWizFooterNav() {
  const first = W.step <= 1, last = W.step >= 7;
  return `
      <div class="mx-ax-footer">
        <span data-act="prev" role="button" aria-disabled="${first ? 'true' : 'false'}" class="btn-ghost btn-sm">${COPY.wiz.prev}</span>
        <span data-role="saved" class="mx-ax-saved">${savedLabel()}</span>
        ${!last ? `<span data-act="next" role="button" class="btn-primary btn-sm">${COPY.wiz.next}</span>` : ''}
      </div>`;
}
function wizardMain() {
  return `
  <div data-block="wizard" class="mx-ax-wizard">
    <!-- dc: Accelerator Application.dc.html › "Wizard · main panel" -->
    <div class="mx-ax-panel">
      <div data-block="panel">${stepPanel()}</div>
      <!-- dc: Accelerator Application.dc.html › "Footer nav" -->
      <div data-block="footnav">${blockWizFooterNav()}</div>
      <!-- /dc -->
    </div>
    <!-- /dc -->
    ${blockRail()}
  </div>`;
}
// before applications open: when they open, one line, and two actions (get notified · preview the form)
function gateCard(preview) {
  const state = openState();
  const line = state === 'closed' ? COPY.wiz.gate.closedLine : COPY.wiz.gate.line(esc(opensInfo().label));
  return `
  <!-- dc: Accelerator.dc.html › "04 · YOUR APPLICATION" (Get-notified capture — wizard hidden until applications open) -->
  <section class="mx-sec mx-sec--tight">
    <div class="mx-ax-app">
      <span class="mx-ax-appline">${line}</span>
      <span class="mx-ax-appwhy">${COPY.wiz.gate.why}</span>
      <div class="mx-ax-appact mx-ax-gateact">
        <span data-act="notify" role="button" class="btn-primary btn-block">${st.notified ? COPY.application.notified : COPY.application.notify}</span>
        <span data-act="toPreview" role="button" class="btn-ghost btn-block">${COPY.wiz.gate.preview}</span>
      </div>
    </div>
  </section>
  <!-- /dc -->`;
}
function applyTemplate(preview) {
  const state = openState();
  const showWizard = state === 'open' || preview || !!W.submitted;
  return `
<div data-screen-label="Accelerator Application" class="mx-ax">
  ${blockCrumbs(true)}
  <div class="mx-p">
    <section class="mx-sec mx-sec--tight">${blockTabs(true)}</section>
    ${blockWizHeader(preview)}
    ${showWizard ? `<section class="mx-sec mx-sec--tight">${blockStepper()}${wizardMain()}</section>` : gateCard(preview)}
  </div>
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
// The follow switch (the "Updates" row) painted in place (the switch shows the state); the hero's action follows
// once the save has landed.
function paintFollow(on) {
  const row = rootEl && rootEl.querySelector('[data-block="follow"]');
  if (!row) return;
  const sw = row.querySelector('[role="switch"]'); if (sw) sw.setAttribute('aria-checked', String(!!on));
}
function repaintAfterFollow() {
  const cta = rootEl && rootEl.querySelector('[data-block="hero"] [data-role="hero-cta"]');
  if (cta) cta.innerHTML = heroCta();
  if (rootEl && rootEl.querySelector('[data-block="application"]')) rerender('[data-block="application"]', `<div data-block="application">${appSectionInner()}</div>`);
}
// flips in place at once (ui.toggleSwitch) — the POST runs behind it and a failure flips it back
function setFollow(el) {
  return ui.toggleSwitch(el, async on => {
    await api.post('/api/notify-topics', { project: 'accelerator', on });
    st.follow = on; if (on) st.notified = true;
    ui.toast(on ? COPY.hero.followOnToast : COPY.hero.followOffToast);
    repaintAfterFollow();
    chrome.refresh();
  }, paintFollow);
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
      paintFollow(true);                 // the hero switch eases on — the visible result of "notify me"
      repaintAfterFollow();
      const gateBtn = rootEl.querySelector('[data-screen-label="Accelerator Application"] [data-act="notify"]');
      if (gateBtn) gateBtn.textContent = COPY.application.notified;
      chrome.refresh();
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  tgFollow: (el) => setFollow(el),
  // the detail opens BELOW the grid — often under the fold, so a click seemed to do nothing and the re-draw
  // dropped keyboard focus to <body>. It is brought into view (smoothly unless reduced motion) and takes focus;
  // closing returns focus to the card that opened it.
  pickHost: (el) => {
    const i = parseInt(el.dataset.i, 10); st.host = st.host === i ? null : i;
    rerender('[data-block="hosts"]', `<div data-block="hosts">${hostCards()}</div>`);
    const panel = st.host !== null && rootEl.querySelector('[data-block="host-detail"]');
    if (panel) { panel.scrollIntoView({ block: 'nearest', behavior: ui.reducedMotion() ? 'auto' : 'smooth' }); try { panel.focus({ preventScroll: true }); } catch (e) {} }
    else focusCard(i);
  },
  // "All 8 hosts": the rest of the list opens in place, focus on the first row that was hidden
  allHosts: () => {
    st.allHosts = true;
    rerender('[data-block="hosts"]', `<div data-block="hosts">${hostCards()}</div>`);
    focusCard(COPY.program.shown);
  },
  closeHost: (el, ev) => {
    ev.stopPropagation(); const i = st.host; st.host = null;
    rerender('[data-block="hosts"]', `<div data-block="hosts">${hostCards()}</div>`);
    if (i !== null) focusCard(i);
  },
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
        ${applicationCard()}
        ${lookupLive ? `
        <div class="mx-ax-lookup">
          <label class="label" for="ax-code">${COPY.results.label}</label>
          <div class="mx-ax-lookrow">
            <input id="ax-code" class="input" data-role="code" placeholder="${COPY.results.placeholder}" aria-label="Results access code" maxlength="9" autocapitalize="characters" autocomplete="off" spellcheck="false">
            <span data-act="viewResults" role="button" class="btn-ghost btn-sm">${COPY.results.view}</span>
          </div>
          <span class="mx-ax-note">${COPY.results.hint}</span>
        </div>
        <div data-role="codeErr" role="alert" class="mx-ax-err" style="${st.codeErr ? '' : 'display:none'}">${esc(st.codeErr || '')}</div>
        <div data-block="results">${resultsBlock()}</div>` : `
        <!-- v2: RESULTS LOOKUP hidden until applications open (openState() 'before' — intake state, FACTS.accelerator.opens fallback) — UX audit item 15 -->`}`;
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
        ui.tick(rootEl && rootEl.querySelector('[data-cd="opendays"]'), daysTo(cd.target));
      }, 60000));
    }
  }
}

export default {
  // sections below the fold rise in on scroll (router › ui.revealOnScroll) — not on the application form
  reveal: (ctx) => !(ctx && ctx.params && ctx.params.tab === 'apply'),
  title(ctx) { return ctx && ctx.params && ctx.params.tab === 'apply' ? 'My application' : 'The Accelerator'; },
  async render(root, ctx) {
    injectCss();
    rootEl = root;
    D = await load(false);
    if (rootEl !== root || (ctx.ready && !(await ctx.ready()))) return; // navigated away while loading, or the router moved on
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
