#!/usr/bin/env python3
"""scripts/qa-admin-sweep-final.py — "does every button work?" sweep over the ADMIN portal v2.

  MEDX_QA_TOKEN=<admin jwt> MEDX_QA_USER='<json user>' \
  python3 scripts/qa-admin-sweep-final.py --base http://localhost:8911 --out _qa/e2e-final/SWEEP.md

Adapted from user-portal/frontend-v2/scripts/qa-sweep.py for the admin chrome:
  - session by localStorage injection (medx_token + medx_user) — no UI login (15/15min rate limit);
  - admin chrome lives in header#chrome + #chrome-overlays (popovers), view in main#view;
  - waking overlay .mx-waking, toasts .mx-toast.show, modals .mx-modal (same as member);
  - destructive-labelled controls skipped (sign out/delete/remove/cancel/revoke/unpublish/reset…)
    plus approve/send-labelled outbox controls (mass state changes on seeded pending batches —
    the approve path is exercised separately on a purpose-made batch in the E2E run);
  - 4xx on empty-field validation probes is acceptable; any 5xx or console error = FAIL.
Effects: NAV · MODAL · TOAST "<text>" · DOWNLOAD · NET · DOM · EXTERNAL · DISABLED · SKIPPED ·
NO EFFECT · EMPTY TOAST · ERROR. Exit 1 on NO EFFECT / EMPTY TOAST / console error / 5xx / click error.
"""
import os, sys, re, time, argparse, json
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

ap = argparse.ArgumentParser()
ap.add_argument('--base', default='http://localhost:8911')
ap.add_argument('--out', default='_qa/e2e-final/SWEEP.md')
ap.add_argument('--routes', default='')
ap.add_argument('--max-per-route', type=int, default=70)
a = ap.parse_args()

TOKEN = os.environ.get('MEDX_QA_TOKEN', '')
USER = os.environ.get('MEDX_QA_USER', '{}')
if not TOKEN: print('MEDX_QA_TOKEN required'); sys.exit(2)
B = a.base.rstrip('/')
ROUTES = [r for r in a.routes.split(',') if r] or [
    '/today', '/projects/plexus', '/projects/accelerator', '/projects/forum', '/projects/bridges',
    '/inbox', '/people', '/money', '/calendar', '/event-day', '/settings', '/studio',
    '/gala', '/registrations', '/links', '/member-pages', '/accelerator-review',
]
SEL = '[data-act], [data-nav], button, a[href], [role=button]'
CHROME = '#chrome, #chrome-overlays'
DESTRUCTIVE = re.compile(r'sign ?out|log ?out|delete|remove|cancel|unsubscribe|decline|withdraw|revoke|leave|unpublish|reset|clear|deactivate|pause|unassign|archive', re.I)
MASS_SEND = re.compile(r'approve|send now|send$|send \d|mark paid|admit', re.I)
out_dir = os.path.dirname(a.out) or '.'
os.makedirs(out_dir, exist_ok=True)

rows = []; route_meta = {}
summary = dict(controls=0, ok=0, no_effect=0, empty_toast=0, mailto=0, external=0, errors=0, console=0, failed5xx=0, failed4xx=0, skipped=0)

def dom_hash(page):
    try: return page.evaluate("() => document.body.innerHTML.length + ':' + ((document.querySelector('#view')||document.body).innerText.length)")
    except Exception: return ''

def reset_overlays(page):
    try:
        for _ in range(3):
            if page.locator('.mx-modal').count(): close_modal(page); continue
            if page.evaluate("() => !!document.querySelector('#chrome-overlays .mx-pop, #chrome-overlays [class*=pop]')"):
                page.keyboard.press('Escape'); page.wait_for_timeout(200)
                page.mouse.click(4, 500); page.wait_for_timeout(250); continue
            return
    except Exception: pass

def wait_awake(page, max_s=200):
    t0 = time.time()
    while time.time() - t0 < max_s:
        try:
            if page.locator('.mx-waking').count() == 0 or not page.locator('.mx-waking').first.is_visible(): return True
        except Exception: return True
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
            page.wait_for_timeout(300); return True
    except Exception:
        try: page.keyboard.press('Escape')
        except Exception: pass
    return False

