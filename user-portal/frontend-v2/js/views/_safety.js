// js/views/_safety.js — REPORT + BLOCK, shared by Network (js/views/network.js), Messages
// (js/views/messages.js) and the header search (js/chrome.js). App Store guideline 1.2: member profiles and
// member-to-member messages are user-generated content, so every person and every member thread carries a
// quiet ⋯ with REPORT and BLOCK, and every message a member RECEIVED carries its own small ⋯ (REPORT that one
// message). Backend: user-portal/backend/v2/safety.js — POST /api/v2/safety/report · POST /api/v2/safety/block ·
// DELETE /api/v2/safety/block/:userId · GET /api/v2/safety/blocks. Nothing here emails anyone; reports
// land in the admin People screen. Look: css/views/safety.css (injected on first use).
//
//   import { moreButton, msgMoreButton, openMenu, reportSheet, blockFlow, openBlockedList } from './_safety.js';
//   moreButton({ id, name })                      → the ⋯ trigger (data-act="more" — the view's ui.bind routes it)
//   msgMoreButton({ id, name })                   → the ⋯ on a received bubble (data-act="msgMore", data-id = message id)
//   openMenu(anchorEl, [{ label, tone, onPick }]) → a small popover menu under the trigger
//   await reportSheet({ kind: 'member'|'message', targetId, name, excerpt? })   → true when a report went out
//   await blockFlow({ id, name })                → the server's answer after the confirm, or null
//   openBlockedList({ onUnblock })               → the "Blocked members" sheet with UNBLOCK per row
//   knownBlocks() / loadBlocks() / rememberBlocks(list) → the member's own block list, cached for this sign-in
//                                                   (the header search leaves those people out)
import { api } from '../api.js';
import { state } from '../state.js';
import { ui, esc, fmt } from '../ui.js';

// member-facing copy — reason keys must match shared/safety-core.js › REASONS
export const SAFETY = {
  more: name => `More actions for ${name}`,
  msgMore: name => `Report this message from ${name}`, msgMoreTitle: 'Report this message',
  menu: { report: 'REPORT', block: 'BLOCK' },
  contact: 'info@medx.hr',
  report: {
    eyebrow: 'REPORT · NETWORK', eyebrowMsg: 'REPORT · MESSAGES',
    titleMember: name => `Report ${name}`, titleMessage: 'Report this message',
    leadMember: who => `Tell the Med&amp;X team what is wrong with this profile. ${who} is never told who reported them.`,
    leadMessage: who => `The team sees this message, the other recent messages ${who} sent you, and your note. ${who} is never told who reported them.`,
    quoteLabel: 'THE MESSAGE',
    reasonLabel: 'WHAT IS WRONG?',
    reasons: [['spam', 'SPAM'], ['harassment', 'HARASSMENT'], ['inappropriate', 'INAPPROPRIATE'], ['impersonation', 'IMPERSONATION'], ['other', 'OTHER']],
    noteLabel: 'ANYTHING TO ADD?', optional: 'OPTIONAL', notePh: 'What happened, in a sentence or two.',
    foot: mail => `The Med&amp;X team reviews every report within 24 hours. Urgent? Email <a href="mailto:${mail}">${mail}</a>.`,
    cancel: 'CANCEL', send: 'SEND REPORT',
    pickFirst: 'Pick what is wrong first.',
    sent: 'Report sent — the Med&X team will review it.',
    duplicate: 'You already reported this — the team has it.'
  },
  block: {
    eyebrow: 'BLOCK · NETWORK',
    title: name => `Block ${name}?`,
    body: who => `${who} won’t be able to find you in the network or message you, and your connection ends. They are not told. You can unblock them any time under Blocked members in Network.`,
    ok: 'BLOCK', cancel: 'CANCEL',
    done: name => `${name} is blocked.`
  },
  list: {
    eyebrow: 'NETWORK · BLOCKED', title: 'Blocked members',
    sub: 'They can’t find you or message you. Unblocking lets you find each other again. Your old connection does not come back — send a new request if you want one.',
    empty: 'No one is blocked.',
    unblock: 'UNBLOCK', close: 'CLOSE',
    since: when => `Blocked ${when}`,
    undone: name => `${name} is unblocked.`
  },
  link: n => `BLOCKED MEMBERS · ${n}`
};

const NOTE_MAX = 500;

