// Source: Auth.dc.html
// States (artboard `view` prop → route): Welcome → /app/auth/welcome · Sign in → /signin ·
// Create account → /signup (step 01 DETAILS) · Verify email → /verify (step 02 CONFIRM EMAIL) ·
// Reset password → /reset (request + "LINK SENT ✓" state) · Invitation code → /forum-code.
// Step 03 "YOU'RE IN" = the portal itself (CONTINUE TO MED&X → /app/home).
// Blocks: "Welcome" › "Panel" (photo column + cream form column) › inside the panel one of
// "01 · DETAILS" · "02 · CONFIRM EMAIL" · "Sign in" · "Reset password" · "Invitation code" › "Footer".
// Endpoints: POST /api/auth/login · POST /api/auth/register · POST /api/auth/request-verification ·
// POST /api/auth/forgot-password · POST /api/forum/invitations/redeem (gap — see ARCHITECTURE.md).
import { api } from '../api.js';
import { session } from '../state.js';
import { ui, esc, fmt } from '../ui.js';
import { FACTS } from '../facts.js';
import router from '../router.js';

export const SOURCE = 'Auth.dc.html';
export const COPY = {
  lang: { en: 'EN', hr: 'HR', hrSoon: 'Croatian (HR) arrives with the translations — English for now.' },
  welcome: {
    kicker: 'MEMBER PORTAL',
    headline: 'Where Croatian medicine and science <i style="color:#c9a962">meet the world</i>.',
    blurb: 'The Med&amp;X network — Croatian scientists, physicians, and biomedical leaders from around the world, and everything they build together, in one place.',
    create: 'CREATE ACCOUNT →', signin: 'SIGN IN',
    projects: ['PLEXUS CONFERENCE', 'GALA EVENING', 'THE ACCELERATOR', 'BIOMEDICAL FORUM', 'BUILDING BRIDGES']
  },
  panel: { quote: '"The room where Croatian medicine meets the world."', tagline: 'ONE ACCOUNT · FIVE PROJECTS · ONE WORLDWIDE NETWORK' },
  steps: { details: 'DETAILS', confirm: 'CONFIRM EMAIL', done: "YOU'RE IN" },
  create: {
    headline: 'Join the Med&amp;X <i>community</i>.',
    blurb: 'One account for the Plexus Conference, the Gala, the Accelerator, the Forum, and Building Bridges.',
    fields: { first: 'FIRST NAME *', last: 'LAST NAME *', email: 'EMAIL *', password: 'PASSWORD *', institution: 'INSTITUTION', country: 'COUNTRY *' },
    placeholders: { first: 'Alen', last: 'Juginović', email: 'you@institution.edu', password: 'Min 8 characters', institution: 'University / company', country: 'Croatia' },
    terms: 'I agree to the <a href="/terms" target="_blank" rel="noopener" style="color:#9b1b22;text-decoration:underline">Terms and Privacy Policy</a>. We never share your data.',
    submit: 'CREATE ACCOUNT →', busy: 'CREATING…', already: 'Already a member? ', signin: 'Sign in', back: '← Back',
    errors: { first: 'Add your first name.', last: 'Add your last name.', email: 'Enter a valid email address.', password: 'Use at least 8 characters.', country: 'Add your country.', terms: 'Please accept the Terms and Privacy Policy.', exists: 'That email already has an account — sign in instead.' }
  },
  verify: {
    headline: 'Check your <i>email</i>.',
    sent: email => `We sent a confirmation link to <strong style="color:#191512">${email}</strong>. Open it to confirm your account.`,
    continue: 'CONTINUE TO MED&amp;X →', resend: 'RESEND LINK', resent: 'Link sent — check your inbox (and spam).',
    note: "Can't find it? Check spam or promotions — it can take a minute. You can start exploring right away; a gentle reminder stays at the top until your email is confirmed.",
    devLink: 'Email delivery is off in this environment — open your confirmation link here:'
  },
  signin: {
    headline: 'Welcome <i>back</i>.', blurb: 'Your projects, tickets, and people are where you left them.',
    email: 'EMAIL', password: 'PASSWORD', forgot: 'FORGOT?', submit: 'SIGN IN →', busy: 'SIGNING IN…',
    placeholders: { email: 'you@institution.edu', password: '••••••••' },
    newHere: 'New to Med&amp;X? ', create: 'Create an account', invited: 'Invited to the Biomedical Forum? ', code: 'Enter your code',
    verified: 'Email confirmed — sign in to continue.', welcome: name => `Welcome back, ${name}.`,
    errors: { empty: 'Enter your email and password.', bad: "That email and password don't match.", unverified: 'Confirm your email first — we can resend the link.', resend: 'RESEND LINK' }
  },
  reset: {
    headline: 'Reset your <i>password</i>.', blurb: "Enter the email on your account and we'll send a reset link.", email: 'EMAIL',
    submit: 'SEND RESET LINK →', busy: 'SENDING…', sentTag: 'LINK SENT ✓',
    sentText: "If that address has an account, a reset link is on its way. It can take a minute — check spam too.", resend: 'RESEND', back: '← Back to sign in',
    errors: { email: 'Enter a valid email address.' }
  },
  code: {
    tag: 'BIOMEDICAL FORUM · BY INVITATION', headline: 'Enter your <i>invitation code</i>.',
    blurb: 'Your code arrived by email with your invitation. It joins you to the Forum network and unlocks registration for the annual gathering.',
    label: 'INVITATION CODE', placeholder: 'FRM-XXXX-XXXX', submit: 'VERIFY CODE →', busy: 'CHECKING…',
    note: "No account yet? The code works either way — we'll create your account in the next step.", back: '← Back to sign in',
    errors: { empty: 'Enter the code from your invitation email.', invalid: "That code isn't valid — check the invitation email or write to the Forum team.", offline: 'Code validation is not connected yet — the Forum team confirms invitations by email for now.' },
    ok: 'Code accepted — welcome to the Forum network.'
  },
  footer: { copyright: '© Med&X ' + FACTS.year + ' · Mosećka 128, 21000 Split', privacy: 'Privacy', terms: 'Terms' }
};

