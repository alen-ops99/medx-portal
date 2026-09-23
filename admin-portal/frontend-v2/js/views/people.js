// Source: Admin People.dc.html
// Blocks (artboard order): "Title row" (People · sub · EXPORT CSV · + ADD A PERSON) ›
// "New person panel" › "Search + segments" (+ v2 registrations quick-links row) ›
// v2 "Possible duplicates" strip (team review Aug 2026 — Laura + Miro) ›
// "Directory + member file" (list card 1fr · 330px side: member file panel + GUEST PASSES).
// Data: GET /api/v2/people/directory (the union list — see backend/v2/people.js; rows carry a
// stable `key`, hygiene `flags` and merge suppression), /api/team, /api/admin/guest-passes,
// /api/admin/guest-pass-events, /api/admin/nag/items; the file panel enriches a portal member via
// GET /api/admin/users/:id/profile (title/photo/specialties incl.).
// Hygiene (team review): segment chips are MULTI-SELECT (union — anyone in any picked segment);
// EXPORT CSV exports exactly the visible filtered+searched list, UTF-8 BOM so Croatian names
// survive Excel; UNSUBSCRIBED chip + mailing/GDPR toggles read+write /api/v2/people/flags
// (unsubscribe truth stays in the newsletter tables — the flag is an admin overlay);
// the duplicates strip folds rows via POST /api/v2/people/merge, UNDO deletes the merge row.
// Privacy: no password/secret field is ever fetched or rendered.
// Audit 2026-09-02 #11: directory rows are single-line (name · dimmed email inline, ~40px),
// the render windows at 60 with SHOW ALL N, and the COUNTRY column normalizes at render
// (HR → Croatia, US/USA → United States — countryName(); stored values and CSV exports untouched).
// REPORTS (App Store 1.2 — backend v2/safety-ops.js, section member-ops): members report a profile or a
// message from the ⋯ next to a person (or on a message) in the member portal; the title row's REPORTS chip
// carries the open count and opens the queue (open by default while anything is open, and /people?reports=1
// — the PEOPLE ▾ › Reports row and the Today line land there). Per report: REMOVE MESSAGE (out of both
// inboxes; the text stays here) · HIDE PROFILE (out of the directory, the member cannot switch it back) ·
// SUSPEND ACCOUNT (a short reason; they cannot sign in) · REVIEWED · DISMISS, an optional note, each
// destructive one behind a confirm; UNSUSPEND / UNHIDE undo the last two. When the live message is gone or
// removed, the copy saved with the report (text, sender, time, up to 10 other messages) shows instead.
// The reported member's name opens their file here. HANDLED lists the rest with REOPEN. No email is sent.
import { api } from '../api.js';
import { ui, esc, fmt } from '../ui.js';
import { FACTS } from '../facts.js';
import { chrome } from '../chrome.js';
import router from '../router.js';

export const SOURCE = 'Admin People.dc.html';

export const COPY = {
  title: 'People', sub: 'one list for everyone — members, event guests, your team',
  exportBtn: (n, f) => `EXPORT CSV · ${n}${f ? ' FILTERED' : ''}`, exported: n => `EXPORTED ${n} PEOPLE · CSV`,
  addBtn: '+ ADD A PERSON', addLabel: 'NEW PERSON', add: 'ADD',
  addNote: 'Members get a portal invitation email automatically · contacts stay internal until you invite them.',
  kinds: ['Member', 'Gala guest', 'Plexus registrant', 'Contact only'],
  addedMember: 'ADDED — INVITATION QUEUED IN THE OUTBOX', added: 'ADDED TO PEOPLE',
  nameFirst: 'THE NAME IS THE ONE THING I NEED',
  searchPh: 'Type a name, email or country — e.g. “Ivana”, “Ireland”, “not paid”',
  // Audit W11: GALA here is distinct PEOPLE (one per email — plus-ones are not separate people),
  // which is a smaller number than the Gala screen's seats and the Registrations row count.
  segs: {
    ALL: 'EVERYONE', MEMBERS: 'MED&X MEMBERS', FORUM: 'FORUM MEMBERS', REGISTRANTS: 'PLEXUS',
    GALA: 'GALA GUESTS (PEOPLE)', BOSTON: FACTS.bridges.next.city.toUpperCase(), TEAM: 'YOUR TEAM'
  },
  segsNote: 'Chips combine — pick several and the list shows anyone in any of them.',
  dividers: { MEMBERS: 'CIRCLES', REGISTRANTS: 'REGISTRANTS', TEAM: 'STAFF' },
  quick: 'REGISTRATIONS:',
  cols: { name: 'NAME', country: 'COUNTRY', status: 'STATUS' },
  open: 'OPEN →', emptyList: 'No one matches — try fewer words.',
  rowsNote: (n, total) => `Showing ${n} of ${total} people · everyone in the database, live`,
  showAll: n => `SHOW ALL ${n}`,
  panelNote: 'Actions match the person — guests with a payment still open get payment tools, team members get access tools.',
  actions: { message: 'MESSAGE', markPaid: 'MARK PAID', chase: 'CHASE PAYMENT', resend: 'RESEND TICKET', copyPass: 'COPY PASS LINK', perms: 'PERMISSIONS →', regs: 'REGISTRATIONS →' },
  toasts: {
    markPaid: 'MARKED PAID — LEDGER & MONEY UPDATE TOO', chased: 'REMINDER QUEUED IN THE OUTBOX FOR YOUR OK',
    chaseInOutbox: 'THE REMINDER IS ALREADY IN THE OUTBOX — APPROVE IT THERE', chaseNone: 'NO REMINDER PREPARED YET — THE NAG ENGINE ADDS ONE AS THE PAYMENT AGES',
    passCopied: 'PASS LINK COPIED — SEND IT ANYWHERE', minted: 'PASS MINTED — COPY THE LINK TO SEND IT', passName: 'TYPE THE GUEST’S NAME FIRST'
  },
  facts: {
    memberSince: 'MEMBER SINCE', lastActive: 'LAST ACTIVE', galaSeat: 'GALA SEAT', plexus: 'PLEXUS',
    bridges: 'BRIDGES', forum: 'FORUM', role: 'ROLE', lastSeen: 'LAST SEEN', pass: 'PASS', created: 'CREATED',
    lastOpened: 'LAST OPENED', events: 'EVENTS', paidTotal: 'PAID TOTAL', title: 'TITLE', contact: 'CONTACT',
    reminder: 'REMINDER', never: 'Never', pending: 'Reserved · payment pending', free: 'Registered · free entry',
    fullAccess: 'full access', todayOnly: 'Today only', sections: n => `${n} section${n === 1 ? '' : 's'}`,
    reminderReady: 'Ready to queue in Outbox', reminderStaged: 'Reminder is in the Outbox — approve it there'
  },
  passes: {
    title: 'GUEST PASSES',
    sub: 'A personal link for a high-level guest — one person, one event, only what you grant. No login, beautiful on a phone.',
    copy: 'COPY LINK', copied: '✓ COPIED', mint: 'MINT PASS', ph: 'Guest’s name…',
    note: "Every project has its own VIP passes — they also appear on that project's hub."
  },
  hyg: {
    title: 'HYGIENE', mailing: 'MAILING', consent: 'GDPR', mergedIn: 'MERGED IN',
    unsub: 'UNSUBSCRIBED — NO BULK EMAIL', mailOk: 'OK TO EMAIL',
    consentYes: 'CONSENT ON FILE', consentNo: 'NOT RECORDED',
    src: { newsletter: 'their own unsubscribe click · newsletter record', pr: 'PR subscriber list record', admin: by => 'set here' + (by ? ' by ' + by : '') },
    notePh: 'Where the consent comes from — e.g. “collected at the Plexus form”',
    saveNote: 'SAVE', needEmail: 'No email on file — mailing and consent flags need an address.',
    resubAsk: { title: 'Mark them mailable again?', body: 'They unsubscribed themselves — the newsletter list keeps that record either way. This only sets an admin note here saying bulk email is fine again.', ok: 'MARK OK TO EMAIL' },
    unsubbed: 'MARKED UNSUBSCRIBED — BULK EMAIL TOOLS SKIP THEM', resubbed: 'MARKED OK TO EMAIL',
    consentSaved: 'GDPR CONSENT UPDATED', noteSaved: 'CONSENT NOTE SAVED'
  },
  reports: {
    chip: 'REPORTS', badgeTitle: n => `${n} open report${n === 1 ? '' : 's'} from members`,
    title: 'REPORTS FROM MEMBERS',
    sub: 'A member flagged a profile or a message. Answer within 24 hours. REMOVE MESSAGE takes it out of the conversation, REMOVE PHOTO and CLEAR PROFILE TEXT take content off a profile, HIDE PROFILE takes the member out of the directory, SUSPEND ACCOUNT stops them signing in. Every action is logged.',
    tabOpen: n => `OPEN · ${n}`, tabHandled: n => `HANDLED · ${n}`,
    kind: { member: 'PROFILE', message: 'MESSAGE' },
    reported: 'reported', noteLabel: 'NOTE', messageLabel: 'THE MESSAGE', messageGone: 'The message is no longer there, and no copy was saved with this report.',
    savedLabel: 'THE MESSAGE · COPY SAVED WITH THE REPORT', bioLabel: 'PROFILE TEXT WHEN REPORTED', profileLabel: 'PROFILE WHEN REPORTED',
    portraitOnFile: 'PORTRAIT ON FILE', ctxRemoved: 'REMOVED', ctxGone: 'NO LONGER THERE',
    from: (name, email, when) => ['from ' + (name || 'the member'), email, when].filter(Boolean).join(' · '),
    removedTag: (who, when) => `REMOVED${who ? ' BY ' + String(who).toUpperCase() : ''}${when ? ' · ' + when : ''}`,
    earlier: (name, n) => `OTHER MESSAGES FROM ${String(name || 'THE MEMBER').toUpperCase()} · ${n}`,
    late: 'WAITING OVER 24 H',
    openOnTarget: n => `${n} OPEN ON THIS MEMBER`, hiddenTag: 'PROFILE HIDDEN', modHiddenTag: 'HIDDEN BY THE TEAM', goneTag: 'ACCOUNT CLOSED', teamTag: 'MED&X TEAM',
    suspendedTag: 'SUSPENDED', suspendedLine: (when, why) => `Suspended${when ? ' ' + when : ''}${why ? ' — ' + why : ''}`,
    status: { reviewed: 'REVIEWED', actioned: 'ACTIONED', dismissed: 'DISMISSED', open: 'OPEN' },
    handledBy: (label, who, when) => `${label}${who ? ' by ' + who : ''}${when ? ' · ' + when : ''}`,
    notePh: 'Note for the team (optional)',
    act: { reviewed: 'REVIEWED', hide: 'HIDE PROFILE', dismiss: 'DISMISS', reopen: 'REOPEN', remove: 'REMOVE MESSAGE', suspend: 'SUSPEND ACCOUNT', unsuspend: 'UNSUSPEND', unhide: 'UNHIDE PROFILE',
      clearPhoto: 'REMOVE PHOTO', clearText: 'CLEAR PROFILE TEXT', removeOne: 'REMOVE', removeAll: name => `REMOVE ALL FROM ${String(name || 'THE MEMBER').toUpperCase()}` },
    toast: {
      reviewed: 'MARKED REVIEWED', dismissed: 'REPORT DISMISSED', open: 'REPORT IS OPEN AGAIN', hidden: n => `${String(n).toUpperCase()} IS OUT OF THE DIRECTORY — REPORT ACTIONED`,
      removed: 'MESSAGE REMOVED FROM THE CONVERSATION — REPORT ACTIONED', removedAlready: 'THAT MESSAGE WAS ALREADY REMOVED — REPORT ACTIONED',
      suspended: n => `${String(n).toUpperCase()} IS SUSPENDED — REPORT ACTIONED`, unsuspended: n => `${String(n).toUpperCase()} CAN SIGN IN AGAIN`,
      unhidden: n => `${String(n).toUpperCase()} IS BACK IN THE DIRECTORY`, notFound: 'NOT IN THE PEOPLE LIST — SEARCH BY EMAIL',
      removedAll: n => n ? `${n} MESSAGE${n === 1 ? '' : 'S'} REMOVED — REPORT ACTIONED` : 'NOTHING LEFT TO REMOVE — REPORT ACTIONED',
      photoCleared: n => `${String(n).toUpperCase()}’S PHOTO IS REMOVED — REPORT ACTIONED`, textCleared: n => `${String(n).toUpperCase()}’S PROFILE TEXT IS CLEARED — REPORT ACTIONED`
    },
    hideAsk: { eyebrow: 'REPORTS · HIDE PROFILE', title: n => `Hide ${n}’s profile?`, body: 'They drop out of the member directory, search, suggestions and the Forum member list, and cannot switch the directory back on themselves. Their profile page says the Med&X team hid it. Nothing is deleted, and UNHIDE PROFILE puts it back.', ok: 'HIDE PROFILE', cancel: 'CANCEL' },
    removeAsk: { eyebrow: 'REPORTS · REMOVE MESSAGE', title: 'Remove this message?', body: (from, to) => `It leaves the conversation between ${from} and ${to} on both sides at once, and drops out of their unread counts. The text stays here with the report. The rest of the thread is untouched.`, ok: 'REMOVE MESSAGE', cancel: 'CANCEL' },
    suspendAsk: { eyebrow: 'REPORTS · SUSPEND ACCOUNT', title: n => `Suspend ${n}’s account?`, body: 'The next screen they open, on any device, signs them out and tells them the account is suspended. They cannot sign in, message anyone or send requests, and they drop out of the directory. Their data stays. UNSUSPEND lifts it.', reasonLabel: 'REASON — FOR THE TEAM', reasonPh: 'e.g. Threatening messages to a member', reasonMissing: 'Add a short reason first.', ok: 'SUSPEND ACCOUNT', cancel: 'CANCEL' },
    unsuspendAsk: { eyebrow: 'REPORTS · UNSUSPEND', title: n => `Let ${n} sign in again?`, body: 'The suspension is lifted at once. They reappear in the directory if their own profile is public.', ok: 'UNSUSPEND', cancel: 'CANCEL' },
    removeAllAsk: { eyebrow: 'REPORTS · REMOVE ALL', title: n => `Remove every message ${n} sent to this member?`, body: (from, to) => `Every message from ${from} to ${to} leaves the conversation on both sides at once, including any not listed here, and drops out of the unread counts. The texts saved with reports stay here. What ${to} wrote stays.`, ok: 'REMOVE ALL', cancel: 'CANCEL' },
    clearPhotoAsk: { eyebrow: 'REPORTS · REMOVE PHOTO', title: n => `Remove ${n}’s photo?`, body: 'The portrait leaves their profile, the directory, message headers and the Forum, and the file is deleted. They can upload a new one. The account stays open.', ok: 'REMOVE PHOTO', cancel: 'CANCEL' },
    clearTextAsk: { eyebrow: 'REPORTS · CLEAR PROFILE TEXT', title: n => `Clear ${n}’s profile text?`, body: 'Their bio, title and specialty tags are emptied wherever other members see them, including the Forum profile and research interests. Name and institution stay. New text they write goes through the content filter. The account stays open.', ok: 'CLEAR PROFILE TEXT', cancel: 'CANCEL' },
    unhideAsk: { eyebrow: 'REPORTS · UNHIDE PROFILE', title: n => `Put ${n} back in the directory?`, body: 'Their profile shows in the directory, search and suggestions again, and the directory switch on their own profile works again.', ok: 'UNHIDE PROFILE', cancel: 'CANCEL' },
    empty: 'No open reports.', emptyWhy: 'When a member reports a profile or a message from the ⋯ next to a person, it lands here.',
    emptyHandled: 'Nothing handled yet.'
  },
  dups: {
    title: 'POSSIBLE DUPLICATES',
    sub: n => `${n} group${n === 1 ? '' : 's'} · same name or same email start — pick the row that survives, the rest fold into it`,
    reasonName: 'SAME NAME', reasonEmail: 'SAME EMAIL START',
    keep: 'KEEP THIS ONE', dismiss: 'LEAVE AS SEPARATE PEOPLE',
    more: n => `+ ${n} more group${n === 1 ? '' : 's'} — merge these first`,
    confirmTitle: (n, name) => `Fold ${n === 1 ? 'one row' : n + ' rows'} into ${name}?`,
    confirmFoot: 'Nothing is deleted — the folded rows stop appearing in People and every registration stays where it is. UNDO waits in this strip afterwards.',
    confirmOk: 'MERGE', confirmCancel: 'CANCEL',
    merged: (kept, n) => `MERGED ${n} ROW${n === 1 ? '' : 'S'} INTO ${kept.toUpperCase()}`,
    sessionTitle: 'MERGED THIS SESSION:', undo: 'UNDO', undone: 'MERGE UNDONE — THE ROW IS BACK',
    dismissed: 'OK — LEFT AS SEPARATE PEOPLE', teamKeep: 'Team rows always survive — pick the team member as the keeper.'
  }
};

