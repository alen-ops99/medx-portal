#!/usr/bin/env python3
"""Nightly all-systems sentinel (Alen's standing order, 2026-08-30: "a check at the end of
every day that everything works — and if not, notify us via email").

Checks, in order:
  1. medx.hr homepage answers 200
  2. member prod service (medx-user-portal) API answers
  3. admin prod service (medx-admin-portal) answers
  4. Render logs, last 24 h, both prod services: any EMAIL-FAIL / "Brevo error" /
     EMAIL DROPPED lines — the exact signature of the Aug-30 silent-confirmation outage
  5. Brevo transactional stats for yesterday+today: requests with zero delivered → alarm
On ANY failure: one email via Brevo (GitHub runner IP; Brevo IP-restriction must stay off)
to ALERT_TO. Silent when green. `force_email=1` sends a test alarm regardless.
"""
import json, os, sys, urllib.request, urllib.parse
from datetime import datetime, timedelta, timezone

RENDER_KEY = os.environ['RENDER_API_KEY']
BREVO_KEY = os.environ['BREVO_API_KEY']
ALERT_TO = os.environ.get('ALERT_TO', 'juginovic.alen@gmail.com,laura.rodman@medx.hr')
SERVICES = { 'member (medx-user-portal)': 'srv-d6gbs26a2pns73fevl1g',
             'admin (medx-admin-portal)': 'srv-d6gbs2ea2pns73fevl6g' }
OWNER_ID = 'tea-d6gbraruibrs73bsarmg'
BAD_LOG_MARKERS = ['EMAIL-FAIL', 'Brevo error', 'EMAIL DROPPED']

problems, notes = [], []

def get(url, headers=None, timeout=45):
    req = urllib.request.Request(url, headers=headers or {})
    return urllib.request.urlopen(req, timeout=timeout)

def check_http(name, url, expect_json=False):
    try:
        r = get(url)
        body = r.read(4096)
        if r.status != 200:
            problems.append(f"{name}: HTTP {r.status}")
        elif expect_json:
            json.loads(body)
        notes.append(f"OK  {name}")
    except Exception as e:
        problems.append(f"{name}: {type(e).__name__} {str(e)[:120]}")

def check_render_logs():
    end = datetime.now(timezone.utc); start = end - timedelta(hours=24)
    for label, sid in SERVICES.items():
        try:
            qs = urllib.parse.urlencode({ 'ownerId': OWNER_ID, 'resource': sid,
                'startTime': start.strftime('%Y-%m-%dT%H:%M:%SZ'),
                'endTime': end.strftime('%Y-%m-%dT%H:%M:%SZ'), 'limit': 100 })
            d = json.load(get(f"https://api.render.com/v1/logs?{qs}",
                              {'Authorization': f'Bearer {RENDER_KEY}'}))
            hits = [l['message'][:160] for l in d.get('logs', [])
                    if any(m in l.get('message', '') for m in BAD_LOG_MARKERS)]
            if hits:
                problems.append(f"{label}: {len(hits)} email-failure log line(s) in 24h — e.g. {hits[0]}")
            else:
                notes.append(f"OK  {label} logs clean (24h)")
        except Exception as e:
            problems.append(f"{label} log check failed: {str(e)[:120]}")

def check_brevo_stats():
    try:
        end = datetime.now(timezone.utc).date(); start = end - timedelta(days=1)
        d = json.load(get(f"https://api.brevo.com/v3/smtp/statistics/aggregatedReport?startDate={start}&endDate={end}",
                          {'api-key': BREVO_KEY}))
        req, dlv = d.get('requests', 0), d.get('delivered', 0)
        blocked, hb = d.get('blocked', 0), d.get('hardBounces', 0)
        notes.append(f"OK  Brevo {start}→{end}: requests {req}, delivered {dlv}, blocked {blocked}, hardBounces {hb}")
        if req > 0 and dlv == 0:
            problems.append(f"Brevo: {req} requests but ZERO delivered since {start}")
    except Exception as e:
        problems.append(f"Brevo stats check failed: {str(e)[:120]}")

def send_alarm(subject, body_lines):
    payload = { 'sender': {'name': 'Med&X Sentinel', 'email': 'noreply@medx.hr'},
        'to': [{'email': a.strip()} for a in ALERT_TO.split(',') if a.strip()], 'subject': subject,
        'htmlContent': '<pre style="font:13px/1.6 monospace;color:#111">' + '\n'.join(body_lines) + '</pre>' }
    req = urllib.request.Request('https://api.brevo.com/v3/smtp/email',
        data=json.dumps(payload).encode(),
        headers={'api-key': BREVO_KEY, 'Content-Type': 'application/json'})
    r = urllib.request.urlopen(req, timeout=45)
    print('alarm email sent:', r.status)

def run_all():
    problems.clear(); notes.clear()
    check_http('medx.hr homepage', 'https://medx.hr')
    check_http('member prod API', 'https://medx-user-portal.onrender.com/api/public/status', expect_json=True)
    check_http('admin prod', 'https://medx-admin-portal.onrender.com')
    check_render_logs()
    check_brevo_stats()

run_all()
# Double-check before alarming (Alen 2026-08-31): a transient blip must not page anyone.
# On any failure, wait 2 minutes and run EVERYTHING again — alarm only if still failing.
if problems:
    import time
    first = list(problems)
    print('first pass found problems — double-checking in 120s:', *first, sep='\n  ')
    time.sleep(120)
    run_all()
    if not problems:
        print('second pass clean — transient blip, no alarm sent')
    else:
        notes.append(f'(double-checked: first pass had {len(first)} problem(s); still failing on re-run)')

stamp = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
print('\n'.join(notes))
force = os.environ.get('FORCE_EMAIL') == '1'
if problems or force:
    subject = ('⚠ Med&X sentinel: ' + ('; '.join(problems)[:120] if problems else 'TEST ALARM — all green'))
    lines = [f'Med&X nightly sentinel — {stamp}', '']
    if problems: lines += ['PROBLEMS:'] + ['  ✗ ' + p for p in problems] + ['']
    lines += ['Checks:'] + ['  ' + n for n in notes]
    send_alarm(subject, lines)
if problems:
    print('PROBLEMS:', *problems, sep='\n  ')
    sys.exit(1)
print('all green' + (' (test alarm emailed)' if force else ''))
