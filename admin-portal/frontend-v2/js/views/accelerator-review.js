// Source: Admin Accelerator Review.dc.html — the REVIEW ROOM (/accelerator-review), README note 19.
// Blocks (artboard order): "Sub-nav" › "Title row" › applications stream (per-app card with the
// expandable APPLICANT FILE drawer + DECISION column + per-criteria 0–5 scoring row) › dashed note ›
// "SCORING CRITERIA" › "INTERVIEWS" › match note. v2 additions (marked data-v2): status filter chips
// (statuses are doors), the RANKING card + CSV export feeding the institution match, interviewer
// email field (send-link needs an address) and per-interviewer remove.
// Real data: applications stream in from the member wizard (accelerator_applications — program_id is
// set on create, so year-scoped admin lists see them); scores are per-reviewer (v2_accel_scores,
// averaged; the average is mirrored into the legacy evaluate-batch route so total_score/ranking/PDF
// stay truthful); SEND INTERVIEW LINK and ACCEPT/DECLINE queue in the scheduled_emails outbox —
// nothing emails anyone without an approval on /inbox/outbox.
import { api } from '../api.js';
import { ui, esc } from '../ui.js';
import { session } from '../state.js';
import { FACTS } from '../facts.js';
import cfg from '../config.js';

export const SOURCE = 'Admin Accelerator Review.dc.html';

export const COPY = {
  back: '← ACCELERATOR',
  title: y => `The <i>Review Room</i> — Cohort ${y}`,
  tag: n => n === 1 ? '1 APPLICATION' : `${n} APPLICATIONS`, tagZero: 'AWAITING FIRST APPLICATIONS',
  sub: 'Applications land here the moment someone submits the wizard — score, interview, rank, place. Every change saves for the whole team.',
  export: 'EXPORT RANKING (CSV)', exported: 'RANKING EXPORTED · CSV', exportEmpty: 'NOTHING TO EXPORT YET — THE STREAM IS EMPTY',
  file: { open: 'OPEN FILE →', close: 'CLOSE FILE', loading: 'OPENING THE FILE…' },
  stageTitle: 'Open the file — scoring and decisions live inside',
  app: { label: 'THE APPLICATION', project: 'Project, in one line:', why: 'Why the Accelerator:', prefs: 'Host preferences:' },
  decision: {
    label: 'DECISION', accept: 'ACCEPT → OFFER', accepted: '✓ ACCEPTED', decline: 'DECLINE', declineSure: 'SURE? DECLINE', declined: '✓ DECLINED',
    caption: 'Accepting queues the offer email + paperwork in the Outbox · declining queues a kind no — both wait for your OK.',
    notePh: 'Private reviewer note — the team sees it, the applicant never does',
    acceptToast: 'ACCEPTED — OFFER + PAPERWORK QUEUED IN THE OUTBOX',
    declineToast: 'DECLINED — A KIND NO QUEUED IN THE OUTBOX',
    undone: 'DECISION UNDONE — THE QUEUED LETTER WAS CANCELLED',
    noteSaved: 'NOTE SAVED — TEAM-VISIBLE, NEVER THE APPLICANT'
  },
  score: { total: 'TOTAL', of: '/ 5', reviewers: n => n === 1 ? '1 reviewer' : `${n} reviewers`, saved: 'SCORE SAVED — TEAM AVERAGE UPDATED', bad: 'SCORES RUN 0–5' },
  send: {
    idle: 'SEND INTERVIEW LINK', sent: '✓ INTERVIEW LINK SENT', booked: '✓ INTERVIEW BOOKED',
    modalTitle: 'Send the interview link?',
    modalBody: (a, n) => `<span style="font-size:13px;line-height:1.6;color:#4a4239"><b>${a}</b> gets a booking link; the interviewer gets a note with their evaluation access. ${n > 1 ? 'Pick who interviews:' : 'Both emails <b>queue in the Outbox</b> — nothing sends until you approve there.'}</span>`,
    ok: 'QUEUE BOTH EMAILS', cancel: 'NOT NOW',
    toast: 'QUEUED IN THE OUTBOX — BOOKING LINK FOR THE APPLICANT + A NOTE TO THE INTERVIEWER',
    already: 'ALREADY QUEUED FOR THIS APPLICANT — APPROVE IT ON THE INBOX › OUTBOX TAB',
    none: 'ADD AN INTERVIEWER FIRST — RIGHT COLUMN, WITH THEIR EMAIL'
  },
  note: 'Applications stream in from the member wizard automatically. Scores are per-reviewer and averaged; the ranking updates live.',
  empty: { line: 'No applications yet.', why: opens => `The wizard opens to members on ${opens} — the moment someone submits, their file appears here.`, cta: 'SEE THE MEMBER SIDE ↗' },
  crit: {
    title: 'SCORING CRITERIA', tag: 'yours to define', placeholder: 'Add a criterion — e.g. English fluency', add: 'ADD',
    note: 'Scale is 0–5 · every applicant is scored on every criterion.',
    added: 'CRITERION ADDED — EVERY APPLICANT GETS A CELL FOR IT', renamed: 'CRITERION RENAMED — SCORES STAY ATTACHED',
    removed: 'CRITERION REMOVED FROM THE RUBRIC', needName: 'TYPE THE CRITERION FIRST'
  },
  int: {
    title: 'INTERVIEWS',
    quote: '“Send interview link” emails the applicant a booking link and notifies the interviewer — you never leave this page.',
    addToggle: '+ ADD INTERVIEWER', namePh: 'Name — e.g. Dr. Ana Beriš', emailPh: 'Email — the magic link goes there', add: 'ADD',
    added: 'INTERVIEWER ADDED — THEY GET THEIR ACCESS LINK WITH THE FIRST INTERVIEW', removed: 'INTERVIEWER REMOVED FROM THE ROSTER',
    needBoth: 'NAME AND EMAIL — THE LINK NEEDS AN ADDRESS', slots: 'GETS THE LINK PER INTERVIEW'
  },
  match: h => `Ranked fellows are matched to the <a href="/projects/accelerator">host institutions</a> by preference and spots — the match proposal appears here after ranking.`,
  rank: { title: 'RANKING — LIVE', tag: 'feeds the institution match', export: 'EXPORT CSV', empty: 'Scores rank the cohort here the moment the first one lands.', cols: { rank: 'RANK', name: 'APPLICANT', uni: 'UNIVERSITY', choice: 'HOST CHOICE', avg: 'AVG' } },
  filters: [['', 'ALL'], ['submitted', 'NEW'], ['under_review', 'IN REVIEW'], ['interview', 'INTERVIEW'], ['accepted', 'ACCEPTED'], ['rejected', 'DECLINED']],
  program: {
    line: 'No accelerator program for this cycle yet.', why: 'The Review Room hangs off a program year — create it and the wizard, criteria and ranking all attach to it.',
    cta: y => `CREATE THE ${y} PROGRAM`, created: y => `PROGRAM ${y} CREATED — THE ROOM IS LIVE`
  },
  docFail: 'THAT DOCUMENT DID NOT DOWNLOAD — TRY AGAIN'
};

