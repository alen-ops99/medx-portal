#!/usr/bin/env python3
"""scripts/qa-admin-plexus.py — QA for the PLEXUS HUB destination (js/views/plexus.js):
artboard-vs-page screenshots at 1440 px into _qa/admin-plexus/ + Playwright flows exercising
every control (conference edit · sign-up form open/close · speaker add/edit/confirm/live/photo/
meta/delete · session add/edit/publish/delete · Q&A answer/hide · member-card save · stats
override + copy line · CME export · dashed affordance toasts · every row's door). Zero console
errors on the Plexus screen; errors captured on OTHER screens (other builders' views, reached
through doors) are reported but do not fail this screen's QA.

   MEDX_QA_TOKEN=<jwt> python3 scripts/qa-admin-plexus.py --base http://localhost:8911
   MEDX_QA_EMAIL=pjero.bacic@medx.hr MEDX_QA_PASSWORD='Plexus2026!' python3 scripts/qa-admin-plexus.py

Run as a FULL-ACCESS admin (allowed_sections NULL) against a scratch copy of the seed DB.
The auth limiter allows 15 logins / 15 min — reuse MEDX_QA_TOKEN.
"""
import os, sys, json, time, argparse, urllib.request
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..'))
QA = os.path.join(ROOT, '_qa', 'admin-plexus'); os.makedirs(QA, exist_ok=True)
ap = argparse.ArgumentParser()
ap.add_argument('--base', default='http://localhost:8911')
ap.add_argument('--design', default=os.path.abspath(os.path.join(ROOT, '..', '..', 'design', 'handoff', 'admin-portal-2026-08-28')))
ap.add_argument('--token', default=os.environ.get('MEDX_QA_TOKEN', ''))
ap.add_argument('--email', default=os.environ.get('MEDX_QA_EMAIL', ''))
ap.add_argument('--password', default=os.environ.get('MEDX_QA_PASSWORD', ''))
ap.add_argument('--width', type=int, default=1440)
a = ap.parse_args()
PATH = '/projects/plexus'

def login():
    if a.token: return a.token, None
    if not (a.email and a.password): sys.exit('need MEDX_QA_TOKEN or MEDX_QA_EMAIL + MEDX_QA_PASSWORD')
    req = urllib.request.Request(a.base + '/api/auth/login', data=json.dumps({'email': a.email, 'password': a.password}).encode(), headers={'Content-Type': 'application/json'})
    d = json.load(urllib.request.urlopen(req))
    return d['token'], json.dumps(d['user'])

errors, foreign = [], []
passed = []
def ok(name): passed.append(name); print('  ✓', name)
def watch(page):
    def on_console(m):
        if m.type != 'error': return
        (errors if PATH in page.url else foreign).append(f'[{page.url}] {m.text}')
    page.on('console', on_console)
    page.on('pageerror', lambda e: (errors if PATH in page.url else foreign).append(f'[{page.url}] pageerror: {e}'))

def toast(page):
    t = page.locator('.mx-toast.show')
    t.wait_for(state='visible', timeout=4000)
    return t.inner_text()

def toast_contains(page, sub, timeout=5000):
    # the toast element is reused, so poll for the EXPECTED text (a stale toast may still be up)
    deadline = time.time() + timeout / 1000
    last = ''
    while time.time() < deadline:
        t = page.locator('.mx-toast.show')
        if t.count():
            last = t.inner_text()
            if sub in last: return last
        page.wait_for_timeout(120)
    raise AssertionError(f'toast with "{sub}" not seen (last: "{last}")')

