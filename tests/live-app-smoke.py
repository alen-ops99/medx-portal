#!/usr/bin/env python3
"""tests/live-app-smoke.py — Playwright smoke for PLEXUS WEEK LIVE, the guest event app
(user-portal/frontend-v2/js/views/live.js). Driven by tests/live-app.test.js (--smoke) or by hand:

  python3 tests/live-app-smoke.py --base http://localhost:8971 --api http://localhost:3971 \
      --token <sig>.bridges.<id> --out /tmp/live-shots [--event boston] [--names 19]

Opens /live/<token> at 390×844 and 1280×900, asserts: the header names the event, the NOW/NEXT strip
renders, PROGRAM has cards, tapping ATTENDING on one Boston session lands it in GET /api/live/me/:token/
schedule (then tapped back — the row is left as found), SPEAKERS shows the Boston names, MY SCHEDULE's
.ics downloads a valid VCALENDAR with one VEVENT, INFO carries the venue, no console errors.
Exit code 0 = pass. Screenshots land in --out.
"""
import argparse, json, os, sys, urllib.request, urllib.error

ap = argparse.ArgumentParser()
ap.add_argument('--base', required=True)
ap.add_argument('--api', required=True)
ap.add_argument('--token', required=True)
ap.add_argument('--out', required=True)
ap.add_argument('--event', default='boston')
ap.add_argument('--names', type=int, default=19, help='minimum distinct speaker names expected on the SPEAKERS grid')
ap.add_argument('--session', default='Talks, block 1', help='title fragment of the session to toggle')
a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)

from playwright.sync_api import sync_playwright

fails = []
def check(cond, msg):
    print(('  ok    ' if cond else '  FAIL  ') + msg)
    if not cond: fails.append(msg)

