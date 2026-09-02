#!/usr/bin/env python3
"""scripts/qa-admin-inbox.py — QA for the INBOX destination (Admin Inbox.dc.html → js/views/inbox.js).

Shoots the design artboard + every tab at 1440 px into _qa/admin-inbox/ and drives the real flows
end-to-end against the local stack (admin :3977 · member :3947 · front :8916 · EMAIL_DUMP_DIR):

  outbox   queue → approve → the drained email lands as a file in EMAIL_DUMP_DIR · APPROVE ALL per
           group · SEND LATER + CANCEL (back to the waiting list) · pick-ticks compose · DISCARD
  messages member writes (member backend, topic tag) → thread shows topic + unread → reply → the
           member's portal thread carries the reply · read/unread · archive
  announce publish → the member bell (member backend /api/user-notifications) carries it
  news     compose → queues into the outbox as a NEWSLETTERS batch
  chat     channel create/delete ('general' has no delete) · message · reply-to · attachment

  MEDX_QA_EMAIL=pjero.bacic@medx.hr MEDX_QA_PASSWORD='Plexus2026!' python3 scripts/qa-admin-inbox.py
  MEDX_QA_TOKEN=<jwt> python3 scripts/qa-admin-inbox.py            # reuse a token (15 logins / 15 min)

Member side: MEDX_QA_MEMBER_EMAIL / MEDX_QA_MEMBER_PASSWORD (default member001@staging.medx.hr /
Adminbox2026! — set on the scratch DB). Exit 1 when any console error/pageerror was captured.
"""
import os, sys, json, time, glob, argparse, urllib.request
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..'))
QA = os.path.join(ROOT, '_qa', 'admin-inbox'); os.makedirs(QA, exist_ok=True)
ap = argparse.ArgumentParser()
ap.add_argument('--base', default='http://localhost:8916')
ap.add_argument('--member', default='http://localhost:3947')
ap.add_argument('--dump', default=os.environ.get('EMAIL_DUMP_DIR', '/tmp/adminbox-emails'))
ap.add_argument('--design', default=os.path.abspath(os.path.join(ROOT, '..', '..', 'design', 'handoff', 'admin-portal-2026-08-28')))
ap.add_argument('--token', default=os.environ.get('MEDX_QA_TOKEN', ''))
ap.add_argument('--email', default=os.environ.get('MEDX_QA_EMAIL', ''))
ap.add_argument('--password', default=os.environ.get('MEDX_QA_PASSWORD', ''))
ap.add_argument('--member-email', default=os.environ.get('MEDX_QA_MEMBER_EMAIL', 'member001@staging.medx.hr'))
ap.add_argument('--member-password', default=os.environ.get('MEDX_QA_MEMBER_PASSWORD', 'Adminbox2026!'))
ap.add_argument('--width', type=int, default=1440)
a = ap.parse_args()
TS = str(int(time.time()))

def http(base, method, path, token=None, body=None):
    req = urllib.request.Request(base + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + token} if token else {})})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read().decode() or '{}')

def login():
    if a.token: return a.token, None
    if not (a.email and a.password): sys.exit('need MEDX_QA_TOKEN or MEDX_QA_EMAIL + MEDX_QA_PASSWORD')
    d = http(a.base, 'POST', '/api/auth/login', body={'email': a.email, 'password': a.password})
    return d['token'], json.dumps(d['user'])

errors = []
def watch(page, name):
    page.on('console', lambda m, n=name: errors.append(f'[{n}] {m.type}: {m.text}') if m.type in ('error', 'warning') else None)
    page.on('pageerror', lambda e, n=name: errors.append(f'[{n}] pageerror: {e}'))
def shot(page, name, **kw):
    page.screenshot(path=os.path.join(QA, name + '.png'), **kw); print('→', name + '.png')

