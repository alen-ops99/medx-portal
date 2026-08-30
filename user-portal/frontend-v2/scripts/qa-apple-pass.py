#!/usr/bin/env python3
"""scripts/qa-apple-pass.py — QA for the Apple Wallet .pkpass generation
(backend/v2/apple-pass.js + the two Apple gates in backend/v2/wallet.js).

Boot the member backend with the APPLE_WALLET_* env exported (see backend/v2/apple-pass.js
header) against a SCRATCH copy of deploy/staging/seed.db, then:

   python3 scripts/qa-apple-pass.py --base http://localhost:3969 \
       --db /path/to/scratch-seed.db \
       [--email member019@staging.medx.hr] [--password 'Plexus2026!']

What it asserts, per pass (member card + one per-ticket pass of each kind found):
  ZIP        — python zipfile opens it, `unzip -l`/`unzip -t` agree (CRCs), STORE-only,
               expected file set (pass.json, manifest.json, signature, icon ×3, logo ×2,
               + strip ×3 on event tickets)
  manifest   — SHA-1 of every non-manifest/signature file matches manifest.json exactly
  signature  — DER parses (`openssl pkcs7 -inform DER -print_certs`) and lists BOTH the
               Pass Type ID cert (pass.hr.medx.plexus) and the WWDR G4 intermediate;
               `openssl smime -verify -noverify` over manifest.json succeeds (digest check)
  pass.json  — formatVersion/passTypeIdentifier/teamIdentifier/serialNumber/colors correct,
               barcode + barcodes[] QR with iso-8859-1
  barcode    — message equals the Google-path value for the SAME item, straight from the DB:
               registrations rows → the raw checkin_token, gala rows → the frozen
               MEDX_MEMBER JSON payload (regId/evt), member card → the member QR value
  routes     — portal XHR (Accept: application/json) gets {configured:true, save_url};
               save_url + /api/v2/apple/link/ticket/:id URLs download with NO auth;
               a tampered token is refused with 401

Saves the member-card sample to _qa/apple/sample.pkpass and the full log to
_qa/apple/assertions.txt. Exits 1 on any FAIL.
"""
import argparse, hashlib, io, json, os, re, sqlite3, subprocess, sys, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
QA = os.path.join(HERE, '..', '_qa', 'apple')
os.makedirs(QA, exist_ok=True)

ap = argparse.ArgumentParser()
ap.add_argument('--base', default='http://localhost:3969')
ap.add_argument('--db', required=True, help='the scratch copy of seed.db the server is running on')
ap.add_argument('--email', default='member019@staging.medx.hr')
ap.add_argument('--password', default='Plexus2026!')
ap.add_argument('--team', default='4XC4NRV538')
ap.add_argument('--passtype', default='pass.hr.medx.plexus')
args = ap.parse_args()

try:
    import requests
except ImportError:
    sys.exit('pip install requests')

LOG, FAILS = [], []
def say(line):
    print(line)
    LOG.append(line)
def check(name, ok, detail=''):
    say(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f" — {detail}" if detail else ''))
    if not ok:
        FAILS.append(name)
    return ok

BASE = args.base.rstrip('/')
db = sqlite3.connect(args.db)
db.row_factory = sqlite3.Row

# ---------------------------------------------------------------- login
r = requests.post(f'{BASE}/api/auth/login', json={'email': args.email, 'password': args.password}, timeout=30)
r.raise_for_status()
TOKEN = r.json().get('token')
if not TOKEN:
    sys.exit('login returned no token: ' + r.text[:200])
AUTH = {'Authorization': f'Bearer {TOKEN}'}
say(f'== logged in as {args.email}')

# ---------------------------------------------------------------- helpers
def openssl(argv, stdin=None):
    p = subprocess.run(['openssl'] + argv, input=stdin, capture_output=True)
    return p.returncode, p.stdout.decode('utf8', 'replace'), p.stderr.decode('utf8', 'replace')

def png_size(data):
    return (int.from_bytes(data[16:20], 'big'), int.from_bytes(data[20:24], 'big')) if data[:8] == b'\x89PNG\r\n\x1a\n' else None

