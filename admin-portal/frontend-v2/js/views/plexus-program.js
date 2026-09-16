// js/views/plexus-program.js — the Plexus Week hub's PROGRAM & TICKETS tab.
//
// "Your Plexus Week 2026 program & ticket": the ONE email every existing Zagreb registrant gets
// in November — program PDF attached, final venues, their ticket with Apple · Google · calendar.
// Built 2026-09-15, sent later by the team; nothing here is automatic. The member portal owns the
// rows, the marker and the PDF (user-portal/backend/plexus-program.js); this screen presses its
// buttons through admin-portal/backend/v2/plexus-program-ops.js — the Boston card's pattern.
//
// Same host contract as plexus-awards.js: plexus.js hands us paint/paintPart/rootEl/readOnly once
// per render, delegates one tab branch and merges the handler map. Permission section `plexus`
// (whoever runs the week sends it) — server.js maps /api/v2/plexus-program to it.
import { api } from '../api.js';
import { session } from '../state.js';
import { ui, esc, fmt } from '../ui.js';
import { perms } from '../perms.js';

export const PG_SECTION = 'plexus';

// ---- COPY ----------------------------------------------------------------------------------------
export const COPY_PG = {
  title: 'PROGRAM & TICKETS',
  sub: 'one email per registrant — program PDF, final venues, their ticket, Apple · Google · calendar. Sent in November, by hand, from here.',
  err: 'The program panel could not be read.',
  stats: { eligible: 'ELIGIBLE', sent: 'SENT', paid: 'GALA PAID', unpaid: 'GALA UNPAID', free: 'FREE EVENTS ONLY',
    skipped: (h, c, u) => `never emailed: ${h} held · ${c} cancelled · ${u} gala-only unpaid` },
  program: {
    title: 'THE PROGRAM PDF', none: 'Not uploaded yet — sends stay locked until it is here. Previews work without it.',
    present: (size, at) => `On file · ${fmt.bytes ? fmt.bytes(size) : Math.round(size / 1024) + ' KB'}${at ? ' · uploaded ' + String(at).slice(0, 10) : ''}`,
    choose: 'CHOOSE PDF', upload: 'UPLOAD', replace: 'REPLACE', uploading: 'UPLOADING…', uploaded: 'Program PDF is on file.'
  },
  settings: {
    title: 'WHAT THE EMAIL SAYS', hint: 'Leave a field empty to keep the default wording ("to be confirmed"). Saved instantly to the member portal.',
    confVenue: 'Conference venue', confDate: 'Conference date', bbDate: 'Building Bridges Zagreb date', bbTime: 'time', bbVenue: 'Building Bridges Zagreb venue',
    save: 'SAVE', saved: 'Saved — the email and the passes read the new facts.'
  },
  actions: {
    preview: 'PREVIEW TO ME (3 SHAPES)', previewing: 'SENDING…',
    previewDone: to => `Three previews are on their way to ${to} — paid, unpaid gala, free only.`,
    sendAll: n => `SEND TO EVERYONE NOT YET SENT (${n})`, sendAllLocked: 'Upload the program PDF to unlock sending',
    confirmTitle: n => `Send the program & ticket email to ${n} registrant${n === 1 ? '' : 's'}?`,
    confirmBody: 'Each person gets ONE email with the program PDF and their ticket; guests with an email get their copy. Already-sent rows are skipped. This cannot be recalled.',
    confirmOk: 'SEND NOW',
    sentAll: (n, g, f) => `Sent to ${n}${g ? ` (+${g} guest copies)` : ''}${f ? ` · ${f} failed — see the table` : ''}.`,
    sendOne: 'SEND', resend: 'RESEND', sentOne: e => `Sent to ${e}.`,
    refresh: 'REFRESH'
  },
  table: {
    title: 'REGISTRANTS', empty: 'No Zagreb registrations yet.',
    filters: { all: 'ALL', unsent: 'NOT YET SENT', sent: 'SENT', paid: 'GALA PAID', 'unpaid-gala': 'GALA UNPAID', free: 'FREE ONLY', skipped: 'NEVER EMAILED' },
    cols: { who: 'REGISTRANT', inst: 'INSTITUTION', state: 'STATE', legs: 'EVENTS', party: 'PARTY', inv: 'REF', sent: 'SENT', acts: '' },
    state: { paid: 'GALA PAID', 'unpaid-gala': 'GALA UNPAID', free: 'FREE ONLY', held: 'HELD · REVIEW', cancelled: 'CANCELLED', 'unpaid-only': 'GALA ONLY · UNPAID' },
    legs: { conference: 'Conference', bridges: 'Bridges', gala: 'Gala' },
    notSendable: 'This registration is never emailed by this tool.'
  }
};

