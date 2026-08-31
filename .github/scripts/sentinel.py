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

# Doctrine (Alen 2026-08-31): 1) double-check it is REALLY a problem, 2) try to FIX it
# automatically, 3) email only what is unfixable / needs a human, or where real DAMAGE
# happened (people who did not receive something) even if the pipeline now works.

def try_remediate():
    """Auto-fix what a runner can fix: a prod service that fails its HTTP probe on both
    passes gets a Render restart, then a third probe. Returns notes of what was healed."""
    healed = []
    down = [p for p in problems if p.startswith('member prod API') or p.startswith('admin prod')]
    for p in down:
        sid = 'srv-d6gbs26a2pns73fevl1g' if p.startswith('member') else 'srv-d6gbs2ea2pns73fevl6g'
        url = 'https://medx-user-portal.onrender.com/api/public/status' if p.startswith('member') else 'https://medx-admin-portal.onrender.com'
        try:
            req = urllib.request.Request(f'https://api.render.com/v1/services/{sid}/restarts',
                data=b'{}', headers={'Authorization': f'Bearer {RENDER_KEY}', 'Content-Type': 'application/json'})
            urllib.request.urlopen(req, timeout=45)
            import time; time.sleep(120)
            r = get(url)
            if r.status == 200:
                problems.remove(p)
                healed.append(f'AUTO-FIXED: {p.split(":")[0]} was down — restarted it, now answering 200')
        except Exception as e:
            notes.append(f'restart attempt for {p.split(":")[0]} failed: {str(e)[:80]}')
    return healed

def assess_damage():
    """Even when everything works NOW, people who never got an email are damage worth
    reporting: pull the failed-recipient addresses out of 24h of EMAIL-FAIL log lines."""
    import re
    victims = set()
    end = datetime.now(timezone.utc); start = end - timedelta(hours=24)
    for label, sid in SERVICES.items():
        try:
            qs = urllib.parse.urlencode({ 'ownerId': OWNER_ID, 'resource': sid,
                'startTime': start.strftime('%Y-%m-%dT%H:%M:%SZ'),
                'endTime': end.strftime('%Y-%m-%dT%H:%M:%SZ'), 'limit': 100 })
            d = json.load(get(f'https://api.render.com/v1/logs?{qs}', {'Authorization': f'Bearer {RENDER_KEY}'}))
            for l in d.get('logs', []):
                m = l.get('message', '')
                if 'EMAIL-FAIL' in m or 'EMAIL DROPPED' in m:
                    victims |= set(re.findall(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', m))
        except Exception:
            pass
    victims.discard(ALERT_TO)
    return sorted(v for v in victims if not v.endswith('medx.hr') or True)

run_all()
healed_notes = []
damage = []
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
        healed_notes = try_remediate()
        for h in healed_notes: notes.append(h)
damage = assess_damage()
if damage:
    notes.append(f'DAMAGE: {len(damage)} recipient(s) had a failed email in the last 24h — they may need a manual resend: ' + ', '.join(damage[:15]))

stamp = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
print('\n'.join(notes))
force = os.environ.get('FORCE_EMAIL') == '1'
# Email ONLY when something needs a human: unfixable problems, or damage (people who
# missed an email) — auto-fixed-with-no-damage stays silent in the run log.
if problems or damage or force:
    head = ('; '.join(problems)[:100] if problems
            else f'{len(damage)} missed email(s) in 24h' if damage
            else 'TEST ALARM — all green')
    subject = '⚠ Med&X sentinel: ' + head
    lines = [f'Med&X nightly sentinel — {stamp}', '']
    if problems: lines += ['NEEDS A HUMAN (could not auto-fix):'] + ['  ✗ ' + p for p in problems] + ['']
    if damage: lines += [f'DAMAGE — {len(damage)} recipient(s) never got an email in the last 24h (manual resend?):'] + ['  · ' + v for v in damage[:25]] + ['']
    if healed_notes: lines += ['Auto-fixed tonight:'] + ['  ✓ ' + h for h in healed_notes] + ['']
    lines += ['All checks:'] + ['  ' + n for n in notes]
    send_alarm(subject, lines)
if problems:
    print('PROBLEMS:', *problems, sep='\n  ')
    sys.exit(1)
print('all green' + (' (test alarm emailed)' if force else '') + (f' — but {len(damage)} damage recipient(s) reported' if damage else ''))
