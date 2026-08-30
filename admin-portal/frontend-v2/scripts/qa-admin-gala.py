#!/usr/bin/env python3
"""scripts/qa-admin-gala.py — QA for the Gala destination (js/views/gala.js vs Admin Gala.dc.html).

Screenshots at 1440 px into _qa/admin-gala/ and real flows against the scratch DB:
  1. seat assign in the list → the seating board fills live
  2. kitchen sheet CSV downloads with the MEALS card numbers
  3. ADD GUEST (VIP path) → appears in the list, counts as paid
  4. MARK PAID → the MEMBER portal sees the pay-state change (public registrations lookup)
  5. non-refundable CANCEL (confirm + toast UNDO) → row leaves and returns
  6. WAITLIST: sold-out room (capacities shrunk in the DB) → new entry waits · a cancel frees a
     seat → the 24 h offer fires automatically (email dumped) · simulated expiry passes the seat
     to the next in line · the public accept link converts to a registration
  7. performers TBA flip → the member portal's /api/v2/gala/meta reflects it, then flips back
Fails (exit 1) on any captured console error/warning.

  MEDX_QA_EMAIL=pjero.bacic@medx.hr MEDX_QA_PASSWORD='Plexus2026!' \
  MEDX_QA_DB=<scratch>/admgala.db MEDX_QA_MEMBER=http://localhost:3943 \
  MEDX_QA_EMAILS=<scratch>/emails python3 scripts/qa-admin-gala.py --base http://localhost:8912
"""
import os, sys, json, time, glob, sqlite3, argparse, subprocess, urllib.request
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..'))
QA = os.path.join(ROOT, '_qa', 'admin-gala'); os.makedirs(QA, exist_ok=True)

ap = argparse.ArgumentParser()
ap.add_argument('--base', default='http://localhost:8912')
ap.add_argument('--admin', default=os.environ.get('MEDX_QA_ADMIN', 'http://localhost:3973'))
ap.add_argument('--member', default=os.environ.get('MEDX_QA_MEMBER', 'http://localhost:3943'))
ap.add_argument('--db', default=os.environ.get('MEDX_QA_DB', ''))
ap.add_argument('--emails', default=os.environ.get('MEDX_QA_EMAILS', ''))
ap.add_argument('--design', default=os.path.abspath(os.path.join(ROOT, '..', '..', 'design', 'handoff', 'admin-portal-2026-08-28')))
ap.add_argument('--token', default=os.environ.get('MEDX_QA_TOKEN', ''))
ap.add_argument('--email', default=os.environ.get('MEDX_QA_EMAIL', ''))
ap.add_argument('--password', default=os.environ.get('MEDX_QA_PASSWORD', ''))
ap.add_argument('--width', type=int, default=1440)
a = ap.parse_args()

# the chrome header search also carries data-role=q — scope to the Gala view root
Q = '[data-screen-label="Admin Gala Management"] [data-role=q]'

def jget(url, token=None):
    req = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + token} if token else {})
    with urllib.request.urlopen(req, timeout=15) as r: return json.load(r)
def jpost(url, body, token=None):
    req = urllib.request.Request(url, data=json.dumps(body or {}).encode(),
        headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + token} if token else {})})
    with urllib.request.urlopen(req, timeout=15) as r: return json.load(r)
def login():
    if a.token: return a.token, None
    if not (a.email and a.password): sys.exit('need MEDX_QA_TOKEN or MEDX_QA_EMAIL + MEDX_QA_PASSWORD')
    d = jpost(a.base + '/api/auth/login', {'email': a.email, 'password': a.password})
    return d['token'], json.dumps(d['user'])

def db(sql, params=(), all=False):
    if not a.db: sys.exit('MEDX_QA_DB must point at the scratch DB')
    c = sqlite3.connect(a.db, timeout=15); c.row_factory = sqlite3.Row
    try:
        cur = c.execute(sql, params); rows = cur.fetchall(); c.commit()
        return [dict(r) for r in rows] if all else (dict(rows[0]) if rows else None)
    finally: c.close()

errors = []
def watch(page, name):
    page.on('console', lambda m, n=name: errors.append(f'[{n}] {m.type}: {m.text}') if m.type in ('error', 'warning') else None)
    page.on('pageerror', lambda e, n=name: errors.append(f'[{n}] pageerror: {e}'))
