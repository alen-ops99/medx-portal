// Sign-in — no admin artboard exists; built from the admin header vocabulary (Admin Home.dc.html:
// stacked logo lockup + ADMIN, paper ground, white card, hairlines, the Settings input/button
// vocabulary) and the member Auth.dc.html sign-in structure (headline · blurb · EMAIL · PASSWORD ·
// crimson submit · inline error line). Second step: the invited-admin "set your password" screen
// (POST /api/auth/change-password while must_change_password is armed — the API rejects everything else).
import { api } from '../api.js';
import { session } from '../state.js';
import { ui, esc } from '../ui.js';
import { chrome } from '../chrome.js';
import { health } from '../health.js';
import cfg from '../config.js';
import router from '../router.js';

export const SOURCE = 'Admin Home.dc.html (header lockup) + Auth.dc.html (form structure)';
export const COPY = {
  admin: 'ADMIN',
  signin: {
    headline: 'Welcome <i>back</i>.', blurb: 'Today, your projects, the inbox — where you left them.',
    email: 'EMAIL', password: 'PASSWORD', submit: 'SIGN IN →', busy: 'SIGNING IN…',
    placeholders: { email: 'you@medx.hr', password: '••••••••' },
    welcome: name => `Welcome back, ${name}.`,
    errors: { empty: 'Enter your email and password.', bad: "That email and password don't match.", notAdmin: 'Admin access only — members sign in at the member portal.', limited: 'Too many attempts — the door reopens in a few minutes.' }
  },
  password: {
    tag: 'FIRST SIGN-IN', headline: 'Set your <i>password</i>.', blurb: 'Your invite carried a temporary password. Choose your own to unlock the portal — at least 8 characters.',
    label: 'NEW PASSWORD', again: 'REPEAT IT', submit: 'SAVE PASSWORD →', busy: 'SAVING…',
    errors: { short: 'Use at least 8 characters.', mismatch: 'The two passwords differ.' }, done: 'Password set — welcome in.'
  },
  footer: { members: 'Members sign in at the member portal ↗', staging: 'STAGING · review copy of the data, emails never send' }
};

const INPUT = 'border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:10px 12px;font:400 13px Inter,sans-serif;color:#201b16;width:100%;box-sizing:border-box';
const LABEL = 'font:600 8.5px Inter,sans-serif;letter-spacing:.14em;color:#6d6459';
const PRIMARY = 'margin-top:18px;padding:12px 0;background:#9b1b22;color:#fff;font:600 10.5px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;text-align:center;display:block;white-space:nowrap;width:100%;border:0';

let rootEl = null, unbind = null, step = 'signin';

function field(label, name, type, placeholder, autocomplete) {
  return `<label style="display:flex;flex-direction:column;gap:5px;margin-top:14px"><span style="${LABEL}">${label}</span><input name="${name}" type="${type}" placeholder="${esc(placeholder)}" autocomplete="${autocomplete}" aria-label="${esc(label)}" style="${INPUT}"></label>`;
}
function errorLine() { return `<div data-role="error" style="display:none;font-size:12.5px;line-height:1.5;margin-top:12px;color:#9b1b22"></div>`; }

function blockSignin(query) {
  const s = COPY.signin;
  return `
    <form data-form="signin" novalidate style="display:contents">
      <span style="width:28px;height:1px;background:#c9a962;display:block"></span>
      <div class="mx-display-30" style="font-family:Fraunces,serif;font-size:30px;line-height:1.12;margin-top:14px">${s.headline}</div>
      <div style="font-size:13px;color:#6d6459;margin-top:8px;line-height:1.5">${s.blurb}</div>
      ${query.notice === 'signedout' ? '' : ''}
      ${field(s.email, 'email', 'email', s.placeholders.email, 'username')}
      ${field(s.password, 'password', 'password', s.placeholders.password, 'current-password')}
      ${errorLine()}
      <button type="submit" data-act="signin" style="${PRIMARY}" data-hover="background:#7e151b">${s.submit}</button>
    </form>`;
}
function blockPassword() {
  const p = COPY.password;
  return `
    <form data-form="password" novalidate style="display:contents">
      <span style="font:600 9px Inter,sans-serif;letter-spacing:.12em;background:#f8f1e2;color:#7a6432;padding:3px 8px;align-self:flex-start">${p.tag}</span>
      <div class="mx-display-30" style="font-family:Fraunces,serif;font-size:30px;line-height:1.12;margin-top:14px">${p.headline}</div>
      <div style="font-size:13px;color:#6d6459;margin-top:8px;line-height:1.5">${p.blurb}</div>
      ${field(p.label, 'newPassword', 'password', '••••••••', 'new-password')}
      ${field(p.again, 'again', 'password', '••••••••', 'new-password')}
      ${errorLine()}
      <button type="submit" data-act="setPassword" style="${PRIMARY}" data-hover="background:#7e151b">${p.submit}</button>
    </form>`;
}
function template(query) {
  return `
<div data-screen-label="Admin Sign in" style="min-height:100vh;background:#f6f2ea;color:#201b16;font-family:Inter,sans-serif;display:flex;flex-direction:column">
  <div style="background:#fff;border-bottom:1px solid rgba(32,27,22,.14)">
    <div class="mx-gutter" style="max-width:1180px;margin:0 auto;padding:0 28px;height:58px;display:flex;align-items:center;gap:26px">
      <span style="display:flex;flex-direction:column;align-items:flex-end;gap:2px"><img src="/assets/logo.png" alt="med&amp;X" style="height:18px;display:block"><span style="font:600 8px Inter,sans-serif;letter-spacing:.3em;color:#9b1b22">${COPY.admin}</span></span>
      <div style="flex:1"></div>
      ${cfg.isStaging ? `<span style="font:600 9px Inter,sans-serif;letter-spacing:.12em;background:#f8f1e2;color:#7a6432;padding:3px 8px;white-space:nowrap">${COPY.footer.staging}</span>` : ''}
    </div>
  </div>
  <div style="flex:1;display:flex;align-items:center;justify-content:center;padding:48px 16px">
    <div data-role="card" style="width:400px;max-width:100%;border:1px solid rgba(32,27,22,.14);background:#fff;padding:30px 32px 32px;display:flex;flex-direction:column;box-sizing:border-box">
      ${step === 'password' ? blockPassword() : blockSignin(query)}
    </div>
  </div>
  <div class="mx-gutter" style="max-width:1180px;margin:0 auto;padding:0 28px 28px;width:100%;box-sizing:border-box;display:flex;gap:20px;align-items:center;flex-wrap:wrap">
    <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.15em;color:#6d6459">MED&amp;X · ZAGREB</span>
    <a href="${esc(cfg.memberPortalUrl || '/')}" target="_blank" rel="noopener" style="font:600 10px Inter,sans-serif;letter-spacing:.13em;color:#6d6459" data-hover="color:#201b16">${COPY.footer.members}</a>
  </div>
</div>`;
}