const STAGES = {
  new: { label: 'NEW', bg: '#eee9df', fg: '#4a4239' },
  review: { label: 'IN REVIEW', bg: '#eee9df', fg: '#4a4239' },
  scored: { label: 'SCORED', bg: '#f8f1e2', fg: '#7a6432' },
  interview: { label: 'INTERVIEW', bg: '#e8eef7', fg: '#2c4a73' },
  accepted: { label: 'ACCEPTED', bg: '#e4efe7', fg: '#22563a' },
  declined: { label: 'DECLINED', bg: '#f5e4e5', fg: '#9b1b22' }
};

let D = null, st = null, rootEl = null, unbind = null, onChange = null, onKey = null;

const YEAR = () => (D && D.program && D.program.year) || FACTS.year;
const myEmail = () => (session.user && session.user.email) || '';

async function load() {
  const program = await api.settle({ program: api.get('/api/accelerator/program') });
  if (!program.program) return { program: null };
  const year = program.program.year;
  const more = await api.settle({
    apps: api.get(`/api/accelerator/years/${year}/applications`),
    criteria: api.get(`/api/accelerator/years/${year}/criteria`),
    interviewers: api.get(`/api/accelerator/years/${year}/interviewers`),
    scores: api.get(`/api/v2/accelerator-review/scores?year=${year}`),
    invites: api.get(`/api/v2/accelerator-review/interview-invites?year=${year}`),
    insts: api.get('/api/accelerator/institutions')
  });
  return Object.assign({ program: program.program }, more);
}

// ---- derived ----
const apps = () => ((D && D.apps) || []).filter(a => a.status !== 'draft');
const crits = () => (D && D.criteria) || [];
const interviewers = () => ((D && D.interviewers) || []).filter(i => i.is_active !== 0);
const invites = () => (D && D.invites && D.invites.invites) || [];
const inviteFor = id => invites().find(v => v.application_id === id && (v.status === 'queued' || v.status === 'booked'));
function scoreCell(appId, critId) {
  const rows = ((D && D.scores && D.scores.scores) || []).filter(s => s.application_id === appId && s.criterion_id === critId);
  const mineRow = rows.find(s => s.reviewer_email === myEmail());
  const n = rows.length;
  const avg = n ? rows.reduce((x, y) => x + Number(y.score || 0), 0) / n : null;
  return { mine: mineRow ? mineRow.score : null, avg, n };
}
function teamAvg(appId) {
  const cs = crits();
  if (!cs.length) return { avg: 0, n: 0 };
  let reviewers = 0;
  const sum = cs.reduce((acc, c) => { const cell = scoreCell(appId, c.id); reviewers = Math.max(reviewers, cell.n); return acc + (cell.avg == null ? 0 : cell.avg); }, 0);
  return { avg: sum / cs.length, n: reviewers };
}
function stageOf(a) {
  if (a.status === 'accepted') return STAGES.accepted;
  if (a.status === 'rejected') return STAGES.declined;
  if (inviteFor(a.id)) return STAGES.interview;
  if (crits().some(c => scoreCell(a.id, c.id).n > 0)) return STAGES.scored;
  if (a.status === 'under_review') return STAGES.review;
  return STAGES.new;
}
function instName(v) {
  if (!v) return null;
  const hit = ((D && D.insts) || []).find(i => i.id === v || i.name === v);
  return hit ? hit.name : v;
}
const initialsOf = name => String(name || '').split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 3).join('').toUpperCase() || '·';
function filtered() {
  const f = st.filter;
  if (!f) return apps();
  if (f === 'interview') return apps().filter(a => !!inviteFor(a.id) && a.status !== 'accepted' && a.status !== 'rejected');
  return apps().filter(a => a.status === f);
}
function ranked() {
  return apps().map(a => ({ a, t: teamAvg(a.id) })).sort((x, y) => y.t.avg - x.t.avg || String(x.a.last_name || '').localeCompare(String(y.a.last_name || '')));
}

// ---------------------------------------------------------------- blocks
function blockSubnav() {
  return `
  <!-- dc: Admin Accelerator Review.dc.html › "Sub-nav" -->
  <div style="background:#fff;border-bottom:1px solid rgba(32,27,22,.14)">
    <div class="mx-subnav mx-gutter" style="max-width:1180px;margin:0 auto;padding:0 28px;height:44px;display:flex;align-items:center;gap:20px">
      <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#6d6459">PROJECTS</span>
      <a href="/projects/plexus" style="font:600 11px Inter,sans-serif;letter-spacing:.13em;color:#6d6459;height:100%;display:flex;align-items:center" data-hover="color:#201b16">PLEXUS WEEK 2026</a>
      <span style="font:600 11px Inter,sans-serif;letter-spacing:.13em;color:#201b16;border-bottom:2px solid #9b1b22;height:100%;display:flex;align-items:center;box-sizing:border-box">ACCELERATOR</span>
      <a href="/projects/forum" style="font:600 11px Inter,sans-serif;letter-spacing:.13em;color:#6d6459;height:100%;display:flex;align-items:center" data-hover="color:#201b16">BIOMEDICAL FORUM</a>
      <a href="/projects/bridges" style="font:600 11px Inter,sans-serif;letter-spacing:.13em;color:#6d6459;height:100%;display:flex;align-items:center" data-hover="color:#201b16">BUILDING BRIDGES</a>
    </div>
  </div>
  <!-- /dc -->`;
}

