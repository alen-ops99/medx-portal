#!/usr/bin/env python3
"""scripts/qa-plexus.py — QA for the Plexus screen group (overview · program · zagreb · mine).
Approach copied from scripts/qa-shots.py (artboard vs v2 screenshots) + a functional Playwright
pass that exercises EVERY control on the four tabs (network assertions, toast text, navigation,
keyboard). Outputs to _qa/plexus/.

  python3 scripts/qa-plexus.py [--base http://localhost:8900] [--api http://localhost:3960]
                               [--design ../../design/handoff/member-portal-2026-08-28]
                               [--shots-only | --flows-only]

Tokens: MEDX_QA_TOKEN (fresh member) · MEDX_QA_TOKEN_REG (conference+gala paid member) ·
MEDX_QA_TOKEN_GALA (gala-only member) · MEDX_QA_ADMIN (admin). Missing ones are fetched with
one login each (MEDX_QA_PASSWORD, default the staging seed password) — auth is 15 req/15 min/IP.
Seeds idempotent QA content through the ADMIN write paths (published sessions, one gallery photo,
speaker meta via /api/v2/plexus/…) so the published-program states are exercised too.
"""
import os, sys, json, argparse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
QA = os.path.join(HERE, '..', '_qa', 'plexus'); os.makedirs(QA, exist_ok=True)
ap = argparse.ArgumentParser()
ap.add_argument('--base', default='http://localhost:8900')
ap.add_argument('--api', default='http://localhost:3960')
ap.add_argument('--design', default=os.path.join(HERE, '..', '..', '..', 'design', 'handoff', 'member-portal-2026-08-28'))
ap.add_argument('--shots-only', action='store_true')
ap.add_argument('--flows-only', action='store_true')
a = ap.parse_args()

PASSWORD = os.environ.get('MEDX_QA_PASSWORD', 'Plexus2026!')
ACCOUNTS = {  # env var → (email, purpose)
    'MEDX_QA_TOKEN': ('member003@staging.medx.hr', 'fresh member (no registrations)'),
    'MEDX_QA_TOKEN_REG': ('member019@staging.medx.hr', 'conference + gala paid'),
    'MEDX_QA_TOKEN_GALA': ('member040@staging.medx.hr', 'gala paid, no conference'),
    'MEDX_QA_ADMIN': ('pjero.bacic@medx.hr', 'admin (seeding via admin write paths)'),
}

def http(method, url, body=None, token=None):
    req = urllib.request.Request(url, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + token} if token else {})})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode() or 'null')
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read().decode() or 'null')
        except Exception: return e.code, None
    except Exception as e:
        return 0, {'error': str(e)}

TOK = {}
def token_for(env):
    if TOK.get(env): return TOK[env]
    t = os.environ.get(env, '')
    if not t:
        email, _ = ACCOUNTS[env]
        st, d = http('POST', a.api + '/api/auth/login', {'email': email, 'password': PASSWORD})
        if st != 200 or not d or 'token' not in d:
            print(f'FATAL: login {email} -> {st} {d}'); sys.exit(2)
        t = d['token']; TOK[env + '_user'] = json.dumps(d.get('user') or {})
    TOK[env] = t
    return t
def user_json(env):
    if TOK.get(env + '_user'): return TOK[env + '_user']
    st, d = http('GET', a.api + '/api/auth/me', token=token_for(env))
    return json.dumps(d if st == 200 else {})

