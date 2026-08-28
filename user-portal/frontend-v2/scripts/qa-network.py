#!/usr/bin/env python3
"""scripts/qa-network.py — QA for the NETWORK · PEOPLE screen (js/views/network.js).
Approach copied from scripts/qa-shots.py (design artboard vs v2 page, console capture) plus a
functional Playwright pass over the real backend flows. Shared scripts are untouched.

  MEDX_QA_TOKENS=/path/tokens.json python3 scripts/qa-network.py [--base http://localhost:8904] [--shots-only|--flows-only]

tokens.json = { "<alias>": { "token": "<jwt>", "user": {…} }, … } with aliases A=member024,
B=member027, C=member021 (any three mutually unconnected members work). No auth routes are hit —
tokens are reused (the auth limiter is 15/15 min per IP).
Outputs to _qa/network/: design-network*.png, v2-network*.png, console.txt. Exits 1 on any FAIL
or console error."""
import os, sys, json, argparse, urllib.request, urllib.error, urllib.parse
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

HERE = os.path.dirname(os.path.abspath(__file__))
QA = os.path.join(HERE, '..', '_qa', 'network'); os.makedirs(QA, exist_ok=True)
ap = argparse.ArgumentParser()
ap.add_argument('--base', default='http://localhost:8904')
ap.add_argument('--api', default='http://localhost:3964')
ap.add_argument('--design', default=os.path.join(HERE, '..', '..', '..', 'design', 'handoff', 'member-portal-2026-08-28'))
ap.add_argument('--tokens', default=os.environ.get('MEDX_QA_TOKENS', ''))
ap.add_argument('--shots-only', action='store_true')
ap.add_argument('--flows-only', action='store_true')
a = ap.parse_args()

T = json.load(open(a.tokens)) if a.tokens else {}
A, B, C = 'member024', 'member027', 'member021'
results, console_log = [], []
def check(name, ok, info=''):
    results.append((name, bool(ok))); print(('PASS ' if ok else 'FAIL ') + name + (('  — ' + str(info)) if info and not ok else ''))
def api_call(method, path, who, body=None):
    req = urllib.request.Request(a.api + path, method=method,
        data=(json.dumps(body).encode() if body is not None else None),
        headers={'Authorization': 'Bearer ' + T[who]['token'], **({'Content-Type': 'application/json'} if body is not None else {})})
    try: return json.load(urllib.request.urlopen(req))
    except urllib.error.HTTPError as e:
        try: return {'HTTP': e.code, **json.loads(e.read().decode())}
        except Exception: return {'HTTP': e.code}

def sign_in(page, who):
    page.goto(a.base + '/app/auth/welcome', wait_until='load')
    page.evaluate("([t,u])=>{localStorage.setItem('medx_user_token',t);localStorage.setItem('medx_user_data',u);}",
                  [T[who]['token'], json.dumps(T[who]['user'])])
def open_network(page, q=''):
    page.goto(a.base + '/app/network' + (('?q=' + urllib.parse.quote(q)) if q else ''), wait_until='networkidle')
    page.wait_for_timeout(1000)
def toast(page):
    try: return page.locator('.mx-toast.show').inner_text(timeout=4000)
    except PWTimeout: return ''
def track(page, name):
    page.on('console', lambda m, n=name: console_log.append(f'[{n}] {m.type}: {m.text}') if m.type == 'error' else None)
    page.on('pageerror', lambda e, n=name: console_log.append(f'[{n}] pageerror: {e}'))

