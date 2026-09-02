#!/usr/bin/env python3
"""scripts/qa-gala-bridges.py — QA for the GALA EVENING + BUILDING BRIDGES screens
(js/views/gala.js, js/views/bridges.js). Same approach as qa-shots.py/qa-flows.py, scoped to
these two screens; shots land in _qa/gala/ and _qa/bridges/.

  MEDX_QA_TOKEN=<member jwt> MEDX_QA_USER='<user json>' \
  MEDX_QA_TOKEN_GALA=<jwt of a member with an awaiting_payment gala row> \
  MEDX_QA_ADMIN_TOKEN=<admin jwt> \
  python3 scripts/qa-gala-bridges.py [--base http://localhost:8901] [--api http://localhost:3961]
                                     [--design ../../design/handoff/member-portal-2026-08-28]
                                     [--shots-only | --flows-only]

Prints PASS/FAIL per check; exits 1 on any FAIL or any console error on the v2 pages.
Auth-limited routes are never called (tokens come from the environment)."""
import os, sys, json, argparse, re, urllib.request
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

HERE = os.path.dirname(os.path.abspath(__file__))
ap = argparse.ArgumentParser()
ap.add_argument('--base', default='http://localhost:8901')
ap.add_argument('--api', default='http://localhost:3961')
ap.add_argument('--design', default=os.path.join(HERE, '..', '..', '..', 'design', 'handoff', 'member-portal-2026-08-28'))
ap.add_argument('--shots-only', action='store_true')
ap.add_argument('--flows-only', action='store_true')
a = ap.parse_args()

TOKEN = os.environ.get('MEDX_QA_TOKEN', '')
USER = os.environ.get('MEDX_QA_USER', '{}')
TOKEN_GALA = os.environ.get('MEDX_QA_TOKEN_GALA', '')
ADMIN = os.environ.get('MEDX_QA_ADMIN_TOKEN', '')

QA = {n: os.path.join(HERE, '..', '_qa', n) for n in ('gala', 'bridges')}
for d in QA.values(): os.makedirs(d, exist_ok=True)

results, console = [], []
def check(name, ok, info=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (('  — ' + str(info)) if info else ''))

def api_put(path, body, token):
    req = urllib.request.Request(a.api + path, data=json.dumps(body).encode(), method='PUT',
                                 headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token})
    with urllib.request.urlopen(req, timeout=15) as r: return json.loads(r.read())

def api_get(path, token=''):
    req = urllib.request.Request(a.api + path, headers={'Authorization': 'Bearer ' + token} if token else {})
    with urllib.request.urlopen(req, timeout=15) as r: return json.loads(r.read())

_last_toast = ['']
def toast_text(page):
    for _ in range(40):
        try: t = page.locator('.mx-toast.show').inner_text(timeout=200)
        except PWTimeout: t = ''
        if t and t != _last_toast[0]: _last_toast[0] = t; return t
        page.wait_for_timeout(100)
    return ''

noted = []
def expected_bad(status, url):
    # deliberate QA trigger: checkout without Stripe locally answers 400 (the view toasts it)
    if '/api/gala/checkout-session' in url and status == 400: return 'expected (no Stripe locally)'
    # foreign screen: the Messages view (someone else's screen) calls its not-yet-mounted API
    if '/api/v2/messages/' in url: return 'foreign screen (/app/messages view)'
    return None

