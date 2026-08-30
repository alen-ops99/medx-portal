#!/usr/bin/env python3
"""scripts/qa-admin-people-pages.py — QA for the PEOPLE and MEMBER PAGES destinations:
screenshot the two artboards (file://) and the v2 screens at 1440 px, exercise the real flows,
and fail on any console error.

Flows covered:
  · People — directory search narrows the list, a row click opens the member file panel,
    the TEAM segment filters, EXPORT count follows the filter.
  · Member Pages — edit the Plexus STATUS LABEL → the preview card updates live as you type →
    SAVE flips to "✓ SAVED — LIVE FOR MEMBERS" → the MEMBER backend's /api/public/status is
    polled until it serves the new label (the real write-path proof) → label restored.
  · Registration-form field editor — add a question on BUILDING BRIDGES through the UI, mint a
    bridges registration link via the API, fetch the PUBLIC member-backend form page through the
    dev-server proxy and assert the question renders there; plexus add is verified by API
    read-back. QA questions and the link are removed afterwards.

   MEDX_QA_EMAIL=pjero.bacic@medx.hr MEDX_QA_PASSWORD='Plexus2026!' python3 scripts/qa-admin-people-pages.py --base http://localhost:8917
   MEDX_QA_TOKEN=<jwt> python3 scripts/qa-admin-people-pages.py                  # reuse a token (15 logins / 15 min limit)

Outputs to _qa/admin-people-pages/: design-people.png · design-member-pages.png · v2-people.png ·
v2-people-panel.png · v2-member-pages.png · v2-member-pages-editing.png · v2-member-pages-gala.png ·
v2-member-pages-fields.png · v2-people-900.png · v2-member-pages-900.png · console.txt.
Exit code 1 when a console error/pageerror was captured or a flow assertion failed.

Run as a FULL-ACCESS admin (allowed_sections NULL) on the scratch DB — the flows write to it.
"""
import os, sys, json, time, argparse, urllib.request
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..'))
QA = os.path.join(ROOT, '_qa', 'admin-people-pages'); os.makedirs(QA, exist_ok=True)
ap = argparse.ArgumentParser()
ap.add_argument('--base', default='http://localhost:8917')
ap.add_argument('--design', default=os.path.abspath(os.path.join(ROOT, '..', '..', 'design', 'handoff', 'admin-portal-2026-08-28')))
ap.add_argument('--token', default=os.environ.get('MEDX_QA_TOKEN', ''))
ap.add_argument('--email', default=os.environ.get('MEDX_QA_EMAIL', ''))
ap.add_argument('--password', default=os.environ.get('MEDX_QA_PASSWORD', ''))
ap.add_argument('--width', type=int, default=1440)
ap.add_argument('--only', default='')
a = ap.parse_args()

def api(path, method='GET', body=None, token=None):
    req = urllib.request.Request(a.base + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + token} if token else {})})
    return json.load(urllib.request.urlopen(req))

def login():
    if a.token: return a.token, None
    if not (a.email and a.password): sys.exit('need MEDX_QA_TOKEN or MEDX_QA_EMAIL + MEDX_QA_PASSWORD')
    d = api('/api/auth/login', 'POST', {'email': a.email, 'password': a.password})
    return d['token'], json.dumps(d['user'])

errors, failures = [], []
def watch(page, name):
    page.on('console', lambda m, n=name: errors.append(f'[{n}] {m.type}: {m.text}') if m.type == 'error' else None)
    page.on('pageerror', lambda e, n=name: errors.append(f'[{n}] pageerror: {e}'))
