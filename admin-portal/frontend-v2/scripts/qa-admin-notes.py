#!/usr/bin/env python3
"""qa-admin-notes.py — Playwright walk of the NOTES section (js/views/notes.js) at 390×844 and 1280.

  python3 scripts/qa-admin-notes.py --base http://localhost:8910 --email vp@medx.hr --password admin123 --out /tmp/qa-notes
  python3 scripts/qa-admin-notes.py --base https://medx-admin-portal-v2.netlify.app --email … --password … --out … --event Boston

Logs in ONCE through /api/auth/login (the limiter is 15 tries / 15 min) and reuses the token in
localStorage for every page. Flow: composer (phone) → a DAY note → an EVENT note (the chip whose
label matches --event, default "Boston") with a tagged person → PIN → the event page → EXPORT (the
signed page is fetched and rendered) → desktop stream + event page + the Today tile → the test notes
are DELETED again (pass --keep to leave them). Exit code = number of failed checks.
"""
import argparse, json, os, re, sys, time, urllib.request
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--base', required=True)
ap.add_argument('--email', default=os.environ.get('MEDX_QA_EMAIL', ''))
ap.add_argument('--password', default=os.environ.get('MEDX_QA_PASSWORD', ''))
ap.add_argument('--token', default=os.environ.get('MEDX_QA_TOKEN', ''))
ap.add_argument('--out', required=True)
ap.add_argument('--event', default='Boston', help='regex matched against the event chip labels')
ap.add_argument('--keep', action='store_true')
a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)
STAMP = time.strftime('%H:%M')
TAG = 'QA-notes ' + time.strftime('%Y%m%d-%H%M%S')

fails = []
def check(name, cond, detail=''):
    print(('PASS' if cond else 'FAIL') + ' | ' + name + ((' | ' + str(detail)[:200]) if detail else ''))
    if not cond: fails.append(name)

def api(path, method='GET', body=None, token=None):
    req = urllib.request.Request(a.base + path, data=(json.dumps(body).encode() if body is not None else None), method=method,
                                 headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + token} if token else {})})
    try:
        with urllib.request.urlopen(req, timeout=60) as r: return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b'null')
        except Exception: return e.code, None

if a.token: token, user = a.token, None
else:
    st, d = api('/api/auth/login', 'POST', {'email': a.email, 'password': a.password})
    if st != 200 or not d or not d.get('token'): sys.exit('login failed: %s %s' % (st, d))
    token, user = d['token'], json.dumps(d.get('user'))
print('signed in once as', a.email or 'token')

errors = []
def watch(page, name):
    page.on('console', lambda m, n=name: errors.append(f'[{n}] {m.type}: {m.text}') if m.type == 'error' else None)
    page.on('pageerror', lambda e, n=name: errors.append(f'[{n}] pageerror: {e}'))
def shot(page, name):
    p = os.path.join(a.out, name + '.png'); page.screenshot(path=p, full_page=True); print('  →', p)
def authed(browser, w, h, name):
    page = browser.new_page(viewport={'width': w, 'height': h}, device_scale_factor=2 if w < 500 else 1, is_mobile=w < 500, has_touch=w < 500)
    watch(page, name)
    page.goto(a.base + '/signin', wait_until='load')
    page.evaluate("([t,u]) => { localStorage.setItem('medx_token', t); if (u) localStorage.setItem('medx_user', u); }", [token, user])
    return page
def no_hscroll(page, name):
    sw, cw = page.evaluate('() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]')
    check(f'{name}: no horizontal scroll ({sw} ≤ {cw})', sw <= cw + 1)

