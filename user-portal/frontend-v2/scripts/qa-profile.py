#!/usr/bin/env python3
"""scripts/qa-profile.py — Profile & Settings QA (same approach as qa-shots.py, scoped to this
screen; shared scripts untouched). Artboard-vs-page shots at 1280 and 430 px into _qa/profile/
plus a functional Playwright pass against a live backend.

   MEDX_QA_TOKEN=<member jwt> [MEDX_QA_TOKEN_VISUAL=<jwt for the visual shot>] \
   python3 scripts/qa-profile.py [--base http://localhost:8906] [--api http://localhost:3966] \
       [--design ../../design/handoff/member-portal-2026-08-28] [--email …] [--password …] [--shots-only]

Auth calls used: 0 with tokens provided; otherwise 1 login (+1 for the visual account when
--visual-email is set, +1 register for the resend-link check unless --skip-resend). The auth
limiter allows 15/15 min per IP — reuse tokens between runs.
Functional pass (member account is MUTATED — staging/scratch DB only): load + prefill · upload
photo (valid, wrong type, spoofed bytes, >5 MB) · edit every field · chips fixed+custom · toggles ·
locale · live completion preview · save → ✓ SAVED + toast → reload → persisted · completion %
matches GET /api/v2/profile/completion · resend link (fresh unverified account) · keyboard pass ·
430 px · zero console errors. Exits 1 on any FAIL."""
import os, sys, json, time, zlib, struct, argparse, urllib.request
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

HERE = os.path.dirname(os.path.abspath(__file__))
QA = os.path.join(HERE, '..', '_qa', 'profile'); os.makedirs(QA, exist_ok=True)
FIX = os.path.join(QA, '_fixtures'); os.makedirs(FIX, exist_ok=True)

ap = argparse.ArgumentParser()
ap.add_argument('--base', default='http://localhost:8906')
ap.add_argument('--api', default='http://localhost:3966')
ap.add_argument('--design', default=os.path.join(HERE, '..', '..', '..', 'design', 'handoff', 'member-portal-2026-08-28'))
ap.add_argument('--email', default=os.environ.get('MEDX_QA_EMAIL', 'member003@staging.medx.hr'))
ap.add_argument('--password', default=os.environ.get('MEDX_QA_PASSWORD', 'Plexus2026!'))
ap.add_argument('--visual-email', default=os.environ.get('MEDX_QA_VISUAL_EMAIL', ''))
ap.add_argument('--shots-only', action='store_true')
ap.add_argument('--skip-resend', action='store_true')
ap.add_argument('--db', default=os.environ.get('MEDX_QA_DB', ''), help='scratch sqlite DB — lets the resend check flip the fixture account to unverified (register is born-verified when no mail provider is configured)')
a = ap.parse_args()

results, console = [], []
def check(name, ok, info=''):
    results.append((name, bool(ok), str(info)))
    print(('PASS ' if ok else 'FAIL ') + name + (('  — ' + str(info)) if info else ''))

def api_json(method, path, token=None, body=None):
    req = urllib.request.Request(a.api + path, method=method)
    req.add_header('Accept', 'application/json')
    if token: req.add_header('Authorization', 'Bearer ' + token)
    data = None
    if body is not None:
        req.add_header('Content-Type', 'application/json'); data = json.dumps(body).encode()
    try:
        with urllib.request.urlopen(req, data=data, timeout=30) as r: return json.load(r)
    except urllib.error.HTTPError as e:
        try: return json.load(e)
        except Exception: return {'error': f'HTTP {e.code}'}

def login(email, password):
    r = api_json('POST', '/api/auth/login', body={'email': email, 'password': password})
    if not r.get('token'): print('cannot log in as', email, '→', r.get('error')); sys.exit(1)
    return r['token']

TOKEN = os.environ.get('MEDX_QA_TOKEN') or login(a.email, a.password)
TOKEN_VIS = os.environ.get('MEDX_QA_TOKEN_VISUAL') or (login(a.visual_email, a.password) if a.visual_email else TOKEN)

# ---- fixtures: a real 2x2 PNG, a text file with .png name, a gif, a 6 MB blob ----
def png_bytes():
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    raw = b'\x00\x9b\x1b\x22\x9b\x1b\x22' * 2
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 2, 2, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))
P_OK = os.path.join(FIX, 'portrait.png');  open(P_OK, 'wb').write(png_bytes())
P_FAKE = os.path.join(FIX, 'fake.png');    open(P_FAKE, 'wb').write(b'not an image, only bytes ' * 20)
P_GIF = os.path.join(FIX, 'anim.gif');     open(P_GIF, 'wb').write(b'GIF89a' + b'\x00' * 40)
P_BIG = os.path.join(FIX, 'big.png');      open(P_BIG, 'wb').write(png_bytes() + b'\x00' * (6 * 1024 * 1024))

