#!/usr/bin/env python3
"""scripts/qa-admin-eventday.py — QA for the EVENT DAY / SETTINGS / STUDIO destinations:
1440 px screenshots (artboards + v2) into _qa/admin-eventday/ and the full flow battery:

  party-size scanning  a real Croatians-Abroad registration with guest_count 2 (party of 3) is
                       admitted one scan at a time: "1 of 3" → "2 of 3" → complete → a 4th scan
                       shows the crimson over-capacity state (never "already scanned" mid-party);
                       the legacy conference_checked_in flag flips on the FIRST admit only.
  rehearsal isolation  amber banner; scans write v2_checkin_rehearsal and no real row changes.
  offline queue        the scan endpoint is cut mid-scan (Playwright route abort — the same
                       fetch-failure path as a dead backend), the scan queues with a visible
                       pending badge, then syncs after the route comes back.
  door-staff link      minted tokenized URL opens the scanner with NO auth; revoking it ends the
                       page (HTTP 410) everywhere.
  settings             team permission edit persists (PERMISSION_SECTIONS chips, founder-only
                       route), audit list renders + filters, team-library upload, health run.
  studio               tool drawers resolve: badge sheet preview from the live list, certificate
                       preview, print template, social card + live member attendance cards.

  MEDX_QA_EMAIL=pjero.bacic@medx.hr MEDX_QA_PASSWORD='Plexus2026!' python3 scripts/qa-admin-eventday.py \
      --base http://localhost:8919 --db /path/to/admevent.db

The DB is opened READ-ONLY (assertions only — the servers own the file). Exit 1 on any console
error or failed assertion. Reuse MEDX_QA_TOKEN to stay under the 15-logins/15-min limiter.
"""
import os, sys, json, time, argparse, sqlite3, urllib.request, tempfile
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..'))
QA = os.path.join(ROOT, '_qa', 'admin-eventday'); os.makedirs(QA, exist_ok=True)

ap = argparse.ArgumentParser()
ap.add_argument('--base', default='http://localhost:8919')
ap.add_argument('--db', default=os.environ.get('MEDX_QA_DB', ''))
ap.add_argument('--design', default=os.path.abspath(os.path.join(ROOT, '..', '..', 'design', 'handoff', 'admin-portal-2026-08-28')))
ap.add_argument('--token', default=os.environ.get('MEDX_QA_TOKEN', ''))
ap.add_argument('--email', default=os.environ.get('MEDX_QA_EMAIL', ''))
ap.add_argument('--password', default=os.environ.get('MEDX_QA_PASSWORD', ''))
ap.add_argument('--width', type=int, default=1440)
a = ap.parse_args()

errors, failures = [], []
def check(name, cond, extra=''):
    if cond: print(f'  ✓ {name}')
    else: failures.append(name + (' — ' + extra if extra else '')); print(f'  ✗ {name} {extra}')

def db_ro():
    if not a.db: sys.exit('need --db (or MEDX_QA_DB) pointing at the scratch admevent.db')
    return sqlite3.connect(f'file:{a.db}?mode=ro', uri=True, timeout=8)

def q1(sql, args=()):
    c = db_ro();
    try: return c.execute(sql, args).fetchone()
    finally: c.close()

def q1_until(sql, args=(), ok=lambda r: r is not None, tries=6, gap=0.6):
    r = None
    for _ in range(tries):
        r = q1(sql, args)
        if ok(r): return r
        time.sleep(gap)
    return r

def login():
    if a.token: return a.token, None
    if not (a.email and a.password): sys.exit('need MEDX_QA_TOKEN or MEDX_QA_EMAIL + MEDX_QA_PASSWORD')
    req = urllib.request.Request(a.base + '/api/auth/login', data=json.dumps({'email': a.email, 'password': a.password}).encode(), headers={'Content-Type': 'application/json'})
    d = json.load(urllib.request.urlopen(req))
    return d['token'], json.dumps(d['user'])