# ---------------------------------------------------------------- seed QA content (idempotent, admin write paths)
QA_S1, QA_S2, QA_REC = 'Keynote: Leading a hospital system', 'Panel: AI in the clinic', 'Welcome Reception — networking drinks'
def seed():
    admin = token_for('MEDX_QA_ADMIN')
    st, sched = http('GET', a.api + '/api/plexus/schedule')
    have = {s.get('title') for s in (sched or {}).get('sessions', [])}
    st2, speakers = http('GET', a.api + '/api/plexus/speakers')
    speakers = speakers or []
    sp = next((s for s in speakers if 'Smith of Finsbury' in (s.get('name') or '')), speakers[0] if speakers else None)
    made = []
    for title, body in [
        (QA_S1, {'title': QA_S1, 'description': 'QA seed', 'session_type': 'keynote', 'day': 1, 'start_time': '10:00', 'end_time': '11:00', 'room': 'Main hall', 'speaker_ids': [sp['id']] if sp else [], 'is_published': True}),
        (QA_S2, {'title': QA_S2, 'description': 'QA seed', 'session_type': 'panel', 'day': 1, 'start_time': '11:30', 'end_time': '12:30', 'room': 'Main hall', 'is_published': True}),
        (QA_REC, {'title': QA_REC, 'session_type': 'networking', 'day': 1, 'start_time': '18:00', 'end_time': '20:00', 'is_published': True}),
    ]:
        if title in have: continue
        st3, r = http('POST', a.api + '/api/admin/plexus/sessions', body, token=admin)
        made.append((title, st3))
    # speaker meta through the v2 admin write path (institution logo stays empty here — tag only)
    if sp:
        st4, r4 = http('PUT', a.api + f"/api/v2/plexus/speakers/{sp['id']}/meta", {'event_tag': 'both'}, token=admin)
        made.append(('speaker-meta:both', st4))
    # one gallery photo through the v2 admin write path
    st5, photos = http('GET', a.api + '/api/plexus/photos')
    if not any((p.get('title') == 'QA — Candlelit hall') for p in (photos or [])):
        st6, r6 = http('POST', a.api + '/api/v2/plexus/photos',
                       {'file_path': 'https://medx-website-preview.netlify.app/assets/photos/kn_smith_finsbury.jpg', 'title': 'QA — Candlelit hall', 'sort_order': 1}, token=admin)
        made.append(('photo', st6))
    print('seeded:', made or 'nothing (already present)')

# ---------------------------------------------------------------- results
results, console = [], []
def check(name, ok, info=''):
    results.append((name, bool(ok), info)); print(('PASS ' if ok else 'FAIL ') + name + (('  — ' + str(info)[:140]) if info else ''))

