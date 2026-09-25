// js/views/tasks.js — TASKS, the shared board (no artboard; v2 addition 2026-09-20).
// Why: Alen tells Laura tasks, she does them and texts him the result, the result gets buried
// ("she found Turkish Airlines flights and I can't find what she found"). Here a task is added,
// worked, and finished WITH THE RESULT on the card — text, links, files — and DONE — FOR ALEN is
// the one place he goes to see what she did. Four columns: TO DO · IN PROGRESS · DONE — FOR <who
// asked> · SEEN. Cards drag between columns (HTML5 dnd); the drawer's status buttons do the same
// on a phone. Route: /tasks (the board) · /tasks/<id> (that card's drawer open).
// Data: backend/v2/tasks.js — GET/POST /api/v2/tasks, PUT /:id, PUT /:id/result, POST /:id/seen,
// /:id/archive, /:id/comments, /:id/files (+ GET /files/:fid signed), GET /api/v2/tasks/badge.
// Visual language: the admin workspace (Inter micro-labels, Fraunces titles, ink/crimson, white
// cards on paper, hairlines) — the same vocabulary as bridges.js / links.js; css/views/tasks.css
// carries layout, drag states, the drawer and the ≤760px stack (columns stack, drawer full-screen).
// Who sees a card (Alen, 25 Sept 2026): only the person who made it and the people tagged on it — the
// server filters every list, search and count; this view says so once in the add bar and once in the
// drawer, and taking yourself off a card you did not make takes it off your board.
// More than one person (Alen, 25 Sept 2026 — "in tasks please let us tag more than one person"): WHO
// in the add bar and the drawer is a set of removable chips plus an ADD PERSON picker of everyone
// else; the card names up to three of them. The first person tagged is the task's assigned_to.
import { api } from '../api.js';
import { ui, esc, fmt } from '../ui.js';
import { session } from '../state.js';
import { chrome } from '../chrome.js';

export const SOURCE = 'v2 addition — no artboard (2026-09-20)';

export const COPY = {
  title: 'Tasks', titleHtml: 'The <i>board</i>',
  sub: 'Add it, work it, finish it with the result on the card — so nothing lives in a text message again.',
  add: { placeholder: 'What needs doing?', btn: 'ADD', due: 'Due', noOne: 'No one yet', typeFirst: 'TYPE THE TASK FIRST',
    added: names => names.length ? `ADDED — ${nameList(names).toUpperCase()} ${names.length === 1 ? 'HAS' : 'HAVE'} IT` : 'ADDED TO THE BOARD' },
  // the WHO field: chips for the people tagged, a picker for everyone else
  people: { label: 'People on this task', add: 'ADD PERSON', pick: 'Add a person…', remove: name => `Take ${name} off this task`, full: n => `Up to ${n} people`, noAccount: name => `${name} · no portal account, so the card never reaches them`, noAccountMark: 'NO ACCOUNT' },
  filters: { mine: 'MINE', other: who => `FOR ${who.toUpperCase()}`, all: 'ALL MY TASKS', archived: 'ARCHIVED', search: 'Search titles, notes, results, comments…' },
  // one quiet line in the add bar and the drawer: a task is seen only by who made it and who is on it
  // (never naming someone without a portal account — they can never open the board)
  privacy: {
    line: names => names.length ? `Only ${nameList(['you'].concat(names))} can see this task.` : 'Only you can see this task.',
    untagged: 'Only you will see this task until you tag someone.'
  },
  cols: { todo: 'TO DO', doing: 'IN PROGRESS', done: who => who ? `DONE — FOR ${who.toUpperCase()}` : 'DONE — TO SEE', seen: 'SEEN' },
  card: { overdue: d => `${d}D OVERDUE`, today: 'TODAY', due: d => d, unassigned: 'NO ONE', files: n => `${n} file${n === 1 ? '' : 's'}`, comments: n => `${n}` },
  empty: {
    board: { line: 'Nothing on the board.', why: 'Type the first task above. It lands in TO DO and everyone you tag who has a portal account gets one short email.' },
    todo: 'Nothing waiting.', doing: 'Nothing in hand.', done: 'Nothing to look at yet.', seen: 'Nothing filed yet.', archived: 'Nothing archived.', search: 'No card matches that.'
  },
  drawer: {
    eyebrow: s => `TASK · ${s}`, close: 'Close', assignee: 'WHO', due: 'DUE', priority: 'PRIORITY', notes: 'NOTES', notesPh: 'What exactly, where to look, what a good result looks like…',
    result: 'RESULT', resultPh: 'What did you find? Write it here — flights, price, the person who said yes, the number they gave you…',
    resultHint: 'This is the part that used to get lost in a text. Write it, paste the links, drop the files.',
    linkUrl: 'https://…', linkLabel: 'what it is (optional)', addLink: 'ADD LINK', removeLink: 'remove', attach: 'ATTACH A FILE', drop: 'or drop it here · any file · up to 25 MB',
    files: 'FILES', comments: 'COMMENTS', commentPh: 'Ask, answer, add a note…', post: 'POST', activity: 'ACTIVITY', showActivity: n => `SHOW ACTIVITY · ${n}`, hideActivity: 'HIDE ACTIVITY',
    start: 'START', done: 'DONE', seen: 'SEEN', reopen: 'REOPEN', archive: 'ARCHIVE', unarchive: 'BRING BACK', remove: 'DELETE',
    createdBy: (who, when) => `${who ? who + ' · ' : ''}${when}`, seenBy: (who, when) => `Seen by ${who} · ${when}`,
    priorities: [['low', 'Low'], ['medium', 'Normal'], ['high', 'High']],
    missing: 'That task is not on the board any more.'
  },
  toast: {
    moved: (s, own) => ({ todo: 'BACK TO TO DO', doing: 'STARTED', done: own ? 'DONE — IT WAITS IN YOUR DONE COLUMN' : 'DONE — THE PERSON WHO ASKED HAS BEEN TOLD', seen: 'SEEN — FILED' }[s] || 'MOVED'),
    saved: 'SAVED', resultSaved: 'RESULT SAVED — IT STAYS ON THE CARD', linkAdded: 'LINK ADDED', linkBad: 'PASTE A FULL LINK — STARTING WITH HTTPS://',
    uploaded: n => `${n.toUpperCase()} ATTACHED`, uploading: 'UPLOADING…', fileRemoved: 'FILE REMOVED', tooBig: 'THAT FILE IS OVER 25 MB — SHARE A LINK TO IT INSTEAD',
    commented: 'POSTED', commentEmpty: 'WRITE THE COMMENT FIRST', archived: 'ARCHIVED — FIND IT UNDER ARCHIVED', unarchived: 'BACK ON THE BOARD', deleted: 'DELETED',
    tagged: who => `${who.toUpperCase()} IS ON IT NOW`, untagged: who => `${who.toUpperCase()} IS OFF IT`, joined: 'YOU ARE ON IT NOW', left: 'YOU ARE OFF IT',
    handedOff: 'YOU ARE OFF IT — IT HAS LEFT YOUR BOARD', tooMany: n => `A TASK CAN HAVE UP TO ${n} PEOPLE`
  },
  confirm: {
    del: { title: 'Delete this task?', body: 'The card, its result, comments and files go with it. Archiving keeps everything and just tucks it away — that is usually the better door.', ok: 'DELETE', cancel: 'KEEP' },
    // someone on a card they did not make, taking themself off, loses it: only its creator and the
    // people still on it see it from then on
    handOff: names => ({ title: 'Take yourself off this task?', body: `It leaves your board. From then on only ${names.length ? nameList(names) : 'the person who made it'} can see it.`, ok: 'TAKE ME OFF', cancel: 'KEEP IT' })
  }
};

const STATUSES = ['todo', 'doing', 'done', 'seen'];
const MAX_PEOPLE = 12;   // the server's cap (shared/task-visibility.js MAX_TASK_PEOPLE)
// "Alen", "Alen and Miro", "you, Alen and Miro"
function nameList(names) { return names.length <= 1 ? (names[0] || '') : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]; }
const STATUS_LABEL = { todo: 'TO DO', doing: 'IN PROGRESS', done: 'DONE', seen: 'SEEN' };
const CHIP = { todo: ['#eee9df', '#4a4239'], doing: ['#e8eef7', '#2c4a73'], done: ['#f7e3e4', '#7e151b'], seen: ['#e4efe7', '#22563a'] };
const POLL_MS = 60000;

