#!/usr/bin/env python3
"""scripts/qa-messages.py — QA for the MESSAGES screen (js/views/messages.js · Messages.dc.html).
Approach copied from scripts/qa-shots.py (artboard vs v2 screenshots) + a functional Playwright
pass across BOTH backends: member → team message with topic → admin inbox route → admin reply →
unread marker in the member thread → read; member ↔ member via ?to=; archive; empty state;
keyboard pass; zero console errors. Outputs to _qa/messages/.

  python3 scripts/qa-messages.py [--base http://localhost:8905] [--member http://localhost:3965]
                                 [--admin http://localhost:3975] [--design <export dir>]
                                 [--tokens <dir with tok_m3.txt tok_m4.txt tok_admin.txt>]
Auth budget: reuses saved tokens for member003/member004/admin; logs in member005 + member006
(2 fresh auth calls per run — the limiter allows 15/15 min per backend).
"""
import os, sys, json, argparse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
QA = os.path.join(HERE, '..', '_qa', 'messages'); os.makedirs(QA, exist_ok=True)
ap = argparse.ArgumentParser()
ap.add_argument('--base', default='http://localhost:8905')
ap.add_argument('--member', default='http://localhost:3965')
ap.add_argument('--admin', default='http://localhost:3975')
ap.add_argument('--design', default=os.path.join(HERE, '..', '..', '..', 'design', 'handoff', 'member-portal-2026-08-28'))
ap.add_argument('--tokens', default=os.environ.get('MEDX_QA_TOKEN_DIR', ''))
a = ap.parse_args()

M3 = '1dfd5f6a-f17e-4f69-bd5c-d6dbe9cb45f9'   # member003@staging.medx.hr
M4 = '0ec8289a-504e-43e7-a12c-2077811629c9'   # member004@staging.medx.hr
M5 = '854c5857-b612-4769-a279-b90f36684e77'   # member005@staging.medx.hr
PASSWORD = 'Plexus2026!'

