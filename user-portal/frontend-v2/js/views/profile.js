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
import { api } from '../api.js';
import { session } from '../state.js';
import { ui, esc, fmt } from '../ui.js';

import { chrome } from '../chrome.js';
import { COUNTRIES, countryName } from './profile-countries.js';

export const SOURCE = 'Profile.dc.html';

// ---- COPY: every string that may change in a revision lives here --------------------------------
export const COPY = {
  crumbs: { my: 'MY MED&amp;X', here: 'PROFILE &amp; SETTINGS' },
  title: { main: 'Profile &amp; <i style="color:#9b1b22">Settings</i>', sub: 'How you appear to other members, and how the portal reaches you.' },
  identity: {
    n: '01', title: 'IDENTITY',
    photoWhy: 'A portrait helps colleagues recognise you at events.',
    upload: 'UPLOAD PHOTO', replace: 'REPLACE PHOTO', uploading: 'UPLOADING…',
    fields: { first: 'FIRST NAME', last: 'LAST NAME', title: 'TITLE / ROLE', institution: 'INSTITUTION', city: 'CITY', country: 'COUNTRY' },
    placeholders: { title: 'e.g. Postdoctoral researcher', city: 'e.g. Boston' },
    photoTooBig: 'That image is larger than 5 MB — pick a smaller one.',
    photoBadType: 'Use a JPG, PNG or WebP image.',
    photoSaved: 'Portrait saved — visible across the portal.'
  },
  about: {
    n: '02', title: 'ABOUT', sub: 'Shown on your member card and in the directory.',
    specialty: 'SPECIALTY', addBtn: '+ ADD',
    addPlaceholder: 'Add your own — e.g. Sleep medicine',
    addHint: 'Add as many as apply — selected tags show on your member card.',
    bio: 'SHORT BIO',
    bioPlaceholder: "Two or three sentences on your work and what you're looking for in the Med&X network…"
  },
  account: {
    n: '03', title: 'ACCOUNT &amp; PREFERENCES',
    email: 'Email', notConfirmed: 'not yet confirmed', confirmed: 'confirmed', resend: 'RESEND LINK',
    resent: 'Link sent — check your inbox (and spam).',
    // UX audit 2026-09-02 › item 8 — Profile & settings is the ONE place account settings live.
    // Password, the projects you follow and your research interests moved here from My Med&X, where
    // they were a second, differently-styled copy of this screen. These three save on the spot (they
    // are not part of the profile draft), which is why each carries its own action.
    pw: { t: 'Password', s: 'Changed here — you need your current one.', change: 'CHANGE →' },
    follow: { t: 'Projects I follow', s: 'Announcements and reminders for these reach your inbox and alerts.', add: '+ ADD', none: 'Following nothing yet.' },
    interests: { t: 'My interests', s: 'Used to suggest people worth meeting in the member directory.', add: '+ ADD', none: 'No interests added yet.' },
    pwTitle: 'Change your password', pwCur: 'CURRENT PASSWORD', pwNew: 'NEW PASSWORD', pwNew2: 'REPEAT NEW PASSWORD',
    pwHint: 'At least 8 characters', pwSaved: 'Password changed.',
    pwMismatch: 'The passwords do not match.', pwShort: 'At least 8 characters.',
    followTitle: 'Follow a project', followAll: 'You already follow every project.', followed: 'Following updated.',
    interestsTitle: 'Add an interest', interestsSaved: 'Interests updated.',
    interestsOwn: 'OR TYPE YOUR OWN', interestsAllAdded: 'All suggestions added — type your own below.',
    projects: { plexus: 'Plexus Conference', gala: 'Gala Evening', accelerator: 'The Accelerator', forum: 'Biomedical Forum', bridges: 'Building Bridges' },
    suggestions: ['Neuroscience', 'Sleep Medicine', 'Oncology', 'Public Health', 'Biotech', 'AI in Medicine', 'Mental Health', 'Genetics'],
    dir: { t: 'Directory visibility', s: 'Let other members find you and send connection requests.' },
    upd: { t: 'Event updates', s: 'News from projects you follow · Plexus, Gala, the Accelerator.' },
    lang: { t: 'Language', s: 'Portal interface language.', en: 'EN', hr: 'HR' },
    hrSaved: 'Croatian is saved as your preference — the portal switches when the translations land.',
    save: 'SAVE CHANGES', saving: 'SAVING…', saved: '✓ SAVED',
    saveNote: 'Changes apply across the portal and the member directory.',
    savedToast: 'CHANGES SAVED — VISIBLE ACROSS THE PORTAL',
    nothingToSave: 'Nothing changed yet — edit a field first.'
  },
  completion: {
    title: 'PROFILE COMPLETION', complete: 'COMPLETE',
    note: 'At 100%, the reminder on your Home page disappears.',
    offline: 'The completion service is unreachable right now — your edits still save.'
  },
  preview: {
    title: 'DIRECTORY PREVIEW', memberSince: y => `Member since ${y}`,
    emptyBio: 'Your bio will appear here.', view: 'VIEW PROFILE', connect: 'CONNECT',
    connectSelf: 'This is your own card — other members see CONNECT here.',
    modalEyebrow: 'DIRECTORY · AS OTHERS SEE YOU', hiddenNote: 'Directory visibility is OFF — only you can see this card.'
  },
  card: {
    title: 'YOUR MEMBER CARD',
    body: 'Your QR member card admits you to everything you’re registered for · find it in <a href="/app/me">My Med&amp;X</a>.'
  },
  fixedSpecs: ['NEUROSCIENCE', 'ONCOLOGY', 'CARDIOLOGY', 'GENETICS', 'PUBLIC HEALTH', 'BIOENGINEERING'],
  errors: {
    first: 'Add your first name.', last: 'Add your last name.',
    load: 'Your profile could not be loaded — pull to refresh or try again shortly.'
  }
};

