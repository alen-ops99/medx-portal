// Source: Profile.dc.html
// Blocks (artboard order): "Breadcrumb" › "Profile & Settings" (title row) › "01 · IDENTITY" ›
// "02 · ABOUT" › "03 · ACCOUNT & PREFERENCES" › sidebar "PROFILE COMPLETION" › "DIRECTORY PREVIEW" ›
// "YOUR MEMBER CARD". The artboard's fixed saved-toast is the shared ui.toast (its look lives in
// css/app.css, sourced from this artboard). The chrome is NOT in this file — js/chrome.js.
// Data: GET /api/v2/profile (profile + completion, incl. email_verified) — backend/v2/profile.js.
// The completion % / checklist is SERVER-computed (GET /api/v2/profile/completion is the one source
// of truth for the Home nudge and this screen); while editing, the meter re-computes through
// POST /api/v2/profile/completion/preview (same formula, never writes). SAVE CHANGES →
// PATCH /api/v2/profile; UPLOAD PHOTO → POST /api/v2/profile/photo (multipart, ≤5 MB jpg/png/webp);
// RESEND LINK → POST /api/auth/request-verification. Country list: ./profile-countries.js.
// DELETE ACCOUNT (App Store guideline 5.1.1(v); not in the artboard) closes the list: what is erased,
// what Med&X keeps, then a typed-DELETE confirm → DELETE /api/auth/account (server.js; the rules are
// proven by tests/account-delete.test.js) → signed out on the auth welcome screen. data-act="deleteAccount"
// is also the hook the iOS shell (medx-app/native/medx-native.js) looks for to drop its own delete row, and
// the `medx:account-deleted` event it dispatches is what the shell listens for to clear Face ID + Keychain.
// Moderation (App Store 1.2): when the Med&X team hid the profile (GET /api/v2/profile → moderation_hidden),
// the directory switch is locked off and one quiet line says so. A save the server refuses with 403 (a
// suspended account) or 422 (the content filter on the bio) keeps every edit and says why at SAVE CHANGES.
import { api } from '../api.js';
import { session } from '../state.js';
import { ui, esc, fmt } from '../ui.js';
import router from '../router.js';

import { chrome } from '../chrome.js';
import { COUNTRIES, countryName } from './profile-countries.js';

export const SOURCE = 'Profile.dc.html';

// ---- COPY: every string that may change in a revision lives here --------------------------------
export const COPY = {
  crumbs: { my: 'MY MED&amp;X', here: 'PROFILE &amp; SETTINGS' },
  titleT: 'Profile &amp; settings',
  title: { main: 'Profile &amp; <i style="color:#9b1b22">Settings</i>', sub: 'How you appear to other members, and how the portal reaches you.' },
  identity: {
    n: '01', title: 'IDENTITY',
    photoWhy: 'A portrait helps colleagues recognise you at events.',
    upload: 'UPLOAD PHOTO', replace: 'REPLACE PHOTO', uploading: 'UPLOADING…',
    fields: { first: 'FIRST NAME', last: 'LAST NAME', title: 'TITLE / ROLE', institution: 'INSTITUTION', city: 'CITY', country: 'COUNTRY' },
    placeholders: { title: 'e.g. Postdoctoral researcher', city: 'e.g. Boston' },
    photoTooBig: 'That image is larger than 5 MB — pick a smaller one.',
    photoBadType: 'Use a JPG, PNG or WebP image.',
    photoSaved: 'Portrait saved — visible across the portal.',
    titleT: 'Identity', addT: 'Add photo', changeT: 'Change photo', uploadingT: 'Uploading…'
  },
  about: {
    n: '02', title: 'ABOUT', sub: 'Shown on your member card and in the directory.',
    specialty: 'SPECIALTY', addBtn: '+ ADD',
    addPlaceholder: 'Add your own — e.g. Sleep medicine',
    addHint: 'Add as many as apply — selected tags show on your member card.',
    bio: 'SHORT BIO',
    bioPlaceholder: "Two or three sentences on your work and what you're looking for in the Med&X network…",
    titleT: 'About', addBtnT: 'Add', addPlaceholderT: 'Add your own, e.g. Sleep medicine', bioPlaceholderT: 'Your work, in two or three sentences.'
  },
  account: {
    n: '03', title: 'ACCOUNT &amp; PREFERENCES', titleT: 'Account &amp; preferences', resendT: 'Resend', nonShort: 'None',
    saveNoteT: 'Visible across the portal and the directory.', saveNoteOffT: 'Visible across the portal, hidden from the directory.',
    email: 'Email', notConfirmed: 'not yet confirmed', confirmed: 'confirmed', resend: 'RESEND LINK',
    resent: 'Link sent — check your inbox (and spam).',
    // UX audit 2026-09-02 › item 8 — Profile & settings is the ONE place account settings live.
    // Password, the projects you follow and your research interests moved here from My Med&X, where
    // they were a second, differently-styled copy of this screen. These three save on the spot (they
    // are not part of the profile draft), which is why each carries its own action.
    pw: { t: 'Password', s: 'Changed here — you need your current one.', change: 'CHANGE →' },
    follow: { t: 'Projects I follow', s: 'Announcements and reminders for these reach your inbox and alerts.', add: '+ ADD', addT: 'Add', none: 'Following nothing yet.' },
    interests: { t: 'My interests', s: 'Used to suggest people worth meeting in the member directory.', add: '+ ADD', addT: 'Add', none: 'No interests added yet.' },
    pwTitle: 'Change your password', pwCur: 'CURRENT PASSWORD', pwNew: 'NEW PASSWORD', pwNew2: 'REPEAT NEW PASSWORD',
    pwHint: 'At least 8 characters', pwSaved: 'Password changed.',
    pwMismatch: 'The passwords do not match.', pwShort: 'At least 8 characters.',
    followTitle: 'Follow a project', followAll: 'You already follow every project.', followed: 'Following updated.',
    interestsTitle: 'Add an interest', interestsSaved: 'Interests updated.',
    interestsOwn: 'OR TYPE YOUR OWN', interestsAllAdded: 'All suggestions added — type your own below.',
    projects: { plexus: 'Plexus Conference', gala: 'Gala Evening', accelerator: 'The Accelerator', forum: 'Biomedical Forum', bridges: 'Building Bridges' },
    suggestions: ['Neuroscience', 'Sleep Medicine', 'Oncology', 'Public Health', 'Biotech', 'AI in Medicine', 'Mental Health', 'Genetics'],
    dir: { t: 'Directory visibility', s: 'Let other members find you and send connection requests.', sT: 'Members can find you', sOffT: 'Hidden from the directory',
           // App Store 1.2 — shown instead of the line above while the Med&X team keeps the profile hidden
           modHidden: 'Your profile was hidden from the directory by the Med&amp;X team. Questions: <a href="mailto:info@medx.hr">info@medx.hr</a>',
           modHiddenToast: 'The Med&X team hid your profile from the directory. Questions: info@medx.hr' },
    upd: { t: 'Event updates', s: 'News from projects you follow · Plexus, Gala, the Accelerator.', sT: 'News from projects you follow' },
    save: 'SAVE CHANGES', saving: 'SAVING…', saved: '✓ SAVED',
    saveNote: 'Changes apply across the portal and the member directory.',
    savedToast: 'CHANGES SAVED — VISIBLE ACROSS THE PORTAL',
    nothingToSave: 'Nothing changed yet — edit a field first.'
  },
  completion: {
    title: 'PROFILE COMPLETION', complete: 'COMPLETE', titleT: 'Profile', of: (a, b) => `${a} of ${b}`,
    note: 'At 100%, the reminder on your Home page disappears.',
    offline: 'The completion service is unreachable right now — your edits still save.'
  },
  preview: {
    title: 'DIRECTORY PREVIEW', memberSince: y => `Member since ${y}`,
    emptyBio: 'Your bio will appear here.', view: 'VIEW PROFILE', connect: 'CONNECT',
    connectSelf: 'This is your own card — other members see CONNECT here.',
    modalEyebrow: 'DIRECTORY · AS OTHERS SEE YOU', hiddenNote: 'Directory visibility is OFF — only you can see this card.',
    titleT: 'How others see you', hiddenNoteT: 'Directory visibility is off: only you see this.'
  },
  card: {
    title: 'YOUR MEMBER CARD',
    body: 'Your QR member card admits you to everything you’re registered for · find it in <a href="/app/me">My Med&amp;X</a>.'
  },
  // what is erased / kept mirrors DELETE /api/auth/account (server.js) — change the two together
  del: {
    title: 'DELETE ACCOUNT', titleT: 'Delete account', rowS: 'Erase your account and its data',
    goneTT: 'What is deleted', keptTT: 'What Med&amp;X keeps',
    sub: 'Close your Med&amp;X account and erase the personal data it holds, whenever you choose.',
    goneT: 'WHAT IS DELETED',
    gone: ['Your profile, photo and directory listing', 'Connections, meeting requests and messages',
      'Followed projects, alerts, saved schedule and newsletter', 'Your meetup places and the details hosts see',
      'Your sign-in, on every device'],
    keptT: 'WHAT MED&amp;X KEEPS',
    kept: 'Event registrations, tickets and invoices, exactly as issued: Croatian accounting law requires Med&amp;X to keep payment records. Applications you sent to Med&amp;X programs and questions you asked at sessions also stay on record, and so does the moderation record of any report you sent or that was made about you. If a member blocked you, that block stays, with your conversation with them, and it also applies to a new account on the same email address.',
    contact: 'Questions about your data: <a href="mailto:info@medx.hr">info@medx.hr</a>',
    btn: 'DELETE ACCOUNT…',
    note: 'You confirm in the next step. A deleted account cannot be restored.',
    modalEyebrow: 'DELETE ACCOUNT',
    modalTitle: 'Delete your Med&amp;X account?',
    // the sheet opens on one sentence; what is erased leads the "What is deleted" accordion, word for word as before
    modalBody: 'A deleted account cannot be restored.',
    modalGone: 'Your profile, connections, messages and settings are erased, and you are signed out on every device.',
    modalKept: 'Event registrations, tickets and invoices stay on record as issued, together with program applications, questions asked at sessions, the moderation record and any block another member placed on you.',
    typeLabel: 'TYPE DELETE TO CONFIRM', word: 'DELETE',
    cancel: 'KEEP MY ACCOUNT', confirm: 'DELETE ACCOUNT', busy: 'DELETING…',
    // toasts are plain text (ui.toast sets textContent)
    done: 'Your Med&X account has been deleted.',
    doneKept: 'Your Med&X account has been deleted. Paid tickets and invoices stay on record, as issued.',
    failed: 'Your account could not be deleted just now. Please try again.'
  },
  fixedSpecs: ['NEUROSCIENCE', 'ONCOLOGY', 'CARDIOLOGY', 'GENETICS', 'PUBLIC HEALTH', 'BIOENGINEERING'],
  errors: {
    first: 'Add your first name.', last: 'Add your last name.',
    load: 'Your profile could not be loaded — pull to refresh or try again shortly.'
  }
};