// ---- country display normalization (audit #11: the column mixed "Croatia", "HR", "USA", "US") ----
// Render-time only — the stored value stays exactly as it arrived (ISO or free text); exports keep
// the stored form. Codes and the common variants fold to one full English name.
const COUNTRY_NAMES = {
  hr: 'Croatia', croatia: 'Croatia', hrvatska: 'Croatia',
  us: 'United States', usa: 'United States', 'united states': 'United States', 'united states of america': 'United States', 'u.s.': 'United States', 'u.s.a.': 'United States', america: 'United States',
  uk: 'United Kingdom', gb: 'United Kingdom', 'great britain': 'United Kingdom', 'united kingdom': 'United Kingdom', england: 'United Kingdom',
  de: 'Germany', deutschland: 'Germany', njemačka: 'Germany',
  at: 'Austria', ch: 'Switzerland', ie: 'Ireland', fr: 'France', it: 'Italy', es: 'Spain', pt: 'Portugal',
  si: 'Slovenia', slovenija: 'Slovenia', ba: 'Bosnia and Herzegovina', bih: 'Bosnia and Herzegovina', 'bosnia': 'Bosnia and Herzegovina', 'bosnia and herzegovina': 'Bosnia and Herzegovina',
  rs: 'Serbia', srbija: 'Serbia', me: 'Montenegro', mk: 'North Macedonia',
  nl: 'Netherlands', 'the netherlands': 'Netherlands', holland: 'Netherlands', be: 'Belgium', lu: 'Luxembourg',
  se: 'Sweden', no: 'Norway', dk: 'Denmark', fi: 'Finland', is: 'Iceland',
  pl: 'Poland', cz: 'Czechia', 'czech republic': 'Czechia', sk: 'Slovakia', hu: 'Hungary', gr: 'Greece', tr: 'Turkey', ro: 'Romania', bg: 'Bulgaria',
  ca: 'Canada', au: 'Australia', nz: 'New Zealand', jp: 'Japan', cn: 'China', kr: 'South Korea', il: 'Israel', ae: 'United Arab Emirates', qa: 'Qatar', sa: 'Saudi Arabia',
  br: 'Brazil', ar: 'Argentina', mx: 'Mexico', in: 'India', za: 'South Africa'
};
export function countryName(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  return COUNTRY_NAMES[s.toLowerCase()] || s;
}

const SEG_ORDER = ['ALL', 'MEMBERS', 'FORUM', 'REGISTRANTS', 'GALA', 'BOSTON', 'TEAM'];
const QUICK_LINKS = [['PLEXUS', '/registrations?event=plexus'], ['GALA', '/registrations?event=gala'], ['BRIDGES', '/registrations?event=bridges'], ['ALL', '/registrations']];
const GENERIC_LOCALS = ['info', 'office', 'contact', 'hello', 'admin', 'mail', 'team', 'press', 'news', 'kontakt', 'ured', 'uprava', 'tajnistvo', 'posta', 'email', 'noreply', 'no-reply'];

let D = null, st = null, unbind = null, rootEl = null;

function ensureCss() {
  if (document.querySelector('link[data-view-css="people"]')) return;
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/css/views/people.css'; l.setAttribute('data-view-css', 'people');
  document.head.appendChild(l);
}

// ---------------------------------------------------------------- data
async function load() {
  const r = await api.settle({
    dir: api.get('/api/v2/people/directory'),
    team: api.get('/api/team'),
    passes: api.get('/api/admin/guest-passes'),
    passEvents: api.get('/api/admin/guest-pass-events'),
    nag: api.get('/api/admin/nag/items'),
    reports: api.get('/api/v2/safety/reports?status=open')
  });
  const people = ((r.dir && r.dir.people) || []).map((p, i) => ({
    ...p,
    key: p.key || ((p.email || '') + '#' + i),            // backend key is stable; '#i' only if an old backend answers
    flags: p.flags || { unsubscribed: 0, unsub_source: null, unsubscribed_at: null, consent: null, consent_note: '', updated_by: null, updated_at: null }
  }));
  const teamByEmail = {};
  (Array.isArray(r.team) ? r.team : []).forEach(t => { teamByEmail[String(t.email || '').toLowerCase()] = t; });
  return {
    errors: r.$errors, people, teamByEmail,
    passes: (r.passes && Array.isArray(r.passes.passes)) ? r.passes.passes : [],
    passEvents: (r.passEvents && Array.isArray(r.passEvents.events)) ? r.passEvents.events : [],
    nag: (r.nag && Array.isArray(r.nag.items)) ? r.nag.items : [],
    // null = the queue is unavailable to this admin (section locked / older backend) — the chip hides
    reports: r.reports ? { status: 'open', list: r.reports.reports || [], counts: r.reports.counts || {} } : null,
    profiles: {}
  };
}
async function refresh() {
  const fresh = await load();
  if (!rootEl) return false;
  D = fresh;
  rootEl.innerHTML = template();
  wireInputs();
  return true;
}

// ---------------------------------------------------------------- derived
function segOn(k) { return k === 'ALL' ? !st.segs.length : st.segs.includes(k); }
function isFiltered() { return !!(st.query.trim() || st.segs.length); }
function filtered() {
  const q = st.query.trim().toLowerCase();
  // the haystack carries BOTH country forms — typing "Croatia" finds rows stored as "HR" and vice versa
  return D.people.filter(p => (!st.segs.length || p.segs.some(s => st.segs.includes(s))) &&
    (!q || (p.name + ' ' + p.email + ' ' + p.country + ' ' + countryName(p.country) + ' ' + p.tags.join(' ')).toLowerCase().includes(q)));
}
function selected() {
  const list = filtered();
  return list.find(p => p.key === st.selKey) || list[0] || D.people[0] || null;
}