function blockTitle() {
  const n = apps().length;
  return `
    <!-- dc: Admin Accelerator Review.dc.html › "Title row" -->
    <div style="display:flex;align-items:flex-end;gap:16px;flex-wrap:wrap">
      <div>
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <a href="/projects/accelerator" style="font:600 10px Inter,sans-serif;letter-spacing:.14em;color:#6d6459" data-hover="color:#201b16">${COPY.back}</a>
          <span class="mx-display-30" style="font-family:Fraunces,serif;font-size:30px">${COPY.title(YEAR())}</span>
          <span style="font:600 9px Inter,sans-serif;letter-spacing:.15em;background:#f8f1e2;color:#7a6432;padding:4px 8px">${n ? esc(COPY.tag(n)) : COPY.tagZero}</span>
        </div>
        <div style="font-size:12.5px;color:#6d6459;margin-top:4px">${COPY.sub}</div>
      </div>
      <div style="flex:1"></div>
      <span data-act="export" style="padding:10px 16px;border:1px solid rgba(32,27,22,.25);background:#fff;color:#201b16;font:600 10px Inter,sans-serif;letter-spacing:.14em;white-space:nowrap;cursor:pointer" data-hover="border-color:#201b16">${COPY.export}</span>
    </div>
    <!-- /dc -->`;
}

function blockFilters() {
  const counts = { '': apps().length, submitted: 0, under_review: 0, interview: 0, accepted: 0, rejected: 0 };
  apps().forEach(a => {
    counts[a.status] = (counts[a.status] || 0) + 1;
    if (inviteFor(a.id) && a.status !== 'accepted' && a.status !== 'rejected') counts.interview++;
  });
  return `
    <div data-v2="status-filter" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      ${COPY.filters.map(([k, l]) => {
        const on = (st.filter || '') === k;
        return `<span data-act="filter" data-key="${k}" role="button" style="font:600 8.5px Inter,sans-serif;letter-spacing:.11em;padding:4px 9px;cursor:pointer;white-space:nowrap;background:${on ? '#201b16' : '#eee9df'};color:${on ? '#f6f2ea' : '#4a4239'}" data-hover="color:${on ? '#f6f2ea' : '#201b16'}">${l} ${counts[k] || 0}</span>`;
      }).join('')}
    </div>`;
}

function drawer(a) {
  const file = st.files[a.id];
  if (!file || file === 'loading') {
    return `<div style="border-bottom:1px solid rgba(32,27,22,.08);background:#fdfbf6;padding:16px 18px;font:600 9px Inter,sans-serif;letter-spacing:.15em;color:#6d6459">${COPY.file.loading}</div>`;
  }
  const project = file.research_interests || file.additional_info || '—';
  const why = file.motivation_statement || file.previous_experience || '—';
  const prefs = [instName(file.selected_institution), instName(file.alternative_institution)].filter(Boolean).map((v, i) => `${i + 1}. ${v}`).join(' · ') || '—';
  const docs = file.documents || [];
  const declined = a.status === 'rejected';
  const accepted = a.status === 'accepted';
  return `
              <div class="mxa-drawer" style="display:grid;grid-template-columns:1.4fr 1fr;gap:0;border-bottom:1px solid rgba(32,27,22,.08);background:#fdfbf6">
                <div style="padding:14px 18px;display:flex;flex-direction:column;gap:10px;border-right:1px solid rgba(32,27,22,.08);min-width:0">
                  <span style="font:600 9px Inter,sans-serif;letter-spacing:.15em;color:#6d6459">${COPY.app.label}</span>
                  <span style="font-size:12.5px;line-height:1.6;color:#4a4239"><b style="color:#201b16">${COPY.app.project}</b> ${esc(project)}</span>
                  <span style="font-size:12.5px;line-height:1.6;color:#4a4239"><b style="color:#201b16">${COPY.app.why}</b> ${esc(why)}</span>
                  <span style="font-size:12.5px;line-height:1.6;color:#4a4239"><b style="color:#201b16">${COPY.app.prefs}</b> ${esc(prefs)}</span>
                  <div style="display:flex;gap:8px;flex-wrap:wrap">
                    ${docs.map(d => `<span data-act="doc" data-doc="${esc(d.id)}" data-name="${esc(d.original_filename || d.document_type || 'document')}" style="padding:6px 10px;border:1px solid rgba(32,27,22,.2);font:600 8.5px Inter,sans-serif;letter-spacing:.11em;cursor:pointer;background:#fff" data-hover="border-color:#201b16">⤓ ${esc(String(d.original_filename || d.document_type || 'DOCUMENT').toUpperCase())}</span>`).join('') || '<span style="font-size:11px;color:#6d6459">No documents on file.</span>'}
                  </div>
                </div>
                <div style="padding:14px 18px;display:flex;flex-direction:column;gap:9px;min-width:0">
                  <span style="font:600 9px Inter,sans-serif;letter-spacing:.15em;color:#6d6459">${COPY.decision.label}</span>
                  <div style="display:flex;gap:8px;flex-wrap:wrap">
                    <span data-act="accept" data-id="${esc(a.id)}" style="padding:9px 13px;background:${accepted ? '#1e6e42' : '#201b16'};color:#fff;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer">${accepted ? COPY.decision.accepted : COPY.decision.accept}</span>
                    <span data-act="decline" data-id="${esc(a.id)}" style="padding:9px 13px;border:1px solid rgba(32,27,22,.2);color:${declined || st.declineConfirm === a.id ? '#9b1b22' : '#6d6459'};font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer" data-hover="border-color:#9b1b22">${declined ? COPY.decision.declined : st.declineConfirm === a.id ? COPY.decision.declineSure : COPY.decision.decline}</span>
                  </div>
                  <span style="font-size:11px;color:#6d6459;line-height:1.5">${COPY.decision.caption}</span>
                  <textarea rows="2" data-change="note" data-id="${esc(a.id)}" placeholder="${COPY.decision.notePh}" style="border:1px solid rgba(32,27,22,.25);background:#fff;padding:8px 10px;font:400 12px Inter,sans-serif;color:#201b16;resize:vertical">${esc(file.reviewer_notes || a.reviewer_notes || '')}</textarea>
                </div>
              </div>`;
}

