// Source: Admin People.dc.html
// Blocks (artboard order): "Title row" (People · sub · EXPORT CSV · + ADD A PERSON) ›
// "New person panel" › "Search + segments" (+ v2 registrations quick-links row) ›
// "Directory + member file" (list card 1fr · 330px side: member file panel + GUEST PASSES).
// Data: GET /api/v2/people/directory (the union list — see backend/v2/people.js), /api/team,
// /api/admin/guest-passes, /api/admin/guest-pass-events, /api/admin/nag/items; the file panel
// enriches a portal member via GET /api/admin/users/:id/profile (title/photo/specialties incl.).
// Privacy: no password/secret field is ever fetched or rendered.
import { api } from '../api.js';
import { ui, esc, fmt } from '../ui.js';
import { FACTS } from '../facts.js';
import { chrome } from '../chrome.js';
import router from '../router.js';

export const SOURCE = 'Admin People.dc.html';

export const COPY = {
  title: 'People', sub: 'one list for everyone — members, event guests, your team',
  exportBtn: n => `EXPORT CSV · ${n}`, exported: n => `EXPORTED ${n} PEOPLE · CSV`,
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
  }
};

const SEG_ORDER = ['ALL', 'MEMBERS', 'FORUM', 'REGISTRANTS', 'GALA', 'BOSTON', 'TEAM'];
const QUICK_LINKS = [['PLEXUS', '/registrations?event=plexus'], ['GALA', '/registrations?event=gala'], ['BRIDGES', '/registrations?event=bridges'], ['ALL', '/registrations']];

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
  const people = ((r.dir && r.dir.people) || []).map((p, i) => ({ ...p, key: (p.email || '') + '#' + i }));
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

// ---------------------------------------------------------------- derived
function filtered() {
  const q = st.query.trim().toLowerCase();
  return D.people.filter(p => (st.seg === 'ALL' || p.segs.includes(st.seg)) &&
    (!q || (p.name + ' ' + p.email + ' ' + p.country + ' ' + p.tags.join(' ')).toLowerCase().includes(q)));
}
function selected() {
  const list = filtered();
  return list.find(p => p.key === st.selKey) || list[0] || D.people[0] || null;
}
function tagStyle(t) {
  return t.includes('CHASE') ? { bg: '#f7e3e4', fg: '#7e151b' }
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
    <span data-act="exportCsv" data-role="exportBtn" style="padding:9px 14px;border:1px solid rgba(32,27,22,.2);font:600 10px Inter,sans-serif;letter-spacing:.14em;cursor:pointer;white-space:nowrap" data-hover="border-color:#201b16">${COPY.exportBtn(filtered().length)}</span>
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
function blockSearch() {
  const counts = {}; SEG_ORDER.forEach(k => { counts[k] = k === 'ALL' ? D.people.length : D.people.filter(p => p.segs.includes(k)).length; });
  return `
  <!-- dc: Admin People.dc.html › "Search + segments" -->
  <div data-block="segs" style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">
    <span style="display:flex;align-items:center;gap:8px;border:1px solid rgba(32,27,22,.25);background:#fff;padding:10px 14px;flex:1;min-width:260px"><span style="color:#6d6459">⌕</span><input data-role="peopleQ" value="${esc(st.query)}" placeholder="${esc(COPY.searchPh)}" style="border:none;background:transparent;font:400 13.5px Inter,sans-serif;color:#201b16;flex:1;outline:none;padding:0"></span>
    ${SEG_ORDER.map(k => {
      const on = st.seg === k;
      const divider = COPY.dividers[k] ? `<span style="display:flex;align-items:center;gap:8px;white-space:nowrap"><span style="width:1px;height:20px;background:rgba(32,27,22,.2)"></span><span style="font:600 8px Inter,sans-serif;letter-spacing:.14em;color:#9a9086">${COPY.dividers[k]}</span></span>` : '';
      return divider + `<span data-act="seg" data-seg="${k}" style="padding:9px 13px;font:600 10px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap;background:${on ? '#201b16' : '#fff'};color:${on ? '#f6f2ea' : '#6d6459'};border:1px solid ${on ? '#201b16' : 'rgba(32,27,22,.2)'}">${COPY.segs[k]} · ${counts[k]}</span>`;
    }).join('\n    ')}
  </div>
  <!-- /dc -->
  <!-- v2: registrations quick-links (doors → /registrations filtered) -->
  <div data-v2="reg-quick-links" style="display:flex;gap:14px;align-items:baseline;flex-wrap:wrap;margin-top:-8px">
    <span style="font:600 8.5px Inter,sans-serif;letter-spacing:.15em;color:#9a9086">${COPY.quick}</span>
    ${QUICK_LINKS.map(([label, href]) => `<a href="${href}" style="font:600 9px Inter,sans-serif;letter-spacing:.13em;color:#9b1b22;white-space:nowrap" data-hover="color:#201b16">${label} →</a>`).join('\n    ')}
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
      <div style="padding:0 18px 16px;display:flex;gap:8px;flex-wrap:wrap">
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
  const ex = rootEl.querySelector('[data-role="exportBtn"]'); if (ex) ex.textContent = COPY.exportBtn(filtered().length);
}
function wireInputs() {
  const q = rootEl.querySelector('[data-role="peopleQ"]');
  if (q) q.addEventListener('input', () => { st.query = q.value; st.selKey = null; redraw('list'); redraw('panel'); const ex = rootEl.querySelector('[data-role="exportBtn"]'); if (ex) ex.textContent = COPY.exportBtn(filtered().length); });
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

const handlers = {
  seg: (el) => { st.seg = el.dataset.seg; st.selKey = null; const wrap = rootEl.querySelector('[data-block="segs"]'); if (wrap) { rootEl.querySelectorAll('[data-act="seg"]').forEach(c => { const on = c.dataset.seg === st.seg; c.style.background = on ? '#201b16' : '#fff'; c.style.color = on ? '#f6f2ea' : '#6d6459'; c.style.borderColor = on ? '#201b16' : 'rgba(32,27,22,.2)'; }); } redraw('list'); redraw('panel'); enrich(selected()); },
  openRow: (el) => { st.selKey = el.dataset.key; redraw('list'); redraw('panel'); enrich(selected()); },
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
      st.addOpen = false; st.seg = 'ALL'; st.query = ''; st.selKey = null;
      const fresh = await load(); if (!rootEl) return; D = fresh;
      rootEl.innerHTML = template(); wireInputs();
      ui.toast(r.invite_staged ? COPY.addedMember : COPY.added);
      chrome.refresh();          // a staged invitation bumps the INBOX badge
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  exportCsv: () => {
    const list = filtered();
    const csv = ['Name,Email,Country,Tags'].concat(list.map(p => `"${p.name.replace(/"/g, '""')}","${p.email}","${p.country}","${p.tags.join(' · ')}"`)).join('\n');
    const a = document.createElement('a'); a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv); a.download = 'medx-people.csv'; a.click();
    ui.toast(COPY.exported(list.length));
  },
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
    st = { query: '', seg: 'ALL', selKey: null, addOpen: false, passDraft: '', passEvent: '', copiedPass: null, profileLoading: null };
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
