#!/usr/bin/env python3
"""scripts/qa-admin-regs.py — QA for the REGISTRATIONS + LINKS destinations: screenshot the two
artboards (Admin Registrations.dc.html / Admin Links.dc.html) and the v2 pages at 1440 px, then
exercise the real flows end-to-end and fail on any console error.

   MEDX_QA_TOKEN=<jwt> python3 scripts/qa-admin-regs.py --base http://localhost:8913 --member http://localhost:3944
   MEDX_QA_EMAIL=pjero.bacic@medx.hr MEDX_QA_PASSWORD='Plexus2026!' python3 scripts/qa-admin-regs.py

Flows: search + event/status filters · bulk email lands in the approval outbox · CSV export ·
resend-confirmation queued · create a link → register through it (member /api/register-invite with
the link token) → the row appears in Registrations TAGGED with its source link → the link's
sign-up count increments → PAUSE blocks the next registration (410) → RESUME · QR modal ·
cancel with confirm + UNDO. Outputs to _qa/admin-regs/; exit 1 on console errors.

Run as a FULL-ACCESS admin (allowed_sections NULL) on the admregs scratch DB — writes rows.
"""
import os, sys, json, time, argparse, urllib.request, urllib.error
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..'))
QA = os.path.join(ROOT, '_qa', 'admin-regs'); os.makedirs(QA, exist_ok=True)
ap = argparse.ArgumentParser()
ap.add_argument('--base', default='http://localhost:8913')
ap.add_argument('--member', default='http://localhost:3944', help='member backend origin (register-invite lives there)')
ap.add_argument('--design', default=os.path.abspath(os.path.join(ROOT, '..', '..', 'design', 'handoff', 'admin-portal-2026-08-28')))
ap.add_argument('--token', default=os.environ.get('MEDX_QA_TOKEN', ''))
ap.add_argument('--email', default=os.environ.get('MEDX_QA_EMAIL', ''))
ap.add_argument('--password', default=os.environ.get('MEDX_QA_PASSWORD', ''))
ap.add_argument('--width', type=int, default=1440)
a = ap.parse_args()

def api(method, url, body=None, token=None):
    req = urllib.request.Request(url, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + token} if token else {})})
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        try: return e.code, json.load(e)
        except Exception: return e.code, {}

def login():
    if a.token: return a.token, None
    if not (a.email and a.password): sys.exit('need MEDX_QA_TOKEN or MEDX_QA_EMAIL + MEDX_QA_PASSWORD')
    st, d = api('POST', a.base + '/api/auth/login', {'email': a.email, 'password': a.password})
    if st != 200: sys.exit(f'login failed: {st} {d}')
    return d['token'], json.dumps(d['user'])

errors = []
def watch(page, name):
    page.on('console', lambda m, n=name: errors.append(f'[{n}] {m.type}: {m.text}') if m.type in ('error', 'warning') else None)
    page.on('pageerror', lambda e, n=name: errors.append(f'[{n}] pageerror: {e}'))

def shot(page, name, **kw):
    page.screenshot(path=os.path.join(QA, name), **kw); print('→', name)

stamp = str(int(time.time()))
token, user = login()

