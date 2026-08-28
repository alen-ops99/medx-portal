#!/usr/bin/env python3
"""scripts/qa-me.py — QA for the My Med&X screen group (js/views/me.js), same approach as
scripts/qa-shots.py: artboard vs v2 screenshots (1280px + 430px) into _qa/me/, plus a
functional Playwright pass (--flows) over every wired control.

   MEDX_QA_T_FULL=<jwt of a member with tickets>  MEDX_QA_T_CERT=<jwt of a checked-in member>
   MEDX_QA_T_EMPTY=<jwt of a member with nothing> \
   python3 scripts/qa-me.py [--base http://localhost:8907] [--design ../../design/handoff/member-portal-2026-08-28] [--flows] [--only me]

Console errors are printed and saved to _qa/me/console.txt; --flows exits 1 on any FAIL.
"""
import os, sys, argparse
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

HERE = os.path.dirname(os.path.abspath(__file__))
QA = os.path.join(HERE, '..', '_qa', 'me'); os.makedirs(QA, exist_ok=True)
ap = argparse.ArgumentParser()
ap.add_argument('--base', default='http://localhost:8907')
ap.add_argument('--design', default=os.path.join(HERE, '..', '..', '..', 'design', 'handoff', 'member-portal-2026-08-28'))
ap.add_argument('--only', default='')
ap.add_argument('--flows', action='store_true')
a = ap.parse_args()

T_FULL = os.environ.get('MEDX_QA_T_FULL', '')    # member with tickets (conference + gala)
T_CERT = os.environ.get('MEDX_QA_T_CERT', '')    # checked-in member with a certificate
T_EMPTY = os.environ.get('MEDX_QA_T_EMPTY', '')  # member with nothing (wallet empty state)

ARTBOARDS = [('me', 'My MedX.dc.html'), ('empty-states', 'Empty States.dc.html')]
PAGES = [  # name, url, token, width
    ('me',          '/app/me',              T_FULL, 1280),
    ('me-past',     '/app/me?qa=past',      T_FULL, 1280),
    ('me-qr',       '/app/me?open=qr',      T_FULL, 1280),
    ('me-certs',    '/app/me/certificates', T_CERT, 1280),
    ('me-rewards',  '/app/me/rewards',      T_FULL, 1280),
    ('me-empty',    '/app/me',              T_EMPTY, 1280),
    ('me-430',      '/app/me',              T_FULL, 430),
    ('me-empty-430','/app/me',              T_EMPTY, 430),
]

errors = []
results = []
def check(name, ok, info=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (('  — ' + str(info)) if info else ''))

def sign_in(page, token):
    page.goto(a.base + '/app/auth/welcome', wait_until='load')
    page.evaluate("t => { localStorage.clear(); if (t) localStorage.setItem('medx_user_token', t); }", token)

_last_toast = ['']
def toast(page, tries=45):
    """Return the next NEW toast text (dedup against the previous one, which lingers ~3 s)."""
    for _ in range(tries):
        try: t = page.locator('.mx-toast.show').inner_text(timeout=120)
        except PWTimeout: t = ''
        if t and t != _last_toast[0]:
            _last_toast[0] = t; return t
        page.wait_for_timeout(100)
    return ''

def wire_console(page, tag, negative_ok=False):
    # flows deliberately trigger one 401 (wrong-password check) — filter resource-status logs
    # there, exactly like scripts/qa-flows.py does; the shot passes stay strict.
    def on_console(m):
        if m.type != 'error': return
        if negative_ok and 'Failed to load resource' in m.text: return
        errors.append(f'[{tag}] {m.type}: {m.text}')
    page.on('console', on_console)
    page.on('pageerror', lambda e: errors.append(f'[{tag}] pageerror: {e}'))