export function ensureCss() {
  if (document.querySelector('link[data-view-css="safety"]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = '/css/views/safety.css'; l.setAttribute('data-view-css', 'safety');
  document.head.appendChild(l);
}

// ---------------------------------------------------------------- the ⋯ trigger
// Three small squares (the brand is rectangular — no round dots). `data-act="more"` is routed by the
// calling view's own ui.bind; the view resolves the member from data-id.
const DOTS = '<svg width="15" height="3" viewBox="0 0 15 3" aria-hidden="true" focusable="false"><rect x="0" width="3" height="3"/><rect x="6" width="3" height="3"/><rect x="12" width="3" height="3"/></svg>';
export function moreButton({ id, name, cls = '' }) {
  ensureCss();
  return `<span data-act="more" data-id="${esc(id)}" role="button" tabindex="0" aria-haspopup="menu" aria-expanded="false" aria-label="${esc(SAFETY.more(name || 'this member'))}" title="Report or block" class="mx-safe-more${cls ? ' ' + cls : ''}">${DOTS}</span>`;
}
// the ⋯ on a message the member RECEIVED — it opens the report sheet for that one message. Desktop: shows
// when the pointer is on the bubble (or it has focus); touch: always there, quiet (css .mx-safe-more.is-msg).
export function msgMoreButton({ id, name }) {
  ensureCss();
  return `<span data-act="msgMore" data-id="${esc(id)}" role="button" tabindex="0" aria-haspopup="dialog" aria-label="${esc(SAFETY.msgMore(name || 'this member'))}" title="${SAFETY.msgMoreTitle}" class="mx-safe-more is-msg">${DOTS}</span>`;
}

// ---------------------------------------------------------------- the member's own block list (cached)
// Filled by whichever screen reads GET /api/v2/safety/blocks first (Network, the Blocked members sheet, the
// header search) and kept in step by BLOCK / UNBLOCK here. It is the blocker's own list only — the server
// already hides both directions everywhere it lists people; this is the header search's second line.
// Matched by account id only: two members can share a name, and a name match hid the wrong person.
let blockCache = null, blockLoading = null;
export function rememberBlocks(list) {
  const rows = Array.isArray(list) ? list : [];
  blockCache = { ids: new Set(rows.map(b => String(b.user_id))) };
  return blockCache;
}
export function knownBlocks() { return blockCache; }
export function forgetBlocks() { blockCache = null; }      // after an UNBLOCK made elsewhere — the next read refills it
export function loadBlocks() {
  if (blockCache) return Promise.resolve(blockCache);
  if (!blockLoading) {
    blockLoading = api.get('/api/v2/safety/blocks')
      .then(r => rememberBlocks((r && r.blocks) || []))
      .catch(() => null)
      .finally(() => { blockLoading = null; });
  }
  return blockLoading;
}
export function isKnownBlocked({ id } = {}) {
  if (!blockCache || id == null || id === '') return false;
  return blockCache.ids.has(String(id));
}
// a new sign-in (or a sign-out) starts from an empty cache
state.subscribe((s, keys) => { if (keys.includes('token')) { blockCache = null; blockLoading = null; } });

// ---------------------------------------------------------------- popover menu
let menu = null;             // { el, anchor, close }
let lastClosed = { anchor: null, at: 0 };
export function closeMenu(focusBack) { if (menu) menu.close(focusBack); }
export function openMenu(anchor, items) {
  ensureCss();
  // a second click on the same trigger closes it (its pointerdown already did — don't reopen)
  if (lastClosed.anchor === anchor && performance.now() - lastClosed.at < 350) return;
  closeMenu(false);
  const el = document.createElement('div');
  el.className = 'mx-safe-menu';
  el.setAttribute('role', 'menu');
  el.innerHTML = items.map((it, i) => `<span data-i="${i}" role="menuitem" tabindex="-1" class="mx-safe-item${it.tone === 'danger' ? ' is-danger' : ''}">${esc(it.label)}</span>`).join('');
  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect();
  const vw = document.documentElement.clientWidth, vh = window.innerHeight;
  const w = el.offsetWidth, h = el.offsetHeight;
  const left = Math.max(12, Math.min(r.right - w, vw - w - 12));
  let top = r.bottom + 6;
  if (top + h > vh - 12) { top = r.top - h - 6; el.classList.add('is-up'); }
  el.style.left = Math.round(left) + 'px';
  el.style.top = Math.round(Math.max(12, top)) + 'px';
  anchor.setAttribute('aria-expanded', 'true');

  const itemsEls = () => Array.from(el.querySelectorAll('[role="menuitem"]'));
  // the picked line is removed with the menu: focus steps back to ⋯ first, so the sheet an item opens (REPORT,
  // BLOCK) returns focus there when it closes instead of dropping it on <body>
  const pick = (i) => { close(false); if (anchor.isConnected) { try { anchor.focus({ preventScroll: true }); } catch (e) {} } const it = items[i]; if (it && it.onPick) it.onPick(); };
  const onDown = e => { if (!el.contains(e.target)) { if (anchor.contains(e.target)) lastClosed = { anchor, at: performance.now() }; close(false); } };
  const onKey = e => {
    const list = itemsEls(); const i = list.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); close(true); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]; if (n) n.focus(); }
    else if ((e.key === 'Enter' || e.key === ' ') && i >= 0) { e.preventDefault(); pick(i); }
    else if (e.key === 'Tab') close(false);
  };
  const onAway = () => close(false);
  el.addEventListener('click', e => { const it = e.target.closest('[data-i]'); if (it) pick(Number(it.dataset.i)); });
  function close(focusBack) {
    if (!menu || menu.el !== el) return;
    menu = null;
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', onAway, true);
    window.removeEventListener('resize', onAway);
    anchor.setAttribute('aria-expanded', 'false');
    if (focusBack && anchor.isConnected) anchor.focus();
    if (ui.reducedMotion()) { el.remove(); return; }
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 230);   // the exit (--t-exit) and a frame
  }
  menu = { el, anchor, close };
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('scroll', onAway, true);
  window.addEventListener('resize', onAway);
  const first = itemsEls()[0]; if (first) first.focus({ preventScroll: true });
}