def http(url, method='GET', body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header('Content-Type', 'application/json')
    if token: req.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(req, timeout=30) as r: return json.loads(r.read().decode() or 'null')
    except urllib.error.HTTPError as e:
        try: return json.loads(e.read().decode())
        except Exception: return {'error': 'HTTP %s' % e.code}

def login(base, email):
    r = http(base + '/api/auth/login', 'POST', {'email': email, 'password': PASSWORD})
    return r.get('token')

def tok_file(name):
    if not a.tokens: return None
    p = os.path.join(a.tokens, name)
    return open(p).read().strip() if os.path.exists(p) else None

T3 = tok_file('tok_m3.txt') or login(a.member, 'member003@staging.medx.hr')
T4 = tok_file('tok_m4.txt') or login(a.member, 'member004@staging.medx.hr')
TA = tok_file('tok_admin.txt') or login(a.admin, 'juginovic.alen@gmail.com')
T5 = login(a.member, 'member005@staging.medx.hr')
T6 = login(a.member, 'member006@staging.medx.hr')
assert T3 and T4 and TA and T5 and T6, 'logins failed: %s' % [bool(x) for x in (T3, T4, TA, T5, T6)]

results, console = [], []
def check(name, ok, info=''):
    results.append((name, bool(ok))); print(('PASS ' if ok else 'FAIL ') + name + (('  — ' + str(info)[:160]) if info else ''))

from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    browser = pw.chromium.launch()

    # ---------------- artboard shots (same approach as qa-shots.py) ----------------
    for name, f, w, click_tab in [('design-messages', 'Messages.dc.html', 1280, None),
                                  ('design-messages-430', 'Mobile Portal.dc.html', 430, 'INBOX')]:
        path = os.path.abspath(os.path.join(a.design, f))
        if not os.path.exists(path): print('skip artboard', f); continue
        page = browser.new_page(viewport={'width': w, 'height': 930})
        page.goto('file://' + path.replace(' ', '%20').replace('&', '%26'), wait_until='load')
        page.wait_for_timeout(900)
        if click_tab:
            try: page.get_by_text(click_tab, exact=True).last.click(); page.wait_for_timeout(500)
            except Exception as e: print('tab click failed:', e)
        page.screenshot(path=os.path.join(QA, name + '.png'), full_page=True)
        print('artboard →', name + '.png'); page.close()

    # ---------------- helpers for v2 pages ----------------
    def new_page(w=1280, h=900, mobile=False):
        page = browser.new_page(viewport={'width': w, 'height': h}, is_mobile=mobile, has_touch=mobile)
        page.on('console', lambda m: console.append(f'{m.type}: {m.text}') if m.type == 'error' else None)
        page.on('pageerror', lambda e: console.append(f'pageerror: {e}'))
        return page
    def signin(page, token):
        page.goto(a.base + '/app/auth/welcome', wait_until='load')
        page.evaluate("t => { localStorage.clear(); localStorage.setItem('medx_user_token', t); }", token)
    def toast(page, expect=''):
        # wait until the toast SHOWS THE EXPECTED TEXT — a previous toast may still be up
        for _ in range(50):
            try: t = page.locator('.mx-toast.show').inner_text(timeout=150)
            except Exception: t = ''
            if t and (not expect or expect.lower() in t.lower()): return t
            page.wait_for_timeout(120)
        return t if 't' in dir() else ''

    # ---------------- 1) desktop: team thread + admin round-trip ----------------
    page = new_page()
    signin(page, T3)
    page.goto(a.base + '/app/messages', wait_until='networkidle'); page.wait_for_timeout(1400)
    root = page.locator('[data-screen-label=Messages]')
    check('screen renders (thread list + conversation)', root.count() == 1 and 'Inbox' in root.inner_text())
    check('official thread pinned first with tag', page.locator('[data-role=rows] [data-act=open]').first.inner_text().startswith('MX') and 'OFFICIAL · MED&X TEAM' in page.locator('.mx-msg-conv').inner_text())
    check('day dividers group by day', page.locator('[data-v2="day divider"]').count() >= 2, '%d dividers' % page.locator('[data-v2="day divider"]').count())
    page.screenshot(path=os.path.join(QA, 'v2-messages.png'), full_page=True)

    # send a team message with a picked topic through the UI
    page.click('[data-act=topic][data-topic=plexus]')
    page.fill('[data-role=draft]', 'Is the welcome reception on Dec 4 open to every registered member?')
    page.click('[data-act=send]'); t = toast(page, 'team')
    check('team send → toast', 'team' in t.lower(), t)
    page.wait_for_timeout(800)
    check('sent message shows with PLEXUS tag', 'PLEXUS' in page.locator('[data-role=msgs]').inner_text())
    # → admin backend inbox route sees it, with the topic
    inbox = http(a.admin + '/api/admin/messages', token=TA)
    row = next((r for r in inbox if isinstance(r, dict) and 'welcome reception' in (r.get('content') or '')), None)
    check('admin GET /api/admin/messages shows it (topic tag)', bool(row) and row.get('topic') == 'plexus' and row.get('member') == 'member003@staging.medx.hr', row and {'topic': row.get('topic'), 'title': row.get('title'), 'member': row.get('member')})

    # unread marker: reply lands while the member reads ANOTHER thread → dot on the team row → read
    page.locator('[data-role=rows] [data-act=open]').nth(1).click(); page.wait_for_timeout(900)
    r = http(a.admin + '/api/admin/messages', 'POST', {'receiver_id': 'member003@staging.medx.hr', 'title': 'Welcome reception', 'content': 'Yes — the reception is open to every registered member. Doors at 19:00.'}, token=TA)
    check('admin reply via POST /api/admin/messages', r.get('success') is True, r)
    page.wait_for_timeout(16500)   # one 15 s poll cycle
    team_row = page.locator('[data-role=rows] [data-act=open]').first
    check('poll → unread dot on the team row', team_row.locator('span[style*="width:7px"]').count() == 1)
    check('unread preview bold', 'font-weight:600' in (team_row.inner_html() or ''))
    team_row.click(); page.wait_for_timeout(1200)
    check('open thread → reply visible', 'Doors at 19:00' in page.locator('[data-role=msgs]').inner_text())
    check('dot cleared on open', page.locator('[data-role=rows] [data-act=open]').first.locator('span[style*="width:7px"]').count() == 0)
    uc = http(a.member + '/api/v2/messages/unread-count', token=T3)
    check('unread-count API back to 0', uc.get('team') == 0, uc)
    page.screenshot(path=os.path.join(QA, 'v2-messages-team-read.png'), full_page=True)

    # keyboard pass: search → ArrowDown → row focus → Enter opens; composer Shift+Enter newline, Enter sends
    page.focus('[data-role=search]'); page.keyboard.press('ArrowDown')
    check('ArrowDown → first thread focused', page.evaluate("document.activeElement && document.activeElement.dataset.act") == 'open')
    page.keyboard.press('ArrowDown')
    page.keyboard.press('Enter'); page.wait_for_timeout(1000)
    check('Enter opens the focused thread (DM)', 'Member 004' in page.locator('.mx-msg-conv').inner_text())
    page.focus('[data-role=draft]')
    page.keyboard.type('Two quick things:'); page.keyboard.press('Shift+Enter'); page.keyboard.type('see you Thursday.')
    check('Shift+Enter = newline', '\n' in page.input_value('[data-role=draft]'))
    page.keyboard.press('Enter'); page.wait_for_timeout(1200)
    check('Enter sends', page.input_value('[data-role=draft]') == '' and 'see you Thursday.' in page.locator('[data-role=msgs]').inner_text())

    # archive = hide (never delete) + SHOW ARCHIVED + unarchive
    page.click('[data-act=archive]'); t = toast(page, 'archived')
    check('archive → toast', 'archived' in t.lower(), t)
    page.wait_for_timeout(700)
    names = page.locator('[data-role=rows]').inner_text()
    check('archived thread hidden from the list', 'Member 004' not in names and 'SHOW ARCHIVED (1)' in names, names.replace('\n', ' | ')[:140])
    dm_count = http(a.member + '/api/v2/messages/threads', token=T3)
    check('archive hides, never deletes (rows intact)', any(th['key'] == M4 and th['count'] >= 3 for th in dm_count.get('threads', [])))
    page.click('[data-act=toggleArchived]'); page.wait_for_timeout(400)
    page.locator('[data-role=rows] [data-act=open]', has_text='Member 004').first.click(); page.wait_for_timeout(900)
    page.click('[data-act=archive]'); page.wait_for_timeout(700)
    check('unarchive restores', 'ARCHIVED' not in page.locator('[data-role=rows]').inner_text())

    # NEW MESSAGE modal + ATTACH stub toast
    page.click('[data-act=newMsg]'); page.wait_for_timeout(400)
    check('NEW MESSAGE modal lists team + connections', 'Med&X Coordinators' in page.locator('.mx-modal').inner_text() and 'Member 004' in page.locator('.mx-modal').inner_text())
    page.screenshot(path=os.path.join(QA, 'v2-messages-new-modal.png'))
    page.keyboard.press('Escape'); page.wait_for_timeout(300)
    page.click('[data-act=attach]'); t = toast(page, 'attachments')
    check('ATTACH → non-empty toast (stub)', len(t.strip()) > 0, t)
    page.close()

    # ---------------- 2) ?to=<userId>: gate → connect → converse ----------------
    page = new_page()
    signin(page, T3)
    page.goto(a.base + '/app/messages?to=' + M5, wait_until='networkidle'); page.wait_for_timeout(1400)
    check('?to= not-connected → gate, no composer', 'not connected yet' in page.locator('.mx-msg-conv').inner_text() and page.locator('[data-role=draft]').count() == 0)
    page.screenshot(path=os.path.join(QA, 'v2-messages-gate.png'), full_page=True)
    page.click('[data-act=connectPeer]'); t = toast(page, 'request sent')
    check('SEND CONNECTION REQUEST → toast', 'request sent' in t.lower(), t)
    pend = http(a.member + '/api/networking/connections/pending', token=T5)
    cid = next((p['id'] for p in pend if p.get('requester_id') == M3), None)
    check('request visible to member005 (existing route)', bool(cid))
    http(a.member + '/api/networking/connections/' + cid, 'PUT', {'status': 'accepted'}, token=T5)
    page.goto(a.base + '/app/messages?to=' + M5, wait_until='networkidle'); page.wait_for_timeout(1400)
    check('?to= after accept → composer open on the 1:1 thread', page.locator('[data-role=draft]').count() == 1 and 'Member 005' in page.locator('.mx-msg-conv').inner_text())
    page.fill('[data-role=draft]', 'Hello! Thanks for accepting — see you at Plexus.')
    page.keyboard.press('Enter'); page.wait_for_timeout(1200)
    check('?to= thread message sent', 'see you at Plexus' in page.locator('[data-role=msgs]').inner_text())
    m5_threads = http(a.member + '/api/v2/messages/threads', token=T5)
    check('member005 sees the new thread unread', any(th['key'] == M3 and th['unread'] == 1 for th in m5_threads.get('threads', [])))
    page.close()

    # ---------------- 3) empty state (fresh member006) ----------------
    page = new_page()
    signin(page, T6)
    page.goto(a.base + '/app/messages', wait_until='networkidle'); page.wait_for_timeout(1400)
    check('empty inbox → Empty States voice + CTA', 'No messages — yet.' in page.locator('.mx-msg-conv').inner_text() and page.locator('[data-act=startMsg]').count() == 1)
    page.screenshot(path=os.path.join(QA, 'v2-messages-empty.png'), full_page=True)
    page.click('[data-act=startMsg]')
    check('START A MESSAGE → composer focused', page.evaluate("document.activeElement && document.activeElement.dataset.role") == 'draft')
    page.close()

    # ---------------- 4) 430 px: list ↔ conversation with back nav ----------------
    page = new_page(430, 930, mobile=True)
    signin(page, T3)
    page.goto(a.base + '/app/messages', wait_until='networkidle'); page.wait_for_timeout(1400)
    check('430: list shown, conversation hidden', page.locator('.mx-msg-list').is_visible() and not page.locator('.mx-msg-conv').is_visible())
    check('430: INBOX tab active in the tab bar', page.locator('#mx-tabbar a[aria-selected=true]').inner_text().strip() == 'INBOX')
    page.screenshot(path=os.path.join(QA, 'v2-messages-430-list.png'), full_page=True)
    page.locator('[data-role=rows] [data-act=open]').first.click(); page.wait_for_timeout(900)
    check('430: tap thread → conversation with ← back', page.locator('.mx-msg-conv').is_visible() and page.locator('[data-act=backList]').is_visible())
    page.screenshot(path=os.path.join(QA, 'v2-messages-430-conv.png'), full_page=True)
    page.click('[data-act=backList]'); page.wait_for_timeout(500)
    check('430: back → list again', page.locator('.mx-msg-list').is_visible() and not page.locator('.mx-msg-conv').is_visible())
    page.close()

    browser.close()

open(os.path.join(QA, 'console.txt'), 'w').write('\n'.join(console) + '\n')
fails = [n for n, ok in results if not ok]
real_errors = [c for c in console if 'Failed to load resource' not in c]
check('zero console errors', len(real_errors) == 0, real_errors[:3])
print('\n%d checks · %d failed · console errors: %d' % (len(results), len(fails), len(real_errors)))
if fails: print('FAILED:', fails)
sys.exit(1 if fails or real_errors else 0)