// ---- duplicate detection (same normalized name, or same email local-part) ----
// normNameKey mirrors the backend's normName — Croatian diacritics folded, honorifics dropped.
function normNameKey(s) {
  return String(s || '').toLowerCase()
    .replace(/đ/g, 'd').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(dr|prof|mr|mrs|ms|md|phd)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
function localKey(email) {
  const at = String(email || '').indexOf('@');
  if (at <= 0) return '';
  const l = String(email).slice(0, at).toLowerCase().split('+')[0].replace(/\./g, '');
  return (l.length < 4 || GENERIC_LOCALS.includes(l)) ? '' : l;
}
function dupScore(p) {
  return (p.team ? 8 : 0) + (p.member ? 4 : 0) + (p.gala ? 2 : 0) + (p.plexus ? 2 : 0) +
    (p.bridges ? 1 : 0) + (p.forum ? 1 : 0) + (p.contact ? 1 : 0) + p.passes.length + (p.email ? 1 : 0);
}
function dupGroups() {
  const byKey = {}; D.people.forEach(p => { byKey[p.key] = p; });
  const buckets = {};
  D.people.forEach(p => {
    const nk = normNameKey(p.name);
    if (nk && nk.indexOf(' ') > 0 && nk.length >= 6) (buckets['n:' + nk] = buckets['n:' + nk] || []).push(p.key);
    const lk = localKey(p.email);
    if (lk) (buckets['l:' + lk] = buckets['l:' + lk] || []).push(p.key);
  });
  const groupOf = {}, groups = [];
  Object.values(buckets).forEach(keys => {
    const uniq = [...new Set(keys)];
    if (uniq.length < 2) return;
    let gi = null;
    uniq.forEach(k => { if (groupOf[k] !== undefined && gi === null) gi = groupOf[k]; });
    if (gi === null) { gi = groups.length; groups.push(new Set()); }
    uniq.forEach(k => {
      const prev = groupOf[k];
      if (prev !== undefined && prev !== gi) { groups[prev].forEach(k2 => { groups[gi].add(k2); groupOf[k2] = gi; }); groups[prev] = new Set(); }
      groups[gi].add(k); groupOf[k] = gi;
    });
  });
  return groups
    .map(set => [...set].map(k => byKey[k]).filter(Boolean))
    .filter(g => g.length >= 2)
    .map(g => {
      const people = g.slice().sort((a, b) => dupScore(b) - dupScore(a) || a.name.localeCompare(b.name));
      const names = new Set(people.map(p => normNameKey(p.name)));
      return { sig: people.map(p => p.key).sort().join('|'), reason: names.size === 1 ? COPY.dups.reasonName : COPY.dups.reasonEmail, people };
    })
    .filter(g => !st.dupDismissed.includes(g.sig))
    .sort((a, b) => a.people[0].name.localeCompare(b.people[0].name));
}

// Gala open-payment tags come from the server as 'GALA — <state>' (LINK SENT · CHECKOUT NOT
// COMPLETED · NO LINK YET · HELD FOR REVIEW — audit 2026-09-17 A); held reads calmer than the rest.
const galaOpenTag = t => /^GALA — /.test(t);
function galaOpen(p) {
  if (!p || !p.gala) return false;
  if (p.gala.bucket) return !['paid', 'paid_twins'].includes(p.gala.bucket);
  return p.tags.some(galaOpenTag);
}
function tagStyle(t) {
  return t === 'UNSUBSCRIBED' ? { bg: '#4a2023', fg: '#f2d9da' }
    : t === 'GALA — HELD FOR REVIEW' ? { bg: '#e9eef6', fg: '#28466f' }
    : galaOpenTag(t) ? { bg: '#f7e3e4', fg: '#7e151b' }
    : t.includes('PAID') || t === 'VIP' ? { bg: '#e4efe7', fg: '#22563a' }
    : t.includes('TEAM') ? { bg: '#e9e4f2', fg: '#4a3a72' }
    : t === 'GUEST PASS' ? { bg: '#f1e7d4', fg: '#7a6432' }
    : { bg: '#eee9df', fg: '#4a4239' };
}
function monthYear(v) { const d = fmt.toDate(v); return d ? ['January','February','March','April','May','June','July','August','September','October','November','December'][d.getMonth()] + ' ' + d.getFullYear() : '—'; }
function whenNice(v) { if (!v) return '—'; const w = fmt.when(v); return w ? w.charAt(0) + w.slice(1).toLowerCase() : '—'; }

function factsFor(p) {
  const F = COPY.facts, rows = [];
  const prof = p.user_id && D.profiles[p.user_id];
  if (p.member) rows.push([F.memberSince, monthYear(p.member.since)]);
  if (p.team) {
    const t = D.teamByEmail[String(p.email).toLowerCase()] || {};
    const sections = t.allowed_sections === null || t.allowed_sections === undefined ? F.fullAccess
      : Array.isArray(t.allowed_sections) ? (t.allowed_sections.length ? F.sections(t.allowed_sections.length) : F.todayOnly) : F.fullAccess;
    rows.push([F.role, (p.team.role === 'staff' ? 'Staff · scanner' : 'Admin') + ' · ' + sections]);
    rows.push([F.lastSeen, whenNice(p.team.last_login)]);
  }
  if (prof && prof.user && prof.user.title) rows.push([F.title, prof.user.title]);
  if (p.gala) {
    rows.push([F.galaSeat, p.tags.includes('GALA PAID')
      ? 'Paid' + (p.gala.amount_paid ? ' · ' + fmt.eur(p.gala.amount_paid) : '') + (p.tags.includes('VIP') ? ' · VIP' : '') + ' · ' + FACTS.gala.venue
      : (p.gala.bucket_label || F.pending)]);   // the server's state sentence ("Checkout started, not completed") when it sent one
    if (galaOpen(p) && p.gala.bucket !== 'held') rows.push([F.reminder, nagFor(p) && nagFor(p).status === 'actioned' ? F.reminderStaged : F.reminderReady]);
  }
  if (p.plexus) rows.push([F.plexus, F.free]);
  if (p.bridges) rows.push([F.bridges, [p.bridges.event_name || p.bridges.city, p.bridges.status || 'registered'].filter(Boolean).join(' · ')]);
  if (p.forum) rows.push([F.forum, 'Member · ' + (p.forum.status || 'active')]);
  p.passes.forEach(v => {
    rows.push([F.pass, (v.event_key || 'event') + ' · ' + (v.modules && v.modules.length ? v.modules.join(' + ') : 'program') + (v.revoked ? ' · revoked' : '')]);
    rows.push([F.lastOpened, v.last_viewed_at ? whenNice(v.last_viewed_at) + ' · ' + v.page_views + ' view' + (v.page_views === 1 ? '' : 's') : F.never]);
  });
  if (p.contact && !p.member && !p.team) rows.push([F.contact, 'Internal contact' + (p.contact.organization ? ' · ' + p.contact.organization : '')]);
  if (prof && prof.summary) {
    rows.push([F.events, prof.summary.totalRegistrations + ' registration' + (prof.summary.totalRegistrations === 1 ? '' : 's') + ' · ' + prof.summary.eventsAttended + ' attended']);
    if (prof.summary.totalPaid) rows.push([F.paidTotal, fmt.eur(prof.summary.totalPaid)]);
  }
  if (p.member) rows.push([F.lastActive, whenNice(p.member.last_login)]);
  return rows.slice(0, 7);
}
function nagFor(p) {
  if (!p.gala) return null;
  return D.nag.find(n => (n.kind === 'gala_unpaid' || n.action_kind === 'payment_reminder') &&
    ((n.action_payload && n.action_payload.gala_id === p.gala.id) || n.subject_id === p.gala.id)) || null;
}
function actionsFor(p) {
  const A = COPY.actions, solid = { bg: '#9b1b22', bd: '#9b1b22', fg: '#fff' }, ghost = { bg: 'transparent', bd: 'rgba(32,27,22,.2)', fg: '#201b16' };
  const out = [{ label: A.message, ...solid, act: 'goMessages' }];
  // an open seat gets the payment tools; a held row gets MARK PAID only — the review gate, not a
  // reminder, is what moves it (nothing is ever chased before the owner released it)
  if (galaOpen(p)) { out.push({ label: A.markPaid, ...ghost, act: 'markPaid' }); if (p.gala.bucket !== 'held') out.push({ label: A.chase, ...ghost, act: 'chase' }); }
  if (p.tags.includes('GALA PAID') || p.plexus) out.push({ label: A.resend, ...ghost, act: 'resend' });
  if (p.passes.length) out.push({ label: A.copyPass, ...ghost, act: 'copyPass' });
  if (p.team) out.push({ label: A.perms, ...ghost, act: 'goPerms' });
  if (p.plexus || p.gala || p.bridges) out.push({ label: A.regs, ...ghost, act: 'goRegs' });
  return out;
}

// ---------------------------------------------------------------- blocks
function blockTitle() {
  return `
  <!-- dc: Admin People.dc.html › "Title row" -->
  <div style="display:flex;align-items:baseline;gap:14px;flex-wrap:wrap">
    <span class="mx-display-30" style="font-family:Fraunces,serif;font-size:30px">${COPY.title}</span>
    <span style="font-size:12.5px;color:#6d6459">${COPY.sub}</span>
    <div style="flex:1"></div>
    ${reportsChip()}
    <span data-act="exportCsv" data-role="exportBtn" style="padding:9px 14px;border:1px solid rgba(32,27,22,.2);font:600 10px Inter,sans-serif;letter-spacing:.14em;cursor:pointer;white-space:nowrap" data-hover="border-color:#201b16">${COPY.exportBtn(filtered().length, isFiltered())}</span>
    <span data-act="addToggle" style="padding:9px 14px;background:#9b1b22;color:#fff;font:600 10px Inter,sans-serif;letter-spacing:.14em;cursor:pointer;white-space:nowrap" data-hover="background:#7e151b">${COPY.addBtn}</span>
  </div>
  <!-- /dc -->`;
}
function blockAdd() {
  if (!st.addOpen) return '<!-- dc: Admin People.dc.html › "New person panel" --><!-- closed --><!-- /dc -->';
  return `
  <!-- dc: Admin People.dc.html › "New person panel" -->
  <div data-block="add" style="border:1px solid rgba(32,27,22,.14);background:#fff;padding:14px 18px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
    <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.15em;color:#6d6459">${COPY.addLabel}</span>
    <input data-role="npName" placeholder="Full name" style="flex:1;min-width:150px;border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:9px 11px;font:400 13px Inter,sans-serif;color:#201b16">
    <input data-role="npEmail" placeholder="Email" style="flex:1;min-width:170px;border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:9px 11px;font:400 13px Inter,sans-serif;color:#201b16">
    <input data-role="npCountry" placeholder="Country" style="width:120px;border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:9px 11px;font:400 13px Inter,sans-serif;color:#201b16">
    <select data-role="npKind" style="border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:9px;font:400 12.5px Inter,sans-serif;color:#201b16">
      ${COPY.kinds.map(k => `<option>${k}</option>`).join('')}
    </select>
    <span data-act="npAdd" style="padding:9px 14px;background:#9b1b22;color:#fff;font:600 10px Inter,sans-serif;letter-spacing:.13em;cursor:pointer">${COPY.add}</span>
    <span style="font-size:11px;color:#6d6459;flex-basis:100%">${COPY.addNote}</span>
  </div>
  <!-- /dc -->`;
}
function segChip(k, counts) {
  const on = segOn(k);
  return `<span data-act="seg" data-seg="${k}" role="button" aria-pressed="${on ? 'true' : 'false'}" style="padding:9px 13px;font:600 10px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap;background:${on ? '#201b16' : '#fff'};color:${on ? '#f6f2ea' : '#6d6459'};border:1px solid ${on ? '#201b16' : 'rgba(32,27,22,.2)'}">${COPY.segs[k]} · ${counts[k]}</span>`;
}
function blockSearch() {
  const counts = {}; SEG_ORDER.forEach(k => { counts[k] = k === 'ALL' ? D.people.length : D.people.filter(p => p.segs.includes(k)).length; });
  return `
  <!-- dc: Admin People.dc.html › "Search + segments" -->
  <div data-block="segs" style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">
    <span class="mx-field" style="display:flex;align-items:center;gap:8px;border:1px solid rgba(32,27,22,.25);background:#fff;padding:10px 14px;flex:1;min-width:260px"><span style="color:#6d6459">⌕</span><input data-role="peopleQ" value="${esc(st.query)}" placeholder="${esc(COPY.searchPh)}" style="border:none;background:transparent;font:400 13.5px Inter,sans-serif;color:#201b16;flex:1;outline:none;padding:0"></span>
    ${SEG_ORDER.map(k => {
      const divider = COPY.dividers[k] ? `<span style="display:flex;align-items:center;gap:8px;white-space:nowrap"><span style="width:1px;height:20px;background:rgba(32,27,22,.2)"></span><span style="font:600 8px Inter,sans-serif;letter-spacing:.14em;color:#9a9086">${COPY.dividers[k]}</span></span>` : '';
      return divider + segChip(k, counts);
    }).join('\n    ')}
    <span style="font-size:10.5px;color:#9a9086;flex-basis:100%;margin-top:-6px">${COPY.segsNote}</span>
  </div>
  <!-- /dc -->
  <!-- v2: registrations quick-links (doors → /registrations filtered) -->
  <div data-v2="reg-quick-links" style="display:flex;gap:14px;align-items:baseline;flex-wrap:wrap;margin-top:-8px">
    <span style="font:600 8.5px Inter,sans-serif;letter-spacing:.15em;color:#9a9086">${COPY.quick}</span>
    ${QUICK_LINKS.map(([label, href]) => `<a href="${href}" style="font:600 9px Inter,sans-serif;letter-spacing:.13em;color:#9b1b22;white-space:nowrap" data-hover="color:#201b16">${label} →</a>`).join('\n    ')}
  </div>`;
}
// ---- REPORTS (App Store 1.2) ----
function openReports() { return (D.reports && Number(D.reports.counts.open)) || 0; }
function reportsChip() {
  if (!D.reports) return '';
  const n = openReports(), R = COPY.reports;
  return `<span data-act="reportsToggle" data-role="reportsChip" role="button" aria-expanded="${st.reportsOpen ? 'true' : 'false'}"${n ? ` title="${esc(R.badgeTitle(n))}"` : ''} style="padding:9px 14px;border:1px solid ${st.reportsOpen ? '#201b16' : 'rgba(32,27,22,.2)'};font:600 10px Inter,sans-serif;letter-spacing:.14em;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:7px" data-hover="border-color:#201b16">${R.chip}${n ? `<span style="min-width:16px;height:16px;padding:0 4px;background:#9b1b22;color:#fff;font:600 10px Inter,sans-serif;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box">${n}</span>` : ''}</span>`;
}
const RBTN = 'font:600 8.5px Inter,sans-serif;letter-spacing:.12em;padding:7px 10px;border:1px solid rgba(32,27,22,.25);color:#201b16;cursor:pointer;white-space:nowrap;text-align:center';
const RBTN_RED = RBTN + ';border-color:rgba(155,27,34,.55);color:#9b1b22';
const RLINK = 'font:600 8.5px Inter,sans-serif;letter-spacing:.13em;color:#9b1b22;cursor:pointer;white-space:nowrap';
// SQL timestamps are UTC 'YYYY-MM-DD HH:MM:SS' — hours since, for the 24-hour promise
function hoursSince(v) {
  const s = String(v || '').trim(); if (!s) return 0;
  const d = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s.replace(' ', 'T') : s.replace(' ', 'T') + 'Z');
  return isNaN(d) ? 0 : (Date.now() - d.getTime()) / 3600000;
}
// the reported message: the live row while it is there (with REMOVED when the team took it out), else the
// copy the member backend saved with the report; then up to ten other messages from the same sender
function reportEvidence(r) {
  const R = COPY.reports, ev = r.evidence, m = r.message;
  const box = (label, inner, tail) => `<div style="border-left:2px solid #c9a962;background:#f6f2ea;padding:8px 11px;display:flex;flex-direction:column;gap:3px"><span style="font:600 8px Inter,sans-serif;letter-spacing:.14em;color:#7a6432">${label}</span>${inner}${tail || ''}</div>`;
  const text = t => `<span style="font-size:12.5px;color:#201b16;line-height:1.5;overflow-wrap:anywhere;white-space:pre-wrap">“${esc(t)}”</span>`;
  const quiet = t => `<span style="font-size:11px;color:#6d6459;overflow-wrap:anywhere">${esc(t)}</span>`;
  let out = '';
  if (r.target_kind === 'message' && m) {
    if (m.content != null) {
      const removed = m.removed_at ? `<span style="align-self:flex-start;font:600 8px Inter,sans-serif;letter-spacing:.12em;padding:3px 7px;background:#4a2023;color:#f2d9da;margin-top:3px">${esc(R.removedTag(m.removed_by, fmt.when(m.removed_at)))}</span>` : '';
      out += box(R.messageLabel + (m.created_at ? ' · ' + esc(fmt.when(m.created_at)) : ''), text(m.content), removed);
    } else if (ev && ev.text) {
      out += box(R.savedLabel, text(ev.text), quiet(R.from(ev.sender_name, ev.sender_email, ev.created_at ? fmt.when(ev.created_at) : '')));
    } else out += box(R.messageLabel, `<i style="font-size:12.5px;color:#6d6459">${R.messageGone}</i>`);
  } else if (r.target_kind === 'member' && ev && ev.text) {
    out += box(R.bioLabel, text(ev.text));
  }
  // a profile report: what else the directory showed when it was filed (portrait, headline, tags)
  const pr = r.target_kind === 'member' && ev && ev.profile;
  if (pr && (pr.photo_url || pr.title || pr.institution || pr.city || pr.specialties)) {
    let tags = [];
    try { tags = Array.isArray(pr.specialties) ? pr.specialties : JSON.parse(pr.specialties || '[]'); } catch (e) { tags = pr.specialties ? [String(pr.specialties)] : []; }
    const photo = pr.photo_url ? (/^https:\/\//.test(pr.photo_url)
      ? `<img src="${esc(pr.photo_url)}" alt="" loading="lazy" style="width:40px;height:40px;object-fit:cover;flex:none;border:1px solid rgba(32,27,22,.14)">`
      : `<span style="font:600 8px Inter,sans-serif;letter-spacing:.12em;color:#7a6432;white-space:nowrap">${R.portraitOnFile}</span>`) : '';
    const line = [pr.title, pr.institution, pr.city].filter(Boolean).map(esc).join(' · ');
    out += box(R.profileLabel, `<div style="display:flex;gap:10px;align-items:center;min-width:0">${photo}<div style="min-width:0;display:flex;flex-direction:column;gap:3px">${line ? `<span style="font-size:12.5px;color:#201b16;line-height:1.45;overflow-wrap:anywhere">${line}</span>` : ''}${tags.length ? `<span style="display:flex;gap:4px;flex-wrap:wrap">${tags.slice(0, 12).map(t => `<span style="font:600 8px Inter,sans-serif;letter-spacing:.1em;padding:2px 6px;background:#eee9df;color:#4a4239;overflow-wrap:anywhere">${esc(String(t).toUpperCase())}</span>`).join('')}</span>` : ''}</div></div>`);
  }
  // the sender's other recent messages to the reporter, oldest first (the server keeps up to ten)
  const ctxList = ((ev && Array.isArray(ev.context)) ? ev.context.slice() : []).sort((x, y) => String(x.created_at || '').localeCompare(String(y.created_at || '')));
  if (ctxList.length) {
    // each line can be taken out on its own (REMOVE), or every message from the sender at once (REMOVE ALL)
    const open = r.status === 'open', tgt = r.target || {};
    const live = c => c.id && c.removed === false;
    const stamp = c => c.removed ? `<span style="font:600 7.5px Inter,sans-serif;letter-spacing:.12em;padding:2px 6px;background:#4a2023;color:#f2d9da;margin-left:6px;white-space:nowrap">${c.gone ? R.ctxGone : R.ctxRemoved}</span>` : '';
    const one = c => open && live(c) ? `<span data-act="reportRemoveOne" data-id="${esc(r.id)}" data-mid="${esc(c.id)}" role="button" tabindex="0" style="${RLINK};margin-left:8px" data-hover="color:#201b16">${R.act.removeOne}</span>` : '';
    const anyLive = ctxList.some(live);
    out += `<details class="mx-report-ctx" style="font-size:12px;color:#4a4239">
          <summary style="font:600 8.5px Inter,sans-serif;letter-spacing:.13em;color:#6d6459;cursor:pointer;padding:2px 0">${esc(R.earlier(ev.sender_name || tgt.name, ctxList.length))}</summary>
          <div style="display:flex;flex-direction:column;gap:6px;margin-top:6px;padding-left:11px;border-left:1px solid rgba(32,27,22,.12)">
            ${ctxList.map(c => `<div style="line-height:1.45;overflow-wrap:anywhere;white-space:pre-wrap${c.removed ? ';color:#9a9086' : ''}"><span style="font:600 8px Inter,sans-serif;letter-spacing:.12em;color:#9a9086;margin-right:6px">${esc(c.created_at ? fmt.when(c.created_at) : '')}</span>${esc(c.text)}${stamp(c)}${one(c)}</div>`).join('')}
            ${open && anyLive && tgt.id ? `<span data-act="reportRemoveAll" data-id="${esc(r.id)}" role="button" tabindex="0" style="${RLINK};align-self:flex-start;margin-top:2px" data-hover="color:#201b16">${esc(R.act.removeAll(ev.sender_name || tgt.name))} →</span>` : ''}
          </div>
        </details>`;
  }
  return out;
}
function reportRow(r) {
  const R = COPY.reports, open = r.status === 'open', tgt = r.target || {};
  const tag = (text, bg, fg) => `<span style="font:600 8.5px Inter,sans-serif;letter-spacing:.11em;padding:3px 7px;background:${bg};color:${fg};white-space:nowrap">${esc(text)}</span>`;
  const team = !!(tgt.is_team || tgt.is_admin), live = !!(tgt.id && !tgt.deleted);
  // HIDE PROFILE sticks even when the member keeps the profile private today (they cannot switch it on later)
  const canHide = open && live && !team && !tgt.moderation_hidden;
  const canClear = open && live && !team && r.target_kind === 'member';
  const canRemove = open && r.target_kind === 'message' && r.message && r.message.content != null && !r.message.removed_at;
  const canSuspend = open && live && !team && !tgt.suspended;
  const reviewer = r.reviewed_by ? r.reviewed_by.name : '';
  const late = open && hoursSince(r.created_at) >= 24;
  // undo links for what the team did to the member (any tab — the member may have been handled in another report)
  const undo = [
    live && tgt.suspended ? `<span data-act="reportUnsuspend" data-id="${esc(r.id)}" role="button" tabindex="0" style="${RLINK}" data-hover="color:#201b16">${R.act.unsuspend} →</span>` : '',
    live && tgt.moderation_hidden ? `<span data-act="reportUnhide" data-id="${esc(r.id)}" role="button" tabindex="0" style="${RLINK}" data-hover="color:#201b16">${R.act.unhide} →</span>` : ''
  ].filter(Boolean).join('');
  return `
    <div class="mx-report-row" data-report="${esc(r.id)}" style="display:flex;flex-wrap:wrap;gap:12px 20px;padding:13px 16px;border-top:1px solid rgba(32,27,22,.08);align-items:flex-start">
      <div style="flex:999 1 340px;min-width:0;display:flex;flex-direction:column;gap:6px">
        <div style="display:flex;gap:7px;align-items:center;flex-wrap:wrap">
          ${tag(String(r.reason_label || r.reason).toUpperCase(), '#f7e3e4', '#7e151b')}
          <span style="font:600 8.5px Inter,sans-serif;letter-spacing:.12em;color:#9a9086;white-space:nowrap">${R.kind[r.target_kind] || R.kind.member} · ${esc(fmt.when(r.created_at))}</span>
          ${late ? `<span style="font:600 8.5px Inter,sans-serif;letter-spacing:.12em;color:#9b1b22;white-space:nowrap">${R.late}</span>` : ''}
          ${open && r.target_open_reports > 1 ? `<span style="font:600 8.5px Inter,sans-serif;letter-spacing:.12em;color:#9b1b22;white-space:nowrap">${R.openOnTarget(r.target_open_reports)}</span>` : ''}
          ${team ? tag(R.teamTag, '#e9e4f2', '#4a3a72') : ''}
          ${tgt.deleted ? tag(R.goneTag, '#eee9df', '#4a4239') : [
            tgt.suspended ? tag(R.suspendedTag, '#9b1b22', '#fff') : '',
            tgt.moderation_hidden ? tag(R.modHiddenTag, '#4a2023', '#f2d9da') : (!tgt.is_public_profile ? tag(R.hiddenTag, '#eee9df', '#4a4239') : '')
          ].join('')}
        </div>
        <div style="font-size:13px;line-height:1.5;overflow-wrap:anywhere">
          <span style="font-weight:600">${esc(r.reporter.name)}</span> <span style="color:#6d6459">${R.reported}</span>
          <span data-act="reportTarget" data-uid="${esc(tgt.id || '')}" data-email="${esc(tgt.email || '')}" data-name="${esc(tgt.name || '')}" role="link" style="font-weight:600;color:#9b1b22;cursor:pointer" data-hover="color:#201b16">${esc(tgt.name || 'Unknown member')} →</span>
          ${tgt.email ? `<span style="font-size:11px;color:#6d6459">· ${esc(tgt.email)}</span>` : ''}
        </div>
        ${reportEvidence(r)}
        ${r.note ? `<div style="font-size:12px;color:#4a4239;line-height:1.5;overflow-wrap:anywhere"><span style="font:600 8.5px Inter,sans-serif;letter-spacing:.13em;color:#6d6459;margin-right:6px">${R.noteLabel}</span>${esc(r.note)}</div>` : ''}
        ${tgt.suspended && live ? `<div style="font-size:11px;color:#9b1b22;overflow-wrap:anywhere">${esc(R.suspendedLine(tgt.suspended_at ? fmt.dayShort(tgt.suspended_at) : '', tgt.suspended_reason))}</div>` : ''}
        ${!open ? `<div style="font-size:11px;color:#6d6459;overflow-wrap:anywhere">${esc(R.handledBy(R.status[r.status] || r.status, reviewer, r.reviewed_at ? fmt.when(r.reviewed_at) : ''))}${r.action_note ? ' — ' + esc(r.action_note) : ''}</div>` : ''}
      </div>
      <div class="mx-report-acts" style="flex:1 1 270px;min-width:0;display:flex;flex-direction:column;gap:7px">
        ${open ? `
        <input data-role="reportNote" data-id="${esc(r.id)}" maxlength="500" placeholder="${esc(R.notePh)}" aria-label="${esc(R.notePh)}" style="border:1px solid rgba(32,27,22,.2);background:#f6f2ea;padding:7px 9px;font:400 11.5px Inter,sans-serif;color:#201b16;min-width:0;width:100%;box-sizing:border-box">
        ${canClear ? `<div style="display:flex;gap:6px;flex-wrap:wrap">
          <span data-act="reportClear" data-id="${esc(r.id)}" data-fields="photo" role="button" tabindex="0" style="${RBTN_RED};flex:1" data-hover="border-color:#9b1b22;background:#9b1b22;color:#fff">${R.act.clearPhoto}</span>
          <span data-act="reportClear" data-id="${esc(r.id)}" data-fields="bio,title,specialties" role="button" tabindex="0" style="${RBTN_RED};flex:1" data-hover="border-color:#9b1b22;background:#9b1b22;color:#fff">${R.act.clearText}</span>
        </div>` : ''}
        ${canRemove || canHide || canSuspend ? `<div style="display:flex;gap:6px;flex-wrap:wrap">
          ${canRemove ? `<span data-act="reportRemove" data-id="${esc(r.id)}" role="button" tabindex="0" style="${RBTN_RED};flex:1" data-hover="border-color:#9b1b22;background:#9b1b22;color:#fff">${R.act.remove}</span>` : ''}
          ${canHide ? `<span data-act="reportHide" data-id="${esc(r.id)}" role="button" tabindex="0" style="${RBTN_RED};flex:1" data-hover="border-color:#9b1b22;background:#9b1b22;color:#fff">${R.act.hide}</span>` : ''}
          ${canSuspend ? `<span data-act="reportSuspend" data-id="${esc(r.id)}" role="button" tabindex="0" style="${RBTN_RED};flex:1" data-hover="border-color:#9b1b22;background:#9b1b22;color:#fff">${R.act.suspend}</span>` : ''}
        </div>` : ''}
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <span data-act="reportSet" data-id="${esc(r.id)}" data-status="reviewed" role="button" tabindex="0" style="${RBTN};flex:1" data-hover="border-color:#201b16;background:#201b16;color:#f6f2ea">${R.act.reviewed}</span>
          <span data-act="reportSet" data-id="${esc(r.id)}" data-status="dismissed" role="button" tabindex="0" style="${RBTN};flex:1;color:#6d6459" data-hover="border-color:#201b16;color:#201b16">${R.act.dismiss}</span>
        </div>` : `
        <div style="display:flex;justify-content:flex-end"><span data-act="reportSet" data-id="${esc(r.id)}" data-status="open" role="button" tabindex="0" style="${RBTN}" data-hover="border-color:#201b16">${R.act.reopen}</span></div>`}
        ${undo ? `<div style="display:flex;gap:16px;justify-content:flex-end;flex-wrap:wrap">${undo}</div>` : ''}
      </div>
    </div>`;
}
function blockReports() {
  if (!D.reports || !st.reportsOpen) return '<div data-block="reports" style="display:none"></div>';
  const R = COPY.reports, rp = D.reports, c = rp.counts || {};
  const tab = (key, label) => `<span data-act="reportsTab" data-status="${key}" role="tab" aria-selected="${rp.status === key}" style="font:600 9px Inter,sans-serif;letter-spacing:.14em;cursor:pointer;white-space:nowrap;padding-bottom:3px;color:${rp.status === key ? '#201b16' : '#6d6459'};border-bottom:2px solid ${rp.status === key ? '#9b1b22' : 'transparent'}" data-hover="color:#201b16">${label}</span>`;
  return `
  <!-- v2: member REPORTS queue (App Store 1.2 — /api/v2/safety/reports, admin-portal/backend/v2/safety-ops.js) -->
  <div data-block="reports" style="border:1px solid rgba(155,27,34,.3);background:#fff">
    <div style="display:flex;gap:10px 16px;align-items:baseline;flex-wrap:wrap;padding:14px 16px 12px">
      <span style="font:600 10px Inter,sans-serif;letter-spacing:.15em;color:#9b1b22">${R.title}</span>
      <span style="font-size:11.5px;color:#6d6459;flex:1 1 320px">${R.sub}</span>
      <span role="tablist" style="display:flex;gap:16px">${tab('open', R.tabOpen(c.open || 0))}${tab('handled', R.tabHandled(c.handled || 0))}</span>
    </div>
    ${rp.loading ? `<div style="padding:16px;border-top:1px solid rgba(32,27,22,.08);font-size:12px;color:#6d6459">Loading…</div>`
      : rp.list.length ? rp.list.map(reportRow).join('')
      : `<div style="padding:18px 16px;border-top:1px solid rgba(32,27,22,.08);display:flex;flex-direction:column;gap:4px"><span style="font-family:Fraunces,serif;font-style:italic;font-size:15px;color:#4a4239">${rp.status === 'open' ? R.empty : R.emptyHandled}</span>${rp.status === 'open' ? `<span style="font-size:11.5px;color:#6d6459">${R.emptyWhy}</span>` : ''}</div>`}
  </div>`;
}
async function loadReports(status) {
  if (!D || !D.reports) return;
  D.reports.status = status; D.reports.loading = true; redraw('reports');
  try {
    const r = await api.get('/api/v2/safety/reports?status=' + encodeURIComponent(status));
    if (!D || !D.reports) return;
    D.reports = { status, list: r.reports || [], counts: r.counts || D.reports.counts, loading: false };
  } catch (e) { if (D && D.reports) D.reports.loading = false; ui.toast(e.message, { kind: 'error' }); }
  redraw('reports');
}
// after any action: the list re-reads (the row may leave OPEN) and the PEOPLE nav badge follows
async function reportsChanged() {
  await loadReports(D.reports.status);
  chrome.refresh().catch(() => {});
}
// SUSPEND ACCOUNT asks for a short reason in the house modal; resolves the reason, or null when cancelled
function askSuspendReason(name) {
  const S = COPY.reports.suspendAsk;
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    const m = ui.modal({
      eyebrow: S.eyebrow, title: esc(S.title(name || 'this member')),
      body: `<div style="font-size:13px;line-height:1.6">${esc(S.body)}</div>
        <label style="display:block;margin-top:16px"><span style="display:block;font:600 9.5px Inter,sans-serif;letter-spacing:.14em;color:#6d6459;margin-bottom:6px">${S.reasonLabel}</span>
          <input data-role="suspendReason" maxlength="200" autocomplete="off" placeholder="${esc(S.reasonPh)}" aria-describedby="mx-suspend-err" style="width:100%;box-sizing:border-box;border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:9px 11px;font:400 13px Inter,sans-serif;color:#201b16"></label>
        <p id="mx-suspend-err" data-role="suspendErr" role="alert" style="margin:7px 0 0;min-height:14px;font-size:12px;color:#9b1b22"></p>`,
      actions: [
        { label: S.cancel, onClick: () => finish(null) },
        { label: S.ok, kind: 'primary', onClick: () => {
          const input = m.el.querySelector('[data-role="suspendReason"]');
          const v = input ? input.value.replace(/\s+/g, ' ').trim() : '';
          if (!v) { const err = m.el.querySelector('[data-role="suspendErr"]'); if (err) err.textContent = S.reasonMissing; if (input) input.focus(); return false; }
          finish(v);
        } }
      ]
    });
    m.onClose(() => finish(null));
    const input = m.el.querySelector('[data-role="suspendReason"]');
    if (input) {
      input.addEventListener('input', () => { const err = m.el.querySelector('[data-role="suspendErr"]'); if (err) err.textContent = ''; });
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); const go = m.el.querySelector('.mx-modal-foot [data-act="a1"]'); if (go) go.click(); } });
      input.focus();
    }
  });
}
// UNSUSPEND / UNHIDE PROFILE — a confirm, then the user route (tied to this report for the audit line)
async function undoOnMember(el, pathFor, ask, toast) {
  const r = reportById(el.dataset.id); if (!r || !r.target || !r.target.id) return;
  const ok = await ui.confirm({ eyebrow: ask.eyebrow, title: esc(ask.title(r.target.name)), body: `<div style="font-size:13px;line-height:1.6">${esc(ask.body)}</div>`, ok: ask.ok, cancel: ask.cancel });
  if (!ok) return;
  el.setAttribute('aria-disabled', 'true');
  try {
    await api.post(pathFor(r.target.id), { report_id: r.id });
    ui.toast(toast(r.target.name));
    await reportsChanged();
  } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
}
function reportById(id) { return (D.reports && D.reports.list.find(x => x.id === id)) || null; }
function reportNote(id) { const i = rootEl && rootEl.querySelector(`[data-role="reportNote"][data-id="${CSS.escape(id)}"]`); return i ? i.value.trim() : ''; }

