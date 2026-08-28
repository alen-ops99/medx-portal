#!/usr/bin/env python3
"""scripts/qa-accelerator.py — Accelerator screen QA (approach copied from scripts/qa-shots.py,
kept separate so shared scripts stay untouched).

  1. artboard-vs-page screenshots at 1280px and 430px  →  _qa/accelerator/
  2. functional pass: overview controls, results lookup (empty / malformed / unknown / valid),
     full wizard walk-through (autosave per step, document uploads, submit), keyboard pass,
     zero console errors.

  MEDX_QA_TOKEN=… MEDX_QA_USER='<json>' python3 scripts/qa-accelerator.py \
      [--base http://localhost:8902] [--db /path/to/accel.db] [--only shots|flows]

--db (a COPY of the staging seed, the one the local backend runs on) lets the script reset the
QA member's accelerator rows so the walk-through is repeatable; without it the wizard flow is
skipped when an application already exists.
"""
import os, sys, json, argparse, subprocess, urllib.parse, urllib.request
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..'))
REPO = os.path.abspath(os.path.join(ROOT, '..', '..'))
QA = os.path.join(ROOT, '_qa', 'accelerator'); os.makedirs(QA, exist_ok=True)

ap = argparse.ArgumentParser()
ap.add_argument('--base', default='http://localhost:8902')
ap.add_argument('--backend', default='http://localhost:3962')
ap.add_argument('--design', default=os.path.join(REPO, 'design', 'handoff', 'member-portal-2026-08-28'))
ap.add_argument('--token', default=os.environ.get('MEDX_QA_TOKEN', ''))
ap.add_argument('--user', default=os.environ.get('MEDX_QA_USER', ''))
ap.add_argument('--db', default=os.environ.get('MEDX_QA_DB', ''))
ap.add_argument('--code', default='AX26-QA01', help='a valid accelerator_result_codes.code in the QA db')
ap.add_argument('--pdf-dir', default=os.environ.get('MEDX_QA_PDFS', ''), help='dir with qa-cv.pdf / qa-transcript.pdf / qa-recommendation.pdf (created if missing)')
ap.add_argument('--only', default='')
a = ap.parse_args()

results, console = [], []
def check(name, ok, info=''):
    results.append((name, bool(ok), info)); print(('PASS ' if ok else 'FAIL ') + name + (('  — ' + str(info)[:180]) if info else ''))

def sqlite(sql):
    if not a.db: return None
    return subprocess.run(['sqlite3', '-batch', a.db], input='.timeout 4000\n' + sql + '\n',
                          capture_output=True, text=True).stdout.strip()