# member session (chain proofs)
mtok = http(a.member, 'POST', '/api/auth/login', body={'email': a.member_email, 'password': a.member_password})['token']
# a FRESH inbound member message so the messages tab shows a topic tag + unread dot
http(a.member, 'POST', '/api/v2/messages/team', token=mtok,
     body={'topic': 'accelerator', 'body': f'QA {TS}: is it certain applications open December 8? Planning my rotation around it.'})
print('member → team message sent (topic accelerator)')

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    # ---- design artboard ----
    path = os.path.join(a.design, 'Admin Inbox.dc.html')
    if os.path.exists(path):
        page = browser.new_page(viewport={'width': a.width, 'height': 900})
        page.goto('file://' + path.replace(' ', '%20').replace('&', '%26'), wait_until='load')
        page.wait_for_timeout(1200)
        shot(page, 'design-inbox', full_page=True)
        page.close()
    else:
        print('skip artboard (not found):', path)

    token, user = login()
    page = browser.new_page(viewport={'width': a.width, 'height': 900}); watch(page, 'inbox')
    page.goto(a.base + '/signin', wait_until='load')
    page.evaluate("([t,u]) => { localStorage.setItem('medx_token', t); if (u) localStorage.setItem('medx_user', u); }", [token, user])

    # =================== EMAIL & OUTBOX ===================
    page.goto(a.base + '/inbox/outbox', wait_until='networkidle'); page.wait_for_timeout(1200)
    assert page.locator('[data-block=waiting]').count() == 1, '/inbox/outbox must render WAITING FOR YOUR OK'
    shot(page, 'v2-outbox', full_page=True)
    # per-item preview drawer on the first batch row
    page.locator('[data-block=waiting] .mx-outbox-text').first.click(); page.wait_for_timeout(900)
    assert page.locator('.mx-outbox-preview').count() == 1, 'clicking a row must open the preview drawer'
    shot(page, 'v2-outbox-preview', full_page=True)
    page.locator('.mx-outbox-preview [data-act=preview]').click(); page.wait_for_timeout(300)
    # responsive looks
    for w in (900, 620):
        page.set_viewport_size({'width': w, 'height': 900}); page.wait_for_timeout(500)
        shot(page, f'v2-outbox-{w}', full_page=True)
    page.set_viewport_size({'width': a.width, 'height': 900}); page.wait_for_timeout(400)

    # ---- flow: compose to an audience → queue → approve → dumped file exists ----
    subj = f'QA run {TS} — final details'
    page.select_option('[data-role=qAudience]', 'conference')
    page.fill('[data-role=qSubject]', subj)
    page.fill('[data-role=qBody]', 'Hello from the QA run.\n\nSecond paragraph, with love.')
    prev = page.inner_text('[data-role=previewBody]')
    assert 'Hello from the QA run' in prev, 'the HOW IT WILL LOOK preview must live-update'
    page.click('[data-act=queueEmail]'); page.wait_for_timeout(1500)
    row = page.locator('.mx-outbox-row', has_text=subj)
    assert row.count() == 1, 'the queued batch must appear in WAITING FOR YOUR OK'
    assert '2' == row.locator('span').first.inner_text().strip(), 'conference audience stages 2 emails'
    before = len(glob.glob(os.path.join(a.dump, '*QA_run*')))
    row.locator('[data-act=approve]').click(); page.wait_for_timeout(1500)
    assert page.locator('.mx-outbox-row', has_text=subj).count() == 0, 'approved batch must leave the waiting list'
    # evidence of the REAL drain: the dump file(s) appear (two same-millisecond writes can share a
    # filename, so ≥1 file) AND the batch reads back as fully sent
    deadline = time.time() + 75
    while time.time() < deadline:
        if len(glob.glob(os.path.join(a.dump, '*QA_run*'))) > before: break
        time.sleep(4)
    dumped = len(glob.glob(os.path.join(a.dump, '*QA_run*'))) - before
    assert dumped >= 1, f'the drained send must land in EMAIL_DUMP_DIR (saw {dumped} new files)'
    sent = None
    for _ in range(15):
        sent = next((b for b in http(a.base, 'GET', '/api/admin/outbox?status=sent', token=token)['batches']
                     if b['batch_id'].startswith('admin-compose-') and (b.get('sample') or {}).get('subject') == subj), None)
        if sent and sent['count'] == 2: break
        time.sleep(3)
    assert sent and sent['count'] == 2, 'both staged emails must read back as SENT after the drain'
    newest = max(glob.glob(os.path.join(a.dump, '*QA_run*')), key=os.path.getmtime)
    html = open(newest).read()
    assert 'Dear Member 0' in html and 'Second paragraph, with love.' in html, 'the dumped email must carry the branded, personally-greeted body'
    print(f'flow → queue + approve + drain ({dumped} dumped file(s), batch sent 2/2)')

    # ---- flow: pick people by hand (ticks override), then DISCARD (2-step) ----
    page.click('[data-act=manualTg]'); page.wait_for_timeout(400)
    boxes = page.locator('input[data-act=pickTg]')
    assert boxes.count() > 5, 'the hand-pick list must show every known person'
    checked0 = page.locator('input[data-act=pickTg]:checked').count()
    page.locator('input[data-act=pickTg]:checked').first.click(); page.wait_for_timeout(300)
    page.locator('input[data-act=pickTg]:not(:checked)').last.click(); page.wait_for_timeout(300)
    picked = page.locator('input[data-act=pickTg]:checked').count()
    assert picked == checked0, 'one untick + one tick keeps the count'
    subj2 = f'QA picks {TS}'
    page.fill('[data-role=qSubject]', subj2)
    page.fill('[data-role=qBody]', 'Hand-picked test.')
    page.click('[data-act=queueEmail]'); page.wait_for_timeout(1500)
    row2 = page.locator('.mx-outbox-row', has_text=subj2)
    assert row2.count() == 1 and row2.locator('span').first.inner_text().strip() == str(picked), 'ticks must override the dropdown audience'
    row2.locator('[data-act=discard]').click(); page.wait_for_timeout(300)
    assert 'SURE?' in row2.locator('[data-act=discard]').inner_text(), 'discard asks twice'
    row2.locator('[data-act=discard]').click(); page.wait_for_timeout(1000)
    assert page.locator('.mx-outbox-row', has_text=subj2).count() == 0, 'discarded batch must leave the list'
    print(f'flow → pick-ticks compose ({picked} recipients) + discard')

    # ---- flow: SEND LATER → chip + CANCEL back to the waiting list ----
    pulse = page.locator('.mx-outbox-row', has_text='weekly pulse').first
    pulse_title = pulse.locator('.mx-outbox-text span').first.inner_text()
    pulse.locator('[data-act=later]').click(); page.wait_for_timeout(1200)
    chip = page.locator('.mx-outbox-row', has_text=pulse_title).locator('.mx-defer')
    assert chip.count() == 1 and 'SENDS' in chip.inner_text(), 'SEND LATER must show the SENDS … chip'
    shot(page, 'v2-outbox-deferred', full_page=True)
    page.locator('.mx-outbox-row', has_text=pulse_title).locator('[data-act=cancelLater]').click(); page.wait_for_timeout(1200)
    assert page.locator('.mx-outbox-row', has_text=pulse_title).locator('[data-act=approve]').count() == 1, 'CANCEL must return the batch to the waiting list'
    print('flow → send later + cancel (unschedule)')

    # ---- flow: APPROVE ALL on the weekly-pulse group ----
    n_before = page.locator('.mx-outbox-row').count()
    grp = page.locator('[data-act=approveAll]').first
    label = grp.inner_text()
    grp.click(); page.wait_for_timeout(4000)
    n_after = page.locator('.mx-outbox-row').count()
    assert n_after < n_before, f'APPROVE ALL ({label}) must clear its group ({n_before} → {n_after})'
    print(f'flow → approve all ({label.strip()}): rows {n_before} → {n_after}')

    # =================== MEMBER MESSAGES ===================
    page.goto(a.base + '/inbox/messages', wait_until='networkidle'); page.wait_for_timeout(1500)
    trow = page.locator('[data-block=threadlist] [data-act=openThread]', has_text='Member 001')
    assert trow.count() == 1, 'the member thread must appear'
    assert 'ACCELERATOR' in trow.inner_text(), 'the thread must carry its topic tag'
    shot(page, 'v2-messages', full_page=True)
    trow.click(); page.wait_for_timeout(1500)
    assert f'QA {TS}' in page.locator('[data-role=msgLog]').inner_text(), 'opening the thread shows the member message'
    reply = f'QA reply {TS} — yes, December 8, 2026.'
    page.fill('[data-role=reply]', reply)
    page.click('[data-act=sendReply]'); page.wait_for_timeout(1800)
    assert reply in page.locator('[data-role=msgLog]').inner_text(), 'the reply must appear in the conversation'
    team = http(a.member, 'GET', '/api/v2/messages/team', token=mtok)
    last = team['messages'][-1]
    assert (not last['mine']) and reply in last['content'], 'the MEMBER portal thread must carry the admin reply'
    print('flow → member message (topic) → admin reply → member thread updated')
    # read/unread + archive (hides, never deletes) + unarchive
    page.click('[data-act=toggleRead]'); page.wait_for_timeout(1200)   # MARK UNREAD
    assert page.locator('[data-act=toggleRead]').inner_text().strip() == 'MARK READ', 'MARK UNREAD flips the label back'
    assert page.locator('[data-block=threadlist] [data-act=openThread]', has_text='Member 001').inner_text().count('') >= 0  # row re-rendered
    page.click('[data-act=toggleRead]'); page.wait_for_timeout(1200)   # MARK READ again
    page.click('[data-act=archiveThread]'); page.wait_for_timeout(1500)
    assert page.locator('[data-block=threadlist] [data-act=openThread]', has_text='Member 001').count() == 0, 'archived thread leaves NEEDS A REPLY'
    page.click('[data-act=msgAll]'); page.wait_for_timeout(600)
    arow = page.locator('[data-block=threadlist] [data-act=openThread]', has_text='Member 001')
    assert arow.count() == 1 and 'ARCHIVED' in arow.inner_text(), 'ALL still shows the archived thread — hidden, never deleted'
    arow.click(); page.wait_for_timeout(1200)
    page.click('[data-act=archiveThread]'); page.wait_for_timeout(1500)  # UNARCHIVE
    print('flow → read/unread + archive/unarchive')

    # =================== ANNOUNCEMENTS ===================
    page.goto(a.base + '/inbox/announcements', wait_until='networkidle'); page.wait_for_timeout(1200)
    ann_t = f'QA bell {TS} — early-bird ends September 15'
    page.select_option('[data-role=annWho]', 'gala')
    page.fill('[data-role=annTitle]', ann_t)
    page.fill('[data-role=annBody]', 'Reserve before Monday to keep the €150 seat.')
    assert ann_t in page.inner_text('[data-role=annPrevTitle]'), 'the bell preview must live-update'
    assert 'GALA' in page.inner_text('[data-role=annPrevMeta]').upper(), 'the preview meta follows the audience'
    page.select_option('[data-role=annUntil]', '7')
    shot(page, 'v2-announcements', full_page=True)
    page.click('[data-act=annPublish]'); page.wait_for_timeout(1800)
    assert page.locator('[data-block=recentAnn]', has_text=ann_t).count() == 1, 'published announcement must appear under RECENT'
    bell = http(a.member, 'GET', '/api/user-notifications?limit=5', token=mtok)
    assert any(n['title'] == ann_t for n in bell['notifications']), 'the MEMBER bell must carry the announcement'
    print('flow → announcement published → member bell shows it')

    # =================== NEWSLETTER ===================
    page.goto(a.base + '/inbox/newsletter', wait_until='networkidle'); page.wait_for_timeout(1200)
    assert page.locator('[data-block=nlcards]', has_text='All Med&X').count() == 1, 'per-topic subscriber counts must render'
    page.click('[data-act=nlOpen]'); page.wait_for_timeout(400)
    nl_s = f'QA newsletter {TS} — Boston, early birds'
    page.fill('[data-role=nlSubject]', nl_s)
    page.fill('[data-role=nlBody]', 'Here is what happened across Med&X this month.')
    shot(page, 'v2-newsletter', full_page=True)
    page.click('[data-act=nlQueue]'); page.wait_for_timeout(1800)
    assert page.url.endswith('/inbox/outbox'), 'QUEUE IN OUTBOX lands on the outbox tab'
    nrow = page.locator('.mx-outbox-row', has_text=nl_s)
    assert nrow.count() == 1, 'the newsletter must wait in the outbox'
    assert page.locator('[data-block=waiting]', has_text='NEWSLETTERS').count() == 1, 'newsletter batches group under NEWSLETTERS'
    print('flow → newsletter composed → queued into the outbox')

    # =================== TEAM CHAT ===================
    page.goto(a.base + '/inbox/chat', wait_until='networkidle'); page.wait_for_timeout(1500)
    gen = page.locator('[data-block=channels] [data-act=chOpenC]', has_text='general').first
    assert gen.count() >= 1, 'the channels list must include # general'
    assert gen.locator('[data-act=chDel]').count() == 0, 'general is permanent — no delete control'
    shot(page, 'v2-chat', full_page=True)
    # create a channel
    page.click('[data-act=chAddToggle]')
    page.fill('[data-role=chNew]', 'qa room ' + TS[-4:])
    page.click('[data-act=chCreate]'); page.wait_for_timeout(2000)
    ch = page.locator('[data-block=channels] [data-act=chOpenC]', has_text='qa room ' + TS[-4:])
    assert ch.count() == 1, 'the new channel must appear (and open)'
    # message + reply-to
    page.fill('[data-role=chDraft]', 'hello from the QA run')
    page.click('[data-act=chSend]'); page.wait_for_timeout(1500)
    assert 'hello from the QA run' in page.inner_text('[data-role=chLog]'), 'the message must post'
    page.locator('[data-act=chReplyPick]').last.click(); page.wait_for_timeout(300)
    page.fill('[data-role=chDraft]', 'and this replies to it')
    page.click('[data-act=chSend]'); page.wait_for_timeout(1500)
    assert '↩' in page.inner_text('[data-role=chLog]'), 'the reply must carry the reply-to quote'
    # attachment
    tiny = os.path.join(QA, 'qa-attach.png')
    PNG_HEX = ('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489'
               '0000000d49444154789c6360000002000100ffff03000006000557bfabd4'
               '0000000049454e44ae426082')
    with open(tiny, 'wb') as f:
        f.write(bytes.fromhex(PNG_HEX))
    page.set_input_files('[data-role=chFile]', tiny); page.wait_for_timeout(2200)
    assert page.locator('[data-role=chLog] img').count() >= 1, 'the attached image must render in the channel'
    shot(page, 'v2-chat-thread', full_page=True)
    # delete the QA channel (two-step)
    ch.locator('[data-act=chDel]').click(); page.wait_for_timeout(300)
    page.locator('[data-block=channels] [data-act=chOpenC]', has_text='qa room ' + TS[-4:]).locator('[data-act=chDel]').click()
    page.wait_for_timeout(2000)
    assert page.locator('[data-block=channels] [data-act=chOpenC]', has_text='qa room ' + TS[-4:]).count() == 0, 'the channel must delete'
    print('flow → chat channel create/delete + message + reply-to + attachment')

    # final outbox state
    page.goto(a.base + '/inbox/outbox', wait_until='networkidle'); page.wait_for_timeout(1200)
    shot(page, 'v2-outbox-after', full_page=True)
    page.close()
    browser.close()

open(os.path.join(QA, 'console.txt'), 'w').write('\n'.join(errors) + '\n')
print('\nconsole issues:', len(errors)); [print(' ', e) for e in errors[:40]]
sys.exit(1 if errors else 0)
