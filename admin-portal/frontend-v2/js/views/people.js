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
  segs: {
    ALL: 'EVERYONE', MEMBERS: 'MED&X MEMBERS', FORUM: 'FORUM MEMBERS', REGISTRANTS: 'PLEXUS',
    GALA: 'GALA', BOSTON: FACTS.bridges.next.city.toUpperCase(), TEAM: 'YOUR TEAM'
  },
  segsNote: 'Chips combine — pick several and the list shows anyone in any of them.',
  dividers: { MEMBERS: 'CIRCLES', REGISTRANTS: 'REGISTRANTS', TEAM: 'STAFF' },
  quick: 'REGISTRATIONS:',
  cols: { name: 'NAME', country: 'COUNTRY', status: 'STATUS' },
  open: 'OPEN →', emptyList: 'No one matches — try fewer words.',
  rowsNote: (n, total) => `Showing ${n} of ${total} people · everyone in the database, live`,
  panelNote: 'Actions match the person — unpaid guests get payment tools, team members get access tools.',
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
    nag: api.get('/api/admin/nag/items')
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
  return D.people.filter(p => (!st.segs.length || p.segs.some(s => st.segs.includes(s))) &&
    (!q || (p.name + ' ' + p.email + ' ' + p.country + ' ' + p.tags.join(' ')).toLowerCase().includes(q)));
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

function tagStyle(t) {
  return t === 'UNSUBSCRIBED' ? { bg: '#4a2023', fg: '#f2d9da' }
    : t.includes('CHASE') ? { bg: '#f7e3e4', fg: '#7e151b' }
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
      : F.pending]);
    if (p.tags.includes('GALA — TO CHASE')) rows.push([F.reminder, nagFor(p) && nagFor(p).status === 'actioned' ? F.reminderStaged : F.reminderReady]);
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
  if (p.tags.includes('GALA — TO CHASE')) { out.push({ label: A.markPaid, ...ghost, act: 'markPaid' }); out.push({ label: A.chase, ...ghost, act: 'chase' }); }
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
    <span style="display:flex;align-items:center;gap:8px;border:1px solid rgba(32,27,22,.25);background:#fff;padding:10px 14px;flex:1;min-width:260px"><span style="color:#6d6459">⌕</span><input data-role="peopleQ" value="${esc(st.query)}" placeholder="${esc(COPY.searchPh)}" style="border:none;background:transparent;font:400 13.5px Inter,sans-serif;color:#201b16;flex:1;outline:none;padding:0"></span>
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
function listCard() {
  const list = filtered(); const sel = selected();
  return `
    <div data-block="list" style="border:1px solid rgba(32,27,22,.14);background:#fff">
      <div class="mx-people-row" style="display:grid;grid-template-columns:2fr 1.1fr 1.6fr auto;gap:12px;padding:10px 18px;border-bottom:1px solid rgba(32,27,22,.14);font:600 9px Inter,sans-serif;letter-spacing:.15em;color:#6d6459"><span>${COPY.cols.name}</span><span>${COPY.cols.country}</span><span>${COPY.cols.status}</span><span></span></div>
      ${list.map(p => `
      <div data-act="openRow" data-key="${esc(p.key)}" class="mx-people-row" style="display:grid;grid-template-columns:2fr 1.1fr 1.6fr auto;gap:12px;padding:12px 18px;border-bottom:1px solid rgba(32,27,22,.07);cursor:pointer;align-items:center;background:${sel && p.key === sel.key ? '#f6f2ea' : '#fff'}">
        <span style="min-width:0"><span style="display:block;font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.name)}</span><span style="display:block;font-size:11px;color:#6d6459;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.email || '—')}</span></span>
        <span style="font-size:12.5px;color:#4a4239">${esc(p.country || '—')}</span>
        <span style="display:flex;gap:6px;flex-wrap:wrap">${p.tags.map(t => { const s = tagStyle(t); return `<span style="font:600 8.5px Inter,sans-serif;letter-spacing:.1em;padding:3px 7px;background:${s.bg};color:${s.fg};white-space:nowrap">${esc(t)}</span>`; }).join('')}</span>
        <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.12em;color:#9b1b22;white-space:nowrap">${COPY.open}</span>
      </div>`).join('')}
      ${!list.length ? `<div style="padding:26px 18px;text-align:center;font-size:13px;color:#6d6459">${COPY.emptyList}</div>` : ''}
      <div style="padding:11px 18px;font-size:11.5px;color:#6d6459">${COPY.rowsNote(list.length, D.people.length)}</div>
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
        <span style="min-width:0"><span style="display:block;font-size:15px;font-weight:600">${esc(p.name)}</span><span style="display:block;font-size:11.5px;color:#6d6459">${esc([p.country, p.email].filter(Boolean).join(' · ') || '—')}</span></span>
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
  if (!part || part === 'panel') swap('[data-block="panel"]', panelCard());
  if (!part || part === 'passes') swap('[data-block="passes"]', passesCard());
  if (!part || part === 'dups') swap('[data-block="dups"]', blockDups());
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
  openRow: (el) => { st.selKey = el.dataset.key; st.noteDraft = null; redraw('list'); redraw('panel'); enrich(selected()); },
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
  dupDismiss: (el) => { st.dupDismissed.push(el.dataset.sig); redraw('dups'); ui.toast(COPY.dups.dismissed); },
  goMessages: () => router.navigate('/inbox/messages'),
  goPerms: () => router.navigate('/settings/team'),
  goRegs: () => router.navigate('/registrations'),
  markPaid: async (el) => {
    const p = selected(); if (!p || !p.gala) return;
    el.setAttribute('aria-disabled', 'true');
    try {
      await api.post('/api/admin/registrant/gala/' + encodeURIComponent(p.gala.id) + '/mark-paid');
      p.gala.payment_status = 'paid'; p.gala.status = 'confirmed';
      p.tags = p.tags.map(t => t === 'GALA — TO CHASE' ? 'GALA PAID' : t);
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
    st = { query: '', segs: [], selKey: null, addOpen: false, passDraft: '', passEvent: '', copiedPass: null, profileLoading: null, noteDraft: null, dupDismissed: [], sessionMerges: [] };
    D = await load();
    if (rootEl !== root) return;                        // navigated away while loading
    st.passEvent = (D.passEvents[0] && D.passEvents[0].key) || 'gala';
    root.innerHTML = template();
    unbind = ui.bind(root, handlers);
    wireInputs();
    enrich(selected());
  },
  destroy() { if (unbind) unbind(); unbind = null; rootEl = null; D = null; st = null; }
};