def shot(page, name, full=True):
    page.screenshot(path=os.path.join(QA, name), full_page=full); print('shot →', name)

ok = lambda label: print('flow →', label)
token, user = login()

# module really mounted?
status = jget(a.admin + '/api/v2/_status')
assert 'gala-ops.js' in status.get('modules', []), 'gala-ops.js is not mounted: ' + json.dumps(status)
ok('v2 gala-ops mounted (' + a.admin + '/api/v2/_status)')

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    # ---- artboard reference ----
    path = os.path.join(a.design, 'Admin Gala.dc.html')
    if os.path.exists(path):
        page = browser.new_page(viewport={'width': a.width, 'height': 900})
        page.goto('file://' + path.replace(' ', '%20').replace('&', '%26'), wait_until='load')
        page.wait_for_timeout(1200); shot(page, 'design-gala.png'); page.close()

    page = browser.new_page(viewport={'width': a.width, 'height': 900}, accept_downloads=True)
    watch(page, 'gala')
    page.goto(a.base + '/signin', wait_until='load')
    page.evaluate("([t,u]) => { localStorage.setItem('medx_token', t); if (u) localStorage.setItem('medx_user', u); }", [token, user])
    page.goto(a.base + '/gala', wait_until='networkidle'); page.wait_for_timeout(1500)
    assert page.locator('[data-screen-label="Admin Gala Management"]').count() == 1, 'the Gala screen must render (stub gone)'
    shot(page, 'v2-gala.png')

    # ---- 1. assign a seat → board fills live ----
    t2 = db("SELECT id FROM gala_tables WHERE label='T2'")
    assert t2, 'ensureTables must have created T1..T10'
    sel = page.locator('[data-role=tableSel]').first
    sel.select_option(label='T2'); page.wait_for_timeout(1200)
    cell = page.locator('[data-act=tableFilter][data-label="T2"]')
    assert '/8' in cell.inner_text() and not cell.inner_text().strip().endswith('0/8'), 'T2 tile must show occupied seats: ' + cell.inner_text()
    assert db('SELECT COUNT(*) AS c FROM gala_seat_assignments')['c'] >= 1, 'assignment row must exist'
    shot(page, 'v2-gala-seated.png'); ok('seat assigned → board updated live')

    # ---- 2. kitchen CSV ----
    with page.expect_download() as dl:
        page.click('[data-act=kitchenCsv]')
    f = dl.value; csv_path = os.path.join(QA, 'kitchen-sheet.csv'); f.save_as(csv_path)
    head = open(csv_path).read().splitlines()
    assert head[0] == 'Meal,Seats' and len(head) >= 3, 'kitchen CSV must carry the meal counts: ' + repr(head[:3])
    ok('kitchen sheet CSV downloaded (' + str(len(head) - 2) + ' meal rows + total)')

    # ---- 3. add guest (VIP) ----
    page.click('[data-act=addToggle]'); page.wait_for_timeout(300)
    page.fill('[data-role=ngName]', 'Vjekoslav Šarić')
    page.fill('[data-role=ngEmail]', 'vjekoslav.saric@example.hr')
    page.select_option('[data-role=ngKind]', 'vip')
    page.click('[data-act=addGuest]'); page.wait_for_timeout(1400)
    row = page.locator('[data-row]', has_text='Vjekoslav Šarić')
    assert row.count() == 1 and 'VIP · PAID' in row.inner_text(), 'VIP guest must appear as paid'
    shot(page, 'v2-gala-added.png'); ok('add guest (VIP) → in the list, counts as paid')

    # ---- 4. mark paid → the MEMBER portal's own /api/gala/my-status flips ----
    # (GET /api/public/registrations/:email cannot carry this proof: its gala branch orders by a
    #  `registered_at` column gala_registrations does not have, so it silently returns [] — a
    #  pre-existing user-portal bug, noted in the report.) A member JWT is minted with the shared
    #  local JWT_SECRET so the check runs the exact endpoint the member Gala screen calls.
    target = 'member004@staging.medx.hr'
    uid = db('SELECT id FROM users WHERE email=?', (target,))['id']
    mtok = subprocess.check_output(['node', '-e',
        "const jwt=require('jsonwebtoken');console.log(jwt.sign({id:process.argv[1],email:process.argv[2],is_admin:0},process.env.MEDX_QA_JWT||'x',{expiresIn:'1h'}))",
        uid, target], cwd=os.path.abspath(os.path.join(ROOT, '..', '..', 'user-portal', 'backend'))).decode().strip()
    before = jget(a.member + '/api/gala/my-status', mtok)
    assert before['registered'] and before['registration']['payment_status'] != 'paid', 'pick an unpaid guest for the chain proof'
    page.fill(Q, 'Member 004'); page.wait_for_timeout(500)
    page.locator('[data-act=pay]').first.click(); page.wait_for_timeout(1500)
    after = jget(a.member + '/api/gala/my-status', mtok)
    assert after['registration']['payment_status'] == 'paid', 'member my-status must show paid, got ' + str(after['registration']['payment_status'])
    page.fill(Q, ''); page.wait_for_timeout(400)
    ok('mark paid → member /api/gala/my-status shows payment_status=paid')

    # ---- 5. cancel + undo (non-refundable, soft) ----
    row = page.locator('[data-row]', has_text='Vjekoslav Šarić')
    row.locator('[data-act=cancel]').click(); page.wait_for_timeout(400)
    row = page.locator('[data-row]', has_text='Vjekoslav Šarić')
    assert 'SURE? CANCEL' in row.inner_text(), 'first click must arm the in-row confirm'
    row.locator('[data-act=cancel]').click(); page.wait_for_timeout(1400)
    assert page.locator('[data-row]', has_text='Vjekoslav Šarić').count() == 0, 'cancelled row must leave the active list'
    assert db("SELECT status FROM gala_registrations WHERE last_name='Šarić'")['status'] == 'cancelled', 'soft cancel = status change'
    page.click('.mx-toast .undo'); page.wait_for_timeout(1600)
    assert page.locator('[data-row]', has_text='Vjekoslav Šarić').count() == 1, 'UNDO must bring the guest back'
    ok('cancel (confirm) + toast UNDO → status door, no refund path touched')

    # ---- 6. waitlist: sold-out → freed seat offers → 24 h passes on → accept link converts ----
    # Shrink the room so free_seats = 0 (the DB is a scratch copy; capacities restored below).
    seats = db("SELECT COALESCE(SUM(1 + COALESCE(guest_count,0)),0) AS s FROM gala_registrations WHERE LOWER(COALESCE(status,'')) NOT IN ('cancelled','rejected','declined','expired')")['s']
    # capacity == reserved seats EXACTLY: sold out now, and ONE cancel opens exactly one seat
    tables = db('SELECT id FROM gala_tables ORDER BY label', all=True)
    base, rem = seats // len(tables), seats % len(tables)
    for i, t in enumerate(tables): db('UPDATE gala_tables SET capacity = ? WHERE id = ?', (base + (1 if i < rem else 0), t['id']))
    page.goto(a.base + '/gala', wait_until='networkidle'); page.wait_for_timeout(1200)
    assert 'SOLD OUT — LIVE' in page.locator('[data-block=waitlist]').inner_text(), 'sold-out room must arm the waitlist'
    page.fill('[data-role=wlName]', 'Iva Pranjić'); page.fill('[data-role=wlEmail]', 'iva.pranjic@example.hr')
    page.click('[data-act=addWl]'); page.wait_for_timeout(1200)
    w1 = db("SELECT * FROM v2_gala_waitlist WHERE email='iva.pranjic@example.hr'")
    assert w1 and w1['status'] == 'waiting', 'no free seat → the new entry WAITS (got %s)' % (w1 and w1['status'])
    # cancel one seat → the sweep runs → the offer goes to the first in line
    row = page.locator('[data-row]', has_text='Vjekoslav Šarić')
    row.locator('[data-act=cancel]').click(); page.wait_for_timeout(300)
    page.locator('[data-row]', has_text='Vjekoslav Šarić').locator('[data-act=cancel]').click(); page.wait_for_timeout(1600)
    w1 = db("SELECT * FROM v2_gala_waitlist WHERE email='iva.pranjic@example.hr'")
    assert w1['status'] == 'offered' and w1['offer_token'], 'freed seat must auto-offer to the first in line (got %s)' % w1['status']
    assert 'OFFER SENT ✓' in page.locator('[data-block=waitlist]').inner_text(), 'UI must show the live offer'
    if a.emails:
        dumps = [p for p in glob.glob(os.path.join(a.emails, '*.html')) if 'seat' in os.path.basename(p).lower() or 'Gala' in open(p, errors='ignore').read()]
        assert any(w1['offer_token'] in open(p, errors='ignore').read() for p in dumps), 'the offer email (with the accept link) must be dumped on staging'
    shot(page, 'v2-gala-waitlist.png'); ok('freed seat → 24 h offer emailed to the first in line')
    # 24 h pass (simulated) + a second person in line → the seat passes on
    page.fill('[data-role=wlName]', 'Marko Vuković'); page.fill('[data-role=wlEmail]', 'marko.vukovic@example.hr')
    page.click('[data-act=addWl]'); page.wait_for_timeout(1000)
    assert db("SELECT status FROM v2_gala_waitlist WHERE email='marko.vukovic@example.hr'")['status'] == 'waiting', 'the live offer holds the seat — #2 must wait'
    db("UPDATE v2_gala_waitlist SET offer_expires_at='2000-01-01T00:00:00.000Z' WHERE id=?", (w1['id'],))
    jpost(a.admin + '/api/v2/gala-ops/waitlist/sweep', {}, token)
    w1 = db('SELECT status FROM v2_gala_waitlist WHERE id=?', (w1['id'],))
    w2 = db("SELECT * FROM v2_gala_waitlist WHERE email='marko.vukovic@example.hr'")
    assert w1['status'] == 'expired' and w2['status'] == 'offered', 'after 24 h the offer must pass to the next in line (%s / %s)' % (w1['status'], w2['status'])
    ok('24 h simulated → offer expired and passed to the next in line')
    # the public accept link converts to a registration
    html = urllib.request.urlopen(a.admin + '/api/v2/gala-ops/waitlist/accept/' + w2['offer_token'], timeout=15).read().decode()
    assert 'The seat is yours' in html, 'accept page must confirm the seat'
    assert db("SELECT status, payment_status FROM gala_registrations WHERE email='marko.vukovic@example.hr'")['status'] == 'approved', 'accepting must create an approved, payment-pending registration'
    page.goto(a.base + '/gala', wait_until='networkidle'); page.wait_for_timeout(1200)
    assert page.locator('[data-row]', has_text='Marko Vuković').count() == 1, 'accepted guest must land in the guest list'
    assert 'ACCEPTED ✓' in page.locator('[data-block=waitlist]').inner_text(), 'waitlist row must read accepted'
    db('UPDATE gala_tables SET capacity = 8')   # restore the 10 × 8 room
    ok('public accept link → registration created, guest list + waitlist agree')

    # ---- 7. performers flip → member portal meta ----
    assert jget(a.member + '/api/v2/gala/meta')['performers_announced'] is False, 'meta must start as TBA'
    page.goto(a.base + '/gala', wait_until='networkidle'); page.wait_for_timeout(1000)
    page.click('[data-act=perfFlip]'); page.wait_for_timeout(400)
    page.fill('[data-role=perfList]', "Tatiana 'Tajci' Cameron — vocals\nAnte Gelo — guitar")
    page.locator('.mx-modal-foot span', has_text='ANNOUNCE PERFORMERS').click(); page.wait_for_timeout(1400)
    meta = jget(a.member + '/api/v2/gala/meta')
    assert meta['performers_announced'] is True and len(meta['performers']) == 2, 'member portal must see the announced performers'
    assert 'Tajci' in page.locator('[data-block=night]').inner_text(), 'THE NIGHT must print the names'
    shot(page, 'v2-gala-announced.png')
    page.click('[data-act=perfFlip]'); page.wait_for_timeout(400)
    page.locator('.mx-modal-foot span', has_text='BACK TO TBA').click(); page.wait_for_timeout(1200)
    assert jget(a.member + '/api/v2/gala/meta')['performers_announced'] is False, 'flip back must reach the member portal too'
    ok('performers TBA flip → member /api/v2/gala/meta follows both ways')

    # ---- final looks ----
    page.goto(a.base + '/gala', wait_until='networkidle'); page.wait_for_timeout(1200)
    shot(page, 'v2-gala-final.png')
    page.set_viewport_size({'width': 900, 'height': 900}); page.wait_for_timeout(500)
    shot(page, 'v2-gala-900.png')
    page.close(); browser.close()

open(os.path.join(QA, 'console.txt'), 'w').write('\n'.join(errors) + '\n')
print('\nconsole issues:', len(errors)); [print(' ', e) for e in errors[:40]]
sys.exit(1 if errors else 0)