const FIELD_KEYS = ['first_name', 'last_name', 'title', 'institution', 'city', 'country', 'bio'];
const LABEL = 'font:600 12px Inter,sans-serif;letter-spacing:.12em;color:#4a4239';
const INPUT = 'border:1px solid rgba(25,21,18,.25);background:#fdfaf3;padding:13px 14px;font-size:16px;color:#191512;min-height:52px;box-sizing:border-box';

let D = null, unbind = null, timers = [], previewTimer = null, savedTimer = null, resendTimer = null, rootEl = null, meterIO = null;

// ---------------------------------------------------------------- data
function draftFrom(p) {
  return {
    first_name: p.first_name || '', last_name: p.last_name || '', title: p.title || '',
    institution: p.institution || '', city: p.city || '', country: countryName(p.country || ''),
    bio: p.bio || '', specialties: (p.specialties || []).slice(),
    is_public_profile: p.is_public_profile !== false, updates_opt_in: p.updates_opt_in !== false,
    locale: p.locale === 'hr' ? 'hr' : 'en'
  };
}
function interestsFrom(net) {
  let v = (net && net.research_interests) || [];
  if (typeof v === 'string') v = v.split(',').map(s => s.trim()).filter(Boolean);
  return Array.isArray(v) ? v : [];
}
async function load() {
  // topics + networking profile arrive with the profile: the follow list and research interests are
  // settings now (item 8), and both save through their own routes rather than the profile draft.
  const r = await api.settle({
    v2: api.get('/api/v2/profile'),
    topics: api.get('/api/notify-topics'),
    net: api.get('/api/networking/profile')
  });
  const extras = { topics: (r.topics && r.topics.projects) || [], net: r.net || null, interests: interestsFrom(r.net) };
  if (r.v2 && r.v2.profile) return Object.assign({ profile: r.v2.profile, completion: r.v2.completion, v2: true, modHidden: moderationHidden(r.v2) }, extras);
  // v2 backend not deployed yet: render read-mostly from the legacy profile route; saves will surface the API error
  const me = await api.get('/api/auth/me').catch(() => null);
  if (!me) return null;
  return Object.assign(extras, {
    profile: {
      id: me.id, email: me.email, email_verified: session.emailConfirmed() ? 1 : 0,
      first_name: me.first_name, last_name: me.last_name, title: me.title || '', institution: me.institution,
      city: me.city || '', country: me.country, bio: me.bio, photo_url: me.photo_url, specialties: [],
      is_public_profile: Number(me.is_public_profile) === 1, updates_opt_in: true, locale: 'en', member_since: null
    },
    completion: null, v2: false
  });
}
function draftBody() {
  const d = D.draft;
  return {
    first_name: d.first_name, last_name: d.last_name, title: d.title, institution: d.institution,
    city: d.city, country: d.country, bio: d.bio, specialties: d.specialties,
    is_public_profile: d.is_public_profile, updates_opt_in: d.updates_opt_in, locale: d.locale
  };
}
const initials = () => fmt.initials(D.draft.first_name, D.draft.last_name) || (D.profile.email || 'M')[0].toUpperCase();
const photoSrc = () => (D.photoPreview ? D.photoPreview : (D.profile.photo_url ? api.url(D.profile.photo_url) : null));