function appCard(a) {
  const name = [a.first_name, a.last_name].filter(Boolean).join(' ') || a.email || 'Applicant';
  const uni = [a.current_institution, a.year_of_study ? 'Y' + String(a.year_of_study).replace(/^y/i, '') : null].filter(Boolean).join(' · ') || a.degree_program || '—';
  const stg = stageOf(a);
  const inv = inviteFor(a.id);
  const t = teamAvg(a.id);
  const open = st.open === a.id;
  return `
          <div class="card" data-row="${esc(a.id)}" style="border:1px solid rgba(32,27,22,.14);background:#fff">
            <div class="mxa-head" style="display:flex;align-items:center;gap:12px;padding:13px 18px;border-bottom:1px solid rgba(32,27,22,.08);flex-wrap:wrap">
              <span style="width:34px;height:34px;flex:none;background:#201b16;color:#c9a962;display:inline-flex;align-items:center;justify-content:center;font:600 12px Fraunces,serif">${esc(initialsOf(name))}</span>
              <span style="min-width:0"><span style="display:block;font-size:14px;font-weight:600">${esc(name)}</span><span style="display:block;font-size:11.5px;color:#6d6459">${esc(uni)}</span></span>
              <div style="flex:1"></div>
              <span data-act="file" data-id="${esc(a.id)}" style="font:600 9px Inter,sans-serif;letter-spacing:.12em;white-space:nowrap;color:#9b1b22;cursor:pointer">${open ? COPY.file.close : COPY.file.open}</span>
              <span data-act="file" data-id="${esc(a.id)}" title="${COPY.stageTitle}" style="font:600 8.5px Inter,sans-serif;letter-spacing:.12em;background:${stg.bg};color:${stg.fg};padding:4px 9px;cursor:pointer;white-space:nowrap">${stg.label}</span>
            </div>
            ${open ? drawer(a) : ''}
            <div class="mxa-scores" style="display:flex;align-items:center;gap:10px 18px;padding:12px 18px;flex-wrap:wrap">
              ${crits().map(c => {
                const cell = scoreCell(a.id, c.id);
                return `<span style="display:flex;align-items:center;gap:7px;white-space:nowrap"><span style="font:600 8.5px Inter,sans-serif;letter-spacing:.11em;color:#6d6459">${esc(String(c.name || '').split(' ')[0].toUpperCase())}</span><input value="${cell.mine == null ? '' : esc(cell.mine)}" placeholder="–" data-change="score" data-app="${esc(a.id)}" data-crit="${esc(c.id)}" title="0–5 · team avg ${cell.avg == null ? '—' : (Math.round(cell.avg * 10) / 10)} · ${COPY.score.reviewers(cell.n)}" style="width:36px;border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:6px 0;font:600 12px Inter,sans-serif;color:#201b16;text-align:center;box-sizing:border-box"></span>`;
              }).join('')}
              <div style="flex:1"></div>
              <span style="display:flex;align-items:baseline;gap:6px;white-space:nowrap" title="${COPY.score.reviewers(t.n)} · averaged per criterion"><span style="font:600 8.5px Inter,sans-serif;letter-spacing:.11em;color:#6d6459">${COPY.score.total}</span><span data-role="total-${esc(a.id)}" style="font-family:Fraunces,serif;font-size:21px;color:#9b1b22">${(Math.round(t.avg * 10) / 10).toFixed(1)}</span><span style="font-size:10.5px;color:#9a9086">${COPY.score.of}</span></span>
              <span data-act="send" data-id="${esc(a.id)}" style="padding:8px 12px;background:${inv ? '#1e6e42' : '#201b16'};color:#fff;font:600 9px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap">${inv ? (inv.status === 'booked' ? COPY.send.booked : COPY.send.sent) : COPY.send.idle}</span>
            </div>
          </div>`;
}

function blockStream() {
  const list = filtered();
  const o = FACTS.accelerator.opensLabel;
  return `
      <div data-block="stream" style="display:flex;flex-direction:column;gap:14px;min-width:0">
        ${blockFilters()}
        ${list.length ? list.map(appCard).join('') : `
        <div style="border:1px dashed rgba(32,27,22,.3);background:transparent">
          <div class="empty" style="padding:34px 22px 36px">
            <span style="width:28px;height:1px;background:#c9a962"></span>
            <span class="empty-line">${COPY.empty.line}</span>
            <span class="empty-why">${esc(COPY.empty.why(o))}</span>
            <a href="${esc(cfg.memberPortalUrl)}/app/accelerator" target="_blank" rel="noopener" style="margin-top:8px;padding:9px 14px;border:1px solid rgba(32,27,22,.2);font:600 10px Inter,sans-serif;letter-spacing:.14em;color:#201b16;white-space:nowrap" data-hover="border-color:#201b16">${COPY.empty.cta}</a>
          </div>
        </div>`}
        ${list.length ? `
        <div style="border:1px dashed rgba(32,27,22,.3);padding:14px 18px;font-size:12px;color:#6d6459;line-height:1.6;background:transparent">
          <!-- dc: Admin Accelerator Review.dc.html › "Dashed note" -->
          ${COPY.note}
          <!-- /dc -->
        </div>` : ''}
      </div>`;
}