// ---------------------------------------------------------------- report sheet
export function reportSheet({ kind = 'member', targetId, name, excerpt = '' }) {
  ensureCss();
  // the full name in every sentence: a first word alone can mislead ("Med&X is never told…" for "Med&X Demo Peer")
  const R = SAFETY.report, first = String(name || '').trim() || 'This member', isMsg = kind === 'message';
  return new Promise(resolve => {
    let reason = null, busy = false, settled = false;
    const finish = v => { if (!settled) { settled = true; resolve(v); } };
    const body = `
      <div class="mx-safe-sheet">
        <p class="mx-safe-lead">${isMsg ? R.leadMessage(esc(first)) : R.leadMember(esc(first))}</p>
        ${isMsg && excerpt ? `<div class="mx-safe-quote"><span class="mx-safe-label">${R.quoteLabel}</span><span class="mx-safe-quote-text">“${esc(String(excerpt).slice(0, 220))}${String(excerpt).length > 220 ? '…' : ''}”</span></div>` : ''}
        <span class="mx-safe-label" id="mx-safe-reason-label">${R.reasonLabel}</span>
        <div class="mx-safe-reasons" role="radiogroup" aria-labelledby="mx-safe-reason-label">
          ${R.reasons.map(([key, label]) => `<span data-act="reason" data-reason="${key}" class="chip" role="radio" aria-checked="false" tabindex="0">${label}</span>`).join('')}
        </div>
        <label class="mx-safe-label" for="mx-safe-note">${R.noteLabel} <span class="mx-safe-opt">· ${R.optional}</span></label>
        <textarea id="mx-safe-note" class="input mx-safe-note" rows="3" maxlength="${NOTE_MAX}" placeholder="${esc(R.notePh)}"></textarea>
        <span class="mx-safe-count" aria-live="off">0 / ${NOTE_MAX}</span>
        <p class="mx-safe-foot">${R.foot(SAFETY.contact)}</p>
      </div>`;
    const m = ui.modal({
      eyebrow: isMsg ? R.eyebrowMsg : R.eyebrow,
      title: esc(isMsg ? R.titleMessage : R.titleMember(name || 'this member')),
      body,
      actions: [{ label: R.cancel, onClick: () => finish(false) }, { label: R.send, kind: 'primary', onClick: () => { send(); return false; } }]
    });
    m.onClose(() => finish(false));
    m.el.classList.add('mx-safe-modal');
    const sendBtn = m.el.querySelector('.mx-modal-foot [data-act="a1"]');
    const note = m.el.querySelector('.mx-safe-note');
    const count = m.el.querySelector('.mx-safe-count');
    note.addEventListener('input', () => { count.textContent = `${note.value.length} / ${NOTE_MAX}`; });
    ui.bind(m.el, {
      reason: (el) => {
        reason = el.dataset.reason;
        m.el.querySelectorAll('[data-act="reason"]').forEach(c => { const on = c === el; c.classList.toggle('on', on); c.setAttribute('aria-checked', String(on)); });
        m.el.querySelector('.mx-safe-reasons').classList.remove('is-missing');
      }
    });
    async function send() {
      if (busy) return;
      if (!reason) {
        const box = m.el.querySelector('.mx-safe-reasons');
        box.classList.remove('is-missing'); void box.offsetWidth; box.classList.add('is-missing');
        const c = box.querySelector('[data-act="reason"]'); if (c) c.focus();
        ui.toast(R.pickFirst, { kind: 'error' });
        return;
      }
      busy = true; if (sendBtn) sendBtn.setAttribute('aria-disabled', 'true');
      try {
        const r = await api.post('/api/v2/safety/report', { target_kind: isMsg ? 'message' : 'member', target_id: targetId, reason, note: note.value.trim() });
        finish(true);
        m.close();
        ui.toast(r && r.duplicate ? R.duplicate : R.sent);
      } catch (e) {
        busy = false; if (sendBtn) sendBtn.removeAttribute('aria-disabled');
        ui.toast(e.message, { kind: 'error' });
      }
    }
  });
}