def toast_text(page):
    try:
        if page.locator('.mx-toast.show').count():
            return page.locator('.mx-toast.show').first.inner_text(timeout=300).strip()
    except Exception: pass
    return None

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    ctx = browser.new_context(viewport={'width': 1280, 'height': 900}, accept_downloads=True)
    page = ctx.new_page()
    console = []; failed = []; net_counter = {'n': 0}
    page.on('console', lambda m: console.append(f'{m.type}: {m.text}') if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    page.on('pageerror', lambda e: console.append(f'pageerror: {e}'))
    def on_response(res):
        try:
            u = res.url
            if '/api/' in u:
                net_counter['n'] += 1
                if res.status >= 400: failed.append((res.status, res.request.method, u))
        except Exception: pass
    page.on('response', on_response)

    page.goto(B + '/', wait_until='domcontentloaded'); wait_awake(page); settle(page)
    page.evaluate("(kv)=>{for(const k in kv) localStorage.setItem(k,kv[k])}", {'medx_token': TOKEN, 'medx_user': USER})
    page.goto(B + '/today', wait_until='domcontentloaded'); wait_awake(page); settle(page, 1500)
    if '/signin' in page.url: print('token rejected'); sys.exit(2)
    print('SESSION OK', page.url)

    for idx, route in enumerate(ROUTES):
        console.clear(); failed.clear()
        page.goto(B + route, wait_until='domcontentloaded'); wait_awake(page); settle(page, 1400)
        try: page.screenshot(path=os.path.join(out_dir, 'sweep-' + re.sub(r'[^a-z0-9]+', '-', route.lower()).strip('-') + '.png'), full_page=True)
        except Exception: pass
        base_url = page.url
        only_chrome_here = idx == 0
        seen = set(); n_controls = 0; i = 0
        while i < a.max_per_route:
            els = page.locator(SEL)
            try: count = els.count()
            except Exception: break
            if i >= count: break
            el = els.nth(i); i += 1
            try:
                if not el.is_visible(): continue
                if el.get_attribute('aria-hidden') == 'true': continue
                in_chrome = el.evaluate("(e, sel) => !!e.closest(sel)", CHROME)
                if in_chrome and not only_chrome_here: continue
                label = (el.get_attribute('data-act') or el.get_attribute('data-nav') or el.get_attribute('aria-label') or el.inner_text(timeout=500) or el.get_attribute('href') or '').strip().replace('\n', ' ')[:60]
                href = el.get_attribute('href') or ''
                tag = el.evaluate('e => e.tagName.toLowerCase()')
            except Exception: continue
            key = (label, href, tag)
            if key in seen: continue
            seen.add(key); n_controls += 1; summary['controls'] += 1
            kind = 'act' if el.get_attribute('data-act') else 'nav' if el.get_attribute('data-nav') else tag
            if href.startswith('mailto:'):
                rows.append((route, label, kind, 'MAILTO', href)); summary['mailto'] += 1; continue
            if href.startswith('http') and urlparse(href).netloc != urlparse(B).netloc:
                rows.append((route, label, kind, 'EXTERNAL', href)); summary['external'] += 1; continue
            if DESTRUCTIVE.search(label) or MASS_SEND.search(label):
                rows.append((route, label, kind, 'SKIPPED (destructive/mass-send)', '')); summary['skipped'] += 1; continue
            try:
                box = el.bounding_box()
            except Exception: box = None
            if not box or box['width'] < 2 or box['height'] < 2 or box['x'] + box['width'] <= 0 or box['y'] + box['height'] <= 0: continue
            before_url = page.url; before_dom = dom_hash(page); before_net = net_counter['n']; before_toast = toast_text(page)
            effect = None; detail = ''
            downloads = []
            handler = lambda d: downloads.append(d)
            page.on('download', handler)
            try:
                if el.get_attribute('disabled') is not None or el.get_attribute('aria-disabled') == 'true':
                    rows.append((route, label, kind, 'DISABLED (by design)', '')); continue
            except Exception: pass
            try:
                el.click(timeout=3500)
            except PWTimeout:
                try: el.click(timeout=3000, force=True)
                except Exception: effect = 'BLOCKED'; detail = 'click not actionable'; summary['errors'] += 1
            except Exception as e:
                effect = 'ERROR'; detail = str(e).split('\n')[0][:120]; summary['errors'] += 1
            if effect is None:
                for _ in range(8):
                    page.wait_for_timeout(200)
                    t = toast_text(page)
                    if downloads: effect = 'DOWNLOAD'; detail = downloads[0].suggested_filename; break
                    if page.url != before_url: effect = 'NAV'; detail = page.url.replace(B, ''); break
                    if page.locator('.mx-modal').count(): effect = 'MODAL'; break
                    if t is not None and t != before_toast:
                        if t == '': effect = 'EMPTY TOAST'; summary['empty_toast'] += 1
                        else: effect = 'TOAST'; detail = t[:100]
                        break
                if effect is None:
                    if net_counter['n'] > before_net: effect = 'NET'; detail = f'{net_counter["n"] - before_net} call(s)'
                    elif dom_hash(page) != before_dom: effect = 'DOM'
                    else: effect = 'NO EFFECT'; summary['no_effect'] += 1
            try: page.remove_listener('download', handler)
            except Exception: pass
            reset_overlays(page)
            if effect in ('NAV', 'MODAL', 'TOAST', 'DOWNLOAD', 'NET', 'DOM'): summary['ok'] += 1
            if effect == 'MODAL': close_modal(page)
            rows.append((route, label, kind, effect, detail))
            if effect == 'NAV' and page.url != base_url:
                page.goto(B + route, wait_until='domcontentloaded'); wait_awake(page); settle(page, 600)
        route_meta[route] = dict(console=list(console), failed=list(failed), controls=n_controls)
        summary['console'] += len(console)
        summary['failed5xx'] += sum(1 for f in failed if f[0] >= 500)
        summary['failed4xx'] += sum(1 for f in failed if 400 <= f[0] < 500)
        print(f'{route:26s} controls={n_controls:3d} console={len(console)} failed={len(failed)}')

    browser.close()

L = [f'# Admin portal v2 — button sweep (E2E final)', '', f'Base: {B} · {time.strftime("%Y-%m-%d %H:%M:%S")} (session injected, admin)', '',
     '| controls | working | skipped (destructive/mass-send) | no effect | empty toast | mailto | external | click errors | console errors | API 5xx | API 4xx |', '|---|---|---|---|---|---|---|---|---|---|---|',
     f"| {summary['controls']} | {summary['ok']} | {summary['skipped']} | {summary['no_effect']} | {summary['empty_toast']} | {summary['mailto']} | {summary['external']} | {summary['errors']} | {summary['console']} | {summary['failed5xx']} | {summary['failed4xx']} |", '']
for route in ROUTES:
    m = route_meta.get(route, {})
    L += [f'## {route}', '', f"controls: {m.get('controls', 0)} · console errors: {len(m.get('console', []))} · failed API: {len(m.get('failed', []))}", '']
    if m.get('console'): L += ['```', *m['console'][:20], '```', '']
    if m.get('failed'): L += ['Failed API responses:', *[f'- {s} {meth} {u}' for s, meth, u in m['failed'][:30]], '']
    L += ['| control | kind | effect | detail |', '|---|---|---|---|']
    for r in rows:
        if r[0] == route: L.append(f'| {r[1].replace("|", "/")} | {r[2]} | {r[3]} | {str(r[4]).replace("|", "/")} |')
    L.append('')
open(a.out, 'w').write('\n'.join(L))
print(f"wrote {a.out}: {summary}")
bad = summary['no_effect'] + summary['empty_toast'] + summary['mailto'] + summary['console'] + summary['failed5xx'] + summary['errors']
sys.exit(1 if bad else 0)
