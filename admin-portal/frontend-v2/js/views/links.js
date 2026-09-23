// Source: Admin Links.dc.html
// Blocks (artboard order): "Title row" (← PLEXUS WEEK · Invitations & links) › "LIVE LINKS" list
// (kind tag · name · counts · PAUSE/RESUME · url · COPY · QR) › "NEW LINK" creator panel.
// The header is js/chrome.js.
// Data: the THREE existing link systems, listed and created through their existing routes —
//   registration_links            GET/POST /api/admin/registration-links   (PUBLIC + VIP, any event)
//   gala_invite_links             GET/POST /api/admin/gala/invite-links    (PUBLIC + VIP, Gala)
//   croatians_abroad_invite_links GET/POST /api/admin/croatians-abroad/invite-links (DIASPORA)
// plus backend/v2/links.js for PAUSE/RESUME in both directions, bulk archive and the print-ready QR.
// Sign-up counts are the tables' real uses/used_count; per-link VISIT counts have no backend
// concept yet (gap matrix) — not shown rather than faked. SPONSOR table-booking links have no
// backend concept either — the creator says so instead of inventing a row (PARTIAL, reported).
// Audit 2026-09-02 #8: rows whose URL interpolated a NULL token ("/plexus/null" — legacy
// slugless registration_links rows; the builder sits in server.js, out of bounds) are flagged
// BROKEN and rest with paused + expired links in a collapsed ARCHIVED section; exact live twins
// collapse visually under their canonical row with a "duplicate of →" note; checkboxes feed
// ARCHIVE N SELECTED → POST /api/v2/links/bulk-archive; the creator refuses to keep a link the
// server minted slugless.
// Task J: twins are keyed on system · audience · name · BUNDLE (component_keys, normalised) ·
// EXPIRY DAY — a shared label with a different offering or expiry is no longer a "duplicate".
// Every row prints `bundle · expires · …last-6-of-token` so two same-named links can be told
// apart, and registration links rename inline (RENAME → input → SAVE/CANCEL, Enter/Escape)
// through PUT /api/admin/registration-links/:id {label}.
import { api } from '../api.js';
import { ui, esc, fmt } from '../ui.js';
import { FACTS } from '../facts.js';
import router from '../router.js';

export const SOURCE = 'Admin Links.dc.html';

export const COPY = {
  back: '← PLEXUS WEEK', title: 'Invitations &amp; <i>links</i>',
  sub: 'One link per audience — paid, VIP, diaspora, sponsors. Share it anywhere; every sign-up lands in <a href="/registrations">Registrations</a> tagged with its source.',
  live: { title: 'LIVE LINKS', sub: 'every sign-up is counted per link', foot: 'Pausing a link keeps its history — the page it opens simply says registration is closed.', empty: 'No links yet.', emptyWhy: 'Create the first one on the right — it is live the moment it exists.' },
  stats: { signups: n => `${n} sign-up${n === 1 ? '' : 's'}`, limit: n => `limit ${n}`, expired: 'expired', paused: 'paused', created: w => `created ${w}` },
  row: { copy: 'COPY', copied: '✓ COPIED', qr: 'QR', qrTitle: 'A print-ready QR of this link', pause: 'PAUSE', resume: 'RESUME', tick: 'Select for bulk archive',
    rename: 'RENAME', renameTitle: 'Rename this link — its history and URL stay the same', save: 'SAVE', cancel: 'CANCEL', renamePh: 'Name this link', renameLabel: 'New name for this link' },
  // Task J — the per-row identity line: what the link sells · when it dies · which token it is
  meta: {
    expires: d => `expires ${d}`, noExpiry: 'no expiry', noBundle: 'no bundle', noToken: 'no token',
    title: 'Bundle offered · expiry · the last 6 characters of the token',
    comp: { conference: 'Conference', gala: 'Gala', bridges: 'Bridges', reception: 'Reception', workshop: 'Workshop', day1: 'Day 1', day2: 'Day 2' }
  },
  // audit #8 — bulk archive (checkbox → ARCHIVE N), the collapsed ARCHIVED section, duplicate collapse
  bulk: {
    btn: n => `ARCHIVE ${n} SELECTED`,
    confirm: n => ({ title: `Archive ${n === 1 ? 'this link' : n + ' links'}?`, body: 'Archiving pauses them — the sign-up history stays, their pages say registration is closed, and RESUME brings a paused link back.', ok: 'ARCHIVE', cancel: 'KEEP' }),
    done: n => `${n} ARCHIVED — HISTORY KEPT, THE PAGES NOW SAY REGISTRATION IS CLOSED`,
    none: 'TICK AT LEAST ONE LINK FIRST'
  },
  arch: {
    title: n => `ARCHIVED (${n})`, show: 'SHOW', hide: 'HIDE',
    reason: { broken: 'BROKEN', expired: 'EXPIRED', paused: 'PAUSED' },
    brokenWhy: 'Minted without a slug — the URL ends in /null and opens nothing. Create a fresh link instead; any printed QR of this one is dead.',
    foot: 'Paused, expired and broken links rest here with their history. RESUME re-opens a paused link.'
  },
  dup: { tag: 'DUPLICATE', of: 'duplicate of →' },
  form: {
    title: 'NEW LINK', event: 'EVENT', kind: 'WHO IS IT FOR', limit: 'USE LIMIT · OPTIONAL', limitPh: 'e.g. 10 — blank for unlimited',
    note: 'NOTE TO YOURSELF · OPTIONAL', notePh: 'e.g. for the embassy mailing list', create: 'CREATE THE LINK',
    foot: 'The link is live the moment it\'s created — copy it from the list. VIP links skip payment entirely; sponsor links open the table-booking form.',
    kinds: [['PUBLIC', 'PUBLIC — pays full price'], ['VIP', 'VIP — free, named guests'], ['DIASPORA', 'DIASPORA — special rate'], ['SPONSOR', 'SPONSOR — table booking']],
    events: [['gala', 'Gala Evening'], ['plexus', 'Plexus Conference'], ['boston', 'Building Bridges Boston'], ['donor', 'Donor Night'], ['forum', 'Forum gathering 2027']]
  },
  qrModal: { eyebrow: 'PRINT-READY QR', download: 'DOWNLOAD PNG', hint: 'Scanning it opens the registration page for this link.' },
  toast: {
    copied: 'LINK COPIED — PASTE IT ANYWHERE', copyFail: 'COPY BLOCKED BY THE BROWSER — SELECT THE URL AND COPY IT',
    created: 'LINK CREATED — IT IS LIVE NOW, COPY IT FROM THE LIST',
    brokenCreated: 'THE SERVER MINTED A LINK WITHOUT A SLUG (…/null) — ARCHIVED IT ON THE SPOT, NOTHING TO SHARE',
    paused: 'PAUSED — THE PAGE NOW SAYS REGISTRATION IS CLOSED', resumed: 'LINK LIVE AGAIN',
    sponsor: 'SPONSOR TABLE-BOOKING LINKS HAVE NO BACKEND YET — PLEDGES LAND IN MONEY → SPONSORS & DONORS FOR NOW',
    diasporaEvent: 'DIASPORA LINKS OPEN THE MULTI-EVENT PLEXUS EXPERIENCE FORM — THE EVENT NOTE IS KEPT ON THE LABEL',
    limitBad: 'THE USE LIMIT MUST BE A NUMBER',
    renamed: 'RENAMED — THE URL, QR AND SIGN-UP HISTORY ARE UNCHANGED', renameEmpty: 'A LINK NEEDS A NAME'
  }
};