const st = { terms: false, sent: false, pendingEmail: null, devVerifyUrl: null };
let rootEl = null, unbind = null, currentView = 'welcome';
const INPUT = 'border:1px solid rgba(25,21,18,.25);background:#fdfaf3;padding:11px 12px;font-size:13px;color:#191512;width:100%;box-sizing:border-box';
const INPUT12 = 'border:1px solid rgba(25,21,18,.25);background:#fdfaf3;padding:12px;font-size:13px;color:#191512;width:100%;box-sizing:border-box';
const PRIMARY = 'margin-top:20px;padding:14px 0;background:#9b1b22;color:#f7f1e6;font:600 11px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;text-align:center;display:block;white-space:nowrap';
const GHOST = 'margin-top:10px;padding:13px 0;border:1px solid rgba(25,21,18,.3);font:600 11px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;text-align:center;color:#191512;display:block;white-space:nowrap';
// v2 addition: inline error/notice line (the artboard has no error element); crimson = error, gold-dark = notice
const errorLine = (id) => `<div data-role="${id}" style="display:none;font-size:12.5px;line-height:1.5;margin-top:12px;color:#9b1b22"></div>`;

// ---------------------------------------------------------------- blocks
function blockWelcome() {
  return `
  <!-- dc: Auth.dc.html › "Welcome" -->
  <div style="position:relative;min-height:100vh;overflow:hidden;display:flex;flex-direction:column">
    <img src="/assets/photo-ballroom.jpg" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">
    <div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(25,21,18,.72) 0%,rgba(25,21,18,.86) 100%)"></div>
    <div style="position:relative;display:flex;align-items:center;padding:22px 36px">
      <div style="flex:1"></div>
      <span style="display:flex;gap:2px;font:600 10px Inter,sans-serif;letter-spacing:.14em"><span style="padding:5px 9px;background:#c9a962;color:#191512;cursor:pointer">${COPY.lang.en}</span><span data-act="hr" style="padding:5px 9px;color:rgba(247,241,230,.6);border:1px solid rgba(247,241,230,.25);cursor:pointer" data-hover="color:#f7f1e6">${COPY.lang.hr}</span></span>
    </div>
    <div style="position:relative;flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:40px 36px 70px;color:#f7f1e6">
      <img src="/assets/logo-white.png" alt="med&amp;X" style="height:34px;display:block">
      <span style="font:600 10.5px Inter,sans-serif;letter-spacing:.28em;color:#c9a962;margin-top:18px">${COPY.welcome.kicker}</span>
      <div style="font-family:Fraunces,serif;font-size:clamp(30px,6vw,46px);line-height:1.12;max-width:680px;margin-top:18px">${COPY.welcome.headline}</div>
      <span style="width:34px;height:1px;background:#9b1b22;margin-top:20px"></span>
      <div style="font-size:14.5px;line-height:1.6;color:rgba(247,241,230,.8);max-width:500px;margin-top:18px">${COPY.welcome.blurb}</div>
      <div style="display:flex;gap:13px;margin-top:30px;flex-wrap:wrap;justify-content:center">
        <a href="/app/auth/signup" style="padding:15px 30px;background:#9b1b22;color:#f7f1e6;font:600 11px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;white-space:nowrap" data-hover="background:#7e151b">${COPY.welcome.create}</a>
        <a href="/app/auth/signin" style="padding:15px 30px;border:1px solid rgba(247,241,230,.45);color:#f7f1e6;font:600 11px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;white-space:nowrap" data-hover="border-color:#f7f1e6">${COPY.welcome.signin}</a>
      </div>
      <div style="display:flex;gap:10px 22px;margin-top:44px;flex-wrap:wrap;justify-content:center;font:600 9px Inter,sans-serif;letter-spacing:.16em;color:rgba(247,241,230,.55)">
        ${COPY.welcome.projects.map((p, i) => `<span style="white-space:nowrap">${p}</span>` + (i < COPY.welcome.projects.length - 1 ? '<span style="color:#c9a962">·</span>' : '')).join('')}
      </div>
    </div>
  </div>
  <!-- /dc -->`;
}