def audit_pkpass(label, blob, expect_strip, expect_barcode, expect_serial_sub):
    say(f'-- {label} ({len(blob)} bytes)')
    tmp = os.path.join(QA, f'_audit-{re.sub(r"[^a-z0-9]+", "-", label.lower())}.pkpass')
    with open(tmp, 'wb') as f:
        f.write(blob)
    z = zipfile.ZipFile(io.BytesIO(blob))
    names = sorted(z.namelist())
    base_set = {'pass.json', 'manifest.json', 'signature', 'icon.png', 'icon@2x.png', 'icon@3x.png', 'logo.png', 'logo@2x.png'}
    want = base_set | ({'strip.png', 'strip@2x.png', 'strip@3x.png'} if expect_strip else set())
    check('zip file set', set(names) == want, f'{len(names)} files: {names}')
    check('zip STORE-only', all(i.compress_type == zipfile.ZIP_STORED for i in z.infolist()))
    ul = subprocess.run(['unzip', '-l', tmp], capture_output=True)
    check('unzip -l opens it', ul.returncode == 0 and f'{len(names)} files' in ul.stdout.decode(),
          ul.stdout.decode().strip().splitlines()[-1] if ul.stdout else '')
    t = subprocess.run(['unzip', '-t', tmp], capture_output=True)
    check('unzip -t CRC test', t.returncode == 0 and b'No errors detected' in t.stdout)

    manifest = json.loads(z.read('manifest.json'))
    hashed = {n: hashlib.sha1(z.read(n)).hexdigest() for n in names if n not in ('manifest.json', 'signature')}
    check('manifest covers every file', set(manifest) == set(hashed), f'manifest keys {sorted(manifest)}')
    check('manifest SHA1s all match', all(manifest.get(n) == h for n, h in hashed.items()))

    sig = z.read('signature')
    check('signature is DER (SEQUENCE)', sig[:1] == b'\x30')
    rc, certs, err = openssl(['pkcs7', '-inform', 'DER', '-print_certs'], stdin=sig)
    check('openssl pkcs7 parses DER', rc == 0, err.strip()[:120] if rc else '')
    check('signature lists Pass Type ID cert', 'Pass Type ID: pass.hr.medx.plexus' in certs)
    check('signature lists WWDR G4 intermediate', 'Apple Worldwide Developer Relations Certification Authority' in certs and 'OU=G4' in certs.replace(', ', ','))
    sig_f = os.path.join(QA, '_sig.der'); man_f = os.path.join(QA, '_manifest.json')
    open(sig_f, 'wb').write(sig); open(man_f, 'wb').write(z.read('manifest.json'))
    rc, out, err = openssl(['smime', '-verify', '-inform', 'DER', '-in', sig_f, '-content', man_f, '-noverify'])
    check('openssl smime -verify (digest, -noverify chain)', rc == 0, err.strip().splitlines()[-1][:120] if err.strip() else '')
    os.unlink(sig_f); os.unlink(man_f)

    pj = json.loads(z.read('pass.json'))
    check('formatVersion 1', pj.get('formatVersion') == 1)
    check('passTypeIdentifier', pj.get('passTypeIdentifier') == args.passtype, pj.get('passTypeIdentifier'))
    check('teamIdentifier', pj.get('teamIdentifier') == args.team, pj.get('teamIdentifier'))
    check('serialNumber carries the id', expect_serial_sub in str(pj.get('serialNumber')), pj.get('serialNumber'))
    check('organizationName Med&X', pj.get('organizationName') == 'Med&X')
    check('colors ink/cream/gold', (pj.get('backgroundColor'), pj.get('foregroundColor'), pj.get('labelColor')) ==
          ('rgb(25,21,18)', 'rgb(247,241,230)', 'rgb(201,169,98)'))
    for key in ('barcode',):
        b = pj.get(key)
        check(f'{key} QR + iso-8859-1', bool(b) and b.get('format') == 'PKBarcodeFormatQR' and b.get('messageEncoding') == 'iso-8859-1')
    bs = pj.get('barcodes')
    check('barcodes[] mirrors barcode', isinstance(bs, list) and len(bs) == 1 and bs[0].get('message') == pj['barcode'].get('message'))
    check('barcode message == Google-path/scanner value', pj['barcode'].get('message') == expect_barcode,
          f"pass={pj['barcode'].get('message')[:60]!r}… want={str(expect_barcode)[:60]!r}…" if pj['barcode'].get('message') != expect_barcode else '')
    style = 'eventTicket' if 'eventTicket' in pj else ('generic' if 'generic' in pj else None)
    check('style block present', style is not None, style)
    if style:
        f = pj[style]
        check('primary/secondary/auxiliary/back fields', all(k in f for k in ('primaryFields', 'secondaryFields', 'auxiliaryFields', 'backFields')))
        support = [x for x in f.get('backFields', []) if 'laura.rodman@medx.hr' in str(x.get('value', ''))]
        check('support back field', bool(support))
    for name, wh in (('icon.png', 29), ('icon@2x.png', 58), ('icon@3x.png', 87)):
        check(f'{name} {wh}x{wh}', png_size(z.read(name)) == (wh, wh), str(png_size(z.read(name))))
    lg1, lg2 = png_size(z.read('logo.png')), png_size(z.read('logo@2x.png'))
    check('logo @1x/@2x exact pair, <=160x50pt', lg1 is not None and lg2 == (lg1[0] * 2, lg1[1] * 2) and lg1[0] <= 160 and lg1[1] <= 50, f'{lg1} / {lg2}')
    if expect_strip:
        for name, wh in (('strip.png', (375, 98)), ('strip@2x.png', (750, 196)), ('strip@3x.png', (1125, 294))):
            check(f'{name} {wh[0]}x{wh[1]}', png_size(z.read(name)) == wh)
    os.unlink(tmp)
    return pj

