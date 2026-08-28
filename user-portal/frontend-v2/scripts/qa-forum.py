#!/usr/bin/env python3
"""scripts/qa-forum.py — Biomedical Forum QA (approach copied from scripts/qa-shots.py; shared scripts untouched).

1) artboard vs v2 screenshots at 1280px and 430px → _qa/forum/
2) functional Playwright pass: non-member state · code redemption (empty / unknown / expired / used / valid) ·
   member state · gathering registration (terms gate) · venue vote · feed · keyboard · zero console errors.

Run against a FRESH copy of the staging seed (member003/member004 must not be Forum members yet):
  cp deploy/staging/seed.db <scratch>/staging/forum.db   # restart the backend after
  MEDX_QA_TOKENS_DIR=<scratch> python3 scripts/qa-forum.py --base http://localhost:8903 --api http://localhost:3963

Tokens are read from  $MEDX_QA_TOKENS_DIR/tok_{pjero.bacic,member003,member004}.txt  (cached JWTs — the auth
limiter allows 15 hits / 15 min per IP, so tokens are minted once and reused; they survive a DB reset)."""
import os, sys, json, argparse, urllib.request
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

HERE = os.path.dirname(os.path.abspath(__file__))
QA = os.path.join(HERE, '..', '_qa', 'forum'); os.makedirs(QA, exist_ok=True)
ap = argparse.ArgumentParser()
ap.add_argument('--base', default='http://localhost:8903')
ap.add_argument('--api', default='http://localhost:3963')
ap.add_argument('--design', default=os.path.join(HERE, '..', '..', '..', 'design', 'handoff', 'member-portal-2026-08-28'))
ap.add_argument('--tokens', default=os.environ.get('MEDX_QA_TOKENS_DIR', ''))
ap.add_argument('--shots-only', action='store_true')
a = ap.parse_args()

def tok(name):
    p = os.path.join(a.tokens, f'tok_{name}.txt')
    t = open(p).read().strip()
    if not t: raise SystemExit(f'empty token file {p}')
    return t

def api(method, path, token=None, body=None):
    req = urllib.request.Request(a.api + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + token} if token else {})})
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'{}')

results, console = [], []
def check(name, ok, info=''):
    results.append((name, bool(ok))); print(('PASS ' if ok else 'FAIL ') + name + (('  — ' + str(info)) if info and not ok else ''))

def do_and_toast(page, action):
    """Snapshot the toast, run the action, wait for a NEW toast (a previous one may still be fading) — qa-flows.py approach."""
    try: prev = page.locator('.mx-toast.show').inner_text(timeout=100)
    except PWTimeout: prev = ''
    action()
    for _ in range(60):
        try: t = page.locator('.mx-toast.show').inner_text(timeout=150)
        except PWTimeout: t = ''
        if t and t != prev: return t.lower()
        page.wait_for_timeout(100)
    return ''

ARTBOARD = os.path.join(a.design, 'Biomedical Forum.dc.html')
def art_url(): return 'file://' + ARTBOARD.replace(' ', '%20').replace('&', '%26')

