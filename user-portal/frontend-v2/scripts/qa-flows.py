#!/usr/bin/env python3
"""scripts/qa-flows.py — functional pass over the built screens against a live backend.
   MEDX_QA_EMAIL=… MEDX_QA_PASSWORD=… python3 scripts/qa-flows.py [--base http://localhost:8890] [--wake-base http://localhost:8891]
Prints PASS/FAIL per check; exits 1 on any FAIL. Uses ≤5 rate-limited auth calls."""
import os, sys, time, argparse, json
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout
ap = argparse.ArgumentParser(); ap.add_argument('--base', default='http://localhost:8890'); ap.add_argument('--wake-base', default=''); ap.add_argument('--wake-only', action='store_true'); a = ap.parse_args()
EMAIL = os.environ.get('MEDX_QA_EMAIL', 'qa.v2+home@example.com'); PASSWORD = os.environ.get('MEDX_QA_PASSWORD', 'Passw0rd!x')
results = []; console = []
def check(name, ok, info=''): results.append((name, bool(ok), info)); print(('PASS ' if ok else 'FAIL ') + name + (('  — ' + str(info)) if info else ''))
_last_toast = ['']
def toast_text(page):
    for _ in range(40):
        try: t = page.locator('.mx-toast.show').inner_text(timeout=200)
        except PWTimeout: t = ''
        if t and t != _last_toast[0]: _last_toast[0] = t; return t.lower()
        page.wait_for_timeout(100)
    return ''