// ---------------------------------------------------------------- block (confirm → POST)
export async function blockFlow({ id, name }) {
  const B = SAFETY.block;
  const ok = await ui.confirm({ eyebrow: B.eyebrow, title: esc(B.title(name || 'this member')), body: `<p style="margin:0">${esc(B.body(String(name || '').trim() || 'This member'))}</p>`, ok: B.ok, cancel: B.cancel, danger: true });
  if (!ok) return null;
  try {
    const r = await api.post('/api/v2/safety/block', { user_id: id });
    if (blockCache) blockCache.ids.add(String(id));
    ui.toast(B.done(name || 'This member'));
    return r || { success: true };
  } catch (e) { ui.toast(e.message, { kind: 'error' }); return null; }
}

// ---------------------------------------------------------------- blocked members (UNBLOCK)
function ago(v) {
  const d = fmt.toDate(v); if (!d) return '';
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : days < 30 ? days + ' days ago' : fmt.shortDate(d);
}
export async function openBlockedList({ onUnblock } = {}) {
  ensureCss();
  const L = SAFETY.list;
  let blocks = [];
  try { blocks = ((await api.get('/api/v2/safety/blocks')) || {}).blocks || []; rememberBlocks(blocks); }
  catch (e) { ui.toast(e.message, { kind: 'error' }); return; }
  const rows = () => blocks.length ? blocks.map(b => `
      <div class="mx-safe-row" data-row="${esc(b.user_id)}">
        ${ui.portrait({ name: b.name || [b.first_name, b.last_name].filter(Boolean).join(' '), src: b.photo_url ? (String(b.photo_url).startsWith('/') ? api.url(b.photo_url) : b.photo_url) : '', size: 44, alt: '' })}
        <span class="mx-safe-who"><span class="mx-safe-name">${esc(b.name)}</span><span class="mx-safe-sub">${esc([b.institution, L.since(ago(b.created_at))].filter(Boolean).join(' · '))}</span></span>
        <span data-act="unblock" data-id="${esc(b.user_id)}" data-name="${esc(b.name)}" class="btn-ghost btn-sm mx-safe-unblock">${L.unblock}</span>
      </div>`).join('') : `<p class="mx-safe-empty">${L.empty}</p>`;
  const m = ui.modal({
    eyebrow: L.eyebrow, title: L.title,
    body: `<p class="mx-safe-lead">${esc(L.sub)}</p><div data-role="safe-rows" class="mx-safe-rows">${rows()}</div>`,
    actions: [{ label: L.close }]
  });
  m.el.classList.add('mx-safe-modal');
  ui.bind(m.el, {
    unblock: async (el) => {
      const id = el.dataset.id, name = el.dataset.name;
      el.setAttribute('aria-disabled', 'true');
      try {
        await api.del('/api/v2/safety/block/' + encodeURIComponent(id));
        blocks = blocks.filter(b => b.user_id !== id);
        rememberBlocks(blocks);
        const box = m.el.querySelector('[data-role="safe-rows"]'); if (box) box.innerHTML = rows();
        ui.toast(L.undone(name));
        if (onUnblock) onUnblock(id, blocks.length);
      } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
    }
  });
}

export default { SAFETY, ensureCss, moreButton, msgMoreButton, openMenu, closeMenu, reportSheet, blockFlow, openBlockedList, knownBlocks, loadBlocks, rememberBlocks, forgetBlocks, isKnownBlocked };