# ---------------------------------------------------------------- member card pass
say('== member-card pass (GET /api/v2/wallet/card/pass?provider=apple)')
u = db.execute('SELECT id FROM users WHERE lower(email)=?', (args.email.lower(),)).fetchone()
uid = u['id']
reg = db.execute("""SELECT r.id, r.checkin_token FROM registrations r JOIN conferences c ON r.conference_id=c.id
                    WHERE r.user_id=? AND COALESCE(r.revoked,0)=0 AND COALESCE(r.status,'')<>'cancelled'
                    ORDER BY c.is_active DESC, c.year DESC, r.created_at DESC LIMIT 1""", (uid,)).fetchone()
r = requests.get(f'{BASE}/api/v2/wallet/card/pass?provider=apple', headers={**AUTH, 'Accept': 'application/vnd.apple.pkpass'}, timeout=60)
check('binary response 200', r.status_code == 200, str(r.status_code))
check('Content-Type application/vnd.apple.pkpass', r.headers.get('Content-Type', '').startswith('application/vnd.apple.pkpass'))
check('Content-Disposition medx-plexus.pkpass', 'medx-plexus.pkpass' in r.headers.get('Content-Disposition', ''))
member_blob = r.content
# the member QR value the pass must carry: the reg checkin_token when one exists (member019 has one)
expect_member_qr = reg['checkin_token'] if reg else None
if reg and not expect_member_qr:  # minted on first pass build — re-read after the request
    expect_member_qr = db.execute('SELECT checkin_token FROM registrations WHERE id=?', (reg['id'],)).fetchone()['checkin_token']
pj = audit_pkpass('member card', member_blob, expect_strip=False, expect_barcode=expect_member_qr, expect_serial_sub=str(uid))
check('member pass is generic style', 'generic' in pj)
with open(os.path.join(QA, 'sample.pkpass'), 'wb') as f:
    f.write(member_blob)
say(f'   sample saved → _qa/apple/sample.pkpass')

# portal-XHR flavor: Accept: application/json → save_url, and the save_url needs NO auth
rj = requests.get(f'{BASE}/api/v2/wallet/card/pass?provider=apple', headers={**AUTH, 'Accept': 'application/json'}, timeout=30).json()
check('XHR flavor {configured:true, save_url}', rj.get('configured') is True and '/api/v2/apple/pass/' in str(rj.get('save_url')))
rt = requests.get(rj['save_url'], timeout=60)  # NO Authorization header
check('tokenized member save_url downloads with no login', rt.status_code == 200 and rt.headers.get('Content-Type', '').startswith('application/vnd.apple.pkpass'))
check('tokenized member pass == same barcode', json.loads(zipfile.ZipFile(io.BytesIO(rt.content)).read('pass.json'))['barcode']['message'] == expect_member_qr)