// ---------------------------------------------------------------- blocks
// Phone calm pass (2026-09-25, DESIGN-RULES §11 › /app/profile): the Settings pattern. A header (96 circle, name,
// "Change photo"); the completion as one accordion row; identity fields (16px inputs, 12 labels); About (14px chips,
// 16px bio); Account & preferences as grouped rows (switches and ›); ONE Save at the end of the form; "How others see
// you" folded away; Delete account as one crimson row (its what-is-deleted / what-is-kept copy lives in its sheet).
// Hooks kept: .mx-profile-sec around [data-block="prefs"] and [data-block="deleteAccount"] (the iOS shell inserts its
// "On this iPhone" section, drawn with these kit rows, right above Delete account),
// data-act="deleteAccount", every data-act / data-field / data-role the handlers read.
const specLabel = v => { const t = String(v || ''); return t === t.toUpperCase() ? t.charAt(0) + t.slice(1).toLowerCase() : t; };
function blockCrumbs() {
  return `
  <!-- dc: Profile.dc.html › "Breadcrumb" (hidden on phones: app.css › .mx-crumbs) -->
  <div class="mx-profile-pad mx-crumbs" style="display:flex;align-items:center;gap:13px;padding:10px 36px;border-bottom:1px solid rgba(25,21,18,.16)">
    <a href="/app/me" data-dir="back" style="font:600 12px Inter,sans-serif;letter-spacing:.12em">${COPY.crumbs.my}</a>
    <span style="color:rgba(25,21,18,.35);font-size:12px">→</span>
    <span style="font:600 12px Inter,sans-serif;letter-spacing:.12em;color:#191512">${COPY.crumbs.here}</span>
  </div>
  <!-- /dc -->`;
}
function photoCell() {
  const src = photoSrc();
  const name = [D.draft.first_name, D.draft.last_name].filter(Boolean).join(' ') || D.profile.email || 'Member';
  return `<span class="mx-profile-photo${D.photoBusy ? ' busy' : ''}" data-role="${src ? 'photo' : 'initials'}">${ui.portrait({ name, src: src || '', size: 96, alt: 'Your portrait' })}</span>`;
}
function photoBtnLabel() { return D.photoBusy ? COPY.identity.uploadingT : (photoSrc() ? COPY.identity.changeT : COPY.identity.addT); }
function blockTitle() {
  const d = D.draft;
  return `
  <!-- dc: Profile.dc.html › "Profile & Settings" (header: the circle, the name, Change photo) -->
  <header class="mx-profile-hero">
    <span data-block="photoCell" class="mx-profile-photocell">${photoCell()}</span>
    <h1 class="mx-profile-name" data-role="heroName">${esc([d.first_name, d.last_name].filter(Boolean).join(' ') || COPY.titleT)}</h1>
    <label data-act="pickPhoto" role="button" tabindex="0" aria-label="Upload a portrait photo" class="mx-profile-photolink"><span data-role="photoBtn">${photoBtnLabel()}</span><input data-role="photoInput" type="file" accept="image/jpeg,image/png,image/webp" style="display:none"></label>
  </header>
  <!-- /dc -->`;
}
const fieldCell = (label, key, value, placeholder, autocomplete) => `
          <label class="mx-profile-field">
            <span class="label">${label}</span>
            <input data-field="${key}" class="input" value="${esc(value)}"${placeholder ? ` placeholder="${esc(placeholder)}"` : ''}${autocomplete ? ` autocomplete="${autocomplete}"` : ''}>
          </label>`;