with sync_playwright() as pw:
    browser = pw.chromium.launch()

    # ---- artboard shots: default (noInvite) + member state (the artboard's UNLOCK sets it), 1280 + 430 ----
    for w, suffix in [(1280, ''), (430, '-430')]:
        pg = browser.new_page(viewport={'width': w, 'height': 900})
        pg.goto(art_url(), wait_until='load'); pg.wait_for_timeout(900)
        pg.screenshot(path=os.path.join(QA, f'design-forum{suffix}.png'), full_page=True)
        pg.click('text=UNLOCK REGISTRATION'); pg.wait_for_timeout(600)
        pg.screenshot(path=os.path.join(QA, f'design-forum-member{suffix}.png'), full_page=True)
        print(f'artboard → design-forum{suffix}.png · design-forum-member{suffix}.png'); pg.close()

    if a.shots_only:
        browser.close(); sys.exit(0)

    ADMIN, M3, M4 = tok('pjero.bacic'), tok('member003'), tok('member004')
    # mint the codes the ladder needs (adminOnly API)
    s, open1 = api('POST', '/api/v2/forum/invites', ADMIN, {'name': 'QA Forum Ladder'}); assert s == 200, open1
    s, open2 = api('POST', '/api/v2/forum/invites', ADMIN, {'name': 'QA Second Code'}); assert s == 200, open2
    s, exp1 = api('POST', '/api/v2/forum/invites', ADMIN, {'name': 'QA Expired', 'expires_in_days': -1}); assert s == 200, exp1
    CODE, CODE2, EXPIRED = open1['invite']['code'], open2['invite']['code'], exp1['invite']['code']
    # seed one feed post so the featured card has a v2 item too
    api('POST', '/api/v2/forum/feed', ADMIN, {'kind': 'spotlight', 'name': 'Dr. Maja Kovačević', 'role': 'KBC Zagreb · cardiology',
        'body': 'Led the first regional workshop on AI-assisted echocardiography — forty clinicians trained over two days.'})

    def fresh_page(token):
        pg = browser.new_page(viewport={'width': 1280, 'height': 900})
        pg.on('console', lambda m: console.append(f'{m.type}: {m.text}') if m.type == 'error' else None)
        pg.on('pageerror', lambda e: console.append(f'pageerror: {e}'))
        pg.goto(a.base + '/app/auth/welcome', wait_until='load')
        pg.evaluate("t => localStorage.setItem('medx_user_token', t)", token)
        pg.goto(a.base + '/app/forum', wait_until='networkidle'); pg.wait_for_timeout(1200)
        return pg

    # ---- 1 · non-member state ----
    pg = fresh_page(M3)
    view = pg.locator('#view').inner_text()
    check('non-member: stage-1 code entry shown', 'Received an invitation?' in view and pg.locator('[data-role=code]').count() == 1)
    check('non-member: hero CTA = JOIN WITH YOUR CODE', 'JOIN WITH YOUR CODE' in view)
    check('non-member: vote hidden for non-members', 'Where shall the Forum meet' not in view)
    check('non-member: feed renders (forum_news seed)', 'FORUM NEWS' in view)
    check('non-member: schedule + speakers empty state', 'Welcome Reception' in view and 'announced with the program' in view)
    pg.screenshot(path=os.path.join(QA, 'v2-forum-nonmember.png'), full_page=True)
    # hero CTA scrolls to the code input and focuses it
    pg.click('[data-act=join]'); pg.wait_for_timeout(900)
    check('JOIN CTA focuses the code input', pg.evaluate("document.activeElement && document.activeElement.dataset.role === 'code'"))

    # ---- 2 · code redemption ladder ----
    def unlock_with(code):
        pg.fill('[data-role=code]', code); pg.click('[data-act=unlock]'); pg.wait_for_timeout(900)
        err = pg.locator('[data-role=codeError]')
        return err.inner_text() if err.count() and err.is_visible() else ''
    check('redeem: empty → inline error', 'Enter the code' in unlock_with(''))
    check('redeem: unknown → inline error', "isn't valid" in unlock_with('FRM-QQQQ-QQQQ'))
    check('redeem: expired → inline error', 'expired' in unlock_with(EXPIRED))
    # keyboard: Enter in the input submits the form
    pg.fill('[data-role=code]', ''); pg.press('[data-role=code]', 'Enter'); pg.wait_for_timeout(400)
    check('keyboard: Enter in input submits (empty error)', 'Enter the code' in pg.locator('[data-role=codeError]').inner_text())
    check('keyboard: UNLOCK is focusable role=button', pg.locator('[data-act=unlock][role=button][tabindex="0"]').count() == 1)
    # valid — member003 joins
    pg.fill('[data-role=code]', CODE.lower())
    t = do_and_toast(pg, lambda: pg.click('[data-act=unlock]')); pg.wait_for_timeout(1500)
    view = pg.locator('#view').inner_text()
    check('redeem: valid (lowercase ok) → welcome toast', 'welcome to the forum' in t, t)
    check('member state: FORUM MEMBER + welcome + COMPLETE REGISTRATION', 'FORUM MEMBER' in view and 'Welcome to the Forum' in view and pg.locator('[data-act=register]').count() == 1)
    check('member state: renewal line shows a date', 'renews' in view.lower())
    check('member state: vote visible now', 'Where shall the Forum meet in 2027?' in view)
    pg.screenshot(path=os.path.join(QA, 'v2-forum-member.png'), full_page=True)
    # already a member
    check('redeem again → 409 member', api('POST', '/api/v2/forum/redeem-code', M3, {'code': CODE2})[1].get('code') == 'member')
    # used code — member004
    pg4 = fresh_page(M4)
    pg4.click('[data-act=join]'); pg4.wait_for_timeout(700)
    pg4.fill('[data-role=code]', CODE); pg4.click('[data-act=unlock]'); pg4.wait_for_timeout(900)
    check('redeem: used → inline error (second user)', 'already been used' in pg4.locator('[data-role=codeError]').inner_text())
    pg4.close()

    # ---- 3 · gathering registration ----
    pg.click('[data-act=register]'); pg.wait_for_timeout(400)
    modal = pg.locator('.mx-modal')
    check('registration modal opens with annual terms', modal.count() == 1 and 'ANNUAL MEMBERSHIP' in modal.inner_text() and 'renews each year' in modal.inner_text())
    pg.click('.mx-modal-foot .btn-primary'); pg.wait_for_timeout(400)
    check('registration: terms unchecked → inline error', 'accept the annual membership terms' in pg.locator('[data-role=regError]').inner_text())
    pg.check('[data-role=regTerms]'); pg.fill('[data-role=regDiet]', 'Vegetarian')
    t = do_and_toast(pg, lambda: pg.click('.mx-modal-foot .btn-primary')); pg.wait_for_timeout(1600)
    view = pg.locator('#view').inner_text()
    check('registration: confirmed toast', 'confirmed' in t, t)
    check('stage 3: seat confirmed + reference + MY MED&X', 'Your seat is confirmed' in view and 'FORUM-' in view and 'MY MED&X' in view)
    check('stage indicator: two ✓ then CONFIRMED current', view.count('✓') >= 2 and 'CONFIRMED' in view)
    pg.screenshot(path=os.path.join(QA, 'v2-forum-confirmed.png'), full_page=True)
    # keyboard: Escape closes a re-opened modal? (modal gone) — ADD TO CALENDAR downloads .ics
    with pg.expect_download(timeout=5000) as dl: pg.click('[data-act=addCal]')
    check('ADD TO CALENDAR → .ics download', dl.value.suggested_filename.endswith('.ics'), dl.value.suggested_filename)

    # ---- 4 · vote ----
    t = do_and_toast(pg, lambda: pg.click('[data-act=vote][data-choice=split]')); pg.wait_for_timeout(600)
    check('vote: cast → toast + count', 'vote' in t and 'SPLIT' in pg.locator('[data-block=vote]').inner_text())
    n_split = pg.locator('[data-act=vote][data-choice=split]').inner_text()
    pg.click('[data-act=vote][data-choice=zagreb]'); pg.wait_for_timeout(600)
    check('vote: changeable (zagreb selected)', pg.locator('[data-act=vote][data-choice=zagreb][aria-checked=true]').count() == 1, n_split)

    # ---- 5 · feed ----
    check('feed: featured card + grid render', pg.locator('#view').inner_text().count('FORUM NEWS') >= 1 and 'MEMBER SPOTLIGHT' in pg.locator('#view').inner_text())

    # ---- 6 · MESSAGE US routes to /app/messages ----
    pg.click('a[href="/app/messages"]'); pg.wait_for_timeout(800)
    check('MESSAGE US → /app/messages', pg.url.endswith('/app/messages'), pg.url)
    pg.close()

    # ---- 7 · 430px pass (member state) ----
    pm = browser.new_page(viewport={'width': 430, 'height': 930}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pm.on('console', lambda m: console.append(f'[430] {m.type}: {m.text}') if m.type == 'error' else None)
    pm.on('pageerror', lambda e: console.append(f'[430] pageerror: {e}'))
    pm.goto(a.base + '/app/auth/welcome', wait_until='load')
    pm.evaluate("t => localStorage.setItem('medx_user_token', t)", M3)
    pm.goto(a.base + '/app/forum', wait_until='networkidle'); pm.wait_for_timeout(1400)
    check('430: no horizontal scroll', pm.evaluate('document.scrollingElement.scrollWidth') <= 430, pm.evaluate('document.scrollingElement.scrollWidth'))
    check('430: mobile tab bar shown', pm.locator('#mx-tabbar').is_visible())
    pm.screenshot(path=os.path.join(QA, 'v2-forum-430.png'), full_page=True)
    pm.close()
    browser.close()

open(os.path.join(QA, 'console.txt'), 'w').write('\n'.join(console) + '\n')
fails = [n for n, ok in results if not ok]
noise = [c for c in console if 'Failed to load resource' not in c]
print(f'\n{len(results) - len(fails)}/{len(results)} checks passed · console errors: {len(noise)}')
for c in noise[:20]: print('  console:', c)
sys.exit(1 if fails or noise else 0)