function dupMemberRow(p, sig) {
  const chips = p.tags.slice(0, 3).map(t => { const s = tagStyle(t); return `<span style="font:600 8px Inter,sans-serif;letter-spacing:.1em;padding:2px 6px;background:${s.bg};color:${s.fg};white-space:nowrap">${esc(t)}</span>`; }).join('');
  return `
      <div class="mx-dup-row" style="display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1.5fr) auto;gap:10px;padding:9px 12px;border-top:1px solid rgba(32,27,22,.08);align-items:center">
        <span style="min-width:0"><span style="display:block;font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.name)}</span><span style="display:block;font-size:10.5px;color:#6d6459;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.email || 'no email')}</span></span>
        <span style="display:flex;gap:5px;flex-wrap:wrap;min-width:0">${chips}</span>
        <span data-act="mergeKeep" data-key="${esc(p.key)}" data-sig="${esc(sig)}" style="font:600 8.5px Inter,sans-serif;letter-spacing:.12em;padding:6px 10px;border:1px solid rgba(32,27,22,.25);color:#201b16;cursor:pointer;white-space:nowrap;justify-self:end" data-hover="border-color:#201b16;background:#201b16;color:#f6f2ea">${COPY.dups.keep}</span>
      </div>`;
}
function blockDups() {
  const groups = dupGroups();
  if (!groups.length && !st.sessionMerges.length) return '<div data-block="dups" style="display:none"></div>';
  const shown = groups.slice(0, 4);
  return `
  <!-- v2: possible-duplicates strip (team review Aug 2026 — Laura + Miro; merges → /api/v2/people/merge) -->
  <div data-block="dups" style="border:1px solid rgba(154,74,32,.35);background:#fbf6ec;padding:14px 18px;display:flex;flex-direction:column;gap:10px">
    <div style="display:flex;gap:12px;align-items:baseline;flex-wrap:wrap">
      <span style="font:600 10px Inter,sans-serif;letter-spacing:.15em;color:#7a4a20">${COPY.dups.title}</span>
      ${groups.length ? `<span style="font-size:11.5px;color:#6d6459">${COPY.dups.sub(groups.length)}</span>` : ''}
    </div>
    ${shown.map(g => `
    <div class="mx-dup-group" data-sig="${esc(g.sig)}" style="border:1px solid rgba(32,27,22,.12);background:#fff">
      <div style="display:flex;gap:10px;align-items:center;padding:7px 12px;flex-wrap:wrap">
        <span style="font:600 8px Inter,sans-serif;letter-spacing:.14em;color:#9a9086">${g.reason}</span>
        <div style="flex:1"></div>
        <span data-act="dupDismiss" data-sig="${esc(g.sig)}" style="font:600 8.5px Inter,sans-serif;letter-spacing:.1em;color:#6d6459;cursor:pointer;white-space:nowrap" data-hover="color:#201b16">${COPY.dups.dismiss}</span>
      </div>
      ${g.people.map(p => dupMemberRow(p, g.sig)).join('')}
    </div>`).join('')}
    ${groups.length > shown.length ? `<span style="font-size:11px;color:#9a9086">${COPY.dups.more(groups.length - shown.length)}</span>` : ''}
    ${st.sessionMerges.length ? `
    <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;border-top:1px solid rgba(32,27,22,.1);padding-top:9px">
      <span style="font:600 8.5px Inter,sans-serif;letter-spacing:.14em;color:#9a9086">${COPY.dups.sessionTitle}</span>
      ${st.sessionMerges.map(m => `<span style="display:inline-flex;gap:8px;align-items:center;font-size:11.5px;color:#4a4239">${esc(m.merged_name)} → ${esc(m.kept_name)}<span data-act="undoMerge" data-id="${esc(m.id)}" style="font:600 8.5px Inter,sans-serif;letter-spacing:.12em;color:#9b1b22;cursor:pointer" data-hover="color:#201b16">${COPY.dups.undo}</span></span>`).join('')}
    </div>` : ''}
  </div>`;
}
function hygieneRows(p) {
  const H = COPY.hyg, f = p.flags || {};
  const label = (t) => `<span style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:#6d6459;width:86px;flex:none">${t}</span>`;
  const merged = p.absorbed && p.absorbed.length
    ? `<div style="display:flex;gap:10px;align-items:baseline">${label(H.mergedIn)}<span style="font-size:11.5px;color:#4a4239;flex:1;min-width:0;overflow-wrap:anywhere">${esc(p.absorbed.map(a => a.name || a.email).join(' · '))}</span></div>` : '';
  if (!p.email) return `
      <div data-v2="hygiene" style="padding:12px 18px;border-top:1px solid rgba(32,27,22,.12);display:flex;flex-direction:column;gap:9px">
        <span style="font:600 9px Inter,sans-serif;letter-spacing:.15em;color:#6d6459">${H.title}</span>
        <span style="font-size:11px;color:#9a9086">${H.needEmail}</span>${merged}
      </div>`;
  const un = !!f.unsubscribed;
  const srcNote = f.unsub_source === 'newsletter' ? H.src.newsletter : f.unsub_source === 'pr' ? H.src.pr : f.unsub_source === 'admin' ? H.src.admin(f.updated_by) : '';
  const chip = (act, on, textOn, textOff, colors) => `<span data-act="${act}" role="switch" aria-checked="${on ? 'true' : 'false'}" class="mx-hyg-chip" style="font:600 8.5px Inter,sans-serif;letter-spacing:.11em;padding:5px 9px;background:${on ? colors.onBg : colors.offBg};color:${on ? colors.onFg : colors.offFg};cursor:pointer;white-space:nowrap">${on ? textOn : textOff}</span>`;
  return `
      <div data-v2="hygiene" style="padding:12px 18px;border-top:1px solid rgba(32,27,22,.12);display:flex;flex-direction:column;gap:9px">
        <span style="font:600 9px Inter,sans-serif;letter-spacing:.15em;color:#6d6459">${H.title}</span>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          ${label(H.mailing)}${chip('flagUnsub', un, H.unsub, H.mailOk, { onBg: '#4a2023', onFg: '#f2d9da', offBg: '#e4efe7', offFg: '#22563a' })}
        </div>
        ${srcNote ? `<div style="display:flex;gap:8px"><span style="width:86px;flex:none"></span><span style="font-size:10.5px;color:#9a9086">${esc(srcNote)}</span></div>` : ''}
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          ${label(H.consent)}${chip('flagConsent', f.consent === 1, H.consentYes, H.consentNo, { onBg: '#e4efe7', onFg: '#22563a', offBg: '#eee9df', offFg: '#4a4239' })}
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <input data-role="consentNote" value="${esc(st.noteDraft != null ? st.noteDraft : (f.consent_note || ''))}" placeholder="${esc(H.notePh)}" maxlength="300" style="flex:1;min-width:0;border:1px solid rgba(32,27,22,.2);background:#f6f2ea;padding:7px 9px;font:400 11.5px Inter,sans-serif;color:#201b16">
          <span data-act="saveConsentNote" style="font:600 8.5px Inter,sans-serif;letter-spacing:.12em;padding:7px 10px;border:1px solid rgba(32,27,22,.25);color:#201b16;cursor:pointer;white-space:nowrap" data-hover="border-color:#201b16">${H.saveNote}</span>
        </div>${merged}
      </div>`;
}
const PEOPLE_WINDOW = 60;                                  // audit #11: window the render, don't dump the database
function listCard() {
  const list = filtered(); const sel = selected();
  const shown = st.showAll ? list : list.slice(0, PEOPLE_WINDOW);
  // audit #11: single-line rows — name with the email inline and dimmed, ~40px tall
  return `
    <div data-block="list" style="border:1px solid rgba(32,27,22,.14);background:#fff">
      <div class="mx-people-row" style="display:grid;grid-template-columns:2fr 1.1fr 1.6fr auto;gap:12px;padding:10px 18px;border-bottom:1px solid rgba(32,27,22,.14);font:600 9px Inter,sans-serif;letter-spacing:.15em;color:#6d6459"><span>${COPY.cols.name}</span><span>${COPY.cols.country}</span><span>${COPY.cols.status}</span><span></span></div>
      ${shown.map(p => `
      <div data-act="openRow" data-key="${esc(p.key)}" class="mx-people-row${sel && p.key === sel.key ? ' on' : ''}" style="display:grid;grid-template-columns:2fr 1.1fr 1.6fr auto;gap:12px;padding:9px 18px;border-bottom:1px solid rgba(32,27,22,.07);cursor:pointer;align-items:center;background:${sel && p.key === sel.key ? '#f6f2ea' : '#fff'}">
        <span style="min-width:0;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><span style="font-weight:600">${esc(p.name)}</span>${p.email ? ` <span style="font-size:11px;color:#6d6459">· ${esc(p.email)}</span>` : ''}</span>
        <span style="font-size:12.5px;color:#4a4239;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(countryName(p.country) || '—')}</span>
        <span style="display:flex;gap:6px;flex-wrap:wrap;min-width:0">${p.tags.map(t => { const s = tagStyle(t); return `<span style="font:600 8.5px Inter,sans-serif;letter-spacing:.1em;padding:3px 7px;background:${s.bg};color:${s.fg};white-space:nowrap">${esc(t)}</span>`; }).join('')}</span>
        <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.12em;color:#9b1b22;white-space:nowrap">${COPY.open}</span>
      </div>`).join('')}
      ${!list.length ? `<div style="padding:26px 18px;text-align:center;font-size:13px;color:#6d6459">${COPY.emptyList}</div>` : ''}
      <div style="padding:11px 18px;font-size:11.5px;color:#6d6459;display:flex;gap:14px;align-items:baseline;flex-wrap:wrap">${COPY.rowsNote(shown.length, D.people.length)}<div style="flex:1"></div>${list.length > shown.length ? `<span data-act="showAllRows" style="font:600 9.5px Inter,sans-serif;letter-spacing:.13em;color:#9b1b22;cursor:pointer;white-space:nowrap" data-hover="color:#201b16">${COPY.showAll(list.length)}</span>` : ''}</div>
    </div>`;
}
function panelCard() {
  const p = selected();
  if (!p) return `<div data-block="panel" class="card"><div class="empty" style="padding:30px 20px"><span style="width:28px;height:1px;background:#c9a962"></span><span class="empty-line">No one here yet.</span><span class="empty-why">Add the first person with + ADD A PERSON.</span></div></div>`;
  const ini = p.name.replace(/^Dr\.?\s+/i, '').split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  const rows = factsFor(p);
  const loading = p.user_id && !D.profiles[p.user_id] && st.profileLoading === p.user_id;
  return `
    <div data-block="panel" style="border:1px solid rgba(32,27,22,.14);background:#fff">
      <div style="padding:16px 18px;border-bottom:1px solid rgba(32,27,22,.12);display:flex;gap:12px;align-items:center">
        <span style="width:40px;height:40px;background:#191512;color:#c9a962;display:inline-flex;align-items:center;justify-content:center;font:600 14px Fraunces,serif;flex:none">${esc(ini)}</span>
        <span style="min-width:0"><span style="display:block;font-size:15px;font-weight:600">${esc(p.name)}</span><span style="display:block;font-size:11.5px;color:#6d6459">${esc([countryName(p.country), p.email].filter(Boolean).join(' · ') || '—')}</span></span>
      </div>
      <div style="padding:14px 18px;display:flex;flex-direction:column;gap:10px">
        ${rows.map(([k, v]) => `
        <div style="display:flex;gap:10px;align-items:baseline"><span style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:#6d6459;width:86px;flex:none">${esc(k)}</span><span style="font-size:12.5px;flex:1">${esc(v)}</span></div>`).join('')}
        ${loading ? `<div style="font-size:11px;color:#6d6459;font-style:italic">Pulling the full file…</div>` : ''}
      </div>
      ${hygieneRows(p)}
      <div style="padding:14px 18px 16px;display:flex;gap:8px;flex-wrap:wrap;border-top:1px solid rgba(32,27,22,.12)">
        ${actionsFor(p).map(a => `<span data-act="${a.act}" style="padding:8px 12px;background:${a.bg};border:1px solid ${a.bd};color:${a.fg};font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap" data-hover="border-color:#201b16">${a.label}</span>`).join('\n        ')}
      </div>
      <div style="padding:0 18px 14px;font-size:11px;color:#6d6459">${COPY.panelNote}</div>
    </div>`;
}
function passesCard() {
  const P = COPY.passes;
  const passes = D.passes.filter(v => !v.revoked).slice(0, 4);
  return `
    <div data-block="passes" style="border:1px solid rgba(32,27,22,.14);background:#fff;padding:16px 18px;display:flex;flex-direction:column;gap:10px">
      <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${P.title}</span>
      <span style="font-size:12px;color:#6d6459;line-height:1.55">${P.sub}</span>
      ${passes.map(gp => `
      <div style="border:1px solid rgba(32,27,22,.1);background:#f6f2ea;padding:10px 12px;display:flex;align-items:center;gap:10px">
        <span style="flex:1;min-width:0"><span style="display:block;font-size:12.5px;font-weight:600">${esc(gp.guest_name)}</span><span style="display:block;font-size:10.5px;color:#6d6459">${esc(gp.event_name || gp.event_key)} · ${esc((gp.modules || []).join(' + ') || 'program')}</span></span>
        <span data-act="copyPassRow" data-id="${esc(gp.id)}" style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#9b1b22;cursor:pointer;white-space:nowrap">${st.copiedPass === gp.id ? P.copied : P.copy}</span>
      </div>`).join('')}
      <input data-role="passDraft" value="${esc(st.passDraft)}" placeholder="${esc(P.ph)}" style="border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:8px 10px;font:400 12.5px Inter,sans-serif;color:#201b16;width:100%;box-sizing:border-box">
      <div style="display:flex;gap:8px">
        <select data-role="passEvent" style="flex:1;min-width:0;border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:8px 10px;font:400 12.5px Inter,sans-serif;color:#201b16">${D.passEvents.map(e => `<option value="${esc(e.key)}"${st.passEvent === e.key ? ' selected' : ''}>${esc(e.name)}</option>`).join('')}</select>
        <span data-act="mintPass" style="padding:9px 12px;background:#201b16;color:#f6f2ea;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap" data-hover="background:#000">${P.mint}</span>
      </div>
      <span style="font-size:11px;color:#6d6459">${P.note}</span>
    </div>`;
}
function blockDirectory() {
  return `
  <!-- dc: Admin People.dc.html › "Directory + member file" -->
  <div class="mx-side" data-block="directory" style="display:grid;grid-template-columns:1fr 330px;gap:22px;align-items:start">
    ${listCard()}
    <div class="mx-people-side" style="display:flex;flex-direction:column;gap:18px">
      ${panelCard()}
      ${passesCard()}
    </div>
  </div>
  <!-- /dc -->`;
}
function template() {
  return `
<div data-screen-label="Admin People" style="min-height:100vh;background:#f6f2ea;color:#201b16;font-family:Inter,sans-serif">
  <div class="mx-gutter" style="max-width:1180px;margin:0 auto;padding:30px 28px 48px;display:flex;flex-direction:column;gap:20px">
    ${blockTitle()}
    ${blockAdd()}
    ${blockReports()}
    ${blockSearch()}
    ${blockDups()}
    ${blockDirectory()}
  </div>
</div>`;
}

// ---------------------------------------------------------------- behaviour
function redraw(part) {
  if (!rootEl) return;
  const swap = (sel, html) => { const el = rootEl.querySelector(sel); if (el) el.outerHTML = html; };
  if (!part || part === 'list') swap('[data-block="list"]', listCard());
  // a file still settling in (ui.settle) carries its entrance on when enrich() redraws it ~240 ms later
  if (!part || part === 'panel') { swap('[data-block="panel"]', panelCard()); ui.settle.carry(rootEl.querySelector('[data-block="panel"]')); }
  if (!part || part === 'passes') swap('[data-block="passes"]', passesCard());
  if (!part || part === 'dups') swap('[data-block="dups"]', blockDups());
  if (!part || part === 'reports') { swap('[data-block="reports"]', blockReports()); swap('[data-role="reportsChip"]', reportsChip()); }
  const ex = rootEl.querySelector('[data-role="exportBtn"]'); if (ex) ex.textContent = COPY.exportBtn(filtered().length, isFiltered());
}
function wireInputs() {
  const q = rootEl.querySelector('[data-role="peopleQ"]');
  if (q) q.addEventListener('input', () => { st.query = q.value; st.selKey = null; st.noteDraft = null; redraw('list'); redraw('panel'); const ex = rootEl.querySelector('[data-role="exportBtn"]'); if (ex) ex.textContent = COPY.exportBtn(filtered().length, isFiltered()); });
}
async function enrich(p) {
  if (!p || !p.user_id || D.profiles[p.user_id] || st.profileLoading === p.user_id) return;
  st.profileLoading = p.user_id;
  try {
    const prof = await api.get('/api/admin/users/' + encodeURIComponent(p.user_id) + '/profile');
    if (D) D.profiles[p.user_id] = prof;
  } catch (e) { if (D) D.profiles[p.user_id] = { user: null }; }
  st.profileLoading = null;
  const sel = selected();
  if (sel && sel.user_id === p.user_id) redraw('panel');
}
function noteDraftValue() {
  const i = rootEl && rootEl.querySelector('[data-role="consentNote"]');
  return i ? i.value : null;
}
async function undoMerges(ids) {
  for (const id of ids) {
    try { await api.del('/api/v2/people/merges/' + encodeURIComponent(id)); }
    catch (e) { /* already undone elsewhere — the refresh below shows the truth */ }
  }
  st.sessionMerges = st.sessionMerges.filter(m => !ids.includes(m.id));
  if (await refresh()) ui.toast(COPY.dups.undone);
}

const handlers = {
  showAllRows: () => { st.showAll = true; redraw('list'); },
  seg: (el) => {
    const k = el.dataset.seg;
    if (k === 'ALL') st.segs = [];
    else { const i = st.segs.indexOf(k); if (i >= 0) st.segs.splice(i, 1); else st.segs.push(k); }
    st.selKey = null; st.noteDraft = null;
    rootEl.querySelectorAll('[data-act="seg"]').forEach(c => {
      const on = segOn(c.dataset.seg);
      c.style.background = on ? '#201b16' : '#fff'; c.style.color = on ? '#f6f2ea' : '#6d6459'; c.style.borderColor = on ? '#201b16' : 'rgba(32,27,22,.2)';
      c.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    redraw('list'); redraw('panel'); enrich(selected());
  },
  openRow: (el) => { const was = st.selKey; st.selKey = el.dataset.key; st.noteDraft = null; redraw('list'); redraw('panel'); if (was !== st.selKey) ui.settle(rootEl.querySelector('[data-block="panel"]')); enrich(selected()); },
  addToggle: () => { st.addOpen = !st.addOpen; const el = rootEl.querySelector('[data-block="add"]'); if (el) el.outerHTML = blockAdd(); else { const t = rootEl.querySelector('[data-block="segs"]'); if (t) t.insertAdjacentHTML('beforebegin', blockAdd()); } const n = rootEl.querySelector('[data-role="npName"]'); if (n) n.focus(); },
  npAdd: async (el) => {
    const v = r => { const i = rootEl.querySelector(`[data-role="${r}"]`); return i ? i.value.trim() : ''; };
    const name = v('npName');
    if (!name) { ui.toast(COPY.nameFirst); return; }
    const kindMap = { 'Member': 'member', 'Gala guest': 'gala', 'Plexus registrant': 'plexus', 'Contact only': 'contact' };
    const kindLabel = (rootEl.querySelector('[data-role="npKind"]') || {}).value || 'Contact only';
    el.setAttribute('aria-disabled', 'true');
    try {
      const r = await api.post('/api/v2/people', { name, email: v('npEmail'), country: v('npCountry'), kind: kindMap[kindLabel] || 'contact' });
      st.addOpen = false; st.segs = []; st.query = ''; st.selKey = null; st.noteDraft = null;
      if (!await refresh()) return;
      ui.toast(r.invite_staged ? COPY.addedMember : COPY.added);
      chrome.refresh();          // a staged invitation bumps the INBOX badge
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  // Exports EXACTLY the visible list — the same filtered()+search the rows come from.
  // UTF-8 BOM so Excel opens Croatian names (č ć đ š ž) correctly; every field quoted.
  exportCsv: () => {
    const list = filtered();
    const cell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const head = ['Name', 'Email', 'Country', 'Tags', 'Unsubscribed', 'GDPR consent', 'Consent note'];
    const rows = list.map(p => [
      p.name, p.email, p.country, p.tags.join(' · '),
      p.flags && p.flags.unsubscribed ? 'yes' : 'no',
      p.flags && p.flags.consent === 1 ? 'yes' : p.flags && p.flags.consent === 0 ? 'no' : '',
      (p.flags && p.flags.consent_note) || ''
    ].map(cell).join(','));
    const csv = '\uFEFF' + [head.map(cell).join(',')].concat(rows).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'medx-people.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    ui.toast(COPY.exported(list.length));
  },
  flagUnsub: async (el) => {
    const p = selected(); if (!p || !p.email) return;
    const f = p.flags || {};
    const next = f.unsubscribed ? 0 : 1;
    if (next === 0 && (f.unsub_source === 'newsletter' || f.unsub_source === 'pr')) {
      const ok = await ui.confirm({ eyebrow: 'MAILING FLAG', title: COPY.hyg.resubAsk.title, body: `<div style="font-size:13px;line-height:1.6">${COPY.hyg.resubAsk.body}</div>`, ok: COPY.hyg.resubAsk.ok, cancel: 'CANCEL' });
      if (!ok) return;
    }
    el.setAttribute('aria-disabled', 'true');
    try {
      const r = await api.post('/api/v2/people/flags', { email: p.email, unsubscribed: next });
      p.flags = r.flags;
      p.tags = p.tags.filter(t => t !== 'UNSUBSCRIBED');
      if (p.flags.unsubscribed) p.tags.unshift('UNSUBSCRIBED');
      st.noteDraft = noteDraftValue();
      redraw('list'); redraw('panel');
      ui.toast(next ? COPY.hyg.unsubbed : COPY.hyg.resubbed);
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  flagConsent: async (el) => {
    const p = selected(); if (!p || !p.email) return;
    el.setAttribute('aria-disabled', 'true');
    try {
      const r = await api.post('/api/v2/people/flags', { email: p.email, consent: p.flags && p.flags.consent === 1 ? 0 : 1 });
      p.flags = r.flags;
      st.noteDraft = noteDraftValue();
      redraw('panel');
      ui.toast(COPY.hyg.consentSaved);
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  saveConsentNote: async (el) => {
    const p = selected(); if (!p || !p.email) return;
    const note = noteDraftValue();
    if (note == null) return;
    el.setAttribute('aria-disabled', 'true');
    try {
      const r = await api.post('/api/v2/people/flags', { email: p.email, consent_note: note.trim() });
      p.flags = r.flags;
      st.noteDraft = null;
      redraw('panel');
      ui.toast(COPY.hyg.noteSaved);
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  mergeKeep: async (el) => {
    const g = dupGroups().find(x => x.sig === el.dataset.sig); if (!g) return;
    const kept = g.people.find(p => p.key === el.dataset.key); if (!kept) return;
    const others = g.people.filter(p => p.key !== kept.key);
    if (!others.length) return;
    if (others.some(o => o.team)) { ui.toast(COPY.dups.teamKeep, { kind: 'error' }); return; }
    const ok = await ui.confirm({
      eyebrow: 'MERGE PEOPLE',
      title: COPY.dups.confirmTitle(others.length, kept.name),
      body: `<div style="font-size:13px;line-height:1.7">${others.map(o => esc(o.name + (o.email ? ' · ' + o.email : ''))).join('<br>')}<br><br><span style="color:#6d6459">${COPY.dups.confirmFoot}</span></div>`,
      ok: COPY.dups.confirmOk, cancel: COPY.dups.confirmCancel
    });
    if (!ok) return;
    el.setAttribute('aria-disabled', 'true');
    try {
      const ids = [];
      for (const o of others) {
        const r = await api.post('/api/v2/people/merge', { kept_key: kept.key, merged_key: o.key });
        if (r && r.merge) { ids.push(r.merge.id); st.sessionMerges.unshift(r.merge); }
      }
      st.selKey = kept.key; st.noteDraft = null;
      if (!await refresh()) return;
      ui.toast(COPY.dups.merged(kept.name, ids.length), ids.length ? { undo: () => undoMerges(ids) } : undefined);
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  undoMerge: (el) => undoMerges([el.dataset.id]),
  reportsToggle: () => { st.reportsOpen = !st.reportsOpen; redraw('reports'); },
  reportsTab: (el) => { if (D.reports && el.dataset.status !== D.reports.status) loadReports(el.dataset.status); },
  reportSet: async (el) => {
    const id = el.dataset.id, status = el.dataset.status;
    const body = { status };
    const note = reportNote(id); if (note) body.note = note;
    el.setAttribute('aria-disabled', 'true');
    try {
      await api.put('/api/v2/safety/reports/' + encodeURIComponent(id), body);
      ui.toast(COPY.reports.toast[status] || 'UPDATED');
      await reportsChanged();
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  reportHide: async (el) => {
    const r = reportById(el.dataset.id); if (!r || !r.target || !r.target.id) return;
    const H = COPY.reports.hideAsk;
    const note = reportNote(r.id);
    const ok = await ui.confirm({ eyebrow: H.eyebrow, title: esc(H.title(r.target.name)), body: `<div style="font-size:13px;line-height:1.6">${esc(H.body)}</div>`, ok: H.ok, cancel: H.cancel });
    if (!ok) return;
    el.setAttribute('aria-disabled', 'true');
    try {
      await api.post('/api/v2/safety/members/' + encodeURIComponent(r.target.id) + '/hide-profile', note ? { report_id: r.id, note } : { report_id: r.id });
      ui.toast(COPY.reports.toast.hidden(r.target.name));
      await reportsChanged();
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  reportRemove: async (el) => {
    const r = reportById(el.dataset.id); if (!r || !r.message) return;
    const X = COPY.reports.removeAsk;
    const note = reportNote(r.id);
    const quote = r.message.content ? `<div style="margin-top:12px;border-left:2px solid #c9a962;background:#f6f2ea;padding:8px 11px;font-size:12.5px;line-height:1.5;overflow-wrap:anywhere;white-space:pre-wrap">“${esc(String(r.message.content).slice(0, 300))}${String(r.message.content).length > 300 ? '…' : ''}”</div>` : '';
    const ok = await ui.confirm({ eyebrow: X.eyebrow, title: X.title, body: `<div style="font-size:13px;line-height:1.6">${esc(X.body((r.target && r.target.name) || 'the member', (r.reporter && r.reporter.name) || 'the reporter'))}</div>${quote}`, ok: X.ok, cancel: X.cancel });
    if (!ok) return;
    el.setAttribute('aria-disabled', 'true');
    try {
      const res = await api.post('/api/v2/safety/reports/' + encodeURIComponent(r.id) + '/remove-message', note ? { note } : {});
      ui.toast(res && res.already ? COPY.reports.toast.removedAlready : COPY.reports.toast.removed);
      await reportsChanged();
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  // one of the other messages the report lists (from the reported member to the reporter)
  reportRemoveOne: async (el) => {
    const r = reportById(el.dataset.id); if (!r) return;
    const c = ((r.evidence && r.evidence.context) || []).find(x => x.id === el.dataset.mid); if (!c) return;
    const X = COPY.reports.removeAsk;
    const quote = `<div style="margin-top:12px;border-left:2px solid #c9a962;background:#f6f2ea;padding:8px 11px;font-size:12.5px;line-height:1.5;overflow-wrap:anywhere;white-space:pre-wrap">“${esc(String(c.text).slice(0, 300))}${String(c.text).length > 300 ? '…' : ''}”</div>`;
    const ok = await ui.confirm({ eyebrow: X.eyebrow, title: X.title, body: `<div style="font-size:13px;line-height:1.6">${esc(X.body((r.target && r.target.name) || 'the member', (r.reporter && r.reporter.name) || 'the reporter'))}</div>${quote}`, ok: X.ok, cancel: X.cancel });
    if (!ok) return;
    el.setAttribute('aria-disabled', 'true');
    try {
      const note = reportNote(r.id);
      const res = await api.post('/api/v2/safety/reports/' + encodeURIComponent(r.id) + '/remove-message', Object.assign({ message_id: c.id }, note ? { note } : {}));
      ui.toast(res && res.already ? COPY.reports.toast.removedAlready : COPY.reports.toast.removed);
      await reportsChanged();
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  // every message from the reported member to the reporter
  reportRemoveAll: async (el) => {
    const r = reportById(el.dataset.id); if (!r || !r.target) return;
    const A = COPY.reports.removeAllAsk;
    const from = r.target.name || 'the member', to = (r.reporter && r.reporter.name) || 'the reporter';
    const ok = await ui.confirm({ eyebrow: A.eyebrow, title: esc(A.title(from)), body: `<div style="font-size:13px;line-height:1.6">${esc(A.body(from, to))}</div>`, ok: A.ok, cancel: A.cancel });
    if (!ok) return;
    el.setAttribute('aria-disabled', 'true');
    try {
      const note = reportNote(r.id);
      const res = await api.post('/api/v2/safety/reports/' + encodeURIComponent(r.id) + '/remove-message', Object.assign({ scope: 'thread' }, note ? { note } : {}));
      ui.toast(COPY.reports.toast.removedAll(Number((res && res.removed) || 0)));
      await reportsChanged();
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  // REMOVE PHOTO (fields=photo) / CLEAR PROFILE TEXT (fields=bio,title,specialties) on a profile report
  reportClear: async (el) => {
    const r = reportById(el.dataset.id); if (!r || !r.target || !r.target.id) return;
    const fields = String(el.dataset.fields || '').split(',').filter(Boolean);
    const photo = fields.length === 1 && fields[0] === 'photo';
    const A = photo ? COPY.reports.clearPhotoAsk : COPY.reports.clearTextAsk;
    const ok = await ui.confirm({ eyebrow: A.eyebrow, title: esc(A.title(r.target.name)), body: `<div style="font-size:13px;line-height:1.6">${esc(A.body)}</div>`, ok: A.ok, cancel: A.cancel });
    if (!ok) return;
    el.setAttribute('aria-disabled', 'true');
    try {
      const note = reportNote(r.id);
      await api.post('/api/v2/safety/reports/' + encodeURIComponent(r.id) + '/clear-profile', Object.assign({ fields }, note ? { note } : {}));
      ui.toast(photo ? COPY.reports.toast.photoCleared(r.target.name) : COPY.reports.toast.textCleared(r.target.name));
      await reportsChanged();
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  reportSuspend: async (el) => {
    const r = reportById(el.dataset.id); if (!r || !r.target || !r.target.id) return;
    const reason = await askSuspendReason(r.target.name);
    if (reason == null) return;
    const note = reportNote(r.id);
    el.setAttribute('aria-disabled', 'true');
    try {
      await api.post('/api/v2/safety/reports/' + encodeURIComponent(r.id) + '/suspend', note ? { reason, note } : { reason });
      ui.toast(COPY.reports.toast.suspended(r.target.name));
      await reportsChanged();
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  reportUnsuspend: (el) => undoOnMember(el, id => '/api/v2/safety/users/' + encodeURIComponent(id) + '/unsuspend', COPY.reports.unsuspendAsk, n => COPY.reports.toast.unsuspended(n)),
  reportUnhide: (el) => undoOnMember(el, id => '/api/v2/safety/users/' + encodeURIComponent(id) + '/unhide', COPY.reports.unhideAsk, n => COPY.reports.toast.unhidden(n)),
  // the reported member's name → their file in this screen (list filtered to them, panel open)
  reportTarget: (el) => {
    const uid = el.dataset.uid, email = String(el.dataset.email || '').toLowerCase();
    const p = D.people.find(x => (uid && x.user_id === uid) || (email && String(x.email || '').toLowerCase() === email));
    if (!p) { ui.toast(COPY.reports.toast.notFound, { kind: 'error' }); return; }
    st.segs = []; st.query = p.email || p.name; st.selKey = p.key; st.noteDraft = null;
    const qEl = rootEl.querySelector('[data-role="peopleQ"]'); if (qEl) qEl.value = st.query;
    rootEl.querySelectorAll('[data-act="seg"]').forEach(c => {
      const on = segOn(c.dataset.seg);
      c.style.background = on ? '#201b16' : '#fff'; c.style.color = on ? '#f6f2ea' : '#6d6459'; c.style.borderColor = on ? '#201b16' : 'rgba(32,27,22,.2)';
      c.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    redraw('list'); redraw('panel'); ui.settle(rootEl.querySelector('[data-block="panel"]')); enrich(p);
    const dir = rootEl.querySelector('[data-block="directory"]'); if (dir) dir.scrollIntoView({ behavior: ui.reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  },
  dupDismiss: (el) => { st.dupDismissed.push(el.dataset.sig); redraw('dups'); ui.toast(COPY.dups.dismissed); },
  goMessages: () => router.navigate('/inbox/messages'),
  goPerms: () => router.navigate('/settings/team'),
  goRegs: () => router.navigate('/registrations'),
  markPaid: async (el) => {
    const p = selected(); if (!p || !p.gala) return;
    el.setAttribute('aria-disabled', 'true');
    try {
      await api.post('/api/admin/registrant/gala/' + encodeURIComponent(p.gala.id) + '/mark-paid');
      p.gala.payment_status = 'paid'; p.gala.status = 'confirmed'; p.gala.bucket = 'paid'; p.gala.bucket_label = 'Paid';
      p.tags = p.tags.map(t => galaOpenTag(t) ? 'GALA PAID' : t);
      redraw('list'); redraw('panel');
      ui.toast(COPY.toasts.markPaid);
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  chase: async (el) => {
    const p = selected(); if (!p) return;
    const n = nagFor(p);
    if (!n) { ui.toast(COPY.toasts.chaseNone); return; }
    if (n.status === 'actioned') { ui.toast(COPY.toasts.chaseInOutbox); return; }
    el.setAttribute('aria-disabled', 'true');
    try {
      await api.post('/api/admin/nag/items/' + encodeURIComponent(n.id) + '/act');
      n.status = 'actioned'; redraw('panel');
      ui.toast(COPY.toasts.chased);
      chrome.refresh();
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  resend: async (el) => {
    const p = selected(); if (!p) return;
    const type = p.tags.includes('GALA PAID') && p.gala ? 'gala' : p.plexus ? 'conference' : p.gala ? 'gala' : null;
    const id = type === 'gala' ? p.gala.id : p.plexus && p.plexus.id;
    if (!type || !id) return;
    el.setAttribute('aria-disabled', 'true');
    try {
      const r = await api.post('/api/admin/registrant/' + type + '/' + encodeURIComponent(id) + '/resend-ticket');
      el.removeAttribute('aria-disabled');
      ui.toast((r && r.message) ? String(r.message).toUpperCase() : 'TICKET RE-EMAILED TO ' + (p.email || '').toUpperCase(), r && r.ok === false ? { kind: 'error' } : undefined);
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  copyPass: () => {
    const p = selected(); if (!p || !p.passes.length) return;
    const full = D.passes.find(v => v.id === p.passes[0].id);
    const url = (full && full.public_url) || '';
    if (url) { try { navigator.clipboard.writeText(url); } catch (e) {} ui.toast(COPY.toasts.passCopied); }
  },
  copyPassRow: (el) => {
    const gp = D.passes.find(v => v.id === el.dataset.id); if (!gp) return;
    try { navigator.clipboard.writeText(gp.public_url || ''); } catch (e) {}
    st.copiedPass = gp.id; redraw('passes');
    ui.toast(COPY.toasts.passCopied);
  },
  mintPass: async (el) => {
    const input = rootEl.querySelector('[data-role="passDraft"]'); const evSel = rootEl.querySelector('[data-role="passEvent"]');
    const name = input ? input.value.trim() : '';
    if (!name) { ui.toast(COPY.toasts.passName); return; }
    st.passDraft = ''; st.passEvent = evSel ? evSel.value : (D.passEvents[0] && D.passEvents[0].key) || 'gala';
    el.setAttribute('aria-disabled', 'true');
    try {
      const r = await api.post('/api/admin/guest-passes', { guest_name: name, event_key: st.passEvent });
      if (r && r.pass) D.passes.unshift(r.pass);
      redraw('passes');
      ui.toast(COPY.toasts.minted);
    } catch (e) { el.removeAttribute('aria-disabled'); st.passDraft = name; redraw('passes'); ui.toast(e.message, { kind: 'error' }); }
  }
};

export default {
  title: 'People',
  async render(root, ctx) {
    ensureCss();
    rootEl = root;
    st = { query: String((ctx && ctx.query && ctx.query.q) || ''), segs: [], selKey: null, addOpen: false, passDraft: '', passEvent: '', copiedPass: null, profileLoading: null, noteDraft: null, dupDismissed: [], sessionMerges: [], showAll: false };
    D = await load();
    if (rootEl !== root) return;                        // navigated away while loading
    st.passEvent = (D.passEvents[0] && D.passEvents[0].key) || 'gala';
    const askedReports = String((ctx && ctx.query && ctx.query.reports) || '') === '1';
    st.reportsOpen = openReports() > 0 || askedReports;   // open while anything waits (or /people?reports=1)
    root.innerHTML = template();
    unbind = ui.bind(root, handlers);
    wireInputs();
    enrich(selected());
  },
  destroy() { if (unbind) unbind(); unbind = null; rootEl = null; D = null; st = null; }
};