function countrySelect() {
  const cur = D.draft.country || '';
  const known = COUNTRIES.includes(cur);
  return `
          <label class="mx-profile-field">
            <span class="label">${COPY.identity.fields.country}</span>
            <select data-field="country" class="input" autocomplete="country-name">
              ${cur === '' ? '<option value="" selected></option>' : ''}
              ${!known && cur !== '' ? `<option value="${esc(cur)}" selected>${esc(cur)}</option>` : ''}
              ${COUNTRIES.map(c => `<option value="${esc(c)}"${c === cur ? ' selected' : ''}>${esc(c)}</option>`).join('')}
            </select>
          </label>`;
}
function sh(n, title) { return `<div class="mx-sh"><span class="mx-sh-n">${n}</span><h2 class="mx-sh-t">${title}</h2></div>`; }
function blockIdentity() {
  const f = COPY.identity.fields, ph = COPY.identity.placeholders, d = D.draft;
  return `
      <!-- dc: Profile.dc.html › "01 · IDENTITY" -->
      <section class="mx-sec mx-profile-sec-i">
        ${sh(COPY.identity.n, COPY.identity.titleT)}
        <div class="mx-profile-fields">
          ${fieldCell(f.first, 'first_name', d.first_name, '', 'given-name')}
          ${fieldCell(f.last, 'last_name', d.last_name, '', 'family-name')}
          ${fieldCell(f.title, 'title', d.title, ph.title, 'organization-title')}
          ${fieldCell(f.institution, 'institution', d.institution, '', 'organization')}
          ${fieldCell(f.city, 'city', d.city, ph.city, 'address-level2')}
          ${countrySelect()}
        </div>
      </section>
      <!-- /dc -->`;
}
function chipRow() {
  const on = name => D.draft.specialties.includes(name);
  const all = COPY.fixedSpecs.concat(D.custom.filter(c => !COPY.fixedSpecs.includes(c)));
  return all.map(label => {
    const a = on(label);
    return `<span data-act="tgSpec" data-spec="${esc(label)}" role="button" tabindex="0" aria-pressed="${a}" class="chip${a ? ' on' : ''}">${esc(specLabel(label))}</span>`;
  }).join('\n            ');
}
function blockAbout() {
  return `
      <!-- dc: Profile.dc.html › "02 · ABOUT" -->
      <section class="mx-sec">
        ${sh(COPY.about.n, COPY.about.titleT)}
        <span class="label">${COPY.about.specialty}</span>
        <div data-block="chips" class="mx-profile-chips">
            ${chipRow()}
        </div>
        <div class="mx-profile-addspec">
          <input data-role="specDraft" class="input" placeholder="${esc(COPY.about.addPlaceholderT)}" aria-label="Add a specialty">
          <span data-act="addSpec" role="button" tabindex="0" class="btn-ghost mx-profile-btn">${COPY.about.addBtnT}</span>
        </div>
        <label class="mx-profile-field mx-profile-bio">
          <span class="label">${COPY.about.bio}</span>
          <textarea data-field="bio" class="input" rows="4" placeholder="${esc(COPY.about.bioPlaceholderT)}">${esc(D.draft.bio)}</textarea>
        </label>
      </section>
      <!-- /dc -->`;
}
// a switch in the calm kit's look (.mx-switch — app.css draws it 44×26 inside a row); the state is aria-checked
const toggle = (act, on, label, locked) => `<span data-act="${act}" role="switch" tabindex="0" aria-checked="${on}" aria-label="${esc(label)}" class="mx-switch mx-profile-switch"${locked ? ' aria-disabled="true" aria-describedby="mx-dir-locked"' : ''}><span></span></span>`;
// flip a switch where it stands, so the knob glides instead of being re-rendered
function setSwitch(el, on) {
  if (!el) return;
  el.setAttribute('aria-checked', String(on));
}
// the sub-line says what the switch says (it read "Members can find you" with the switch off)
const dirLine = on => on ? COPY.account.dir.sT : COPY.account.dir.sOffT;
function prefRows() {
  const d = D.draft, a = COPY.account, locked = !!D.modHidden;
  return `
        <span class="mx-row">${ui.icon('globe')}<span class="mx-row-l">${a.dir.t}<span class="mx-row-s" data-role="dirLine">${locked ? a.dir.modHidden : dirLine(d.is_public_profile)}</span></span>${toggle('tgDir', locked ? false : d.is_public_profile, a.dir.t, locked)}</span>${locked ? '<span id="mx-dir-locked" hidden>Hidden from the directory by the Med&amp;X team.</span>' : ''}
        <span class="mx-row">${ui.icon('bell')}<span class="mx-row-l">${a.upd.t}<span class="mx-row-s">${a.upd.sT}</span></span>${toggle('tgUpd', d.updates_opt_in, a.upd.t)}</span>`;
}
// the removable list inside the follow / interests sheet (the same handlers as before: followRm · followAdd · intRm · intAdd)
function settingChips(list, rmAct, addAct, addLabel, noneLabel) {
  return `<div class="mx-profile-manage">
            ${list.length ? list.map(v => `<span class="chip mx-profile-tag">${esc(v.label)}<span data-act="${rmAct}" data-key="${esc(v.key)}" role="button" tabindex="0" aria-label="Remove ${esc(v.label)}" class="mx-profile-x">${ui.icon('x', 16)}</span></span>`).join('') : `<span class="mx-profile-none">${noneLabel}</span>`}
            <span data-act="${addAct}" role="button" tabindex="0" class="chip mx-profile-add">${ui.icon('plus', 16)}${addLabel}</span>
          </div>`;
}
const followList = () => (D.topics || []).map(k => ({ key: k, label: COPY.account.projects[k] || k }));
const interestList = () => (D.interests || []).map(k => ({ key: k, label: k }));
function accountExtraRows() {
  const a = COPY.account;
  const f = followList(), n = interestList();
  return `
        <span class="mx-row" data-act="chgPw" role="button" tabindex="0">${ui.icon('lock')}<span class="mx-row-l">${a.pw.t}</span>${ui.icon('chevron-right', 18)}</span>
        <span class="mx-row" data-act="followOpen" role="button" tabindex="0">${ui.icon('star')}<span class="mx-row-l">${a.follow.t}</span><span class="mx-row-v">${f.length ? esc(f.length === 1 ? f[0].label : f.length + ' projects') : a.nonShort}</span>${ui.icon('chevron-right', 18)}</span>
        <span class="mx-row" data-act="intOpen" role="button" tabindex="0">${ui.icon('sparkle')}<span class="mx-row-l">${a.interests.t}</span><span class="mx-row-v">${n.length ? esc(n.length === 1 ? n[0].label : n.length + ' interests') : a.nonShort}</span>${ui.icon('chevron-right', 18)}</span>`;
}
// the note under Save says where the profile shows, as the directory switch has it (a hidden profile is not "in the directory")
const saveNote = () => (D.draft.is_public_profile && !D.modHidden ? COPY.account.saveNoteT : COPY.account.saveNoteOffT);
function saveRow() {
  const a = COPY.account;
  const label = D.saving ? a.saving : (D.saved ? a.saved : a.save);
  return `
        <span data-act="save" role="button" tabindex="0"${D.saving ? ' aria-disabled="true"' : ''} class="btn-primary btn-block mx-profile-btn">${label}</span>
        ${D.saveError ? `<p data-role="saveErr" role="alert" class="mx-profile-savenote is-err">${esc(D.saveError)}</p>` : `<p class="mx-profile-savenote" data-role="saveNote">${saveNote()}</p>`}`;
}
function blockAccount() {
  const a = COPY.account, p = D.profile;
  const verified = Number(p.email_verified) === 1;
  return `
      <!-- dc: Profile.dc.html › "03 · ACCOUNT & PREFERENCES" (grouped rows) -->
      <section class="mx-sec mx-profile-sec">
        ${sh(a.n, a.titleT)}
        <div class="mx-list">
          <span class="mx-row mx-profile-email">${ui.icon('mail')}<span class="mx-row-l">${a.email}<span class="mx-row-s">${esc(p.email || '')} · ${verified ? `<span class="is-ok">${a.confirmed}</span>` : `<span class="is-no">${a.notConfirmed}</span>`}</span></span>${verified ? '' : `<span data-act="resend" role="button" tabindex="0" class="mx-profile-link">${a.resendT}</span>`}</span>
          <div data-block="prefs" style="display:contents">${prefRows()}</div>
          <div data-block="accountExtras" style="display:contents">${accountExtraRows()}</div>
        </div>
        <div data-block="saveRow" class="mx-profile-save">${saveRow()}</div>
      </section>
      <!-- /dc -->`;
}
// Not in Profile.dc.html (App Store 5.1.1(v)): one crimson row, the last word on the screen (below the iOS shell's
// "On this iPhone", which the app inserts right above this section). What is erased and what Med&X keeps
// is spelled out in the sheet it opens (openDeleteModal), word for word.
function blockDelete() {
  const c = COPY.del;
  return `
      <section data-block="deleteAccount" class="mx-sec mx-profile-del" aria-label="${c.titleT}">
        <div class="mx-list">
          <span data-act="deleteAccount" role="button" tabindex="0" aria-haspopup="dialog" class="mx-row is-danger">${ui.icon('logout')}<span class="mx-row-l">${c.titleT}<span class="mx-row-s">${c.rowS}</span></span>${ui.icon('chevron-right', 18)}</span>
        </div>
      </section>`;
}
// intro = the screen's first paint: the bar fills from zero (css .mx-profile-bar-in). Later refreshes animate from
// the previous value instead (refreshCompletion). One accordion row: "Profile 35 % · 4 of 9", the checklist inside.
function completionCard(intro, open) {
  const c = D.completion;
  const rows = c ? c.items.map(i => `
              <li class="mx-profile-check"${i.hint ? ` title="${esc(i.hint)}"` : ''}>
                <span class="mx-profile-tick" data-label="${esc(i.label)}" data-done="${i.done ? 1 : 0}">${i.done ? ui.icon('check', 14) : ''}</span>
                <span class="${i.done ? 'is-done' : ''}">${esc(i.label)}</span>
              </li>`).join('') : `
              <li class="mx-profile-check">${COPY.completion.offline}</li>`;
  const pct = c ? c.percent + '%' : '—';
  const done = c ? c.items.filter(i => i.done).length : 0;
  return `
        <details class="mx-acc mx-profile-meter"${open ? ' open' : ''}>
          <summary>
            <span class="mx-profile-meter-top"><span>${COPY.completion.titleT} <b data-role="pct">${pct}</b>${c ? ` · ${COPY.completion.of(done, c.items.length)}` : ''}</span>
            <span class="mx-profile-meter-bar"><span class="mx-profile-bar${intro ? ' mx-profile-bar-in' : ''}" style="transform:scaleX(${c ? Math.max(0, Math.min(100, c.percent)) / 100 : 0})"></span></span></span>
          </summary>
          <div class="mx-acc-a"><ul class="mx-profile-checks">${rows}</ul></div>
        </details>`;
}
function previewCard() {
  const d = D.draft, p = D.profile;
  const src = photoSrc();
  const name = [d.first_name, d.last_name].filter(Boolean).join(' ') || (p.email || 'Member');
  const line = [d.title, d.institution].filter(Boolean).join(' · ') || (p.member_since ? COPY.preview.memberSince(p.member_since) : '');
  return `
          <div class="mx-profile-preview">
            ${ui.portrait({ name, src: src || '', size: 64, alt: '' })}
            <span class="mx-person-text"><span class="mx-person-name">${esc(name)}</span>${line ? `<span class="mx-person-role">${esc(line)}</span>` : ''}</span>
          </div>
          <p class="mx-profile-preview-bio">${esc(d.bio.trim() || COPY.preview.emptyBio)}</p>
          ${d.is_public_profile ? '' : `<p class="mx-profile-preview-off">${COPY.preview.hiddenNoteT}</p>`}`;
}
function blockPreview() {
  return `
      <!-- dc: Profile.dc.html › "DIRECTORY PREVIEW" (folded away) -->
      <section class="mx-sec">
        <div class="mx-accs">
          <details class="mx-acc"><summary>${ui.icon('user')}${COPY.preview.titleT}</summary><div class="mx-acc-a" data-block="preview">${previewCard()}</div></details>
        </div>
      </section>
      <!-- /dc -->`;
}