// ---- shared inline vocabulary (the hub's) --------------------------------------------------------
const HAIR = 'rgba(32,27,22,.14)', HAIR12 = 'rgba(32,27,22,.12)', HAIR07 = 'rgba(32,27,22,.07)';
const MICRO = 'font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#6d6459';
const BTN_GHOST = 'padding:7px 11px;border:1px solid rgba(32,27,22,.2);font:600 9px Inter,sans-serif;letter-spacing:.12em;cursor:pointer;color:#201b16;white-space:nowrap;background:#fff';
const BTN_SOLID = 'padding:9px 14px;border:1px solid #201b16;background:#201b16;color:#f6f2ea;font:600 9px Inter,sans-serif;letter-spacing:.14em;cursor:pointer;white-space:nowrap';
const BTN_OFF = 'padding:9px 14px;border:1px solid rgba(32,27,22,.2);background:#f6f2ea;color:#9a9083;font:600 9px Inter,sans-serif;letter-spacing:.14em;cursor:not-allowed;white-space:nowrap';
const INPUT = 'border:1px solid rgba(32,27,22,.25);background:#fff;padding:8px 10px;font:400 12.5px Inter,sans-serif;color:#201b16;width:100%;box-sizing:border-box';
const td = (v, extra) => `<td style="font-size:12.5px;padding:9px 10px;border-bottom:1px solid ${HAIR07};vertical-align:top;${extra || ''}">${v}</td>`;
const pill = (t, bg, fg) => `<span style="display:inline-block;padding:3px 8px;border-radius:2px;background:${bg};color:${fg};font:600 9px Inter,sans-serif;letter-spacing:.1em;white-space:nowrap">${t}</span>`;
const STATE_PILL = {
  paid: ['#e6f1e8', '#1f5c2e'], 'unpaid-gala': ['#fbf1d9', '#7a5a0b'], free: ['#e9eef6', '#28466f'],
  held: ['#fbe4e4', '#9b1b22'], cancelled: ['#eee9e1', '#6d6459'], 'unpaid-only': ['#fbf1d9', '#7a5a0b']
};
const SENDABLE = ['paid', 'unpaid-gala', 'free'];

// ---- state ---------------------------------------------------------------------------------------
let H = null, P = null, S = null;
export function initProgram(host) { H = host; S = { busy: null, filter: 'all', file: null }; }
export function setProgramData(d) { P = d || null; }
export const canProgram = () => perms.can(PG_SECTION);
const opsUrl = tail => '/api/v2/plexus-program' + (tail || '');
const readOnly = () => !!(H && H.readOnly && H.readOnly());
const counts = () => (P && P.counts) || {};
const rows = () => (P && Array.isArray(P.rows)) ? P.rows : [];
const program = () => (P && P.program) || {};
const settings = () => (P && P.settings) || {};

// ---- data ----------------------------------------------------------------------------------------
export function loadProgram() { return api.get(opsUrl('')); }
async function reload() {
  try { P = await loadProgram(); } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  paintAll();
}
function paintAll() { if (H && H.paint) H.paint(); }
function paintBody() { if (H && H.paintPart) H.paintPart('[data-block="pgBody"]', blockBody()); }