function stepper(stage) { // stage 1 = DETAILS, 2 = CONFIRM EMAIL
  if (stage === 1) return `
            <div style="display:flex;align-items:center;gap:10px">
              <span style="font-family:Fraunces,serif;font-weight:600;font-size:13px;color:#9b1b22">01</span><span style="font:600 9px Inter,sans-serif;letter-spacing:.15em;color:#191512">${COPY.steps.details}</span>
              <span style="flex:1;height:1px;background:rgba(25,21,18,.16)"></span>
              <span style="font-family:Fraunces,serif;font-weight:600;font-size:13px;color:rgba(25,21,18,.35)">02</span><span style="font:600 9px Inter,sans-serif;letter-spacing:.15em;color:rgba(25,21,18,.4)">${COPY.steps.confirm}</span>
              <span style="flex:1;height:1px;background:rgba(25,21,18,.16)"></span>
              <span style="font-family:Fraunces,serif;font-weight:600;font-size:13px;color:rgba(25,21,18,.35)">03</span><span style="font:600 9px Inter,sans-serif;letter-spacing:.15em;color:rgba(25,21,18,.4)">${COPY.steps.done}</span>
            </div>`;
  return `
            <div style="display:flex;align-items:center;gap:10px">
              <span style="font-family:Fraunces,serif;font-weight:600;font-size:13px;color:#6e5626">01</span><span style="font:600 9px Inter,sans-serif;letter-spacing:.15em;color:#6e5626">${COPY.steps.details} ✓</span>
              <span style="flex:1;height:1px;background:#c9a962"></span>
              <span style="font-family:Fraunces,serif;font-weight:600;font-size:13px;color:#9b1b22">02</span><span style="font:600 9px Inter,sans-serif;letter-spacing:.15em;color:#191512">${COPY.steps.confirm}</span>
              <span style="flex:1;height:1px;background:rgba(25,21,18,.16)"></span>
              <span style="font-family:Fraunces,serif;font-weight:600;font-size:13px;color:rgba(25,21,18,.35)">03</span><span style="font:600 9px Inter,sans-serif;letter-spacing:.15em;color:rgba(25,21,18,.4)">${COPY.steps.done}</span>
            </div>`;
}
const field = (label, name, type, placeholder, extra = '', style = INPUT) => `<span style="display:flex;flex-direction:column;gap:6px${extra}"><span style="font:600 10px Inter,sans-serif;letter-spacing:.14em;color:#4a4239">${label}</span><input name="${name}" type="${type}" placeholder="${esc(placeholder)}" aria-label="${esc(label)}" autocomplete="${name === 'password' ? (currentView === 'signup' ? 'new-password' : 'current-password') : name === 'email' ? 'email' : name === 'first_name' ? 'given-name' : name === 'last_name' ? 'family-name' : name === 'institution' ? 'organization' : name === 'country' ? 'country-name' : 'off'}" style="${style}"></span>`;

