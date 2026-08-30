#!/usr/bin/env python3
"""scripts/qa-admin-accel.py — QA for the Accelerator Hub (/projects/accelerator) and the Review
Room (/accelerator-review): 1440 px screenshots into _qa/admin-accel/ plus the real flows:

  hub    — intake-window edit (opening date → Dec 8), host-institution add + edit, alumni add + edit
  review — criteria add + rename · score as TWO reviewers → displayed team average · applicant-file
           drawer opens with a real wizard submission (motivation + 11 documents) · SEND INTERVIEW
           LINK queues BOTH emails in the outbox (pending_approval, never sent) · ACCEPT queues the
           offer then UNDO cancels it · DECLINE queues the kind no · EXPORT RANKING (CSV) downloads

Zero console errors required — anything captured lands in _qa/admin-accel/console.txt, exit 1.

   MEDX_QA_TOKEN=<pjero jwt> MEDX_QA_TOKEN2=<second reviewer jwt> python3 scripts/qa-admin-accel.py --base http://localhost:8914

Tokens: reuse (auth limiter = 15 logins / 15 min). MEDX_QA_EMAIL/PASSWORD (+ *_2) log in when unset.
Run as FULL-ACCESS admins on the admaccel scratch DB with two submitted wizard applications
(ACC26-001 Iva Kovačić, ACC26-002 Marko Babić — see the report's local-run notes).
"""
import os, sys, json, argparse, time, urllib.request
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..'))
QA = os.path.join(ROOT, '_qa', 'admin-accel'); os.makedirs(QA, exist_ok=True)

ap = argparse.ArgumentParser()
ap.add_argument('--base', default='http://localhost:8914')
ap.add_argument('--token', default=os.environ.get('MEDX_QA_TOKEN', ''))
ap.add_argument('--token2', default=os.environ.get('MEDX_QA_TOKEN2', ''))
ap.add_argument('--email', default=os.environ.get('MEDX_QA_EMAIL', 'pjero.bacic@medx.hr'))
ap.add_argument('--password', default=os.environ.get('MEDX_QA_PASSWORD', ''))
ap.add_argument('--email2', default=os.environ.get('MEDX_QA_EMAIL_2', 'vp@medx.hr'))
ap.add_argument('--password2', default=os.environ.get('MEDX_QA_PASSWORD_2', ''))
ap.add_argument('--width', type=int, default=1440)
a = ap.parse_args()

def api(path, method='GET', token=None, body=None):
    req = urllib.request.Request(a.base + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + token} if token else {})})
    with urllib.request.urlopen(req) as r:
        return json.load(r)

def login(email, password):
    if not password: sys.exit('need MEDX_QA_TOKEN(+2) or passwords for ' + email)
    return api('/api/auth/login', 'POST', body={'email': email, 'password': password})['token']

TOK = a.token or login(a.email, a.password)
TOK2 = a.token2 or login(a.email2, a.password2)

# ---- ground truth from the API ----
year = api('/api/accelerator/program')['year']
apps = api(f'/api/accelerator/years/{year}/applications', token=TOK)
apps = [x for x in apps if x['status'] != 'draft']
assert len(apps) >= 2, 'need at least two submitted applications on the scratch DB'
app1 = next(x for x in apps if x['application_number'] == 'ACC26-001')
app2 = next(x for x in apps if x['application_number'] == 'ACC26-002')

def outbox_batches():
    return {b['batch_id']: b for b in api('/api/admin/outbox?status=pending_approval', token=TOK)['batches']}

errors = []
def watch(page, name):
    page.on('console', lambda m, n=name: errors.append(f'[{n}] {m.type}: {m.text}') if m.type in ('error', 'warning') else None)
    page.on('pageerror', lambda e, n=name: errors.append(f'[{n}] pageerror: {e}'))

