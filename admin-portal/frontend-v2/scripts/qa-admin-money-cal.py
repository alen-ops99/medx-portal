#!/usr/bin/env python3
"""scripts/qa-admin-money-cal.py — QA for the MONEY and CALENDAR destinations: screenshot the two
design artboards and the v2 screens at 1440 px, exercise the real flows, and fail on any console
error. Run it against a LOCAL stack on a scratch DB (it writes: chase queue, ledger rows, calendar
entries, tasks, survey batches).

   MEDX_QA_EMAIL=pjero.bacic@medx.hr MEDX_QA_PASSWORD='Plexus2026!' python3 scripts/qa-admin-money-cal.py --base http://localhost:8918
   MEDX_QA_TOKEN=<jwt> python3 scripts/qa-admin-money-cal.py --base http://localhost:8918   # reuse a token (15 logins / 15 min limit)

Flows verified:
  · Money renders live numbers (€ everywhere, never "EUR")
  · PAYMENTS TO CHASE — one click queues the reminder (outbox pending grows; row flips to QUEUED ✓)
  · SPONSORS & DONORS — pledge → invoiced (FIRA number REQUIRED, modal blocks without it)
    → paid → thanked (thank-you queued in the Outbox; outbox pending grows)
  · Morning-after survey — simulated sweep (POST …/survey/sweep with a now override) → queued state
  · FINANCE TOOLS quiet links — transactions panel, Reconcile "later" state, Stripe key-gate state
  · Calendar — add entry (appears on the board), ✎ EDIT delete + UNDO restore + delete
  · TEAM TASKS — tick on Calendar completes on Today (same /api/admin/tasks list)
  · EXPORT PDF — opens the print view (window.print stubbed; print-media board screenshotted)

Outputs to _qa/admin-money-cal/: design-money.png · design-calendar.png · v2-money.png ·
v2-money-tools.png · v2-money-fira-modal.png · v2-calendar.png · v2-calendar-print.png ·
v2-money-900.png · v2-money-430.png · v2-calendar-900.png · v2-calendar-430.png · console.txt.
Exit code 1 when a console error/pageerror was captured or an assertion failed.
"""
import os, sys, json, time, argparse, urllib.request
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..'))
QA = os.path.join(ROOT, '_qa', 'admin-money-cal'); os.makedirs(QA, exist_ok=True)
ap = argparse.ArgumentParser()
ap.add_argument('--base', default='http://localhost:8918')
ap.add_argument('--design', default=os.path.abspath(os.path.join(ROOT, '..', '..', 'design', 'handoff', 'admin-portal-2026-08-28')))
ap.add_argument('--token', default=os.environ.get('MEDX_QA_TOKEN', ''))
ap.add_argument('--email', default=os.environ.get('MEDX_QA_EMAIL', ''))
ap.add_argument('--password', default=os.environ.get('MEDX_QA_PASSWORD', ''))
ap.add_argument('--width', type=int, default=1440)
a = ap.parse_args()

def api(method, path, body=None, token=None):
    req = urllib.request.Request(a.base + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + token} if token else {})})
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b'{}')
        except Exception: return e.code, {}

def login():
    if a.token: return a.token, None
    if not (a.email and a.password): sys.exit('need MEDX_QA_TOKEN or MEDX_QA_EMAIL + MEDX_QA_PASSWORD')
    s, d = api('POST', '/api/auth/login', {'email': a.email, 'password': a.password})
    assert s == 200, f'login failed: {s} {d}'
    return d['token'], json.dumps(d['user'])

errors, failures = [], []
def watch(page, name):
    page.on('console', lambda m, n=name: errors.append(f'[{n}] {m.type}: {m.text}') if m.type in ('error', 'warning') else None)
    page.on('pageerror', lambda e, n=name: errors.append(f'[{n}] pageerror: {e}'))
def check(ok, what):
    print(('  ok  ' if ok else '  FAIL') + ' · ' + what)
    if not ok: failures.append(what)
def outbox_pending(token):
    s, d = api('GET', '/api/admin/outbox?status=pending_approval', token=token)
    return len(d.get('batches', []))

token, user = login()