// ================================================================ BLOCKS
function blockStats() {
  const c = counts(), t = COPY_PG.stats;
  const cell = (k, v, sub, last) => `
        <div style="padding:16px 20px;${last ? '' : 'border-right:1px solid rgba(32,27,22,.1)'}">
          <div style="font:600 9px Inter,sans-serif;letter-spacing:.15em;color:#6d6459">${k}</div>
          <div class="mx-display-30" style="font-family:Fraunces,serif;font-size:30px;margin-top:3px">${esc(v == null ? '—' : v)}</div>
          <div style="font-size:11px;color:#6d6459">${esc(sub || '')}</div>
        </div>`;
  return `
    <!-- v2: "PROGRAM & TICKETS — stat strip" -->
    <div data-block="pgStats" style="border:1px solid ${HAIR};background:#fff;margin-top:22px">
      <div class="mx-kpi" style="display:grid;grid-template-columns:repeat(5,1fr)">
        ${cell(t.eligible, c.eligible, t.skipped(c.skipped_held || 0, c.skipped_cancelled || 0, c.skipped_unpaid_gala_only || 0))}
        ${cell(t.sent, c.sent, `${c.unsent == null ? '' : c.unsent + ' still to send'}`)}
        ${cell(t.paid, c.paid, 'combined ticket')}
        ${cell(t.unpaid, c.unpaid_gala, 'free-events ticket + pay button')}
        ${cell(t.free, c.free, 'free-events ticket', true)}
      </div>
    </div>`;
}

function blockProgramCard() {
  const p = program(), s = settings(), c = COPY_PG, ro = readOnly();
  const uploading = S.busy === 'upload';
  const facts = (P && P.facts) || {};
  const factLine = (leg) => facts[leg] ? `${esc(facts[leg].when || '')}${facts[leg].venue ? ' · ' + esc(facts[leg].venue) : ''}` : '';
  const inp = (role, label, value, type, extra) => `
        <label style="display:block">
          <div style="${MICRO};margin-bottom:5px">${label}</div>
          <input data-role="${role}" type="${type || 'text'}" value="${esc(value || '')}" style="${INPUT}${extra || ''}"${ro ? ' disabled' : ''}>
        </label>`;
  return `
    <div data-block="pgProgram" style="display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:18px">
      <div style="border:1px solid ${HAIR};background:#fff">
        <div style="padding:14px 20px;border-bottom:1px solid ${HAIR12}"><span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${c.program.title}</span></div>
        <div style="padding:18px 20px">
          <div style="font-size:12.5px;line-height:1.6;color:${p.present ? '#1f5c2e' : '#9b1b22'}">${p.present ? esc(c.program.present(p.size || 0, p.uploaded_at)) : esc(c.program.none)}</div>
          ${p.configured === false ? `<div style="font-size:11.5px;color:#9b1b22;margin-top:6px">File storage is not configured on the member portal.</div>` : ''}
          ${ro ? '' : `
          <div style="display:flex;gap:10px;align-items:center;margin-top:14px;flex-wrap:wrap">
            <input data-role="pgFile" type="file" accept="application/pdf,.pdf" style="font:400 12px Inter,sans-serif;max-width:100%">
            <span data-act="pgUpload" style="${uploading ? BTN_OFF : BTN_SOLID}">${uploading ? c.program.uploading : (p.present ? c.program.replace : c.program.upload)}</span>
          </div>`}
        </div>
      </div>
      <div style="border:1px solid ${HAIR};background:#fff">
        <div style="padding:14px 20px;border-bottom:1px solid ${HAIR12};display:flex;justify-content:space-between;align-items:center">
          <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${c.settings.title}</span>
          ${ro ? '' : `<span data-act="pgSaveSettings" style="${S.busy === 'settings' ? BTN_OFF : BTN_GHOST}">${c.settings.save}</span>`}
        </div>
        <div style="padding:16px 20px;display:grid;grid-template-columns:1fr 1fr;gap:12px">
          ${inp('pgConfVenue', c.settings.confVenue, s.conference_venue)}
          ${inp('pgConfDate', c.settings.confDate, s.conference_start_date, 'date')}
          ${inp('pgBbVenue', c.settings.bbVenue, s.bridges_zagreb_venue)}
          <div style="display:grid;grid-template-columns:1fr 90px;gap:8px">
            ${inp('pgBbDate', c.settings.bbDate, s.bridges_zagreb_date, 'date')}
            ${inp('pgBbTime', c.settings.bbTime, s.bridges_zagreb_time, 'time')}
          </div>
          <div style="grid-column:1/-1;font-size:11px;color:#6d6459;line-height:1.6">
            ${c.settings.hint}<br>
            <b>Conference:</b> ${factLine('conference')} &nbsp;·&nbsp; <b>Bridges Zagreb:</b> ${factLine('bridges')} &nbsp;·&nbsp; <b>Gala:</b> ${factLine('gala')}
          </div>
        </div>
      </div>
    </div>`;
}