def shot(page, name, full=True, clip=None):
    page.screenshot(path=os.path.join(QA, name), full_page=full and clip is None, clip=clip)
    print('→', name)

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    ctxb = browser.new_context(viewport={'width': a.width, 'height': 950}, accept_downloads=True)
    page = ctxb.new_page(); watch(page, 'accel')
    page.goto(a.base + '/signin', wait_until='load')
    page.evaluate("t => { localStorage.setItem('medx_token', t); }", TOK)

    # ============================== ACCELERATOR HUB ==============================
    page.goto(a.base + '/projects/accelerator', wait_until='networkidle'); page.wait_for_timeout(900)
    assert 'HOST INSTITUTIONS' in page.inner_text('body'), 'hub must render the institutions card'
    shot(page, 'hub.png')

    # -- intake window: opening date → Dec 8 (canonical) --
    page.click('[data-act=intakeEdit]'); page.wait_for_timeout(200)
    page.fill('[data-role=intakeDate]', '2026-12-08'); page.click('[data-act=intakeSave]'); page.wait_for_timeout(900)
    assert 'DEC 8, 2026' in page.inner_text('[data-block=stats]'), 'key-dates strip must show the saved opening date'
    w = api('/api/v2/accelerator-review/intake', token=TOK)
    assert w['opens_at'].startswith('2026-12-08'), 'intake window PUT must persist'
    print('flow → intake window saved (opens Dec 8, 2026)')

    # -- host institutions: add + edit (accelerator_sites CRUD) --
    n0 = page.locator('[data-block=inst] [data-row]').count()
    page.fill('[data-role=instDraft]', 'Cleveland Clinic'); page.click('[data-act=addInst]'); page.wait_for_timeout(900)
    page.fill('[data-role=ePlace]', 'Cleveland, USA · clinical & translational research')
    page.fill('[data-role=eSpots]', '2'); page.click('[data-act=instSave]'); page.wait_for_timeout(900)
    t = page.inner_text('[data-block=inst]')
    assert page.locator('[data-block=inst] [data-row]').count() == n0 + 1 and 'Cleveland Clinic' in t and '2 SPOTS' in t, 'added host must render with place + spots'
    print('flow → institution add + edit')

    # -- alumni: add + edit (v2_accelerator_alumni) --
    page.fill('[data-role=aluDraft]', 'Dr. Ana Barić'); page.click('[data-act=addAlu]'); page.wait_for_timeout(900)
    page.fill('[data-role=aPlace]', 'Mayo Clinic'); page.fill('[data-role=aYear]', '2025')
    page.click('[data-act=aluSave]'); page.wait_for_timeout(900)
    t = page.inner_text('[data-block=alumni]')
    assert 'Dr. Ana Barić' in t and 'Mayo Clinic · 2025' in t, 'alumni row must render name + placement + year'
    print('flow → alumni add + edit')
    shot(page, 'hub-after.png')

    # ============================== REVIEW ROOM ==============================
    page.goto(a.base + '/accelerator-review', wait_until='networkidle'); page.wait_for_timeout(900)
    assert 'Kovačić' in page.inner_text('body'), 'the wizard submissions must stream in'
    shot(page, 'review.png')

    # -- criteria: add + rename (existing per-year routes, 0–5) --
    nc0 = page.locator('[data-block=crit] [data-change=critRename]').count()
    page.fill('[data-block=crit] [data-role=critDraft]', 'English fluency'); page.click('[data-block=crit] [data-act=addCrit]'); page.wait_for_timeout(900)
    assert page.locator('[data-block=crit] [data-change=critRename]').count() == nc0 + 1, 'added criterion must appear'
    first = page.locator('[data-block=crit] [data-change=critRename]').first
    first.fill('Academic record'); page.keyboard.press('Tab'); page.wait_for_timeout(900)
    crits = api(f'/api/accelerator/years/{year}/criteria', token=TOK)
    assert any(c['name'] == 'Academic record' for c in crits) and any(c['name'] == 'English fluency' for c in crits), 'rename + add must persist'
    print('flow → criteria add + rename')

    # -- applicant-file drawer with a real wizard submission --
    page.locator(f'[data-row="{app1["id"]}"] [data-act=file]').first.click(); page.wait_for_timeout(1100)
    dt = page.inner_text(f'[data-row="{app1["id"]}"]')
    assert 'Sleep fragmentation' in dt and 'delirium-screening' in dt, 'drawer must show the project line + motivation'
    docs = page.locator(f'[data-row="{app1["id"]}"] [data-act=doc]').count()
    assert docs == 11, f'drawer must list the 11 uploaded documents, saw {docs}'
    shot(page, 'review-drawer.png')
    ta = page.locator(f'[data-row="{app1["id"]}"] textarea[data-change=note]')
    ta.fill('Strong candidate — fast-track to interview.'); page.keyboard.press('Tab'); page.wait_for_timeout(800)
    full = api(f'/api/accelerator/applications/{app1["id"]}/full', token=TOK)
    assert full['reviewer_notes'] == 'Strong candidate — fast-track to interview.', 'reviewer note must persist'
    print('flow → drawer opens with the real file · note saved')

    # -- scores: two reviewers → displayed team average --
    crits = api(f'/api/accelerator/years/{year}/criteria', token=TOK)
    c1, c2 = crits[0]['id'], crits[1]['id']
    def set_score(crit_id, value):
        page.locator(f'[data-row="{app1["id"]}"] [data-change=score][data-crit="{crit_id}"]').fill(str(value))
        page.keyboard.press('Tab'); page.wait_for_timeout(1100)
    set_score(c1, 4); set_score(c2, 5)                              # reviewer A through the UI
    api('/api/v2/accelerator-review/scores', 'PUT', TOK2, {'application_id': app1['id'], 'criterion_id': c1, 'score': 2})
    api('/api/v2/accelerator-review/scores', 'PUT', TOK2, {'application_id': app1['id'], 'criterion_id': c2, 'score': 3})
    page.reload(wait_until='networkidle'); page.wait_for_timeout(900)
    expected = round(((4 + 2) / 2 + (5 + 3) / 2) / len(crits), 1)    # per-criterion averages, unscored count 0
    total = page.inner_text(f'[data-role="total-{app1["id"]}"]').strip()
    assert total == f'{expected:.1f}', f'team average must be {expected:.1f}, saw {total}'
    print(f'flow → two reviewers scored, average shows {total}')
    shot(page, 'review-scored.png')

    # -- SEND INTERVIEW LINK → two outbox rows, pending approval --
    page.locator(f'[data-row="{app1["id"]}"] [data-act=send]').click(); page.wait_for_timeout(400)
    page.click('.mx-modal-foot [data-act=a0]'); page.wait_for_timeout(1200)
    b = outbox_batches().get('accel-rev2-interview-' + app1['id'])
    assert b and b['count'] == 2, 'interview invite must queue TWO pending emails (applicant + interviewer)'
    assert 'INTERVIEW LINK SENT' in page.inner_text(f'[data-row="{app1["id"]}"]'), 'send button must flip to sent'
    print('flow → interview link queued in the outbox (2 emails)')

    # -- ACCEPT → offer queued, then UNDO cancels --
    page.locator(f'[data-row="{app2["id"]}"] [data-act=file]').first.click(); page.wait_for_timeout(1100)
    page.locator(f'[data-row="{app2["id"]}"] [data-act=accept]').click(); page.wait_for_timeout(1000)
    assert 'ACCEPTED' in page.inner_text(f'[data-row="{app2["id"]}"]')
    assert ('accel-rev2-decision-' + app2['id'] + '-accepted') in outbox_batches(), 'accept must queue the offer email'
    page.click('.mx-toast .undo'); page.wait_for_timeout(1000)
    assert not any(b.startswith('accel-rev2-decision-' + app2['id']) for b in outbox_batches()), 'undo must cancel the queued offer'
    assert api(f'/api/accelerator/applications/{app2["id"]}/full', token=TOK)['status'] == 'submitted', 'undo must restore the status'
    print('flow → accept queued + undo cancelled')

    # -- DECLINE → kind no queued (then undo, leaving the room clean) --
    page.locator(f'[data-row="{app2["id"]}"] [data-act=decline]').click(); page.wait_for_timeout(300)
    page.locator(f'[data-row="{app2["id"]}"] [data-act=decline]').click(); page.wait_for_timeout(1000)
    b = outbox_batches().get('accel-rev2-decision-' + app2['id'] + '-declined')
    assert b and 'about your application' in (b['sample']['subject'] or ''), 'decline must queue the kind-no email'
    assert 'DECLINED' in page.inner_text(f'[data-row="{app2["id"]}"]')
    print('flow → decline queued the kind no')
    page.click('.mx-toast .undo'); page.wait_for_timeout(900)

    # -- ranking + CSV export --
    page.locator('#ranking').scroll_into_view_if_needed(); page.wait_for_timeout(300)
    shot(page, 'review-ranking.png', full=False, clip={'x': 0, 'y': max(0, page.evaluate("document.querySelector('#ranking').getBoundingClientRect().top") ), 'width': a.width, 'height': 500})
    with page.expect_download() as dl:
        page.locator('#ranking [data-act=export]').click()
    path = os.path.join(QA, 'ranking.csv'); dl.value.save_as(path)
    rows = open(path).read().strip().split('\n')
    assert rows[0].startswith('"Rank","Name","University"') and len(rows) >= 3, 'CSV must carry a header + both applicants'
    assert 'Kova' in rows[1], 'the scored applicant must rank first'
    print('flow → ranking CSV exported:', rows[0][:80])

    # -- responsive looks --
    for w_px in (900, 430):
        page.set_viewport_size({'width': w_px, 'height': 950}); page.wait_for_timeout(500)
        shot(page, f'review-{w_px}.png')
    page.set_viewport_size({'width': a.width, 'height': 950})
    page.goto(a.base + '/projects/accelerator', wait_until='networkidle'); page.wait_for_timeout(700)
    page.set_viewport_size({'width': 900, 'height': 950}); page.wait_for_timeout(500)
    shot(page, 'hub-900.png')
    page.close(); browser.close()

open(os.path.join(QA, 'console.txt'), 'w').write('\n'.join(errors) + '\n')
print('\nconsole issues:', len(errors)); [print(' ', e) for e in errors[:40]]
sys.exit(1 if errors else 0)