const FIELD_KEYS = ['first_name', 'last_name', 'title', 'institution', 'city', 'country', 'bio'];
const LABEL = 'font:600 10px Inter,sans-serif;letter-spacing:.14em;color:#4a4239';
const INPUT = 'border:1px solid rgba(25,21,18,.25);background:#f7f1e6;padding:10px 12px;font-size:13px;color:#191512';

let D = null, unbind = null, timers = [], previewTimer = null, savedTimer = null, resendTimer = null, rootEl = null;

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
  if (r.v2 && r.v2.profile) return Object.assign({ profile: r.v2.profile, completion: r.v2.completion, v2: true }, extras);
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

// ---------------------------------------------------------------- blocks (artboard markup verbatim)
function blockCrumbs() {
  return `
  <!-- dc: Profile.dc.html › "Breadcrumb" -->
  <div class="mx-profile-pad" style="display:flex;align-items:center;gap:13px;padding:10px 36px;border-bottom:1px solid rgba(25,21,18,.16)">
    <a href="/app/me" style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em">${COPY.crumbs.my}</a>
    <span style="color:rgba(25,21,18,.35);font-size:10px">→</span>
    <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#191512">${COPY.crumbs.here}</span>
  </div>
  <!-- /dc -->`;
}
function blockTitle() {
  return `
  <!-- dc: Profile.dc.html › "Profile & Settings" -->
  <div class="mx-profile-pad" style="display:flex;align-items:baseline;gap:16px;padding:24px 36px 4px;flex-wrap:wrap">
    <span class="mx-profile-title" style="font-family:Fraunces,serif;font-size:34px;white-space:nowrap">${COPY.title.main}</span>
    <span style="font-size:12.5px;color:#4a4239">${COPY.title.sub}</span>
  </div>
  <!-- /dc -->`;
}
function photoCell() {
  const src = photoSrc();
  return src
    ? `<img data-role="photo" src="${esc(src)}" alt="Your portrait" class="mx-profile-photo${D.photoBusy ? ' busy' : ''}" style="width:74px;height:74px;object-fit:cover;flex:none">`
    : `<span data-role="initials" class="mx-profile-photo${D.photoBusy ? ' busy' : ''}" style="width:74px;height:74px;background:#191512;color:#f7f1e6;display:inline-flex;align-items:center;justify-content:center;font:600 26px Fraunces,serif;flex:none">${esc(initials())}</span>`;
}
function photoBtnLabel() { return D.photoBusy ? COPY.identity.uploading : (photoSrc() ? COPY.identity.replace : COPY.identity.upload); }
const fieldCell = (label, key, value, placeholder, autocomplete) => `
          <label style="display:flex;flex-direction:column;gap:6px">
            <span style="${LABEL}">${label}</span>
            <input data-field="${key}" value="${esc(value)}"${placeholder ? ` placeholder="${esc(placeholder)}"` : ''}${autocomplete ? ` autocomplete="${autocomplete}"` : ''} style="${INPUT}">
          </label>`;