def wire_console(page, label):
    # every HTTP ≥400 is either expected/foreign (noted) or a failure; raw console errors that are
    # just the browser echoing those responses ("Failed to load resource") are folded into that.
    def on_resp(r, n=label):
        if r.status < 400: return
        why = expected_bad(r.status, r.url)
        (noted if why else console).append(f'[{n}] HTTP {r.status} {r.url}' + (f' — {why}' if why else ''))
    page.on('response', on_resp)
    page.on('console', lambda m, n=label: console.append(f'[{n}] {m.type}: {m.text}') if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    page.on('pageerror', lambda e, n=label: console.append(f'[{n}] pageerror: {e}'))

def signin(page):
    page.goto(a.base + '/app/auth/welcome', wait_until='load')
    page.evaluate("([t,u]) => { localStorage.setItem('medx_user_token', t); localStorage.setItem('medx_user_data', u); }", [TOKEN, USER])

with sync_playwright() as pw:
    browser = pw.chromium.launch()

    # ---------- artboard-vs-page screenshots (1280 + 430) ----------
    if not a.flows_only:
        for screen, fname in (('gala', 'Gala Evening.dc.html'), ('bridges', 'Building Bridges.dc.html')):
            path = os.path.abspath(os.path.join(a.design, fname))
            if os.path.exists(path):
                for w in (1280, 430):
                    p = browser.new_page(viewport={'width': w, 'height': 900})
                    p.goto('file://' + path.replace(' ', '%20').replace('&', '%26'), wait_until='load')
                    p.wait_for_timeout(1200)
                    p.screenshot(path=os.path.join(QA[screen], f'design-{screen}-{w}.png'), full_page=True)
                    print('artboard →', f'_qa/{screen}/design-{screen}-{w}.png')
                    p.close()
            else:
                print('skip artboard (not found):', path)
            for w in (1280, 430):
                kw = dict(viewport={'width': w, 'height': 930})
                if w == 430: kw.update(device_scale_factor=2, is_mobile=True, has_touch=True)
                p = browser.new_page(**kw)
                wire_console(p, f'{screen}-{w}')
                signin(p)
                p.goto(a.base + '/app/' + screen, wait_until='networkidle')
                p.wait_for_timeout(1500)
                p.screenshot(path=os.path.join(QA[screen], f'v2-{screen}-{w}.png'), full_page=True)
                print('v2 →', f'_qa/{screen}/v2-{screen}-{w}.png')
                if w == 430:
                    sw = p.evaluate('document.documentElement.scrollWidth')
                    check(f'{screen}: no horizontal scroll at 430px', sw <= 430, f'scrollWidth={sw}')
                p.close()

    # ---------- functional pass ----------
    if not a.shots_only:
        ctx = browser.new_context(viewport={'width': 1280, 'height': 900})
        page = ctx.new_page()
        wire_console(page, 'flows')
        signin(page)

        # ===== GALA =====
        page.goto(a.base + '/app/gala', wait_until='networkidle'); page.wait_for_timeout(1200)
        view = page.locator('#view').inner_text()
        check('gala: renders (hero + band + sections)', all(s in view.upper() for s in ('GALA', 'THE EVENING BEGINS IN', 'ON STAGE THAT NIGHT', 'WHY WE GATHER', 'THE EVENING AT A GLANCE')))
        check('gala: countdown ticking', page.locator('[data-cd=days]').first.inner_text().strip() not in ('', '—'))
        meta = api_get('/api/v2/gala/meta')
        cur = meta['price']['current']
        check('gala: band price = server effective price', f'€{cur:g}' in view, f'server €{cur}')
        check('gala: € only, never EUR', ('€' in view) and not re.search(r'\bEUR\b', view))
        check('gala: no capacity figure (seats limited copy)', 'SEATS LIMITED' in view.upper() and not re.search(r'(?<!€)\b150\b(?!\s*UNTIL)', view.replace('€150', '')))
        check('gala: performers one-line tease by default (no placeholder cards)', 'announced this autumn' in view and 'ANNOUNCED CLOSER TO DECEMBER' not in view.upper() and 'FEATURED PERFORMERS' not in view.upper())

        # RESERVE A SEAT · €<price> → server-rendered /plexus with the member prefilled + pick=gala
        # (one verb on both blocks — "RESERVE YOUR SEAT" and "RSVP · €150" are gone, audit item 6)
        reserve = page.locator('a:has-text("RESERVE A SEAT")')
        href = reserve.first.get_attribute('href') or ''
        check('gala: RESERVE A SEAT href → /plexus?pick=gala&src=portal&prefill', href.startswith('/plexus?') and 'pick=gala' in href and 'src=portal' in href and 'email=' in href, href)
        hrefs = [reserve.nth(i).get_attribute('href') or '' for i in range(reserve.count())]
        check('gala: both reserve blocks use the one verb + the one form', len(hrefs) >= 2 and all('pick=gala' in h for h in hrefs), f'{len(hrefs)} links')
        check('gala: no RSVP / RESERVE YOUR SEAT wording left', 'RSVP' not in view and 'RESERVE YOUR SEAT' not in view)
        p2 = ctx.new_page(); p2.goto(a.base + href, wait_until='load'); p2.wait_for_timeout(800)
        t2 = p2.locator('body').inner_text()
        check('gala: /plexus form loads with Gala card', 'Reserve your place' in t2 and 'Gala' in t2)
        p2.close()

        # ADD TO CALENDAR → .ics download (server timed event, ui fallback)
        with page.expect_download(timeout=8000) as dl: page.click('[data-act=dlIcs]')
        d = dl.value
        check('gala: ADD TO CALENDAR → .ics download', d.suggested_filename.endswith('.ics'), d.suggested_filename)
        ics_path = d.path(); ics = open(ics_path, 'r', encoding='utf-8', errors='ignore').read() if ics_path else ''
        check('gala: .ics is a calendar with the Gala event', 'BEGIN:VEVENT' in ics and 'Gala' in ics)
        t = toast_text(page); check('gala: calendar toast', 'calendar' in t.lower(), t)

        # follow toggle → POST /api/notify-topics {project:'gala'}
        with page.expect_response(lambda r: '/api/notify-topics' in r.url and r.request.method == 'POST') as ri:
            page.click('[data-act=tgFollow]')
        check('gala: follow ON → POST /api/notify-topics 200', ri.value.status == 200 and json.loads(ri.value.request.post_data)['project'] == 'gala')
        t = toast_text(page); check('gala: follow toast', len(t) > 0, t)
        page.wait_for_timeout(400)
        check('gala: toggle shows ON', 'GET UPDATES FROM THE GALA · ON' in page.locator('#view').inner_text())
        with page.expect_response(lambda r: '/api/notify-topics' in r.url and r.request.method == 'POST') as ri:
            page.click('[data-act=tgFollow]')
        check('gala: follow OFF → POST 200', ri.value.status == 200); toast_text(page)

        # ALL PHOTOS → gallery modal
        page.click('[data-act=allPhotos]'); page.wait_for_timeout(400)
        check('gala: ALL PHOTOS opens modal', page.locator('.mx-modal').count() == 1 and 'Moments' in page.locator('.mx-modal').inner_text())
        page.keyboard.press('Escape'); page.wait_for_timeout(300)
        check('gala: Escape closes modal', page.locator('.mx-modal').count() == 0)

        # ALL SPEAKERS → /app/plexus/program · MESSAGE US → /app/messages
        page.click('a:has-text("ALL SPEAKERS")'); page.wait_for_timeout(600)
        check('gala: ALL SPEAKERS → /app/plexus/program', page.url.endswith('/app/plexus/program'), page.url)
        page.go_back(); page.wait_for_timeout(900)
        page.click('a:has-text("MESSAGE US")'); page.wait_for_timeout(600)
        check('gala: MESSAGE US → /app/messages?topic=gala', '/app/messages?topic=gala' in page.url, page.url)
        page.go_back(); page.wait_for_timeout(1000)

        # keyboard: Tab reaches the toggle span; Enter flips it (delegate)
        page.focus('[data-act=tgFollow]')
        with page.expect_response(lambda r: '/api/notify-topics' in r.url and r.request.method == 'POST') as ri:
            page.keyboard.press('Enter')
        check('gala: keyboard Enter on follow toggle → POST', ri.value.status == 200); toast_text(page); page.wait_for_timeout(300)
        page.focus('[data-act=tgFollow]')
        with page.expect_response(lambda r: '/api/notify-topics' in r.url and r.request.method == 'POST'):
            page.keyboard.press('Enter')
        toast_text(page)

        # admin flips performersAnnounced → names replace the TBA slots (then back)
        if ADMIN:
            api_put('/api/v2/gala/meta', {'performers_announced': True, 'performers': [
                {'name': 'Tatiana “Tajči” Cameron', 'role': 'Croatian-American vocalist'},
                {'name': 'Ante Gelo', 'role': 'Guitarist'}]}, ADMIN)
            page.goto(a.base + '/app/gala', wait_until='networkidle'); page.wait_for_timeout(1000)
            v = page.locator('#view').inner_text()
            check('gala: admin announce → named performers render', 'Tajči' in v and 'Ante Gelo' in v and 'ICONIC CROATIAN MUSICIANS' in v.upper())
            api_put('/api/v2/gala/meta', {'performers_announced': False}, ADMIN)
            page.goto(a.base + '/app/gala', wait_until='networkidle'); page.wait_for_timeout(1000)
            check('gala: admin revert → TBA slots back', 'announced this autumn' in page.locator('#view').inner_text())
        else:
            print('skip admin performer checks (no MEDX_QA_ADMIN_TOKEN)')

        # a member whose gala seat awaits payment sees PAY FOR YOUR SEAT (checkout errors locally
        # without Stripe). Own browser CONTEXT: localStorage is per-context, so switching identity
        # in a shared context would silently re-login the main page on its next full load.
        if TOKEN_GALA:
            ctx3 = browser.new_context(viewport={'width': 1280, 'height': 900})
            p3 = ctx3.new_page(); wire_console(p3, 'gala-pay')
            p3.goto(a.base + '/app/auth/welcome', wait_until='load')
            p3.evaluate("t => localStorage.setItem('medx_user_token', t)", TOKEN_GALA)
            p3.goto(a.base + '/app/gala', wait_until='networkidle'); p3.wait_for_timeout(1200)
            v3 = p3.locator('#view').inner_text()
            check('gala: awaiting-payment member sees PAY FOR YOUR SEAT + status note', 'PAY FOR YOUR SEAT' in v3 and 'approved' in v3)
            with p3.expect_response(lambda r: '/api/gala/checkout-session' in r.url) as ri:
                p3.click('[data-act=pay]')
            _last_toast[0] = ''
            t = toast_text(p3)
            check('gala: PAY → POST /api/gala/checkout-session + toast', ri.value.status in (200, 400) and len(t) > 0, f'{ri.value.status} · {t}')
            p3.close(); ctx3.close()
        else:
            print('skip pay-state checks (no MEDX_QA_TOKEN_GALA)')

        # ===== BUILDING BRIDGES =====
        page.goto(a.base + '/app/bridges', wait_until='networkidle'); page.wait_for_timeout(1200)
        view = page.locator('#view').inner_text()
        check('bridges: renders (hero + band + sections)', all(s in view.upper() for s in ('BUILDING BRIDGES', 'THE MISSION', 'NEXT EVENT', "WHERE WE'VE BEEN")))
        check('bridges: countdown ticking', page.locator('[data-cd=days]').first.inner_text().strip() not in ('', '—'))
        check('bridges: no Harvard branding', 'harvard' not in view.lower())
        check('bridges: no application/membership copy', 'application' not in view.lower() and 'open to everyone' in view.lower())
        check('bridges: four editions with admin-entered or dash figures', view.upper().count('NEW CONNECTIONS') >= 4 and 'EDITION 01' in view.upper())

        # hero REGISTER FOR <CITY> → #bb-next scroll target
        page.click('a[href="#bb-next"]'); page.wait_for_timeout(500)
        check('bridges: REGISTER FOR BOSTON scrolls to NEXT EVENT', page.url.endswith('#bb-next') and page.locator('#bb-next').is_visible())

        # follow toggle
        with page.expect_response(lambda r: '/api/notify-topics' in r.url and r.request.method == 'POST') as ri:
            page.click('[data-act=tgFollow]')
        check('bridges: follow ON → POST {project:bridges}', ri.value.status == 200 and json.loads(ri.value.request.post_data)['project'] == 'bridges'); toast_text(page)
        with page.expect_response(lambda r: '/api/notify-topics' in r.url and r.request.method == 'POST'):
            page.click('[data-act=tgFollow]')
        toast_text(page)

        # REGISTER → modal → validation → real registration (POST /api/bridges/events/:id/register).
        # The scratch DB keeps state: on a FRESH seed copy the modal flow runs end-to-end; on a
        # re-run (member already holds a seat) the card is the REGISTERED link and the server's
        # dedup contract is exercised directly instead.
        already = 'REGISTERED ✓' in page.locator('#view').inner_text()
        if not already:
            page.click('[data-act=register]'); page.wait_for_timeout(400)
            check('bridges: REGISTER opens the form modal', page.locator('.mx-modal').count() == 1 and 'Reserve your place' in page.locator('.mx-modal').inner_text())
            page.fill('#bb-first_name', ''); page.click('.mx-modal-foot [data-act=a1]'); page.wait_for_timeout(200)
            check('bridges: empty name → inline error', page.locator('[data-role=bbError]').is_visible())
            page.fill('#bb-first_name', 'Member 003'); page.fill('#bb-last_name', 'Test')
            with page.expect_response(lambda r: re.search(r'/api/bridges/events/[^/]+/register', r.url)) as ri:
                page.click('.mx-modal-foot [data-act=a1]')
            body = ri.value.json()
            check('bridges: registration POST succeeds', ri.value.status == 200 and body.get('success') is True, body)
            t = toast_text(page); check('bridges: registration toast', 'registered' in t.lower(), t)
            page.wait_for_timeout(500)
            check('bridges: card flips to REGISTERED ✓ · MY TICKET', 'REGISTERED ✓' in page.locator('#view').inner_text())
            check('bridges: modal closed after success', page.locator('.mx-modal').count() == 0)
        else:
            print('note: member already registered (re-run) — exercising the dedup contract instead of the modal')
            ev_id = page.locator('[data-block=next]').get_attribute('data-eid') or ''
            if not ev_id:
                events = api_get('/api/bridges/events', TOKEN)
                up = sorted([e for e in events if e.get('event_date')], key=lambda e: e['event_date'])
                ev_id = up[0]['id'] if up else ''
            u = json.loads(USER or '{}')
            req = urllib.request.Request(f'{a.api}/api/bridges/events/{ev_id}/register',
                data=json.dumps({'name': 'QA Rerun', 'email': u.get('email', ''), 'institution': '', 'title': '', 'motivation': ''}).encode(),
                headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN})
            with urllib.request.urlopen(req, timeout=15) as r: body = json.loads(r.read())
            check('bridges: duplicate registration → already_registered (one seat kept)', body.get('already_registered') is True, body)
            check('bridges: card shows REGISTERED ✓ · MY TICKET', 'REGISTERED ✓' in page.locator('#view').inner_text())
        page.click('a:has-text("REGISTERED ✓")'); page.wait_for_timeout(600)
        check('bridges: REGISTERED → /app/me', page.url.endswith('/app/me'), page.url)
        page.go_back(); page.wait_for_timeout(1200)
        check('bridges: reload keeps REGISTERED state (my-registration)', 'REGISTERED ✓' in page.locator('#view').inner_text())

        # edition card → gallery toast (no photos yet) — mouse and keyboard
        _last_toast[0] = ''
        page.click('[data-act=gallery] >> nth=0'); t = toast_text(page)
        check('bridges: edition card → gallery toast', 'photos' in t.lower(), t)
        page.focus('[data-act=gallery] >> nth=1'); page.keyboard.press('Enter'); t = toast_text(page)
        check('bridges: keyboard Enter on edition card → toast', 'photos' in t.lower(), t)

        # admin enters recap figures → live on the card (then revert)
        if ADMIN:
            eds = api_get('/api/v2/bridges/editions')['editions']
            zur = [e for e in eds if e['edition_no'] == 4][0]
            api_put('/api/v2/bridges/editions/' + zur['id'], {'guests': 44, 'connections': 61}, ADMIN)
            page.goto(a.base + '/app/bridges', wait_until='networkidle'); page.wait_for_timeout(1200)
            v = page.locator('#view').inner_text()
            check('bridges: admin recap figures render (44 · 61)', '44' in v and '61' in v)
            api_put('/api/v2/bridges/editions/' + zur['id'], {'guests': None, 'connections': None}, ADMIN)
            page.goto(a.base + '/app/bridges', wait_until='networkidle'); page.wait_for_timeout(1000)
            check('bridges: revert → dashes back', '—' in page.locator('#view').inner_text())
        else:
            print('skip admin edition checks (no MEDX_QA_ADMIN_TOKEN)')

        # MESSAGE US
        page.click('a:has-text("MESSAGE US")'); page.wait_for_timeout(600)
        check('bridges: MESSAGE US → /app/messages?topic=bridges', '/app/messages?topic=bridges' in page.url, page.url)

        view_all = page.locator('#view').inner_text()
        ctx.close()
    browser.close()

bad = [r for r in results if not r[1]]
print(f'\n{len(results) - len(bad)}/{len(results)} checks passed; console/network errors: {len(console)}; noted (expected/foreign): {len(noted)}')
for c in console[:20]: print('  error:', c)
for c in noted[:10]: print('  noted:', c)
sys.exit(1 if bad or console else 0)
