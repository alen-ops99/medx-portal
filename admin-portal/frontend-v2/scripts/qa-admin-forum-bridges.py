#!/usr/bin/env python3
"""scripts/qa-admin-forum-bridges.py — QA for the FORUM HUB and BRIDGES HUB destinations:
screenshot the two design artboards (file://…/Admin Forum Hub.dc.html / Admin Bridges Hub.dc.html)
and the v2 screens at 1440 px, drive the real flows end-to-end across BOTH backends, and fail on
any console error. Outputs land in _qa/admin-forum-bridges/.

Flows proved (UI on the admin dev server + API on the member backend — ONE shared DB):
  1. compose a Forum Feed item in the hub → the member /api/v2/forum/feed shows it
  2. add a candidate → SEND CODE → the batch appears in the approval outbox (evidence JSON)
     → approve → the drainer sends it (row flips to sent) → a fresh member redeems the code
     on the MEMBER backend → the hub's members list grows and the invite reads USED
  3. the new member votes Split → the hub's Split/Zagreb tally shows it
  4. edit the Zürich recap numbers → the member /api/v2/bridges/editions card updates
  5. type over a stats-widget number → persists server-side across a reload → clear → live again
  6. zero console errors on both screens

   MEDX_QA_TOKEN=<admin jwt> python3 scripts/qa-admin-forum-bridges.py --base http://localhost:8915 \
       --member http://localhost:3946
   (or MEDX_QA_EMAIL / MEDX_QA_PASSWORD — the auth limiter allows 15 logins / 15 min, reuse tokens)
"""
import os, sys, json, time, argparse, urllib.request, urllib.error
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..'))
QA = os.path.join(ROOT, '_qa', 'admin-forum-bridges'); os.makedirs(QA, exist_ok=True)

ap = argparse.ArgumentParser()
ap.add_argument('--base', default='http://localhost:8915')
ap.add_argument('--member', default='http://localhost:3946')
ap.add_argument('--design', default=os.path.abspath(os.path.join(ROOT, '..', '..', 'design', 'handoff', 'admin-portal-2026-08-28')))
ap.add_argument('--token', default=os.environ.get('MEDX_QA_TOKEN', ''))
ap.add_argument('--email', default=os.environ.get('MEDX_QA_EMAIL', ''))
ap.add_argument('--password', default=os.environ.get('MEDX_QA_PASSWORD', ''))
ap.add_argument('--width', type=int, default=1440)
ap.add_argument('--skip-flows', action='store_true')
a = ap.parse_args()

RUN = str(int(time.time()))
QA_MEMBER_EMAIL = f'qa.hub.{RUN}@example.org'
QA_CAND_NAME = f'Prof. QA Kandidat {RUN[-5:]}'

def http(method, url, body=None, token=None):
    req = urllib.request.Request(url, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + token} if token else {})})
    try:
        with urllib.request.urlopen(req, timeout=30) as r: return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        try: return e.code, json.load(e)
        except Exception: return e.code, {}

def login():
    if a.token: return a.token
    if not (a.email and a.password): sys.exit('need MEDX_QA_TOKEN or MEDX_QA_EMAIL + MEDX_QA_PASSWORD')
    s, d = http('POST', a.base + '/api/auth/login', {'email': a.email, 'password': a.password})
    if s != 200: sys.exit(f'admin login failed ({s})')
    return d['token']

errors, passed = [], []
def watch(page, name):
    page.on('console', lambda m, n=name: errors.append(f'[{n}] {m.type}: {m.text}') if m.type in ('error', 'warning') else None)
    page.on('pageerror', lambda e, n=name: errors.append(f'[{n}] pageerror: {e}'))
def ok(msg): passed.append(msg); print('  ✓', msg)
def shoot(page, name, full=True):
    page.screenshot(path=os.path.join(QA, name), full_page=full); print('  →', name)