_last_toast = ['']
def toast(page):
    for _ in range(45):
        try: t = page.locator('.mx-toast.show').inner_text(timeout=200)
        except PWTimeout: t = ''
        if t and t != _last_toast[0]: _last_toast[0] = t; return t
        page.wait_for_timeout(100)
    return ''
def pct_ui(page):
    t = page.locator('[data-role=pct]').inner_text().strip()
    return int(t.rstrip('%')) if t.endswith('%') else None
def open_profile(page, token):
    page.goto(a.base + '/app/auth/welcome', wait_until='load')
    page.evaluate("t => { localStorage.setItem('medx_user_token', t); localStorage.removeItem('medx_user_data'); }", token)
    page.goto(a.base + '/app/profile', wait_until='networkidle')
    page.wait_for_timeout(1200)

# deterministic baseline for reruns (photo off, canonical field values)
api_json('DELETE', '/api/v2/profile/photo', TOKEN)
api_json('PATCH', '/api/v2/profile', TOKEN, {
    'first_name': 'Member 003', 'last_name': 'Test', 'title': '', 'institution': 'University of Rijeka',
    'city': '', 'country': 'Croatia', 'bio': '', 'specialties': [], 'is_public_profile': True,
    'updates_opt_in': True, 'locale': 'en'})

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    # ---------------- artboard shots (1280 + 430) ----------------
    art = os.path.join(a.design, 'Profile.dc.html')
    if os.path.exists(art):
        for w, name in [(1280, 'design-profile-1280.png'), (430, 'design-profile-430.png')]:
            p = browser.new_page(viewport={'width': w, 'height': 900})
            p.goto('file://' + os.path.abspath(art).replace(' ', '%20').replace('&', '%26'), wait_until='load')
            p.wait_for_timeout(900)
            p.screenshot(path=os.path.join(QA, name), full_page=True)
            print('artboard →', name)
            p.close()
    else:
        print('skip artboard (not found):', art)

    # ---------------- visual page shots (account closest to the artboard content) ----------------
    for w, name in [(1280, 'v2-profile-1280.png'), (430, 'v2-profile-430.png')]:
        p = browser.new_page(viewport={'width': w, 'height': 930})
        p.on('console', lambda m, n=name: console.append(f'[{n}] {m.type}: {m.text}') if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        p.on('pageerror', lambda e, n=name: console.append(f'[{n}] pageerror: {e}'))
        open_profile(p, TOKEN_VIS)
        p.screenshot(path=os.path.join(QA, name), full_page=True)
        print('v2 →', name)
        if w == 430:
            check('430px: no horizontal scroll', p.evaluate('document.documentElement.scrollWidth') <= 430,
                  p.evaluate('document.documentElement.scrollWidth'))
            check('430px: tab bar shown', p.locator('#mx-tabbar').is_visible())
        p.close()

    if not a.shots_only:
        page = browser.new_page(viewport={'width': 1280, 'height': 900})
        page.on('console', lambda m: console.append(f'{m.type}: {m.text}') if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        page.on('pageerror', lambda e: console.append(f'pageerror: {e}'))
        open_profile(page, TOKEN)

        # 1 · load + prefill from the server
        server = api_json('GET', '/api/v2/profile', TOKEN)
        check('screen renders', page.locator('[data-screen-label="Profile & Settings"]').count() == 1)
        check('fields prefilled from GET /api/v2/profile',
              page.locator('[data-field=institution]').input_value() == server['profile']['institution'],
              page.locator('[data-field=institution]').input_value())
        p0 = pct_ui(page)
        check('meter equals GET /api/v2/profile/completion', p0 == server['completion']['percent'], f'ui {p0} vs api {server["completion"]["percent"]}')

        # 2 · photo rejections (wrong type, spoofed bytes, oversize) — portrait must stay absent
        page.set_input_files('[data-role=photoInput]', P_GIF); t = toast(page)
        check('photo: .gif rejected client-side', 'jpg, png or webp' in t.lower(), t)
        page.set_input_files('[data-role=photoInput]', P_FAKE); t = toast(page)
        check('photo: spoofed .png rejected by server sniff', 'not a jpg, png or webp' in t.lower(), t)
        page.set_input_files('[data-role=photoInput]', P_BIG); t = toast(page)
        check('photo: >5 MB rejected', '5 MB' in t, t)
        check('photo: still initials after rejections', page.locator('[data-role=initials]').count() == 1)

        # 3 · valid upload → +20 on the meter, persisted server-side
        page.set_input_files('[data-role=photoInput]', P_OK); t = toast(page)
        page.wait_for_timeout(600)
        check('photo: valid PNG uploads (toast)', 'portrait saved' in t.lower(), t)
        check('photo: <img> swapped in', page.locator('img[data-role=photo]').count() == 1)
        check('photo: meter +20', pct_ui(page) == p0 + 20, f'{p0} → {pct_ui(page)}')
        check('photo: stored server-side', '/uploads/profile/' in (api_json('GET', '/api/v2/profile', TOKEN)['profile']['photo_url'] or ''))

        # 4 · edit EVERY field
        page.fill('[data-field=first_name]', 'Alenka'); page.fill('[data-field=last_name]', 'Testić')
        page.fill('[data-field=title]', 'Consultant neurologist'); page.fill('[data-field=institution]', 'KBC Zagreb')
        page.fill('[data-field=city]', 'Zagreb'); page.select_option('[data-field=country]', 'Austria')
        BIO = 'Neurologist working on sleep and circadian disorders; building bridges between Zagreb and Boston.'
        page.fill('[data-field=bio]', BIO)
        check('preview card follows the draft (name)', 'Alenka Testić' in page.locator('[data-block=preview]').inner_text())
        # chips: fixed toggles + custom via button and via Enter
        page.click('[data-act=tgSpec][data-spec=NEUROSCIENCE]')
        page.click('[data-act=tgSpec][data-spec=ONCOLOGY]')
        page.fill('[data-role=specDraft]', 'Chronobiology'); page.click('[data-act=addSpec]')
        page.fill('[data-role=specDraft]', 'EEG'); page.press('[data-role=specDraft]', 'Enter')
        on = page.locator('[data-act=tgSpec][aria-pressed=true]')
        names = [on.nth(i).inner_text() for i in range(on.count())]
        check('chips: fixed + custom selected', set(['NEUROSCIENCE', 'ONCOLOGY', 'CHRONOBIOLOGY', 'EEG']) <= set(names), names)
        # toggles + locale
        page.click('[data-act=tgDir]')
        check('directory toggle flips', page.locator('[data-act=tgDir]').get_attribute('aria-checked') == 'false')
        page.click('[data-act=tgUpd]')
        check('updates toggle flips', page.locator('[data-act=tgUpd]').get_attribute('aria-checked') == 'false')
        page.click('[data-act=setHR]'); t = toast(page)
        check('HR: preference + translations-pending toast', 'croatian' in t.lower() and page.locator('[data-act=setHR]').get_attribute('aria-pressed') == 'true', t)

        # 5 · live completion preview (server dry-run): clearing the bio drops the meter by 15
        page.wait_for_timeout(700); before = pct_ui(page)
        page.fill('[data-field=bio]', ''); page.wait_for_timeout(900)
        check('preview: clearing bio recomputes on the server (−15)', pct_ui(page) == before - 15, f'{before} → {pct_ui(page)}')
        page.fill('[data-field=bio]', BIO); page.wait_for_timeout(900)

        # 6 · save → ✓ SAVED + toast + chrome identity updates
        page.click('[data-act=save]'); t = toast(page); page.wait_for_timeout(400)
        check('save: toast', 'CHANGES SAVED' in t, t)
        check('save: ✓ SAVED state', '✓ SAVED' in page.locator('[data-block=saveRow]').inner_text())
        check('save: chrome identity renamed', 'Alenka Testić' in page.locator('#mx-desktop-chrome').inner_text())

        # 7 · reload → everything persisted; meter matches the server
        page.reload(wait_until='networkidle'); page.wait_for_timeout(1200)
        vals = {k: page.locator(f'[data-field={k}]').input_value() for k in ['first_name', 'last_name', 'title', 'institution', 'city', 'country', 'bio']}
        check('persisted: text fields', vals == {'first_name': 'Alenka', 'last_name': 'Testić', 'title': 'Consultant neurologist',
              'institution': 'KBC Zagreb', 'city': 'Zagreb', 'country': 'Austria', 'bio': BIO}, vals)
        on = page.locator('[data-act=tgSpec][aria-pressed=true]')
        names = sorted(on.nth(i).inner_text() for i in range(on.count()))
        check('persisted: chips', names == ['CHRONOBIOLOGY', 'EEG', 'NEUROSCIENCE', 'ONCOLOGY'], names)
        check('persisted: toggles off', page.locator('[data-act=tgDir]').get_attribute('aria-checked') == 'false'
              and page.locator('[data-act=tgUpd]').get_attribute('aria-checked') == 'false')
        check('persisted: locale HR', page.locator('[data-act=setHR]').get_attribute('aria-pressed') == 'true')
        sc = api_json('GET', '/api/v2/profile/completion', TOKEN)
        check('meter matches server after save', pct_ui(page) == sc['percent'], f'ui {pct_ui(page)} vs api {sc["percent"]}')
        srv = api_json('GET', '/api/v2/profile', TOKEN)['profile']
        check('server row matches UI', srv['city'] == 'Zagreb' and srv['country'] == 'Austria' and srv['locale'] == 'hr'
              and srv['updates_opt_in'] is False and srv['is_public_profile'] is False and 'EEG' in srv['specialties'], srv['specialties'])

        # 8 · directory preview modal + connect toast (own card)
        page.click('[data-act=viewProfile]'); page.wait_for_timeout(300)
        check('VIEW PROFILE opens the as-others-see-you modal', 'AS OTHERS SEE YOU' in page.locator('.mx-modal').inner_text())
        page.keyboard.press('Escape'); page.wait_for_timeout(200)
        page.click('[data-act=connect]'); t = toast(page)
        check('CONNECT explains (own card)', 'your own card' in t.lower(), t)

        # 9 · keyboard pass: chips toggle with Space/Enter, switches with Enter, Enter adds a custom tag
        page.focus('[data-act=tgSpec][data-spec=CARDIOLOGY]'); page.keyboard.press('Space'); page.wait_for_timeout(150)
        check('keyboard: Space toggles a chip on', page.locator('[data-act=tgSpec][data-spec=CARDIOLOGY]').get_attribute('aria-pressed') == 'true')
        page.focus('[data-act=tgSpec][data-spec=CARDIOLOGY]'); page.keyboard.press('Enter'); page.wait_for_timeout(150)
        check('keyboard: Enter toggles it back off', page.locator('[data-act=tgSpec][data-spec=CARDIOLOGY]').get_attribute('aria-pressed') == 'false')
        page.focus('[data-act=tgDir]'); page.keyboard.press('Enter'); page.wait_for_timeout(150)
        check('keyboard: Enter flips a switch', page.locator('[data-act=tgDir]').get_attribute('aria-checked') == 'true')
        page.focus('[data-act=save]'); page.keyboard.press('Enter'); t = toast(page)
        check('keyboard: Enter on SAVE saves', 'CHANGES SAVED' in t, t)

        # 10 · RESEND LINK — needs an unverified account (all seed users are verified): register one
        if not a.skip_resend:
            fresh = f'qa.profile+{int(time.time())}@example.com'
            reg = api_json('POST', '/api/auth/register', body={'email': fresh, 'password': 'Passw0rd!x',
                  'first_name': 'Resend', 'last_name': 'Check', 'country': 'Croatia'})
            if reg.get('token') and a.db:
                # with no mail provider the account is born VERIFIED (server.js /api/auth/register) —
                # flip the fixture row so the unconfirmed state and RESEND LINK are exercised for real
                import subprocess
                subprocess.run(['sqlite3', a.db, f"UPDATE users SET email_verified=0 WHERE email='{fresh}'"], check=True)
                open_profile(page, reg['token'])
                check('unverified account shows "not yet confirmed"', 'not yet confirmed' in page.locator('#view').inner_text())
                page.click('#view [data-act=resend]'); t = toast(page)
                check('RESEND LINK → toast from the endpoint', ('link' in t.lower()) or ('confirm' in t.lower()), t)
                check('RESEND control debounced after use', page.locator('#view [data-act=resend][aria-disabled=true]').count() == 1)
            elif reg.get('token'):
                print('skip resend fixture: pass --db to flip the account to unverified (born-verified without a mail provider)')
            else:
                check('RESEND LINK (register for fixture)', False, reg.get('error'))
        page.close()
    browser.close()

open(os.path.join(QA, 'console.txt'), 'w').write('\n'.join(console) + '\n')
fails = [r for r in results if not r[1]]
check_line = f'{len(results) - len(fails)}/{len(results)} checks passed · console errors: {len(console)}'
open(os.path.join(QA, 'results.txt'), 'w').write('\n'.join(('PASS ' if ok else 'FAIL ') + n + ('  — ' + i if i else '') for n, ok, i in results) + '\n' + check_line + '\n')
print('\n' + check_line)
for e in console[:20]: print('  console:', e)
sys.exit(1 if fails or console else 0)