function blockCriteria() {
  return `
        <div data-block="crit" style="border:1px solid rgba(32,27,22,.14);border-top:2px solid #c9a962;background:#fff">
          <!-- dc: Admin Accelerator Review.dc.html › "SCORING CRITERIA" -->
          <div style="display:flex;align-items:center;gap:10px;padding:13px 18px;border-bottom:1px solid rgba(32,27,22,.1)"><span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${COPY.crit.title}</span><div style="flex:1"></div><span style="font-size:11px;color:#6d6459">${COPY.crit.tag}</span></div>
          <div style="padding:10px 18px 14px;display:flex;flex-direction:column;gap:8px">
            ${crits().map(c => `
              <div style="display:flex;align-items:center;gap:8px" data-row="${esc(c.id)}">
                <input value="${esc(c.name)}" data-change="critRename" data-id="${esc(c.id)}" style="flex:1;border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:8px 10px;font:400 12.5px Inter,sans-serif;color:#201b16;min-width:0">
                <span data-act="critRemove" data-id="${esc(c.id)}" title="Remove criterion" style="font:600 12px Inter,sans-serif;color:#9a9086;cursor:pointer;padding:4px" data-hover="color:#9b1b22">✕</span>
              </div>`).join('')}
            <div style="display:flex;gap:8px">
              <input data-role="critDraft" placeholder="${COPY.crit.placeholder}" style="flex:1;border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:8px 10px;font:400 12.5px Inter,sans-serif;color:#201b16;min-width:0">
              <span data-act="addCrit" style="padding:8px 12px;background:#9b1b22;color:#fff;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;display:flex;align-items:center" data-hover="background:#7e151b">${COPY.crit.add}</span>
            </div>
            <span style="font-size:11px;color:#6d6459">${COPY.crit.note}</span>
          </div>
          <!-- /dc -->
        </div>`;
}

function blockInterviews() {
  return `
        <div id="interviews" data-block="interviews" style="border:1px solid rgba(32,27,22,.14);background:#fff">
          <!-- dc: Admin Accelerator Review.dc.html › "INTERVIEWS" -->
          <div style="padding:13px 18px;border-bottom:1px solid rgba(32,27,22,.1)"><span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${COPY.int.title}</span></div>
          <div style="padding:12px 18px 16px;display:flex;flex-direction:column;gap:9px;font-size:12.5px;color:#4a4239;line-height:1.55">
            <span>${COPY.int.quote}</span>
            <div style="display:flex;gap:12px;align-items:center;padding:8px 0 0;border-top:1px solid rgba(32,27,22,.08)"></div>
            ${interviewers().map(iv => `
              <div style="display:flex;gap:12px;align-items:center;padding:2px 0" data-row="${esc(iv.id)}">
                <span style="width:26px;height:26px;flex:none;background:#f6f2ea;border:1px solid rgba(32,27,22,.15);display:inline-flex;align-items:center;justify-content:center;font:600 10px Fraunces,serif">${esc(initialsOf(String(iv.name || '').replace(/^(prof\.|dr\.)\s*/i, '')))}</span>
                <span style="flex:1;font-size:12.5px;min-width:0">${esc(iv.name)}${iv.institution || iv.specialty ? `<span style="display:block;font-size:10.5px;color:#6d6459">${esc([iv.institution, iv.specialty].filter(Boolean).join(' · '))}</span>` : ''}</span>
                <span style="font:600 9px Inter,sans-serif;letter-spacing:.1em;color:#6d6459;white-space:nowrap">${COPY.int.slots}</span>
                <span data-act="intRemove" data-id="${esc(iv.id)}" data-v2="int-remove" title="Remove interviewer" style="font:600 12px Inter,sans-serif;color:#9a9086;cursor:pointer;padding:4px" data-hover="color:#9b1b22">✕</span>
              </div>`).join('')}
            <span data-act="intToggle" style="font:600 9px Inter,sans-serif;letter-spacing:.13em;color:#9b1b22;cursor:pointer">${COPY.int.addToggle}</span>
            ${st.intAdd ? `
              <div data-v2="int-email" style="display:flex;gap:8px;flex-wrap:wrap">
                <input data-role="intName" placeholder="${COPY.int.namePh}" style="flex:1;border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:8px 10px;font:400 12px Inter,sans-serif;color:#201b16;min-width:140px">
                <input data-role="intEmail" placeholder="${COPY.int.emailPh}" style="flex:1;border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:8px 10px;font:400 12px Inter,sans-serif;color:#201b16;min-width:140px">
                <span data-act="addInt" style="padding:8px 12px;background:#9b1b22;color:#fff;font:600 9px Inter,sans-serif;letter-spacing:.12em;cursor:pointer;display:flex;align-items:center">${COPY.int.add}</span>
              </div>` : ''}
          </div>
          <!-- /dc -->
        </div>`;
}

