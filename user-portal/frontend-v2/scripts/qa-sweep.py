#!/usr/bin/env python3
"""scripts/qa-sweep.py — "does every button work?" sweep over the whole member portal v2.

  MEDX_QA_EMAIL=member003@staging.medx.hr MEDX_QA_PASSWORD='Plexus2026!' \
  python3 scripts/qa-sweep.py --base https://medx-member-portal-v2.netlify.app --out _qa/sweep/REPORT.md

For every route it: loads the screen (waiting out the staging "waking" overlay), records console
errors / page errors / failed API responses, then clicks EVERY visible control
([data-act], [data-nav], button, a[href], [role=button]) and classifies the effect:
  NAV (url changed) · MODAL (dialog opened, then closed) · TOAST "<text>" · DOWNLOAD · DOM (screen re-rendered)
  · NET (API call fired) · EXTERNAL (left as link, not clicked) · MAILTO (flagged: design forbids)
  · NO EFFECT (nothing observable) · EMPTY TOAST (toast with no text) · ERROR (click threw)
Destructive-looking controls (sign out, delete, remove, cancel…) are skipped unless --destructive.
Chrome controls (top bar, drawer) are swept once, on /app/home. A 430 px pass checks each route
for horizontal overflow and the bottom tab bar. Exit code 1 when any NO EFFECT / EMPTY TOAST /
MAILTO / console error / 5xx is found. Output: a Markdown report + one screenshot per route.
"""
import os, sys, re, time, argparse, hashlib, json
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

ap = argparse.ArgumentParser()
ap.add_argument('--base', default='http://localhost:8890')
ap.add_argument('--out', default='_qa/sweep/REPORT.md')
ap.add_argument('--routes', default='')
ap.add_argument('--max-per-route', type=int, default=90)
ap.add_argument('--destructive', action='store_true')
ap.add_argument('--no-mobile', action='store_true')
a = ap.parse_args()

EMAIL = os.environ.get('MEDX_QA_EMAIL', 'member003@staging.medx.hr')
PASSWORD = os.environ.get('MEDX_QA_PASSWORD', 'Plexus2026!')
B = a.base.rstrip('/')
ROUTES = [r for r in a.routes.split(',') if r] or [
    '/app/home', '/app/plexus', '/app/plexus/program', '/app/plexus/zagreb', '/app/plexus/mine',
    '/app/gala', '/app/accelerator', '/app/accelerator/apply?preview=1', '/app/forum', '/app/bridges',
    '/app/network', '/app/messages', '/app/profile', '/app/me', '/app/me/certificates',
    '/app/mentorship', '/app/opportunities', '/app/projects',
]
SEL = '[data-act], [data-nav], button, a[href], [role=button]'
CHROME = '#mx-desktop-chrome, #mx-mobile-chrome, .mx-drawer, .mx-scrim, .mx-pop, .mx-search'
DESTRUCTIVE = re.compile(r'sign ?out|log ?out|delete|remove|cancel|unsubscribe|decline|withdraw|revoke|leave', re.I)
out_dir = os.path.dirname(a.out) or '.'
os.makedirs(out_dir, exist_ok=True)

rows = []          # (route, label, kind, effect, detail)
route_meta = {}    # route -> dict(console=[], failed=[], controls=n)
summary = dict(controls=0, ok=0, no_effect=0, empty_toast=0, mailto=0, external=0, errors=0, console=0, failed5xx=0, failed4xx=0)

def dom_hash(page):
    try:
        return page.evaluate("() => { const v = document.querySelector('#view') || document.body; return v.innerHTML.length + ':' + v.innerText.slice(0, 4000); }")
    except Exception:
        return ''

def wait_awake(page, max_s=200):
    t0 = time.time()
    while time.time() - t0 < max_s:
        try:
            if page.locator('.mx-waking').count() == 0 or not page.locator('.mx-waking').first.is_visible():
                return True
        except Exception:
            return True
        page.wait_for_timeout(2000)
    return False

def settle(page, ms=900):
    try: page.wait_for_load_state('networkidle', timeout=8000)
    except PWTimeout: pass
    page.wait_for_timeout(ms)

def close_modal(page):
    try:
        if page.locator('.mx-modal').count():
            btn = page.locator('.mx-modal [data-act=close]')
            if btn.count(): btn.first.click(timeout=1500)
            else: page.keyboard.press('Escape')
            page.wait_for_timeout(300)
            return True
    except Exception:
        try: page.keyboard.press('Escape')
        except Exception: pass
    return False