// artboard kindStyle, verbatim
const KIND_STYLE = { PUBLIC: ['#eee9df', '#4a4239'], VIP: ['#f1e7d4', '#7a6432'], DIASPORA: ['#e8eef7', '#2c4a73'], SPONSOR: ['#e4efe7', '#22563a'] };

let D = null, st = null, unbind = null, unkey = null, rootEl = null, reqId = 0;

function loadCss() {
  if (!document.getElementById('mx-css-links')) {
    const l = document.createElement('link'); l.id = 'mx-css-links'; l.rel = 'stylesheet'; l.href = '/css/views/links.css'; document.head.appendChild(l);
  }
}

// ---------------------------------------------------------------- data
async function load() {
  const my = ++reqId;
  const r = await api.settle({
    reg: api.get('/api/admin/registration-links'),
    gala: api.get('/api/admin/gala/invite-links'),
    ca: api.get('/api/admin/croatians-abroad/invite-links'),
    bridges: api.get('/api/bridges/events')
  });
  if (my !== reqId) return false;
  const links = [];
  // label = the stored label (null when never named) · name = what the row shows · bundle = the
  // normalised component_keys (registration links only; the invite tables have no bundle concept)
  (Array.isArray(r.reg) ? r.reg : []).forEach(l => links.push({
    kindKey: 'registration', id: l.id, token: l.token || null,
    kind: l.link_type === 'vip' ? 'VIP' : 'PUBLIC',
    label: l.label || null, name: l.label || (l.event_name ? l.event_name + ' — link' : 'Invitation link'),
    note: l.notes || '', url: l.url || '', uses: Number(l.uses) || 0, max: Number(l.max_uses) || 0,
    paused: Number(l.is_active) === 0, expired: !!(l.expires_at && new Date(l.expires_at) < new Date()),
    created: l.created_at, event: l.event_type || '', eventName: l.event_name || '',
    bundle: bundleOf(l.component_keys), expires: l.expires_at || null
  }));
  (Array.isArray(r.gala) ? r.gala : []).forEach(l => links.push({
    kindKey: 'gala', id: l.id, token: l.id,
    kind: l.link_type === 'vip' ? 'VIP' : 'PUBLIC',
    label: l.label || null, name: l.label || (FACTS.gala.name + ' — invite link'),
    note: l.notes || '', url: l.url || '', uses: Number(l.used_count) || 0, max: Number(l.max_uses) || 0,
    paused: Number(l.revoked) === 1, expired: !!(l.expires_at && new Date(l.expires_at) < new Date()),
    created: l.created_at, event: 'gala', eventName: FACTS.gala.name,
    bundle: [], expires: l.expires_at || null
  }));
  (Array.isArray(r.ca) ? r.ca : []).forEach(l => links.push({
    kindKey: 'croatians', id: l.id, token: l.id,
    kind: 'DIASPORA',
    label: l.label || null, name: l.label || 'Diaspora — invite link',
    note: l.notes || '', url: l.url || '', uses: Number(l.used_count) || 0, max: Number(l.max_uses) || 0,
    paused: Number(l.revoked) === 1, expired: !!(l.expires_at && new Date(l.expires_at) < new Date()),
    created: l.created_at, event: 'plexus-experience', eventName: 'Plexus Experience',
    bundle: [], expires: l.expires_at || null
  }));
  links.sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')));

  // ---- audit #8 annotations -----------------------------------------------------------------
  // BROKEN: legacy registration_links rows minted without a token — server.js's list route
  // interpolates `${userPortalUrl}/plexus/${l.token}` and a NULL token renders "/plexus/null"
  // (server.js is out of bounds here, so the view refuses to present those URLs as live).
  for (const l of links) l.broken = isBrokenUrl(l.url) || (l.kindKey === 'registration' && !l.token);
  // ARCHIVED bucket = paused + expired + broken; only the rest is the LIVE list.
  for (const l of links) l.archived = l.paused || l.expired || l.broken;
  // DUPLICATE collapse (visual): exact twins in the live list — same system, same audience,
  // same name, same bundle, same expiry day (Task J: a shared label alone is not a twin — two
  // "Conference + Gala" links expiring on different days sell different things). The canonical
  // row is the one with sign-ups (most uses, ties → oldest); its twins render collapsed with a
  // "duplicate of →" note. Nothing is merged or deleted.
  const groups = {};
  for (const l of links) {
    if (l.archived) continue;
    (groups[dupeKey(l)] = groups[dupeKey(l)] || []).push(l);
  }
  for (const g of Object.values(groups)) {
    if (g.length < 2) continue;
    const canon = g.slice().sort((a, b) => (b.uses - a.uses) || String(a.created || '').localeCompare(String(b.created || '')))[0];
    canon.dupCount = g.length - 1;
    for (const l of g) if (l !== canon) l.dupOf = canon;
  }

  D = { links, errors: r.$errors, bridges: Array.isArray(r.bridges) ? r.bridges : [] };
  return true;
}
const links = () => (D && D.links) || [];
const liveLinks = () => links().filter(l => !l.archived);
const archivedLinks = () => links().filter(l => l.archived);
const isBrokenUrl = u => /\/(null|undefined)$/.test(String(u || '').trim());
const keyOf = l => l.kindKey + ':' + l.id;
const reasonOf = l => l.broken ? 'broken' : l.expired ? 'expired' : 'paused';
// component_keys arrives as a JSON string ('["conference","gala"]') or null → sorted, lowercased,
// de-duplicated keys; a malformed value counts as no bundle rather than throwing the list away.
const bundleOf = raw => {
  let keys = Array.isArray(raw) ? raw : [];
  if (!Array.isArray(raw) && raw) { try { const v = JSON.parse(raw); keys = Array.isArray(v) ? v : []; } catch (e) { keys = []; } }
  return Array.from(new Set(keys.map(k => String(k).trim().toLowerCase()).filter(Boolean))).sort();
};
const expiryDay = l => (l.expires ? String(l.expires).slice(0, 10) : 'none');
// Task J dedupe key: system | audience | name | bundle (sorted+lowercased, '+'-joined) | expiry day
const dupeKey = l => [l.kindKey, l.kind, String(l.name).trim().toLowerCase(), l.bundle.join('+'), expiryDay(l)].join('|');