with sync_playwright() as pw:
    browser = pw.chromium.launch()

    # ---- artboard shots ----
    for name, f in ARTBOARDS:
        if a.only and a.only not in name: continue
        path = os.path.abspath(os.path.join(a.design, f))
        if not os.path.exists(path): print('skip artboard', f); continue
        page = browser.new_page(viewport={'width': 1280, 'height': 900})
        page.goto('file://' + path.replace(' ', '%20').replace('&', '%26'), wait_until='load')
        page.wait_for_timeout(1200)
        page.screenshot(path=os.path.join(QA, f'design-{name}.png'), full_page=True)
        print('artboard →', f'design-{name}.png')
        page.close()

    # ---- v2 shots (1280 + 430) ----
    for name, url, token, w in PAGES:
        if a.only and a.only not in name: continue
        if not token: print('skip (no token)', name); continue
        kw = {'viewport': {'width': w, 'height': 930}}
        if w <= 500: kw.update({'device_scale_factor': 2, 'is_mobile': True, 'has_touch': True})
        page = browser.new_page(**kw)
        wire_console(page, name)
        sign_in(page, token)
        page.goto(a.base + url, wait_until='networkidle')
        page.wait_for_timeout(2200)
        page.screenshot(path=os.path.join(QA, f'v2-{name}.png'), full_page=True)
        print('v2 →', f'v2-{name}.png')
        page.close()

    # ---- functional pass ----
    if a.flows and T_FULL:
      try:
        ctx = browser.new_context(viewport={'width': 1280, 'height': 930})
        ctx.grant_permissions(['clipboard-read', 'clipboard-write'])
        page = ctx.new_page()
        wire_console(page, 'flows', negative_ok=True)
        sign_in(page, T_FULL)
        page.goto(a.base + '/app/me', wait_until='networkidle'); page.wait_for_timeout(2200)

        v = page.locator('#view')
        check('wallet renders (hero + wallet + record + settings)', all(s in v.inner_text() for s in ['Your membership', 'MY WALLET', 'MY RECORD', 'SETTINGS']))
        check('member QR image loaded on the card', page.evaluate("() => { const i = document.querySelector('[data-block=card] img[alt=\\'Member QR\\']'); return !!i && i.naturalWidth > 0; }"))

        # card flip + present mode
        page.click('[data-block=card]'); page.wait_for_timeout(700)
        check('card flips to the QR back (motto)', 'Jedna karta, sva vrata.' in page.locator('[data-block=card]').inner_text())
        page.click('[data-act=present]'); page.wait_for_timeout(400)
        check('PRESENT opens the full-screen QR', page.locator('.mx-modal img[alt="Member QR"]').count() == 1)
        page.keyboard.press('Escape'); page.wait_for_timeout(300)
        page.click('[data-block=card]'); page.wait_for_timeout(500)

        # keyboard: flip via Enter on the focused card
        page.focus('[data-block=card]'); page.keyboard.press('Enter'); page.wait_for_timeout(700)
        check('keyboard Enter flips the card', 'Jedna karta, sva vrata.' in page.locator('[data-block=card]').inner_text())
        page.keyboard.press('Enter'); page.wait_for_timeout(500)

        # downloads
        with page.expect_download(timeout=8000) as dl: page.click('[data-act=dlCard]')
        check('DOWNLOAD CARD → PDF', dl.value.suggested_filename.endswith('.pdf'), dl.value.suggested_filename)
        page.click('[data-act=cardWallet]'); page.wait_for_timeout(300)
        page.click('.mx-modal-foot [data-act]:has-text("GOOGLE WALLET")')
        t = toast(page); check('ADD TO PHONE WALLET → gate toast', 'wallet keys' in t.lower(), t)
        page.wait_for_timeout(400)

        # per-ticket actions
        with page.expect_download(timeout=8000) as dl: page.click('[data-act=tDl] >> nth=0')
        check('ticket DOWNLOAD → PDF', dl.value.suggested_filename.endswith('.pdf'), dl.value.suggested_filename)
        page.click('[data-act=tEmail] >> nth=0')
        t = toast(page); check('ticket EMAIL → sent toast', 'ticket sent to' in t.lower(), t)
        page.wait_for_timeout(400)
        page.click('[data-act=tWallet] >> nth=0'); page.wait_for_timeout(300)
        page.click('.mx-modal-foot [data-act]:has-text("APPLE WALLET")')
        t = toast(page); check('ticket ADD TO WALLET → gate toast', 'wallet keys' in t.lower(), t)
        page.wait_for_timeout(400)

        # tabs + receipt
        page.click('[data-act=showPast]'); page.wait_for_timeout(400)
        check('PAST PURCHASES tab renders rows', page.locator('[data-act=tReceipt], [data-act=tConfirm]').count() > 0)
        with page.expect_download(timeout=8000) as dl: page.click('[data-act=tReceipt] >> nth=0')
        check('RECEIPT → PDF', dl.value.suggested_filename.endswith('.pdf'), dl.value.suggested_filename)
        page.click('[data-act=showCur]'); page.wait_for_timeout(300)
        check('CURRENT TICKETS tab back', page.locator('[data-act=tDl]').count() > 0)

        # settings — name modal (save the same name back: proves the PUT round-trip idempotently)
        page.click('[data-act=chgName]'); page.wait_for_timeout(300)
        first0 = page.locator('.mx-modal input[name=first]').input_value()
        page.fill('.mx-modal input[name=first]', first0)
        page.click('.mx-modal-foot [data-act]:has-text("SAVE")')
        t = toast(page); check('NAME change → saved toast', 'name updated' in t.lower(), t)
        page.wait_for_timeout(400)

        # settings — email modal (no backend route: modal + toast, MESSAGE US path)
        page.click('[data-act=chgEmail]'); page.wait_for_timeout(300)
        check('EMAIL change → team modal', 'go through the team' in page.locator('.mx-modal').inner_text())
        page.keyboard.press('Escape'); page.wait_for_timeout(300)

        # settings — password modal, wrong current → inline error (1 rate-limited call)
        page.click('[data-act=chgPw]'); page.wait_for_timeout(300)
        page.fill('.mx-modal input[name=cur]', 'definitely-wrong')
        page.fill('.mx-modal input[name=nw]', 'NewPassw0rd!x'); page.fill('.mx-modal input[name=nw2]', 'NewPassw0rd!x')
        page.click('.mx-modal-foot [data-act]:has-text("SAVE")'); page.wait_for_timeout(1500)
        err = page.locator('.mx-modal [data-role=error]').inner_text()
        check('PASSWORD wrong current → inline error', 'incorrect' in err.lower() or 'attempts' in err.lower(), err)
        page.keyboard.press('Escape'); page.wait_for_timeout(300)

        # settings — language switch (HR then back to EN)
        page.click('[data-act=chgLang]'); page.wait_for_timeout(300)
        page.click('.mx-modal [data-lang=hr]')
        t = toast(page); check('LANGUAGE switch → saved toast', 'translations' in t.lower(), t)
        page.wait_for_timeout(400)
        check('LANGUAGE row shows Hrvatski', 'Hrvatski' in page.locator('[data-block=settings]').inner_text())
        page.click('[data-act=chgLang]'); page.wait_for_timeout(300); page.click('.mx-modal [data-lang=en]'); toast(page); page.wait_for_timeout(300)

        # chips — interests add + remove
        page.click('[data-act=intAdd]'); page.wait_for_timeout(300)
        page.click('.mx-modal [data-int] >> nth=0')
        t = toast(page); check('INTERESTS + ADD → saved', 'interests updated' in t.lower(), t)
        page.wait_for_timeout(500)
        n0 = page.locator('[data-act=intRm]').count()
        page.click('[data-act=intRm] >> nth=0'); toast(page); page.wait_for_timeout(600)
        check('INTERESTS × removes the chip', page.locator('[data-act=intRm]').count() == n0 - 1)

        # chips — follows add + remove
        page.click('[data-act=followAdd]'); page.wait_for_timeout(300)
        page.click('.mx-modal [data-follow] >> nth=0')
        t = toast(page); check('PROJECTS I FOLLOW + ADD → saved', 'following updated' in t.lower(), t)
        page.wait_for_timeout(600)
        nf = page.locator('[data-act=followRm]').count()
        page.click('[data-act=followRm] >> nth=0'); toast(page); page.wait_for_timeout(600)
        check('PROJECTS I FOLLOW × removes the chip', page.locator('[data-act=followRm]').count() == nf - 1)

        # rewards tab
        page.click('text=OPEN REWARDS'); page.wait_for_timeout(1800)
        check('OPEN REWARDS → rewards tab', '/app/me/rewards' in page.url and 'POINTS BALANCE' in page.locator('#view').inner_text())
        check('redeem tiers render', page.locator('[data-act=redeem], [aria-disabled=true]').count() >= 3)
        page.go_back(); page.wait_for_timeout(1200)

        page.close()

        # certificates (checked-in member)
        if T_CERT:
            page = ctx.new_page(); wire_console(page, 'certs')
            sign_in(page, T_CERT)
            page.goto(a.base + '/app/me/certificates', wait_until='networkidle'); page.wait_for_timeout(2200)
            check('certificates tab lists a certificate', page.locator('[data-act=certDl]').count() >= 1)
            with page.expect_download(timeout=8000) as dl: page.click('[data-act=certDl] >> nth=0')
            check('certificate DOWNLOAD → PDF', dl.value.suggested_filename.endswith('.pdf'), dl.value.suggested_filename)
            with page.expect_popup(timeout=6000) as pop: page.click('[data-act=certVerify] >> nth=0')
            vp = pop.value; vp.wait_for_load_state(); page.wait_for_timeout(600)
            check('VERIFY LINK → public verify page', 'verify-certificate' in vp.url and 'Verified certificate' in vp.content())
            vp.close()
            page.click('[data-act=certCopy] >> nth=0')
            t = toast(page); check('COPY LINK → toast', 'copied' in t.lower(), t)
            page.close()

        # empty member
        if T_EMPTY:
            page = ctx.new_page(); wire_console(page, 'empty')
            sign_in(page, T_EMPTY)
            page.goto(a.base + '/app/me', wait_until='networkidle'); page.wait_for_timeout(2200)
            txt = page.locator('#view').inner_text()
            check('empty wallet → Empty States block', 'Your wallet is ready for December.' in txt and 'REGISTER FOR PLEXUS' in txt)
            check('empty record shows the artboard copy', 'Your events appear here after you register.' in txt)
            page.click('[data-act=showPast]'); page.wait_for_timeout(400)
            check('empty past tab → empty voice', 'No purchases yet.' in page.locator('#view').inner_text())
            page.close()
      except Exception as e:
        import traceback; traceback.print_exc()
        check('flows completed without an exception', False, e)
      finally:
        ctx.close()

    browser.close()

open(os.path.join(QA, 'console.txt'), 'w').write('\n'.join(errors) + '\n')
print('\nconsole errors:', len(errors)); [print(' ', e) for e in errors[:40]]
if a.flows:
    fails = [n for n, ok in results if not ok]
    print(f'\n{len(results) - len(fails)}/{len(results)} checks passed' + (f' — FAILS: {fails}' if fails else ''))
    sys.exit(1 if fails or errors else 0)