function countrySelect() {
  const cur = D.draft.country || '';
  const known = COUNTRIES.includes(cur);
  return `
          <label style="display:flex;flex-direction:column;gap:6px">
            <span style="${LABEL}">${COPY.identity.fields.country}</span>
            <select data-field="country" autocomplete="country-name" style="${INPUT}">
              ${cur === '' ? '<option value="" selected></option>' : ''}
              ${!known && cur !== '' ? `<option value="${esc(cur)}" selected>${esc(cur)}</option>` : ''}
              ${COUNTRIES.map(c => `<option value="${esc(c)}"${c === cur ? ' selected' : ''}>${esc(c)}</option>`).join('')}
            </select>
          </label>`;
}
function blockIdentity() {
  const f = COPY.identity.fields, ph = COPY.identity.placeholders, d = D.draft;
  return `
      <!-- dc: Profile.dc.html › "01 · IDENTITY" -->
      <div style="border:1px solid rgba(25,21,18,.16);background:#fdfaf3">
        <div class="mx-cardrow" style="display:flex;align-items:baseline;gap:14px;padding:20px 26px 4px">
          <span style="font-family:Fraunces,serif;font-weight:600;font-size:14px;color:#9b1b22">${COPY.identity.n}</span>
          <span style="font:600 13px Inter,sans-serif;letter-spacing:.14em">${COPY.identity.title}</span>
        </div>
        <div class="mx-cardrow mx-profile-photo-row" style="display:flex;gap:22px;align-items:center;padding:16px 26px 4px">
          <span data-block="photoCell" style="display:contents">${photoCell()}</span>
          <span style="display:flex;flex-direction:column;gap:7px;align-items:flex-start">
            <span style="font-size:12px;color:#4a4239">${COPY.identity.photoWhy}</span>
            <label data-act="pickPhoto" role="button" tabindex="0" aria-label="Upload a portrait photo" style="padding:8px 13px;border:1px solid rgba(25,21,18,.3);font:600 9.5px Inter,sans-serif;letter-spacing:.16em;cursor:pointer" data-hover="border-color:#191512"><span data-role="photoBtn">${photoBtnLabel()}</span><input data-role="photoInput" type="file" accept="image/jpeg,image/png,image/webp" style="display:none"></label>
          </span>
        </div>
        <div class="mx-cardrow mx-grid-2" style="display:grid;grid-template-columns:1fr 1fr;gap:16px 20px;padding:18px 26px 24px">
          ${fieldCell(f.first, 'first_name', d.first_name, '', 'given-name')}
          ${fieldCell(f.last, 'last_name', d.last_name, '', 'family-name')}
          ${fieldCell(f.title, 'title', d.title, ph.title, 'organization-title')}
          ${fieldCell(f.institution, 'institution', d.institution, '', 'organization')}
          ${fieldCell(f.city, 'city', d.city, ph.city, 'address-level2')}
          ${countrySelect()}
        </div>
      </div>
      <!-- /dc -->`;
}
function chipRow() {
  const on = name => D.draft.specialties.includes(name);
  const all = COPY.fixedSpecs.concat(D.custom.filter(c => !COPY.fixedSpecs.includes(c)));
  return all.map(label => {
    const a = on(label);
    return `<span data-act="tgSpec" data-spec="${esc(label)}" role="button" tabindex="0" aria-pressed="${a}" style="padding:6px 11px;border:1px solid ${a ? '#9b1b22' : 'rgba(25,21,18,.22)'};background:${a ? '#9b1b22' : 'transparent'};color:${a ? '#f7f1e6' : '#191512'};font:600 9.5px Inter,sans-serif;letter-spacing:.14em;cursor:pointer">${esc(label)}</span>`;
  }).join('\n            ');
}
function blockAbout() {
  return `
      <!-- dc: Profile.dc.html › "02 · ABOUT" -->
      <div style="border:1px solid rgba(25,21,18,.16);background:#fdfaf3">
        <div class="mx-cardrow" style="display:flex;align-items:baseline;gap:14px;padding:20px 26px 4px;flex-wrap:wrap">
          <span style="font-family:Fraunces,serif;font-weight:600;font-size:14px;color:#9b1b22">${COPY.about.n}</span>
          <span style="font:600 13px Inter,sans-serif;letter-spacing:.14em">${COPY.about.title}</span>
          <span style="font-size:11.5px;color:#4a4239">${COPY.about.sub}</span>
        </div>
        <div class="mx-cardrow" style="padding:16px 26px 6px">
          <span style="${LABEL}">${COPY.about.specialty}</span>
          <div data-block="chips" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
            ${chipRow()}
          </div>
          <div class="mx-profile-row" style="display:flex;gap:8px;margin-top:10px;align-items:center;flex-wrap:wrap">
            <input data-role="specDraft" class="mx-w230" placeholder="${esc(COPY.about.addPlaceholder)}" aria-label="Add a specialty" style="border:1px solid rgba(25,21,18,.25);background:#f7f1e6;padding:8px 11px;font-size:12.5px;color:#191512;width:230px">
            <span data-act="addSpec" role="button" tabindex="0" style="padding:8px 13px;border:1px solid rgba(25,21,18,.3);font:600 9.5px Inter,sans-serif;letter-spacing:.14em;cursor:pointer" data-hover="border-color:#191512">${COPY.about.addBtn}</span>
            <span style="font-size:11px;color:#4a4239">${COPY.about.addHint}</span>
          </div>
        </div>
        <div class="mx-cardrow" style="padding:16px 26px 24px">
          <label style="display:flex;flex-direction:column;gap:6px">
            <span style="${LABEL}">${COPY.about.bio}</span>
            <textarea data-field="bio" rows="3" placeholder="${esc(COPY.about.bioPlaceholder)}" style="border:1px solid rgba(25,21,18,.25);background:#f7f1e6;padding:10px 12px;font-size:13px;color:#191512;line-height:1.55;resize:vertical">${esc(D.draft.bio)}</textarea>
          </label>
        </div>
      </div>
      <!-- /dc -->`;
}
const toggle = (act, on, label) => `<span data-act="${act}" role="switch" tabindex="0" aria-checked="${on}" aria-label="${esc(label)}" style="width:34px;height:18px;flex:none;cursor:pointer;background:${on ? '#9b1b22' : 'rgba(25,21,18,.25)'};position:relative;transition:background .3s"><span style="position:absolute;top:2px;width:14px;height:14px;background:#f7f1e6;transition:left .3s;left:${on ? '18px' : '2px'}"></span></span>`;
function prefRows() {
  const d = D.draft, a = COPY.account;
  return `
        <div class="mx-cardrow" style="display:flex;gap:16px;align-items:center;padding:12px 26px;border-top:1px solid rgba(25,21,18,.1)">
          <span style="flex:1"><span style="display:block;font-size:13px;font-weight:600">${a.dir.t}</span><span style="display:block;font-size:11.5px;color:#4a4239;margin-top:2px">${a.dir.s}</span></span>
          ${toggle('tgDir', d.is_public_profile, a.dir.t)}
        </div>
        <div class="mx-cardrow" style="display:flex;gap:16px;align-items:center;padding:12px 26px;border-top:1px solid rgba(25,21,18,.1)">
          <span style="flex:1"><span style="display:block;font-size:13px;font-weight:600">${a.upd.t}</span><span style="display:block;font-size:11.5px;color:#4a4239;margin-top:2px">${a.upd.s}</span></span>
          ${toggle('tgUpd', d.updates_opt_in, a.upd.t)}
        </div>
        <div class="mx-cardrow" style="display:flex;gap:16px;align-items:center;padding:12px 26px;border-top:1px solid rgba(25,21,18,.1)">
          <span style="flex:1"><span style="display:block;font-size:13px;font-weight:600">${a.lang.t}</span><span style="display:block;font-size:11.5px;color:#4a4239;margin-top:2px">${a.lang.s}</span></span>
          <span style="display:flex">
            <span data-act="setEN" role="button" tabindex="0" aria-pressed="${d.locale === 'en'}" style="padding:7px 13px;font:600 9.5px Inter,sans-serif;letter-spacing:.15em;cursor:pointer;border:1px solid rgba(25,21,18,.3);background:${d.locale === 'en' ? '#191512' : 'transparent'};color:${d.locale === 'en' ? '#f7f1e6' : '#4a4239'}">${a.lang.en}</span>
            <span data-act="setHR" role="button" tabindex="0" aria-pressed="${d.locale === 'hr'}" data-v2="HR ships with the translations — the preference persists now" style="padding:7px 13px;font:600 9.5px Inter,sans-serif;letter-spacing:.15em;cursor:pointer;border:1px solid rgba(25,21,18,.3);border-left:none;background:${d.locale === 'hr' ? '#191512' : 'transparent'};color:${d.locale === 'hr' ? '#f7f1e6' : '#4a4239'}">${a.lang.hr}</span>
          </span>
        </div>`;
}
// The three settings that moved here from My Med&X. They save immediately (own routes), so they sit
// above SAVE CHANGES with their own actions rather than inside the profile draft.
function settingChips(list, rmAct, addAct, addLabel, noneLabel) {
  return `<span style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
            ${list.length ? list.map(v => `<span style="padding:5px 10px;border:1px solid rgba(25,21,18,.22);font-size:12px;white-space:nowrap">${esc(v.label)} <span data-act="${rmAct}" data-key="${esc(v.key)}" role="button" tabindex="0" aria-label="Remove ${esc(v.label)}" style="cursor:pointer;color:#9b1b22">×</span></span>`).join('') : `<span style="font-size:12px;color:#4a4239;align-self:center">${noneLabel}</span>`}
            <span data-act="${addAct}" role="button" tabindex="0" style="padding:5px 10px;border:1px dashed rgba(25,21,18,.35);font:600 9.5px Inter,sans-serif;letter-spacing:.14em;color:#9b1b22;cursor:pointer;white-space:nowrap">${addLabel}</span>
          </span>`;
}
function accountExtraRows() {
  const a = COPY.account;
  const follows = (D.topics || []).map(k => ({ key: k, label: a.projects[k] || k }));
  const interests = (D.interests || []).map(k => ({ key: k, label: k }));
  return `
        <div class="mx-cardrow mx-profile-row" style="display:flex;gap:16px;align-items:center;padding:12px 26px;border-top:1px solid rgba(25,21,18,.1)">
          <span style="flex:1"><span style="display:block;font-size:13px;font-weight:600">${a.pw.t}</span><span style="display:block;font-size:11.5px;color:#4a4239;margin-top:2px">${a.pw.s}</span></span>
          <span data-act="chgPw" role="button" tabindex="0" style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#9b1b22;cursor:pointer;white-space:nowrap">${a.pw.change}</span>
        </div>
        <div class="mx-cardrow mx-profile-row" style="display:flex;gap:16px;align-items:center;padding:12px 26px;border-top:1px solid rgba(25,21,18,.1);flex-wrap:wrap">
          <span style="flex:1;min-width:200px"><span style="display:block;font-size:13px;font-weight:600">${a.follow.t}</span><span style="display:block;font-size:11.5px;color:#4a4239;margin-top:2px">${a.follow.s}</span></span>
          ${settingChips(follows, 'followRm', 'followAdd', a.follow.add, a.follow.none)}
        </div>
        <div class="mx-cardrow mx-profile-row" style="display:flex;gap:16px;align-items:center;padding:12px 26px;border-top:1px solid rgba(25,21,18,.1);flex-wrap:wrap">
          <span style="flex:1;min-width:200px"><span style="display:block;font-size:13px;font-weight:600">${a.interests.t}</span><span style="display:block;font-size:11.5px;color:#4a4239;margin-top:2px">${a.interests.s}</span></span>
          ${settingChips(interests, 'intRm', 'intAdd', a.interests.add, a.interests.none)}
        </div>`;
}
function saveRow() {
  const a = COPY.account;
  const label = D.saving ? a.saving : (D.saved ? a.saved : a.save);
  return `
        <div class="mx-cardrow mx-profile-row" style="display:flex;align-items:center;gap:14px;padding:16px 26px 20px;border-top:1px solid rgba(25,21,18,.16)">
          <span data-act="save" role="button" tabindex="0"${D.saving ? ' aria-disabled="true"' : ''} style="padding:11px 20px;background:#9b1b22;color:#f7f1e6;font:600 10px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;white-space:nowrap;flex:none" data-hover="background:#7e151b">${label}</span>
          <span style="font-size:11.5px;color:#4a4239">${a.saveNote}</span>
        </div>`;
}
function blockAccount() {
  const a = COPY.account, p = D.profile;
  const verified = Number(p.email_verified) === 1;
  return `
      <!-- dc: Profile.dc.html › "03 · ACCOUNT & PREFERENCES" -->
      <div style="border:1px solid rgba(25,21,18,.16);background:#fdfaf3">
        <div class="mx-cardrow" style="display:flex;align-items:baseline;gap:14px;padding:20px 26px 10px">
          <span style="font-family:Fraunces,serif;font-weight:600;font-size:14px;color:#9b1b22">${a.n}</span>
          <span style="font:600 13px Inter,sans-serif;letter-spacing:.14em">${a.title}</span>
        </div>
        <div class="mx-cardrow mx-profile-row" style="display:flex;gap:16px;align-items:center;padding:12px 26px;border-top:1px solid rgba(25,21,18,.1)">
          <span style="flex:1"><span style="display:block;font-size:13px;font-weight:600">${a.email}</span><span style="display:block;font-size:11.5px;color:#4a4239;margin-top:2px">${esc(p.email || '')} · ${verified ? `<span style="color:#6e5626">${a.confirmed}</span>` : `<span style="color:#9b1b22">${a.notConfirmed}</span>`}</span></span>
          ${verified ? '' : `<span data-act="resend" role="button" tabindex="0" style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#9b1b22;cursor:pointer;white-space:nowrap">${a.resend}</span>`}
        </div>
        <span data-block="prefs" style="display:contents">${prefRows()}</span>
        <span data-block="accountExtras" style="display:contents">${accountExtraRows()}</span>
        <span data-block="saveRow" style="display:contents">${saveRow()}</span>
      </div>
      <!-- /dc -->`;
}
function completionCard() {
  const c = D.completion;
  const rows = c ? c.items.map(i => `
            <div style="display:flex;gap:11px;align-items:center;padding:8px 0;border-bottom:1px solid rgba(25,21,18,.1)"${i.hint ? ` title="${esc(i.hint)}"` : ''}>
              <span style="width:11px;height:11px;border:1px solid ${i.done ? '#c9a962' : 'rgba(25,21,18,.35)'};background:${i.done ? '#c9a962' : 'transparent'};flex:none"></span>
              <span style="font-size:12px;color:${i.done ? '#191512' : '#4a4239'}">${esc(i.label)}</span>
            </div>`).join('') : `
            <div style="padding:8px 0;font-size:12px;color:#4a4239;line-height:1.5">${COPY.completion.offline}</div>`;
  const pct = c ? c.percent + '%' : '—';
  return `
        <div style="font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#c9a962">${COPY.completion.title}</div>
        <div style="margin-top:12px;display:flex;flex-direction:column">${rows}
        </div>
        <div style="display:flex;align-items:baseline;gap:8px;padding-top:14px">
          <span data-role="pct" style="font-family:Fraunces,serif;font-size:30px;color:#c9a962">${pct}</span>
          <span style="font:600 9px Inter,sans-serif;letter-spacing:.16em;color:#4a4239">${COPY.completion.complete}</span>
        </div>
        <div style="height:3px;background:rgba(25,21,18,.12);position:relative;margin-top:6px"><span class="mx-profile-bar" style="position:absolute;left:0;top:0;bottom:0;background:#c9a962;width:${c ? c.percent : 0}%"></span></div>
        <div style="font-size:11px;color:#4a4239;line-height:1.5;margin-top:10px">${COPY.completion.note}</div>`;
}
function previewCard() {
  const d = D.draft, p = D.profile;
  const src = photoSrc();
  const name = [d.first_name, d.last_name].filter(Boolean).join(' ') || (p.email || 'Member');
  const line = [d.institution, p.member_since ? COPY.preview.memberSince(p.member_since) : ''].filter(Boolean).join(' · ');
  return `
        <div style="font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#c9a962">${COPY.preview.title}</div>
        <div style="display:flex;gap:13px;align-items:center;margin-top:14px">
          ${src
            ? `<img src="${esc(src)}" alt="" style="width:44px;height:44px;object-fit:cover;flex:none">`
            : `<span style="width:44px;height:44px;background:#c9a962;color:#191512;display:inline-flex;align-items:center;justify-content:center;font:600 15px Fraunces,serif;flex:none">${esc(initials())}</span>`}
          <span style="display:flex;flex-direction:column;line-height:1.3">
            <span style="font-family:Fraunces,serif;font-size:16px">${esc(name)}</span>
            <span style="font-size:11px;color:rgba(247,241,230,.65)">${esc(line)}</span>
          </span>
        </div>
        <div style="font-family:Fraunces,serif;font-style:italic;font-size:12.5px;color:rgba(247,241,230,.55);margin-top:12px">${esc(d.bio.trim() || COPY.preview.emptyBio)}</div>
        <div style="display:flex;gap:8px;margin-top:14px">
          <span data-act="viewProfile" role="button" tabindex="0" style="flex:1;text-align:center;padding:8px 0;border:1px solid rgba(247,241,230,.3);font:600 9px Inter,sans-serif;letter-spacing:.15em;cursor:pointer" data-hover="border-color:#f7f1e6">${COPY.preview.view}</span>
          <span data-act="connect" role="button" tabindex="0" style="flex:1;text-align:center;padding:8px 0;background:#9b1b22;font:600 9px Inter,sans-serif;letter-spacing:.15em;cursor:pointer" data-hover="background:#7e151b">${COPY.preview.connect}</span>
        </div>`;
}
function blockSidebar() {
  return `
    <div style="display:flex;flex-direction:column;gap:14px">
      <!-- dc: Profile.dc.html › "PROFILE COMPLETION" -->
      <div data-block="completion" style="border:1px solid rgba(25,21,18,.16);background:#fdfaf3;padding:20px 22px">${completionCard()}</div>
      <!-- /dc -->
      <!-- dc: Profile.dc.html › "DIRECTORY PREVIEW" -->
      <div data-block="preview" style="border:1px solid rgba(25,21,18,.16);background:#191512;color:#f7f1e6;padding:20px 22px">${previewCard()}</div>
      <!-- /dc -->
      <!-- dc: Profile.dc.html › "YOUR MEMBER CARD" -->
      <div style="border:1px solid rgba(25,21,18,.16);background:#fdfaf3;padding:18px 22px;display:flex;flex-direction:column;gap:8px">
        <span style="font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#c9a962">${COPY.card.title}</span>
        <span style="font-size:12px;color:#4a4239;line-height:1.55">${COPY.card.body}</span>
      </div>
      <!-- /dc -->
    </div>`;
}

// ---------------------------------------------------------------- targeted re-renders
const q = sel => rootEl && rootEl.querySelector(sel);
function rerender(sel, html) { const el = q(sel); if (el) el.innerHTML = html; }
function refreshPhoto() {
  rerender('[data-block="photoCell"]', photoCell());
  const b = q('[data-role="photoBtn"]'); if (b) b.textContent = photoBtnLabel();
  rerender('[data-block="preview"]', previewCard());
}
function refreshCompletion() { rerender('[data-block="completion"]', completionCard()); }
function refreshChips() { rerender('[data-block="chips"]', chipRow()); }
function refreshPrefs() { rerender('[data-block="prefs"]', prefRows()); }
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
  D.saving = true; refreshSaveRow();
  try {
    const r = await api.patch('/api/v2/profile', draftBody());
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
    ui.toast(COPY.account.savedToast);
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => { if (D) { D.saved = false; refreshSaveRow(); } }, 2600);
  } catch (e) {
    D.saving = false; refreshSaveRow();
    ui.toast(e.message, { kind: 'error' });
  }
}
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
  refreshChips(); schedulePreview();
}
function toggleSpec(label) {
  const on = D.draft.specialties.includes(label);
  if (on) {
    D.draft.specialties = D.draft.specialties.filter(x => x !== label);
    if (!COPY.fixedSpecs.includes(label)) D.custom = D.custom.filter(x => x !== label);   // artboard: a custom chip disappears when unselected
  } else {
    D.draft.specialties.push(label);
  }
  refreshChips(); schedulePreview();
}

// ---------------------------------------------------------------- settings modals (moved from My Med&X)
function modalInput(label, name, type, value, ph) {
  return `<label style="display:block;margin-top:12px"><span class="label" style="display:block;${LABEL};margin-bottom:5px">${label}</span>
    <input name="${name}" type="${type || 'text'}" value="${esc(value || '')}" placeholder="${esc(ph || '')}" autocomplete="off" style="${INPUT};width:100%;box-sizing:border-box"></label>`;
}
function openPasswordModal() {
  const a = COPY.account;
  const m = ui.modal({
    eyebrow: 'SETTINGS · PASSWORD', title: a.pwTitle,
    body: `${modalInput(a.pwCur, 'cur', 'password')}${modalInput(a.pwNew, 'nw', 'password', '', a.pwHint)}${modalInput(a.pwNew2, 'nw2', 'password')}<p data-role="error" style="color:#9b1b22;font-size:12px;min-height:14px;margin:8px 0 0"></p>`,
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
function openFollowModal() {
  const a = COPY.account;
  const left = Object.keys(a.projects).filter(k => !(D.topics || []).includes(k));
  if (!left.length) return ui.toast(a.followAll);
  const m = ui.modal({
    eyebrow: 'SETTINGS · PROJECTS I FOLLOW', title: a.followTitle,
    body: `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">${left.map(k => `<span data-follow="${k}" role="button" style="padding:7px 12px;border:1px solid rgba(25,21,18,.22);font-size:12.5px;cursor:pointer" data-hover="border-color:#9b1b22;color:#9b1b22">${esc(a.projects[k])}</span>`).join('')}</div>`,
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
}
function openInterestsModal() {
  const a = COPY.account;
  const left = a.suggestions.filter(s => !(D.interests || []).some(i => i.toLowerCase() === s.toLowerCase()));
  const m = ui.modal({
    eyebrow: 'SETTINGS · MY INTERESTS', title: a.interestsTitle,
    body: `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">${left.map(s => `<span data-int="${esc(s)}" role="button" style="padding:7px 12px;border:1px solid rgba(25,21,18,.22);font-size:12.5px;cursor:pointer" data-hover="border-color:#9b1b22;color:#9b1b22">${esc(s)}</span>`).join('') || `<span style="font-size:12.5px;color:#4a4239">${a.interestsAllAdded}</span>`}</div>
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

const handlers = {
  chgPw: openPasswordModal,
  followAdd: openFollowModal,
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
  tgDir: () => { D.draft.is_public_profile = !D.draft.is_public_profile; refreshPrefs(); schedulePreview(); },
  tgUpd: () => { D.draft.updates_opt_in = !D.draft.updates_opt_in; refreshPrefs(); schedulePreview(); },
  setEN: () => { D.draft.locale = 'en'; refreshPrefs(); },
  setHR: () => { D.draft.locale = 'hr'; refreshPrefs(); ui.toast(COPY.account.hrSaved); },
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
      d.specialties.length && `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px">${d.specialties.map(s => `<span style="padding:4px 8px;border:1px solid rgba(25,21,18,.25);font:600 8.5px Inter,sans-serif;letter-spacing:.12em">${esc(s)}</span>`).join('')}</div>`,
      `<div style="font-size:13px;line-height:1.6;color:#4a4239;margin-top:12px;font-style:italic">${esc(d.bio.trim() || COPY.preview.emptyBio)}</div>`,
      !d.is_public_profile && `<div style="font:600 9.5px Inter,sans-serif;letter-spacing:.14em;color:#9b1b22;margin-top:14px">${COPY.preview.hiddenNote}</div>`
    ].filter(Boolean).join('');
    ui.modal({
      eyebrow: COPY.preview.modalEyebrow,
      title: esc([d.first_name, d.last_name].filter(Boolean).join(' ') || 'Member'),
      body: rows,
      actions: [{ label: 'CLOSE', kind: 'primary' }]
    });
  },
  connect: () => ui.toast(COPY.preview.connectSelf)
};