with sync_playwright() as pw:
    b = pw.chromium.launch(); ctx = b.new_context(viewport={'width': 1280, 'height': 900}); page = ctx.new_page()
    page.on('console', lambda m: console.append(f'{m.type}: {m.text}') if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    page.on('pageerror', lambda e: console.append(f'pageerror: {e}'))
    B = a.base
    if a.wake_only: results_skip = True
    # 1–2 guards
    if not a.wake_only:
        page.goto(B + '/', wait_until='networkidle'); check('guest / → welcome', page.url.endswith('/app/auth/welcome'), page.url)
        page.goto(B + '/app/gala', wait_until='networkidle'); check('guest /app/gala → signin?next', '/app/auth/signin?next=%2Fapp%2Fgala' in page.url, page.url)
        page.goto(B + '/app/auth/signin', wait_until='networkidle')
        # 3 wrong password (1 auth call)
        page.fill('input[name=email]', EMAIL); page.fill('input[name=password]', 'wrong-password'); page.click('[data-act=signin]')
        page.wait_for_timeout(1500); err = page.locator('[data-role=error]').inner_text(); check('sign-in wrong password → inline error', "don't match" in err or 'attempts' in err.lower(), err)
        # 4 correct login (1 auth call) → next honoured
        page.fill('input[name=password]', PASSWORD); page.press('input[name=password]', 'Enter')
        page.wait_for_url('**/app/home', timeout=15000); page.wait_for_timeout(1500)
        check('sign-in → /app/home (Enter submits)', page.url.endswith('/app/home'))
        check('chrome identity shows name', 'Juginović' in page.locator('#mx-desktop-chrome').inner_text())
        check('greeting uses first name', 'Alen' in page.locator('[data-screen-label=Home]').inner_text())
        check('stats strip has MEMBER SINCE year', '2026' in page.locator('.mx-stats').inner_text())
        check('countdown filled', page.locator('[data-cd=days]').inner_text().strip() not in ('', '—'))
        # 5 getting started dismiss persists
        page.click('[data-act=hideStart]'); page.wait_for_timeout(300); page.reload(wait_until='networkidle'); page.wait_for_timeout(800)
        check('GETTING STARTED dismissed persists', page.locator('[data-block=start]').inner_text().strip() == '')
        # 6 ADD → .ics download
        with page.expect_download(timeout=5000) as dl: page.click('[data-act=dlIcs]')
        d = dl.value; check('KEY DATES ADD → .ics download', d.suggested_filename.endswith('.ics'), d.suggested_filename); toast_text(page)  # consume the download toast
        # 7 newsletter subscribe → notify-topics
        page.click('[data-act=nlSub]'); t = toast_text(page); check('SUBSCRIBE → toast', 'subscribed' in t, t)
        page.wait_for_timeout(800); check('SUBSCRIBED state shown', 'SUBSCRIBED' in page.locator('[data-block=newsletter]').inner_text())
        page.wait_for_timeout(1200); check('FOLLOWING count live (5 after ALL)', '5' in page.locator('.mx-stats').inner_text().split('FOLLOWING')[0][-4:], page.locator('.mx-stats').inner_text())
        # 8 see all
        n0 = page.locator('[data-block=latest] a').count(); page.click('[data-act=seeAll]'); page.wait_for_timeout(200); n1 = page.locator('[data-block=latest] a').count()
        check('SEE ALL expands the list', n1 > n0, f'{n0}→{n1}')
        # 9 search
        page.click('[data-act=search]'); page.fill('[data-role=q]', 'plexus'); page.wait_for_timeout(900)
        check('SEARCH results', 'Plexus Conference 2026' in page.locator('[data-role=results]').inner_text())
        page.click('[data-act=openResult]'); page.wait_for_timeout(600); check('search result → /app/plexus', '/app/plexus' in page.url, page.url)
        check('stub screen renders title', 'Plexus' in page.locator('#view').inner_text())
        # 10 alerts
        page.click('[data-act=alerts]'); page.wait_for_timeout(900); pop = page.locator('.mx-pop').inner_text().lower(); check('ALERTS panel opens (empty state or rows)', 'quiet' in pop or page.locator('.mx-pop [data-act=openAlert]').count() > 0)
        page.keyboard.press('Escape')
        # 11 drawer
        page.click('[data-act=tg]'); page.wait_for_timeout(700); check('drawer opens', page.evaluate("document.body.classList.contains('drawer-open')"))
        page.click('#mx-drawer a:has-text("Gala Evening")'); page.wait_for_timeout(700)
        check('drawer link → /app/gala', page.url.endswith('/app/gala'), page.url)
        check('drawer closes after nav', not page.evaluate("document.body.classList.contains('drawer-open')"))
        check('active item = Gala (gold border)', 'border-left:2px solid #c9a962' in (page.locator('#mx-drawer a:has-text("Gala Evening")').get_attribute('style') or ''))
        # 12 HR toast
        page.click('#mx-desktop-chrome [data-act=hr]'); t = toast_text(page); check('EN · HR → toast', 'croatian' in t, t)
        # 13 hashes
        page.goto(B + '/#gala', wait_until='networkidle'); check('#gala → /app/gala', page.url.endswith('/app/gala'), page.url)
        page.goto(B + '/#up-section-mymedx', wait_until='networkidle'); check('#up-section-mymedx → /app/me', page.url.endswith('/app/me'), page.url)
        # 14 payment return
        page.goto(B + '/?payment=success&gala=abc', wait_until='networkidle'); t = toast_text(page); check('?payment=success&gala → toast + /app/me', 'gala' in t and page.url.endswith('/app/me'), f'{t} | {page.url}')
        page.goto(B + '/?payment=cancelled&reg=1', wait_until='networkidle'); t = toast_text(page); check('?payment=cancelled&reg → /app/plexus/mine', 'cancelled' in t.lower() and page.url.endswith('/app/plexus/mine'), f'{t} | {page.url}')
        # 15 verified
        page.goto(B + '/?verified=true', wait_until='networkidle'); t = toast_text(page); page.wait_for_timeout(500)
        check('?verified=true → toast + banner gone', 'confirmed' in t.lower() and page.locator('[data-role=banner]').count() == 0, t)
        # 16 404
        page.goto(B + '/app/nowhere', wait_until='networkidle'); check('404 view', 'guest list' in page.locator('#view').inner_text())
        # 17 mobile tabs
        m = ctx.new_page(); m.set_viewport_size({'width': 430, 'height': 930}); m.goto(B + '/app/home', wait_until='networkidle'); m.wait_for_timeout(800)
        check('mobile: tab bar visible', m.locator('#mx-tabbar').is_visible()); check('mobile: desktop chrome hidden', not m.locator('#mx-desktop-chrome').is_visible())
        m.click('#mx-tabbar a:has-text("PROJECTS")'); m.wait_for_timeout(700); check('mobile: PROJECTS tab → /app/projects', m.url.endswith('/app/projects'), m.url)
        m.goto(B + '/app/gala', wait_until='networkidle'); m.wait_for_timeout(500); check('mobile: back arrow on sub-view', m.locator('#mx-mobile-top [data-act=back]').count() == 1)
        m.close()
        # 18 sign-out via ?logout=true and 401 handling
        page.goto(B + '/?logout=true', wait_until='networkidle'); check('?logout=true → welcome', page.url.endswith('/app/auth/welcome'), page.url)
        page.evaluate("localStorage.setItem('medx_user_token','bogus.token.value'); localStorage.setItem('medx_user_data', JSON.stringify({id:'x',email:'x@x',first_name:'X'}))")
        page.goto(B + '/app/home', wait_until='networkidle'); page.wait_for_timeout(1200)
        check('401 → session cleared + signin?next', '/app/auth/signin' in page.url and 'next=' in page.url and page.evaluate("localStorage.getItem('medx_user_token')") is None, page.url)
        # 19 sign-up (1 auth call) → verify → continue
        new_email = f'qa.v2+t{int(time.time())}@example.com'
        page.goto(B + '/app/auth/signup', wait_until='networkidle')
        page.click('[data-act=signup]'); page.wait_for_timeout(300); check('signup validation (empty first name)', 'first name' in page.locator('[data-role=error]').inner_text().lower())
        page.fill('input[name=first_name]', 'Test'); page.fill('input[name=last_name]', 'Vuković'); page.fill('input[name=email]', new_email); page.fill('input[name=password]', 'Passw0rd!x'); page.fill('input[name=country]', 'Croatia')
        page.click('[data-act=signup]'); page.wait_for_timeout(300); check('signup validation (terms)', 'terms' in page.locator('[data-role=error]').inner_text().lower())
        page.click('[data-act=tgTerms]'); page.click('[data-act=signup]'); page.wait_for_url('**/app/auth/verify', timeout=15000); page.wait_for_timeout(600)
        check('signup → verify step shows email', new_email in page.locator('#view').inner_text())
        check('verify step: dev link surfaced (no mail provider)', 'confirm now' in page.locator('#view').inner_text())
        page.click('a:has-text("CONTINUE TO MED&X")'); page.wait_for_url('**/app/home', timeout=15000); page.wait_for_timeout(1500)
        check('continue → home with banner for new email', new_email in page.locator('#mx-desktop-chrome').inner_text())
        check('new member: GETTING STARTED 2 steps', '2 STEPS LEFT' in page.locator('[data-block=start]').inner_text())
        page.click('[data-role=banner] [data-act=resend]'); t = toast_text(page); check('banner RESEND LINK → toast', len(t) > 0, t)
        # 20 reset (1 auth call) + forum code (gap endpoint)
        page.goto(B + '/?logout=true', wait_until='networkidle'); page.goto(B + '/app/auth/reset', wait_until='networkidle')
        page.click('[data-act=sendReset]'); page.wait_for_timeout(200); check('reset validation', 'valid email' in page.locator('[data-role=error]').inner_text().lower())
        page.fill('input[name=email]', EMAIL); page.press('input[name=email]', 'Enter'); page.wait_for_timeout(1500)
        check('reset → LINK SENT ✓ state', 'LINK SENT' in page.locator('#view').inner_text())
        page.goto(B + '/app/auth/forum-code', wait_until='networkidle'); page.fill('input[name=code]', 'FRM-TEST-0000'); page.click('[data-act=verifyCode]'); page.wait_for_timeout(1200)
        check('forum code → not-connected notice (404 endpoint)', 'not connected' in page.locator('[data-role=error]').inner_text().lower(), page.locator('[data-role=error]').inner_text())
        page.goto(B + '/app/auth/signin?notice=verified', wait_until='networkidle'); check('signin notice=verified line', 'Email confirmed' in page.locator('#view').inner_text())
        # 21 keyboard: Tab to MENU span and press Enter → drawer
        page.evaluate("localStorage.setItem('medx_user_token', %s)" % json.dumps(os.environ.get('MEDX_QA_TOKEN', '')))
        page.goto(B + '/app/home', wait_until='networkidle'); page.wait_for_timeout(1000)
        page.focus('[data-act=tg]'); page.keyboard.press('Enter'); page.wait_for_timeout(700); check('keyboard Enter on MENU span opens drawer', page.evaluate("document.body.classList.contains('drawer-open')"))
        page.keyboard.press('Escape'); page.wait_for_timeout(700); check('Escape closes drawer', not page.evaluate("document.body.classList.contains('drawer-open')"))
    # 22 waking overlay
    if a.wake_base:
        w = ctx.new_page(); w.goto(a.wake_base + '/app/auth/welcome', wait_until='load')
        w.evaluate("([t,u]) => { localStorage.setItem('medx_user_token', t); localStorage.setItem('medx_user_data', u); }", [os.environ.get('MEDX_QA_TOKEN', ''), os.environ.get('MEDX_QA_USER', '{}')])
        w.goto(a.wake_base + '/app/home', wait_until='load'); w.wait_for_timeout(1500)
        check('503 waking → overlay shown', w.locator('.mx-waking').count() == 1)
        try:
            w.wait_for_selector('.mx-waking', state='detached', timeout=30000); w.wait_for_timeout(1500)
            check('overlay hides + Home renders after wake', 'Alen' in w.locator('#view').inner_text())
        except PWTimeout: check('overlay hides + Home renders after wake', False, 'overlay never cleared')
        w.close()
    b.close()
bad = [r for r in results if not r[1]]
print(f'\n{len(results) - len(bad)}/{len(results)} checks passed; console errors: {len(console)}'); [print('  console:', c) for c in console[:20]]
sys.exit(1 if bad or console else 0)