def open_hub(page, wait=1400):
    # 'load' + explicit root wait — networkidle is flaky when the twin backend's periodic
    # sweeps write to the shared scratch DB mid-run
    page.goto(a.base + PATH, wait_until='load')
    page.locator('[data-screen-label="Admin Plexus Hub"]').wait_for(state='attached', timeout=25000)
    page.wait_for_timeout(wait)

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    ctx = browser.new_context(viewport={'width': a.width, 'height': 900}, permissions=['clipboard-read', 'clipboard-write'])
    token, user = login()

    # ---- artboard reference shot ----
    art = os.path.join(a.design, 'Admin Plexus Hub.dc.html')
    if os.path.exists(art):
        p0 = ctx.new_page()
        p0.goto('file://' + art.replace(' ', '%20').replace('&', '%26'), wait_until='load'); p0.wait_for_timeout(1200)
        p0.screenshot(path=os.path.join(QA, 'design-plexus.png'), full_page=True); print('artboard → design-plexus.png')
        p0.close()

    page = ctx.new_page(); watch(page)
    page.goto(a.base + '/signin', wait_until='load')
    page.evaluate("([t,u]) => { localStorage.setItem('medx_token', t); if (u) localStorage.setItem('medx_user', u); }", [token, user])
    open_hub(page)
    assert page.locator('[data-screen-label="Admin Plexus Hub"]').count() == 1, 'hub root must render'
    dw = page.evaluate('document.documentElement.scrollWidth')
    assert dw <= a.width, f'page must not scroll horizontally (scrollWidth {dw} > viewport {a.width})'
    page.screenshot(path=os.path.join(QA, 'v2-plexus.png'), full_page=True); print('v2 → v2-plexus.png', page.url)

    # ================= doors: every row/stat/button navigates (or opens its panel/modal) =========
    doors = [  # (selector, expected path-in-url)
        ('[data-row="regs"]', '/registrations'),
        ('[data-row="travel"]', '/calendar'),
        ('[data-row="prices"]', '/money'),
        ('[data-row="outbox"]', '/inbox/outbox'),
        ('[data-row="links"]', '/links'),
        ('[data-row="cme"]', '/settings'),
        ('[data-row="gala-seats"]', '/gala'),
        ('[data-row="gala-waitlist"]', '/gala'),
        ('[data-row="gala-donor"]', '/links'),
        ('[data-row="gala-onday"]', '/event-day'),
        ('[data-row="gala-auctions"]', '/money'),
        ('.mx-kpi > a[href="/registrations"]', '/registrations'),
        ('.mx-kpi > a[href="/gala"]', '/gala'),
        ('.mx-kpi > a[href="/money"]', '/money'),
        ('.mxp-dates a[href="/calendar"]', '/calendar'),
        ('a[href="/member-pages"] >> nth=0', '/member-pages'),          # WHAT MEMBERS SEE — MANAGE
        ('a[href="/event-day"] >> nth=0', '/event-day'),                # EVENT DAY ROOM
        ('a[href="/projects/accelerator"] >> nth=0', '/projects/accelerator'),
    ]
    for sel, expect in doors:
        open_hub(page, 900)
        el = page.locator(sel).first
        assert el.count(), f'door missing: {sel}'
        el.click(); page.wait_for_timeout(700)
        assert expect in page.url, f'door {sel} → expected {expect}, got {page.url}'
    ok(f'{len(doors)} doors navigate')
    open_hub(page, 900)
    href = page.locator('[data-row="gala-planner"]').get_attribute('href')
    assert href == 'https://plexus-tables.netlify.app/planner.html', '3D planner must link to the external planner'
    ok('3D planner external link')
    # sign-up form row door (RESPONSES →)
    if page.locator('[data-row^="form-"]').count():
        page.locator('[data-row^="form-"] a[href="/links"]').first.click(); page.wait_for_timeout(600)
        assert '/links' in page.url, 'form RESPONSES door must open /links'
        ok('form responses door')
    # panel rows open their inline manage panels; pe/editions open modals; pill scrolls
    open_hub(page, 900)
    page.click('[data-row="speakers"]'); page.wait_for_timeout(400)
    assert page.locator('[data-block="spPanel"]').count(), 'speakers row must open the manage panel'
    page.click('[data-row="schedule"]'); page.wait_for_timeout(400)
    assert page.locator('[data-block="ssPanel"]').count(), 'schedule row must open the builder panel'
    page.click('[data-row="qa"]'); page.wait_for_timeout(400)
    assert page.locator('[data-block="qaPanel"]').count(), 'Q&A row must open the moderation panel'
    page.screenshot(path=os.path.join(QA, 'v2-plexus-qa-panel.png'), full_page=True)
    page.click('[data-row="pe-certs"]'); page.wait_for_timeout(700)
    assert page.locator('.mx-modal').count(), 'post-event row must open the details modal'
    page.keyboard.press('Escape'); page.wait_for_timeout(200)
    page.click('[data-row="editions"]'); page.wait_for_timeout(500)
    assert 'edition' in page.locator('.mx-modal').inner_text().lower(), 'editions row must open the editions modal'
    page.keyboard.press('Escape')
    page.click('[data-act="msFocus"]'); page.wait_for_timeout(400)
    assert PATH in page.url, 'status pill stays on the hub (scrolls to the member card)'
    ok('panel rows, modals, status pill')
    # dashed affordances + ✎ EDIT LIST answer with a real toast
    for act, sub in (('start2027', 'AVAILABLE AFTER'), ('archiveNote', 'AVAILABLE AFTER'), ('editList', 'FOLLOWS THE LIVE DATA')):
        page.click(f'[data-act="{act}"]')
        toast_contains(page, sub)
        page.wait_for_timeout(300)
    ok('dashed affordances toast')

    # ================= conference settings (✎ EDIT → PUT /api/admin/conferences/:id) =============
    open_hub(page)
    page.click('[data-act="editConf"]'); page.wait_for_timeout(300)
    cap0 = page.locator('.mx-modal [data-role="cfCap"]').input_value()
    page.fill('.mx-modal [data-role="cfCap"]', '150')
    page.click('.mx-modal .btn-primary'); page.wait_for_timeout(1200)
    assert 'cap 150' in page.locator('[data-block="title"]').inner_text(), 'facts line must show the new capacity'
    page.click('[data-act="editConf"]'); page.wait_for_timeout(300)
    page.fill('.mx-modal [data-role="cfCap"]', cap0)
    page.click('.mx-modal .btn-primary'); page.wait_for_timeout(1000)
    assert f'cap {cap0}' in page.locator('[data-block="title"]').inner_text(), 'capacity restored'
    ok('conference edit modal saves live')

    # ================= sign-up form open/close =====================================================
    row = page.locator('[data-row^="form-"]').first
    if row.count():
        before = row.inner_text()
        row.locator('[data-act="formToggle"]').click(); page.wait_for_timeout(1200)
        after = page.locator('[data-row^="form-"]').first.inner_text()
        assert before != after, 'form status must flip'
        page.locator('[data-row^="form-"] [data-act="formToggle"]').first.click(); page.wait_for_timeout(1200)
        assert page.locator('[data-row^="form-"]').first.inner_text() == before, 'form status restored'
        ok('sign-up form open/close')

    # ================= speakers: confirm toggle · add · edit(meta+photo) · live · delete ==========
    open_hub(page)
    page.click('[data-row="speakers"]'); page.wait_for_timeout(500)
    first = page.locator('[data-block="spPanel"] [data-row^="sp-"]').first
    tag0 = first.locator('[data-act="spConfirm"]').inner_text()
    first.locator('[data-act="spConfirm"]').click(); page.wait_for_timeout(1100)
    tag1 = page.locator('[data-block="spPanel"] [data-row^="sp-"]').first.locator('[data-act="spConfirm"]').inner_text()
    assert tag0 != tag1 and {'CONFIRMED', 'PENDING'} == {tag0, tag1}, f'confirmed flag must flip ({tag0} → {tag1})'
    page.locator('[data-block="spPanel"] [data-row^="sp-"]').first.locator('[data-act="spConfirm"]').click(); page.wait_for_timeout(1100)
    ok('speaker confirmed toggle (and back)')
    n0 = page.locator('[data-row^="sp-"]').count()
    page.fill('[data-role="spName"]', 'QA Test Speaker'); page.fill('[data-role="spTitle"]', 'Professor'); page.fill('[data-role="spInst"]', 'QA University')
    page.click('[data-act="spSave"]'); page.wait_for_timeout(1400)
    assert page.locator('[data-row^="sp-"]').count() == n0 + 1, 'added speaker must appear'
    qa_row = page.locator('[data-row^="sp-"]', has_text='QA Test Speaker')
    qa_row.locator('[data-act="spEditBtn"]').click(); page.wait_for_timeout(500)
    assert page.locator('[data-role="spName"]').input_value() == 'QA Test Speaker', 'edit must prefill'
    page.fill('[data-role="spLogo"]', 'https://example.org/logo.png')
    page.select_option('[data-role="spTag"]', 'both')
    # photo upload through the existing /api/upload/speakers route (1×1 transparent PNG)
    png = os.path.join(QA, 'qa-1px.png')
    open(png, 'wb').write(bytes.fromhex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6260010000000500010d0a2db40000000049454e44ae426082'))
    page.set_input_files('[data-role="spPhotoFile"]', png); page.wait_for_timeout(1800)
    assert page.locator('[data-role="spLogo"]').input_value() == 'https://example.org/logo.png', 'photo upload must not wipe unsaved edit fields'
    page.click('[data-act="spSave"]'); page.wait_for_timeout(1400)
    row = page.locator('[data-row^="sp-"]', has_text='QA Test Speaker')
    assert 'BOTH' in row.inner_text(), 'event tag must show on the speaker row'
    assert row.locator('img').count() == 1, 'uploaded photo must render on the row'
    row.locator('[data-act="spLive"]').click(); page.wait_for_timeout(1100)
    assert 'LIVE' in page.locator('[data-row^="sp-"]', has_text='QA Test Speaker').locator('[data-act="spLive"]').inner_text(), 'live toggle'
    page.locator('[data-row^="sp-"]', has_text='QA Test Speaker').locator('[data-act="spDel"]').click(); page.wait_for_timeout(300)
    page.click('.mx-modal .btn-primary'); page.wait_for_timeout(1200)
    assert page.locator('[data-row^="sp-"]', has_text='QA Test Speaker').count() == 0, 'deleted speaker must leave the list'
    ok('speaker add / edit / photo / meta / live / delete')

    # ================= schedule: add · edit · publish · publish-all guard · delete ===============
    page.click('[data-row="schedule"]'); page.wait_for_timeout(500)
    page.fill('[data-role="ssTitle"]', 'QA Opening Session'); page.fill('[data-role="ssStart"]', '09:00'); page.fill('[data-role="ssEnd"]', '09:45'); page.fill('[data-role="ssRoom"]', 'Main hall')
    page.click('[data-act="ssSave"]'); page.wait_for_timeout(1400)
    srow = page.locator('[data-row^="ss-"]', has_text='QA Opening Session')
    assert srow.count() == 1, 'added session must appear'
    assert 'DRAFT' in srow.inner_text(), 'new session starts as draft'
    srow.locator('[data-act="ssEditBtn"]').click(); page.wait_for_timeout(400)
    page.fill('[data-role="ssTitle"]', 'QA Opening Session — edited')
    page.click('[data-act="ssSave"]'); page.wait_for_timeout(1400)
    srow = page.locator('[data-row^="ss-"]', has_text='QA Opening Session — edited')
    assert srow.count() == 1, 'edited title must render'
    srow.locator('[data-act="ssPubOne"]').click(); page.wait_for_timeout(1200)
    assert 'LIVE' in page.locator('[data-row^="ss-"]', has_text='QA Opening Session — edited').inner_text(), 'published tag'
    assert 'PUBLISHED' in page.locator('[data-row="schedule"]').inner_text(), 'row tag counts the published session'
    page.locator('[data-row^="ss-"]', has_text='QA Opening Session — edited').locator('[data-act="ssDel"]').click(); page.wait_for_timeout(300)
    page.click('.mx-modal .btn-primary'); page.wait_for_timeout(1200)
    assert page.locator('[data-row^="ss-"]').count() == 0, 'deleted session must leave the list'
    ok('session add / edit / publish / delete')

    # ================= Q&A: hide/unhide + answer ==================================================
    page.click('[data-row="qa"]'); page.wait_for_timeout(500)
    qrow = page.locator('[data-row^="qa-"]').first
    if qrow.count():
        lbl = qrow.locator('[data-act="qaHide"]').inner_text()
        qrow.locator('[data-act="qaHide"]').click(); page.wait_for_timeout(1100)
        assert page.locator('[data-row^="qa-"]').first.locator('[data-act="qaHide"]').inner_text() != lbl, 'hide label must flip'
        page.locator('[data-row^="qa-"]').first.locator('[data-act="qaHide"]').click(); page.wait_for_timeout(1100)
        openq = page.locator('[data-row^="qa-"]', has_text='ANSWER').first
        if page.locator('[data-act="qaAnswer"]').count():
            page.locator('[data-act="qaAnswer"]').first.click(); page.wait_for_timeout(300)
            page.fill('.mx-modal [data-role="qaText"]', 'Yes — the slides land in the member portal after the week.')
            page.click('.mx-modal .btn-primary'); page.wait_for_timeout(1200)
            assert page.locator('[data-row^="qa-"]', has_text='ANSWERED').count() >= 1, 'answered tag must appear'
        ok('Q&A hide/unhide + answer')

    # ================= WHAT MEMBERS SEE saves to the member portal row ============================
    open_hub(page)
    label0 = page.locator('[data-role="msLabel"]').input_value()
    page.fill('[data-role="msLabel"]', 'QA status line')
    page.click('[data-act="msSave"]'); page.wait_for_timeout(1300)
    assert 'SAVED' in page.locator('[data-role="msSaveBtn"]').inner_text(), 'save button must flip to ✓ SAVED'
    open_hub(page)
    assert page.locator('[data-role="msLabel"]').input_value() == 'QA status line', 'status label must persist server-side'
    page.fill('[data-role="msLabel"]', label0)
    page.click('[data-act="msSave"]'); page.wait_for_timeout(1200)
    ok('member card status/detail persists')

    # ================= stats widget: override → copy line → clear =================================
    live0 = page.locator('[data-row="fig-registered"]').inner_text()
    page.click('[data-row="fig-registered"] [data-act="ovEdit"]'); page.wait_for_timeout(300)
    page.fill('[data-role="ovInput"]', '250')
    page.click('[data-act="ovSave"]'); page.wait_for_timeout(1100)
    fig = page.locator('[data-row="fig-registered"]').inner_text()
    assert '250' in fig and 'MANUAL' in fig, 'override must show with the MANUAL tag'
    assert '250' in page.locator('[data-role="statsLine"]').inner_text(), 'copy line must use the override'
    page.click('[data-act="copyStats"]')
    toast_contains(page, 'COPIED')
    clip = page.evaluate('navigator.clipboard.readText()')
    assert '250 registered' in clip and 'Plexus Week 2026' in clip, 'clipboard must carry the line'
    page.click('[data-row="fig-registered"] [data-act="ovClear"]'); page.wait_for_timeout(1100)
    assert 'MANUAL' not in page.locator('[data-row="fig-registered"]').inner_text(), 'clear must return to the live number'
    ok('stats override + copy line + clear')

    # ================= CME export =================================================================
    page.locator('[data-row="cme"] [data-act="cmeExport"]').click()
    toast_contains(page, 'CSV')
    ok('CME chamber CSV export')

    # ================= deep link + responsive shots ===============================================
    page.goto(a.base + PATH + '/schedule', wait_until='load')
    page.locator('[data-screen-label="Admin Plexus Hub"]').wait_for(state='attached', timeout=25000); page.wait_for_timeout(1200)
    assert page.locator('[data-block="ssPanel"]').count(), '/projects/plexus/schedule must open the builder'
    ok('deep link /projects/plexus/schedule')
    open_hub(page)
    page.click('[data-row="speakers"]'); page.wait_for_timeout(400)
    page.screenshot(path=os.path.join(QA, 'v2-plexus-speakers.png'), full_page=True)
    for w in (960, 620):
        page.set_viewport_size({'width': w, 'height': 900}); page.wait_for_timeout(500)
        page.screenshot(path=os.path.join(QA, f'v2-plexus-{w}.png'), full_page=True); print(f'v2 → v2-plexus-{w}.png')
    page.set_viewport_size({'width': a.width, 'height': 900}); open_hub(page, 900)
    page.screenshot(path=os.path.join(QA, 'v2-plexus-final.png'), full_page=True)

    browser.close()

open(os.path.join(QA, 'console.txt'), 'w').write('\n'.join(errors + ['--- foreign screens (other builders) ---'] + foreign) + '\n')
print(f'\npassed: {len(passed)} flow groups'); [print('  ·', p) for p in passed]
print('console errors on the Plexus screen:', len(errors)); [print(' ', e) for e in errors[:20]]
if foreign: print('console errors on OTHER screens (not this build):', len(foreign)); [print(' ', e) for e in foreign[:10]]
sys.exit(1 if errors else 0)