// ---------------------------------------------------------------- input wiring
function bindFields() {
  rootEl.querySelectorAll('[data-field]').forEach(el => {
    const key = el.dataset.field;
    const ev = el.tagName === 'SELECT' ? 'change' : 'input';
    el.addEventListener(ev, () => {
      D.draft[key] = el.value;
      if (key === 'first_name' || key === 'last_name' || key === 'bio' || key === 'institution') refreshPreviewCard();
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
    if (!data) { root.innerHTML = `<div class="empty" style="padding:70px 22px"><span class="rule-gold"></span><span class="empty-line">${COPY.errors.load}</span></div>`; return; }
    D = {
      profile: data.profile, completion: data.completion, v2: data.v2,
      draft: draftFrom(data.profile),
      custom: (data.profile.specialties || []).filter(s => !COPY.fixedSpecs.includes(s)),
      topics: data.topics || [], net: data.net || null, interests: data.interests || [],
      saved: false, saving: false, photoBusy: false, photoPreview: null
    };
    // the server (not a client guess) says whether the email is verified — let the shell banner agree
    if (data.v2) session.update({ email_verified: data.profile.email_verified });
    root.innerHTML = `
<div data-screen-label="Profile &amp; Settings" style="font-family:Inter,sans-serif;color:#191512;background:#f7f1e6;min-height:100vh">
  ${blockCrumbs()}
  ${blockTitle()}
  <div class="mx-profile-grid mx-profile-pad" style="display:grid;grid-template-columns:1fr 300px;gap:26px;padding:20px 36px 30px;align-items:start">
    <div style="display:flex;flex-direction:column;gap:22px">
      ${blockIdentity()}
      ${blockAbout()}
      ${blockAccount()}
    </div>
    ${blockSidebar()}
  </div>
</div>`;
    unbind = ui.bind(root, handlers);
    bindFields();
  },
  destroy() {
    clearTimeout(previewTimer); clearTimeout(savedTimer); clearTimeout(resendTimer);
    timers.forEach(s => s()); timers = [];
    if (unbind) unbind(); unbind = null;
    D = null; rootEl = null;
  }
};