def api_get(path):
    req = urllib.request.Request(a.backend + path, headers={'Authorization': 'Bearer ' + a.token, 'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=20) as r: return json.loads(r.read().decode())

def make_pdfs():
    d = a.pdf_dir or QA
    pdf = (b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
           b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Size 4/Root 1 0 R>>\n%%EOF\n")
    out = {}
    for n in ('cv', 'transcript', 'recommendation'):
        p = os.path.join(d, f'qa-{n}.pdf')
        if not os.path.exists(p): open(p, 'wb').write(pdf)
        out[n] = p
    return out

def user_id():
    try: return json.loads(a.user).get('id', '')
    except Exception: return ''

def reset_member_rows():
    uid = user_id()
    if not (a.db and uid): return False
    sqlite(f"DELETE FROM accelerator_documents WHERE application_id IN (SELECT id FROM accelerator_applications WHERE user_id='{uid}');"
           f"DELETE FROM accelerator_applications WHERE user_id='{uid}';"
           f"DELETE FROM notify_topics WHERE user_id='{uid}' AND project_key='accelerator';")
    return True

def toast_text(page, prev=['']):
    for _ in range(40):
        try: t = page.locator('.mx-toast.show').inner_text(timeout=150)
        except Exception: t = ''
        if t and t != prev[0]: prev[0] = t; return t
        page.wait_for_timeout(100)
    return ''

def new_page(browser, w=1280, h=900, name='page', mobile=False):
    kw = {'viewport': {'width': w, 'height': h}}
    if mobile: kw.update({'device_scale_factor': 2, 'is_mobile': True, 'has_touch': True})
    page = browser.new_page(**kw)
    # 'Failed to load resource' = the browser's own log line for a non-2xx XHR; the unknown-code
    # results lookup 404s BY DESIGN (distinct error path), so that line is not an app error.
    page.on('console', lambda m, n=name: console.append(f'[{n}] {m.type}: {m.text}') if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    page.on('pageerror', lambda e, n=name: console.append(f'[{n}] pageerror: {e}'))
    return page

def sign_in(page):
    page.goto(a.base + '/app/auth/welcome', wait_until='load')
    page.evaluate("([t,u]) => { localStorage.setItem('medx_user_token', t); if (u) localStorage.setItem('medx_user_data', u);"
                  " localStorage.removeItem('medx_accelerator_draft'); localStorage.removeItem('medx_accelerator_step'); }", [a.token, a.user])

def shots(browser):
    # ---- artboards (file:// like qa-shots.py) ----
    for name, f, click in [('overview', 'Accelerator.dc.html', None),
                           ('apply', 'Accelerator Application.dc.html', None),
                           ('apply-step7', 'Accelerator Application.dc.html', 'REVIEW')]:
        path = os.path.join(a.design, f)
        if not os.path.exists(path): print('skip artboard', f); continue
        page = browser.new_page(viewport={'width': 1280, 'height': 900})
        page.goto('file://' + urllib.parse.quote(path), wait_until='load')
        page.wait_for_timeout(900)
        if click:
            try: page.click(f'text={click}'); page.wait_for_timeout(500)
            except Exception as e: print('artboard click failed:', e)
        page.screenshot(path=os.path.join(QA, f'design-{name}.png'), full_page=True)
        print('artboard →', f'design-{name}.png'); page.close()
    # ---- v2 pages ----
    for name, url, w, mobile in [('overview', '/app/accelerator', 1280, False),
                                 ('apply', '/app/accelerator/apply?preview=1', 1280, False),
                                 ('overview-430', '/app/accelerator', 430, True),
                                 ('apply-430', '/app/accelerator/apply?preview=1', 430, True)]:
        page = new_page(browser, w, 930 if mobile else 900, 'shot-' + name, mobile)
        sign_in(page)
        page.goto(a.base + url, wait_until='networkidle'); page.wait_for_timeout(1200)
        page.screenshot(path=os.path.join(QA, f'v2-{name}.png'), full_page=True)
        if not mobile:
            check(f'{name}: no horizontal scroll @{w}', page.evaluate('document.documentElement.scrollWidth') <= w,
                  page.evaluate('document.documentElement.scrollWidth'))
        else:
            check(f'{name}: no horizontal scroll @430', page.evaluate('document.documentElement.scrollWidth') <= 430,
                  page.evaluate('document.documentElement.scrollWidth'))
        print('v2 →', f'v2-{name}.png'); page.close()
    # step 7 of the restyled wizard
    page = new_page(browser, 1280, 900, 'shot-apply-step7')
    sign_in(page)
    page.goto(a.base + '/app/accelerator/apply?preview=1', wait_until='networkidle'); page.wait_for_timeout(900)
    page.click('[data-act="go"][data-step="7"]'); page.wait_for_timeout(500)
    page.screenshot(path=os.path.join(QA, 'v2-apply-step7.png'), full_page=True)
    print('v2 →', 'v2-apply-step7.png'); page.close()

def flows(browser, pdfs):
    page = new_page(browser, 1280, 900, 'flows')
    sign_in(page)

    # ---------- overview ----------
    page.goto(a.base + '/app/accelerator', wait_until='networkidle'); page.wait_for_timeout(1200)
    body = page.locator('[data-screen-label="Accelerator"]').inner_text()
    check('overview renders (hero + band)', 'ACCELERATOR' in body.upper() and 'STIPEND' in body.upper())
    days = page.locator('[data-cd="opendays"]').inner_text().strip()
    check('countdown cell filled', days not in ('', '—'), days)
    check('no EUR anywhere (uses €)', 'EUR' not in body.replace('EUROPE', ''), '')

    # GET NOTIFIED → notify-topics
    page.click('[data-block="hero"] [data-act="notify"]'); t = toast_text(page)
    check('GET NOTIFIED → toast', 'email you the day' in t.lower(), t)
    page.wait_for_timeout(400)
    check('GET NOTIFIED → ✓ label + toggle ON', 'ON THE LIST' in page.locator('[data-block="hero"]').inner_text()
          and page.locator('[data-act="tgFollow"]').get_attribute('aria-checked') == 'true')
    # follow toggle off/on
    page.click('[data-act="tgFollow"]'); t = toast_text(page)
    check('follow toggle → off toast', 'updates off' in t.lower(), t)
    page.click('[data-act="tgFollow"]'); toast_text(page)

    # host cards expand/close
    page.click('[data-act="pickHost"][data-i="0"]'); page.wait_for_timeout(300)
    check('host card expands (blurb panel)', page.locator('[data-act="closeHost"]').count() == 1)
    page.click('[data-act="closeHost"]'); page.wait_for_timeout(300)
    check('host panel closes', page.locator('[data-act="closeHost"]').count() == 0)

    # FAQ accordion + keyboard
    page.click('[data-act="faq"][data-i="0"]'); page.wait_for_timeout(200)
    check('FAQ opens on click', page.locator('[data-act="faq"][data-i="0"]').get_attribute('aria-expanded') == 'true')
    page.focus('[data-act="faq"][data-i="0"]'); page.keyboard.press('Enter'); page.wait_for_timeout(200)
    check('FAQ closes on Enter (keyboard)', page.locator('[data-act="faq"][data-i="0"]').get_attribute('aria-expanded') == 'false')
    check('data-act spans get role=button', page.locator('[data-block="hero"] [data-act="notify"]').get_attribute('role') == 'button')

    # ---------- results lookup: empty / malformed / unknown ----------
    def code_err():
        el = page.locator('[data-role="codeErr"]')
        return el.inner_text().strip() if el.is_visible() else ''
    page.click('[data-act="viewResults"]'); page.wait_for_timeout(300)
    check('results: empty code → distinct error', 'access code from your email' in code_err().lower(), code_err())
    page.fill('[data-role="code"]', 'WRONG'); page.click('[data-act="viewResults"]'); page.wait_for_timeout(300)
    check('results: malformed code → format error', 'ax26-xxxx' in code_err().lower(), code_err())
    page.fill('[data-role="code"]', 'AX26-ZZZZ'); page.click('[data-act="viewResults"]'); page.wait_for_timeout(900)
    check('results: unknown code → not recognised', 'recognise' in code_err().lower(), code_err())

    # ---------- apply gate (before opening) ----------
    page.click('a[href="/app/accelerator/apply"]'); page.wait_for_timeout(900)
    gate = page.locator('[data-screen-label="Accelerator Application"]').inner_text()
    check('apply tab gated before opening', 'Applications open' in gate and page.locator('[data-act="toPreview"]').count() == 1)
    page.click('[data-act="toPreview"]'); page.wait_for_timeout(900)
    check('gate → PREVIEW opens the wizard (?preview=1)', 'preview=1' in page.url and page.locator('[data-block="wizard"]').count() == 1, page.url)

    # ---------- wizard walk-through ----------
    check('step 1 prefilled from profile', page.locator('[data-field="axEmail"]').input_value() != '')
    page.fill('[data-field="axDob"]', '1999-04-12')
    page.fill('[data-field="axNationality"]', 'Croatian')
    page.select_option('[data-field="axCountry"]', 'HR')
    page.wait_for_timeout(900)  # autosave debounce
    page.click('[data-act="next"]'); page.wait_for_timeout(400)
    check('step 1 → CONTINUE → step 2', 'Education' in page.locator('[data-block="panel"]').inner_text())
    check('PREVIOUS enabled from step 2', page.locator('[data-act="prev"]').get_attribute('aria-disabled') == 'false')

    # autosave survives a reload
    page.reload(wait_until='networkidle'); page.wait_for_timeout(1000)
    check('autosave: reload restores the step', 'Education' in page.locator('[data-block="panel"]').inner_text())
    page.click('[data-act="go"][data-step="1"]'); page.wait_for_timeout(400)
    check('autosave: values persist (nationality)', page.locator('[data-field="axNationality"]').input_value() == 'Croatian')
    # stepper keyboard
    page.focus('[data-act="go"][data-step="2"]'); page.keyboard.press('Enter'); page.wait_for_timeout(400)
    check('stepper: keyboard Enter → step 2', 'Education' in page.locator('[data-block="panel"]').inner_text())

    if not page.locator('[data-field="axInstitution"]').input_value():
        page.fill('[data-field="axInstitution"]', 'University of Rijeka')
    page.select_option('[data-field="axDegree"]', 'md')
    page.select_option('[data-field="axYear"]', '5')
    page.fill('[data-field="axField"]', 'Neuroscience')
    page.click('[data-act="next"]'); page.wait_for_timeout(400)
    check('step 2 → step 3 (Program Preferences)', 'Program Preferences' in page.locator('[data-block="panel"]').inner_text())

    opts = page.locator('[data-field="axChoice1"] option').all_inner_texts()
    vals = page.eval_on_selector_all('[data-field="axChoice1"] option', 'els => els.map(e => e.value)')
    real = [v for v in vals if v]
    check('choice options come from the institutions API', len(real) >= 2, f'{len(real)} options: {opts[1:3]}')
    page.select_option('[data-field="axChoice1"]', real[0])
    page.select_option('[data-field="axChoice2"]', real[1])
    page.fill('[data-field="axResearchInterests"]', 'Sleep and circadian biology; systems neuroscience.')
    # distinct-choice validation (legacy rule)
    page.select_option('[data-field="axChoice2"]', real[0]); page.click('[data-act="next"]'); t = toast_text(page)
    check('duplicate choices blocked (legacy toast)', 'different institutions' in t.lower(), t)
    page.select_option('[data-field="axChoice2"]', real[1])
    page.click('[data-act="next"]'); page.wait_for_timeout(400)
    check('step 3 → step 4 (Supplementary)', 'Supplementary' in page.locator('[data-block="panel"]').inner_text())

    page.fill('[data-field="axStatement"]', 'I want to bring world-class research experience home to Croatia.')
    page.fill('[data-field="axExperience"]', 'Two summers in a sleep lab.')
    page.click('[data-act="next"]'); page.wait_for_timeout(400)
    check('step 4 → step 5 (Documents)', 'Documents' in page.locator('[data-block="panel"]').inner_text())

    # validation: CV required before continuing
    page.click('[data-act="next"]'); t = toast_text(page)
    check('step 5 blocks without CV (legacy toast)', 'cv/resume' in t.lower(), t)
    page.set_input_files('[data-role="file-cv"]', pdfs['cv'])
    page.set_input_files('[data-role="file-transcript"]', pdfs['transcript'])
    page.set_input_files('[data-role="file-recommendation"]', pdfs['recommendation'])
    page.wait_for_timeout(300)
    check('file names shown after pick', 'qa-cv.pdf' in page.locator('[data-block="panel"]').inner_text())
    page.click('[data-act="next"]'); page.wait_for_timeout(400)
    check('step 5 → step 6 (Consent)', 'Consent' in page.locator('[data-block="panel"]').inner_text())

    page.click('[data-act="next"]'); t = toast_text(page)
    check('consents required (legacy toast)', 'consent checkboxes' in t.lower(), t)
    for i in (1, 2, 3): page.check(f'[data-consent="c{i}"]')
    page.click('[data-act="next"]'); page.wait_for_timeout(400)
    check('step 6 → step 7 (Review & Submit)', 'Review & Submit' in page.locator('[data-block="panel"]').inner_text())

    # one completion source: checklist % ↔ review rows (5 of 6 done before submit)
    pct = page.locator('[data-block="checklist"]').inner_text()
    check('checklist shows 83% before submit (5/6)', '83%' in pct, pct.replace('\n', ' ')[:120])
    rows = page.locator('[data-block="panel"]').inner_text()
    check('review rows: 5 COMPLETE + review INCOMPLETE', rows.count('COMPLETE') >= 5 and 'INCOMPLETE' in rows)
    check('submit enabled once sections complete', page.locator('[data-act="submit"]').get_attribute('aria-disabled') == 'false')

    page.click('[data-act="submit"]')
    t = toast_text(page)
    page.wait_for_timeout(2500)
    check('submit → success toast', 'submitted successfully' in t.lower(), t)
    modal = page.locator('.mx-modal')
    check('fee modal appears (€75, PAY LATER)', modal.count() == 1 and '€75' in modal.inner_text(), '')
    if modal.count(): page.click('.mx-modal-foot [data-act="a0"]')  # PAY LATER
    page.wait_for_timeout(600)
    body = page.locator('[data-screen-label="Accelerator Application"]').inner_text()
    check('submitted state shows the application number', ' is in.' in body and 'ACC' in body, '')
    check('checklist 100% after submit', '100%' in page.locator('[data-block="checklist"]').inner_text())

    # server truth: application row + 3 documents (my-applications matches by user_id/email;
    # note applications/my would MISS wizard rows — the legacy POST never sets program_id).
    # Documents are read straight from the DB: GET /api/accelerator/applications/:id/documents
    # 500s in the EXISTING backend (selects file_name/verified, columns that do not exist).
    rows_api = api_get('/api/accelerator/my-applications') or []
    apps = rows_api[0] if rows_api else {}
    check('server: application submitted', bool(apps) and apps.get('status') == 'submitted', apps and apps.get('application_number'))
    docs = (sqlite(f"SELECT document_type FROM accelerator_documents WHERE application_id='{apps.get('id')}' ORDER BY document_type") or '').split('\n') if (a.db and apps.get('id')) else []
    check('server: 3 documents uploaded (cv/transcript/recommendation)',
          docs == ['cv', 'recommendation', 'transcript'], docs)

    # overview reflects the submitted state + valid results code now returns rows
    page.goto(a.base + '/app/accelerator', wait_until='networkidle'); page.wait_for_timeout(1200)
    over = page.locator('[data-block="application"]').inner_text()
    check('overview: YOUR APPLICATION → SUBMITTED card', 'SUBMITTED' in over and (apps.get('application_number') or '§') in over, '')
    page.fill('[data-role="code"]', a.code); page.click('[data-act="viewResults"]'); page.wait_for_timeout(1200)
    table = page.locator('[data-block="results"]').inner_text()
    check('results: valid code → table with own row flagged', (apps.get('application_number') or '§') in table and 'YOURS' in table, table[:120])

    page.screenshot(path=os.path.join(QA, 'v2-apply-submitted.png'), full_page=True)
    page.close()

    # keyboard reachability sample on a fresh page (tab into the results button)
    page = new_page(browser, 1280, 900, 'kbd')
    sign_in(page)
    page.goto(a.base + '/app/accelerator', wait_until='networkidle'); page.wait_for_timeout(1000)
    page.focus('[data-role="code"]'); page.keyboard.press('Tab')
    active = page.evaluate("document.activeElement && document.activeElement.getAttribute('data-act')")
    check('keyboard: Tab reaches VIEW RESULTS after the input', active == 'viewResults', active)
    page.close()

if not a.token:
    print('MEDX_QA_TOKEN required'); sys.exit(2)
pdfs = make_pdfs()
if a.db and a.only != 'shots':
    reset_member_rows(); print('reset accelerator rows for', user_id())
with sync_playwright() as pw:
    browser = pw.chromium.launch()
    if a.only in ('', 'shots'): shots(browser)
    if a.only in ('', 'flows'): flows(browser, pdfs)
    browser.close()

open(os.path.join(QA, 'console.txt'), 'w').write('\n'.join(console) + '\n')
fails = [r for r in results if not r[1]]
print(f'\n{len(results)} checks · {len(results) - len(fails)} pass · {len(fails)} fail · console errors: {len(console)}')
for c in console[:20]: print('  console:', c)
sys.exit(1 if (fails or console) else 0)