with sync_playwright() as pw:
    browser = pw.chromium.launch()

    # ---------------- shots: artboard vs v2 at 1280 and 430 ----------------
    if not a.flows_only:
        art = os.path.join(a.design, 'Network.dc.html')
        for w, suffix in [(1280, ''), (430, '-430')]:
            pg = browser.new_page(viewport={'width': w, 'height': 950})
            pg.goto('file://' + art.replace(' ', '%20').replace('&', '%26'), wait_until='load'); pg.wait_for_timeout(900)
            pg.screenshot(path=os.path.join(QA, f'design-network{suffix}.png'), full_page=True); pg.close()
            print('artboard →', f'design-network{suffix}.png')
        shots = [('v2-network', '', 1280), ('v2-network-search', 'oncology, Zagreb', 1280),
                 ('v2-network-430', '', 430), ('v2-network-search-430', 'Rijeka', 430)]
        for name, q, w in shots:
            pg = browser.new_page(viewport={'width': w, 'height': 950}, **({'device_scale_factor': 2, 'is_mobile': True, 'has_touch': True} if w == 430 else {}))
            track(pg, name); sign_in(pg, A); open_network(pg, q)
            pg.screenshot(path=os.path.join(QA, f'{name}.png'), full_page=True); print('v2 →', f'{name}.png')
            if name == 'v2-network':
                pg.click('[data-act=browse]'); pg.wait_for_timeout(900)
                pg.screenshot(path=os.path.join(QA, 'v2-network-browse.png'), full_page=True); print('v2 →', 'v2-network-browse.png')
            if w == 430:
                check(f'{name}: no horizontal scroll at 430', pg.evaluate('document.documentElement.scrollWidth') <= 430,
                      pg.evaluate('document.documentElement.scrollWidth'))
            pg.close()

    # ---------------- functional pass ----------------
    if not a.shots_only and T:
        bid, cid = T[B]['user']['id'], T[C]['user']['id']
        # start clean: drop any existing rows between A↔B and A↔C (cancel/clear/remove via the API)
        for who, other in [(A, bid), (A, cid)]:
            for row in api_call('GET', '/api/networking/connections', who):
                if row.get('requester_id') in (other, T[who]['user']['id']) and row.get('receiver_id') in (other, T[who]['user']['id']):
                    api_call('DELETE', '/api/v2/network/connections/' + row['id'], who)
        p = browser.new_page(viewport={'width': 1280, 'height': 950}); track(p, 'flows'); sign_in(p, A)

        # 1 · smart search: name / institution / specialty / city / program
        open_network(p)
        check('default: PEOPLE FOR YOU + MY NETWORK + BROWSE ALL render',
              all(s in p.locator('#view').inner_text() for s in ['PEOPLE FOR YOU', 'MY NETWORK', 'BROWSE ALL']))
        card0 = p.locator('[data-block=content] [data-card]').first.inner_text()
        REASON_LABELS = ['SHARED FIELD', 'SAME COUNTRY', 'SAME CITY', 'SAME INSTITUTION', 'ATTENDS PLEXUS',
                         'MUTUAL CONTACTS', 'FORUM MEMBER', 'MED&X TEAM', 'NEW MEMBER', 'MED&X MEMBER', 'REQUEST']
        check('suggestions carry a reason chip', any(l in card0 for l in REASON_LABELS), card0[:80])
        def search(q):
            p.fill('[data-role=q]', ''); p.fill('[data-role=q]', q); p.wait_for_timeout(900)
            return p.locator('[data-block=content]').inner_text()
        check('search by name', 'Member 027 Test' in search('member 027'))
        check('search by institution', 'Member 021 Test' in search('Rijeka'))
        check('search by city', 'Member 027 Test' in search('zagreb'))
        check('search by program (Plexus)', 'Member 019 Test' in search('Plexus'))
        check('search multi-token (oncology, zagreb)', 'Member 027 Test' in search('oncology, zagreb'))
        check('hidden-field match is pointed out', 'matches specialty' in search('oncology'))
        check('no-results empty state', 'No members match' in search('xyzzynobody'))
        check('URL carries ?q=', 'q=xyzzynobody' in p.url)
        # specialty search from the other account (member021 → finds member024 by specialty)
        p2 = browser.new_page(viewport={'width': 1280, 'height': 950}); track(p2, 'flows-C'); sign_in(p2, C); open_network(p2, 'neurology')
        check('search by specialty (as C)', 'Member 024 Test' in p2.locator('[data-block=content]').inner_text()); p2.close()

        # 2 · connect A→B from search, optimistic face
        search('member 027')
        p.click('[data-card] [data-act=connect]'); p.wait_for_timeout(800)
        check('CONNECT → REQUEST SENT face', 'REQUEST SENT' in p.locator('[data-block=content]').inner_text())
        check('CONNECT toast', 'request sent' in toast(p).lower())

        # 3 · B sees the request card first, ACCEPTs
        pb = browser.new_page(viewport={'width': 1280, 'height': 950}); track(pb, 'flows-B'); sign_in(pb, B); open_network(pb)
        first_card = pb.locator('[data-block=content] [data-card]').first
        check('B: request card first with ACCEPT/DECLINE', 'ACCEPT' in first_card.inner_text() and 'Member 024' in first_card.inner_text())
        pb.click('[data-card] [data-act=accept]'); pb.wait_for_timeout(900)
        check('B: accept toast', 'connected with' in toast(pb).lower())
        check('B: A now in MY NETWORK', 'Member 024' in pb.locator('[data-block=content]').inner_text() and 'CONNECTED ✓' in pb.locator('[data-block=content]').inner_text())

        # 4 · A reloads: connected state + MY NETWORK row + MESSAGE routes with ?to=
        open_network(p)
        check('A: B in MY NETWORK', 'Member 027' in p.locator('[data-block=content]').inner_text())
        p.click('.mx-net-row:has-text("Member 027") [data-act=message]'); p.wait_for_timeout(700)
        check('MESSAGE → /app/messages?to=<id>', '/app/messages?to=' + bid in urllib.parse.unquote(p.url), p.url)

        # 5 · remove: back to Network, REMOVE with confirm
        open_network(p)
        p.click('[data-block=content] [data-act=remove]'); p.wait_for_timeout(400)
        p.click('.mx-modal-foot [data-act=a1]'); p.wait_for_timeout(800)
        check('REMOVE → row gone + empty state back', 'No connections yet' in p.locator('[data-block=content]').inner_text())
        check('remove toast', 'removed from your network' in toast(p).lower())

        # 6 · decline path: A→C, C declines, A sees DECLINED
        open_network(p, 'member 021')
        p.click('[data-card] [data-act=connect]'); p.wait_for_timeout(800)
        pc = browser.new_page(viewport={'width': 1280, 'height': 950}); track(pc, 'flows-C2'); sign_in(pc, C); open_network(pc)
        pc.click('[data-card] [data-act=decline]'); pc.wait_for_timeout(800)
        check('C: decline removes the request card', 'Member 024' not in pc.locator('[data-block=content] [data-card]').first.inner_text() if pc.locator('[data-block=content] [data-card]').count() else True)
        check('C: decline toast', 'declined' in toast(pc).lower()); pc.close()
        open_network(p, 'member 021')
        check('A: declined face after C declines', 'DECLINED' in p.locator('[data-block=content]').inner_text())
        p.click('[data-card] [data-act=connect]'); check('A: click on DECLINED explains', 'passed on this request' in toast(p).lower())

        # 7 · cancel path: A→B again, then cancel from the REQUEST SENT face
        open_network(p, 'member 027')
        p.click('[data-card] [data-act=connect]'); p.wait_for_timeout(800)
        p.click('[data-card] [data-act=connect]'); p.wait_for_timeout(400)          # REQUEST SENT → confirm
        p.click('.mx-modal-foot [data-act=a1]'); p.wait_for_timeout(800)
        check('cancel request → CONNECT face back', 'CONNECT' in p.locator('[data-card] [data-act=connect]').first.inner_text())
        check('cancel toast', 'cancelled' in toast(p).lower())

        # 8 · browse-all pagination
        open_network(p)
        check('member count is live in the label', any(ch.isdigit() for ch in p.locator('[data-act=browse]').inner_text()))
        p.click('[data-act=browse]'); p.wait_for_timeout(900)
        rows1 = p.locator('[data-block=content] .mx-net-row [data-act=peek]').all_inner_texts()
        check('browse all opens the directory', len(rows1) > 0 and 'PAGE 1 OF' in p.locator('[data-block=content]').inner_text())
        p.click('[data-act=dirPage][data-page="2"]'); p.wait_for_timeout(900)
        rows2 = p.locator('[data-block=content] .mx-net-row [data-act=peek]').all_inner_texts()
        check('directory NEXT → different page', len(rows2) > 0 and rows1 != rows2)

        # 9 · keyboard pass: Tab reaches the search field and buttons; Enter activates
        open_network(p)
        p.focus('[data-role=q]'); p.keyboard.type('member 027'); p.wait_for_timeout(900)
        check('keyboard: typing searches', 'Member 027 Test' in p.locator('[data-block=content]').inner_text())
        p.focus('[data-block=content] [data-act=connect]'); p.keyboard.press('Enter'); p.wait_for_timeout(800)
        check('keyboard: Enter on CONNECT works', 'REQUEST SENT' in p.locator('[data-block=content]').inner_text())
        p.focus('[data-block=content] [data-act=connect]'); p.keyboard.press('Enter'); p.wait_for_timeout(300)
        p.keyboard.press('Escape'); p.wait_for_timeout(300)   # confirm modal closes on Escape
        check('keyboard: Escape closes the confirm', p.locator('.mx-modal').count() == 0)

        # cleanup so the pass is rerunnable: cancel the A→B pending from the keyboard test, C clears the decline
        sr = api_call('GET', '/api/v2/network/search?q=member%20027', A)
        for m in sr.get('results', []):
            if m['connection']['state'] == 'pending_out':
                api_call('DELETE', '/api/v2/network/connections/' + m['connection']['id'], A)
        sr = api_call('GET', '/api/v2/network/search?q=member%20024', C)
        for m in sr.get('results', []):
            if m['connection']['state'] == 'declined_by_me':
                api_call('DELETE', '/api/v2/network/connections/' + m['connection']['id'], C)
        p.close()
    browser.close()

open(os.path.join(QA, 'console.txt'), 'w').write('\n'.join(console_log) + '\n')
bad = [r for r in results if not r[1]]
print(f'\n{len(results) - len(bad)}/{len(results)} checks passed; console errors: {len(console_log)}')
for c in console_log[:20]: print('  console:', c)
sys.exit(1 if bad or console_log else 0)