function blockActions() {
  const c = COPY_PG.actions, n = Number(counts().unsent) || 0, ready = !!program().present, ro = readOnly();
  return `
    <div data-block="pgActions" style="display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-top:18px;padding:14px 20px;border:1px solid ${HAIR};background:#f6f2ea">
      <div style="font-size:12px;color:#6d6459;line-height:1.5">${COPY_PG.sub}</div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <span data-act="pgRefresh" style="${BTN_GHOST}">${c.refresh}</span>
        <span data-act="pgPreview" style="${S.busy === 'preview' ? BTN_OFF : BTN_GHOST}">${S.busy === 'preview' ? c.previewing : c.preview}</span>
        ${ro ? '' : (ready && n > 0
          ? `<span data-act="pgSendAll" style="${S.busy === 'all' ? BTN_OFF : BTN_SOLID}">${c.sendAll(n)}</span>`
          : `<span title="${esc(ready ? '' : c.sendAllLocked)}" style="${BTN_OFF}">${c.sendAll(n)}</span>`)}
      </div>
    </div>`;
}

function filtered() {
  const f = S.filter, all = rows();
  if (f === 'all') return all;
  if (f === 'unsent') return all.filter(r => SENDABLE.includes(r.state) && !r.sent);
  if (f === 'sent') return all.filter(r => r.sent);
  if (f === 'skipped') return all.filter(r => !SENDABLE.includes(r.state));
  return all.filter(r => r.state === f);
}

