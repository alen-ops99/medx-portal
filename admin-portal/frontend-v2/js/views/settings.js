// Source: Admin Settings.dc.html — the once-in-a-while things, all real:
// "SYSTEM HEALTH" (probes + the 24-check report + the shared last-run sentinel note) ›
// "TEAM ACCESS" (list · invite ADMIN/SCANNER · per-section PERMISSIONS honoring the 19
// PERMISSION_SECTIONS, founder never restrictable · remove access) › "ORGANISATION & PAYMENTS"
// (server-side v2_org_settings) › "WHAT THE PUBLIC & MEMBERS SEE" › "MAKE & STORE — THE STUDIO"
// › "AUDIT LOG" (filterable) › "TEAM LIBRARY" (team_files upload/open).
// Tabs (/settings/:tab) are anchors on this one page: health · team · org · audit · library.
import cfg from '../config.js';
import { api } from '../api.js';
import { ui, esc, fmt } from '../ui.js';
import { health } from '../health.js';
import { perms, PERMISSION_SECTIONS } from '../perms.js';
import { session, state } from '../state.js';

export const SOURCE = 'Admin Settings.dc.html';
export const COPY = {
  title: 'Settings &amp; tools', sub: 'the once-in-a-while things — everything is here, nothing was deleted',
  health: { title: 'SYSTEM HEALTH', tag: (o, w, f) => `${o} OK · ${w} TO CHECK · ${f} FAILING`,
    lastRun: (row) => row ? `last run ${fmt.when(row.ran_at.replace(' ', 'T') + 'Z').toLowerCase()} by ${String(row.by_email || '').split('@')[0]}` : 'not run by hand yet',
    run: 'RUN CHECKS AGAIN', running: 'CHECKING…',
    note: 'Run this before every event and any time something seems off — it checks email, payments, database and event setup in one go.',
    probes: { admin: 'Admin backend', member: 'Member portal', report: 'Health report' },
    ran: (o, w, f) => `ALL ${o + w + f} CHECKS RAN — ${w} WANT A LOOK${f ? `, ${f} FAILING` : ''}`,
    locked: 'The health report needs System & Tech access — the two reachability probes still run.' },
  team: {
    title: 'TEAM ACCESS', sub: 'admins run everything · scanner staff only check people in',
    invite: '+ INVITE', send: 'SEND INVITE', emailPh: 'Email — e.g. ana@medx.hr',
    inviteNote: 'Admins run everything · scanner staff see only the Event Day check-in — the invite email carries a one-tap join link.',
    pending: 'INVITE PENDING', resend: 'RESEND', perms: 'PERMISSIONS',
    remove: 'REMOVE ACCESS', removeSure: 'SURE? REMOVE ACCESS', removed: 'ACCESS REMOVED — THEY CAN NO LONGER SIGN IN',
    founderAll: 'THE FOUNDER ALWAYS HAS EVERYTHING', selfNo: 'YOU CANNOT REMOVE YOURSELF',
    full: 'FULL ACCESS', todayOnly: 'today only', sections: n => `${n} section${n === 1 ? '' : 's'}`,
    invited: e => 'INVITE SENT TO ' + e.toUpperCase(), permSaved: 'ACCESS UPDATED — TAKES EFFECT ON THEIR NEXT CLICK',
    scannerMade: 'SCANNER ACCOUNT READY — HAND OVER THE PASSWORD BELOW',
    scannerBody: (em, pw) => `<p style="margin:0 0 8px">Scanner account for <b>${esc(em)}</b> is live — Event Day check-in only.</p><p style="margin:0 0 4px">One-time password (shown only now):</p><p style="margin:0"><code style="display:inline-block;background:#f6f2ea;border:1px solid rgba(32,27,22,.2);padding:8px 14px;font:600 15px ui-monospace,monospace;letter-spacing:.08em">${esc(pw)}</code></p>`,
    foot: (n, here) => `${n} teammate${n === 1 ? '' : 's'} · only ${here} see${here === 'you' ? '' : 's'} who uses the portal and how much`
  },
  org: {
    title: 'ORGANISATION &amp; PAYMENTS', sub: 'Legal details that appear on invoices, receipts and fiscal reports.',
    oib: 'OIB · TAX NUMBER', iban: 'IBAN · BANK TRANSFERS', fira: 'FIRA KEY · FISCAL INVOICES',
    save: 'SAVE ORGANISATION DETAILS', saved: '✓ SAVED — THE TEAM REFERENCE IS UPDATED',
    note: 'Saved for the whole team. The live payment checks read the service environment — ops copies these values there on deploy.'
  },
  see: {
    title: 'WHAT THE PUBLIC &amp; MEMBERS SEE',
    rows: [
      { name: 'Publish news', note: 'one post — member portal, website, or both', href: '/inbox/announcements' },
      { name: 'Member portal text', note: 'home-screen cards, project pages', href: '/member-pages' },
      { name: 'Website text', note: 'medx.hr page copy — same editor, website tab', href: '/member-pages/website' },
      { name: 'Sign-up form pages', note: 'public links for short events', href: '/links' }
    ]
  },
  studio: {
    title: 'MAKE &amp; STORE THINGS — MOVED TO THE STUDIO',
    why: 'Badges, certificates, the print suite, social cards, brand assets and stored files now live in their own place in the header.',
    open: 'OPEN THE STUDIO →',
    rows: [
      { name: 'Content studio', note: 'social cards & member share cards', href: '/studio/social' },
      { name: 'Brand studio', note: 'logos, colours, type — the official kit', href: '/studio#brand' },
      { name: 'Merch studio', note: 'its own tool, one link deep', href: '/studio#merch' }
    ]
  },
  audit: { title: 'AUDIT LOG', sub: 'who changed what, forever', more: 'FULL LOG →', less: 'SHOW LESS', filter: 'Filter — a name, an action…', empty: 'Nothing logged yet.' },
  lib: {
    title: 'TEAM LIBRARY', sub: 'guides &amp; files everyone reaches for', upload: 'UPLOAD A FILE', open: 'OPEN',
    uploaded: 'ADDED TO THE TEAM LIBRARY', tooBig: 'FILES UP TO 5MB ONLY — LARGER ONES BELONG ON SHAREPOINT',
    empty: 'Nothing stored yet.', emptyWhy: 'Upload the operations handbook, the sponsorship brochure, the logo-use agreement — the things everyone keeps asking for.'
  }
};