// ---------------------------------------------------------------- blocks (artboard markup verbatim)
function blockTitle() {
  return `
  <!-- dc: Admin Links.dc.html › "Title row" -->
  <div style="display:flex;align-items:flex-end;gap:16px;flex-wrap:wrap">
    <div>
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <a href="/projects/plexus" style="font:600 10px Inter,sans-serif;letter-spacing:.14em;color:#6d6459" data-hover="color:#201b16">${COPY.back}</a>
        <span class="mx-display-30" style="font-family:Fraunces,serif;font-size:30px">${COPY.title}</span>
      </div>
      <div style="font-size:12.5px;color:#6d6459;margin-top:4px">${COPY.sub}</div>
    </div>
  </div>
  <!-- /dc -->`;
}
function statsLine(l) {
  const bits = [COPY.stats.signups(l.uses)];
  if (l.max > 0) bits.push(COPY.stats.limit(l.max));
  if (l.expired && !l.paused) bits.push(COPY.stats.expired);
  if (!l.uses && l.created) bits.push(COPY.stats.created(fmt.dayShort(l.created)));
  return bits.join(' · ');
}
function tickBox(l) {
  const on = st.ticked.has(keyOf(l));
  return `<span data-act="tick" data-key="${esc(keyOf(l))}" role="checkbox" aria-checked="${on}" title="${COPY.row.tick}" style="width:13px;height:13px;border:1px solid rgba(32,27,22,.4);cursor:pointer;background:${on ? '#9b1b22' : 'transparent'};flex:none"></span>`;
}
// Task J — `bundle · expires YYYY-MM-DD · …last6` on every row (v2 addition, no artboard counterpart)
function metaLine(l, dim) {
  const bundle = l.bundle.length
    ? l.bundle.map(k => COPY.meta.comp[k] || (k.charAt(0).toUpperCase() + k.slice(1))).join(' + ')
    : (l.eventName || COPY.meta.noBundle);
  const exp = l.expires ? COPY.meta.expires(String(l.expires).slice(0, 10)) : COPY.meta.noExpiry;
  const tok = l.token ? '…' + String(l.token).slice(-6) : COPY.meta.noToken;
  return `<span data-v2="link-meta" title="${COPY.meta.title}" style="font-size:10.5px;color:${dim ? '#b0a79c' : '#9a9086'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(bundle)} · ${esc(exp)} · <span style="font-family:Inter,sans-serif;font-variant-numeric:tabular-nums;letter-spacing:.02em">${esc(tok)}</span></span>`;
}
// Task J — inline rename (registration links only: PUT /api/admin/registration-links/:id {label}).
// The name cell becomes an input + SAVE/CANCEL while st.renaming === keyOf(l); Enter/Escape are
// wired on the view root (onKey below) because ui.bind only delegates clicks.
const canRename = l => l.kindKey === 'registration';
const isRenaming = l => st.renaming === keyOf(l);
function renameCell(l) {
  const draft = st.renameDraft != null ? st.renameDraft : (l.label || l.name);
  return `<span data-v2="rename" style="display:flex;align-items:center;gap:6px;flex:1;min-width:220px">
            <input data-role="renameInput" value="${esc(draft)}" placeholder="${esc(COPY.row.renamePh)}" aria-label="${COPY.row.renameLabel}" maxlength="160" style="flex:1;min-width:0;border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:6px 9px;font:600 13px Inter,sans-serif;color:#201b16">
            <span data-act="renameSave" style="padding:6px 10px;background:#9b1b22;color:#fff;font:600 8.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap" data-hover="background:#7e151b">${COPY.row.save}</span>
            <span data-act="renameCancel" style="font:600 8.5px Inter,sans-serif;letter-spacing:.11em;color:#9a9086;cursor:pointer;white-space:nowrap" data-hover="color:#201b16">${COPY.row.cancel}</span>
          </span>`;
}
function renameBtn(l) {
  if (!canRename(l) || isRenaming(l)) return '';
  return `<span data-act="rename" data-key="${esc(keyOf(l))}" title="${COPY.row.renameTitle}" style="font:600 8.5px Inter,sans-serif;letter-spacing:.11em;color:#9a9086;cursor:pointer;white-space:nowrap" data-hover="color:#201b16">${COPY.row.rename}</span>`;
}
function linkRow(l) {
  const c = KIND_STYLE[l.kind] || KIND_STYLE.PUBLIC;
  const ref = `data-kind="${esc(l.kindKey)}" data-id="${esc(l.id)}"`;
  // audit #8: an exact twin collapses to one line — "duplicate of →" pointing at the canonical row
  if (l.dupOf) return `
      <div data-row="${esc(keyOf(l))}" style="padding:9px 18px;border-bottom:1px solid rgba(32,27,22,.08);display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:#fdfbf6" title="${esc(l.url)}">
        ${tickBox(l)}
        <span style="font:600 8.5px Inter,sans-serif;letter-spacing:.11em;padding:3px 7px;background:#eee7dc;color:#6d6459;white-space:nowrap">${COPY.dup.tag}</span>
        ${isRenaming(l) ? renameCell(l) : `<span style="font-size:12px;color:#9a9086;flex:1;min-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${COPY.dup.of} <span style="color:#6d6459;font-weight:600">${esc(l.dupOf.name)}</span></span>`}
        ${metaLine(l, true)}
        <span data-act="signups" data-token="${esc(l.token || '')}" data-label="${esc(l.name)}" title="Every sign-up from this link, in Registrations" style="font-size:11px;color:#6d6459;white-space:nowrap;cursor:pointer" data-hover="color:#201b16">${esc(statsLine(l))}</span>
        ${renameBtn(l)}
        <span data-act="pause" ${ref} style="font:600 8.5px Inter,sans-serif;letter-spacing:.11em;color:#9a9086;cursor:pointer;white-space:nowrap" data-hover="color:#201b16">${COPY.row.pause}</span>
      </div>`;
  return `
      <div data-row="${esc(keyOf(l))}" style="padding:13px 18px;border-bottom:1px solid rgba(32,27,22,.08);display:flex;flex-direction:column;gap:7px">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          ${tickBox(l)}
          <span style="font:600 8.5px Inter,sans-serif;letter-spacing:.11em;padding:3px 7px;background:${c[0]};color:${c[1]};white-space:nowrap">${esc(l.kind)}</span>
          ${isRenaming(l) ? renameCell(l) : `<span style="font-size:13px;font-weight:600;flex:1;min-width:120px">${esc(l.name)}${l.note && l.note !== l.name ? ` <span style="font-weight:400;color:#6d6459">· ${esc(l.note)}</span>` : ''}${l.dupCount ? ` <span title="${l.dupCount} exact twin${l.dupCount === 1 ? '' : 's'} collapsed below" style="font:600 7.5px Inter,sans-serif;letter-spacing:.1em;padding:2px 5px;background:#eee7dc;color:#6d6459;vertical-align:1px">+${l.dupCount} ${COPY.dup.tag}${l.dupCount === 1 ? '' : 'S'}</span>` : ''}</span>`}
          <span data-act="signups" data-token="${esc(l.token || '')}" data-label="${esc(l.name)}" title="Every sign-up from this link, in Registrations" style="font-size:11px;color:#6d6459;white-space:nowrap;cursor:pointer" data-hover="color:#201b16">${esc(statsLine(l))}</span>
          ${renameBtn(l)}
          <span data-act="pause" ${ref} style="font:600 8.5px Inter,sans-serif;letter-spacing:.11em;color:${l.paused ? '#1e6e42' : '#9a9086'};cursor:pointer;white-space:nowrap" data-hover="color:#201b16">${l.paused ? COPY.row.resume : COPY.row.pause}</span>
        </div>
        <div style="display:flex;align-items:center;padding-left:23px;min-width:0">${metaLine(l)}</div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span style="font:600 11.5px Inter,sans-serif;font-variant-numeric:tabular-nums;letter-spacing:.02em;background:#f6f2ea;border:1px solid rgba(32,27,22,.14);padding:8px 11px;flex:1;min-width:200px;color:${l.paused ? '#9a9086' : '#201b16'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(l.url)}">${esc(l.url.replace(/^https?:\/\//, ''))}</span>
          <span data-act="copy" ${ref} data-url="${esc(l.url)}" style="padding:8px 13px;background:#9b1b22;color:#fff;font:600 9px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap" data-hover="background:#7e151b">${st.copied === keyOf(l) ? COPY.row.copied : COPY.row.copy}</span>
          <span data-act="qr" ${ref} data-url="${esc(l.url)}" data-name="${esc(l.name)}" title="${COPY.row.qrTitle}" style="padding:8px 11px;border:1px solid rgba(32,27,22,.2);font:600 9px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap" data-hover="border-color:#201b16">${COPY.row.qr}</span>
        </div>
      </div>`;
}
// audit #8: paused + expired + broken links rest in one collapsed section, out of the live list
function archRow(l) {
  const reason = reasonOf(l);
  const tag = { broken: ['#f7e3e4', '#7e151b'], expired: ['#f1e7d4', '#7a6432'], paused: ['#eee7dc', '#6d6459'] }[reason];
  const ref = `data-kind="${esc(l.kindKey)}" data-id="${esc(l.id)}"`;
  return `
      <div data-row="${esc(keyOf(l))}" style="padding:9px 18px;border-bottom:1px solid rgba(32,27,22,.06);display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:#fdfbf6">
        <span title="${reason === 'broken' ? esc(COPY.arch.brokenWhy) : esc(l.url)}" style="font:600 7.5px Inter,sans-serif;letter-spacing:.11em;padding:3px 6px;background:${tag[0]};color:${tag[1]};white-space:nowrap">${COPY.arch.reason[reason]}</span>
        ${isRenaming(l) ? renameCell(l) : `<span style="font-size:12px;color:#6d6459;flex:1;min-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(l.name)}</span>`}
        ${metaLine(l, true)}
        <span data-act="signups" data-token="${esc(l.token || '')}" data-label="${esc(l.name)}" title="Every sign-up from this link, in Registrations" style="font-size:11px;color:#9a9086;white-space:nowrap;cursor:pointer" data-hover="color:#201b16">${esc(statsLine(l))}</span>
        ${renameBtn(l)}
        ${l.paused && !l.broken ? `<span data-act="pause" ${ref} style="font:600 8.5px Inter,sans-serif;letter-spacing:.11em;color:#1e6e42;cursor:pointer;white-space:nowrap">${COPY.row.resume}</span>` : ''}
      </div>`;
}
function blockList() {
  const live = liveLinks();
  // duplicates render directly under their canonical row, whatever the date sort said
  const ordered = [];
  for (const l of live) { if (l.dupOf) continue; ordered.push(l); for (const d of live) if (d.dupOf === l) ordered.push(d); }
  const arch = archivedLinks();
  const nTicked = st.ticked.size;
  return `
      <!-- dc: Admin Links.dc.html › "LIVE LINKS" -->
      <div data-block="list" style="border:1px solid rgba(32,27,22,.14);background:#fff">
        <div style="display:flex;align-items:center;gap:10px;padding:13px 18px;border-bottom:1px solid rgba(32,27,22,.12);flex-wrap:wrap">
          <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${COPY.live.title}</span>
          <span style="font-size:11.5px;color:#6d6459">${COPY.live.sub}</span>
          <div style="flex:1"></div>
          ${nTicked ? `<span data-act="bulkArchive" style="padding:7px 12px;background:#9b1b22;color:#fff;font:600 9px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap" data-hover="background:#7e151b">${COPY.bulk.btn(nTicked)}</span>` : ''}
        </div>
        ${ordered.map(linkRow).join('')}
        ${!live.length ? `<div class="empty" style="padding:30px 18px 32px"><span style="width:28px;height:1px;background:#c9a962"></span><span class="empty-line">${COPY.live.empty}</span><span class="empty-why">${COPY.live.emptyWhy}</span></div>` : ''}
        ${arch.length ? `
        <div data-act="archToggle" role="button" aria-expanded="${st.archOpen}" style="display:flex;align-items:center;gap:10px;padding:11px 18px;border-top:1px solid rgba(32,27,22,.12);cursor:pointer;background:#fdfbf6" data-hover="background:#f6f2ea">
          <span style="font:600 10px Inter,sans-serif;letter-spacing:.15em;color:#6d6459">${esc(COPY.arch.title(arch.length))}</span>
          <div style="flex:1"></div>
          <span style="font:600 8.5px Inter,sans-serif;letter-spacing:.12em;color:#9b1b22">${st.archOpen ? COPY.arch.hide : COPY.arch.show}</span>
        </div>
        ${st.archOpen ? arch.map(archRow).join('') + `<div style="padding:9px 18px;font-size:11px;color:#9a9086;border-top:1px solid rgba(32,27,22,.06)">${COPY.arch.foot}</div>` : ''}` : ''}
        <div style="padding:11px 18px;font-size:11px;color:#6d6459">${COPY.live.foot}</div>
      </div>
      <!-- /dc -->`;
}
function blockForm() {
  const f = COPY.form;
  return `
      <!-- dc: Admin Links.dc.html › "NEW LINK" -->
      <div data-block="form" class="mx-sticky" style="border:1px solid rgba(32,27,22,.14);border-top:2px solid #9b1b22;background:#fff;position:sticky;top:16px">
        <div style="padding:13px 18px;border-bottom:1px solid rgba(32,27,22,.1)"><span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${f.title}</span></div>
        <div style="padding:14px 18px 18px;display:flex;flex-direction:column;gap:10px">
          <label style="display:flex;flex-direction:column;gap:4px"><span style="font:600 8.5px Inter,sans-serif;letter-spacing:.14em;color:#6d6459">${f.event}</span>
            <select data-role="nEvent" style="border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:9px 10px;font:400 13px Inter,sans-serif;color:#201b16">${f.events.map(([k, label]) => `<option value="${k}"${st.nEvent === k ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
          <label style="display:flex;flex-direction:column;gap:4px"><span style="font:600 8.5px Inter,sans-serif;letter-spacing:.14em;color:#6d6459">${f.kind}</span>
            <select data-role="nKind" style="border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:9px 10px;font:400 13px Inter,sans-serif;color:#201b16">${f.kinds.map(([k, label]) => `<option value="${k}"${st.nKind === k ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
          <label style="display:flex;flex-direction:column;gap:4px"><span style="font:600 8.5px Inter,sans-serif;letter-spacing:.14em;color:#6d6459">${f.limit}</span>
            <input data-role="nLimit" value="${esc(st.nLimit)}" placeholder="${esc(f.limitPh)}" inputmode="numeric" style="border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:9px 10px;font:400 13px Inter,sans-serif;color:#201b16"></label>
          <label style="display:flex;flex-direction:column;gap:4px"><span style="font:600 8.5px Inter,sans-serif;letter-spacing:.14em;color:#6d6459">${f.note}</span>
            <input data-role="nNote" value="${esc(st.nNote)}" placeholder="${esc(f.notePh)}" style="border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:9px 10px;font:400 13px Inter,sans-serif;color:#201b16"></label>
          <span data-act="create" role="button" style="padding:11px 14px;background:#9b1b22;color:#fff;font:600 10px Inter,sans-serif;letter-spacing:.14em;cursor:pointer;text-align:center" data-hover="background:#7e151b">${f.create}</span>
          <span style="font-size:11px;color:#6d6459;line-height:1.55">${f.foot}</span>
        </div>
      </div>
      <!-- /dc -->`;
}
function template() {
  return `
<div data-screen-label="Admin Link Generator" style="min-height:100vh;background:#f6f2ea;color:#201b16;font-family:Inter,sans-serif">
  <div class="mx-gutter" style="max-width:1180px;margin:0 auto;padding:30px 28px 56px;display:flex;flex-direction:column;gap:22px">
    ${blockTitle()}
    <div class="mx-side mx-links-grid" style="display:grid;grid-template-columns:1fr 360px;gap:22px;align-items:start">
      ${blockList()}
      ${blockForm()}
    </div>
  </div>
</div>`;
}

// ---------------------------------------------------------------- behaviour
function rerender(sel, html) { const el = rootEl && rootEl.querySelector(sel); if (el) el.outerHTML = html; }
async function refetch() {
  if (!(await load()) || !rootEl) return;
  const have = new Set(links().map(keyOf));
  st.ticked.forEach(k => { if (!have.has(k)) st.ticked.delete(k); });
  rerender('[data-block="list"]', blockList());
}
function readForm() {
  const v = role => { const el = rootEl.querySelector(`[data-role="${role}"]`); return el ? el.value : ''; };
  st.nEvent = v('nEvent') || st.nEvent; st.nKind = v('nKind') || st.nKind; st.nLimit = v('nLimit'); st.nNote = v('nNote');
}

// event key → how each kind maps onto the real link systems
function bridgesEventId(match) {
  const today = fmt.ymd(new Date());
  const evs = (D.bridges || []).filter(b => match.test((b.name || '') + ' ' + (b.city || '')));
  const future = evs.filter(b => String(b.event_date || '').slice(0, 10) >= today).sort((a, b) => String(a.event_date).localeCompare(String(b.event_date)));
  return (future[0] || evs[0] || {}).id || null;
}
async function createLink() {
  readForm();
  const limitRaw = st.nLimit.trim();
  const limit = limitRaw === '' ? null : parseInt(limitRaw, 10);
  if (limitRaw !== '' && (!Number.isFinite(limit) || limit < 1)) { ui.toast(COPY.toast.limitBad); return; }
  const note = st.nNote.trim();
  const evLabel = (COPY.form.events.find(([k]) => k === st.nEvent) || [])[1] || st.nEvent;
  const label = note || `${evLabel} — ${st.nKind.toLowerCase()} link`;

  if (st.nKind === 'SPONSOR') { ui.toast(COPY.toast.sponsor); return; }   // no backend concept — reported PARTIAL, never faked

  try {
    if (st.nKind === 'DIASPORA') {
      // Diaspora links are Plexus-Experience-wide (croatians_abroad_invite_links); the picked event survives on the label.
      if (st.nEvent !== 'plexus' && st.nEvent !== 'gala') ui.toast(COPY.toast.diasporaEvent);
      await api.post('/api/admin/croatians-abroad/invite-links', { label, max_uses: limit, notes: note || null, variant: 'croatian' });
    } else if (st.nEvent === 'gala') {
      await api.post('/api/admin/gala/invite-links', { label, link_type: st.nKind === 'VIP' ? 'vip' : 'generic', max_uses: limit, notes: note || null });
    } else {
      const map = {
        plexus: { event_type: 'plexus', event_name: FACTS.plexus.name },
        boston: { event_type: 'bridges', event_name: 'Building Bridges Boston', event_id: bridgesEventId(/boston/i) },
        donor: { event_type: 'bridges', event_name: 'Plexus Donor Night', event_id: bridgesEventId(/donor/i) },
        forum: { event_type: 'forum', event_name: 'Forum gathering ' + FACTS.forum.gathering.start.slice(0, 4) }
      }[st.nEvent];
      const r = await api.post('/api/admin/registration-links', Object.assign({ link_type: st.nKind === 'VIP' ? 'vip' : 'generic', max_uses: limit || 0, label, notes: note || null, expires_days: 365 }, map));
      // audit #8: refuse to keep a link whose target resolved to null — the legacy builder
      // (server.js, out of bounds here) interpolates the token raw into /plexus/<token>, and a
      // row that came back slugless would sit in the list as a dead "/plexus/null" QR forever.
      if (r && (isBrokenUrl(r.link) || (map.event_type === 'plexus' && !r.token))) {
        try { await api.post(`/api/v2/links/registration/${encodeURIComponent(r.id)}/active`, { active: false }); } catch (e2) { /* it will surface as BROKEN in the archive */ }
        ui.toast(COPY.toast.brokenCreated, { kind: 'error' });
        await refetch();
        return;
      }
    }
    st.nLimit = ''; st.nNote = '';
    const li = rootEl.querySelector('[data-role="nLimit"]'); if (li) li.value = '';
    const no = rootEl.querySelector('[data-role="nNote"]'); if (no) no.value = '';
    ui.toast(COPY.toast.created);
    await refetch();
  } catch (e) { ui.toast(e.message, { kind: 'error' }); }
}

async function showQr(url, name) {
  try {
    const r = await api.get('/api/v2/links/qr?data=' + encodeURIComponent(url));
    const m = ui.modal({
      eyebrow: COPY.qrModal.eyebrow, title: esc(name),
      body: `<div style="display:flex;flex-direction:column;align-items:center;gap:12px">
          <img src="${r.dataUrl}" alt="QR code for ${esc(name)}" style="width:240px;height:240px;border:1px solid rgba(32,27,22,.14)">
          <span style="font:600 11px Inter,sans-serif;font-variant-numeric:tabular-nums;color:#201b16;word-break:break-all;text-align:center">${esc(url.replace(/^https?:\/\//, ''))}</span>
          <span style="font-size:11.5px;color:#6d6459">${COPY.qrModal.hint}</span>
          <a href="${r.dataUrl}" download="medx-link-qr.png" class="btn-ghost">${COPY.qrModal.download}</a>
        </div>`,
      actions: []
    });
    return m;
  } catch (e) { ui.toast(e.message, { kind: 'error' }); }
}

const handlers = {
  create: () => createLink(),
  // ---- audit #8: checkbox select → ARCHIVE N (bulk pause through the v2 route) ----
  tick: (el) => {
    const k = el.dataset.key;
    st.ticked.has(k) ? st.ticked.delete(k) : st.ticked.add(k);
    rerender('[data-block="list"]', blockList());
  },
  archToggle: () => { st.archOpen = !st.archOpen; rerender('[data-block="list"]', blockList()); },
  bulkArchive: async (el) => {
    const items = links().filter(l => st.ticked.has(keyOf(l))).map(l => ({ kind: l.kindKey, id: l.id }));
    if (!items.length) { ui.toast(COPY.bulk.none); return; }
    if (!await ui.confirm(COPY.bulk.confirm(items.length))) return;
    el.setAttribute('aria-disabled', 'true');
    try {
      const r = await api.post('/api/v2/links/bulk-archive', { items });
      st.ticked.clear();
      st.archOpen = true;
      ui.toast(COPY.bulk.done((r && r.archived) || items.length));
      await refetch();
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  copy: async (el) => {
    const url = el.dataset.url;
    try { await navigator.clipboard.writeText(url); } catch (e) {
      try { const t = document.createElement('textarea'); t.value = url; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }
      catch (e2) { ui.toast(COPY.toast.copyFail, { kind: 'error' }); return; }
    }
    st.copied = el.dataset.kind + ':' + el.dataset.id;
    rerender('[data-block="list"]', blockList());
    ui.toast(COPY.toast.copied);
  },
  qr: (el) => showQr(el.dataset.url, el.dataset.name),
  // ---- Task J: inline rename — RENAME → input prefilled → SAVE/CANCEL (Enter/Escape via onKey) ----
  rename: (el) => {
    st.renaming = el.dataset.key; st.renameDraft = null;
    rerender('[data-block="list"]', blockList());
    const inp = rootEl.querySelector('[data-role="renameInput"]');
    if (inp) { inp.focus(); inp.select(); }
  },
  renameCancel: () => { st.renaming = null; st.renameDraft = null; rerender('[data-block="list"]', blockList()); },
  renameSave: async () => {
    const l = links().find(x => keyOf(x) === st.renaming); if (!l) { handlers.renameCancel(); return; }
    const inp = rootEl.querySelector('[data-role="renameInput"]');
    const label = String(inp ? inp.value : (st.renameDraft || '')).trim();
    if (!label) { ui.toast(COPY.toast.renameEmpty, { kind: 'error' }); if (inp) inp.focus(); return; }
    st.renaming = null; st.renameDraft = null;
    if (label === (l.label || '')) { rerender('[data-block="list"]', blockList()); return; }   // nothing changed
    const prev = { label: l.label, name: l.name };
    l.label = label; l.name = label;                                                            // optimistic
    rerender('[data-block="list"]', blockList());
    try {
      const r = await api.put('/api/admin/registration-links/' + encodeURIComponent(l.id), { label });
      if (r && typeof r.label === 'string' && r.label.trim()) { l.label = r.label; l.name = r.label; }
      ui.toast(COPY.toast.renamed);
      await refetch();                                                  // twins are keyed on the name — regroup
    } catch (e) {
      l.label = prev.label; l.name = prev.name;
      rerender('[data-block="list"]', blockList());
      ui.toast(e.message, { kind: 'error' });
    }
  },
  pause: async (el) => {
    const key = el.dataset.kind + ':' + el.dataset.id;
    const l = links().find(x => x.kindKey + ':' + x.id === key); if (!l) return;
    el.setAttribute('aria-disabled', 'true');
    try {
      await api.post(`/api/v2/links/${encodeURIComponent(l.kindKey)}/${encodeURIComponent(l.id)}/active`, { active: l.paused });
      ui.toast(l.paused ? COPY.toast.resumed : COPY.toast.paused);
      await refetch();
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  signups: (el) => {                       // the count is a door — Registrations filtered to this link
    const token = el.dataset.token;
    if (!token) { router.navigate('/registrations'); return; }
    router.navigate('/registrations?link=' + encodeURIComponent(token) + '&label=' + encodeURIComponent(el.dataset.label || ''));
  }
};

// Task J: Enter saves / Escape cancels inside the rename input; the draft is kept in st so a list
// re-render mid-edit (a tick on another row, a copy) does not wipe what was typed. Listeners sit on
// the view root, so they survive every innerHTML swap of the list block.
function bindRenameKeys(root) {
  const isInput = t => t && t.matches && t.matches('[data-role="renameInput"]');
  const onKey = e => {
    if (!isInput(e.target) || !st || !st.renaming) return;
    if (e.key === 'Enter') { e.preventDefault(); handlers.renameSave(); }
    else if (e.key === 'Escape') { e.preventDefault(); handlers.renameCancel(); }
  };
  const onInput = e => { if (isInput(e.target) && st) st.renameDraft = e.target.value; };
  root.addEventListener('keydown', onKey);
  root.addEventListener('input', onInput);
  return () => { root.removeEventListener('keydown', onKey); root.removeEventListener('input', onInput); };
}

export default {
  title: 'Links',
  async render(root, ctx) {
    rootEl = root; loadCss();
    st = { copied: null, nEvent: 'gala', nKind: 'PUBLIC', nLimit: '', nNote: '', ticked: new Set(), archOpen: false, renaming: null, renameDraft: null };
    D = null;
    await load();
    if (rootEl !== root) return;
    root.innerHTML = template();
    unbind = ui.bind(root, handlers);
    unkey = bindRenameKeys(root);
    // Studio's "NEW FORM LINK →" arrives as /links?new=1 — land the cursor in the create form
    if (ctx.query && ctx.query.new === '1') {
      const form = root.querySelector('[data-act="create"]');
      if (form) { form.scrollIntoView({ block: 'center' }); const inp = root.querySelector('select, input'); if (inp) inp.focus(); }
    }
  },
  destroy() { reqId++; if (unbind) unbind(); if (unkey) unkey(); unbind = null; unkey = null; rootEl = null; D = null; st = null; }
};