def outbox_batches():
    st, d = api('GET', a.base + '/api/admin/outbox?status=pending_approval', token=token)
    return [b for b in d.get('batches', []) if b.get('source_engine') == 'admin-registrations']

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    ctx = browser.new_context(viewport={'width': a.width, 'height': 900}, accept_downloads=True)

    # ---- artboards (design reference) ----
    for f, out in [('Admin Registrations.dc.html', 'design-registrations.png'), ('Admin Links.dc.html', 'design-links.png')]:
        path = os.path.join(a.design, f)
        if os.path.exists(path):
            page = ctx.new_page()
            page.goto('file://' + path.replace(' ', '%20').replace('&', '%26'), wait_until='load')
            page.wait_for_timeout(1200); shot(page, out, full_page=True); page.close()
        else: print('skip artboard (not found):', path)

    page = ctx.new_page(); watch(page, 'regs')
    page.goto(a.base + '/signin', wait_until='load')
    page.evaluate("([t,u]) => { localStorage.setItem('medx_token', t); if (u) localStorage.setItem('medx_user', u); }", [token, user])

    # ================= REGISTRATIONS =================
    page.goto(a.base + '/registrations', wait_until='networkidle'); page.wait_for_timeout(1200)
    n_all = page.locator('[data-block=table] [data-act=open]').count()
    assert n_all > 0, 'the all-events table must render rows from the seed'
    shot(page, 'v2-registrations.png', full_page=True)

    # search narrows
    page.fill('[data-role=regq]', 'member088'); page.wait_for_timeout(900)
    n_q = page.locator('[data-block=table] [data-act=open]').count()
    assert 0 < n_q < n_all, f'search must narrow the table ({n_all} → {n_q})'
    page.fill('[data-role=regq]', ''); page.wait_for_timeout(900)

    # event filter + status chips
    page.select_option('[data-role=ev]', 'gala'); page.wait_for_timeout(900)
    n_gala = page.locator('[data-block=table] [data-act=open]').count()
    assert 0 < n_gala < n_all, f'event filter must narrow the table ({n_all} → {n_gala})'
    page.click('[data-act=chip][data-chip=PENDING]'); page.wait_for_timeout(900)
    n_pend = page.locator('[data-block=table] [data-act=open]').count()
    assert 0 < n_pend <= n_gala, f'status chip must narrow further ({n_gala} → {n_pend})'
    assert page.locator('[data-block=table]').inner_text().count('PENDING') >= n_pend, 'filtered rows must show the PENDING tag'
    print('flow → search + event filter + status chips')

    # file panel + contextual actions
    page.click('[data-block=table] [data-act=open]'); page.wait_for_timeout(500)
    assert page.locator('[data-block=panel] [data-act=resend]').count() == 1, 'panel must offer RESEND CONFIRMATION'
    shot(page, 'v2-registrations-panel.png', full_page=True)

    # resend-confirmation → queued in the outbox (never sent directly)
    before = len(outbox_batches())
    page.click('[data-block=panel] [data-act=resend]'); page.wait_for_timeout(1200)
    after = outbox_batches()
    assert len(after) == before + 1, 'resend must stage ONE new pending_approval batch'
    assert any(b['template'] == 'resend_confirmation' for b in after), 'the staged batch must be a resend_confirmation'
    print('flow → resend confirmation queued in the outbox')

    # bulk email: tick 2 rows → compose → queued in the outbox
    page.click('[data-act=statAll]'); page.wait_for_timeout(900)          # stat cell is a door: clears filters
    boxes = page.locator('[data-block=table] [data-act=tick]')
    boxes.nth(0).click(); boxes.nth(1).click(); page.wait_for_timeout(300)
    assert 'EMAIL SELECTED · 2' in page.locator('[data-role=emailSel]').inner_text(), 'the button must count the selection'
    page.click('[data-role=emailSel]'); page.wait_for_timeout(400)
    page.fill('[data-role=cSubject]', 'QA bulk ' + stamp)
    page.fill('[data-role=cMessage]', 'Poštovani,\n\nQA test poruka — Plexus 2026.')
    before = len(outbox_batches())
    page.click('.mx-modal-foot .btn-primary'); page.wait_for_timeout(1200)
    after = outbox_batches()
    assert len(after) == before + 1 and any(b['template'] == 'admin_regs_bulk' and b['count'] == 2 for b in after), 'bulk email must stage a 2-recipient pending_approval batch'
    print('flow → bulk email lands in the approval outbox (2 recipients)')

    # CSV export (client-side, from the filtered set)
    with page.expect_download() as dl:
        page.click('[data-role=exportCsv]')
    csv_path = os.path.join(QA, 'export.csv'); dl.value.save_as(csv_path)
    lines = open(csv_path, encoding='utf-8-sig').read().strip().split('\n')
    assert lines[0].startswith('Name,Email') and len(lines) > 2, 'the CSV must carry the filtered rows'
    print(f'flow → CSV export ({len(lines) - 1} rows)')

    # ================= LINKS =================
    page.goto(a.base + '/links', wait_until='networkidle'); page.wait_for_timeout(1200)
    n_links = page.locator('[data-block=list] [data-row]').count()
    shot(page, 'v2-links.png', full_page=True)

    # create a PUBLIC link for Building Bridges Boston (free event → register-invite confirms instantly)
    label = 'QA flow ' + stamp
    page.select_option('[data-role=nEvent]', 'boston')
    page.select_option('[data-role=nKind]', 'PUBLIC')
    page.fill('[data-role=nLimit]', '5'); page.fill('[data-role=nNote]', label)
    page.click('[data-act=create]'); page.wait_for_timeout(1500)
    assert page.locator('[data-block=list] [data-row]').count() == n_links + 1, 'the new link must appear in LIVE LINKS'
    assert label in page.locator('[data-block=list]').inner_text(), 'the new link must carry its note as the name'
    st_, links = api('GET', a.base + '/api/admin/registration-links', token=token)
    mine = next(l for l in links if l.get('label') == label)
    print('flow → link created:', mine['token'][:10] + '…')

    # register through it (the member/public endpoint the invite page posts to)
    email = f'qa.flow.{stamp}@example.org'
    st_, r = api('POST', a.member + '/api/register-invite', {
        'first_name': 'Šime', 'last_name': 'Pranjić', 'email': email, 'institution': 'KBC Rijeka',
        'event_type': 'bridges', 'event_id': mine.get('event_id'), 'event_name': 'Building Bridges Boston',
        'link_token': mine['token'], 'package_items': ['Building Bridges Boston']})
    assert st_ == 200 and r.get('success'), f'register through the link must succeed ({st_} {r})'

    # the sign-up shows in Registrations, tagged with its source link
    page.goto(a.base + '/registrations?q=' + email.split('@')[0], wait_until='networkidle'); page.wait_for_timeout(1200)
    row = page.locator('[data-block=table] [data-act=open]')
    assert row.count() == 1, 'the fresh sign-up must appear in the all-events table'
    assert row.first.locator('[data-act=linkTag]').count() == 1, 'the row must carry its source-link tag'
    page.click('[data-block=table] [data-act=open]'); page.wait_for_timeout(400)
    assert label in page.locator('[data-block=panel]').inner_text(), 'the file panel SOURCE must name the link'
    print('flow → sign-up appears in Registrations, tagged with its source link')

    # count increments on the Links list
    page.goto(a.base + '/links', wait_until='networkidle'); page.wait_for_timeout(1200)
    row = page.locator('[data-block=list] [data-row]', has_text=label)
    assert '1 sign-up' in row.inner_text(), 'the link row must count the sign-up'
    print('flow → sign-up count increments on the link')

    # QR modal
    row.locator('[data-act=qr]').click(); page.wait_for_timeout(900)
    assert page.locator('.mx-modal img[src^="data:image/png"]').count() == 1, 'the QR modal must show the PNG'
    shot(page, 'v2-links-qr.png'); page.keyboard.press('Escape'); page.wait_for_timeout(300)

    # PAUSE blocks the next registration; RESUME reopens it
    row.locator('[data-act=pause]').click(); page.wait_for_timeout(1200)
    row = page.locator('[data-block=list] [data-row]', has_text=label)
    assert 'RESUME' in row.inner_text(), 'a paused link must offer RESUME'
    st_, r = api('POST', a.member + '/api/register-invite', {
        'first_name': 'Ana', 'last_name': 'Blocked', 'email': f'qa.blocked.{stamp}@example.org',
        'event_type': 'bridges', 'event_id': mine.get('event_id'), 'link_token': mine['token']})
    assert st_ == 410, f'a paused link must refuse the registration (got {st_} {r})'
    row.locator('[data-act=pause]').click(); page.wait_for_timeout(1200)
    assert 'PAUSE' in page.locator('[data-block=list] [data-row]', has_text=label).inner_text(), 'RESUME must re-arm the link'
    print('flow → pause blocks the registration (410), resume re-opens')

    # copy button
    page.locator('[data-block=list] [data-row]', has_text=label).locator('[data-act=copy]').click(); page.wait_for_timeout(400)
    assert '✓ COPIED' in page.locator('[data-block=list]').inner_text(), 'COPY must flip to ✓ COPIED'

    # cancel + UNDO on the fresh registration
    page.goto(a.base + '/registrations?q=' + email.split('@')[0], wait_until='networkidle'); page.wait_for_timeout(1200)
    page.click('[data-block=table] [data-act=open]'); page.wait_for_timeout(400)
    page.click('[data-block=panel] [data-act=cancel]'); page.wait_for_timeout(300)
    assert 'SURE? CANCEL' in page.locator('[data-block=panel]').inner_text(), 'cancel must ask twice'
    page.click('[data-block=panel] [data-act=cancel]'); page.wait_for_timeout(1200)
    assert 'CANCELLED' in page.locator('[data-block=table]').inner_text(), 'the row must show CANCELLED'
    page.click('.mx-toast .undo'); page.wait_for_timeout(1500)
    assert 'CANCELLED' not in page.locator('[data-block=table]').inner_text(), 'UNDO must restore the registration'
    print('flow → cancel (confirm) + UNDO restore')

    # responsive
    for w in (900, 430):
        page.set_viewport_size({'width': w, 'height': 900}); page.wait_for_timeout(500)
        shot(page, f'v2-registrations-{w}.png', full_page=True)
    page.set_viewport_size({'width': 900, 'height': 900})
    page.goto(a.base + '/links', wait_until='networkidle'); page.wait_for_timeout(900)
    shot(page, 'v2-links-900.png', full_page=True)
    page.close()
    browser.close()

open(os.path.join(QA, 'console.txt'), 'w').write('\n'.join(errors) + '\n')
print('\nconsole issues:', len(errors)); [print(' ', e) for e in errors[:40]]
sys.exit(1 if errors else 0)
