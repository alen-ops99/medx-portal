"""host-brief-render-smoke.py — render-smoke for the HOST BRIEF card on the v2 Event Day view.

Loads the REAL admin-portal/frontend-v2 module tree in Chromium (files served from disk via
route interception — no server, no network), stubs only the /api responses with fixtures the
real backend produced, renders the view, and asserts the card, its buttons, print isolation,
copy-as-text, and door-switch refetch. Diacritics asserted in the rendered DOM.

Run: python3 tests/host-brief-render-smoke.py   (exit code = number of FAILs; needs playwright,
same setup as tests/wallet-checkin-ui.py). It first runs tests/host-brief.test.js to produce
real response fixtures, so a red backend fails here too.
"""
import json, os, subprocess, sys, tempfile, mimetypes, pathlib
from playwright.sync_api import sync_playwright

REPO = pathlib.Path(__file__).resolve().parents[1]
ROOT = REPO / 'admin-portal' / 'frontend-v2'

# Fixtures come from the REAL backend: run the unit harness with HB_FIXTURES_OUT set.
_fix = pathlib.Path(tempfile.gettempdir()) / 'hb-briefs.json'
_r = subprocess.run(['node', str(REPO / 'tests' / 'host-brief.test.js')],
                    env={**os.environ, 'HB_FIXTURES_OUT': str(_fix)}, capture_output=True, text=True)
if _r.returncode != 0:
    print(_r.stdout[-2000:]); print('backend harness failed — fix that first'); sys.exit(98)
BRIEFS = json.loads(_fix.read_text())

results = []
def check(name, cond, detail=''):
    results.append((name, bool(cond)))
    print(('PASS' if cond else 'FAIL') + ' | ' + name + ('' if cond else ' | ' + str(detail)[:220]))

PAGE = """<!DOCTYPE html><html><head><meta charset="utf-8"><title>hb smoke</title></head>
<body><div id="root"></div>
<script type="module">
  localStorage.setItem('medx_token','test-token');
  localStorage.setItem('medx_user', JSON.stringify({id:'u1',email:'alen@medx.hr',is_admin:1,is_founder:1}));
  localStorage.removeItem('medx_v2_rehearsal');
  const { session } = await import('/js/state.js');
  session.restore();
  const m = await import('/js/views/eventday.js');
  window.__view = m.default;
  window.__briefCalls = [];
  await m.default.render(document.getElementById('root'), { query: {} });
  window.__rendered = true;
</script></body></html>"""

GATES = [
    {"event_key": "conference", "label": "Plexus Week — Conference", "starts_at": "2026-12-04T08:00:00", "ends_at": "2026-12-05T20:00:00", "expected": 3, "admitted": 0},
    {"event_key": "gala", "label": "Plexus Gala Evening", "starts_at": "2026-12-05T19:00:00", "ends_at": "2026-12-05T23:59:00", "expected": 8, "admitted": 2},
    {"event_key": "donor", "label": "Plexus Donor Night", "starts_at": "2026-12-04T19:00:00", "ends_at": "2026-12-04T23:00:00", "expected": 1, "admitted": 0},
    {"event_key": "bridges", "label": "Building Bridges", "starts_at": None, "ends_at": None, "expected": 0, "admitted": 0},
]

brief_requests = []