function blockCreate() {
  const c = COPY.create;
  return `
          <!-- dc: Auth.dc.html › "01 · DETAILS" -->
          <form data-form="signup" novalidate style="display:contents">
            ${stepper(1)}
            <div style="font-family:Fraunces,serif;font-size:clamp(26px,7vw,33px);line-height:1.12;margin-top:22px">${c.headline}</div>
            <div style="font-size:13px;color:#4a4239;line-height:1.55;margin-top:10px">${c.blurb}</div>
            <div class="mx-grid-2" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:22px">
              ${field(c.fields.first, 'first_name', 'text', c.placeholders.first)}
              ${field(c.fields.last, 'last_name', 'text', c.placeholders.last)}
            </div>
            ${field(c.fields.email, 'email', 'email', c.placeholders.email, ';margin-top:12px')}
            ${field(c.fields.password, 'password', 'password', c.placeholders.password, ';margin-top:12px')}
            <div class="mx-grid-2" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
              ${field(c.fields.institution, 'institution', 'text', c.placeholders.institution)}
              ${field(c.fields.country, 'country', 'text', c.placeholders.country)}
            </div>
            <div data-act="tgTerms" role="checkbox" aria-checked="${st.terms}" style="display:flex;gap:10px;align-items:flex-start;margin-top:16px;cursor:pointer">
              <span data-role="termsBox" style="width:15px;height:15px;border:1px solid ${st.terms ? '#9b1b22' : 'rgba(25,21,18,.35)'};background:${st.terms ? '#9b1b22' : 'transparent'};flex:none;display:inline-flex;align-items:center;justify-content:center;color:#f7f1e6;font-size:10px;margin-top:1px">${st.terms ? '✓' : ''}</span>
              <span style="font-size:12px;color:#4a4239;line-height:1.5">${c.terms}</span>
            </div>
            ${errorLine('error')}
            <button type="submit" data-act="signup" style="${PRIMARY};width:100%;border:0" data-hover="background:#7e151b">${c.submit}</button>
            <div style="display:flex;gap:16px;margin-top:16px;font-size:12px;color:#4a4239">
              <span>${c.already}<a href="/app/auth/signin" style="color:#9b1b22;font-weight:600;cursor:pointer">${c.signin}</a></span>
              <div style="flex:1"></div>
              <a href="/app/auth/welcome" style="cursor:pointer;color:#4a4239" data-hover="color:#191512">${c.back}</a>
            </div>
          </form>
          <!-- /dc -->`;
}
function blockVerify() {
  const v = COPY.verify; const email = st.pendingEmail || (session.user || {}).email || '';
  return `
          <!-- dc: Auth.dc.html › "02 · CONFIRM EMAIL" -->
            ${stepper(2)}
            <span style="width:28px;height:1px;background:#c9a962;margin-top:30px"></span>
            <div style="font-family:Fraunces,serif;font-size:clamp(26px,7vw,33px);line-height:1.12;margin-top:14px">${v.headline}</div>
            <div style="font-size:13.5px;color:#4a4239;line-height:1.6;margin-top:12px">${v.sent(esc(email))}</div>
            ${st.devVerifyUrl ? `<div style="font-size:12px;color:#6e5626;line-height:1.6;margin-top:12px;border:1px solid rgba(201,169,98,.65);background:#fdfaf3;padding:12px">${v.devLink} <a href="${esc(st.devVerifyUrl)}" style="color:#9b1b22;text-decoration:underline;word-break:break-all">confirm now →</a></div>` : ''}
            <a href="/app/home" style="margin-top:24px;padding:14px 0;background:#9b1b22;color:#f7f1e6;font:600 11px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;text-align:center;display:block" data-hover="background:#7e151b">${v.continue}</a>
            <span data-act="resend" style="${GHOST}" data-hover="border-color:#191512">${v.resend}</span>
            ${errorLine('error')}
            <div style="font-size:11.5px;color:#4a4239;line-height:1.6;margin-top:16px">${v.note}</div>
          <!-- /dc -->`;
}
function blockSignin(query) {
  const s = COPY.signin;
  return `
          <!-- dc: Auth.dc.html › "Sign in" -->
          <form data-form="signin" novalidate style="display:contents">
            <span style="width:28px;height:1px;background:#c9a962"></span>
            <div style="font-family:Fraunces,serif;font-size:clamp(26px,7vw,33px);line-height:1.12;margin-top:14px">${s.headline}</div>
            <div style="font-size:13px;color:#4a4239;margin-top:8px">${s.blurb}</div>
            ${query.notice === 'verified' ? `<div style="font-size:12.5px;color:#6e5626;line-height:1.5;margin-top:14px;border:1px solid rgba(201,169,98,.65);background:#fdfaf3;padding:10px 12px">${s.verified}</div>` : ''}
            ${field(s.email, 'email', 'email', s.placeholders.email, ';margin-top:24px', INPUT12)}
            <span style="display:flex;flex-direction:column;gap:6px;margin-top:12px"><span style="display:flex"><span style="font:600 10px Inter,sans-serif;letter-spacing:.14em;color:#4a4239">${s.password}</span><span style="flex:1"></span><a href="/app/auth/reset" style="font:600 9.5px Inter,sans-serif;letter-spacing:.12em;color:#9b1b22;cursor:pointer">${s.forgot}</a></span><input name="password" type="password" placeholder="${s.placeholders.password}" aria-label="Password" autocomplete="current-password" style="${INPUT12}"></span>
            ${errorLine('error')}
            <div data-role="resendRow" style="display:none;margin-top:10px"><span data-act="resendLogin" style="font:600 9.5px Inter,sans-serif;letter-spacing:.14em;color:#9b1b22;cursor:pointer;white-space:nowrap">${s.errors.resend}</span></div>
            <button type="submit" data-act="signin" style="${PRIMARY};width:100%;border:0" data-hover="background:#7e151b">${s.submit}</button>
            <div style="margin-top:18px;text-align:center;font-size:12.5px;color:#4a4239">${s.newHere}<a href="/app/auth/signup" style="color:#9b1b22;font-weight:600;cursor:pointer;white-space:nowrap">${s.create}</a></div>
            <div style="margin-top:8px;text-align:center;font-size:12.5px;color:#4a4239">${s.invited}<a href="/app/auth/forum-code" style="color:#9b1b22;font-weight:600;cursor:pointer;white-space:nowrap">${s.code}</a></div>
          </form>
          <!-- /dc -->`;
}
function blockReset() {
  const r = COPY.reset;
  return `
          <!-- dc: Auth.dc.html › "Reset password" -->
          <form data-form="reset" novalidate style="display:contents">
            <span style="width:28px;height:1px;background:#c9a962"></span>
            <div style="font-family:Fraunces,serif;font-size:clamp(26px,7vw,33px);line-height:1.12;margin-top:14px">${r.headline}</div>
            ${!st.sent ? `
              <div style="font-size:13px;color:#4a4239;line-height:1.55;margin-top:10px">${r.blurb}</div>
              ${field(r.email, 'email', 'email', COPY.signin.placeholders.email, ';margin-top:22px', INPUT12)}
              ${errorLine('error')}
              <button type="submit" data-act="sendReset" style="${PRIMARY};width:100%;border:0" data-hover="background:#7e151b">${r.submit}</button>` : `
              <div style="border:1px solid rgba(201,169,98,.65);background:#fdfaf3;padding:18px;margin-top:18px;display:flex;flex-direction:column;gap:6px">
                <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#6e5626">${r.sentTag}</span>
                <span style="font-size:13px;color:#4a4239;line-height:1.55">${r.sentText}</span>
              </div>
              <span data-act="sendReset" style="margin-top:14px;padding:13px 0;border:1px solid rgba(25,21,18,.3);font:600 11px Inter,sans-serif;letter-spacing:.16em;cursor:pointer;text-align:center;color:#191512;display:block" data-hover="border-color:#191512">${r.resend}</span>
              ${errorLine('error')}`}
            <div style="display:flex;margin-top:16px;font-size:12px;color:#4a4239">
              <a href="/app/auth/signin" style="cursor:pointer;color:#4a4239" data-hover="color:#191512"><span style="white-space:nowrap">${r.back}</span></a>
            </div>
          </form>
          <!-- /dc -->`;
}
function blockCode() {
  const c = COPY.code;
  return `
          <!-- dc: Auth.dc.html › "Invitation code" -->
          <form data-form="code" novalidate style="display:contents">
            <span style="padding:4px 10px;border:1px solid rgba(201,169,98,.65);color:#6e5626;font:600 9px Inter,sans-serif;letter-spacing:.16em;align-self:flex-start;white-space:nowrap">${c.tag}</span>
            <div style="font-family:Fraunces,serif;font-size:clamp(26px,7vw,33px);line-height:1.12;margin-top:18px">${c.headline}</div>
            <div style="font-size:13px;color:#4a4239;line-height:1.55;margin-top:10px">${c.blurb}</div>
            <span style="display:flex;flex-direction:column;gap:6px;margin-top:22px"><span style="font:600 10px Inter,sans-serif;letter-spacing:.14em;color:#4a4239">${c.label}</span><input name="code" type="text" placeholder="${c.placeholder}" aria-label="${c.label}" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" style="border:1px solid rgba(25,21,18,.25);background:#fdfaf3;padding:13px;font:600 15px ui-monospace,Menlo,monospace;letter-spacing:.14em;color:#191512;width:100%;box-sizing:border-box;text-align:center"></span>
            ${errorLine('error')}
            <button type="submit" data-act="verifyCode" style="${PRIMARY};width:100%;border:0" data-hover="background:#7e151b">${c.submit}</button>
            <div style="font-size:11.5px;color:#4a4239;margin-top:14px;line-height:1.55">${c.note}</div>
            <div style="display:flex;margin-top:14px;font-size:12px;color:#4a4239">
              <a href="/app/auth/signin" style="cursor:pointer;color:#4a4239" data-hover="color:#191512"><span style="white-space:nowrap">${c.back}</span></a>
            </div>
          </form>
          <!-- /dc -->`;
}
function blockPanel(inner) {
  return `
  <!-- dc: Auth.dc.html › "Panel" -->
  <div class="mx-auth-panel" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,360px),1fr));min-height:100vh">
    <div style="position:relative;overflow:hidden;display:flex;flex-direction:column;min-height:240px">
      <img src="/assets/photo-gala.jpg" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">
      <div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(25,21,18,.66) 0%,rgba(25,21,18,.88) 100%)"></div>
      <div style="position:relative;flex:1;display:flex;flex-direction:column;padding:clamp(20px,4vw,38px);color:#f7f1e6">
        <a href="/app/auth/welcome" style="cursor:pointer;align-self:flex-start"><img src="/assets/logo-white.png" alt="med&amp;X" style="height:24px;display:block"></a>
        <div style="flex:1;min-height:24px"></div>
        <div style="font-family:Fraunces,serif;font-style:italic;font-size:27px;line-height:1.35;max-width:360px">${COPY.panel.quote}</div>
        <span style="width:28px;height:1px;background:#c9a962;margin:18px 0 12px"></span>
        <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.18em;color:rgba(247,241,230,.65)">${COPY.panel.tagline}</span>
      </div>
    </div>
    <div style="background:#f7f1e6;display:flex;flex-direction:column;padding:30px 0">
      <div style="display:flex;align-items:center;padding:0 clamp(20px,5vw,44px)">
        <div style="flex:1"></div>
        <span style="display:flex;gap:2px;font:600 9.5px Inter,sans-serif;letter-spacing:.14em"><span style="padding:4px 8px;background:#191512;color:#f7f1e6;cursor:pointer">${COPY.lang.en}</span><span data-act="hr" style="padding:4px 8px;color:#4a4239;border:1px solid rgba(25,21,18,.25);cursor:pointer" data-hover="border-color:#191512">${COPY.lang.hr}</span></span>
      </div>
      <div style="flex:1;display:flex;flex-direction:column;justify-content:center;padding:30px clamp(20px,5vw,44px);max-width:430px;width:100%;margin:0 auto;box-sizing:border-box">
${inner}
      </div>
      <!-- dc: Auth.dc.html › "Footer" -->
      <div style="padding:0 24px;font-size:10.5px;color:rgba(74,66,57,.7);display:flex;gap:16px;justify-content:center;flex-wrap:wrap">
        <span style="white-space:nowrap">${COPY.footer.copyright}</span><a href="/privacy" style="color:rgba(74,66,57,.7)">${COPY.footer.privacy}</a><a href="/terms" style="color:rgba(74,66,57,.7)">${COPY.footer.terms}</a>
      </div>
      <!-- /dc -->
    </div>
  </div>
  <!-- /dc -->`;
}