def api_get(path, raw=False):
    req = urllib.request.Request(a.api.rstrip('/') + path, headers={'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as r:
        body = r.read()
        return body if raw else json.loads(body.decode('utf-8'))

def schedule_titles():
    return [s['title'] for s in api_get(f'/api/live/me/{a.token}/schedule').get('sessions', [])]

url = f"{a.base.rstrip('/')}/live/{a.token}"
print(f'live-app-smoke.py — {url}\n')
before = schedule_titles()
print('  schedule before:', before)

with sync_playwright() as p:
    browser = p.chromium.launch()
    for (w, h, name) in [(390, 844, 'phone-390'), (1280, 900, 'desktop-1280')]:
        ctx = browser.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2 if w < 500 else 1)
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
        page.on('console', lambda m: errors.append('console: ' + m.text) if m.type == 'error' else None)
        page.goto(url, wait_until='domcontentloaded')
        page.wait_for_selector('.lv-card', timeout=45000)
        page.wait_for_timeout(700)
        title = (page.text_content('.lv-title') or '').strip()
        check(bool(title) and 'Plexus Week' != title, f'[{name}] header names the event: "{title}"')
        now = (page.inner_text('.lv-now') or '').strip()
        check(('NOW' in now) or ('NEXT' in now), f'[{name}] NOW/NEXT strip renders: "{now.splitlines()[0] if now else ""}…"')
        cards = page.locator('[data-panel=program] .lv-card').count()
        check(cards >= 5, f'[{name}] PROGRAM has {cards} session cards')
        toggles = page.locator('[data-panel=program] .lv-att').count()
        check(toggles == cards, f'[{name}] one ATTENDING toggle per card ({toggles})')
        page.screenshot(path=f'{a.out}/{name}-program.png', full_page=True)

        # ATTENDING round-trip on one session, confirmed through the API each way
        card = page.locator('[data-panel=program] .lv-card', has_text=a.session).first
        btn = card.locator('.lv-att')
        was_on = btn.get_attribute('aria-checked') == 'true'
        btn.click(); page.wait_for_timeout(1200)
        now_on = btn.get_attribute('aria-checked') == 'true'
        check(now_on != was_on, f'[{name}] tap flips the toggle ({was_on} → {now_on})')
        titles = schedule_titles()
        check((a.session.lower() in ' | '.join(titles).lower()) == now_on, f'[{name}] server schedule agrees: {titles}')
        if name == 'phone-390' and now_on:
            page.click('.lv-tab[data-tab="schedule"]'); page.wait_for_timeout(500)
            sched_cards = page.locator('[data-panel=schedule] .lv-card').count()
            check(sched_cards >= 1, f'[{name}] MY SCHEDULE lists {sched_cards} session(s)')
            ics_links = page.locator('[data-panel=schedule] a.lv-ics')
            check(ics_links.count() >= 2, f'[{name}] per-session + per-day ADD TO CALENDAR links ({ics_links.count()})')
            href = ics_links.first.get_attribute('href') or ''
            ics_path = href if href.startswith('/') else href.split(a.api.rstrip('/'), 1)[-1] if a.api.rstrip('/') in href else None
            if ics_path is None and href.startswith('http'):
                # cross-origin base (Netlify → Render): the link already carries the API host
                ics_path = href
            try:
                body = api_get(ics_path, raw=True) if ics_path.startswith('/') else urllib.request.urlopen(ics_path, timeout=60).read()
                text = body.decode('utf-8', 'replace')
                check(text.startswith('BEGIN:VCALENDAR') and text.count('BEGIN:VEVENT') >= 1 and 'END:VCALENDAR' in text and 'TZID=' in text, f'[{name}] .ics is a valid VCALENDAR ({text.count("BEGIN:VEVENT")} VEVENT)')
            except Exception as e:
                check(False, f'[{name}] .ics download failed: {e}')
            page.screenshot(path=f'{a.out}/{name}-schedule.png', full_page=True)
            page.click('.lv-tab[data-tab="program"]'); page.wait_for_timeout(300)
        # tap back to where it was
        btn.click(); page.wait_for_timeout(1200)
        back = btn.get_attribute('aria-checked') == 'true'
        check(back == was_on, f'[{name}] second tap restores the toggle ({back})')
        after = schedule_titles()
        check((a.session.lower() in ' | '.join(after).lower()) == was_on, f'[{name}] server schedule restored: {after}')

        # SPEAKERS grid
        page.click('.lv-tab[data-tab="speakers"]'); page.wait_for_timeout(500)
        people = page.locator('[data-panel=speakers] .lv-person')
        names = [ (people.nth(i).locator('.lv-person-name').text_content() or '').strip() for i in range(people.count()) ]
        check(len(set(names)) >= a.names, f'[{name}] SPEAKERS grid shows {len(set(names))} distinct names (≥ {a.names})')
        check(any('Kellis' in n for n in names) and any('Pezaris' in n for n in names), f'[{name}] Kellis and Pezaris are on the grid')
        page.screenshot(path=f'{a.out}/{name}-speakers.png', full_page=True)
        people.filter(has_text='Kellis').first.click(); page.wait_for_timeout(500)
        sheet = page.locator('.lv-sheet')
        check(sheet.count() == 1 and 'Kellis' in (sheet.text_content() or ''), f'[{name}] tapping a speaker opens their sheet')
        page.keyboard.press('Escape'); page.wait_for_timeout(300)
        check(page.locator('.lv-sheet-wrap').count() == 0, f'[{name}] Escape closes the sheet')

        # INFO
        page.click('.lv-tab[data-tab="info"]'); page.wait_for_timeout(400)
        info = page.inner_text('[data-panel=info]')
        check('VENUE' in info and 'CONTACT' in info and 'laura.rodman@medx.hr' in info, f'[{name}] INFO carries venue + contact')
        check('WI-FI' not in info, f'[{name}] no invented Wi-Fi line')
        page.screenshot(path=f'{a.out}/{name}-info.png', full_page=True)

        # tap targets on the phone
        if name == 'phone-390':
            page.click('.lv-tab[data-tab="program"]'); page.wait_for_timeout(200)
            box = page.locator('[data-panel=program] .lv-att').first.bounding_box()
            check(box and box['height'] >= 44, f'[{name}] ATTENDING toggle is {box and round(box["height"])}px tall (≥ 44)')
            tab = page.locator('.lv-tab').first.bounding_box()
            check(tab and tab['height'] >= 44, f'[{name}] tab targets {tab and round(tab["height"])}px (≥ 44)')
            page.screenshot(path=f'{a.out}/{name}-fold.png', clip={'x': 0, 'y': 0, 'width': 390, 'height': 844})
            body_w = page.evaluate('document.documentElement.scrollWidth')
            check(body_w <= 390, f'[{name}] no horizontal scroll (scrollWidth {body_w})')
        check(not errors, f'[{name}] no console/page errors' + (': ' + '; '.join(errors[:3]) if errors else ''))
        ctx.close()
    browser.close()

after_all = schedule_titles()
check(after_all == before, f'schedule left as found: {after_all}')
print(f'\n{len(fails)} failure(s)')
sys.exit(1 if fails else 0)