TOK = login()
with sync_playwright() as pw:
    browser = pw.chromium.launch()
    # ---- artboards (design reference) ----
    for art, out in (('Admin Forum Hub.dc.html', 'design-forum-hub.png'), ('Admin Bridges Hub.dc.html', 'design-bridges-hub.png')):
        path = os.path.join(a.design, art)
        if os.path.exists(path):
            page = browser.new_page(viewport={'width': a.width, 'height': 900})
            page.goto('file://' + path.replace(' ', '%20').replace('&', '%26'), wait_until='load')
            page.wait_for_timeout(1200); shoot(page, out); page.close()
        else: print('skip artboard (not found):', path)

    page = browser.new_page(viewport={'width': a.width, 'height': 900}); watch(page, 'hubs')
    page.goto(a.base + '/signin', wait_until='load')
    page.evaluate("t => localStorage.setItem('medx_token', t)", TOK)

    # ================= FORUM HUB =================
    page.goto(a.base + '/projects/forum', wait_until='networkidle'); page.wait_for_timeout(1200)
    assert page.locator('[data-screen-label="Admin Forum Hub"]').count() == 1, 'forum hub must render (stub replaced)'
    shoot(page, 'v2-forum-hub.png')

    if not a.skip_flows:
        # -- flow 1: compose a feed item → member forum shows it
        title = f'QA spotlight run {RUN}'
        page.click('[data-act=setNews]'); page.fill('[data-role=fTitle]', title)
        page.fill('[data-role=fBody]', 'Written by the QA run — publish flow, admin hub → member portal, one shared table.')
        page.click('[data-act=publish]'); page.wait_for_timeout(1200)
        assert title in page.inner_text('[data-block=feed]'), 'published item must appear in LIVE IN THE FEED'
        s, d = http('POST', a.member + '/api/auth/register', {'email': QA_MEMBER_EMAIL, 'password': 'ChainProof9!', 'first_name': 'QA', 'last_name': 'Hub', 'institution': 'KBC Zagreb', 'country': 'Croatia'})
        assert s == 200 and d.get('token'), f'member register failed ({s})'
        MTOK = d['token']
        s, d = http('GET', a.member + '/api/v2/forum/feed?limit=30', token=MTOK)
        assert any((i.get('title') or '') == title for i in d.get('items', [])), 'member feed must contain the composed item'
        ok('feed: admin compose → member /api/v2/forum/feed shows it')

        # -- flow 2: candidate → SEND CODE → outbox → approve → member redeems → members list grows
        s, before = http('GET', a.base + '/api/v2/forum/hub', token=TOK)
        n0 = before['members_count']
        page.fill('[data-role=candDraft]', f'{QA_CAND_NAME} <{QA_MEMBER_EMAIL}>')
        page.click('[data-act=addCand]'); page.wait_for_timeout(1200)
        row = page.locator('[data-block=pipeline] [data-row]', has_text=QA_CAND_NAME)
        assert row.count() == 1, 'added candidate must appear in the pipeline'
        row.locator('[data-act=sendCode]').click(); page.wait_for_timeout(1500)
        s, ob = http('GET', a.base + '/api/admin/outbox?status=pending_approval', token=TOK)
        batch = next((b for b in ob.get('batches', []) if b.get('source_engine') == 'forum-invite' and (b.get('sample') or {}).get('to') == QA_MEMBER_EMAIL), None)
        assert batch, 'SEND CODE must stage a forum-invite batch in the approval outbox'
        json.dump(batch, open(os.path.join(QA, 'evidence-outbox-forum-invite.json'), 'w'), indent=1)
        ok(f'send code: batch {batch["batch_id"]} pending_approval in the outbox (evidence JSON saved)')
        s, d = http('POST', a.base + f'/api/admin/outbox/{batch["batch_id"]}/approve', {}, token=TOK)
        assert d.get('success'), 'outbox approve must succeed'
        sent = None
        for _ in range(30):  # either backend's drainer picks it up (20–60 s ticks)
            time.sleep(3)
            s, sb = http('GET', a.base + '/api/admin/outbox?status=sent', token=TOK)
            sent = next((b for b in sb.get('batches', []) if b['batch_id'] == batch['batch_id']), None)
            if sent: break
        assert sent, 'approved invitation must be sent by the drainer'
        ok('send code: approved → drainer sent it (outbox status sent)')
        s, inv = http('GET', a.base + '/api/v2/forum/invites', token=TOK)
        code = next(i['code'] for i in inv['invites'] if (i.get('email') or '') == QA_MEMBER_EMAIL)
        s, d = http('POST', a.member + '/api/v2/forum/redeem-code', {'code': code}, token=MTOK)
        assert s == 200 and d.get('ok'), f'member redeem must succeed ({s}: {d})'
        s, after = http('GET', a.base + '/api/v2/forum/hub', token=TOK)
        assert after['members_count'] == n0 + 1, f'members_count must grow {n0} → {n0 + 1}'
        page.goto(a.base + '/projects/forum', wait_until='networkidle'); page.wait_for_timeout(1200)
        assert 'QA Hub' in page.inner_text('[data-block=members]'), 'the new member must appear in the MEMBERS card'
        used = page.locator('[data-block=codes]', has_text=code)
        assert used.count() == 1, 'the redeemed code must still be listed (as used) for the audit trail'
        ok(f'redeem: member joined with {code} → members list grew to {after["members_count"]}')

        # -- flow 3: the new member votes Split → the hub tally shows it
        s, pre = http('GET', a.base + '/api/v2/forum/hub', token=TOK)
        s, d = http('POST', a.member + '/api/v2/forum/vote', {'choice': 'split'}, token=MTOK)
        assert s == 200 and d.get('ok'), 'member vote must succeed'
        s, post = http('GET', a.base + '/api/v2/forum/hub', token=TOK)
        assert post['vote']['counts']['split'] == pre['vote']['counts']['split'] + 1, 'admin tally must count the new Split vote'
        page.goto(a.base + '/projects/forum', wait_until='networkidle'); page.wait_for_timeout(1000)
        tally = page.inner_text('[data-v2=vote-tally]')
        assert 'Split' in tally and str(post['vote']['counts']['split']) in tally, 'the vote tally card must print the live counts'
        ok(f'vote: tally correct on the hub (Split {post["vote"]["counts"]["split"]} · Zagreb {post["vote"]["counts"]["zagreb"]})')

    # open states + responsive shots (forum)
    page.goto(a.base + '/projects/forum', wait_until='networkidle'); page.wait_for_timeout(1200)
    if page.locator('[data-act=gatherToggle]').count(): page.click('[data-act=gatherToggle]'); page.wait_for_timeout(300)
    page.click('[data-act=formToggle]'); page.wait_for_timeout(300)
    shoot(page, 'v2-forum-hub-open.png')
    for w in (900, 620):
        page.set_viewport_size({'width': w, 'height': 900}); page.wait_for_timeout(500)
        shoot(page, f'v2-forum-hub-{w}.png')
    page.set_viewport_size({'width': a.width, 'height': 900})

    # ================= BRIDGES HUB =================
    page.goto(a.base + '/projects/bridges', wait_until='networkidle'); page.wait_for_timeout(1200)
    assert page.locator('[data-screen-label="Admin Bridges Hub"]').count() == 1, 'bridges hub must render (stub replaced)'
    shoot(page, 'v2-bridges-hub.png')

    if not a.skip_flows:
        # -- flow 4: edit the Zürich recap numbers → the member bridges card updates
        g, cn = 40 + int(RUN[-1]), 15 + int(RUN[-1])
        zrow = page.locator('[data-block=events] [data-row]', has_text='Zürich')
        zrow.locator('[data-act=recap]').click(); page.wait_for_timeout(400)
        page.fill('[data-role=rcGuests]', str(g)); page.fill('[data-role=rcConn]', str(cn))
        page.click('[data-act=rcSave]'); page.wait_for_timeout(1400)
        assert f'{g} guests' in page.inner_text('[data-block=events]'), 'the Zürich row must show the saved recap figures'
        s, d = http('GET', a.member + '/api/v2/bridges/editions')
        z = next(e for e in d['editions'] if e['city'] == 'Zürich')
        assert z['guests'] == g and z['connections'] == cn, f'member editions must carry the recap ({z["guests"]}/{z["connections"]})'
        json.dump(z, open(os.path.join(QA, 'evidence-member-zurich-edition.json'), 'w'), indent=1, ensure_ascii=False)
        ok(f'recap: Zürich {g} guests · {cn} connections → live on the member endpoint (evidence JSON saved)')

        # -- flow 5: stats widget — type over GUESTS, persists server-side, then clear back to live
        s, st0 = http('GET', a.base + '/api/v2/bridges/stats', token=TOK)
        live = st0['stats']['bridges']['live']['guests']
        page.fill('input[data-stat=guests]', '2,500+'); page.keyboard.press('Tab'); page.wait_for_timeout(1200)
        page.goto(a.base + '/projects/bridges', wait_until='networkidle'); page.wait_for_timeout(1200)
        assert page.locator('input[data-stat=guests]').input_value() == '2,500+', 'the typed-over number must persist across a reload'
        assert '2,500+ guests' in page.inner_text('[data-role=statLine]'), 'the press line must use the override'
        shoot(page, 'v2-bridges-hub-override.png')
        page.fill('input[data-stat=guests]', ''); page.keyboard.press('Tab'); page.wait_for_timeout(1200)
        page.goto(a.base + '/projects/bridges', wait_until='networkidle'); page.wait_for_timeout(1200)
        assert page.locator('input[data-stat=guests]').input_value() == str(live), 'clearing must return the live number'
        ok(f'stats: override persisted server-side, cleared back to the live value ({live})')

        # -- follow-ups: add one, tick it done
        page.fill('[data-role=fuName]', 'Dr. Sarah Chen — Boston postdoc')
        page.fill('[data-role=fuWhy]', 'Offered to mentor an Accelerator fellow')
        page.click('[data-act=fuAdd]'); page.wait_for_timeout(1100)
        assert 'Sarah Chen' in page.inner_text('[data-block=fu]'), 'the follow-up must appear'
        page.locator('[data-block=fu] [data-row]', has_text='Sarah Chen').locator('[data-act=fuDone]').click(); page.wait_for_timeout(1100)
        assert 'Sarah Chen' not in page.inner_text('[data-block=fu]'), 'a ticked follow-up must leave the list'
        ok('follow-ups: add → tick done (server-side rows)')

    # open states + responsive shots (bridges)
    page.goto(a.base + '/projects/bridges', wait_until='networkidle'); page.wait_for_timeout(1200)
    zrow = page.locator('[data-block=events] [data-row]', has_text='Zürich')
    if zrow.count(): zrow.locator('[data-act=recap]').click(); page.wait_for_timeout(400)
    shoot(page, 'v2-bridges-hub-open.png')
    for w in (900, 620):
        page.set_viewport_size({'width': w, 'height': 900}); page.wait_for_timeout(500)
        shoot(page, f'v2-bridges-hub-{w}.png')
    page.close()
    browser.close()

open(os.path.join(QA, 'console.txt'), 'w').write('\n'.join(errors) + '\n')
print(f'\nflows passed: {len(passed)} · console issues: {len(errors)}')
[print('  ', e) for e in errors[:40]]
sys.exit(1 if errors else 0)