function blockRanking() {
  const rows = ranked();
  const cs = crits();
  return `
    <div id="ranking" data-block="ranking" data-v2="ranking-card" style="border:1px solid rgba(32,27,22,.14);background:#fff">
      <!-- v2: RANKING — note 19 "ranking exports CSV and feeds the institution match" -->
      <div style="display:flex;align-items:center;gap:10px;padding:13px 18px;border-bottom:1px solid rgba(32,27,22,.1);flex-wrap:wrap">
        <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${COPY.rank.title}</span>
        <span style="font-size:11px;color:#6d6459">${COPY.rank.tag}</span>
        <div style="flex:1"></div>
        <span data-act="export" style="padding:7px 11px;border:1px solid rgba(32,27,22,.25);font:600 9px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap" data-hover="border-color:#201b16">${COPY.rank.export}</span>
      </div>
      ${rows.length ? `
      <div style="overflow-x:auto">
        <div style="min-width:640px">
          <div style="display:flex;gap:14px;padding:9px 18px;border-bottom:1px solid rgba(32,27,22,.1)">
            <span style="width:36px;font:600 8.5px Inter,sans-serif;letter-spacing:.11em;color:#6d6459">${COPY.rank.cols.rank}</span>
            <span style="flex:1.2;font:600 8.5px Inter,sans-serif;letter-spacing:.11em;color:#6d6459">${COPY.rank.cols.name}</span>
            <span style="flex:1.4;font:600 8.5px Inter,sans-serif;letter-spacing:.11em;color:#6d6459">${COPY.rank.cols.uni}</span>
            <span style="flex:1;font:600 8.5px Inter,sans-serif;letter-spacing:.11em;color:#6d6459">${COPY.rank.cols.choice}</span>
            <span style="width:52px;text-align:right;font:600 8.5px Inter,sans-serif;letter-spacing:.11em;color:#6d6459">${COPY.rank.cols.avg}</span>
            <span style="width:86px"></span>
          </div>
          ${rows.map((r, i) => {
            const stg = stageOf(r.a);
            const name = [r.a.first_name, r.a.last_name].filter(Boolean).join(' ') || r.a.email || 'Applicant';
            return `
            <div style="display:flex;gap:14px;align-items:center;padding:10px 18px;border-bottom:1px solid rgba(32,27,22,.06)">
              <span style="width:36px;font-family:Fraunces,serif;font-size:17px">${i + 1}</span>
              <span data-act="file" data-id="${esc(r.a.id)}" style="flex:1.2;font-size:13px;font-weight:600;color:#201b16;cursor:pointer;min-width:0" data-hover="color:#9b1b22">${esc(name)}</span>
              <span style="flex:1.4;font-size:11.5px;color:#6d6459;min-width:0">${esc(r.a.current_institution || '—')}</span>
              <span style="flex:1;font-size:11.5px;color:#6d6459;min-width:0">${esc(instName(r.a.selected_institution) || '—')}</span>
              <span style="width:52px;text-align:right;font-family:Fraunces,serif;font-size:17px;color:#9b1b22">${(Math.round(r.t.avg * 10) / 10).toFixed(1)}</span>
              <span style="width:86px;text-align:right"><span style="font:600 8.5px Inter,sans-serif;letter-spacing:.1em;background:${stg.bg};color:${stg.fg};padding:3px 7px;white-space:nowrap">${stg.label}</span></span>
            </div>`;
          }).join('')}
        </div>
      </div>` : `<div style="padding:16px 18px;font-size:12px;color:#6d6459">${COPY.rank.empty}</div>`}
    </div>`;
}

function blockMatchNote() {
  return `
        <div style="border:1px solid rgba(32,27,22,.14);background:#fdfbf6;padding:14px 18px;font-size:12px;color:#6d6459;line-height:1.6">
          <!-- dc: Admin Accelerator Review.dc.html › "Match note" -->
          ${COPY.match()}
          <!-- /dc -->
        </div>`;
}

function template() {
  if (!D || !D.program) {
    const y = FACTS.year + 1;
    return `
<div data-screen-label="Admin Accelerator Review" style="min-height:100vh;background:#f6f2ea;color:#201b16;font-family:Inter,sans-serif">
  ${blockSubnav()}
  <div class="mx-gutter" style="max-width:1180px;margin:0 auto;padding:34px 28px 60px">
    <div style="border:1px solid rgba(32,27,22,.14);background:#fff">
      <div class="empty" style="padding:38px 22px 40px">
        <span style="width:28px;height:1px;background:#c9a962"></span>
        <span class="empty-line">${COPY.program.line}</span>
        <span class="empty-why">${COPY.program.why}</span>
        <span data-act="createProgram" data-year="${y}" style="margin-top:8px;padding:9px 14px;background:#9b1b22;color:#fff;font:600 10px Inter,sans-serif;letter-spacing:.14em;cursor:pointer;white-space:nowrap" data-hover="background:#7e151b">${COPY.program.cta(y)}</span>
      </div>
    </div>
  </div>
</div>`;
  }
  return `
<div data-screen-label="Admin Accelerator Review" style="min-height:100vh;background:#f6f2ea;color:#201b16;font-family:Inter,sans-serif">
  ${blockSubnav()}
  <div class="mx-gutter" style="max-width:1180px;margin:0 auto;padding:30px 28px 56px;display:flex;flex-direction:column;gap:22px">
    ${blockTitle()}
    <div class="mx-side" style="display:grid;grid-template-columns:1.55fr 1fr;gap:22px;align-items:start">
      ${blockStream()}
      <div style="display:flex;flex-direction:column;gap:22px;min-width:0">
        ${blockCriteria()}
        ${blockInterviews()}
        ${blockMatchNote()}
      </div>
    </div>
    ${blockRanking()}
  </div>
</div>`;
}

function rerender() { if (rootEl) rootEl.innerHTML = template(); }
const val = role => { const el = rootEl && rootEl.querySelector(`[data-role="${role}"]`); return el ? el.value.trim() : ''; };

function localApp(id) { return ((D && D.apps) || []).find(a => a.id === id); }

async function decide(id, decision) {
  const r = await api.post(`/api/v2/accelerator-review/applications/${id}/decision`, { decision });
  const a = localApp(id);
  if (a) { a.status = r.status; a.decision = decision === 'accepted' ? 'accepted' : 'rejected'; }
  st.declineConfirm = null;
  rerender();
  const toastText = decision === 'accepted' ? COPY.decision.acceptToast : COPY.decision.declineToast;
  ui.toast(r.queued === false && r.warning ? r.warning : toastText, {
    undo: async () => {
      try {
        const u = await api.post(`/api/v2/accelerator-review/applications/${id}/decision/undo`, { prev_status: r.prev_status, prev_decision: r.prev_decision });
        const app2 = localApp(id); if (app2) { app2.status = u.status; app2.decision = r.prev_decision; }
        rerender();
        ui.toast(COPY.decision.undone);
      } catch (e) { ui.toast(e.message, { kind: 'error' }); }
    }
  });
}

