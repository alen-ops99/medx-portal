#!/usr/bin/env python3
"""scripts/qa-today.py — side-by-side QA for the Today screen + sign-in: screenshot the design
artboard (file://…/Admin Home.dc.html with support.js) and the v2 pages (dev server) at 1440 px,
open the interactive states (CUSTOMISE panel, Weekly Read expanded, PROJECTS dropdown, profile
menu) and fail on any console error.

   MEDX_QA_EMAIL=pjero.bacic@medx.hr MEDX_QA_PASSWORD='Plexus2026!' python3 scripts/qa-today.py
   MEDX_QA_TOKEN=<jwt> python3 scripts/qa-today.py --base http://localhost:8910      # reuse a token (15 logins / 15 min limit)

Outputs to _qa/: design-today.png · v2-today.png · v2-today-open.png · v2-signin.png · v2-signin-error.png ·
v2-projects.png · v2-profile.png · v2-search.png · v2-today-900.png · v2-today-430.png · console.txt.
Exit code 1 when a console error/pageerror was captured.

Note: run this as a FULL-ACCESS admin (allowed_sections NULL). A permission-restricted admin gets real
403 responses, which the browser logs as resource errors — expected there, not a defect: the UI renders
locked nav items, locked KPI copy and views/locked.js instead.
"""
import os, sys, json, argparse, urllib.request
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..'))
QA = os.path.join(ROOT, '_qa'); os.makedirs(QA, exist_ok=True)
ap = argparse.ArgumentParser()
ap.add_argument('--base', default='http://localhost:8910')
ap.add_argument('--design', default=os.path.abspath(os.path.join(ROOT, '..', '..', 'design', 'handoff', 'admin-portal-2026-08-28')))
ap.add_argument('--token', default=os.environ.get('MEDX_QA_TOKEN', ''))
ap.add_argument('--email', default=os.environ.get('MEDX_QA_EMAIL', ''))
ap.add_argument('--password', default=os.environ.get('MEDX_QA_PASSWORD', ''))
ap.add_argument('--width', type=int, default=1440)
ap.add_argument('--only', default='')
ap.add_argument('--flows', action='store_true', help='also exercise CUSTOMISE persistence, task add/done/undo, snooze/undo (writes to the scratch DB)')
a = ap.parse_args()

def login():
    if a.token: return a.token, None
    if not (a.email and a.password): sys.exit('need MEDX_QA_TOKEN or MEDX_QA_EMAIL + MEDX_QA_PASSWORD')
    req = urllib.request.Request(a.base + '/api/auth/login', data=json.dumps({'email': a.email, 'password': a.password}).encode(), headers={'Content-Type': 'application/json'})
    d = json.load(urllib.request.urlopen(req))
    return d['token'], json.dumps(d['user'])