// ---------------------------------------------------------------- targeted re-renders
const q = sel => rootEl && rootEl.querySelector(sel);
function rerender(sel, html) { const el = q(sel); if (el) el.innerHTML = html; }
function refreshPhoto() {
  rerender('[data-block="photoCell"]', photoCell());
  const hn = q('[data-role="heroName"]'); if (hn) hn.textContent = [D.draft.first_name, D.draft.last_name].filter(Boolean).join(' ') || COPY.titleT;
  const b = q('[data-role="photoBtn"]'); if (b) b.textContent = photoBtnLabel();
  rerender('[data-block="preview"]', previewCard());
}
// ---------------------------------------------------------------- completion meter motion
const motionOK = () => !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
const pctOf = el => { const n = parseInt(el && el.textContent, 10); return isNaN(n) ? null : n; };
// the big percentage counts to its new value alongside the bar (textContent only — no layout work)
function tweenPct(el, from, to) {
  if (!el || from == null || to == null || from === to || !motionOK()) return;
  const dur = 340;                                 // --t-reveal, the bar's own fill (profile.css)
  let t0 = null;                                   // the frame clock, from the first frame (one clock throughout)
  const step = now => {
    if (!el.isConnected) return;
    if (t0 == null) t0 = now;
    const k = Math.min(1, Math.max(0, (now - t0) / dur)), e = 1 - Math.pow(1 - k, 3);
    el.textContent = Math.round(from + (to - from) * e) + '%';
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
// first paint: the meter fills from zero and its percentage counts up — right away when it is on screen,
// otherwise (phones: the sidebar sits under the form, the meter at the foot of its checklist) once the
// number itself has come into view, clear of the tab bar. Until then it reads 0 % over an empty bar, set in
// the same task as the paint, so the number never shows its final value first and then drops back.
const METER_FOLD = .85;   // the lowest 15 % of the screen (the phone tab bar sits there) does not count as seen
function revealMeter(root) {
  const box = root.querySelector('[data-block="completion"]');
  const bar = box && box.querySelector('.mx-profile-bar'), pctEl = box && box.querySelector('[data-role="pct"]');
  if (!bar || !pctEl || !D || !D.completion || !motionOK()) return;
  const final = pctOf(pctEl), line = pctEl.parentElement;   // "35 %  COMPLETE"
  if (!('IntersectionObserver' in window) || line.getBoundingClientRect().bottom <= window.innerHeight * METER_FOLD) return tweenPct(pctEl, 0, final);
  const target = bar.style.transform;
  bar.classList.remove('mx-profile-bar-in');
  bar.style.transition = 'none'; bar.style.transform = 'scaleX(0)'; void bar.offsetWidth; bar.style.transition = '';
  pctEl.textContent = '0%';
  meterIO = new IntersectionObserver(entries => {
    if (!entries.some(e => e.intersectionRatio >= .99)) return;
    meterIO.disconnect(); meterIO = null;
    if (!bar.isConnected) return;                       // an edit already redrew the card (and moved the meter)
    bar.style.transform = target;                       // glides over (css .mx-profile-bar transition)
    tweenPct(pctEl, 0, final);
  }, { threshold: 1, rootMargin: `0px 0px -${Math.round((1 - METER_FOLD) * 100)}% 0px` });
  meterIO.observe(line);
}
function refreshCompletion() {
  const box = q('[data-block="completion"]');
  const oldBar = box && box.querySelector('.mx-profile-bar');
  const oldScale = oldBar ? parseFloat((oldBar.style.transform.match(/scaleX\(([\d.]+)\)/) || [])[1]) : NaN;
  const oldPct = pctOf(box && box.querySelector('[data-role="pct"]'));
  const wasDone = new Set(box ? [...box.querySelectorAll('.mx-profile-tick[data-done="1"]')].map(n => n.dataset.label) : []);
  const wasOpen = !!(box && box.querySelector('details[open]'));
  rerender('[data-block="completion"]', completionCard(false, wasOpen));
  if (!motionOK() || !box) return;
  // the bar glides from where it stood (a fresh node would otherwise jump straight to the new value)
  const bar = box.querySelector('.mx-profile-bar');
  if (bar && !isNaN(oldScale)) {
    const target = bar.style.transform;
    bar.style.transition = 'none'; bar.style.transform = `scaleX(${oldScale})`;
    void bar.offsetWidth;
    bar.style.transition = ''; bar.style.transform = target;
  }
  const pctEl = box.querySelector('[data-role="pct"]');
  tweenPct(pctEl, oldPct, pctOf(pctEl));
  // a checklist item that just became true ticks in
  box.querySelectorAll('.mx-profile-tick[data-done="1"]').forEach(n => { if (!wasDone.has(n.dataset.label)) n.classList.add('mx-profile-tick-in'); });
}
function refreshChips(touched) {
  rerender('[data-block="chips"]', chipRow());
  // the chip the member just pressed settles into its new state (the re-render drops its :active press)
  if (touched) { const el = q(`[data-block="chips"] [data-spec="${CSS.escape(touched)}"]`); if (el) el.classList.add('mx-profile-pop'); }
}
function refreshAccountExtras() { rerender('[data-block="accountExtras"]', accountExtraRows()); }
function refreshSaveRow() { rerender('[data-block="saveRow"]', saveRow()); }
function refreshPreviewCard() { rerender('[data-block="preview"]', previewCard()); }

// live completion while editing — the SAME server formula, dry-run (never a client copy)
function schedulePreview() {
  if (!D.v2) return;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(async () => {
    try {
      const c = await api.post('/api/v2/profile/completion/preview', draftBody());
      if (D && c && Array.isArray(c.items)) { D.completion = c; refreshCompletion(); }
    } catch (e) { /* keep the last known meter */ }
  }, 400);
}

// ---------------------------------------------------------------- actions
async function doSave() {
  if (D.saving) return;
  const d = D.draft;
  if (!d.first_name.trim()) return ui.toast(COPY.errors.first, { kind: 'error' });
  if (!d.last_name.trim()) return ui.toast(COPY.errors.last, { kind: 'error' });
  D.saving = true; D.saveError = null; refreshSaveRow();
  try {
    const r = await api.patch('/api/v2/profile', draftBody());
    const wasHidden = D.modHidden;
    D.modHidden = moderationHidden(r);
    D.profile = r.profile; D.completion = r.completion;
    D.draft = draftFrom(r.profile);
    D.custom = r.profile.specialties.filter(s => !COPY.fixedSpecs.includes(s));
    session.update({
      first_name: r.profile.first_name, last_name: r.profile.last_name, institution: r.profile.institution,
      country: r.profile.country, bio: r.profile.bio, photo_url: r.profile.photo_url,
      is_public_profile: r.profile.is_public_profile ? 1 : 0, email_verified: r.profile.email_verified
    });
    D.saving = false; D.saved = true;
    refreshSaveRow(); refreshCompletion(); refreshPreviewCard();
    if (wasHidden !== D.modHidden) rerender('[data-block="prefs"]', prefRows());
    ui.toast(COPY.account.savedToast);
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => { if (D) { D.saved = false; refreshSaveRow(); } }, 2600);
  } catch (e) {
    D.saving = false;
    // 403 (a suspended account) and 422 (the content filter — usually the bio): the edits stay on screen and
    // the server's own sentence sits next to SAVE CHANGES until the next edit
    if (e && (e.status === 403 || e.status === 422)) D.saveError = e.message;
    refreshSaveRow();
    ui.toast(e.message, { kind: 'error' });
    // the server names the field that needs rewording (422 {field}); the name pair focuses the first name
    if (e && e.status === 422) {
      const f = (e.data && e.data.field) || '';
      const key = f === 'name' ? 'first_name' : f;
      const el = key && q(`[data-field="${key}"]`);
      if (el) el.focus();
    }
  }
}
// GET/PATCH /api/v2/profile answer moderation_hidden: true while the team keeps the profile out of the directory
function moderationHidden(r) { return !!(r && (r.moderation_hidden || (r.profile && r.profile.moderation_hidden))); }
function onPhotoPicked(file) {
  if (!file) return;
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return ui.toast(COPY.identity.photoBadType, { kind: 'error' });
  if (file.size > 5 * 1024 * 1024) return ui.toast(COPY.identity.photoTooBig, { kind: 'error' });
  const reader = new FileReader();
  reader.onload = async () => {
    D.photoPreview = reader.result; D.photoBusy = true; refreshPhoto();
    const fd = new FormData(); fd.append('photo', file);
    try {
      const r = await api.post('/api/v2/profile/photo', fd);
      D.profile = r.profile; D.completion = r.completion; D.photoPreview = null; D.photoBusy = false;
      session.update({ photo_url: r.photo_url });
      refreshPhoto(); refreshCompletion();
      ui.toast(COPY.identity.photoSaved);
    } catch (e) {
      D.photoPreview = null; D.photoBusy = false;
      refreshPhoto();
      ui.toast(e.message, { kind: 'error' });
    }
  };
  reader.readAsDataURL(file);
}
function addSpecFromInput() {
  const input = q('[data-role="specDraft"]');
  const v = (input && input.value || '').trim().toUpperCase().replace(/\s+/g, ' ').slice(0, 40);
  if (!v) return;
  if (!COPY.fixedSpecs.includes(v) && !D.custom.includes(v)) D.custom.push(v);
  if (!D.draft.specialties.includes(v)) D.draft.specialties.push(v);
  if (input) input.value = '';
  refreshChips(v); schedulePreview();
}
function toggleSpec(label) {
  const on = D.draft.specialties.includes(label);
  if (on) {
    D.draft.specialties = D.draft.specialties.filter(x => x !== label);
    if (!COPY.fixedSpecs.includes(label)) D.custom = D.custom.filter(x => x !== label);   // artboard: a custom chip disappears when unselected
  } else {
    D.draft.specialties.push(label);
  }
  refreshChips(label); schedulePreview();
}

// ---------------------------------------------------------------- settings modals (moved from My Med&X)
function modalInput(label, name, type, value, ph) {
  return `<label style="display:block;margin-top:14px"><span class="label" style="display:block;margin-bottom:6px">${label}</span>
    <input name="${name}" type="${type || 'text'}" class="input" value="${esc(value || '')}" placeholder="${esc(ph || '')}" autocomplete="off"></label>`;
}
function openPasswordModal() {
  const a = COPY.account;
  const m = ui.modal({
    eyebrow: 'SETTINGS · PASSWORD', title: a.pwTitle,
    body: `${modalInput(a.pwCur, 'cur', 'password')}${modalInput(a.pwNew, 'nw', 'password', '', a.pwHint)}${modalInput(a.pwNew2, 'nw2', 'password')}<p data-role="error" style="color:#9b1b22;font-size:14px;min-height:18px;margin:8px 0 0"></p>`,
    actions: [{ label: 'CANCEL' }, {
      label: 'SAVE', kind: 'primary', onClick: () => {
        const cur = m.el.querySelector('[name=cur]').value, nw = m.el.querySelector('[name=nw]').value, nw2 = m.el.querySelector('[name=nw2]').value;
        const err = m.el.querySelector('[data-role=error]');
        if (nw.length < 8) { err.textContent = a.pwShort; return false; }
        if (nw !== nw2) { err.textContent = a.pwMismatch; return false; }
        // keepSession: a 401 here means "wrong current password", not an expired token
        api.post('/api/auth/change-password', { currentPassword: cur, newPassword: nw }, { keepSession: true })
          .then(() => { ui.toast(a.pwSaved); m.close(); })
          .catch(e => { err.textContent = e.message; });
        return false;
      }
    }]
  });
}
function openFollowModal(onDone) {
  const a = COPY.account;
  const left = Object.keys(a.projects).filter(k => !(D.topics || []).includes(k));
  if (!left.length) return ui.toast(a.followAll);
  const m = ui.modal({
    eyebrow: 'SETTINGS · PROJECTS I FOLLOW', title: a.followTitle,
    body: `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">${left.map(k => `<span data-follow="${k}" role="button" class="chip">${esc(a.projects[k])}</span>`).join('')}</div>`,
    actions: [{ label: 'DONE', kind: 'primary' }]
  });
  m.el.querySelectorAll('[data-follow]').forEach(el => {
    el.setAttribute('tabindex', '0');
    el.addEventListener('click', async () => {
      try {
        await api.post('/api/notify-topics', { project: el.dataset.follow, on: true });
        D.topics.push(el.dataset.follow);
        ui.toast(a.followed); m.close();
        refreshAccountExtras();
        if (typeof onDone === 'function') onDone();
        chrome.refresh();                          // FOLLOWING in the stats strip appears at 1
      } catch (e) { ui.toast(e.message, { kind: 'error' }); }
    });
  });
}
async function saveInterests(next) {
  const p = D.net || {};
  // PUT /api/networking/profile overwrites every column — carry the existing values along
  await api.put('/api/networking/profile', {
    career_stage: p.career_stage || null, looking_for: p.looking_for || null,
    research_interests: next, working_on: p.working_on || null,
    timezone: p.timezone || 'Europe/Zagreb', meeting_format: p.meeting_format || 'video',
    open_to_coffee_chats: p.open_to_coffee_chats == null ? 1 : p.open_to_coffee_chats,
    coffeeMatchmaker: !!p.coffee_matchmaker_opt_in
  });
  D.interests = next;
  if (D.net) D.net.research_interests = next;
  ui.toast(COPY.account.interestsSaved);
  refreshAccountExtras();
  if (manageRedraw) manageRedraw();
}
function openInterestsModal() {
  const a = COPY.account;
  const left = a.suggestions.filter(s => !(D.interests || []).some(i => i.toLowerCase() === s.toLowerCase()));
  const m = ui.modal({
    eyebrow: 'SETTINGS · MY INTERESTS', title: a.interestsTitle,
    body: `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">${left.map(s => `<span data-int="${esc(s)}" role="button" class="chip">${esc(s)}</span>`).join('') || `<span style="font-size:14px;color:#4a4239">${a.interestsAllAdded}</span>`}</div>
      ${modalInput(a.interestsOwn, 'custom', 'text', '', 'e.g. Cardiology')}`,
    actions: [{ label: 'CANCEL' }, {
      label: 'ADD', kind: 'primary', onClick: () => {
        const v = m.el.querySelector('[name=custom]').value.trim();
        if (!v) return true;
        saveInterests((D.interests || []).concat([v])).catch(e => ui.toast(e.message, { kind: 'error' }));
      }
    }]
  });
  m.el.querySelectorAll('[data-int]').forEach(el => {
    el.setAttribute('tabindex', '0');
    el.addEventListener('click', () => { m.close(); saveInterests((D.interests || []).concat([el.dataset.int])).catch(e => ui.toast(e.message, { kind: 'error' })); });
  });
}

// Projects I follow · My interests: a row opens a sheet with the list (× removes) and "Add" (the add sheets above);
// every change also refreshes the row's summary
let manageRedraw = null;
function openManage(kind) {
  const a = COPY.account, follow = kind === 'follow';
  const inner = () => follow ? settingChips(followList(), 'followRm', 'followAdd', a.follow.addT, a.follow.none) : settingChips(interestList(), 'intRm', 'intAdd', a.interests.addT, a.interests.none);
  const m = ui.modal({ eyebrow: 'SETTINGS', title: follow ? a.follow.t : a.interests.t, body: `<p class="mx-profile-sheet-s">${follow ? a.follow.s : a.interests.s}</p><div data-block="manage">${inner()}</div>` });
  const redraw = () => { const b = m.el.isConnected && m.el.querySelector('[data-block="manage"]'); if (b) b.innerHTML = inner(); };
  manageRedraw = redraw;
  m.onClose(() => { if (manageRedraw === redraw) manageRedraw = null; });
  ui.bind(m.el, {
    followRm: async el => { await handlers.followRm(el); redraw(); },
    followAdd: () => openFollowModal(redraw),
    intRm: el => handlers.intRm(el),
    intAdd: () => openInterestsModal()
  });
}

// ---------------------------------------------------------------- delete account
// The confirm stays disabled until DELETE is typed (any case); Enter in the field confirms, Escape or
// KEEP MY ACCOUNT closes and hands focus back to the button that opened it.
let deleting = false;
function openDeleteModal() {
  const c = COPY.del;
  const refocus = () => { const b = q('[data-act="deleteAccount"]'); if (b) b.focus(); };
  const m = ui.modal({
    eyebrow: c.modalEyebrow,
    title: c.modalTitle,
    body: `<p style="margin:0 0 14px">${c.modalBody}</p>
      <div class="mx-accs mx-profile-delinfo">
        <details class="mx-acc"><summary>${c.goneTT}</summary><div class="mx-acc-a"><p style="margin:0 0 10px">${c.modalGone}</p><ul class="mx-profile-gone">${c.gone.map(t => `<li>${t}</li>`).join('')}</ul></div></details>
        <details class="mx-acc"><summary>${c.keptTT}</summary><div class="mx-acc-a"><p style="margin:0">${c.kept}</p><p style="margin:10px 0 0;font-size:14px">${c.contact}</p></div></details>
      </div>
      <label style="display:block;margin-top:18px"><span class="label" style="display:block;margin-bottom:6px">${c.typeLabel}</span>
        <input data-role="delConfirm" type="text" class="input" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="done" aria-describedby="mx-del-err" style="letter-spacing:.12em"></label>
      <p id="mx-del-err" data-role="error" role="alert" style="color:#9b1b22;font-size:14px;min-height:18px;margin:8px 0 0"></p>`,
    actions: [
      { label: c.cancel, onClick: refocus },
      { label: c.confirm, kind: 'primary', onClick: () => { runDelete(m); return false; } }
    ]
  });
  m.onClose(refocus);
  m.el.classList.add('mx-profile-del-modal');
  const input = m.el.querySelector('[data-role="delConfirm"]');
  const go = m.el.querySelector('.mx-modal-foot [data-act="a1"]');
  const typed = () => input.value.trim().toUpperCase() === c.word;
  const sync = () => { if (typed() && !deleting) go.removeAttribute('aria-disabled'); else go.setAttribute('aria-disabled', 'true'); };
  sync();
  input.addEventListener('input', () => { m.el.querySelector('[data-role="error"]').textContent = ''; sync(); });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); if (typed()) go.click(); } });
  m.sync = sync;
  input.focus();
}
async function runDelete(m) {
  const c = COPY.del;
  const input = m.el.querySelector('[data-role="delConfirm"]');
  const go = m.el.querySelector('.mx-modal-foot [data-act="a1"]');
  const err = m.el.querySelector('[data-role="error"]');
  if (deleting || !input || input.value.trim().toUpperCase() !== c.word) return;
  deleting = true;
  go.setAttribute('aria-disabled', 'true'); go.setAttribute('aria-busy', 'true'); go.textContent = c.busy;
  input.disabled = true;
  try {
    const r = await api.del('/api/auth/account');
    m.close();
    session.clear();
    try { sessionStorage.removeItem('medx_verify_dismissed'); } catch (e) {}
    // a hook for the iOS shell to clear its Keychain session, Face ID lock and push token (not wired there yet)
    document.dispatchEvent(new CustomEvent('medx:account-deleted', { detail: { anonymized: !!(r && r.anonymized) } }));
    router.replace('/app/auth/welcome');
    ui.toast(r && r.anonymized ? c.doneKept : c.done, { ms: 6000 });
  } catch (e) {
    if (e && e.status === 401) { m.close(); return; }       // api.js already signed out and routed to sign-in
    go.removeAttribute('aria-busy'); go.textContent = c.confirm;
    input.disabled = false;
    err.textContent = (e && e.message) || c.failed;
    input.focus();
  } finally {
    deleting = false;
    if (m.el.isConnected && m.sync) m.sync();
  }
}