// ---------------------------------------------------------------- behaviour
const q = (name) => rootEl.querySelector(`[name="${name}"]`);
const val = (name) => (q(name) ? q(name).value.trim() : '');
function showError(msg, { role = 'error', tone = 'error' } = {}) {
  const el = rootEl.querySelector(`[data-role="${role}"]`); if (!el) return;
  el.style.display = msg ? 'block' : 'none'; el.textContent = msg || ''; el.style.color = tone === 'notice' ? '#6e5626' : '#9b1b22';
}
function busy(el, label) {
  if (!el) return () => {};
  const prev = el.textContent; el.textContent = label; el.setAttribute('aria-disabled', 'true'); if (el.tagName === 'BUTTON') el.disabled = true;
  return () => { el.textContent = prev; el.removeAttribute('aria-disabled'); if (el.tagName === 'BUTTON') el.disabled = false; };
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function nextTarget(query) { return query.next && query.next.startsWith('/app') && !query.next.startsWith('/app/auth') ? query.next : '/app/home'; }

const handlers = {
  hr: () => ui.toast(COPY.lang.hrSoon),
  tgTerms: (el) => { st.terms = !st.terms; el.setAttribute('aria-checked', String(st.terms)); const box = el.querySelector('[data-role="termsBox"]'); if (box) { box.style.borderColor = st.terms ? '#9b1b22' : 'rgba(25,21,18,.35)'; box.style.background = st.terms ? '#9b1b22' : 'transparent'; box.textContent = st.terms ? '✓' : ''; } },
  signin: async (el, ev, query) => {
    const email = val('email'), password = q('password') ? q('password').value : '';
    showError('');
    const resendRow = rootEl.querySelector('[data-role="resendRow"]'); if (resendRow) resendRow.style.display = 'none';
    if (!email || !password) return showError(COPY.signin.errors.empty);
    const done = busy(el, COPY.signin.busy);
    try {
      const r = await api.post('/api/auth/login', { email, password }, { noAuth: true });
      // a successful login implies a confirmed mailbox (server gates on email_verified when a mail provider exists, self-heals otherwise)
      session.set(r.token, Object.assign({}, r.user, { email_verified: 1 }));
      ui.toast(COPY.signin.welcome((r.user && r.user.first_name) || session.displayName()));
      router.replace(nextTarget(query));
    } catch (e) {
      done();
      if (e.status === 403 && e.data && e.data.needsVerification) { st.pendingEmail = e.data.email || email; showError(COPY.signin.errors.unverified); if (resendRow) resendRow.style.display = 'block'; }
      else if (e.status === 401) showError(COPY.signin.errors.bad);
      else showError(e.message);
    }
  },
  resendLogin: async (el) => {
    const email = st.pendingEmail || val('email'); if (!email) return;
    const done = busy(el, 'SENDING…');
    try { const r = await api.post('/api/auth/request-verification', { email }, { noAuth: true }); ui.toast(r.message || COPY.verify.resent); if (r.devVerifyUrl) { st.devVerifyUrl = r.devVerifyUrl; showError(COPY.verify.devLink + ' ' + r.devVerifyUrl, { tone: 'notice' }); } }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
    done();
  },
  signup: async (el) => {
    const c = COPY.create;
    const f = { first_name: val('first_name'), last_name: val('last_name'), email: val('email'), password: q('password') ? q('password').value : '', institution: val('institution'), country: val('country') };
    showError('');
    if (!f.first_name) return showError(c.errors.first);
    if (!f.last_name) return showError(c.errors.last);
    if (!EMAIL_RE.test(f.email)) return showError(c.errors.email);
    if (f.password.length < 8) return showError(c.errors.password);
    if (!f.country) return showError(c.errors.country);
    if (!st.terms) return showError(c.errors.terms);
    const done = busy(el, c.busy);
    try {
      const r = await api.post('/api/auth/register', Object.assign({ locale: 'en' }, f), { noAuth: true });
      // signed in but UNVERIFIED (soft gate): keep the session, carry the fresh signup values the server omits
      session.set(r.token, Object.assign({}, r.user, { institution: f.institution, country: f.country, email_verified: 0 }));
      st.pendingEmail = f.email; st.devVerifyUrl = r.devVerifyUrl || null;
      try { sessionStorage.removeItem('medx_verify_dismissed'); } catch (e) {}
      router.replace('/app/auth/verify');
    } catch (e) {
      done();
      showError(e.status === 400 && /exists/i.test(e.message) ? c.errors.exists : e.message);
    }
  },
  resend: async (el) => {
    const email = st.pendingEmail || (session.user || {}).email; if (!email) return showError('No email on this session — sign in again.');
    const done = busy(el, 'SENDING…');
    try { const r = await api.post('/api/auth/request-verification', { email }, { noAuth: true }); ui.toast(r.message || COPY.verify.resent); if (r.devVerifyUrl) { st.devVerifyUrl = r.devVerifyUrl; render(rootEl, { params: { view: 'verify' }, query: {} }); } }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
    done();
  },
  sendReset: async (el) => {
    const email = st.sent ? st.pendingEmail : val('email');
    showError('');
    if (!EMAIL_RE.test(email || '')) return showError(COPY.reset.errors.email);
    const done = busy(el, COPY.reset.busy);
    try {
      const r = await api.post('/api/auth/forgot-password', { email }, { noAuth: true });
      st.pendingEmail = email;
      if (st.sent) ui.toast(r.message || COPY.reset.sentText); else { st.sent = true; render(rootEl, { params: { view: 'reset' }, query: {} }); }
    } catch (e) { done(); showError(e.message); }
  },
  verifyCode: async (el) => {
    const code = val('code').toUpperCase().replace(/\s+/g, '');
    showError('');
    if (!code) return showError(COPY.code.errors.empty);
    const done = busy(el, COPY.code.busy);
    try {
      if (session.isAuthed) {
        const r = await api.post('/api/v2/forum/redeem-code', { code });
        ui.toast((r && r.message) || COPY.code.ok);
        router.replace('/app/forum');
      } else {
        await api.post('/api/v2/forum/check-code', { code }, { noAuth: true });
        try { sessionStorage.setItem('medx_forum_code', code); } catch (e) {}
        ui.toast(COPY.code.ok);
        router.replace('/app/auth/signup?next=%2Fapp%2Fforum'); // the forum view auto-redeems the stored code
      }
    } catch (e) {
      done();
      const kind = e.data && e.data.code;
      if (kind === 'unknown' || e.status === 400 || e.status === 403 || e.status === 409 || e.status === 410) showError(COPY.code.errors.invalid);
      else if (e.status === 404) { showError(COPY.code.errors.offline); ui.toast(COPY.code.errors.offline, { kind: 'error', ms: 5000 }); }
      else showError(e.message);
    }
  }
};

function render(root, ctx) {
  const view = (ctx.params && ctx.params.view) || 'welcome';
  currentView = view;
  const inner = view === 'signup' ? blockCreate() : view === 'verify' ? blockVerify() : view === 'reset' ? blockReset() : view === 'forum-code' ? blockCode() : blockSignin(ctx.query || {});
  root.innerHTML = `<div data-screen-label="Auth" style="font-family:Inter,sans-serif;color:#191512;min-height:100vh">${view === 'welcome' ? blockWelcome() : blockPanel(inner)}</div>`;
  const first = root.querySelector('input'); if (first && view !== 'welcome') first.focus({ preventScroll: true });
}

const TITLES = { welcome: 'Member Portal', signin: 'Sign in', signup: 'Create account', verify: 'Confirm your email', reset: 'Reset password', 'forum-code': 'Forum invitation' };
const VIEWS = Object.keys(TITLES);

export default {
  title: (ctx) => TITLES[(ctx.params && ctx.params.view) || 'welcome'] || 'Member Portal',
  async render(root, ctx) {
    rootEl = root;
    const view = (ctx.params && ctx.params.view) || 'welcome';
    if (!VIEWS.includes(view)) return router.replace('/app/auth/welcome');
    // a signed-in member has no business on welcome / sign in / sign up (verify, reset, code stay reachable)
    if (session.isAuthed && ['welcome', 'signin', 'signup'].includes(view)) return router.replace(nextTarget(ctx.query || {}));
    if (view !== 'reset') st.sent = false;
    render(root, ctx);
    unbind = ui.bind(root, Object.fromEntries(Object.entries(handlers).map(([k, fn]) => [k, (el, ev) => fn(el, ev, ctx.query || {})])));
    root.addEventListener('submit', (e) => {
      e.preventDefault();
      const kind = e.target.getAttribute('data-form');
      const act = { signin: 'signin', signup: 'signup', reset: 'sendReset', code: 'verifyCode' }[kind];
      const btn = root.querySelector(`[data-act="${act}"]`);
      if (act && btn && btn.getAttribute('aria-disabled') !== 'true') handlers[act](btn, e, ctx.query || {});
    });
  },
  destroy() { if (unbind) unbind(); unbind = null; rootEl = null; }
};