created = []
with sync_playwright() as pw:
    browser = pw.chromium.launch()
    # ---------------------------------------------------------------- PHONE 390×844
    m = authed(browser, 390, 844, 'phone')
    m.goto(a.base + '/notes?new=1', wait_until='networkidle'); m.wait_for_timeout(1200)
    check('phone: /notes renders the composer', m.locator('[data-role=cBody]').count() == 1)
    check('phone: NOTES is in the chrome nav (MENU on a phone) or the page is active', m.evaluate("() => document.body.innerText.includes('NOTES') || !!document.querySelector('.mx-notes')"))
    focused = m.evaluate("() => document.activeElement && document.activeElement.dataset && document.activeElement.dataset.role")
    check('phone: ?new=1 focuses the composer', focused == 'cBody', focused)
    base_font = m.evaluate("() => parseFloat(getComputedStyle(document.querySelector('.mx-notes')).fontSize)")
    check('phone: base font ≥ 15px', base_font >= 15, base_font)
    shot(m, '01-phone-composer'); no_hscroll(m, 'phone composer')
    # a DAY note
    m.click('[data-act=cEvent][data-k=""]')
    m.fill('[data-role=cBody]', f'{TAG} · day note. Laura: Esplanade confirmed the tasting for Friday 14:00, bring the seating draft.')
    m.click('[data-act=save]'); m.wait_for_timeout(2500)
    day_card = m.locator(f'.mx-note:has-text("{TAG} · day note")')
    check('phone: the day note lands on the stream', day_card.count() >= 1)
    if day_card.count(): created.append(day_card.first.get_attribute('data-note'))
    check('phone: the day note carries the DAY NOTE chip', day_card.count() and 'DAY NOTE' in day_card.first.inner_text())
    shot(m, '02-phone-day-note-saved'); no_hscroll(m, 'phone after day note')
    # an EVENT note with a person
    chips = m.locator('[data-act=cEvent]')
    labels = [chips.nth(i).inner_text() for i in range(chips.count())]
    idx = next((i for i, l in enumerate(labels) if re.search(a.event, l, re.I)), None)
    if idx is None: idx = next((i for i, l in enumerate(labels) if chips.nth(i).get_attribute('data-k') not in ('', '__custom')), None)
    check('phone: an event chip is offered', idx is not None, labels)
    ev_key = None
    if idx is not None:
        chips.nth(idx).click(); m.wait_for_timeout(200)
        ev_key = m.locator('[data-act=cEvent].on').first.get_attribute('data-k')
        ev_label = m.locator('[data-act=cEvent].on').first.inner_text().replace('TODAY', '').strip()
        m.fill('[data-role=cTitle]', f'{TAG} · met a sleep researcher')
        m.fill('[data-role=cBody]', 'Met Prof. QA Tester (MGH sleep lab) by the coffee table. She wants to co-host a satellite session next spring.\nAgreed: Alen sends the one-pager, she introduces us to her dean.\nFollow-up: Laura books a call in the first week of October.')
        m.fill('[data-role=cPerson]', 'Prof. QA Tester, MGH'); m.press('[data-role=cPerson]', 'Enter'); m.wait_for_timeout(200)
        check('phone: Enter turns the typed person into a chip', m.locator('[data-block=composer] .mx-person:has-text("Prof. QA Tester")').count() == 1)
        shot(m, '03-phone-composer-filled')
        m.click('[data-act=save]'); m.wait_for_timeout(2500)
        ev_card = m.locator(f'.mx-note:has-text("{TAG} · met a sleep researcher")')
        check('phone: the event note lands on the stream', ev_card.count() >= 1)
        if ev_card.count():
            created.append(ev_card.first.get_attribute('data-note'))
            txt = ev_card.first.inner_text()
            check('phone: the card shows the event chip', ev_label.split('·')[0].strip()[:12].upper() in txt.upper(), txt[:120])
            check('phone: the card shows the tagged person', 'Prof. QA Tester' in txt)
            # PIN
            ev_card.first.locator('[data-act=pin]').click(); m.wait_for_timeout(1500)
            check('phone: PIN marks the card pinned', 'pinned' in (m.locator(f'.mx-note:has-text("{TAG} · met a sleep researcher")').first.get_attribute('class') or ''))
            shot(m, '04-phone-event-note-pinned'); no_hscroll(m, 'phone after event note')
            # tap targets ≥ 44px on the card actions and the save button
            small = m.evaluate("() => Array.from(document.querySelectorAll('.mx-note-btn, .mx-nc-save, .mx-chip, .mx-nr-item')).filter(el => el.getBoundingClientRect().height < 44 && el.getBoundingClientRect().height > 0).map(el => el.className + ':' + Math.round(el.getBoundingClientRect().height))")
            check('phone: every action ≥ 44px tall', not small, small[:6])
            # the event page
            m.locator(f'.mx-note:has-text("{TAG} · met a sleep researcher") a.mx-note-ev').first.click(); m.wait_for_timeout(1800)
            check('phone: the event chip opens the event page', '?event=' in m.url and m.locator('[data-block=evhead]').count() == 1, m.url)
            head = m.locator('[data-block=evhead]').inner_text() if m.locator('[data-block=evhead]').count() else ''
            check('phone: the event page rolls up people met', 'PEOPLE MET' in head and 'Prof. QA Tester' in head, head[:160])
            check('phone: EXPORT is offered', m.locator('.mx-ev-export').count() == 1)
            shot(m, '05-phone-event-page'); no_hscroll(m, 'phone event page')
            # EXPORT — the signed page
            href = m.locator('.mx-ev-export').get_attribute('href') if m.locator('.mx-ev-export').count() else None
            if href:
                ex = browser.new_page(viewport={'width': 900, 'height': 1000}); watch(ex, 'export')
                ex.goto(href if href.startswith('http') else a.base + href, wait_until='load'); ex.wait_for_timeout(600)
                body = ex.inner_text('body')
                check('export: the page carries the note, the person and the event heading', ('met a sleep researcher' in body) and ('Prof. QA Tester' in body) and ('people met' in body.lower()), body[:160])
                shot(ex, '06-export-page'); ex.close()
    m.close()

    # ---------------------------------------------------------------- DESKTOP 1280
    d = authed(browser, 1280, 900, 'desktop')
    d.goto(a.base + '/notes', wait_until='networkidle'); d.wait_for_timeout(1200)
    check('desktop: NOTES nav item present next to TASKS', d.evaluate("() => { const t = Array.from(document.querySelectorAll('#chrome a')).map(a => a.textContent.trim()); const i = t.findIndex(x => x.startsWith('TASKS')); return i >= 0 && t[i + 1] === 'NOTES'; }"), d.evaluate("() => Array.from(document.querySelectorAll('#chrome a')).map(a => a.textContent.trim()).join(' | ')"))
    check('desktop: the rail is a left column', d.evaluate("() => { const r = document.querySelector('.mx-nr'), s = document.querySelector('.mx-ns'); return r && s && r.getBoundingClientRect().right <= s.getBoundingClientRect().left + 1; }"))
    check('desktop: the stream shows both test notes', d.locator(f'.mx-note:has-text("{TAG}")').count() >= (2 if ev_key else 1))
    shot(d, '07-desktop-stream')
    # search by person
    d.fill('[data-role=search]', 'QA Tester'); d.wait_for_timeout(1200)
    check('desktop: search by person narrows the stream', d.locator('.mx-note').count() >= 1 and d.locator('.mx-note:has-text("Prof. QA Tester")').count() >= 1)
    d.fill('[data-role=search]', ''); d.wait_for_timeout(900)
    if ev_key:
        d.goto(a.base + '/notes?event=' + ev_key, wait_until='networkidle'); d.wait_for_timeout(1200)
        check('desktop: the event page renders with EXPORT', d.locator('[data-block=evhead] .mx-ev-export').count() == 1)
        shot(d, '08-desktop-event-page')
        # inline edit: autosave on blur
        nid = d.locator(f'.mx-note:has-text("{TAG} · met a sleep researcher")').first.get_attribute('data-note')
        card = d.locator(f'.mx-note[data-note="{nid}"]')
        card.locator('[data-act=edit]').click(); d.wait_for_timeout(300)
        ta = card.locator('[data-role=eBody]')
        ta.fill(ta.input_value() + '\nEdited on desktop — autosaved on blur.'); ta.blur(); d.wait_for_timeout(1500)
        card.locator('[data-act=doneEdit]').click(); d.wait_for_timeout(1200)
        check('desktop: inline edit persisted', 'autosaved on blur' in card.inner_text())
        shot(d, '09-desktop-after-edit')
    d.goto(a.base + '/today', wait_until='networkidle'); d.wait_for_timeout(1500)
    tile = d.locator('[data-block=notes]')
    check('today: the NOTES tile is on the page with ADD A NOTE', tile.count() == 1 and 'ADD A NOTE' in tile.inner_text(), tile.inner_text()[:160] if tile.count() else '')
    if tile.count():
        tile.scroll_into_view_if_needed(); d.wait_for_timeout(300)
        tile.screenshot(path=os.path.join(a.out, '10-today-notes-tile.png')); print('  →', os.path.join(a.out, '10-today-notes-tile.png'))
    d.close()
    browser.close()

# ---------------------------------------------------------------- cleanup
if not a.keep:
    for nid in created:
        st, _ = api('/api/v2/notes/' + nid, 'DELETE', token=token)
        print('cleanup: deleted', nid, st)
else:
    print('kept notes:', created)

bad = [e for e in errors if 'favicon' not in e and 'net::ERR_' not in e and 'Failed to load resource' not in e]
res = [e for e in errors if 'Failed to load resource' in e]
if res: print('info: %d failed resource load(s) (proxied health probes etc.):' % len(res), res[:3])
check('no JS page errors / console errors', not bad, bad[:5])
print('\n%d failed' % len(fails)); sys.exit(len(fails))