function blockBody() {
  const t = COPY_PG.table, list = filtered(), ready = !!program().present, ro = readOnly();
  const chips = Object.keys(t.filters).map(k => `<span data-act="pgFilter" data-id="${k}" style="${BTN_GHOST};${S.filter === k ? 'background:#201b16;color:#f6f2ea;border-color:#201b16' : ''}">${t.filters[k]}</span>`).join('');
  const legsOf = r => (Array.isArray(r.legs) ? r.legs : []).map(l => t.legs[l] || l).join(' · ');
  const body = list.map(r => {
    const [bg, fg] = STATE_PILL[r.state] || ['#eee9e1', '#6d6459'];
    const sendable = SENDABLE.includes(r.state);
    const act = ro ? '' : (sendable
      ? (ready ? `<span data-act="pgSendOne" data-id="${esc(r.id)}" style="${BTN_GHOST}">${r.sent ? COPY_PG.actions.resend : COPY_PG.actions.sendOne}</span>`
               : `<span title="${esc(COPY_PG.actions.sendAllLocked)}" style="${BTN_GHOST};opacity:.45;cursor:not-allowed">${COPY_PG.actions.sendOne}</span>`)
      : `<span title="${esc(t.notSendable)}" style="font-size:11px;color:#9a9083">—</span>`);
    return `<tr>
      ${td(`<div style="font-weight:600">${esc(r.name || '—')}</div><div style="font-size:11.5px;color:#6d6459">${esc(r.email || '')}</div>`)}
      ${td(`<div>${esc(r.institution || '')}</div><div style="font-size:11px;color:#6d6459">${esc(r.country || '')}</div>`)}
      ${td(pill(t.state[r.state] || esc(r.state), bg, fg))}
      ${td(esc(legsOf(r)))}
      ${td(r.party > 1 ? `${r.party} <span style="font-size:10px;color:#6d6459">seats</span>` : '1', 'white-space:nowrap')}
      ${td(esc(r.invoice || ''), 'white-space:nowrap;font-family:Inter,sans-serif;font-size:11.5px')}
      ${td(r.sent ? `<span style="color:#1f5c2e">✓ ${esc(r.sent_at || '')}</span>` : '<span style="color:#9a9083">—</span>', 'white-space:nowrap')}
      ${td(`<span style="display:flex;justify-content:flex-end">${act}</span>`, 'text-align:right;white-space:nowrap')}
    </tr>`;
  }).join('');
  return `
    <div data-block="pgBody" style="border:1px solid ${HAIR};background:#fff;margin-top:18px">
      <div style="padding:14px 20px;border-bottom:1px solid ${HAIR12};display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${t.title} · ${list.length}</span>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${chips}</div>
      </div>
      ${list.length ? `
      <div class="mxp-scroll" style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;min-width:980px">
          <thead><tr>${[t.cols.who, t.cols.inst, t.cols.state, t.cols.legs, t.cols.party, t.cols.inv, t.cols.sent, t.cols.acts].map(h => `<th style="text-align:left;padding:9px 10px;${MICRO};border-bottom:1px solid ${HAIR12};white-space:nowrap">${h}</th>`).join('')}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>` : `<div style="padding:22px 20px;font-size:12.5px;color:#6d6459">${t.empty}</div>`}
    </div>`;
}

export function blockProgram(error) {
  const head = `<div style="padding:14px 20px;border-bottom:1px solid ${HAIR12}"><span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${COPY_PG.title}</span></div>`;
  if (!canProgram()) {
    return `<div data-block="pgBody" style="border:1px solid ${HAIR};background:#fff;margin-top:22px">${head}<div style="padding:10px 0">${ui.lockedBlock(perms.label(PG_SECTION))}</div></div>`;
  }
  if (error || !P) {
    const msg = error ? (error.isLocked ? ui.lockedBlock(perms.label(error.section)) : `<div style="padding:16px 20px;font-size:12.5px;color:#9b1b22">${esc(error.message || COPY_PG.err)}</div>`) : `<div style="padding:16px 20px;font-size:12.5px;color:#9b1b22">${COPY_PG.err}</div>`;
    return `<div data-block="pgBody" style="border:1px solid ${HAIR};background:#fff;margin-top:22px">${head}<div style="padding:10px 0">${msg}</div><div style="padding:0 20px 16px"><span data-act="pgRefresh" style="${BTN_GHOST}">${COPY_PG.actions.refresh}</span></div></div>`;
  }
  return `${blockStats()}${blockProgramCard()}${blockActions()}${blockBody()}`;
}

// ================================================================ HANDLERS
const val = role => { const el = H && H.rootEl && H.rootEl() && H.rootEl().querySelector(`[data-role="${role}"]`); return el ? String(el.value || '').trim() : ''; };
const fileEl = () => H && H.rootEl && H.rootEl() && H.rootEl().querySelector('[data-role="pgFile"]');

/** Read-only-safe: everything that only looks or only mails the admin. */
export const PG_RO_SAFE = ['pgFilter', 'pgRefresh', 'pgPreview'];