def run():
    from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout
    _last = ['']
    def toast(page):
        for _ in range(45):
            try: t = page.locator('.mx-toast.show').inner_text(timeout=200)
            except Exception: t = ''
            if t and t != _last[0]: _last[0] = t; return t
            page.wait_for_timeout(100)
        return ''
    def hook(page, tag):
        page.on('console', lambda m: console.append(f'[{tag}] {m.type}: {m.text}') if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        page.on('pageerror', lambda e: console.append(f'[{tag}] pageerror: {e}'))
    def login_as(page, env):
        page.goto(a.base + '/app/auth/welcome', wait_until='load')
        page.evaluate("([t,u]) => { localStorage.setItem('medx_user_token', t); localStorage.setItem('medx_user_data', u); }", [token_for(env), user_json(env)])

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        # ======================= screenshots: artboard vs v2 =======================
        if not a.flows_only:
            for name, f in [('overview', 'Plexus Conference.dc.html'), ('program', 'Plexus Program.dc.html'),
                            ('zagreb', 'Plexus Zagreb.dc.html'), ('mine', 'My Plexus.dc.html')]:
                path = os.path.abspath(os.path.join(a.design, f))
                if not os.path.exists(path): print('skip artboard', f); continue
                page = browser.new_page(viewport={'width': 1280, 'height': 900})
                page.goto('file://' + path.replace(' ', '%20'), wait_until='load')
                page.wait_for_timeout(900)
                page.screenshot(path=os.path.join(QA, f'design-{name}.png'), full_page=True)
                print('artboard →', f'design-{name}.png'); page.close()
            for name, url, env, w in [('overview', '/app/plexus', 'MEDX_QA_TOKEN', 1280), ('program', '/app/plexus/program', 'MEDX_QA_TOKEN', 1280),
                                      ('zagreb', '/app/plexus/zagreb', 'MEDX_QA_TOKEN', 1280), ('mine', '/app/plexus/mine', 'MEDX_QA_TOKEN', 1280),
                                      ('mine-registered', '/app/plexus/mine', 'MEDX_QA_TOKEN_REG', 1280),
                                      ('overview-430', '/app/plexus', 'MEDX_QA_TOKEN', 430), ('mine-430', '/app/plexus/mine', 'MEDX_QA_TOKEN', 430),
                                      ('program-430', '/app/plexus/program', 'MEDX_QA_TOKEN', 430)]:
                page = browser.new_page(viewport={'width': w, 'height': 930}, device_scale_factor=2 if w == 430 else 1, is_mobile=(w == 430), has_touch=(w == 430))
                hook(page, 'shot-' + name)
                login_as(page, env)
                page.goto(a.base + url, wait_until='networkidle'); page.wait_for_timeout(1300)
                page.screenshot(path=os.path.join(QA, f'v2-{name}.png'), full_page=True)
                print('v2 →', f'v2-{name}.png'); page.close()
        if a.shots_only:
            return

        # ======================= functional pass =======================
        ctx = browser.new_context(viewport={'width': 1280, 'height': 900})
        page = ctx.new_page(); hook(page, 'flow')

        # ---- OVERVIEW (fresh member) ----
        login_as(page, 'MEDX_QA_TOKEN')
        page.goto(a.base + '/app/plexus', wait_until='networkidle'); page.wait_for_timeout(1200)
        root = page.locator('[data-screen-label="Plexus Conference"]')
        check('overview renders (hero eyebrow FREE · 9TH YEAR)', 'FREE' in root.inner_text() and '9TH YEAR' in root.inner_text())
        check('countdown cells filled', page.locator('[data-cd=days]').inner_text().strip() not in ('', '—'))
        check('€ never EUR on overview', 'EUR' not in root.inner_text(), 'searched rendered text')
        check('REGISTER — FREE → /plexus?pick=conference', (page.locator('[data-block=hero] a', has_text='REGISTER — FREE').get_attribute('href') or '') == '/plexus?pick=conference&src=portal')
        check('RESERVE A SEAT → /plexus?pick=gala + live € price', '/plexus?pick=gala' in (page.locator('a', has_text='RESERVE A SEAT ·').get_attribute('href') or '') and '€' in page.locator('a', has_text='RESERVE A SEAT ·').inner_text())
        # GET UPDATES FROM PLEXUS — the ONE follow control (I'M INTERESTED deleted, audit item 12)
        was_on = page.locator('[data-act=tgFollow]').get_attribute('aria-checked') == 'true'
        with page.expect_response(lambda r: '/api/notify-topics' in r.url and r.request.method == 'POST') as ri:
            page.click('[data-act=tgFollow]')
        check('follow toggle → POST /api/notify-topics 200', ri.value.status == 200)
        t = toast(page)
        check('follow toggle toast states the new state', ('off' in t.lower()) if was_on else ('you follow plexus' in t.lower()), t)
        page.wait_for_timeout(400)
        check('toggle aria-checked flips', page.locator('[data-act=tgFollow]').get_attribute('aria-checked') == ('false' if was_on else 'true'))
        # flip back — the account leaves in its starting state
        with page.expect_response(lambda r: '/api/notify-topics' in r.url and r.request.method == 'POST') as ri:
            page.click('[data-act=tgFollow]')
        check('follow toggle back → POST 200', ri.value.status == 200); t = toast(page)
        check('toggle-back toast', ('you follow plexus' in t.lower()) if was_on else ('off' in t.lower()), t)
        # ADD TO CALENDAR
        with page.expect_download(timeout=6000) as dl: page.click('[data-act=dlIcs]')
        check('ADD TO CALENDAR → .ics download', dl.value.suggested_filename.endswith('.ics'), dl.value.suggested_filename); toast(page)
        # VIEW BIO modal + Escape (keyboard)
        page.click('[data-act=vb] >> nth=0'); page.wait_for_timeout(300)
        check('VIEW BIO opens modal', page.locator('[data-role=bio-scrim]').count() == 1)
        page.keyboard.press('Escape'); page.wait_for_timeout(300)
        check('Escape closes bio modal', page.locator('[data-role=bio-scrim]').count() == 0)
        page.focus('[data-act=vb] >> nth=0'); page.keyboard.press('Enter'); page.wait_for_timeout(300)
        check('keyboard Enter opens bio modal', page.locator('[data-role=bio-scrim]').count() == 1)
        page.click('[data-act=bioClose]'); page.wait_for_timeout(200)
        # ALL PHOTOS gallery
        page.click('[data-act=gallery]'); page.wait_for_timeout(400)
        check('ALL PHOTOS opens gallery modal', page.locator('.mx-modal img').count() >= 1, f"{page.locator('.mx-modal img').count()} imgs")
        gallery_live = 'QA — Candlelit hall' in (page.locator('.mx-modal').inner_text() if page.locator('.mx-modal').count() else '')
        check('gallery shows admin-uploaded photo (conference_photos)', gallery_live)
        page.click('.mx-modal [data-act=a0]'); page.wait_for_timeout(200)
        # at-a-glance now carries the seeded reception row + published day summary
        check('at-a-glance shows seeded Welcome Reception row', 'Welcome Reception' in root.inner_text())
        # links out
        page.click('a:has-text("ALL SPEAKERS")'); page.wait_for_timeout(700)
        check('ALL SPEAKERS → /app/plexus/program', page.url.endswith('/app/plexus/program'), page.url)
        page.go_back(wait_until='networkidle'); page.wait_for_timeout(600)
        page.click('#view a:has-text("OPEN THE NETWORK")'); page.wait_for_timeout(600)
        check('OPEN THE NETWORK → /app/network', page.url.endswith('/app/network'), page.url)
        page.go_back(wait_until='networkidle'); page.wait_for_timeout(600)
        page.click('#view a:has-text("MESSAGE US")'); page.wait_for_timeout(600)
        check('MESSAGE US → /app/messages', page.url.endswith('/app/messages'), page.url)

        # ---- PROGRAM ----
        page.goto(a.base + '/app/plexus/program', wait_until='networkidle'); page.wait_for_timeout(1200)
        proot = page.locator('[data-screen-label="Plexus Program"]')
        check('program renders + seeded sessions visible', QA_S1 in proot.inner_text())
        # day expand/collapse
        day = page.locator('[data-act=tgDay] >> nth=0')
        before = proot.inner_text()
        day.click(); page.wait_for_timeout(300); collapsed = QA_S1 not in page.locator('[data-block=days]').inner_text()
        day = page.locator('[data-act=tgDay] >> nth=0'); day.click(); page.wait_for_timeout(300)
        check('day row collapses and expands', collapsed and QA_S1 in page.locator('[data-block=days]').inner_text())
        # ADD to my schedule
        with page.expect_response(lambda r: '/api/plexus/my-schedule/' in r.url and r.request.method == 'POST') as ri:
            page.click('[data-block=days] [data-act=tgSession] >> nth=0')
        check('ADD → POST /api/plexus/my-schedule/:id 200', ri.value.status == 200)
        t = toast(page); check('ADD toast names the session', 'added to your schedule' in t.lower(), t)
        page.wait_for_timeout(300)
        check('control flips to ADDED', 'ADDED' in page.locator('[data-block=days] [data-act=tgSession] >> nth=0').inner_text())
        with page.expect_response(lambda r: '/api/plexus/my-schedule/' in r.url and r.request.method == 'DELETE') as ri:
            page.click('[data-block=days] [data-act=tgSession] >> nth=0')
        check('remove → DELETE 200', ri.value.status == 200); toast(page)
        # DOWNLOAD PROGRAM · PDF (headless turns PDF popups into downloads — assert the opened URL + serve it directly)
        page.evaluate("window.__opened=null; window.open=(u)=>{window.__opened=String(u||''); return null;}")
        page.click('[data-act=pdf]')
        opened = page.evaluate('window.__opened')
        check('DOWNLOAD PROGRAM · PDF opens /api/v2/plexus/program.pdf', '/api/v2/plexus/program.pdf' in (opened or ''), opened)
        toast(page)
        try:
            with urllib.request.urlopen(a.base + '/api/v2/plexus/program.pdf', timeout=30) as r: st_pdf = r.status; head = r.read(5)
            check('program.pdf serves 200 %PDF', st_pdf == 200 and head.startswith(b'%PDF'))
        except Exception as e: check('program.pdf serves 200 %PDF', False, e)
        # ADD TO CALENDAR (program header)
        with page.expect_download(timeout=6000) as dl: page.click('[data-act=dlIcs]')
        check('program ADD TO CALENDAR → .ics', dl.value.suggested_filename.endswith('.ics')); toast(page)
        # speaker filters + search were deleted by design (audit item 9) — the tab IS the canonical roster
        check('speaker filter chips are gone', page.locator('[data-act=spf]').count() == 0)
        check('speaker search box is gone', page.locator('[data-role=speakerQ]').count() == 0)
        n_all = page.locator('[data-block=speakers] [data-act=vb]').count()
        check('speakers grid renders the canonical roster', n_all >= 1, f'{n_all} cards')
        check('PLEXUS · GALA tag rendered from v2 speaker-meta', 'PLEXUS · GALA' in page.locator('[data-block=speakers]').inner_text())
        # BIO + ADD SESSION from the speakers grid: modal lists the seeded session with an add control
        page.click('[data-block=speakers] [data-act=vb] >> nth=0'); page.wait_for_timeout(400)
        bio_txt = page.locator('[data-role=bio-scrim]').inner_text() if page.locator('[data-role=bio-scrim]').count() else ''
        check('BIO + ADD SESSION modal lists sessions', 'SESSIONS' in bio_txt)
        if 'ADD TO MY SCHEDULE' in bio_txt:
            with page.expect_response(lambda r: '/api/plexus/my-schedule/' in r.url and r.request.method == 'POST') as ri:
                page.click('[data-role=bio-scrim] [data-act=tgSession] >> nth=0')
            check('modal ADD TO MY SCHEDULE → POST 200', ri.value.status == 200); toast(page); page.wait_for_timeout(300)
            page.click('[data-role=bio-scrim] [data-act=tgSession] >> nth=0'); toast(page); page.wait_for_timeout(200)  # undo
        page.keyboard.press('Escape'); page.wait_for_timeout(200)
        check('REGISTER — FREE link → form', '/plexus?pick=conference' in (page.locator('#view a:has-text("REGISTER — FREE")').get_attribute('href') or ''))

        # ---- ZAGREB ----
        page.goto(a.base + '/app/plexus/zagreb', wait_until='networkidle'); page.wait_for_timeout(900)
        zroot = page.locator('[data-screen-label="Explore Zagreb"]')
        check('zagreb renders (diacritics intact)', 'Dobrodošli u Zagreb.' in zroot.inner_text() and 'Tkalčićeva' in zroot.inner_text())
        page.evaluate("window.__opened=null; window.open=(u)=>{window.__opened=String(u||''); return null;}")
        page.click('[data-act=guide]')
        opened = page.evaluate('window.__opened')
        check('WELCOME GUIDE opens /api/v2/plexus/welcome-guide.pdf', '/api/v2/plexus/welcome-guide.pdf' in (opened or ''), opened)
        toast(page)
        try:
            with urllib.request.urlopen(a.base + '/api/v2/plexus/welcome-guide.pdf', timeout=30) as r: st_g = r.status; head = r.read(5)
            check('welcome-guide.pdf serves 200 %PDF', st_g == 200 and head.startswith(b'%PDF'))
        except Exception as e: check('welcome-guide.pdf serves 200 %PDF', False, e)
        page.click('#view a:has-text("MY PLEXUS")'); page.wait_for_timeout(600)
        check('zagreb MY PLEXUS → /app/plexus/mine', page.url.endswith('/app/plexus/mine'), page.url)

        # ---- MY PLEXUS (fresh member: none state) ----
        page.wait_for_timeout(800)
        mroot = page.locator('[data-screen-label="My Plexus"]')
        check('mine (fresh) shows REGISTRATION OPEN + empty pass slot', 'REGISTRATION OPEN' in mroot.inner_text() and 'Your QR pass appears here' in mroot.inner_text())
        check('mine REGISTER — FREE → form pick=conference,gala', '/plexus?pick=conference%2Cgala' in (page.locator('[data-block=mine-hero] a', has_text='REGISTER — FREE').get_attribute('href') or '') or '/plexus?pick=conference,gala' in (page.locator('[data-block=mine-hero] a', has_text='REGISTER — FREE').get_attribute('href') or ''))
        check('gala card RESERVE A SEAT → form pick=gala', '/plexus?pick=gala' in (page.locator('#view a:has-text("RESERVE A SEAT")').get_attribute('href') or ''))
        # the ONE server-rendered form really opens (full page load through the proxy)
        page.click('[data-block=mine-hero] a:has-text("REGISTER — FREE")'); page.wait_for_load_state('load'); page.wait_for_timeout(900)
        check('REGISTER — FREE loads the server-rendered /plexus form', '/plexus?pick=' in page.url and 'Reserve your place' in page.content(), page.url)
        check('form recognises the signed-in member (account linking)', 'signed in as' in page.content().lower())
        page.go_back(wait_until='networkidle'); page.wait_for_timeout(600)
        page.goto(a.base + '/app/plexus/mine', wait_until='networkidle'); page.wait_for_timeout(900)
        check('who-attends block renders (rows or empty state)', page.locator('#view a:has-text("FIND MORE ATTENDEES")').count() == 1)

        # ---- MY PLEXUS (registered + gala paid member) ----
        login_as(page, 'MEDX_QA_TOKEN_REG')
        page.goto(a.base + '/app/plexus/mine', wait_until='networkidle'); page.wait_for_timeout(1300)
        mtxt = page.locator('[data-screen-label="My Plexus"]').inner_text()
        check('registered member: GALA SEAT PAID eyebrow', 'GALA SEAT PAID' in mtxt)
        check('registered member: ✓ REGISTERED + ✓ SEAT PAID chips', '✓ REGISTERED' in mtxt and '✓ SEAT PAID' in mtxt)
        qrs = page.locator('.mx-qr')
        check('QR passes render (conference + gala)', qrs.count() >= 2, f'{qrs.count()} qr imgs')
        if qrs.count():
            page.wait_for_timeout(1200)
            loaded = page.evaluate("Array.from(document.querySelectorAll('.mx-qr')).map(i => i.naturalWidth > 0)")
            check('QR images actually load from /qr/:id.png', all(loaded), loaded)
        # TRANSFER (real endpoint, validation first)
        page.click('[data-act=transfer]'); page.wait_for_timeout(400)
        check('TRANSFER opens modal', page.locator('.mx-modal').count() == 1)
        page.click('.mx-modal [data-act=a1]'); t = toast(page)
        check('transfer validation toast', 'full name' in t.lower(), t)
        page.fill('[data-role=tfName]', 'Ana Kovačević'); page.fill('[data-role=tfEmail]', 'qa.transfer+plexus@example.com')
        with page.expect_response(lambda r: '/transfer' in r.url and r.request.method == 'POST') as ri:
            page.click('.mx-modal [data-act=a1]')
        ok_or_open = ri.value.status in (200, 409)   # 409 = a pending transfer already exists from an earlier run
        check('TRANSFER → POST /api/plexus/registration/:id/transfer', ok_or_open, ri.value.status)
        t = toast(page); check('transfer toast', ('requested' in t.lower()) or ('already' in t.lower()), t)
        # overview hero flips for a registered member
        page.goto(a.base + '/app/plexus', wait_until='networkidle'); page.wait_for_timeout(1100)
        check('overview hero shows MY PLEXUS → when registered', 'MY PLEXUS →' in page.locator('[data-block=hero]').inner_text())

        # ---- MY PLEXUS (gala-only member) ----
        login_as(page, 'MEDX_QA_TOKEN_GALA')
        page.goto(a.base + '/app/plexus/mine', wait_until='networkidle'); page.wait_for_timeout(1200)
        mtxt = page.locator('[data-screen-label="My Plexus"]').inner_text()
        check('gala-only member: SEAT PAID state + QR', '✓ SEAT PAID' in mtxt and page.locator('.mx-qr').count() >= 1)

        # ---- keyboard pass on the tab strip ----
        page.goto(a.base + '/app/plexus', wait_until='networkidle'); page.wait_for_timeout(900)
        page.focus('.mx-plexus-tabs a >> nth=0'); page.keyboard.press('Enter'); page.wait_for_timeout(600)
        check('keyboard Enter on tab strip navigates', '/app/plexus/' in page.url, page.url)

        # ---- mobile 430: chrome pattern holds on plexus routes ----
        m = ctx.new_page(); hook(m, 'mobile'); m.set_viewport_size({'width': 430, 'height': 930})
        m.goto(a.base + '/app/auth/welcome', wait_until='load')
        m.evaluate("([t,u]) => { localStorage.setItem('medx_user_token', t); localStorage.setItem('medx_user_data', u); }", [token_for('MEDX_QA_TOKEN'), user_json('MEDX_QA_TOKEN')])
        m.goto(a.base + '/app/plexus', wait_until='networkidle'); m.wait_for_timeout(900)
        check('mobile: tab bar visible + desktop chrome hidden', m.locator('#mx-tabbar').is_visible() and not m.locator('#mx-desktop-chrome').is_visible())
        check('mobile: back arrow on the plexus sub-view', m.locator('#mx-mobile-top [data-act=back]').count() == 1)
        check('mobile: no horizontal page scroll', m.evaluate('document.documentElement.scrollWidth <= 434'), m.evaluate('document.documentElement.scrollWidth'))
        m.close()
        ctx.close(); browser.close()

if not a.flows_only and not a.shots_only:
    seed()
elif a.flows_only:
    seed()
run()

open(os.path.join(QA, 'console.txt'), 'w').write('\n'.join(console) + '\n')
bad = [r for r in results if not r[1]]
print(f'\n{len(results) - len(bad)}/{len(results)} checks passed; console errors: {len(console)}')
for c in console[:20]: print('  console:', c)
sys.exit(1 if (bad or console) else 0)