const handlers = {
  chgPw: openPasswordModal,
  followAdd: () => openFollowModal(),
  followOpen: () => openManage('follow'),
  intOpen: () => openManage('interests'),
  followRm: async (el) => {
    try {
      await api.post('/api/notify-topics', { project: el.dataset.key, on: false });
      D.topics = D.topics.filter(k => k !== el.dataset.key);
      ui.toast(COPY.account.followed);
      refreshAccountExtras();
      chrome.refresh();
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  intAdd: openInterestsModal,
  intRm: (el) => saveInterests((D.interests || []).filter(i => i !== el.dataset.key)).catch(e => ui.toast(e.message, { kind: 'error' })),
  pickPhoto: (el, e) => { if (e && e.target && e.target.tagName === 'INPUT') return; const input = q('[data-role="photoInput"]'); if (input) input.click(); },
  tgSpec: el => toggleSpec(el.dataset.spec),
  addSpec: () => addSpecFromInput(),
  tgDir: (el) => {
    if (D.modHidden) return ui.toast(COPY.account.dir.modHiddenToast);     // locked while the team keeps the profile hidden
    D.draft.is_public_profile = !D.draft.is_public_profile; setSwitch(el, D.draft.is_public_profile); schedulePreview();
    const line = q('[data-role="dirLine"]'); if (line) line.textContent = dirLine(D.draft.is_public_profile);
    const note = q('[data-role="saveNote"]'); if (note) note.textContent = saveNote();
  },
  tgUpd: (el) => { D.draft.updates_opt_in = !D.draft.updates_opt_in; setSwitch(el, D.draft.updates_opt_in); schedulePreview(); },
  save: () => doSave(),
  resend: async el => {
    const email = D.profile.email || (session.user || {}).email;
    if (!email) return ui.toast('No email on this session — sign in again.', { kind: 'error' });
    el.setAttribute('aria-disabled', 'true');
    try {
      const r = await api.post('/api/auth/request-verification', { email });
      ui.toast(r.message || COPY.account.resent);
      if (r.devVerifyUrl) console.info('[dev] verification link:', r.devVerifyUrl);
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
    clearTimeout(resendTimer);
    resendTimer = setTimeout(() => { const s = q('[data-act="resend"]'); if (s) s.removeAttribute('aria-disabled'); }, 30000);
  },
  viewProfile: () => {
    const d = D.draft;
    const rows = [
      d.title && `<div style="font-size:13px;color:#4a4239">${esc(d.title)}</div>`,
      (d.institution || d.city || d.country) && `<div style="font-size:13px;color:#4a4239;margin-top:2px">${esc([d.institution, [d.city, d.country].filter(Boolean).join(', ')].filter(Boolean).join(' · '))}</div>`,
      d.specialties.length && `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px">${d.specialties.map(s => `<span class="chip" style="cursor:default">${esc(specLabel(s))}</span>`).join('')}</div>`,
      `<div style="font-size:13px;line-height:1.6;color:#4a4239;margin-top:12px;font-style:italic">${esc(d.bio.trim() || COPY.preview.emptyBio)}</div>`,
      !d.is_public_profile && `<div style="font-size:14px;color:#9b1b22;margin-top:14px">${COPY.preview.hiddenNote}</div>`
    ].filter(Boolean).join('');
    ui.modal({
      eyebrow: COPY.preview.modalEyebrow,
      title: esc([d.first_name, d.last_name].filter(Boolean).join(' ') || 'Member'),
      body: rows,
      actions: [{ label: 'CLOSE', kind: 'primary' }]
    });
  },
  connect: () => ui.toast(COPY.preview.connectSelf),
  deleteAccount: () => openDeleteModal()
};

// ---------------------------------------------------------------- input wiring
function bindFields() {
  rootEl.querySelectorAll('[data-field]').forEach(el => {
    const key = el.dataset.field;
    const ev = el.tagName === 'SELECT' ? 'change' : 'input';
    el.addEventListener(ev, () => {
      D.draft[key] = el.value;
      if (D.saveError) { D.saveError = null; refreshSaveRow(); }
      if (key === 'first_name' || key === 'last_name' || key === 'bio' || key === 'institution' || key === 'title') refreshPreviewCard();
      if (key === 'first_name' || key === 'last_name') { const hn = q('[data-role="heroName"]'); if (hn) hn.textContent = [D.draft.first_name, D.draft.last_name].filter(Boolean).join(' ') || COPY.titleT; }
      if (FIELD_KEYS.includes(key)) schedulePreview();
    });
  });
  const spec = q('[data-role="specDraft"]');
  if (spec) spec.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addSpecFromInput(); } });
  const photo = q('[data-role="photoInput"]');
  if (photo) photo.addEventListener('change', e => { const f = e.target.files && e.target.files[0]; onPhotoPicked(f); e.target.value = ''; });
}
function ensureCss() {
  if (document.getElementById('mx-css-profile')) return;
  const l = document.createElement('link');
  l.id = 'mx-css-profile'; l.rel = 'stylesheet'; l.href = '/css/views/profile.css';
  document.head.appendChild(l);
}