const DOT = { ok: '#2f7d4f', warn: '#b7791f', fail: '#9b1b22' };
let D = null, st = null, rootEl = null, unbind = null, off = null;

// ---------------------------------------------------------------- data
async function load() {
  const r = await api.settle({
    team: api.get('/api/admin/team'),
    audit: api.get('/api/admin/audit-log?limit=200'),
    files: api.get('/api/admin/files'),
    org: api.get('/api/v2/settings/org'),
    sentinel: api.get('/api/v2/settings/health-run')
  });
  return {
    errors: r.$errors,
    team: Array.isArray(r.team) ? r.team : [],
    audit: Array.isArray(r.audit) ? r.audit : [],
    files: (r.files && r.files.files) || [],
    org: r.org || { oib: '', iban: '', fira_key: '' },
    sentinel: (r.sentinel && r.sentinel.last) || null
  };
}
const roleOf = m => Number(m.is_founder) ? 'FOUNDER' : (Number(m.is_admin) ? 'ADMIN' : 'SCANNER');
const nameOf = m => [m.first_name, m.last_name].filter(Boolean).join(' ') || m.email;

// ---------------------------------------------------------------- health (built earlier; + sentinel)
function healthCard() {
  const h = state.get().health;
  const groups = h && h.groups ? h.groups : [];
  const probes = h ? [['admin', h.probes.admin], ['member', h.probes.member]] : [];
  const counts = h ? { ok: h.ok, warn: h.warn, fail: h.fail } : { ok: 0, warn: 0, fail: 0 };
  return `
    <!-- dc: Admin Settings.dc.html › "SYSTEM HEALTH" -->
    <div id="health" data-block="health" style="border:1px solid rgba(32,27,22,.14);background:#fff">
      <div style="display:flex;align-items:center;gap:12px;padding:14px 20px;border-bottom:1px solid rgba(32,27,22,.12);flex-wrap:wrap">
        <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${COPY.health.title}</span>
        <span style="font:600 9px Inter,sans-serif;letter-spacing:.12em;background:${h && h.state === 'fail' ? '#f5e4e5' : '#f8f1e2'};color:${h && h.state === 'fail' ? '#9b1b22' : '#7a6432'};padding:3px 8px">${h ? COPY.health.tag(counts.ok, counts.warn, counts.fail) : 'CHECKING…'}</span>
        <span data-role="sentinel" style="font-size:11px;color:#6d6459">${esc(COPY.health.lastRun(D && D.sentinel))}</span>
        <div style="flex:1"></div>
        <span data-act="run" style="padding:8px 13px;border:1px solid rgba(32,27,22,.2);font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap" data-hover="border-color:#201b16">${st.running ? COPY.health.running : COPY.health.run}</span>
      </div>
      <div style="padding:6px 20px 14px">
        ${probes.map(([k, p]) => `
        <div style="display:flex;align-items:baseline;gap:12px;padding:8px 0;border-bottom:1px solid rgba(32,27,22,.06)">
          <span style="width:8px;height:8px;background:${p.ok ? DOT.ok : DOT.fail};flex:none;transform:translateY(-1px)"></span>
          <span style="font-size:13px;font-weight:600;width:230px;flex:none">${COPY.health.probes[k]}</span>
          <span style="font-size:12px;color:#6d6459;flex:1">${esc(p.detail || (p.ok ? 'reachable' : 'unreachable'))}</span>
        </div>`).join('')}
        ${h && h.probes.report && !h.probes.report.ok && h.probes.report.locked ? `<div style="padding:10px 0;font-size:12px;color:#6d6459">${COPY.health.locked}</div>` : ''}
        ${groups.map(g => `
        <div style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:#6d6459;padding:14px 0 4px">${esc(String(g.group || '').toUpperCase())}</div>
        ${(g.checks || []).map(c => `
        <div style="display:flex;align-items:baseline;gap:12px;padding:8px 0;border-bottom:1px solid rgba(32,27,22,.06)">
          <span style="width:8px;height:8px;background:${DOT[c.status] || DOT.warn};flex:none;transform:translateY(-1px)"></span>
          <span style="font-size:13px;font-weight:600;width:230px;flex:none">${esc(c.name)}</span>
          <span style="font-size:12px;color:#6d6459;flex:1">${esc(c.detail || '')}${c.fix ? ` <span style="color:#7a6432">· ${esc(c.fix)}</span>` : ''}</span>
        </div>`).join('')}`).join('')}
        <span style="display:block;font-size:11.5px;color:#6d6459;margin-top:10px">${COPY.health.note}</span>
      </div>
    </div>
    <!-- /dc -->`;
}