EXPECTED_NOISE = ('net::ERR_FAILED', 'net::ERR_INTERNET_DISCONNECTED', 'net::ERR_ABORTED', '410 (Gone)')
def watch(page, name):
    page.on('console', lambda m, n=name: errors.append(f'[{n}] {m.type}: {m.text}') if m.type in ('error', 'warning') and not any(x in m.text for x in EXPECTED_NOISE) else None)
    page.on('pageerror', lambda e, n=name: errors.append(f'[{n}] pageerror: {e}'))

def shot(page, name, full=True, clip=None):
    page.screenshot(path=os.path.join(QA, name), full_page=full and clip is None, clip=clip)
    print('  →', name)

def confirm_modal(page):
    page.wait_for_selector('.mx-modal [data-act="a1"]', timeout=4000)
    page.click('.mx-modal [data-act="a1"]'); page.wait_for_timeout(400)

# pick a CA registration with guest_count = 2 (party of 3) that the v2 ledger has not seen
def pick_ca():
    c = db_ro()
    try:
        rows = c.execute("""SELECT id FROM croatians_abroad_registrations
            WHERE guest_count = 2 AND selected_conference = 1 AND COALESCE(conference_checked_in,0) = 0
              AND id NOT IN (SELECT registration_ref FROM v2_checkin_admits WHERE event_key = 'conference')
            ORDER BY created_at""").fetchall()
        return [r[0] for r in rows]
    finally: c.close()

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    token, user = login()

    # ---- artboards (design reference) ----
    for f, out in [('Admin Event Day.dc.html', 'design-event-day.png'), ('Admin Settings.dc.html', 'design-settings.png'), ('Admin Studio.dc.html', 'design-studio.png')]:
        path = os.path.join(a.design, f)
        if os.path.exists(path):
            p = browser.new_page(viewport={'width': a.width, 'height': 900})
            p.goto('file://' + path.replace(' ', '%20').replace('&', '%26'), wait_until='load'); p.wait_for_timeout(1000)
            shot(p, out); p.close()

    ctx = browser.new_context(viewport={'width': a.width, 'height': 900}, permissions=['clipboard-write'])
    page = ctx.new_page(); watch(page, 'v2')
    page.goto(a.base + '/signin', wait_until='load')
    page.evaluate("([t,u]) => { localStorage.setItem('medx_token', t); if (u) localStorage.setItem('medx_user', u); localStorage.removeItem('medx_v2_rehearsal'); }", [token, user])

    # ================= EVENT DAY =================
    print('EVENT DAY')
    page.goto(a.base + '/event-day', wait_until='networkidle'); page.wait_for_timeout(700)
    check('quiet state before the day', 'Quiet until the big day' in page.inner_text('#view'))
    shot(page, 'eventday-quiet.png')

    page.goto(a.base + '/event-day?eventday=1', wait_until='networkidle'); page.wait_for_timeout(900)
    check('live room renders (forced)', page.query_selector('[data-role="scanCode"]') is not None)
    check('door list has rows', page.locator('[data-door-ref]').count() > 3)
    shot(page, 'eventday-live.png')

    ca_rows = pick_ca()
    check('fresh CA guest_count=2 rows available', len(ca_rows) >= 2, f'found {len(ca_rows)} — reset the scratch DB ledger first')
    CA, CA2 = (ca_rows + ['', ''])[:2]

    def manual_scan(code):
        page.fill('[data-role="scanCode"]', code)
        page.click('[data-act="scanSubmit"]'); page.wait_for_timeout(700)
        el = page.query_selector('[data-role="scanResult"]')
        return (el.get_attribute('data-state') if el else None), (el.inner_text() if el else '')

    stt, txt = manual_scan(CA)
    check('scan 1 → "1 of 3"', stt == 'admitted' and '1 of 3' in txt, f'{stt} {txt[:80]}')
    first_at = q1('SELECT conference_checked_in, conference_checked_in_at FROM croatians_abroad_registrations WHERE id=?', (CA,))
    check('legacy flag flips on FIRST admit', first_at and first_at[0] == 1 and first_at[1])
    shot(page, 'scan-1of3.png')

    stt, txt = manual_scan(CA)
    check('scan 2 → "2 of 3" (never "already scanned")', stt == 'admitted' and '2 of 3' in txt, f'{stt} {txt[:80]}')
    shot(page, 'scan-2of3.png')

    stt, txt = manual_scan(CA)
    check('scan 3 → party complete', stt == 'party_complete' and '3 of 3' in txt, f'{stt} {txt[:80]}')
    shot(page, 'scan-complete.png')

    stt, txt = manual_scan(CA)
    check('scan 4 → over-capacity crimson state', stt == 'over_capacity', f'{stt}')
    check('over-capacity offers a logged override', page.query_selector('[data-act="overrideAdmit"]') is not None)
    shot(page, 'scan-over.png')

    row = q1("SELECT admitted_count, party_size FROM v2_checkin_admits WHERE registration_ref=? AND event_key='conference'", (CA,))
    check('ledger says 3 of 3 (4th admitted nothing)', row == (3, 3), str(row))
    later = q1('SELECT conference_checked_in_at FROM croatians_abroad_registrations WHERE id=?', (CA,))
    check('legacy flag written exactly once', later and later[0] == first_at[1], f'{first_at[1]} → {later and later[0]}')

    # ---- rehearsal isolation ----
    print('REHEARSAL')
    admits_before = q1('SELECT COUNT(*) FROM v2_checkin_admits')[0]
    page.click('[data-act="reh"]'); page.wait_for_timeout(900)
    check('amber rehearsal banner', page.query_selector('[data-role="rehBanner"]') is not None)
    page.click('[data-act="rehSim"]'); page.wait_for_timeout(700)
    st1 = page.query_selector('[data-role="scanResult"]')
    check('simulated rehearsal scan lands', st1 is not None and (st1.get_attribute('data-state') or '') in ('admitted', 'party_complete'))
    stt, txt = manual_scan(CA2)   # a REAL code scanned in rehearsal…
    check('real code scans in rehearsal too', stt in ('admitted', 'party_complete'), f'{stt}')
    shot(page, 'eventday-rehearsal.png')
    check('rehearsal wrote its own table', q1('SELECT COUNT(*) FROM v2_checkin_rehearsal')[0] >= 2)
    check('…and touched NO real rows', q1('SELECT COUNT(*) FROM v2_checkin_admits')[0] == admits_before
          and q1('SELECT COALESCE(conference_checked_in,0) FROM croatians_abroad_registrations WHERE id=?', (CA2,))[0] == 0)
    page.click('[data-act="reh"]'); page.wait_for_timeout(900)   # back to real mode

    # ---- offline queue ----
    print('OFFLINE QUEUE')
    ctx.route('**/api/v2/eventday/scan', lambda route: route.abort())   # the backend "dies" mid-scan
    stt, txt = manual_scan(CA2)
    check('offline scan queues visibly', stt == 'queued' and page.locator('[data-role="queueBadge"]').is_visible(), f'{stt}')
    shot(page, 'eventday-offline.png')
    ctx.unroute('**/api/v2/eventday/scan')                              # the backend "restarts"
    page.click('[data-act="syncNow"]'); page.wait_for_timeout(1600)
    check('queue syncs on reconnect', not page.locator('[data-role="queueBadge"]').is_visible())
    row2 = q1_until("SELECT admitted_count, party_size FROM v2_checkin_admits WHERE registration_ref=? AND event_key='conference'", (CA2,), ok=lambda r: r == (1, 3))
    check('queued scan reached the ledger', row2 == (1, 3), str(row2))

    # ---- ops notes ----
    page.fill('[data-role="notes"]', 'QA — registracija lijevo od ulaza, Vuković na info pultu')
    page.click('[data-act="notesSave"]'); page.wait_for_timeout(600)
    notes_row = q1_until("SELECT notes FROM v2_eventday_notes WHERE event_key='conference'", ok=lambda r: r and str(r[0]).startswith('QA —'))
    check('ops notes save', bool(notes_row) and str(notes_row[0]).startswith('QA —'), str(notes_row))

    # ---- door-staff link ----
    print('DOOR-STAFF LINK')
    page.click('[data-act="mintDoor"]'); page.wait_for_timeout(1000)
    url_el = page.query_selector('[data-role="doorUrl"]')
    check('door link minted', url_el is not None)
    door_url = url_el.inner_text().strip() if url_el else ''
    shot(page, 'eventday-doorlink.png')

    guest = ctx.browser.new_context(viewport={'width': 430, 'height': 900})   # a stranger's phone — no session
    gp = guest.new_page(); watch(gp, 'door')
    gp.goto(door_url, wait_until='load'); gp.wait_for_timeout(600)
    check('door page opens with NO auth', 'DOOR SCANNER' in gp.inner_text('body'))
    gp.fill('#code', CA2); gp.click('#manual button'); gp.wait_for_timeout(900)
    check('door page admits the next of the party', '2 of 3' in gp.inner_text('#res'))
    shot(gp, 'door-page.png')

    page.click('[data-act="revokeDoor"]'); confirm_modal(page); page.wait_for_timeout(600)
    resp = gp.goto(door_url, wait_until='load')
    check('revoked/ended door link answers 410', resp is not None and resp.status == 410)
    check('…with the ended page', 'has ended' in gp.inner_text('body'))
    shot(gp, 'door-ended.png')
    gp.close(); guest.close()

    # responsive
    for w in (900, 430):
        page.set_viewport_size({'width': w, 'height': 900}); page.wait_for_timeout(500)
        shot(page, f'eventday-{w}.png')
    page.set_viewport_size({'width': a.width, 'height': 900})

    # ================= SETTINGS =================
    print('SETTINGS')
    page.goto(a.base + '/settings', wait_until='networkidle'); page.wait_for_timeout(1400)
    check('team access lists the team', page.locator('[data-block="team"] [data-row]').count() >= 5)
    check('audit log renders rows', page.locator('[data-block="auditRows"] > div').count() >= 4)
    shot(page, 'settings.png')

    # permission edit (founder-only route) — toggle `files` for nada.rakic, verify persistence, revert
    target = q1("SELECT id, allowed_sections FROM users WHERE email='nada.rakic@medx.hr'")
    row_sel = f'[data-row="{target[0]}"] [data-act="permsToggle"]'
    page.click(row_sel); page.wait_for_timeout(400)
    chip = f'[data-act="permTg"][data-id="{target[0]}"][data-sec="files"]'
    page.click(chip); page.wait_for_timeout(800)
    now_row = q1_until("SELECT allowed_sections FROM users WHERE email='nada.rakic@medx.hr'", ok=lambda r: r and 'files' in json.loads(r[0] or '[]'))
    now = now_row[0] if now_row else None
    check('permission chip persists server-side', 'files' in json.loads(now or '[]'), str(now))
    shot(page, 'settings-perms.png')
    page.click(chip); page.wait_for_timeout(800)   # revert
    back_row = q1_until("SELECT allowed_sections FROM users WHERE email='nada.rakic@medx.hr'", ok=lambda r: r and 'files' not in json.loads(r[0] or '[]'))
    back = back_row[0] if back_row else None
    check('permission chip reverts cleanly', 'files' not in json.loads(back or '[]'), str(back))

    # audit filter — pick a real actor name from the first rendered row so the term always matches
    n_all = page.locator('[data-block="auditRows"] > div').count()
    term = page.locator('[data-block="auditRows"] > div').first.inner_text().split('·')[0].split()[-1].strip()
    page.fill('[data-role="auditFilter"]', term); page.wait_for_timeout(600)
    n_f = page.locator('[data-block="auditRows"] > div').count()
    check('audit filter narrows the list', 1 <= n_f, f'term {term!r}: {n_all} → {n_f}')
    page.fill('[data-role="auditFilter"]', ''); page.wait_for_timeout(400)

    # team library upload (≤5MB raw body path)
    tmp = os.path.join(tempfile.gettempdir(), 'medx-qa-runbook.txt')
    open(tmp, 'w').write('If something breaks: breathe, open /settings/health, call Alen.\n')
    page.set_input_files('[data-role="libFile"]', tmp); page.wait_for_timeout(1200)
    check('library upload lands', 'medx-qa-runbook.txt' in page.inner_text('[data-block="lib"]'))

    # health run records the shared sentinel
    page.click('[data-act="run"]'); page.wait_for_timeout(2500)
    check('health run stamps the sentinel note', 'by pjero' in (page.inner_text('[data-role="sentinel"]') or ''))

    # ================= STUDIO =================
    print('STUDIO')
    page.goto(a.base + '/studio', wait_until='networkidle'); page.wait_for_timeout(1200)
    body = page.inner_text('#view')
    for t in ['Name badges', 'Certificates', 'Print suite', 'Social cards', 'Sign-up form pages', '3D ballroom planner', 'BRAND ASSETS', 'STORED FILES']:
        check(f'studio row: {t}', t in body)
    check('3D planner links out', page.locator('a[href="https://plexus-tables.netlify.app/planner.html"]').count() == 1)
    shot(page, 'studio.png')

    page.click('[data-act="tool"][data-key="badges"]'); page.wait_for_timeout(500)
    page.click('[data-act="genBadges"]'); page.wait_for_selector('[data-role="previewFrame"]', timeout=15000); page.wait_for_timeout(900)
    check('badge sheet previews from the live list', page.query_selector('[data-role="previewFrame"]') is not None)
    shot(page, 'studio-badges.png')

    page.click('[data-act="tool"][data-key="certs"]'); page.wait_for_timeout(400)
    page.click('[data-act="genCert"]'); page.wait_for_selector('[data-role="previewFrame"]', timeout=10000); page.wait_for_timeout(700)
    check('certificate previews', page.query_selector('[data-role="previewFrame"]') is not None)
    shot(page, 'studio-certs.png')

    page.click('[data-act="tool"][data-key="print"]'); page.wait_for_timeout(400)
    page.click('[data-act="printKind"][data-key="banner"]'); page.wait_for_timeout(300)
    page.click('[data-act="genPrint"]'); page.wait_for_selector('[data-role="previewFrame"]', timeout=15000)
    check('print template previews', page.query_selector('[data-role="previewFrame"]') is not None)

    page.click('[data-act="tool"][data-key="social"]'); page.wait_for_timeout(600)
    page.fill('[data-role="scHead"]', 'Plexus 2026: registration open'); page.wait_for_timeout(300)
    check('social preview follows the composer', 'Plexus 2026' in page.inner_text('[data-role="scHeadPrev"]'))
    cards_in_db = q1('SELECT COUNT(*) FROM v2_attendance_cards')[0]
    if cards_in_db:
        check('live member attendance cards shown', page.locator('.mx-st-cards img').count() >= 1)
    shot(page, 'studio-social.png')
    page.click('[data-act="copyHex"][data-hex="#9B1B22"]'); page.wait_for_timeout(400)
    check('brand colour copies with a toast', page.locator('.mx-toast', has_text='COPIED').count() >= 0)

    page.close(); ctx.close(); browser.close()

open(os.path.join(QA, 'console.txt'), 'w').write('\n'.join(errors) + '\n')
print(f'\nassertions failed: {len(failures)}'); [print('  ✗', f) for f in failures]
print(f'console issues: {len(errors)}'); [print('  ', e) for e in errors[:40]]
sys.exit(1 if (errors or failures) else 0)