def toast_text(page):
    try:
        if page.locator('.mx-toast.show').count():
            return page.locator('.mx-toast.show').first.inner_text(timeout=300).strip()
    except Exception:
        pass
    return None

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    ctx = browser.new_context(viewport={'width': 1280, 'height': 900}, accept_downloads=True)
    page = ctx.new_page()
    console = []
    failed = []
    net_counter = {'n': 0}
    page.on('console', lambda m: console.append(f'{m.type}: {m.text}') if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    page.on('pageerror', lambda e: console.append(f'pageerror: {e}'))
    def on_response(res):
        try:
            u = res.url
            if '/api/' in u or '/__admin/' in u:
                net_counter['n'] += 1
                if res.status >= 400: failed.append((res.status, res.request.method, u))
        except Exception: pass
    page.on('response', on_response)

    # ── login once ──
    page.goto(B + '/app/auth/signin', wait_until='domcontentloaded'); wait_awake(page); settle(page)
    try:
        page.fill('input[name=email]', EMAIL); page.fill('input[name=password]', PASSWORD); page.press('input[name=password]', 'Enter')
        t0 = time.time(); logged_in = False
        while time.time() - t0 < 240:            # survives a staging cold start (~2 min)
            wait_awake(page, 30); page.wait_for_timeout(1000)
            if '/app/auth' not in page.url: logged_in = True; break
            err = page.locator('[data-role=error]')
            if err.count() and err.first.inner_text().strip(): print('sign-in error: ' + err.first.inner_text().strip()); break
        settle(page, 1500)
    except Exception as e:
        logged_in = False
    print(('LOGIN OK ' if logged_in else 'LOGIN FAILED ') + page.url)
    if not logged_in:
        print('cannot continue without a session'); sys.exit(2)

    # ── desktop sweep ──
    for idx, route in enumerate(ROUTES):
        console.clear(); failed.clear()
        page.goto(B + route, wait_until='domcontentloaded'); wait_awake(page); settle(page, 1200)
        try: page.screenshot(path=os.path.join(out_dir, re.sub(r'[^a-z0-9]+', '-', route.lower()).strip('-') + '.png'), full_page=True)
        except Exception: pass
        base_url = page.url
        only_chrome_here = idx == 0
        seen = set(); n_controls = 0
        i = 0
        while i < a.max_per_route:
            els = page.locator(SEL)
            count = els.count()
            if i >= count: break
            el = els.nth(i); i += 1
            try:
                if not el.is_visible(): continue
                in_chrome = el.evaluate("(e, sel) => !!e.closest(sel)", CHROME)
                if in_chrome and not only_chrome_here: continue
                label = (el.get_attribute('data-act') or el.get_attribute('data-nav') or el.get_attribute('aria-label') or el.inner_text(timeout=500) or el.get_attribute('href') or '').strip().replace('\n', ' ')[:60]
                href = el.get_attribute('href') or ''
                tag = el.evaluate('e => e.tagName.toLowerCase()')
            except Exception:
                continue
            key = (label, href, tag)
            if key in seen: continue
            seen.add(key); n_controls += 1; summary['controls'] += 1
            kind = 'act' if el.get_attribute('data-act') else 'nav' if el.get_attribute('data-nav') else tag
            # classify links without clicking when external / mailto
            if href.startswith('mailto:'):
                rows.append((route, label, kind, 'MAILTO', href)); summary['mailto'] += 1; continue
            if href.startswith('http') and urlparse(href).netloc != urlparse(B).netloc:
                rows.append((route, label, kind, 'EXTERNAL', href)); summary['external'] += 1; continue
            if DESTRUCTIVE.search(label) and not a.destructive:
                rows.append((route, label, kind, 'SKIPPED (destructive)', '')); continue
            before_url = page.url; before_dom = dom_hash(page); before_net = net_counter['n']; before_toast = toast_text(page)
            effect = None; detail = ''
            try:
                with page.expect_download(timeout=1500) as dl_info:
                    el.click(timeout=3000)
                d = dl_info.value; effect = 'DOWNLOAD'; detail = d.suggested_filename
            except PWTimeout:
                pass
            except Exception as e:
                effect = 'ERROR'; detail = str(e).split('\n')[0][:120]; summary['errors'] += 1
            page.wait_for_timeout(700)
            if effect is None:
                t = toast_text(page)
                if page.url != before_url:
                    effect = 'NAV'; detail = page.url.replace(B, '')
                elif page.locator('.mx-modal').count():
                    effect = 'MODAL'; close_modal(page)
                elif t is not None and t != before_toast:
                    if t == '': effect = 'EMPTY TOAST'; summary['empty_toast'] += 1
                    else: effect = 'TOAST'; detail = t[:100]
                elif net_counter['n'] > before_net:
                    effect = 'NET'; detail = f'{net_counter["n"] - before_net} call(s)'
                elif dom_hash(page) != before_dom:
                    effect = 'DOM'
                else:
                    effect = 'NO EFFECT'; summary['no_effect'] += 1
            if effect in ('NAV', 'MODAL', 'TOAST', 'DOWNLOAD', 'NET', 'DOM'): summary['ok'] += 1
            rows.append((route, label, kind, effect, detail))
            if effect == 'NAV' and page.url != base_url:
                page.goto(B + route, wait_until='domcontentloaded'); wait_awake(page); settle(page, 600)
        route_meta[route] = dict(console=list(console), failed=list(failed), controls=n_controls)
        summary['console'] += len(console)
        summary['failed5xx'] += sum(1 for f in failed if f[0] >= 500)
        summary['failed4xx'] += sum(1 for f in failed if 400 <= f[0] < 500)
        print(f'{route:34s} controls={n_controls:3d} console={len(console)} failed={len(failed)}')

    # ── mobile pass ──
    mobile = []
    if not a.no_mobile:
        page.set_viewport_size({'width': 430, 'height': 900})
        for route in ROUTES:
            page.goto(B + route, wait_until='domcontentloaded'); wait_awake(page); settle(page, 800)
            try:
                overflow = page.evaluate('() => document.documentElement.scrollWidth - window.innerWidth')
                tabbar = page.locator('#mx-mobile-chrome, .mx-tabbar, [data-role=tabbar]').count() > 0
            except Exception:
                overflow, tabbar = -1, False
            mobile.append((route, overflow, tabbar))
            try: page.screenshot(path=os.path.join(out_dir, re.sub(r'[^a-z0-9]+', '-', route.lower()).strip('-') + '-430.png'), full_page=True)
            except Exception: pass
    browser.close()

# ── report ──
L = [f'# Member portal v2 — button sweep', '', f'Base: {B} · account: {EMAIL} · {time.strftime("%Y-%m-%d %H:%M:%S")}', '',
     '| controls | working | no effect | empty toast | mailto | external | click errors | console errors | API 5xx | API 4xx |', '|---|---|---|---|---|---|---|---|---|---|',
     f"| {summary['controls']} | {summary['ok']} | {summary['no_effect']} | {summary['empty_toast']} | {summary['mailto']} | {summary['external']} | {summary['errors']} | {summary['console']} | {summary['failed5xx']} | {summary['failed4xx']} |", '']
for route in ROUTES:
    m = route_meta.get(route, {})
    L += [f'## {route}', '', f"controls: {m.get('controls', 0)} · console errors: {len(m.get('console', []))} · failed API: {len(m.get('failed', []))}", '']
    if m.get('console'): L += ['```', *m['console'][:20], '```', '']
    if m.get('failed'): L += ['Failed API responses:', *[f'- {s} {meth} {u}' for s, meth, u in m['failed'][:30]], '']
    L += ['| control | kind | effect | detail |', '|---|---|---|---|']
    for r in rows:
        if r[0] == route: L.append(f'| {r[1].replace("|", "/")} | {r[2]} | {r[3]} | {str(r[4]).replace("|", "/")} |')
    L.append('')
if mobile:
    L += ['## 430 px pass', '', '| route | horizontal overflow (px) | tab bar |', '|---|---|---|', *[f'| {r} | {o} | {"yes" if t else "NO"} |' for r, o, t in mobile], '']
open(a.out, 'w').write('\n'.join(L))
print(f"wrote {a.out}: {summary}")
bad = summary['no_effect'] + summary['empty_toast'] + summary['mailto'] + summary['console'] + summary['failed5xx'] + summary['errors']
sys.exit(1 if bad else 0)
