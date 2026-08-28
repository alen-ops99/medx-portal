#!/usr/bin/env python3
"""scripts/qa-shots.py — side-by-side QA: screenshot the design artboards (file://…/*.dc.html with
support.js) and the v2 pages (dev server) at 1280px (and 430px for the mobile pattern).
   python3 scripts/qa-shots.py [--base http://localhost:8890] [--design /path/to/export] [--token <jwt>]
Outputs to _qa/. Console errors from the v2 pages are printed and saved to _qa/console.txt.
"""
import os, sys, json, argparse
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
QA = os.path.join(HERE, '..', '_qa'); os.makedirs(QA, exist_ok=True)
ap = argparse.ArgumentParser()
ap.add_argument('--base', default='http://localhost:8890')
ap.add_argument('--design', default=os.path.expanduser('~/Downloads/uploads/export/medx-member-portal-final'))
ap.add_argument('--token', default=os.environ.get('MEDX_QA_TOKEN', ''))
ap.add_argument('--user', default=os.environ.get('MEDX_QA_USER', ''))
ap.add_argument('--only', default='')
a = ap.parse_args()

ARTBOARDS = [('home', 'Med&X Home.dc.html', {}), ('auth-welcome', 'Auth.dc.html', {}), ('auth-signin', 'Auth.dc.html', {'view': 'Sign in'}),
             ('auth-signup', 'Auth.dc.html', {'view': 'Create account'}), ('auth-verify', 'Auth.dc.html', {'view': 'Verify email'}),
             ('auth-reset', 'Auth.dc.html', {'view': 'Reset password'}), ('auth-code', 'Auth.dc.html', {'view': 'Invitation code'}),
             ('chrome', 'Portal Chrome.dc.html', {}), ('mobile', 'Mobile Portal.dc.html', {}), ('system', 'System Pages.dc.html', {})]
PAGES = [('home', '/app/home', True), ('home-drawer', '/app/home?qa=drawer', True), ('auth-welcome', '/app/auth/welcome', False), ('auth-signin', '/app/auth/signin', False),
         ('auth-signup', '/app/auth/signup', False), ('auth-verify', '/app/auth/verify', True), ('auth-reset', '/app/auth/reset', False),
         ('auth-code', '/app/auth/forum-code', False), ('notfound', '/app/nowhere', True), ('maintenance', '/app/maintenance', False), ('projects', '/app/projects', True)]

def set_props(page, props):
    if not props: return
    # the DC runtime reads data-props defaults from the script tag; override the default before it boots
    page.evaluate("""(props) => { const s = document.querySelector('script[data-dc-script]'); if (!s) return;
      const p = JSON.parse(s.getAttribute('data-props').replace(/&quot;/g,'"')); for (const k in props) { if (p[k]) p[k].default = props[k]; }
      s.setAttribute('data-props', JSON.stringify(p)); }""", props)

errors = []
with sync_playwright() as pw:
    browser = pw.chromium.launch()
    # ---- artboards ----
    for name, f, props in ARTBOARDS:
        if a.only and a.only not in name: continue
        path = os.path.join(a.design, f)
        if not os.path.exists(path): print('skip artboard', f); continue
        w = 430 if name == 'mobile' else 1280
        page = browser.new_page(viewport={'width': w, 'height': 900})
        # props must be applied before support.js boots: intercept and inject via init script
        if props:
            page.add_init_script("""window.__dcProps=%s; document.addEventListener('DOMContentLoaded',()=>{});""" % json.dumps(props))
            page.route('**/*.dc.html', lambda route: route.continue_())
        page.goto('file://' + path.replace(' ', '%20').replace('&', '%26'), wait_until='load')
        if props:
            # re-render with the wanted view: the runtime exposes the component instance through window.__dc? Fall back to clicking.
            page.wait_for_timeout(600)
            if name == 'auth-signin': page.click('text=SIGN IN')
            elif name == 'auth-signup': page.click('text=CREATE ACCOUNT →')
            elif name == 'auth-verify': page.click('text=CREATE ACCOUNT →'); page.wait_for_timeout(200); page.click('text=CREATE ACCOUNT →')
            elif name == 'auth-reset': page.click('text=SIGN IN'); page.wait_for_timeout(200); page.click('text=FORGOT?')
            elif name == 'auth-code': page.click('text=SIGN IN'); page.wait_for_timeout(200); page.click('text=Enter your code')
        page.wait_for_timeout(900)
        page.screenshot(path=os.path.join(QA, f'design-{name}.png'), full_page=True)
        print('artboard →', f'design-{name}.png')
        page.close()
    # ---- v2 pages ----
    for name, url, authed in PAGES:
        if a.only and a.only not in name: continue
        w = 1280
        page = browser.new_page(viewport={'width': w, 'height': 900})
        page.on('console', lambda m, n=name: errors.append(f'[{n}] {m.type}: {m.text}') if m.type in ('error', 'warning') else None)
        page.on('pageerror', lambda e, n=name: errors.append(f'[{n}] pageerror: {e}'))
        page.goto(a.base + '/app/auth/welcome', wait_until='load')
        if authed and a.token:
            page.evaluate("([t,u]) => { localStorage.setItem('medx_user_token', t); if (u) localStorage.setItem('medx_user_data', u); }", [a.token, a.user])
        else:
            page.evaluate("() => { localStorage.removeItem('medx_user_token'); localStorage.removeItem('medx_user_data'); }")
        page.goto(a.base + url, wait_until='networkidle')
        page.wait_for_timeout(1200)
        if 'qa=drawer' in url: page.click('[data-act="tg"]'); page.wait_for_timeout(900)
        page.screenshot(path=os.path.join(QA, f'v2-{name}.png'), full_page=True)
        print('v2 →', f'v2-{name}.png', page.url)
        page.close()
    # ---- mobile 430 ----
    for name, url, authed in [('mobile-home', '/app/home', True), ('mobile-projects', '/app/projects', True), ('mobile-auth', '/app/auth/signin', False)]:
        if a.only and a.only not in name: continue
        page = browser.new_page(viewport={'width': 430, 'height': 930}, device_scale_factor=2, is_mobile=True, has_touch=True)
        page.on('console', lambda m, n=name: errors.append(f'[{n}] {m.type}: {m.text}') if m.type in ('error', 'warning') else None)
        page.on('pageerror', lambda e, n=name: errors.append(f'[{n}] pageerror: {e}'))
        page.goto(a.base + '/app/auth/welcome', wait_until='load')
        if authed and a.token: page.evaluate("([t,u]) => { localStorage.setItem('medx_user_token', t); if (u) localStorage.setItem('medx_user_data', u); }", [a.token, a.user])
        page.goto(a.base + url, wait_until='networkidle'); page.wait_for_timeout(1200)
        page.screenshot(path=os.path.join(QA, f'v2-{name}.png'), full_page=True)
        print('v2 →', f'v2-{name}.png')
        page.close()
    browser.close()
open(os.path.join(QA, 'console.txt'), 'w').write('\n'.join(errors) + '\n')
print('\nconsole issues:', len(errors)); [print(' ', e) for e in errors[:40]]