async function queueInvite(appId, interviewerId) {
  const r = await api.post(`/api/v2/accelerator-review/applications/${appId}/interview-invite`, { interviewer_id: interviewerId });
  if (r.already) { ui.toast(COPY.send.already); return; }
  D.invites = await api.get(`/api/v2/accelerator-review/interview-invites?year=${YEAR()}`);
  const a = localApp(appId); if (a && a.status === 'submitted') a.status = 'under_review';
  rerender();
  ui.toast(COPY.send.toast);
}

// ---------------------------------------------------------------- handlers
const handlers = {
  createProgram: async (el) => {
    const y = parseInt(el.dataset.year, 10);
    try {
      await api.post('/api/accelerator/years', { year: y, name: `Med&X Accelerator ${y}` });
      D = await load(); rerender();
      ui.toast(COPY.program.created(y));
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  filter: (el) => { st.filter = el.dataset.key || null; rerender(); },
  file: async (el) => {
    const id = el.dataset.id;
    if (st.open === id) { st.open = null; st.declineConfirm = null; rerender(); return; }
    st.open = id; st.declineConfirm = null;
    if (!st.files[id]) {
      st.files[id] = 'loading'; rerender();
      try { st.files[id] = await api.get(`/api/accelerator/applications/${id}/full`); }
      catch (e) { delete st.files[id]; st.open = null; ui.toast(e.message, { kind: 'error' }); }
    }
    rerender();
    const row = rootEl && rootEl.querySelector(`[data-row="${id}"]`); if (row) row.scrollIntoView({ block: 'nearest' });
  },
  doc: async (el) => {
    try {
      const res = await fetch(api.url(`/api/accelerator/documents/${el.dataset.doc}/download`), { headers: { Authorization: 'Bearer ' + session.token } });
      if (!res.ok) throw new Error(COPY.docFail);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = el.dataset.name || 'document'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) { ui.toast(e.message || COPY.docFail, { kind: 'error' }); }
  },
  accept: async (el) => {
    const a = localApp(el.dataset.id); if (!a || a.status === 'accepted') return;
    try { await decide(a.id, 'accepted'); } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  decline: async (el) => {
    const a = localApp(el.dataset.id); if (!a || a.status === 'rejected') return;
    if (st.declineConfirm !== a.id) { st.declineConfirm = a.id; rerender(); return; }
    try { await decide(a.id, 'declined'); } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  send: (el) => {
    const a = localApp(el.dataset.id); if (!a) return;
    if (inviteFor(a.id)) { ui.toast(COPY.send.already); return; }
    const roster = interviewers();
    if (!roster.length) { ui.toast(COPY.send.none, { kind: 'error' }); return; }
    const name = [a.first_name, a.last_name].filter(Boolean).join(' ') || 'the applicant';
    if (roster.length === 1) {
      ui.confirm({ eyebrow: 'INTERVIEW', title: COPY.send.modalTitle, body: COPY.send.modalBody(esc(name) + ' × ' + esc(roster[0].name), 1), ok: COPY.send.ok, cancel: COPY.send.cancel })
        .then(ok => { if (ok) queueInvite(a.id, roster[0].id).catch(e => ui.toast(e.message, { kind: 'error' })); });
      return;
    }
    ui.modal({
      eyebrow: 'INTERVIEW', title: COPY.send.modalTitle, body: COPY.send.modalBody(esc(name), roster.length),
      actions: roster.map(iv => ({ label: String(iv.name || '').toUpperCase().slice(0, 30), kind: 'ink', onClick: () => { queueInvite(a.id, iv.id).catch(e => ui.toast(e.message, { kind: 'error' })); } }))
        .concat([{ label: COPY.send.cancel }])
    });
  },
  export: () => {
    const rows = ranked();
    if (!rows.length) { ui.toast(COPY.exportEmpty, { kind: 'error' }); return; }
    const cs = crits();
    const safe = v => { const s = String(v == null ? '' : v); return '"' + (/^[=+\-@\t\r]/.test(s) ? "'" + s : s).replace(/"/g, '""') + '"'; };
    const header = ['Rank', 'Name', 'University', 'Choice 1', 'Choice 2'].concat(cs.map(c => c.name)).concat(['Average', 'Status']);
    const lines = [header.map(safe).join(',')].concat(rows.map((r, i) => {
      const name = [r.a.first_name, r.a.last_name].filter(Boolean).join(' ') || r.a.email || '';
      const per = cs.map(c => { const cell = scoreCell(r.a.id, c.id); return cell.avg == null ? '' : (Math.round(cell.avg * 100) / 100); });
      return [i + 1, name, r.a.current_institution || '', instName(r.a.selected_institution) || '', instName(r.a.alternative_institution) || '']
        .concat(per).concat([(Math.round(r.t.avg * 100) / 100).toFixed(2), stageOf(r.a).label]).map(safe).join(',');
    }));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const el = document.createElement('a'); el.href = url; el.download = `accelerator-ranking-${YEAR()}.csv`; el.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    ui.toast(COPY.exported);
  },
  addCrit: async () => {
    const name = val('critDraft');
    if (!name) { ui.toast(COPY.crit.needName, { kind: 'error' }); return; }
    try {
      await api.post(`/api/accelerator/years/${YEAR()}/criteria`, { name, max_points: 5, weight: 1, category: 'objective' });
      D.criteria = await api.get(`/api/accelerator/years/${YEAR()}/criteria`);
      rerender();
      ui.toast(COPY.crit.added);
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  critRemove: async (el) => {
    const id = el.dataset.id;
    try {
      await api.del('/api/accelerator/criteria/' + id);
      D.criteria = await api.get(`/api/accelerator/years/${YEAR()}/criteria`);
      rerender();
      ui.toast(COPY.crit.removed, { undo: async () => {
        try { await api.put('/api/accelerator/criteria/' + id, { is_active: 1 });
          D.criteria = await api.get(`/api/accelerator/years/${YEAR()}/criteria`); rerender(); } catch (e) { ui.toast(e.message, { kind: 'error' }); }
      } });
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  intToggle: () => { st.intAdd = !st.intAdd; rerender(); },
  addInt: async () => {
    const name = val('intName'), email = val('intEmail');
    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { ui.toast(COPY.int.needBoth, { kind: 'error' }); return; }
    try {
      await api.post(`/api/accelerator/years/${YEAR()}/interviewers`, { name, email });
      D.interviewers = await api.get(`/api/accelerator/years/${YEAR()}/interviewers`);
      st.intAdd = false; rerender();
      ui.toast(COPY.int.added);
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  intRemove: async (el) => {
    const id = el.dataset.id;
    try {
      await api.del('/api/accelerator/interviewers/' + id);
      D.interviewers = await api.get(`/api/accelerator/years/${YEAR()}/interviewers`);
      rerender();
      ui.toast(COPY.int.removed, { undo: async () => {
        try { await api.put('/api/accelerator/interviewers/' + id, { is_active: 1 });
          D.interviewers = await api.get(`/api/accelerator/years/${YEAR()}/interviewers`); rerender(); } catch (e) { ui.toast(e.message, { kind: 'error' }); }
      } });
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  }
};

// ---- change-driven controls (scores, note, criterion rename) ----
async function onFieldChange(e) {
  const el = e.target.closest && e.target.closest('[data-change]');
  if (!el || !rootEl || !rootEl.contains(el)) return;
  const kind = el.dataset.change;
  if (kind === 'critRename') {
    const name = el.value.trim();
    if (!name) return;
    try {
      await api.put('/api/accelerator/criteria/' + el.dataset.id, { name });
      const c = crits().find(x => x.id === el.dataset.id); if (c) c.name = name;
      ui.toast(COPY.crit.renamed);
    } catch (err) { ui.toast(err.message, { kind: 'error' }); }
    return;
  }
  if (kind === 'note') {
    const id = el.dataset.id;
    try {
      await api.put(`/api/v2/accelerator-review/applications/${id}/note`, { note: el.value });
      const a = localApp(id); if (a) a.reviewer_notes = el.value;
      if (st.files[id] && st.files[id] !== 'loading') st.files[id].reviewer_notes = el.value;
      ui.toast(COPY.decision.noteSaved);
    } catch (err) { ui.toast(err.message, { kind: 'error' }); }
    return;
  }
  if (kind === 'score') {
    const appId = el.dataset.app, critId = el.dataset.crit;
    let v = Number(String(el.value).replace(',', '.'));
    if (el.value.trim() === '') return;
    if (!Number.isFinite(v) || v < 0 || v > 5) { ui.toast(COPY.score.bad, { kind: 'error' }); const cell = scoreCell(appId, critId); el.value = cell.mine == null ? '' : cell.mine; return; }
    v = Math.round(v * 10) / 10;
    try {
      await api.put('/api/v2/accelerator-review/scores', { application_id: appId, criterion_id: critId, score: v });
      // local per-reviewer row update
      const rows = D.scores.scores;
      const mine = rows.find(s => s.application_id === appId && s.criterion_id === critId && s.reviewer_email === myEmail());
      if (mine) mine.score = v; else rows.push({ application_id: appId, criterion_id: critId, reviewer_email: myEmail(), score: v });
      // mirror the team averages into the legacy evaluation store so total_score/ranking-PDF stay truthful
      const evaluations = crits().map(c => { const cell = scoreCell(appId, c.id); return cell.avg == null ? null : { criterion_id: c.id, score: Math.round(cell.avg * 100) / 100, notes: `v2 average · ${cell.n} reviewer(s)` }; }).filter(Boolean);
      if (evaluations.length) { try { await api.post(`/api/accelerator/applications/${appId}/evaluate-batch`, { evaluations }); } catch (err) { /* legacy mirror is best-effort */ } }
      rerender();
      ui.toast(COPY.score.saved);
    } catch (err) { ui.toast(err.message, { kind: 'error' }); }
  }
}
function onKeydown(e) {
  if (e.key !== 'Enter' || !rootEl) return;
  const role = e.target && e.target.dataset ? e.target.dataset.role : '';
  if (role === 'critDraft') { e.preventDefault(); handlers.addCrit(); }
  if (role === 'intEmail' || role === 'intName') { e.preventDefault(); handlers.addInt(); }
}

export default {
  title: 'Review Room',
  async render(root, ctx) {
    rootEl = root;
    st = { open: null, files: {}, declineConfirm: null, filter: (ctx.query && ctx.query.status) || null, intAdd: false };
    if (!document.getElementById('mx-css-accelerator-review')) {
      const l = document.createElement('link'); l.id = 'mx-css-accelerator-review'; l.rel = 'stylesheet'; l.href = '/css/views/accelerator-review.css'; document.head.appendChild(l);
    }
    D = await load();
    if (rootEl !== root) return;
    root.innerHTML = template();
    unbind = ui.bind(root, handlers);
    onChange = onFieldChange; root.addEventListener('change', onChange);
    onKey = onKeydown; root.addEventListener('keydown', onKey);
  },
  destroy() {
    if (unbind) unbind(); unbind = null;
    if (rootEl && onChange) rootEl.removeEventListener('change', onChange);
    if (rootEl && onKey) rootEl.removeEventListener('keydown', onKey);
    onChange = null; onKey = null; rootEl = null; D = null; st = null;
  }
};