with sync_playwright() as pw:
    browser = pw.chromium.launch()

    # ---- design artboards (reference) ----
    for f, out in (('Admin Money.dc.html', 'design-money.png'), ('Admin Calendar.dc.html', 'design-calendar.png')):
        path = os.path.join(a.design, f)
        if os.path.exists(path):
            page = browser.new_page(viewport={'width': a.width, 'height': 900})
            page.goto('file://' + path.replace(' ', '%20').replace('&', '%26'), wait_until='load')
            page.wait_for_timeout(1200)
            page.screenshot(path=os.path.join(QA, out), full_page=True)
            print('artboard →', out); page.close()
        else:
            print('skip artboard (not found):', path)

    def new_page():
        page = browser.new_page(viewport={'width': a.width, 'height': 900})
        page.goto(a.base + '/signin', wait_until='load')
        page.evaluate("([t,u]) => { localStorage.setItem('medx_token', t); if (u) localStorage.setItem('medx_user', u); }", [token, user])
        return page

    # ================= MONEY =================
    page = new_page(); watch(page, 'money')
    page.goto(a.base + '/money', wait_until='networkidle'); page.wait_for_timeout(1600)
    body = page.inner_text('body')
    check('€' in body, 'Money shows € amounts')
    check(' EUR' not in body and 'EUR ' not in body.replace('EUR)', ''), 'no "EUR" text anywhere on Money')
    check(page.locator('[data-block=stats]').count() == 1, 'stat row rendered')
    check(page.locator('[data-block=ledger]').count() == 1, 'SPONSORS & DONORS card rendered')
    page.screenshot(path=os.path.join(QA, 'v2-money.png'), full_page=True); print('v2 → v2-money.png')

    # ---- flow: chase queues a reminder ----
    before = outbox_pending(token)
    btns = page.locator('[data-act=chaseQueue]')
    if btns.count():
        rid = btns.first.evaluate("el => el.closest('[data-row]').getAttribute('data-row')")
        btns.first.click(); page.wait_for_timeout(1200)
        row = page.locator(f'[data-row="{rid}"]')
        check('REMINDER QUEUED' in (row.inner_text() if row.count() else ''), 'chase row flips to REMINDER QUEUED ✓')
        check(outbox_pending(token) == before + 1, 'chase queued exactly one pending outbox batch')
    else:
        # every chase row already queued on this DB — the state itself is the assertion
        check(page.locator('[data-block=chase]').inner_text().count('REMINDER QUEUED') > 0, 'chase rows show queued state (all queued already)')

    # ---- flow: ledger pledge → invoiced (FIRA required) → paid → thanked ----
    before = outbox_pending(token)
    uniq = 'QA Zaklada ' + str(int(time.time()))
    page.click('[data-act=pledgeToggle]'); page.wait_for_timeout(300)
    page.fill('[data-role=plName]', uniq); page.fill('[data-role=plAmt]', '800')
    page.fill('[data-role=plEmail]', 'qa-zaklada@example.com')
    page.click('[data-act=pledgeAdd]'); page.wait_for_timeout(1200)
    row = page.locator('[data-block=ledger] [data-row]', has_text=uniq)
    check(row.count() == 1 and 'PLEDGED' in row.inner_text(), 'pledge appears as PLEDGED')
    row.locator('[data-act=ledgerAct]').click(); page.wait_for_timeout(400)
    page.screenshot(path=os.path.join(QA, 'v2-money-fira-modal.png')); print('v2 → v2-money-fira-modal.png')
    page.click('.mx-modal [data-act=a1]'); page.wait_for_timeout(300)           # RECORD with empty number
    err = page.locator('.mx-modal [data-role=mErr]')
    check(err.count() == 1 and 'FIRA' in err.inner_text(), 'empty FIRA number is refused (modal stays open)')
    page.fill('.mx-modal [data-role=mFira]', '26-100-0099')
    page.check('.mx-modal [data-role=mQueue]')
    page.click('.mx-modal [data-act=a1]'); page.wait_for_timeout(1200)
    row = page.locator('[data-block=ledger] [data-row]', has_text=uniq)
    check('INVOICED' in row.inner_text() and '26-100-0099' in row.inner_text(), 'row is INVOICED and shows the typed FIRA number')
    row.locator('[data-act=ledgerAct]').click(); page.wait_for_timeout(1000)    # MARK PAID
    row = page.locator('[data-block=ledger] [data-row]', has_text=uniq)
    check('PAID' in row.inner_text(), 'row is PAID')
    row.locator('[data-act=ledgerAct]').click(); page.wait_for_timeout(1200)    # SEND THANK-YOU (email on row)
    row = page.locator('[data-block=ledger] [data-row]', has_text=uniq)
    check('THANKED' in row.inner_text(), 'row is THANKED')
    check(outbox_pending(token) == before + 2, 'FIRA notice + thank-you queued two pending outbox batches')
    # server-side FIRA guard (direct API, so no console 4xx noise from the page)
    s, d = api('POST', '/api/v2/money/ledger', {'party': 'QA guard', 'amount': 10}, token=token)
    s2, d2 = api('POST', f"/api/v2/money/ledger/{d['row']['id']}/advance", {'to': 'invoiced'}, token=token)
    check(s2 == 400 and 'FIRA' in d2.get('error', ''), 'API refuses invoiced without a FIRA number (400)')
    api('DELETE', f"/api/v2/money/ledger/{d['row']['id']}", token=token)

    # ---- flow: morning-after survey (simulated sweep) ----
    s, d = api('POST', '/api/v2/money/survey/sweep', {'now': '2026-12-06T09:00:00'}, token=token)
    check(s == 200 and d.get('success'), 'survey sweep runs with a simulated clock')
    s, d = api('GET', '/api/v2/money/survey', token=token)
    conf = [e for e in d.get('events', []) if e['key'].startswith('conf-')]
    check(bool(conf) and conf[0]['state'] == 'queued' and conf[0]['sent'] >= 1, 'conference survey is queued (pending approval, 08:00 next-day schedule)')
    page.goto(a.base + '/money', wait_until='networkidle'); page.wait_for_timeout(1400)
    check('MORNING-AFTER SURVEY' in page.inner_text('[data-block=survey]'), 'survey card renders on Money')

    # ---- quiet links: transactions panel · Reconcile later-state · Stripe key gate ----
    page.click('[data-act=toolOpen][data-id=tx]'); page.wait_for_timeout(500)
    check('ALL TRANSACTIONS' in page.inner_text('[data-block=tool]'), 'transactions tool opens at the top')
    page.click('[data-act=toolOpen][data-id=rec]'); page.wait_for_timeout(400)
    check('later' in page.inner_text('[data-block=tool]').lower(), 'Reconcile shows the deliberate "later" state')
    page.click('[data-act=toolOpen][data-id=stripe]'); page.wait_for_timeout(1200)
    ttext = page.inner_text('[data-block=tool]')
    check(('STRIPE' in ttext) and ('KEY NOT SET' in ttext or 'MATCHED' in ttext or 'payments' in ttext.lower()), 'Stripe tool shows key-gate state or payments')
    page.screenshot(path=os.path.join(QA, 'v2-money-tools.png'), full_page=False); print('v2 → v2-money-tools.png')

    # responsive
    for w in (900, 430):
        page.set_viewport_size({'width': w, 'height': 900}); page.wait_for_timeout(500)
        page.screenshot(path=os.path.join(QA, f'v2-money-{w}.png'), full_page=True); print(f'v2 → v2-money-{w}.png')
    page.close()

    # ================= CALENDAR =================
    page = new_page(); watch(page, 'calendar')
    page.add_init_script("window.print = () => { window.__printed = (window.__printed||0)+1; };")
    page.goto(a.base + '/calendar', wait_until='networkidle'); page.wait_for_timeout(1400)
    check(page.locator('[data-block=board]').count() == 1, 'year board rendered')
    check('NEXT UP' in page.inner_text('[data-block=nextup]'), 'NEXT UP banner rendered')
    page.screenshot(path=os.path.join(QA, 'v2-calendar.png'), full_page=True); print('v2 → v2-calendar.png')

    # ---- flow: add entry → appears; edit-delete → UNDO → delete ----
    uniq = 'QA sponsor dinner ' + str(int(time.time()))
    page.click('[data-act=addToggle]'); page.wait_for_timeout(300)
    page.fill('[data-role=evName]', uniq)
    page.select_option('[data-role=evMonth]', '9')          # OCT
    page.fill('[data-role=evDay]', '15')
    page.click('[data-act=addEntry]'); page.wait_for_timeout(1400)
    check(page.locator('[data-block=board] [data-row]', has_text=uniq).count() == 1, 'new entry appears on the board')
    page.click('[data-act=toggleEdit]'); page.wait_for_timeout(300)
    page.locator('[data-block=board] [data-row]', has_text=uniq).locator('[data-act=removeEntry]').click(); page.wait_for_timeout(1200)
    check(page.locator('[data-block=board] [data-row]', has_text=uniq).count() == 0, 'edit-mode ✕ removes the entry')
    page.click('.mx-toast .undo'); page.wait_for_timeout(1400)
    check(page.locator('[data-block=board] [data-row]', has_text=uniq).count() == 1, 'UNDO restores the entry')
    page.click('[data-act=toggleEdit]'); page.wait_for_timeout(200)   # board re-rendered after undo → re-arm edit mode
    if not page.locator('[data-block=board] [data-row]', has_text=uniq).locator('[data-act=removeEntry]').count():
        page.click('[data-act=toggleEdit]'); page.wait_for_timeout(200)
    page.locator('[data-block=board] [data-row]', has_text=uniq).locator('[data-act=removeEntry]').click(); page.wait_for_timeout(1000)

    # ---- flow: task ticked here shows done on Today ----
    tuniq = 'QA cal task ' + str(int(time.time()))
    page.fill('[data-role=taskDraft]', tuniq)
    page.click('[data-act=taskAdd]'); page.wait_for_timeout(1200)
    trow = page.locator('[data-task]', has_text=tuniq)
    check(trow.count() == 1, 'task added on Calendar')
    tid = trow.get_attribute('data-task')
    trow.locator('[data-act=taskDone]').click(); page.wait_for_timeout(900)
    check(page.locator('[data-task]', has_text=tuniq).count() == 0, 'ticked task leaves the Calendar list')
    s, rows = api('GET', '/api/admin/tasks', token=token)
    match = [t for t in rows if t['id'] == tid]
    check(bool(match) and match[0]['status'] == 'done', 'the SAME task row is status=done on the server (one shared list)')
    page.goto(a.base + '/today', wait_until='networkidle'); page.wait_for_timeout(1500)
    check(tuniq not in page.inner_text('body'), 'Today no longer lists the ticked task')
    page.goto(a.base + '/calendar/tasks', wait_until='networkidle'); page.wait_for_timeout(1200)

    # ---- flow: EXPORT PDF opens the print view ----
    page.click('[data-act=exportPdf]'); page.wait_for_timeout(600)
    check(page.evaluate('window.__printed || 0') >= 1, 'EXPORT PDF calls window.print()')
    page.evaluate("document.body.classList.add('mxc-printing')")
    page.emulate_media(media='print'); page.wait_for_timeout(300)
    box = page.locator('.mxc-print').bounding_box()
    check(bool(box) and box['height'] > 300, 'print board is the visible print-media layout')
    page.screenshot(path=os.path.join(QA, 'v2-calendar-print.png'), full_page=True); print('v2 → v2-calendar-print.png')
    page.emulate_media(media='screen'); page.evaluate("document.body.classList.remove('mxc-printing')")

    # responsive
    for w in (900, 430):
        page.set_viewport_size({'width': w, 'height': 900}); page.wait_for_timeout(500)
        page.screenshot(path=os.path.join(QA, f'v2-calendar-{w}.png'), full_page=True); print(f'v2 → v2-calendar-{w}.png')
    page.close()
    browser.close()

open(os.path.join(QA, 'console.txt'), 'w').write('\n'.join(errors) + '\n')
print('\nconsole issues:', len(errors)); [print(' ', e) for e in errors[:40]]
print('assertion failures:', len(failures)); [print(' ', f) for f in failures]
sys.exit(1 if (errors or failures) else 0)