export const programHandlers = {
  pgFilter(el) { S.filter = el.dataset.id || 'all'; paintBody(); },
  async pgRefresh() { await reload(); },

  async pgUpload() {
    if (S.busy) return;
    const input = fileEl();
    const f = input && input.files && input.files[0];
    if (!f) { ui.toast(COPY_PG.program.choose + ' first.'); return; }
    if (!/\.pdf$/i.test(f.name)) { ui.toast('PDF only, please.', { kind: 'error' }); return; }
    S.busy = 'upload'; paintAll();
    try {
      const fd = new FormData(); fd.append('file', f, f.name);
      const res = await fetch(api.url(opsUrl('/program')), { method: 'POST', headers: { Authorization: 'Bearer ' + session.token }, body: fd });
      let j = null; try { j = await res.json(); } catch (e) { j = null; }
      if (!res.ok) throw new Error((j && (j.error || j.message)) || ('Upload failed (HTTP ' + res.status + ').'));
      ui.toast(COPY_PG.program.uploaded);
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
    S.busy = null;
    await reload();
  },

  async pgSaveSettings() {
    if (S.busy) return;
    S.busy = 'settings'; paintAll();
    try {
      const out = await api.put(opsUrl('/settings'), {
        conference_venue: val('pgConfVenue'), conference_start_date: val('pgConfDate'),
        bridges_zagreb_venue: val('pgBbVenue'), bridges_zagreb_date: val('pgBbDate'), bridges_zagreb_time: val('pgBbTime')
      });
      if (P && out) { P.settings = out.settings || P.settings; P.facts = out.facts || P.facts; }
      ui.toast(COPY_PG.settings.saved);
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
    S.busy = null; paintAll();
  },

  async pgPreview() {
    if (S.busy) return;
    S.busy = 'preview'; paintAll();
    try {
      const out = await api.post(opsUrl('/send'), { to: 'preview' });
      ui.toast(COPY_PG.actions.previewDone(out.preview_to || 'you'));
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
    S.busy = null; paintAll();
  },

  async pgSendAll() {
    if (S.busy || readOnly()) return;
    const n = Number(counts().unsent) || 0;
    if (!n || !program().present) { ui.toast(COPY_PG.actions.sendAllLocked, { kind: 'error' }); return; }
    const ok = await ui.confirm({ eyebrow: 'PROGRAM & TICKETS', title: COPY_PG.actions.confirmTitle(n), body: COPY_PG.actions.confirmBody, ok: COPY_PG.actions.confirmOk });
    if (!ok) return;
    S.busy = 'all'; paintAll();
    try {
      const out = await api.post(opsUrl('/send'), { to: 'all' });
      ui.toast(COPY_PG.actions.sentAll((out.sent || []).length, out.guests || 0, (out.failed || []).length));
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
    S.busy = null;
    await reload();
  },

  async pgSendOne(el) {
    if (S.busy || readOnly()) return;
    const id = el.dataset.id;
    const r = rows().find(x => String(x.id) === String(id));
    if (!r) return;
    if (!program().present) { ui.toast(COPY_PG.actions.sendAllLocked, { kind: 'error' }); return; }
    if (r.sent) {
      const ok = await ui.confirm({ eyebrow: 'PROGRAM & TICKETS', title: `Send it again to ${r.name || r.email}?`, body: 'They already received this email once; a second copy goes out with the same content.', ok: COPY_PG.actions.resend });
      if (!ok) return;
    }
    S.busy = 'one:' + id; paintBody();
    try {
      const out = await api.post(opsUrl('/send'), { to: id });
      if (out && Array.isArray(out.failed) && out.failed.length) throw new Error(out.failed[0].error || 'The email provider rejected the send.');
      ui.toast(COPY_PG.actions.sentOne(r.email));
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
    S.busy = null;
    await reload();
  }
};

export default { PG_SECTION, COPY_PG, initProgram, setProgramData, loadProgram, blockProgram, programHandlers, PG_RO_SAFE, canProgram };