# ---------------------------------------------------------------- per-ticket passes
say('== per-ticket passes (GET /api/v2/wallet/tickets/:id/pass?provider=apple)')
items = requests.get(f'{BASE}/api/v2/wallet/tickets', headers=AUTH, timeout=30).json()['items']
say(f'   {len(items)} wallet item(s): ' + ', '.join(f"{i['kind']}:{str(i['id'])[:8]}" for i in items))
seen_kinds = set()
for it in items:
    if it['kind'] in seen_kinds or it.get('status') in ('cancelled', 'revoked') or it.get('waitlisted'):
        continue
    seen_kinds.add(it['kind'])
    # what the Google path would put in the barcode for this item
    if it['table'] == 'registrations':
        expect = db.execute('SELECT checkin_token FROM registrations WHERE id=?', (it['id'],)).fetchone()['checkin_token']
    elif it['kind'] == 'gala':
        ca = db.execute('SELECT * FROM croatians_abroad_registrations WHERE id=? OR gala_registration_id=?', (it['id'], it['id'])).fetchone()
        if ca:
            expect = None  # CA-linked payload is asserted structurally below
        else:
            expect = json.dumps({'type': 'MEDX_MEMBER', 'regId': it['id'], 'evt': 'gala'}, separators=(',', ':'))
    else:
        evt = {'plexus': 'plexus', 'bridges': 'bridges', 'donor': 'bridges', 'forum': 'forum', 'signup-form': 'signup-form'}.get(it['kind'], it['kind'])
        expect = json.dumps({'type': 'MEDX_MEMBER', 'regId': it['id'], 'evt': evt}, separators=(',', ':'))
    r = requests.get(f"{BASE}/api/v2/wallet/tickets/{it['id']}/pass?provider=apple",
                     headers={**AUTH, 'Accept': 'application/vnd.apple.pkpass'}, timeout=60)
    if not check(f"{it['kind']} pass 200 pkpass", r.status_code == 200 and r.headers.get('Content-Type', '').startswith('application/vnd.apple.pkpass'), str(r.status_code)):
        continue
    if expect is None:  # re-read post-request in case a token was minted; assert structural equality
        pj0 = json.loads(zipfile.ZipFile(io.BytesIO(r.content)).read('pass.json'))
        msg = json.loads(pj0['barcode']['message'])
        expect = pj0['barcode']['message']
        check('CA-linked gala payload keys', msg.get('type') == 'MEDX_MEMBER' and msg.get('evt') in ('gala', 'croatians-abroad') and msg.get('regId'))
    pj = audit_pkpass(f"{it['kind']} ticket", r.content, expect_strip=True, expect_barcode=expect, expect_serial_sub=str(it['id']))
    check(f"{it['kind']} pass is eventTicket style", 'eventTicket' in pj)
    ev = pj.get('eventTicket', {})
    check(f"{it['kind']} WHEN/WHERE secondary fields", [f['label'] for f in ev.get('secondaryFields', [])] == ['WHEN', 'WHERE'])
    check(f"{it['kind']} GUEST + N° auxiliary fields", [f['label'] for f in ev.get('auxiliaryFields', [])][:2] == ['GUEST', 'N°'])
    # e-mail link route for the same ticket
    lj = requests.get(f"{BASE}/api/v2/apple/link/ticket/{it['id']}", headers=AUTH, timeout=30).json()
    check(f"{it['kind']} /api/v2/apple/link mints a URL", lj.get('configured') is True and '/api/v2/apple/pass/' in str(lj.get('url')))
    lt = requests.get(lj['url'], timeout=60)  # NO auth
    ok = lt.status_code == 200 and lt.headers.get('Content-Type', '').startswith('application/vnd.apple.pkpass')
    check(f"{it['kind']} tokenized link downloads with no login", ok, str(lt.status_code))
    if ok:
        tok_msg = json.loads(zipfile.ZipFile(io.BytesIO(lt.content)).read('pass.json'))['barcode']['message']
        check(f"{it['kind']} tokenized pass same barcode", tok_msg == expect)

# ---------------------------------------------------------------- token hygiene
say('== token hygiene')
bad = requests.get(f"{BASE}/api/v2/apple/pass/{'A' * 40}.notreal.pkpass", timeout=30)
check('tampered token → 401', bad.status_code == 401, str(bad.status_code))
noauth = requests.get(f"{BASE}/api/v2/apple/link/ticket/xyz", timeout=30)
check('/link without login → 401', noauth.status_code == 401, str(noauth.status_code))

# ---------------------------------------------------------------- wrap
say('')
say(f"== {'ALL PASS' if not FAILS else str(len(FAILS)) + ' FAILURE(S): ' + ', '.join(FAILS[:8])} ==")
with open(os.path.join(QA, 'assertions.txt'), 'w') as f:
    f.write('\n'.join(LOG) + '\n')
say('log saved → _qa/apple/assertions.txt')
sys.exit(1 if FAILS else 0)