def run():
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        ctx = browser.new_context(permissions=["clipboard-read", "clipboard-write"], ignore_https_errors=True)
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        def handler(route):
            url = route.request.url
            path = url.split("medx.test", 1)[1].split("?")[0]
            def j(obj, status=200):
                route.fulfill(status=status, content_type="application/json; charset=utf-8", body=json.dumps(obj))
            if path == "/__hb-smoke.html":
                route.fulfill(status=200, content_type="text/html; charset=utf-8", body=PAGE); return
            if path == "/api/v2/eventday/overview":
                j({"today": "2026-12-05", "is_event_day": True, "default_event": "gala", "rehearsal_admitted": 0, "gates": GATES}); return
            if path == "/api/v2/eventday/door-tokens":
                j({"tokens": []}); return
            if path == "/api/v2/eventday/notes":
                j({"event_key": "gala", "notes": ""}); return
            if path == "/api/v2/eventday/door":
                j({"rehearsal": False, "event": "gala", "rows": []}); return
            if path == "/api/v2/host-brief":
                ev = url.split("event=")[1].split("&")[0]
                brief_requests.append(ev)
                j(BRIEFS.get(ev) or {"error": "no fixture"}, 200 if ev in BRIEFS else 400); return
            if path.startswith("/api/"):
                j({"error": "unstubbed " + path}, 404); return
            f = ROOT / path.lstrip("/")
            if f.is_file():
                ctype = mimetypes.guess_type(str(f))[0] or "application/octet-stream"
                if f.suffix in (".js", ".mjs"): ctype = "text/javascript"
                route.fulfill(status=200, content_type=ctype + "; charset=utf-8", body=f.read_bytes())
            else:
                route.fulfill(status=404, content_type="text/plain", body="not found " + path)

        page.route("https://medx.test/**", handler)
        page.goto("https://medx.test/__hb-smoke.html")
        page.wait_for_function("window.__rendered === true", timeout=15000)
        page.wait_for_selector('[data-block="hostBrief"]', timeout=8000)
        # wait for the brief fetch to land (loading → content)
        page.wait_for_function("document.querySelector('[data-block=\\'hostBrief\\']').innerText.includes('TALKING POINTS')", timeout=8000)

        card = page.locator('[data-block="hostBrief"]')
        text = card.inner_text()
        check('card renders with HOST BRIEF header', 'HOST BRIEF' in text, text[:150])
        check('card shows the gala label + date', 'Plexus Gala Evening' in text and '5 December 2026' in text, text[:200])
        check('headline numbers: 8 expected across 5 bookings + paid/pending cells', 'EXPECTED' in text and '5 bookings \u00b7 3 plus-ones' in text and 'PAID' in text and 'PENDING' in text, text[:400])
        check('talking point with diacritics rendered', 'Sveučilište u Zagrebu' in text, text)
        check('notable guest Ana Šarić rendered', 'Ana Šarić' in text, text)
        check('kitchen verbatim line rendered', 'bez glutena — orašasti plodovi' in text, text)
        check('arrivals stat present (2 already in)', '2 of 8 already in' in text, text)
        check('PRINT and COPY AS TEXT buttons present', page.locator('[data-act="hbPrint"]').count() == 1 and page.locator('[data-act="hbCopy"]').count() == 1)
        check('print-only stylesheet injected once', page.evaluate("document.querySelectorAll('#mx-css-hostbrief-print').length") == 1)
        check('no dc-marker removed: scanner + door list still render', page.evaluate("!!document.querySelector('[data-role=\\'camBox\\']') && !!document.querySelector('[data-role=\\'doorQ\\']')"))

        # ---- COPY AS TEXT
        page.click('[data-act="hbCopy"]')
        page.wait_for_timeout(300)
        clip = page.evaluate("navigator.clipboard.readText()")
        check('clipboard holds the plain-text brief', clip.startswith('MED&X — HOST BRIEF') and 'Barišić' in clip and 'TALKING POINTS' in clip, clip[:160])
        check('copy button flips to ✓ COPIED', '✓ COPIED' in page.locator('[data-act="hbCopy"]').inner_text())

        # ---- PRINT (window.print stubbed; capture state mid-print)
        page.evaluate("""() => {
          window.__printState = null;
          window.print = () => {
            const box = document.querySelector('.mx-hb-printbox');
            window.__printState = {
              hasBox: !!box,
              bodyClass: document.body.classList.contains('mx-hb-print'),
              boxText: box ? box.innerText : '',
              boxShown: box ? getComputedStyle(box).display : null
            };
          };
        }""")
        page.click('[data-act="hbPrint"]')
        ps = page.evaluate("window.__printState")
        check('print: printbox + body class present during print()', bool(ps and ps['hasBox'] and ps['bodyClass']), json.dumps(ps)[:200])
        check('print sheet carries the brief content', bool(ps and 'MED&X — HOST BRIEF' in ps['boxText'] and 'Sveučilište u Zagrebu' in ps['boxText']), (ps or {}).get('boxText', '')[:200])
        page.wait_for_timeout(1700)
        check('print: cleanup removed box + class', page.evaluate("!document.querySelector('.mx-hb-printbox') && !document.body.classList.contains('mx-hb-print')"))

        # ---- door switch refetches the brief for that door
        page.click('[data-act="gate"][data-key="conference"]')
        page.wait_for_function("document.querySelector('[data-block=\\'hostBrief\\']').innerText.includes('Plexus Week — Conference')", timeout=8000)
        check('door switch refetched brief (conference)', 'conference' in brief_requests and 'Medicinski fakultet u Splitu' in page.locator('[data-block="hostBrief"]').inner_text())

        # ---- empty door renders gracefully
        page.click('[data-act="gate"][data-key="bridges"]')
        page.wait_for_function("document.querySelector('[data-block=\\'hostBrief\\']').innerText.includes('No registrations yet')", timeout=8000)
        check('empty door → graceful empty brief line', True)

        check('no page errors during the whole smoke', not errors, ' ;; '.join(errors)[:400])
        browser.close()

    fails = sum(1 for _, ok in results if not ok)
    print(('\nALL %d PASSED' % len(results)) if not fails else ('\n%d FAILED' % fails))
    sys.exit(fails)

run()