errors = []
def watch(page, name):
    page.on('console', lambda m, n=name: errors.append(f'[{n}] {m.type}: {m.text}') if m.type in ('error', 'warning') else None)
    page.on('pageerror', lambda e, n=name: errors.append(f'[{n}] pageerror: {e}'))

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    # ---- artboard (design reference) ----
    if not a.only or 'design' in a.only:
        path = os.path.join(a.design, 'Admin Home.dc.html')
        if os.path.exists(path):
            page = browser.new_page(viewport={'width': a.width, 'height': 900})
            page.goto('file://' + path.replace(' ', '%20').replace('&', '%26'), wait_until='load')
            page.wait_for_timeout(1200)
            page.screenshot(path=os.path.join(QA, 'design-today.png'), full_page=True)
            print('artboard → design-today.png')
            page.close()
        else: print('skip artboard (not found):', path)
    # ---- v2 sign-in (guest) ----
    if not a.only or 'signin' in a.only:
        page = browser.new_page(viewport={'width': a.width, 'height': 900}); watch(page, 'signin')
        page.goto(a.base + '/signin', wait_until='load')
        page.evaluate("() => { localStorage.removeItem('medx_token'); localStorage.removeItem('medx_user'); }")
        page.goto(a.base + '/today', wait_until='networkidle'); page.wait_for_timeout(600)
        assert page.url.endswith('/signin'), 'guest on /today must land on /signin, got ' + page.url
        page.screenshot(path=os.path.join(QA, 'v2-signin.png'), full_page=True); print('v2 → v2-signin.png')
        before = len(errors)
        page.fill('input[name=email]', 'nobody@medx.hr'); page.fill('input[name=password]', 'wrong'); page.click('[data-act=signin]')
        page.wait_for_timeout(900)
        # the deliberate bad login answers 401 — the browser logs that response as a resource error; expected here
        errors[before:] = [e for e in errors[before:] if '401' not in e]
        assert page.inner_text('[data-role=error]').strip(), 'wrong password must show the inline error line'
        page.screenshot(path=os.path.join(QA, 'v2-signin-error.png'), full_page=True); print('v2 → v2-signin-error.png')
        page.close()
    # ---- v2 Today (authed) ----
    if not a.only or 'today' in a.only:
        token, user = login()
        page = browser.new_page(viewport={'width': a.width, 'height': 900}); watch(page, 'today')
        page.goto(a.base + '/signin', wait_until='load')
        page.evaluate("([t,u]) => { localStorage.setItem('medx_token', t); if (u) localStorage.setItem('medx_user', u); }", [token, user])
        page.goto(a.base + '/today', wait_until='networkidle'); page.wait_for_timeout(1500)
        page.screenshot(path=os.path.join(QA, 'v2-today.png'), full_page=True); print('v2 → v2-today.png', page.url)
        # interactive states: CUSTOMISE open + Weekly Read expanded + attention list expanded
        page.click('[data-act=custToggle]'); page.wait_for_timeout(300)
        page.click('[data-act=wrToggle]'); page.wait_for_timeout(300)
        if page.query_selector('[data-act=showAll]'): page.click('[data-act=showAll]'); page.wait_for_timeout(300)
        page.screenshot(path=os.path.join(QA, 'v2-today-open.png'), full_page=True); print('v2 → v2-today-open.png')
        # chrome: PROJECTS dropdown + profile menu
        page.click('[data-act=projects]'); page.wait_for_timeout(300)
        page.screenshot(path=os.path.join(QA, 'v2-projects.png'), clip={'x': 0, 'y': 0, 'width': a.width, 'height': 420}); print('v2 → v2-projects.png')
        page.keyboard.press('Escape'); page.click('[data-act=profile]'); page.wait_for_timeout(300)
        page.screenshot(path=os.path.join(QA, 'v2-profile.png'), clip={'x': 0, 'y': 0, 'width': a.width, 'height': 420}); print('v2 → v2-profile.png')
        page.keyboard.press('Escape')
        # header search: a screen match + the assistant ask row
        page.fill('[data-role=q]', 'money'); page.wait_for_timeout(700)
        page.screenshot(path=os.path.join(QA, 'v2-search.png'), clip={'x': 0, 'y': 0, 'width': a.width, 'height': 420}); print('v2 → v2-search.png')
        page.keyboard.press('Escape')
        if a.flows:
            # CUSTOMISE: hide "Days to Plexus" → 3 hero cells → PUT /api/dashboard-preferences/today-v2 → reload → still 3 → restore
            page.goto(a.base + '/today', wait_until='networkidle'); page.wait_for_timeout(800)
            page.click('[data-act=custToggle]'); page.wait_for_timeout(200)
            page.click('[data-act=custTg][data-key=kDays]'); page.wait_for_timeout(900)
            assert page.locator('.mx-kpi > a').count() == 3, 'hero must drop to 3 cells after unticking Days to Plexus'
            page.goto(a.base + '/today', wait_until='networkidle'); page.wait_for_timeout(800)
            assert page.locator('.mx-kpi > a').count() == 3, 'the layout must persist server-side across a reload'
            page.click('[data-act=custToggle]'); page.wait_for_timeout(200); page.click('[data-act=custTg][data-key=kDays]'); page.wait_for_timeout(900)
            assert page.locator('.mx-kpi > a').count() == 4, 'restoring the tick must bring the 4th cell back'
            print('flow → customise persists')
            # TEAM TASKS: add → appears; tick → gone; UNDO → back; tick again → gone (leaves the DB clean)
            title = 'QA v2 task ' + str(int(__import__('time').time()))
            n0 = page.locator('[data-task]').count()
            page.click('[data-act=addToggle]'); page.fill('[data-role=taskDraft]', title); page.click('[data-act=addTask]'); page.wait_for_timeout(1200)
            assert page.locator('[data-task]').count() == n0 + 1 and title in page.inner_text('[data-block=tasks]'), 'added task must appear'
            row = page.locator('[data-task]', has_text=title)
            row.locator('[data-act=taskDone]').click(); page.wait_for_timeout(600)
            assert page.locator('[data-task]', has_text=title).count() == 0, 'ticked task must leave the list'
            page.click('.mx-toast .undo'); page.wait_for_timeout(1400)
            assert page.locator('[data-task]', has_text=title).count() == 1, 'UNDO must bring the task back'
            page.locator('[data-task]', has_text=title).locator('[data-act=taskDone]').click(); page.wait_for_timeout(600)
            print('flow → task add / done / undo')
            # SNOOZE 1D on the first attention row → hidden; UNDO → back
            first = page.locator('[data-block=attn] [data-row]').first
            if first.count():
                rid = first.get_attribute('data-row')
                first.locator('[data-act=snooze]').click(); page.wait_for_timeout(300)
                assert page.locator(f'[data-row="{rid}"]').count() == 0, 'snoozed row must hide'
                page.click('.mx-toast .undo'); page.wait_for_timeout(400)
                assert page.locator(f'[data-row="{rid}"]').count() == 1, 'UNDO must restore the row'
                print('flow → snooze / undo')
            # Weekly Read: expand shows one line per advisor, ALL N LINES shows the rest
            page.click('[data-act=wrToggle]'); page.wait_for_timeout(300)
            if page.locator('[data-act=wrAll]').count():
                top = page.locator('[data-block=weekly] .mx-row').count(); page.click('[data-act=wrAll]'); page.wait_for_timeout(300)
                assert page.locator('[data-block=weekly] .mx-row').count() > top, 'ALL LINES must expand the read'
                print('flow → weekly read expands')
            page.goto(a.base + '/today', wait_until='networkidle'); page.wait_for_timeout(800)
        # responsive: 900 and 430
        for w in (900, 430):
            page.set_viewport_size({'width': w, 'height': 900}); page.wait_for_timeout(500)
            page.screenshot(path=os.path.join(QA, f'v2-today-{w}.png'), full_page=True); print(f'v2 → v2-today-{w}.png')
        page.close()
    browser.close()
open(os.path.join(QA, 'console.txt'), 'w').write('\n'.join(errors) + '\n')
print('\nconsole issues:', len(errors)); [print(' ', e) for e in errors[:40]]
sys.exit(1 if errors else 0)