let D = null, st = null, unbind = null, unlisten = null, rootEl = null, reqId = 0, detailSeq = 0, poll = null;

function loadCss() {
  if (!document.getElementById('mx-css-tasks')) {
    const l = document.createElement('link'); l.id = 'mx-css-tasks'; l.rel = 'stylesheet'; l.href = '/css/views/tasks.css'; document.head.appendChild(l);
  }
}

// ---------------------------------------------------------------- data
function listQuery() {
  const p = new URLSearchParams();
  if (st.filter === 'archived') p.set('archived', '1');
  else if (st.filter === 'mine') p.set('assignee', 'me');
  else if (st.filter === 'other' && counterpart()) p.set('assignee', counterpart().id);
  if (st.q.trim()) p.set('q', st.q.trim());
  const s = p.toString();
  return '/api/v2/tasks' + (s ? '?' + s : '');
}
async function load() {
  const my = ++reqId;
  const r = await api.get(listQuery());
  if (my !== reqId) return false;
  D = { tasks: Array.isArray(r.tasks) ? r.tasks : [], people: Array.isArray(r.people) ? r.people : [], me: r.me || {} };
  return true;
}
// `quiet` (the background poll): a failed fetch says nothing, except that the task is gone (a 404 closes it)
async function loadDetail(id, { quiet = false } = {}) {
  const my = ++detailSeq;
  try {
    const r = await api.get('/api/v2/tasks/' + encodeURIComponent(id));
    if (!st || my !== detailSeq || st.open !== id) return false;   // closed or switched meanwhile
    st.detail = { task: r.task, comments: Array.isArray(r.comments) ? r.comments : [], files: Array.isArray(r.files) ? r.files : [] };
    // keep the board's copy of the card in step with the drawer
    const i = D.tasks.findIndex(t => t.id === id); if (i >= 0) D.tasks[i] = Object.assign({}, D.tasks[i], r.task);
    return true;
  } catch (e) {
    if (!st) return false;
    if (e && e.status === 404) { if (st.open === id) { ui.toast(COPY.drawer.missing, { kind: 'error' }); closeDrawer(); } }
    else if (!quiet) ui.toast(e.message, { kind: 'error' });
    return false;
  }
}
const me = () => (D && D.me) || {};
const personById = id => (D.people || []).find(p => p.id === id || (p.user_id && 'user:' + p.user_id === id)) || null;
// the people on a card, first person first (an older backend sends only the one assignee)
function peopleOf(t) {
  if (Array.isArray(t.people)) return t.people;
  return t.assigned_to ? [{ id: t.assigned_to, user_id: t.assignee_user_id || null, name: t.assignee_name || '', first: t.assignee_first || '' }] : [];
}
const isMePerson = p => !!p && ((p.user_id && p.user_id === me().id) || (!!me().member_id && p.id === me().member_id));
const isMe = t => peopleOf(t).some(isMePerson);   // I am on this card (first or tagged)
// is `person` (a row of D.people) on card t — by team row, or by account
const onCard = (t, person) => !!person && peopleOf(t).some(p => p.id === person.id || (person.user_id && p.user_id === person.user_id));
// the other half of the pair: the founder's counterpart is Laura (the main assignee); everyone
// else's counterpart is the founder. Falls back to the first person who is not me.
function counterpart() {
  const people = (D.people || []).filter(p => p.id !== me().member_id && !(p.user_id && p.user_id === me().id));
  const laura = people.find(p => /laura\.rodman@medx\.hr/i.test(p.email || '')) || people.find(p => /^laura\b/i.test(p.name || ''));
  const founder = people.find(p => p.is_founder);
  const amFounder = session.isFounder || !!(D.people || []).find(p => p.user_id === me().id && p.is_founder);
  return (amFounder ? (laura || founder) : (founder || laura)) || people[0] || null;
}
const firstName = p => (p && p.first) || (p && p.name ? String(p.name).split(/\s+/)[0] : '');
// the first names of the people in `list` who can open the board and are not me — a team row with no
// portal account can never see a card, so it is never named as someone who does
function seers(list) {
  const out = [], accounts = new Set();
  for (const p of list) {
    if (!p || !p.user_id || isMePerson(p) || accounts.has(p.user_id)) continue;
    accounts.add(p.user_id); const n = firstName(p); if (n) out.push(n);
  }
  return out;
}
// the add bar's line: the people picked so far (picker values: team row id or user:<id>)
function addPrivacyText(ids) {
  if (!ids.length) return COPY.privacy.untagged;
  return COPY.privacy.line(seers(ids.map(personById)));
}
// the drawer's line: its creator and the people on it, never me
function drawerPrivacyText(t) {
  const list = peopleOf(t).slice();
  if (!list.length && (!t.created_by || t.created_by === me().id)) return COPY.privacy.untagged;   // my card, no one on it yet
  if (t.created_by && t.created_by !== me().id && t.creator_first) list.unshift({ user_id: t.created_by, first: t.creator_first });
  return COPY.privacy.line(seers(list));
}
// the WHO label on a card: up to three first names, then +N ("ALEN · LAURA · MIRO +1")
function whoLabel(t) {
  const names = peopleOf(t).map(p => firstName(p).toUpperCase()).filter(Boolean);
  if (!names.length) return COPY.card.unassigned;
  return names.slice(0, 3).join(' · ') + (names.length > 3 ? ` +${names.length - 3}` : '');
}
// the WHO field (add bar and drawer): each person tagged as a chip with a remove ×, then an ADD PERSON
// picker (a native select laid over the button, so a phone opens its own wheel) listing everyone else.
// `chosen` = [{ id, name, first, user_id }] in order; `role` names the picker; `untag` the chip action;
// `busy` = a save of this field is in flight (every × and the picker wait for it). A person with no portal
// account carries a visible NO ACCOUNT mark (a touch screen never shows the title tooltip).
function peopleField(chosen, role, untag, busy) {
  const c = COPY.people;
  const rest = (D.people || []).filter(p => !chosen.some(x => x.id === p.id || (p.user_id && x.user_id === p.user_id)));
  const full = chosen.length >= MAX_PEOPLE;
  const off = busy ? ' disabled' : '';
  return `<div class="mx-people" data-role="${role}Field" role="group" aria-label="${esc(c.label)}"${busy ? ' aria-busy="true"' : ''}>
      ${chosen.map(p => { const n = firstName(p) || p.name || ''; return `<span class="mx-person${isMePerson(p) ? ' me' : ''}${p.user_id ? '' : ' noacct'}" title="${esc(p.user_id ? (p.name || n) : c.noAccount(p.name || n))}"><span class="mx-person-name">${esc(n.toUpperCase())}</span>${p.user_id ? '' : `<span class="mx-person-flag">${esc(c.noAccountMark)}</span>`}<button type="button" class="mx-person-x" data-act="${untag}" data-id="${esc(p.id)}" aria-label="${esc(c.remove(n))}"${off}><svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="square"/></svg></button></span>`; }).join('')}
      ${rest.length && !full ? `<label class="mx-person-add"><span aria-hidden="true">+ ${c.add}</span><select data-role="${role}" aria-label="${esc(c.pick)}"${off}><option value="">${esc(c.pick)}</option>${rest.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></label>` : ''}
      ${full ? `<span class="mx-people-note">${esc(c.full(MAX_PEOPLE))}</span>` : ''}
    </div>`;
}
// the add bar's picks as people (picker values → D.people rows, unknown ones dropped)
const addChosen = () => (st.addPeople || []).map(personById).filter(Boolean);

// ---------------------------------------------------------------- blocks
function blockTitle() {
  return `
  <div data-block="title" style="display:flex;align-items:flex-end;gap:16px;flex-wrap:wrap">
    <div>
      <span class="mx-display-30" style="font-family:Fraunces,serif;font-size:30px">${COPY.titleHtml}</span>
      <div style="font-size:12.5px;color:#6d6459;margin-top:4px;max-width:640px;line-height:1.5">${COPY.sub}</div>
    </div>
  </div>`;
}
function blockAdd() {
  const cp = counterpart();
  if (st.addPeople == null) st.addPeople = cp ? [cp.id] : [];   // the pair's other half, until changed
  return `
  <div data-block="add" class="mx-tasks-add" style="border:1px solid rgba(32,27,22,.14);border-top:2px solid #9b1b22;background:#fff;padding:12px 16px;display:flex;gap:8px 10px;align-items:center;flex-wrap:wrap">
    <input data-role="addTitle" value="${esc(st.addTitle)}" placeholder="${esc(COPY.add.placeholder)}" aria-label="New task" maxlength="200" style="flex:1 1 260px;min-width:0;border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:10px 12px;font:400 14px Inter,sans-serif;color:#201b16">
    ${peopleField(addChosen(), 'addWho', 'untagAdd')}
    <label class="mx-add-due" style="display:flex;align-items:center;gap:6px;font:600 8.5px Inter,sans-serif;letter-spacing:.14em;color:#6d6459;flex:0 0 auto"><span>${COPY.add.due.toUpperCase()}</span><input data-role="addDue" type="date" value="${esc(st.addDue)}" aria-label="Due date" style="border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:8px 8px;font:400 12px Inter,sans-serif;color:#201b16"></label>
    <span data-act="add" role="button" class="mx-add-btn" style="padding:10px 16px;background:#9b1b22;color:#fff;font:600 10px Inter,sans-serif;letter-spacing:.14em;cursor:pointer;white-space:nowrap;flex:0 0 auto" data-hover="background:#7e151b">${COPY.add.btn}</span>
    <div data-role="addPrivacy" style="flex:1 1 100%;font-size:11px;color:#6d6459;line-height:1.4">${esc(addPrivacyText(st.addPeople))}</div>
  </div>`;
}
function blockFilters() {
  const cp = counterpart();
  const chips = [['mine', COPY.filters.mine]];
  if (cp) chips.push(['other', COPY.filters.other(firstName(cp))]);
  chips.push(['all', COPY.filters.all], ['archived', COPY.filters.archived]);
  return `
  <div data-block="filters" class="mx-tasks-filters" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
    ${chips.map(([k, label]) => `<span data-act="filter" data-k="${k}" role="button" aria-pressed="${st.filter === k}" style="padding:7px 12px;border:1px solid ${st.filter === k ? '#201b16' : 'rgba(32,27,22,.18)'};background:${st.filter === k ? '#201b16' : '#fff'};color:${st.filter === k ? '#f6f2ea' : '#6d6459'};font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap" data-hover="border-color:#201b16;color:${st.filter === k ? '#f6f2ea' : '#201b16'}">${label}</span>`).join('')}
    <div style="flex:1"></div>
    <span class="mx-tasks-search" style="display:flex;align-items:center;gap:8px;border:1px solid rgba(32,27,22,.18);background:#fff;padding:7px 12px;box-sizing:border-box;flex:0 1 320px;min-width:180px"><span style="color:#6d6459">⌕</span><input data-role="search" value="${esc(st.q)}" placeholder="${esc(COPY.filters.search)}" aria-label="Search tasks" autocomplete="off" style="border:none;background:transparent;font-size:12.5px;color:#201b16;width:100%;padding:0"></span>
  </div>`;
}
function dueMeta(t) {
  if (!t.due_date) return null;
  const diff = fmt.daysUntil(t.due_date);
  if (diff == null) return null;
  const open = t.status === 'todo' || t.status === 'doing';
  if (open && diff < 0) return { text: COPY.card.overdue(Math.abs(diff)), color: '#9b1b22', strong: true };
  if (open && diff === 0) return { text: COPY.card.today, color: '#b7791f', strong: true };
  return { text: fmt.dayLabel(t.due_date), color: '#6d6459', strong: false };
}
function resultPreview(t) {
  const text = String(t.result_text || '').trim().split('\n').find(l => l.trim()) || '';
  if (text) return text;
  const l = (t.result_links || [])[0];
  return l ? (l.label || l.url.replace(/^https?:\/\//, '')) : '';
}
// line icons for the card's file / comment counts (colour emoji never sat right in the Inter micro-type)
const ICON_CLIP = '<svg class="mx-ico" width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex:none;vertical-align:-1px"><path d="M13.5 7.5 8.2 12.8a3.5 3.5 0 0 1-5-5l5.6-5.6a2.3 2.3 0 0 1 3.3 3.3L6.5 11.1a1.2 1.2 0 0 1-1.7-1.7L10 4.2"/></svg>';
const ICON_TALK = '<svg class="mx-ico" width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true" style="flex:none;vertical-align:-1px"><path d="M2.5 3h11v7.5H7L4 13v-2.5H2.5z"/></svg>';
function card(t) {
  const due = dueMeta(t);
  const preview = resultPreview(t);
  const chip = CHIP[t.status] || CHIP.todo;
  const who = esc(whoLabel(t));
  return `
      <div class="mx-task${st.open === t.id ? ' open' : ''}${isMe(t) ? ' mine' : ''}" data-act="open" data-id="${esc(t.id)}" data-task="${esc(t.id)}" draggable="true" role="button" aria-label="${esc(t.title)}" style="background:#fff;border:1px solid rgba(32,27,22,.14);padding:11px 12px 10px;display:flex;flex-direction:column;gap:7px;cursor:pointer">
        <div style="font-size:13px;font-weight:600;line-height:1.35;color:#201b16;overflow-wrap:anywhere">${esc(t.title)}</div>
        ${preview ? `<div class="mx-task-result" style="font-family:Fraunces,serif;font-style:italic;font-size:12.5px;line-height:1.4;color:#4a4239;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(preview)}">${esc(preview)}</div>` : ''}
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span class="mx-task-who" title="${esc(peopleOf(t).map(p => p.name).join(', '))}" style="font:600 8.5px Inter,sans-serif;letter-spacing:.11em;padding:3px 7px;background:${chip[0]};color:${chip[1]};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%">${who}</span>
          ${due ? `<span style="font:600 8.5px Inter,sans-serif;letter-spacing:.1em;color:${due.color};white-space:nowrap">${esc(due.text)}</span>` : ''}
          ${t.priority === 'high' ? `<span title="High priority" style="width:6px;height:6px;background:#9b1b22;flex:none"></span>` : ''}
          <div style="flex:1"></div>
          ${t.file_count ? `<span title="${esc(COPY.card.files(t.file_count))}" style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#6d6459;white-space:nowrap">${ICON_CLIP}${t.file_count}</span>` : ''}
          ${t.comment_count ? `<span title="${t.comment_count} comment${t.comment_count === 1 ? '' : 's'}" style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#6d6459;white-space:nowrap">${ICON_TALK}${t.comment_count}</span>` : ''}
        </div>
      </div>`;
}
function column(status, rows) {
  const c = COPY.cols;
  let label = c[status];
  if (status === 'done') {
    const names = Array.from(new Set(rows.map(t => t.creator_first).filter(Boolean)));
    const fallback = session.isFounder ? session.firstName() : (counterpart() && counterpart().is_founder ? firstName(counterpart()) : session.firstName());
    label = c.done(names.length === 1 ? names[0] : (names.length === 0 ? fallback : ''));
  }
  const emptyLine = st.filter === 'archived' ? COPY.empty.archived : (st.q.trim() ? COPY.empty.search : COPY.empty[status]);
  return `
    <div class="mx-col" data-col="${status}" style="display:flex;flex-direction:column;gap:8px;min-width:0">
      <div class="mx-col-head" style="display:flex;align-items:center;gap:8px;padding:0 2px 6px;border-bottom:1px solid rgba(32,27,22,.14)">
        <span style="font:600 10px Inter,sans-serif;letter-spacing:.15em;color:${status === 'done' ? '#9b1b22' : '#201b16'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${label}</span>
        <span style="min-width:18px;height:18px;padding:0 5px;background:${status === 'done' && rows.length ? '#9b1b22' : '#201b16'};color:#fff;font:600 10.5px Inter,sans-serif;display:inline-flex;align-items:center;justify-content:center">${rows.length}</span>
      </div>
      <div class="mx-col-body" data-drop="${status}" style="display:flex;flex-direction:column;gap:8px;min-height:64px">
        ${rows.map(card).join('')}
        ${!rows.length ? `<div class="mx-col-empty" style="font-family:Fraunces,serif;font-style:italic;font-size:13px;color:#9a9086;padding:10px 2px">${emptyLine}</div>` : ''}
      </div>
    </div>`;
}
function sortRows(status, rows) {
  const key = t => (t.due_date || '9999') + '|' + (t.priority === 'high' ? '0' : '1') + '|' + (t.created_at || '');
  if (status === 'todo' || status === 'doing') return rows.slice().sort((a, b) => key(a).localeCompare(key(b)));
  if (status === 'done') return rows.slice().sort((a, b) => String(b.completed_at || '').localeCompare(String(a.completed_at || '')));
  return rows.slice().sort((a, b) => String(b.seen_at || b.updated_at || '').localeCompare(String(a.seen_at || a.updated_at || '')));
}
function blockBoard() {
  const by = { todo: [], doing: [], done: [], seen: [] };
  for (const t of D.tasks) (by[t.status] || by.todo).push(t);
  const total = D.tasks.length;
  return `
  <div data-block="board" class="mx-board" style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;align-items:start">
    ${STATUSES.map(s => column(s, sortRows(s, by[s]))).join('')}
    ${!total && !st.q.trim() && st.filter !== 'archived' ? `<div class="empty" style="grid-column:1 / -1;padding:26px 20px 30px"><span style="width:28px;height:1px;background:#c9a962"></span><span class="empty-line">${COPY.empty.board.line}</span><span class="empty-why">${COPY.empty.board.why}</span></div>` : ''}
  </div>`;
}

// ---- the drawer ----
function whenLabel(v) {
  const d = fmt.toDate(v); if (!d) return '';
  const same = fmt.ymd(d) === fmt.ymd(new Date());
  const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  return same ? 'Today ' + hm : fmt.dayShort(d) + ' ' + hm;
}
function statusButtons(t) {
  const b = COPY.drawer; const btn = (act, label, primary) => `<span data-act="${act}" role="button" style="padding:9px 14px;${primary ? 'background:#9b1b22;color:#fff' : 'border:1px solid rgba(32,27,22,.2);color:#201b16'};font:600 9.5px Inter,sans-serif;letter-spacing:.14em;cursor:pointer;white-space:nowrap" data-hover="${primary ? 'background:#7e151b' : 'border-color:#201b16'}">${label}</span>`;
  const out = [];
  if (t.status === 'todo') { out.push(btn('start', b.start, true), btn('finish', b.done)); }
  else if (t.status === 'doing') { out.push(btn('finish', b.done, true), btn('reopen', b.reopen)); }
  else if (t.status === 'done') { out.push(btn('markSeen', b.seen, true), btn('reopen', b.reopen)); }
  else { out.push(btn('reopen', b.reopen)); }
  return out.join('');
}
function linksBlock(t) {
  const links = t.result_links || [];
  return `<div data-role="links" style="display:flex;flex-direction:column;gap:6px">
      ${links.map((l, i) => `<div style="display:flex;align-items:center;gap:8px;min-width:0"><span style="color:#c9a962;flex:none">↗</span><a href="${esc(l.url)}" target="_blank" rel="noopener" style="font-size:12.5px;color:#9b1b22;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1" title="${esc(l.url)}">${esc(l.label || l.url.replace(/^https?:\/\//, ''))}</a><span data-act="removeLink" data-i="${i}" style="font:600 8px Inter,sans-serif;letter-spacing:.1em;color:#9a9086;cursor:pointer;white-space:nowrap" data-hover="color:#9b1b22">${COPY.drawer.removeLink.toUpperCase()}</span></div>`).join('')}
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <input data-role="linkUrl" value="${esc(st.linkUrl)}" placeholder="${esc(COPY.drawer.linkUrl)}" inputmode="url" aria-label="Link URL" style="flex:2 1 160px;min-width:0;border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:8px 10px;font:400 12.5px Inter,sans-serif;color:#201b16">
        <input data-role="linkLabel" value="${esc(st.linkLabel)}" placeholder="${esc(COPY.drawer.linkLabel)}" aria-label="Link label" style="flex:1 1 120px;min-width:0;border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:8px 10px;font:400 12.5px Inter,sans-serif;color:#201b16">
        <span data-act="addLink" role="button" style="padding:8px 11px;border:1px solid rgba(32,27,22,.2);font:600 8.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap;display:flex;align-items:center" data-hover="border-color:#201b16">${COPY.drawer.addLink}</span>
      </div>
    </div>`;
}
function sizeLabel(n) { n = Number(n || 0); return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B'; }
function filesBlock(files) {
  return `<div data-role="files" class="mx-drop" style="display:flex;flex-direction:column;gap:6px">
      ${files.map(f => `<div style="display:flex;align-items:center;gap:8px;min-width:0"><span style="flex:none;display:inline-flex;color:#6d6459">${ICON_CLIP}</span><a href="${esc(api.url(f.url))}" target="_blank" rel="noopener" style="font-size:12.5px;color:#201b16;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1" title="${esc(f.name)}">${esc(f.name)}</a><span style="font-size:10.5px;color:#9a9086;white-space:nowrap">${sizeLabel(f.size)}</span><span data-act="removeFile" data-id="${esc(f.id)}" style="font:600 8px Inter,sans-serif;letter-spacing:.1em;color:#9a9086;cursor:pointer;white-space:nowrap" data-hover="color:#9b1b22">${COPY.drawer.removeLink.toUpperCase()}</span></div>`).join('')}
      <label class="mx-drop-zone" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;border:1px dashed rgba(32,27,22,.3);padding:10px 12px;cursor:pointer;background:#fdfbf6" data-hover="border-color:#201b16">
        <span style="padding:7px 11px;background:#201b16;color:#f6f2ea;font:600 8.5px Inter,sans-serif;letter-spacing:.13em;white-space:nowrap">${st.uploading ? COPY.toast.uploading : COPY.drawer.attach}</span>
        <span style="font-size:11px;color:#6d6459">${COPY.drawer.drop}</span>
        <input data-role="file" type="file" aria-label="Attach a file" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none">
      </label>
    </div>`;
}
function drawer() {
  if (!st.open) return '';
  const d = st.detail;
  const t = d ? d.task : (D.tasks.find(x => x.id === st.open) || null);
  if (!t) return `<div class="mx-drawer" data-block="drawer" role="dialog" aria-label="Task"><div class="mx-drawer-sheet" tabindex="-1"><div style="padding:24px;font-size:12.5px;color:#6d6459">Loading…</div></div></div>`;
  const b = COPY.drawer;
  const comments = d ? d.comments.filter(c => c.kind === 'comment') : [];
  const activity = d ? d.comments.filter(c => c.kind !== 'comment') : [];
  const files = d ? d.files : [];
  const cp = CHIP[t.status] || CHIP.todo;
  const input = 'border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:8px 10px;font:400 12.5px Inter,sans-serif;color:#201b16;width:100%;box-sizing:border-box';
  const label = 'font:600 8.5px Inter,sans-serif;letter-spacing:.14em;color:#6d6459;display:block;margin-bottom:5px';
  return `
  <div class="mx-drawer" data-block="drawer" role="dialog" aria-label="${esc(t.title)}">
    <div class="mx-drawer-sheet" tabindex="-1">
      <div style="display:flex;align-items:center;gap:10px;padding:12px 20px;border-bottom:1px solid rgba(32,27,22,.12)">
        <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:${t.status === 'done' ? '#9b1b22' : '#6d6459'}">${b.eyebrow(STATUS_LABEL[t.status] || t.status.toUpperCase())}</span>
        ${t.archived_at ? `<span style="font:600 8px Inter,sans-serif;letter-spacing:.1em;padding:2px 6px;background:#eee7dc;color:#6d6459">ARCHIVED</span>` : ''}
        <div style="flex:1"></div>
        <span data-act="close" role="button" aria-label="${b.close}" style="color:#6d6459;cursor:pointer;font:400 20px Inter,sans-serif;line-height:1" data-hover="color:#201b16">×</span>
      </div>
      <div style="padding:16px 20px 24px;display:flex;flex-direction:column;gap:16px">
        <textarea data-role="title" data-save="title" rows="1" aria-label="Title" style="font-family:Fraunces,serif;font-size:22px;line-height:1.2;color:#201b16;border:none;border-bottom:1px solid transparent;background:transparent;padding:0;width:100%;resize:none;overflow:hidden;box-sizing:border-box" data-hover="border-bottom-color:rgba(32,27,22,.25)">${esc(t.title)}</textarea>
        <div class="mx-drawer-status" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          ${statusButtons(t)}
          <span style="font-size:11px;color:#6d6459;margin-left:auto">${t.status === 'seen' && t.seen_by_name ? esc(b.seenBy(t.seen_by_name.split(/\s+/)[0], whenLabel(t.seen_at))) : esc(b.createdBy(t.creator_first, whenLabel(t.created_at)))}</span>
        </div>
        <div class="mx-drawer-fields" style="display:grid;grid-template-columns:1fr 1fr;gap:12px 10px">
          <div style="grid-column:1 / -1"><span style="${label}">${b.assignee}</span>
            ${peopleField(peopleOf(t), 'who', 'untag', !!st.peopleBusy)}
            <div data-role="privacy" style="font-size:11px;color:#6d6459;line-height:1.4;margin-top:8px">${esc(drawerPrivacyText(t))}</div></div>
          <div><span style="${label}">${b.due}</span><input data-role="due" data-save="due_date" type="date" value="${esc(t.due_date || '')}" aria-label="${b.due}" style="${input}"></div>
          <div><span style="${label}">${b.priority}</span>
            <select data-role="priority" data-save="priority" aria-label="${b.priority}" style="${input}">${b.priorities.map(([k, l]) => `<option value="${k}"${t.priority === k ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
        </div>
        <div><span style="${label}">${b.notes}</span><textarea data-role="notes" data-save="description" rows="3" placeholder="${esc(b.notesPh)}" aria-label="${b.notes}" style="${input};resize:vertical;min-height:64px;line-height:1.5">${esc(t.description || '')}</textarea></div>

        <div data-role="resultBox" style="border:1px solid rgba(32,27,22,.14);border-left:3px solid ${t.status === 'done' || t.status === 'seen' ? '#9b1b22' : '#c9a962'};background:#fdfbf6;padding:14px 16px;display:flex;flex-direction:column;gap:10px">
          <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap"><span style="font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#201b16">${b.result}</span><span style="font-size:11px;color:#6d6459">${b.resultHint}</span></div>
          <textarea data-role="result" data-save="result_text" rows="4" placeholder="${esc(b.resultPh)}" aria-label="${b.result}" style="${input};background:#fff;resize:vertical;min-height:84px;line-height:1.55">${esc(t.result_text || '')}</textarea>
          ${linksBlock(t)}
          ${filesBlock(files)}
        </div>

        <div>
          <span style="${label}">${b.comments}${comments.length ? ' · ' + comments.length : ''}</span>
          <div style="display:flex;flex-direction:column;gap:8px">
            ${comments.map(c => `<div style="display:flex;gap:10px;align-items:flex-start"><span style="width:26px;height:26px;background:#201b16;color:#f6f2ea;display:inline-flex;align-items:center;justify-content:center;font:600 10px Fraunces,serif;flex:none">${esc(fmt.initials(c.author_name))}</span><div style="min-width:0;flex:1"><div style="display:flex;gap:8px;align-items:baseline"><span style="font-size:12px;font-weight:600">${esc((c.author_name || '').split(/\s+/)[0])}</span><span style="font-size:10.5px;color:#9a9086">${esc(whenLabel(c.created_at))}</span></div><div style="font-size:12.5px;line-height:1.5;color:#201b16;white-space:pre-wrap;overflow-wrap:anywhere">${esc(c.body)}</div></div></div>`).join('')}
            <div style="display:flex;gap:8px;align-items:flex-end">
              <textarea data-role="comment" rows="2" placeholder="${esc(b.commentPh)}" aria-label="${b.comments}" style="${input};resize:vertical;min-height:40px;line-height:1.5">${esc(st.commentDraft)}</textarea>
              <span data-act="comment" role="button" style="padding:9px 13px;background:#201b16;color:#f6f2ea;font:600 9px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap;flex:none" data-hover="background:#9b1b22">${b.post}</span>
            </div>
          </div>
        </div>

        <div>
          <span data-act="toggleActivity" role="button" aria-expanded="${st.showActivity}" style="font:600 8.5px Inter,sans-serif;letter-spacing:.14em;color:#9b1b22;cursor:pointer">${st.showActivity ? b.hideActivity : b.showActivity(activity.length)}</span>
          ${st.showActivity ? `<div style="display:flex;flex-direction:column;gap:4px;margin-top:8px;border-left:1px solid rgba(32,27,22,.12);padding-left:12px">
            ${activity.slice().reverse().map(a => `<div style="display:flex;gap:10px;align-items:baseline;font-size:11.5px;color:#4a4239"><span style="font:600 9px Inter,sans-serif;letter-spacing:.08em;color:#9a9086;white-space:nowrap;min-width:78px">${esc(whenLabel(a.created_at))}</span><span>${esc(a.body)}</span></div>`).join('')}
            ${!activity.length ? `<div style="font-size:11.5px;color:#9a9086;font-style:italic">Nothing yet.</div>` : ''}
          </div>` : ''}
        </div>

        <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;border-top:1px solid rgba(32,27,22,.1);padding-top:12px">
          <span data-act="${t.archived_at ? 'unarchive' : 'archive'}" role="button" style="font:600 9px Inter,sans-serif;letter-spacing:.13em;color:#6d6459;cursor:pointer" data-hover="color:#201b16">${t.archived_at ? b.unarchive : b.archive}</span>
          <div style="flex:1"></div>
          <span data-act="del" role="button" style="font:600 9px Inter,sans-serif;letter-spacing:.13em;color:#9a9086;cursor:pointer" data-hover="color:#9b1b22">${b.remove}</span>
        </div>
      </div>
    </div>
  </div>`;
}
function template() {
  return `
<div data-screen-label="Admin Tasks" class="mx-tasks" style="min-height:100vh;background:#f6f2ea;color:#201b16;font-family:Inter,sans-serif">
  <div class="mx-gutter" style="max-width:1180px;margin:0 auto;padding:30px 28px 56px;display:flex;flex-direction:column;gap:18px">
    ${blockTitle()}
    ${blockAdd()}
    ${blockFilters()}
    ${blockBoard()}
  </div>
  ${drawer()}
</div>`;
}

// ---------------------------------------------------------------- behaviour
function rerender(sel, html) { const el = rootEl && rootEl.querySelector(sel); if (el) el.outerHTML = html; }
function rerenderBoard() { rerender('[data-block="board"]', blockBoard()); }
// The sheet slides in once, when it OPENS; a redraw of the same card (its detail arriving, a status
// change, a comment) keeps the very same sheet element and swaps only what is inside it — so a slide or
// cross-fade still running carries on to its end and the sheet keeps its scroll; another card
// cross-fades in on the same sheet, and closing slides it back out (css .mx-drawer.swap / .out).
function morphSheet(cur, html) {
  const t = document.createElement('template'); t.innerHTML = html.trim();
  const next = t.content.firstElementChild;
  const sheet = cur.querySelector(':scope > .mx-drawer-sheet'), nextSheet = next && next.querySelector(':scope > .mx-drawer-sheet');
  if (!sheet || !nextSheet) return false;
  Array.from(next.attributes).forEach(a => { if (a.name !== 'class' && a.name !== 'data-for') cur.setAttribute(a.name, a.value); });
  Array.from(cur.attributes).forEach(a => { if (a.name !== 'class' && a.name !== 'data-for' && !next.hasAttribute(a.name)) cur.removeAttribute(a.name); });
  sheet.innerHTML = nextSheet.innerHTML;
  return true;
}
function rerenderDrawer() {
  const host = rootEl && rootEl.querySelector('.mx-tasks'); if (!host) return;
  const cur = host.querySelector('[data-block="drawer"]');
  const html = drawer();
  const was = cur ? cur.getAttribute('data-for') : null;
  if (cur && !html) {
    cur.setAttribute('data-block', 'drawer-leaving'); cur.classList.add('out');
    setTimeout(() => cur.remove(), ui.reducedMotion() ? 0 : 200);
  } else if (cur && morphSheet(cur, html)) {
    // the sheet element stays — its slide never replays and it keeps its scroll. Another card: the
    // content cross-fades in on the opaque sheet (css .mx-drawer.swap); the same card redrawn while that
    // fade still runs carries it on (--swap-d) instead of starting it over
    if (was !== String(st.open || '')) {
      const sh = cur.querySelector(':scope > .mx-drawer-sheet'); if (sh) sh.scrollTop = 0;
      cur.style.removeProperty('--swap-d'); cur.classList.remove('swap'); void cur.offsetWidth; cur.classList.add('swap');
      cur._swapAt = Date.now(); clearTimeout(cur._swapT); cur._swapT = setTimeout(() => { cur.classList.remove('swap'); cur.style.removeProperty('--swap-d'); }, 420);
    } else if (cur.classList.contains('swap')) cur.style.setProperty('--swap-d', -(Date.now() - (cur._swapAt || 0)) + 'ms');
  } else if (cur) { cur.outerHTML = html; }
  else if (html) host.insertAdjacentHTML('beforeend', html);
  const nu = html && host.querySelector('[data-block="drawer"]');
  if (nu) nu.setAttribute('data-for', String(st.open || ''));
  document.body.classList.toggle('mx-drawer-open', !!st.open);
  const ta = rootEl.querySelector('[data-role="title"]'); if (ta) autosize(ta);
}
function autosize(ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }
// the drawer keeps its own copy of the open card, so a card that leaves the current filter
// (re-assigned under MINE, archived) stays editable until it is closed
async function refetch() {
  if (!(await load()) || !rootEl) return;
  rerenderBoard();
}
function setUrl(id) { try { history.replaceState(history.state, '', id ? '/tasks/' + encodeURIComponent(id) : '/tasks'); } catch (e) {} }
// keyboard focus follows the drawer: in on open (the sheet itself — the title stays a field you choose to
// type in), and back to the card it came from on close (it was left on <body> both ways)
async function openDrawer(id) {
  st.open = id; st.detail = null; st.showActivity = false; st.commentDraft = ''; st.linkUrl = ''; st.linkLabel = '';
  setUrl(id);
  rerenderBoard(); rerenderDrawer();
  const sh = rootEl && rootEl.querySelector('[data-block="drawer"] > .mx-drawer-sheet');
  if (sh && !sh.contains(document.activeElement)) { try { sh.focus({ preventScroll: true }); } catch (e) {} }
  if (await loadDetail(id)) { rerenderDrawer(); rerenderBoard(); }
}
function closeDrawer() {
  const id = st.open;
  st.open = null; st.detail = null; setUrl(null); rerenderDrawer(); rerenderBoard();
  const card = id && rootEl && rootEl.querySelector(`.mx-task[data-id="${CSS.escape(String(id))}"]`);
  const a = document.activeElement;
  if (card && (!a || a === document.body || !rootEl.contains(a) || a.closest('[data-block="drawer-leaving"]'))) {
    if (!card.hasAttribute('tabindex')) card.setAttribute('tabindex', '0');
    try { card.focus({ preventScroll: true }); } catch (e) {}
  }
}
function patchLocal(task) {
  const i = D.tasks.findIndex(t => t.id === task.id);
  if (i >= 0) D.tasks[i] = Object.assign({}, D.tasks[i], task); else D.tasks.unshift(task);
  if (st.detail && st.detail.task.id === task.id) st.detail.task = Object.assign({}, st.detail.task, task);
}
async function setStatus(id, status, opts = {}) {
  const t = D.tasks.find(x => x.id === id) || (st.detail && st.detail.task.id === id ? st.detail.task : null);
  if (!t || t.status === status) return;
  const prev = t.status;
  patchLocal(Object.assign({}, t, { status }));
  rerenderBoard(); if (st.open === id) rerenderDrawer();
  try {
    const r = status === 'seen' ? await api.post('/api/v2/tasks/' + encodeURIComponent(id) + '/seen') : await api.put('/api/v2/tasks/' + encodeURIComponent(id), { status });
    if (r && r.task) patchLocal(r.task);
    if (st.open === id) await loadDetail(id);
    // a card leaves the MINE / <other>'s filter only when its assignee changes — status never hides it
    rerenderBoard(); if (st.open === id) rerenderDrawer();
    if (!opts.quiet) ui.toast(COPY.toast.moved(status, !t.created_by || t.created_by === me().id));   // your own task: no one else is told
    chrome.refresh();
  } catch (e) { patchLocal(Object.assign({}, t, { status: prev })); rerenderBoard(); if (st.open === id) rerenderDrawer(); ui.toast(e.message, { kind: 'error' }); }
}
// the drawer's WHO sends a change, never the whole set: `delta` = { tag: [id] } or { untag: [id] } (team
// row ids / user:<id>). The server applies it to the people on the task NOW, so a drawer that is behind
// (someone else changed the people meanwhile) or two quick taps never put back a person just taken off.
// While a save is in flight every × and the picker wait for it. Taking myself off a card I did not make
// takes it off my board — ask once, naming who keeps it.
function markPeopleBusy() {
  st.peopleBusy = true;
  const f = rootEl && rootEl.querySelector('[data-block="drawer"] [data-role="whoField"]');
  if (f) { f.setAttribute('aria-busy', 'true'); f.querySelectorAll('.mx-person-x, select').forEach(el => { el.disabled = true; }); }
}
async function savePeople(delta, what) {
  if (!st.open || !st.detail || st.peopleBusy) return;
  const t = st.detail.task;
  const cur = peopleOf(t);
  const tag = (delta.tag || []).filter(id => !cur.some(p => p.id === id));
  const untag = (delta.untag || []).filter(id => cur.some(p => p.id === id));
  if (!tag.length && !untag.length) return;
  markPeopleBusy();
  let saved = false;
  try {
    const leaving = cur.filter(p => untag.includes(p.id));
    if (leaving.some(isMePerson) && t.created_by !== me().id) {
      const stay = cur.filter(p => !untag.includes(p.id));
      const keep = seers([{ user_id: t.created_by, first: t.creator_first }].concat(stay));
      if (!(await ui.confirm(Object.assign({ eyebrow: 'PLEASE CONFIRM' }, COPY.confirm.handOff(keep))))) return;
    }
    const r = await api.put('/api/v2/tasks/' + encodeURIComponent(t.id), untag.length ? { untag } : { tag });
    if (r && r.handed_off) {
      // I am off it and it is no longer mine to see: close it and drop it from the board
      ui.toast(COPY.toast.handedOff);
      D.tasks = D.tasks.filter(x => x.id !== t.id);
      closeDrawer(); await refetch(); chrome.refresh();
      return;
    }
    if (r && r.task) patchLocal(r.task);
    ui.toast(what || COPY.toast.saved);
    await loadDetail(t.id);
    await load();   // a first-time pick gets a team row → the people list changes; MINE / FOR <name> may change
    saved = true;
  } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  finally { if (st) st.peopleBusy = false; }
  if (!st || !rootEl) return;
  if (saved) rerenderBoard();
  if (st.open) rerenderDrawer();   // the × and the picker answer again (and a cancelled pick resets)
  if (saved) {
    const pick = rootEl.querySelector('[data-role="who"]'); if (pick && document.activeElement === document.body) { try { pick.focus({ preventScroll: true }); } catch (e) {} }
    chrome.refresh();
  }
}
async function saveField(field, value) {
  if (!st.open || !st.detail) return;
  const t = st.detail.task;
  const cur = field === 'due_date' ? (t.due_date || '') : String(t[field] == null ? '' : t[field]);
  if (String(value) === cur) return;
  try {
    if (field === 'result_text') {
      const r = await api.put('/api/v2/tasks/' + encodeURIComponent(t.id) + '/result', { result_text: value });
      if (r && r.task) patchLocal(r.task);
      ui.toast(COPY.toast.resultSaved);
    } else {
      if (field === 'title' && !String(value).trim()) { ui.toast(COPY.add.typeFirst); return; }
      const r = await api.put('/api/v2/tasks/' + encodeURIComponent(t.id), { [field]: value });
      if (r && r.task) patchLocal(r.task);
      ui.toast(COPY.toast.saved);
    }
    await loadDetail(t.id);
    rerenderBoard();
    // fields keep focus; only the static parts of the drawer need redrawing
    const active = document.activeElement; const keep = active && active.matches && active.matches('[data-save]') ? active.dataset.role : null;
    rerenderDrawer();
    if (keep) { const el = rootEl.querySelector(`[data-role="${keep}"]`); if (el && el.focus) el.focus(); }
  } catch (e) { ui.toast(e.message, { kind: 'error' }); }
}
async function saveLinks(links) {
  const t = st.detail.task;
  try {
    const r = await api.put('/api/v2/tasks/' + encodeURIComponent(t.id) + '/result', { result_links: links });
    if (r && r.task) patchLocal(r.task);
    await loadDetail(t.id); rerenderBoard(); rerenderDrawer();
  } catch (e) { ui.toast(e.message, { kind: 'error' }); }
}
async function uploadFiles(fileList) {
  if (!st.detail || !fileList || !fileList.length) return;
  const t = st.detail.task;
  for (const f of Array.from(fileList)) {
    if (f.size > 25 * 1024 * 1024) { ui.toast(COPY.toast.tooBig, { kind: 'error' }); continue; }
    st.uploading = true; rerenderDrawer();
    try {
      const fd = new FormData(); fd.append('file', f, f.name);
      await api.post('/api/v2/tasks/' + encodeURIComponent(t.id) + '/files', fd);
      ui.toast(COPY.toast.uploaded(f.name.length > 40 ? f.name.slice(0, 38) + '…' : f.name));
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
    st.uploading = false;
  }
  await loadDetail(t.id); rerenderBoard(); rerenderDrawer();
}
function readAdd() {
  const v = role => { const el = rootEl.querySelector(`[data-role="${role}"]`); return el ? el.value : ''; };
  st.addTitle = v('addTitle'); st.addDue = v('addDue');
}
// the add bar's WHO changed: redraw the bar (the typed title and date ride along in st) and keep the
// keyboard where it was
function redrawAdd(focusRole) {
  readAdd();
  rerender('[data-block="add"]', blockAdd());
  const el = rootEl && (rootEl.querySelector(`[data-role="${focusRole}"]`) || rootEl.querySelector('[data-role="addTitle"]'));
  if (el) { try { el.focus({ preventScroll: true }); } catch (e) {} }
}

const handlers = {
  add: async (el) => {
    readAdd();
    const title = st.addTitle.trim();
    if (!title) { ui.toast(COPY.add.typeFirst); const i = rootEl.querySelector('[data-role="addTitle"]'); if (i) i.focus(); return; }
    el.setAttribute('aria-disabled', 'true');
    try {
      const r = await api.post('/api/v2/tasks', { title, assignees: st.addPeople || [], due_date: st.addDue || null, project: 'general' });
      st.addTitle = ''; st.addDue = '';
      ui.toast(COPY.add.added(r && r.task ? peopleOf(r.task).map(p => firstName(p)).filter(Boolean) : []));
      // a brand-new card must be visible: MINE hides one I am not on, FOR <name> one they are not on,
      // ARCHIVED hides everything live
      if (st.filter === 'archived' || (st.filter === 'mine' && r.task && !isMe(r.task)) || (st.filter === 'other' && r.task && counterpart() && !onCard(r.task, counterpart()))) st.filter = 'all';
      await refetch();
      rerender('[data-block="filters"]', blockFilters());
      rerender('[data-block="add"]', blockAdd());
      const i = rootEl.querySelector('[data-role="addTitle"]'); if (i) i.focus();
      chrome.refresh();
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  filter: async (el) => { st.filter = el.dataset.k; rerender('[data-block="filters"]', blockFilters()); await refetch(); },
  // WHO: a chip's × — in the add bar it only edits the pick; in the drawer it saves
  untagAdd: (el) => { st.addPeople = (st.addPeople || []).filter(id => id !== el.dataset.id); redrawAdd('addWho'); },
  untag: (el) => {
    if (!st.detail || st.peopleBusy || el.disabled) return;
    const t = st.detail.task; const gone = peopleOf(t).find(p => p.id === el.dataset.id);
    savePeople({ untag: [el.dataset.id] }, gone ? (isMePerson(gone) ? COPY.toast.left : COPY.toast.untagged(firstName(gone))) : null);
  },
  open: (el) => { const id = el.dataset.id; if (st.open === id) return; openDrawer(id); },
  close: () => closeDrawer(),
  start: () => setStatus(st.open, 'doing'),
  finish: () => setStatus(st.open, 'done'),
  markSeen: () => setStatus(st.open, 'seen'),
  reopen: () => setStatus(st.open, 'todo'),
  toggleActivity: () => { st.showActivity = !st.showActivity; rerenderDrawer(); },
  addLink: async () => {
    const u = rootEl.querySelector('[data-role="linkUrl"]'); const l = rootEl.querySelector('[data-role="linkLabel"]');
    let url = String(u ? u.value : '').trim(); const label = String(l ? l.value : '').trim();
    if (url && !/^https?:\/\//i.test(url) && /^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(url)) url = 'https://' + url;
    if (!/^https?:\/\/\S+$/i.test(url)) { ui.toast(COPY.toast.linkBad, { kind: 'error' }); if (u) u.focus(); return; }
    const links = (st.detail.task.result_links || []).concat([{ url, label }]);
    st.linkUrl = ''; st.linkLabel = '';
    await saveLinks(links);
    ui.toast(COPY.toast.linkAdded);
  },
  removeLink: async (el) => { const i = Number(el.dataset.i); const links = (st.detail.task.result_links || []).filter((_, k) => k !== i); await saveLinks(links); },
  removeFile: async (el) => {
    try { await api.del('/api/v2/tasks/files/' + encodeURIComponent(el.dataset.id)); ui.toast(COPY.toast.fileRemoved); await loadDetail(st.open); rerenderBoard(); rerenderDrawer(); }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  comment: async (el) => {
    const ta = rootEl.querySelector('[data-role="comment"]'); const body = String(ta ? ta.value : '').trim();
    if (!body) { ui.toast(COPY.toast.commentEmpty); if (ta) ta.focus(); return; }
    el.setAttribute('aria-disabled', 'true');
    try { await api.post('/api/v2/tasks/' + encodeURIComponent(st.open) + '/comments', { body }); st.commentDraft = ''; ui.toast(COPY.toast.commented); await loadDetail(st.open); rerenderBoard(); rerenderDrawer(); }
    catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  archive: async () => {
    const id = st.open;
    try { await api.post('/api/v2/tasks/' + encodeURIComponent(id) + '/archive'); ui.toast(COPY.toast.archived); closeDrawer(); await refetch(); chrome.refresh(); }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  unarchive: async () => {
    const id = st.open;
    try { await api.post('/api/v2/tasks/' + encodeURIComponent(id) + '/unarchive'); ui.toast(COPY.toast.unarchived); closeDrawer(); await refetch(); chrome.refresh(); }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  del: async () => {
    const id = st.open;
    if (!await ui.confirm(Object.assign({ eyebrow: 'PLEASE CONFIRM' }, COPY.confirm.del))) return;
    try { await api.del('/api/admin/tasks/' + encodeURIComponent(id)); ui.toast(COPY.toast.deleted); closeDrawer(); await refetch(); chrome.refresh(); }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
  }
};

// keyboard + change + drag listeners on the view root (they survive every innerHTML swap)
function bindRootListeners(root) {
  let qTimer = null;
  const onInput = e => {
    const t = e.target; if (!t || !t.matches) return;
    if (t.matches('[data-role="search"]')) { st.q = t.value; clearTimeout(qTimer); qTimer = setTimeout(() => refetch(), 220); return; }
    if (t.matches('[data-role="title"]')) autosize(t);
    if (t.matches('[data-role="addTitle"]')) st.addTitle = t.value;
    if (t.matches('[data-role="comment"]')) st.commentDraft = t.value;
    if (t.matches('[data-role="linkUrl"]')) st.linkUrl = t.value;
    if (t.matches('[data-role="linkLabel"]')) st.linkLabel = t.value;
  };
  const onChange = e => {
    const t = e.target; if (!t || !t.matches) return;
    if (t.matches('[data-role="file"]')) { uploadFiles(t.files); return; }
    if (t.matches('[data-role="addWho"]')) {
      const v = t.value; if (!v) return;
      if (!(st.addPeople || []).includes(v) && (st.addPeople || []).length < MAX_PEOPLE) st.addPeople = (st.addPeople || []).concat([v]);
      redrawAdd('addWho'); return;
    }
    if (t.matches('[data-role="who"]')) {
      const v = t.value; if (!v || !st.detail || st.peopleBusy) return;
      const cur = peopleOf(st.detail.task);
      if (cur.length >= MAX_PEOPLE) { ui.toast(COPY.toast.tooMany(MAX_PEOPLE), { kind: 'error' }); return; }
      const p = personById(v);
      savePeople({ tag: [v] }, p ? (isMePerson(p) ? COPY.toast.joined : COPY.toast.tagged(firstName(p))) : null);
      return;
    }
    if (t.matches('select[data-save], input[type="date"][data-save]')) saveField(t.dataset.save, t.value);
  };
  const onBlur = e => {
    const t = e.target; if (!t || !t.matches) return;
    if (t.matches('textarea[data-save]')) saveField(t.dataset.save, t.value);
  };
  const onKey = e => {
    const t = e.target;
    if (e.key === 'Escape' && st.open) { if (t && t.matches && t.matches('textarea[data-save]')) t.blur(); closeDrawer(); return; }
    if (e.key === 'Enter' && t && t.matches) {
      if (t.matches('[data-role="addTitle"]')) { e.preventDefault(); const b = root.querySelector('[data-act="add"]'); if (b) handlers.add(b); }
      else if (t.matches('[data-role="title"]')) { e.preventDefault(); t.blur(); }
      else if (t.matches('[data-role="linkUrl"], [data-role="linkLabel"]')) { e.preventDefault(); handlers.addLink(); }
      else if ((e.metaKey || e.ctrlKey) && t.matches('[data-role="comment"]')) { e.preventDefault(); const b = root.querySelector('[data-act="comment"]'); if (b) handlers.comment(b); }
      else if ((e.metaKey || e.ctrlKey) && t.matches('textarea[data-save]')) { e.preventDefault(); t.blur(); }
    }
  };
  // HTML5 drag-and-drop between columns (phones use the drawer buttons)
  const onDragStart = e => {
    const card = e.target.closest && e.target.closest('.mx-task'); if (!card) return;
    st.dragging = card.dataset.task; card.classList.add('dragging');
    try { e.dataTransfer.setData('text/plain', st.dragging); e.dataTransfer.effectAllowed = 'move'; } catch (err) {}
  };
  const onDragEnd = () => { st.dragging = null; root.querySelectorAll('.mx-task.dragging').forEach(c => c.classList.remove('dragging')); root.querySelectorAll('.mx-col.over').forEach(c => c.classList.remove('over')); };
  const onDragOver = e => {
    const col = e.target.closest && e.target.closest('.mx-col');
    if (st.dragging && col) { e.preventDefault(); try { e.dataTransfer.dropEffect = 'move'; } catch (err) {} root.querySelectorAll('.mx-col.over').forEach(c => { if (c !== col) c.classList.remove('over'); }); col.classList.add('over'); return; }
    const zone = e.target.closest && e.target.closest('.mx-drop');
    if (zone && !st.dragging) { e.preventDefault(); zone.classList.add('over'); }
  };
  const onDragLeave = e => { const col = e.target.closest && e.target.closest('.mx-col'); if (col && !col.contains(e.relatedTarget)) col.classList.remove('over'); const zone = e.target.closest && e.target.closest('.mx-drop'); if (zone && !zone.contains(e.relatedTarget)) zone.classList.remove('over'); };
  const onDrop = e => {
    const col = e.target.closest && e.target.closest('.mx-col');
    if (st.dragging && col) { e.preventDefault(); const id = st.dragging; const status = col.dataset.col; onDragEnd(); if (STATUSES.includes(status)) setStatus(id, status); return; }
    const zone = e.target.closest && e.target.closest('.mx-drop');
    if (zone && e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) { e.preventDefault(); zone.classList.remove('over'); uploadFiles(e.dataTransfer.files); }
  };
  root.addEventListener('input', onInput);
  root.addEventListener('change', onChange);
  root.addEventListener('focusout', onBlur);
  root.addEventListener('keydown', onKey);
  // Escape closes the drawer wherever focus is (after a mouse click it sits on <body>, outside the view)
  const onDocKey = e => { if (e.key === 'Escape' && st.open && !(root.contains && root.contains(e.target))) closeDrawer(); };
  document.addEventListener('keydown', onDocKey);
  root.addEventListener('dragstart', onDragStart);
  root.addEventListener('dragend', onDragEnd);
  root.addEventListener('dragover', onDragOver);
  root.addEventListener('dragleave', onDragLeave);
  root.addEventListener('drop', onDrop);
  return () => {
    clearTimeout(qTimer);
    root.removeEventListener('input', onInput); root.removeEventListener('change', onChange); root.removeEventListener('focusout', onBlur); root.removeEventListener('keydown', onKey); document.removeEventListener('keydown', onDocKey);
    root.removeEventListener('dragstart', onDragStart); root.removeEventListener('dragend', onDragEnd); root.removeEventListener('dragover', onDragOver); root.removeEventListener('dragleave', onDragLeave); root.removeEventListener('drop', onDrop);
  };
}

export default {
  title: 'Tasks',
  async render(root, ctx) {
    rootEl = root; loadCss();
    st = { filter: 'all', q: '', open: null, detail: null, addTitle: '', addPeople: null, addDue: '', commentDraft: '', linkUrl: '', linkLabel: '', showActivity: false, uploading: false, dragging: null, peopleBusy: false };
    D = null;
    try { await load(); } catch (e) { root.innerHTML = `<div class="empty" style="padding:60px 20px"><span style="width:28px;height:1px;background:#c9a962"></span><span class="empty-line">The board did not load.</span><span class="empty-why">${esc(e.message)}</span></div>`; return; }
    if (rootEl !== root) return;
    root.innerHTML = template();
    unbind = ui.bind(root, handlers);
    unlisten = bindRootListeners(root);
    if (ctx.params && ctx.params.id) openDrawer(ctx.params.id);
    if (ctx.query && ctx.query.new === '1') { const i = root.querySelector('[data-role="addTitle"]'); if (i) i.focus(); }
    // the other person's moves arrive on their own — a quiet refresh while nothing is being dragged or typed,
    // the open drawer's card included (its people, result, comments and file links), so a drawer left open
    // never works from a set that is long gone
    const typing = () => { const a = document.activeElement; return !!(a && a.matches && a.matches('input, textarea, select') && rootEl && rootEl.contains(a)); };
    poll = setInterval(async () => {
      if (document.hidden || st.dragging || typing()) return;
      refetch();
      const id = st.open;
      if (!id || !st.detail || st.peopleBusy || st.uploading) return;
      if (await loadDetail(id, { quiet: true }) && st && st.open === id && !st.peopleBusy && !typing()) rerenderDrawer();
    }, POLL_MS);
    chrome.refresh();
  },
  destroy() {
    reqId++; if (poll) clearInterval(poll); poll = null;
    if (unbind) unbind(); if (unlisten) unlisten(); unbind = null; unlisten = null;
    document.body.classList.remove('mx-drawer-open');
    rootEl = null; D = null; st = null;
  }
};