def check(cond, msg):
    if cond: print('  ok —', msg)
    else: failures.append(msg); print('  FAIL —', msg)

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    # ---- artboards (design references) ----
    if not a.only or 'design' in a.only:
        for f, out in [('Admin People.dc.html', 'design-people.png'), ('Admin Member Pages.dc.html', 'design-member-pages.png')]:
            path = os.path.join(a.design, f)
            if not os.path.exists(path): print('skip artboard (not found):', path); continue
            page = browser.new_page(viewport={'width': a.width, 'height': 900})
            page.goto('file://' + path.replace(' ', '%20').replace('&', '%26'), wait_until='load')
            page.wait_for_timeout(1200)
            page.screenshot(path=os.path.join(QA, out), full_page=True)
            print('artboard →', out); page.close()

    token, user = login()
    def authed_page():
        page = browser.new_page(viewport={'width': a.width, 'height': 900})
        page.goto(a.base + '/signin', wait_until='load')
        page.evaluate("([t,u]) => { localStorage.setItem('medx_token', t); if (u) localStorage.setItem('medx_user', u); }", [token, user])
        return page

    # ---- PEOPLE ----
    if not a.only or 'people' in a.only:
        page = authed_page(); watch(page, 'people')
        page.goto(a.base + '/people', wait_until='networkidle'); page.wait_for_timeout(1200)
        page.screenshot(path=os.path.join(QA, 'v2-people.png'), full_page=True); print('v2 → v2-people.png')
        total = page.locator('[data-act=openRow]').count()
        check(total > 5, f'directory renders rows ({total})')
        # search narrows + the panel follows
        page.fill('[data-role=peopleQ]', 'laura'); page.wait_for_timeout(400)
        narrowed = page.locator('[data-act=openRow]').count()
        check(0 < narrowed < total, f'search narrows the list ({total} → {narrowed})')
        page.locator('[data-act=openRow]').first.click(); page.wait_for_timeout(600)
        check('Laura' in page.inner_text('[data-block=panel]'), 'row click opens the member file panel')
        page.screenshot(path=os.path.join(QA, 'v2-people-panel.png'), full_page=True); print('v2 → v2-people-panel.png')
        # TEAM segment filters
        page.fill('[data-role=peopleQ]', ''); page.wait_for_timeout(300)
        page.locator('[data-act=seg][data-seg=TEAM]').click(); page.wait_for_timeout(400)
        team_rows = page.locator('[data-act=openRow]').count()
        team_ok = page.locator('[data-act=openRow]').first.inner_text()
        check(team_rows > 0 and 'TEAM' in team_ok, f'TEAM segment filters ({team_rows} rows)')
        # guest passes card is real (mint form present, events loaded)
        check(page.locator('[data-role=passDraft]').count() == 1 and page.locator('[data-role=passEvent] option').count() > 0, 'guest-pass mint form with live event options')
        # MINT PASS through the UI → a real vip_passes row appears in the card
        guest = 'QA Pass Guest ' + str(int(time.time()))
        page.fill('[data-role=passDraft]', guest)
        page.locator('[data-act=mintPass]').click(); page.wait_for_timeout(900)
        check(guest in page.inner_text('[data-block=passes]'), 'MINT PASS creates a guest pass (visible in the card)')
        minted = [pp for pp in api('/api/admin/guest-passes', token=token)['passes'] if pp['guest_name'] == guest]
        check(bool(minted) and minted[0].get('public_url'), 'minted pass stored with a public /pass link')
        for pp in minted: api('/api/admin/guest-passes/' + pp['id'], 'DELETE', None, token)
        # + ADD A PERSON (Contact only) through the UI → lands in the directory
        contact = 'QA Flow Contact ' + str(int(time.time()))
        page.locator('[data-act=addToggle]').click(); page.wait_for_timeout(300)
        page.fill('[data-role=npName]', contact)
        page.select_option('[data-role=npKind]', 'Contact only')
        page.locator('[data-act=npAdd]').click(); page.wait_for_timeout(1500)
        page.fill('[data-role=peopleQ]', contact); page.wait_for_timeout(400)
        check(page.locator('[data-act=openRow]').count() == 1 and contact in page.inner_text('[data-block=list]'), 'added contact appears in the directory')
        page.fill('[data-role=peopleQ]', ''); page.wait_for_timeout(300)
        try:                                             # cleanup — leave the scratch DB tidy
            for c in api('/api/contacts', token=token):
                if isinstance(c, dict) and contact.startswith(str(c.get('first_name', '~'))): api('/api/contacts/' + c['id'], 'DELETE', None, token)
        except Exception: pass
        # responsive
        page.set_viewport_size({'width': 900, 'height': 900}); page.wait_for_timeout(500)
        page.screenshot(path=os.path.join(QA, 'v2-people-900.png'), full_page=True); print('v2 → v2-people-900.png')
        page.close()

    # ---- MEMBER PAGES ----
    if not a.only or 'member-pages' in a.only:
        page = authed_page(); watch(page, 'member-pages')
        page.goto(a.base + '/member-pages/plexus', wait_until='networkidle'); page.wait_for_timeout(1200)
        page.screenshot(path=os.path.join(QA, 'v2-member-pages.png'), full_page=True); print('v2 → v2-member-pages.png')

        # remember the live label, then edit — the preview must update AS YOU TYPE
        original = api('/api/admin/project-status/plexus', token=token)['status_label']
        qa_label = 'QA live check ' + str(int(time.time()))
        page.fill('[data-role=ps-status]', qa_label); page.wait_for_timeout(300)
        check(page.inner_text('[data-role=prevTitle]').strip() == qa_label, 'preview title updates live as you type')
        page.screenshot(path=os.path.join(QA, 'v2-member-pages-editing.png'), full_page=True); print('v2 → v2-member-pages-editing.png')

        # SAVE → Saved ✓ → the MEMBER backend serves the new label (the real proof)
        page.locator('[data-role=saveBtn]').click()
        page.wait_for_timeout(1500)
        check('SAVED' in page.inner_text('[data-role=saveBtn]'), 'save button flips to ✓ SAVED — LIVE FOR MEMBERS')
        member_label, waited = None, 0
        while waited <= 45:
            d = json.load(urllib.request.urlopen(a.base + '/__member/api/public/status?t=%d' % time.time()))
            member_label = next((p['status_label'] for p in d['projects'] if p['project_key'] == 'plexus'), None)
            if member_label == qa_label: break
            time.sleep(5); waited += 5
        check(member_label == qa_label, f'member backend /api/public/status serves the saved label (after ~{waited}s)')
        page.wait_for_timeout(6500)   # give the view's own poller a beat to print the confirmation
        check('CONFIRMED' in page.inner_text('[data-role=proof]'), 'preview card reports MEMBER PORTAL CONFIRMED ✓')
        api('/api/admin/project-status/plexus', 'PUT', {'status_label': original}, token)   # restore

        # registration-form field editor — plexus add, verified by API read-back
        q_plexus = 'QA plexus question ' + str(int(time.time()))
        page.locator('[data-act=fieldsToggle]').click(); page.wait_for_timeout(300)
        page.fill('[data-role=newFieldLabel]', q_plexus)
        page.locator('[data-act=fieldAdd]').click(); page.wait_for_timeout(1000)
        labels = [page.locator('[data-role^=f-label-]').nth(i).input_value() for i in range(page.locator('[data-role^=f-label-]').count())]
        check(q_plexus in labels, 'plexus question appears in the editor list')
        flds = api('/api/admin/custom-fields?event_type=plexus', token=token)
        check(any(f['label'] == q_plexus for f in flds), 'plexus question stored in the form engine (API read-back)')
        page.screenshot(path=os.path.join(QA, 'v2-member-pages-fields.png'), full_page=True); print('v2 → v2-member-pages-fields.png')

        # bridges question through the UI → PUBLIC member-backend form page renders it
        q_bridges = 'QA bridges question ' + str(int(time.time()))
        page.locator('[data-act=tab][data-proj=bridges]').click(); page.wait_for_timeout(900)
        page.locator('[data-act=fieldsToggle]').click(); page.wait_for_timeout(300)
        page.fill('[data-role=newFieldLabel]', q_bridges)
        page.locator('[data-act=fieldAdd]').click(); page.wait_for_timeout(1000)
        api('/api/admin/registration-links', 'POST', {'event_type': 'bridges', 'event_name': 'QA field proof', 'link_type': 'vip', 'expires_days': 1}, token)
        links = api('/api/admin/registration-links', token=token)
        rows = links if isinstance(links, list) else links.get('links', [])
        url = next((r.get('url') for r in rows if r.get('event_name') == 'QA field proof'), '')
        path = '/' + url.split('/', 3)[3] if url.count('/') >= 3 else ''
        html = urllib.request.urlopen(a.base + '/__member' + path).read().decode('utf-8', 'ignore') if path else ''
        check(q_bridges in html, 'PUBLIC member-backend form page renders the new question')
        # cleanup — remove the QA questions (answers, if any, would stay; these have none)
        for ev, q in [('plexus', q_plexus), ('bridges', q_bridges)]:
            for f in api('/api/admin/custom-fields?event_type=' + ev, token=token):
                if f['label'] == q: api('/api/admin/custom-fields/' + f['id'], 'DELETE', None, token)

        # gala tab (prices editor) + responsive
        page.locator('[data-act=tab][data-proj=gala]').click(); page.wait_for_timeout(900)
        check(page.locator('[data-role=gala-early]').count() == 1, 'gala PRICES row renders the € editor')
        page.screenshot(path=os.path.join(QA, 'v2-member-pages-gala.png'), full_page=True); print('v2 → v2-member-pages-gala.png')
        page.set_viewport_size({'width': 900, 'height': 900}); page.wait_for_timeout(500)
        page.screenshot(path=os.path.join(QA, 'v2-member-pages-900.png'), full_page=True); print('v2 → v2-member-pages-900.png')
        page.close()
    browser.close()

open(os.path.join(QA, 'console.txt'), 'w').write('\n'.join(errors) + '\n')
print('\nconsole errors:', len(errors)); [print(' ', e) for e in errors[:40]]
print('flow failures:', len(failures)); [print(' ', f) for f in failures]
sys.exit(1 if (errors or failures) else 0)