// ---------------------------------------------------------------- view module
export default {
  title: 'Profile & settings',
  async render(root, ctx) {
    ensureCss();
    rootEl = root;
    const data = await load();
    if (rootEl !== root || (ctx.ready && !(await ctx.ready()))) return; // navigated away while loading, or the router moved on
    if (!data) { root.innerHTML = `<div class="empty" style="padding:70px 22px"><span class="rule-gold"></span><span class="empty-line">${COPY.errors.load}</span></div>`; return; }
    D = {
      profile: data.profile, completion: data.completion, v2: data.v2,
      draft: draftFrom(data.profile),
      custom: (data.profile.specialties || []).filter(s => !COPY.fixedSpecs.includes(s)),
      topics: data.topics || [], net: data.net || null, interests: data.interests || [],
      saved: false, saving: false, photoBusy: false, photoPreview: null,
      modHidden: !!data.modHidden, saveError: null
    };
    // the server (not a client guess) says whether the email is verified — let the shell banner agree
    if (data.v2) session.update({ email_verified: data.profile.email_verified });
    root.innerHTML = `
<div data-screen-label="Profile &amp; Settings" class="mx-profile-screen" style="font-family:Inter,sans-serif;color:#191512;background:#f7f1e6;min-height:100vh">
  ${blockCrumbs()}
  <div class="mx-p mx-profile-p">
    ${blockTitle()}
    <div data-block="completion" class="mx-profile-meterbox">${completionCard(true, false)}</div>
    ${blockIdentity()}
    ${blockAbout()}
    ${blockAccount()}
    ${blockPreview()}
    ${blockDelete()}
  </div>
</div>`;
    unbind = ui.bind(root, handlers);
    bindFields();
    revealMeter(root);
  },
  destroy() {
    clearTimeout(previewTimer); clearTimeout(savedTimer); clearTimeout(resendTimer);
    if (meterIO) { meterIO.disconnect(); meterIO = null; }
    timers.forEach(s => s()); timers = [];
    if (unbind) unbind(); unbind = null;
    D = null; rootEl = null;
  }
};