const q = sel => rootEl && rootEl.querySelector(sel);
const val = name => { const el = q(`[name="${name}"]`); return el ? el.value.trim() : ''; };
function showError(msg) { const el = q('[data-role="error"]'); if (!el) return; el.textContent = msg || ''; el.style.display = msg ? 'block' : 'none'; }
function busy(el, label) { const prev = el.textContent; el.textContent = label; el.setAttribute('aria-disabled', 'true'); return () => { el.textContent = prev; el.removeAttribute('aria-disabled'); }; }
function nextTarget(query) { return query.next && query.next.startsWith('/') && !query.next.startsWith('//') && query.next !== '/signin' ? query.next : '/today'; }

function makeHandlers(query) {
  return {
    signin: async (el) => {
      const email = val('email'), password = q('[name="password"]') ? q('[name="password"]').value : '';
      showError('');
      if (!email || !password) return showError(COPY.signin.errors.empty);
      const done = busy(el, COPY.signin.busy);
      try {
        const r = await api.post('/api/auth/login', { email, password }, { noAuth: true });
        session.set(r.token, r.user);
        if (r.mustChangePassword) { session.update({ must_change_password: 1 }); step = 'password'; rootEl.innerHTML = template(query); const f = q('[name="newPassword"]'); if (f) f.focus(); return; }
        ui.toast(COPY.signin.welcome(session.firstName()));
        chrome.refresh(); health.refresh({ force: true });
        router.replace(nextTarget(query));
      } catch (e) {
        done();
        if (e.status === 401) showError(COPY.signin.errors.bad);
        else if (e.status === 403) showError(e.message || COPY.signin.errors.notAdmin);
        else if (e.status === 429) showError(COPY.signin.errors.limited);
        else showError(e.message);
      }
    },
    setPassword: async (el) => {
      const a = q('[name="newPassword"]') ? q('[name="newPassword"]').value : '', b = q('[name="again"]') ? q('[name="again"]').value : '';
      showError('');
      if (a.length < 8) return showError(COPY.password.errors.short);
      if (a !== b) return showError(COPY.password.errors.mismatch);
      const done = busy(el, COPY.password.busy);
      try {
        await api.post('/api/auth/change-password', { newPassword: a });
        session.update({ must_change_password: 0 });
        ui.toast(COPY.password.done);
        chrome.refresh(); health.refresh({ force: true });
        router.replace(nextTarget(query));
      } catch (e) { done(); showError(e.message); }
    }
  };
}

export default {
  title: 'Sign in',
  render(root, ctx) {
    rootEl = root;
    step = ctx.query.step === 'password' && session.isAuthed ? 'password' : 'signin';
    root.innerHTML = template(ctx.query);
    const handlers = makeHandlers(ctx.query);
    unbind = ui.bind(root, handlers);
    root.querySelectorAll('form').forEach(f => f.addEventListener('submit', e => { e.preventDefault(); const btn = f.querySelector('[data-act]'); if (btn) handlers[btn.dataset.act](btn); }));
    const first = root.querySelector('input'); if (first) first.focus();
  },
  destroy() { if (unbind) unbind(); unbind = null; rootEl = null; }
};