// ---------------------------------------------------------------- team access
function permChips(m) {
  const allowed = m.allowed_sections; // null = full; [] = today only; array = ids
  const isFull = allowed === null;
  const has = id => isFull || (Array.isArray(allowed) && allowed.includes(id));
  const chip = (label, on, act, extra = '') => `<span data-act="${act}" ${extra} style="padding:5px 10px;font:600 8.5px Inter,sans-serif;letter-spacing:.11em;cursor:pointer;background:${on ? '#201b16' : 'transparent'};color:${on ? '#f6f2ea' : '#6d6459'};border:1px solid ${on ? '#201b16' : 'rgba(32,27,22,.25)'};white-space:nowrap">${esc(label)}</span>`;
  const groups = [];
  let g = null;
  PERMISSION_SECTIONS.forEach(s => {
    if (!g || g.name !== s.group) { g = { name: s.group, items: [] }; groups.push(g); }
    g.items.push(s);
  });
  return `
          <div data-block="perm-${esc(m.id)}" style="display:flex;flex-direction:column;gap:8px;padding:12px 20px;border-bottom:1px solid rgba(32,27,22,.07);background:#fdfbf6">
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              ${chip(COPY.team.full, isFull, 'permFull', `data-id="${esc(m.id)}"`)}
              <span style="font-size:11px;color:#6d6459">or pick sections — saved the moment you click</span>
              <div style="flex:1"></div>
              <span data-act="revoke" data-id="${esc(m.id)}" data-email="${esc(m.email)}" style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:${st.revokeConfirm === m.id ? '#9b1b22' : '#6d6459'};cursor:pointer;white-space:nowrap">${st.revokeConfirm === m.id ? COPY.team.removeSure : COPY.team.remove}</span>
            </div>
            ${groups.map(gr => `
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
              <span style="font:600 8px Inter,sans-serif;letter-spacing:.14em;color:#9a9086;width:96px;flex:none">${esc(gr.name.toUpperCase())}</span>
              ${gr.items.map(s => chip(s.label, has(s.id), 'permTg', `data-id="${esc(m.id)}" data-sec="${esc(s.id)}"`)).join('')}
            </div>`).join('')}
          </div>`;
}
function teamCard() {
  const teamErr = D.errors.team;
  const rows = D.team.slice().sort((a, b) => (Number(b.is_founder) - Number(a.is_founder)) || (Number(b.is_admin) - Number(a.is_admin)) || String(a.email).localeCompare(b.email));
  const shown = st.teamAll ? rows : rows.slice(0, 7);
  const accessLine = m => Number(m.is_founder) || m.allowed_sections === null ? COPY.team.full.toLowerCase() : (m.allowed_sections.length ? COPY.team.sections(m.allowed_sections.length) : COPY.team.todayOnly);
  return `
    <!-- dc: Admin Settings.dc.html › "TEAM ACCESS" -->
    <div id="team" data-block="team" style="border:1px solid rgba(32,27,22,.14);background:#fff">
      <div style="display:flex;align-items:center;gap:10px;padding:14px 20px;border-bottom:1px solid rgba(32,27,22,.12);flex-wrap:wrap">
        <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${COPY.team.title}</span>
        <span style="font-size:11.5px;color:#6d6459">${COPY.team.sub}</span>
        <div style="flex:1"></div>
        <span data-act="inviteToggle" style="padding:8px 13px;background:#9b1b22;color:#fff;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap" data-hover="background:#7e151b">${COPY.team.invite}</span>
      </div>
      ${teamErr ? (teamErr.isLocked ? ui.lockedBlock(perms.label(teamErr.section)) : `<div class="empty"><span class="empty-why">${esc(teamErr.message)}</span></div>`) : `
      ${st.inviteOpen ? `
      <div data-block="invite" style="display:flex;gap:8px;align-items:center;padding:12px 20px;border-bottom:1px solid rgba(32,27,22,.08);background:#fdfbf6;flex-wrap:wrap">
        <input data-role="invEmail" value="${esc(st.invEmail)}" placeholder="${esc(COPY.team.emailPh)}" aria-label="Invite email" style="flex:1;min-width:170px;border:1px solid rgba(32,27,22,.25);background:#fff;padding:8px 10px;font:400 12.5px Inter,sans-serif;color:#201b16">
        <select data-role="invRole" aria-label="Role" style="border:1px solid rgba(32,27,22,.25);background:#fff;padding:8px;font:400 12.5px Inter,sans-serif;color:#201b16"><option${st.invRole === 'ADMIN' ? ' selected' : ''}>ADMIN</option><option${st.invRole === 'SCANNER' ? ' selected' : ''}>SCANNER</option></select>
        <span data-act="sendInvite" style="padding:8px 13px;background:#9b1b22;color:#fff;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer">${COPY.team.send}</span>
        <span style="font-size:11px;color:#6d6459;flex-basis:100%">${COPY.team.inviteNote}</span>
      </div>` : ''}
      ${shown.map(m => `
      <div data-row="${esc(m.id)}" style="display:flex;align-items:center;gap:12px;padding:11px 20px;border-bottom:1px solid rgba(32,27,22,.07);flex-wrap:wrap">
        <span style="width:28px;height:28px;background:#eee9df;color:#4a4239;display:inline-flex;align-items:center;justify-content:center;font:600 10px Inter,sans-serif;flex:none">${esc(fmt.initials(nameOf(m)))}</span>
        <span style="flex:1;min-width:140px"><span style="display:block;font-size:13px;font-weight:600">${esc(nameOf(m))}</span><span style="display:block;font-size:11px;color:#6d6459">${esc(m.email)} · ${esc(accessLine(m))}</span></span>
        ${Number(m.must_change_password) ? `<span style="font:600 8.5px Inter,sans-serif;letter-spacing:.1em;background:#f8f1e2;color:#7a6432;padding:3px 7px;white-space:nowrap">${COPY.team.pending}</span><span data-act="resend" data-email="${esc(m.email)}" style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#9b1b22;cursor:pointer">${COPY.team.resend}</span>` : ''}
        <span class="tag" style="white-space:nowrap">${roleOf(m)}</span>
        <span data-act="permsToggle" data-id="${esc(m.id)}" style="font:600 9.5px Inter,sans-serif;letter-spacing:.12em;color:#9b1b22;cursor:pointer;white-space:nowrap" data-hover="color:#201b16">${COPY.team.perms}</span>
      </div>
      ${st.permsOpen === m.id ? permChips(m) : ''}`).join('')}
      <div style="display:flex;gap:14px;align-items:baseline;padding:11px 20px;font-size:11.5px;color:#6d6459">
        <span>${esc(COPY.team.foot(rows.length, session.isFounder ? 'you' : 'Alen'))}</span>
        <div style="flex:1"></div>
        ${rows.length > 7 ? `<span data-act="teamAll" style="font:600 9.5px Inter,sans-serif;letter-spacing:.13em;color:#9b1b22;cursor:pointer">${st.teamAll ? 'SHOW FEWER' : 'ALL ' + rows.length + ' →'}</span>` : ''}
      </div>`}
    </div>
    <!-- /dc -->`;
}

// ---------------------------------------------------------------- org & payments
function orgCard() {
  const o = D.org;
  const input = (role, label, ph, val) => `
          <label style="display:flex;flex-direction:column;gap:4px"><span style="font:600 8.5px Inter,sans-serif;letter-spacing:.14em;color:#6d6459">${label}</span><input data-role="${role}" value="${esc(val || '')}" placeholder="${esc(ph)}" style="border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:8px 10px;font:400 12.5px ui-monospace,monospace;color:#201b16"></label>`;
  return `
    <!-- dc: Admin Settings.dc.html › "ORGANISATION & PAYMENTS" -->
    <div id="org" data-block="org" style="border:1px solid rgba(32,27,22,.14);border-top:2px solid #201b16;background:#fff;padding:16px 20px;display:flex;flex-direction:column;gap:9px">
      <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${COPY.org.title}</span>
      <span style="font-size:11.5px;color:#6d6459;line-height:1.5">${COPY.org.sub}</span>
      ${input('orgOib', COPY.org.oib, 'e.g. 12345678901', o.oib)}
      ${input('orgIban', COPY.org.iban, 'HR__ ____ ____ ____ ____ _', o.iban)}
      ${input('orgFira', COPY.org.fira, 'paste the key from FIRA', o.fira_key)}
      <span data-act="orgSave" style="padding:9px 13px;background:${st.orgSaved ? '#1e6e42' : '#9b1b22'};color:#fff;font:600 9.5px Inter,sans-serif;letter-spacing:.14em;cursor:pointer;text-align:center">${st.orgSaved ? COPY.org.saved : COPY.org.save}</span>
      <span style="font-size:11px;color:#6d6459">${COPY.org.note}</span>
    </div>
    <!-- /dc -->`;
}
function seeCard() {
  return `
    <!-- dc: Admin Settings.dc.html › "WHAT THE PUBLIC & MEMBERS SEE" -->
    <div style="border:1px solid rgba(32,27,22,.14);background:#fff;padding:16px 20px;display:flex;flex-direction:column;gap:4px">
      <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em;margin-bottom:6px">${COPY.see.title}</span>
      ${COPY.see.rows.map(t => `
      <a href="${t.href}" style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid rgba(32,27,22,.06);color:#201b16" data-hover="color:#9b1b22">
        <span style="font-size:12.5px;flex:1">${esc(t.name)}</span>
        <span style="font-size:11px;color:#6d6459">${esc(t.note)}</span>
        <span style="font:600 10px Inter,sans-serif;color:#9b1b22">→</span>
      </a>`).join('')}
    </div>
    <!-- /dc -->`;
}
function studioCard() {
  return `
    <!-- dc: Admin Settings.dc.html › "MAKE & STORE — MOVED TO THE STUDIO" -->
    <div style="border:1px solid rgba(32,27,22,.14);border-top:2px solid #c9a962;background:#fff;padding:16px 20px;display:flex;flex-direction:column;gap:8px">
      <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${COPY.studio.title}</span>
      <span style="font-size:12.5px;color:#6d6459;line-height:1.6">${COPY.studio.why}</span>
      <div data-v2="content · brand · merch doors" style="display:flex;flex-direction:column">
      ${COPY.studio.rows.map(t => `
      <a href="${t.href}" style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(32,27,22,.06);color:#201b16" data-hover="color:#9b1b22">
        <span style="font-size:12.5px;flex:1">${esc(t.name)}</span>
        <span style="font-size:11px;color:#6d6459">${esc(t.note)}</span>
        <span style="font:600 10px Inter,sans-serif;color:#9b1b22">→</span>
      </a>`).join('')}
      </div>
      <a href="/studio" style="padding:10px 14px;background:#201b16;color:#f6f2ea;font:600 10px Inter,sans-serif;letter-spacing:.14em;text-align:center;margin-top:4px" data-hover="background:#9b1b22;color:#f6f2ea">${COPY.studio.open}</a>
    </div>
    <!-- /dc -->`;
}

// ---------------------------------------------------------------- audit log
function auditRows() {
  const f = st.auditFilter.trim().toLowerCase();
  const rows = D.audit.filter(a => !f || [a.actor_email, a.action, a.detail].some(v => String(v || '').toLowerCase().includes(f)));
  const shown = st.auditAll ? rows.slice(0, 120) : rows.slice(0, 8);
  return `<div data-block="auditRows">
      ${shown.map(a => `
      <div style="display:flex;gap:12px;align-items:baseline;padding:10px 20px;border-bottom:1px solid rgba(32,27,22,.06)">
        <span style="font:600 9px Inter,sans-serif;letter-spacing:.1em;color:#6d6459;width:88px;flex:none">${esc(fmt.when(String(a.created_at || '').replace(' ', 'T') + 'Z'))}</span>
        <span style="font-size:12.5px;flex:1;min-width:0"><span style="font-weight:600">${esc(String(a.actor_email || '').split('@')[0])}</span> · ${esc(a.action)}${a.detail ? ` — <span style="color:#6d6459">${esc(String(a.detail).slice(0, 140))}</span>` : ''}</span>
      </div>`).join('')}
      ${!shown.length ? `<div style="padding:20px;font-size:12.5px;color:#6d6459;font-style:italic;text-align:center">${COPY.audit.empty}</div>` : ''}
    </div>`;
}
function auditCard() {
  const err = D.errors.audit;
  return `
    <!-- dc: Admin Settings.dc.html › "AUDIT LOG" -->
    <div id="audit" data-block="audit" style="border:1px solid rgba(32,27,22,.14);background:#fff">
      <div style="display:flex;align-items:center;gap:10px;padding:14px 20px;border-bottom:1px solid rgba(32,27,22,.12);flex-wrap:wrap">
        <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${COPY.audit.title}</span>
        <span style="font-size:11.5px;color:#6d6459">${COPY.audit.sub}</span>
        <div style="flex:1"></div>
        <input data-role="auditFilter" value="${esc(st.auditFilter)}" placeholder="${esc(COPY.audit.filter)}" aria-label="Filter the audit log" data-v2="filter" style="border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:7px 10px;font:400 12px Inter,sans-serif;color:#201b16;width:170px">
        <span data-act="auditToggle" style="font:600 10px Inter,sans-serif;letter-spacing:.13em;color:#9b1b22;cursor:pointer;white-space:nowrap">${st.auditAll ? COPY.audit.less : COPY.audit.more}</span>
      </div>
      ${err ? (err.isLocked ? ui.lockedBlock(perms.label(err.section)) : `<div class="empty"><span class="empty-why">${esc(err.message)}</span></div>`) : auditRows()}
    </div>
    <!-- /dc -->`;
}

// ---------------------------------------------------------------- team library (team_files)
const KIND = m => {
  const s = String(m || '');
  if (/pdf/.test(s)) return 'PDF';
  if (/word|docx?/.test(s)) return 'DOCX';
  if (/sheet|excel|xlsx?|csv/.test(s)) return 'SHEET';
  if (/presentation|pptx?/.test(s)) return 'DECK';
  if (/zip|compressed/.test(s)) return 'ZIP';
  if (/image\//.test(s)) return 'IMAGE';
  return (s.split('/')[1] || 'FILE').toUpperCase().slice(0, 8);
};
function libRows() {
  const rows = D.files;
  return `<div data-block="libRows">
      ${rows.map(f => `
      <div style="display:flex;align-items:center;gap:12px;padding:11px 20px;border-bottom:1px solid rgba(32,27,22,.06)">
        <span style="font:600 8.5px Inter,sans-serif;letter-spacing:.1em;background:#f1e7d4;color:#7a6432;padding:3px 7px;white-space:nowrap;flex:none">${esc(KIND(f.mime))}</span>
        <span style="flex:1;min-width:0"><span style="display:block;font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.name)}</span><span style="display:block;font-size:11px;color:#6d6459">${esc([f.uploaded_by_name, fmt.when(String(f.created_at || '').replace(' ', 'T') + 'Z').toLowerCase(), f.size ? Math.max(1, Math.round(f.size / 1024)) + ' KB' : ''].filter(Boolean).join(' · '))}</span></span>
        <span data-act="libOpen" data-id="${esc(f.id)}" data-name="${esc(f.name)}" style="font:600 9.5px Inter,sans-serif;letter-spacing:.12em;color:#9b1b22;cursor:pointer;white-space:nowrap">${COPY.lib.open}</span>
      </div>`).join('')}
      ${!rows.length ? `<div class="empty"><span style="width:28px;height:1px;background:#c9a962"></span><span class="empty-line">${COPY.lib.empty}</span><span class="empty-why">${COPY.lib.emptyWhy}</span></div>` : ''}
    </div>`;
}
function libCard() {
  const err = D.errors.files;
  return `
    <!-- dc: Admin Settings.dc.html › "TEAM LIBRARY" -->
    <div id="library" data-block="lib" style="border:1px solid rgba(32,27,22,.14);background:#fff">
      <div style="display:flex;align-items:center;gap:10px;padding:14px 20px;border-bottom:1px solid rgba(32,27,22,.12)">
        <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${COPY.lib.title}</span>
        <span style="font-size:11.5px;color:#6d6459">${COPY.lib.sub}</span>
        <div style="flex:1"></div>
        <label style="padding:8px 13px;border:1px solid rgba(32,27,22,.2);font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap" data-hover="border-color:#201b16">${COPY.lib.upload}<input data-role="libFile" type="file" style="display:none"></label>
      </div>
      ${err ? (err.isLocked ? ui.lockedBlock(perms.label(err.section)) : `<div class="empty"><span class="empty-why">${esc(err.message)}</span></div>`) : libRows()}
    </div>
    <!-- /dc -->`;
}

function template() {
  return `
<div data-screen-label="Admin Settings" style="min-height:100vh;background:#f6f2ea;color:#201b16;font-family:Inter,sans-serif">
  <div class="mx-gutter" style="max-width:1180px;margin:0 auto;padding:30px 28px 48px;display:flex;flex-direction:column;gap:22px">
    <div style="display:flex;align-items:baseline;gap:14px;flex-wrap:wrap">
      <span class="mx-display-30" style="font-family:Fraunces,serif;font-size:30px">${COPY.title}</span>
      <span style="font-size:12.5px;color:#6d6459">${COPY.sub}</span>
    </div>
    ${healthCard()}
    <div class="mx-side" style="display:grid;grid-template-columns:1.5fr 1fr;gap:22px;align-items:start">
      ${teamCard()}
      <div style="display:flex;flex-direction:column;gap:22px">
        ${orgCard()}
        ${seeCard()}
        ${studioCard()}
      </div>
    </div>
    <div class="mx-two" style="display:grid;grid-template-columns:1fr 1fr;gap:22px;align-items:start">
      ${auditCard()}
      ${libCard()}
    </div>
  </div>
</div>`;
}

// ---------------------------------------------------------------- behaviour
function paint(sel, html) { const el = rootEl && rootEl.querySelector(sel); if (el) el.outerHTML = html; wireInputs(); }
function wireInputs() {
  const af = rootEl.querySelector('[data-role="auditFilter"]');
  if (af && !af._wired) {
    af._wired = true;
    let t = null;
    af.addEventListener('input', e => { st.auditFilter = e.target.value; clearTimeout(t); t = setTimeout(() => { const el = rootEl.querySelector('[data-block="auditRows"]'); if (el) el.outerHTML = auditRows(); }, 180); });
  }
  const lf = rootEl.querySelector('[data-role="libFile"]');
  if (lf && !lf._wired) {
    lf._wired = true;
    lf.addEventListener('change', async e => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      if (f.size > 5 * 1024 * 1024) { ui.toast(COPY.lib.tooBig, { kind: 'error' }); e.target.value = ''; return; }
      try {
        const buf = await f.arrayBuffer();
        const url = api.url('/api/admin/files?scope=general&name=' + encodeURIComponent(f.name) + '&mime=' + encodeURIComponent(f.type || 'application/octet-stream'));
        const res = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + session.token }, body: buf });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error((data && data.error) || 'Upload failed');
        const list = await api.get('/api/admin/files'); D.files = (list && list.files) || [];
        paint('[data-block="lib"]', libCard());
        ui.toast(COPY.lib.uploaded);
      } catch (err) { ui.toast(err.message, { kind: 'error' }); }
      e.target.value = '';
    });
  }
}
async function saveSections(m, allowed) {
  try {
    const r = await api.put('/api/admin/team/permissions', { user_id: m.id, allowed_sections: allowed });
    m.allowed_sections = r.allowed_sections === undefined ? allowed : r.allowed_sections;
    paint('[data-block="team"]', teamCard());
    ui.toast(COPY.team.permSaved);
  } catch (e) { ui.toast(e.message, { kind: 'error' }); }
}

const handlers = {
  run: async (el) => {
    if (st.running) return;
    st.running = true; el.textContent = COPY.health.running;
    const h = await health.refresh({ force: true });
    st.running = false;
    if (h) {
      ui.toast(COPY.health.ran(h.ok, h.warn, h.fail));
      try { const r = await api.post('/api/v2/settings/health-run', { ok: h.ok, warn: h.warn, fail: h.fail }); D.sentinel = r.last || D.sentinel; } catch (e) {}
    }
    paint('[data-block="health"]', healthCard());
  },
  inviteToggle: () => { st.inviteOpen = !st.inviteOpen; paint('[data-block="team"]', teamCard()); if (st.inviteOpen) { const i = rootEl.querySelector('[data-role="invEmail"]'); if (i) i.focus(); } },
  sendInvite: async (el) => {
    const emailEl = rootEl.querySelector('[data-role="invEmail"]');
    const roleEl = rootEl.querySelector('[data-role="invRole"]');
    const em = emailEl ? emailEl.value.trim().toLowerCase() : '';
    st.invEmail = em; st.invRole = roleEl ? roleEl.value : 'ADMIN';
    if (!em || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { ui.toast('TYPE A REAL EMAIL FIRST'); return; }
    el.setAttribute('aria-disabled', 'true');
    try {
      if (st.invRole === 'SCANNER') {
        // scanner staff = is_staff account via the existing grant route; the one-time password is
        // generated here and shown ONCE (the invite-email flow is admin-only on the server).
        const pw = Array.from(crypto.getRandomValues(new Uint8Array(9))).map(b => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');
        await api.post('/api/admin/team/grant', { email: em, role: 'staff', password: pw });
        ui.modal({ eyebrow: 'SCANNER ACCESS', title: 'Hand these over once.', body: COPY.team.scannerBody(em, pw), actions: [{ label: 'DONE', kind: 'primary' }] });
        ui.toast(COPY.team.scannerMade);
      } else {
        await api.post('/api/admin/team/invite', { email: em });
        ui.toast(COPY.team.invited(em));
      }
      st.invEmail = ''; st.inviteOpen = false;
      const rows = await api.get('/api/admin/team'); D.team = Array.isArray(rows) ? rows : D.team;
      paint('[data-block="team"]', teamCard());
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  resend: async (el) => {
    try { await api.post('/api/admin/team/invite/resend', { email: el.dataset.email }); ui.toast('INVITE RESENT WITH A FRESH TEMPORARY PASSWORD'); }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  permsToggle: (el) => { const id = el.dataset.id; st.permsOpen = st.permsOpen === id ? null : id; st.revokeConfirm = null; paint('[data-block="team"]', teamCard()); },
  permTg: (el) => {
    const m = D.team.find(x => x.id === el.dataset.id); if (!m) return;
    if (Number(m.is_founder)) { ui.toast(COPY.team.founderAll); return; }
    const sec = el.dataset.sec;
    const cur = m.allowed_sections === null ? PERMISSION_SECTIONS.map(s => s.id) : (m.allowed_sections || []).slice();
    const next = cur.includes(sec) ? cur.filter(s => s !== sec) : cur.concat([sec]);
    saveSections(m, next);
  },
  permFull: (el) => {
    const m = D.team.find(x => x.id === el.dataset.id); if (!m) return;
    if (Number(m.is_founder)) { ui.toast(COPY.team.founderAll); return; }
    saveSections(m, m.allowed_sections === null ? [] : null);
  },
  revoke: async (el) => {
    const m = D.team.find(x => x.id === el.dataset.id); if (!m) return;
    if (Number(m.is_founder)) { ui.toast(COPY.team.founderAll); return; }
    if (m.email === (session.user || {}).email) { ui.toast(COPY.team.selfNo); return; }
    if (st.revokeConfirm !== m.id) { st.revokeConfirm = m.id; paint('[data-block="team"]', teamCard()); return; }
    try {
      await api.post('/api/admin/team/revoke', { email: m.email });
      st.revokeConfirm = null; st.permsOpen = null;
      const rows = await api.get('/api/admin/team'); D.team = Array.isArray(rows) ? rows : D.team.filter(x => x.id !== m.id);
      paint('[data-block="team"]', teamCard());
      ui.toast(COPY.team.removed);
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  teamAll: () => { st.teamAll = !st.teamAll; paint('[data-block="team"]', teamCard()); },
  orgSave: async (el) => {
    const v = r => (rootEl.querySelector(`[data-role="${r}"]`) || {}).value || '';
    el.setAttribute('aria-disabled', 'true');
    try {
      await api.put('/api/v2/settings/org', { oib: v('orgOib'), iban: v('orgIban'), fira_key: v('orgFira') });
      D.org = { oib: v('orgOib'), iban: v('orgIban'), fira_key: v('orgFira') };
      st.orgSaved = true;
      paint('[data-block="org"]', orgCard());
      ui.toast('SAVED — THE WHOLE TEAM SEES THE SAME DETAILS');
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  auditToggle: () => { st.auditAll = !st.auditAll; paint('[data-block="audit"]', auditCard()); },
  libOpen: async (el) => {
    try {
      const res = await fetch(api.url('/api/admin/files/' + encodeURIComponent(el.dataset.id) + '/download'), { headers: { Authorization: 'Bearer ' + session.token } });
      if (!res.ok) throw new Error('Could not open the file (' + res.status + ')');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = el.dataset.name || 'file'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  }
};

export default {
  title: 'Settings & tools',
  async render(root, ctx) {
    rootEl = root;
    if (!document.getElementById('mx-css-settings')) {
      const l = document.createElement('link'); l.id = 'mx-css-settings'; l.rel = 'stylesheet'; l.href = '/css/views/settings.css'; document.head.appendChild(l);
    }
    st = { running: false, inviteOpen: false, invEmail: '', invRole: 'ADMIN', permsOpen: null, revokeConfirm: null, teamAll: false, auditAll: false, auditFilter: '', orgSaved: false };
    D = await load();
    if (rootEl !== root) return;
    root.innerHTML = template();
    unbind = ui.bind(root, handlers);
    wireInputs();
    off = state.subscribe((s, keys) => { if (keys.includes('health') && rootEl) paint('[data-block="health"]', healthCard()); });
    health.refresh({ force: !state.get().health });
    const anchors = { health: '#health', team: '#team', org: '#org', audit: '#audit', library: '#library' };
    const a = anchors[ctx.params.tab];
    if (a) { const t = root.querySelector(a); if (t) t.scrollIntoView({ block: 'start' }); }
  },
  destroy() { if (unbind) unbind(); unbind = null; if (off) off(); off = null; rootEl = null; D = null; st = null; }
};
