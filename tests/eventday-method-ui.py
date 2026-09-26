#!/usr/bin/env python3
"""
eventday-method-ui.py — RELEASE GATE for the admin v2 Event Day door (round 3 Phase 0a, second pass).

The admin backend resolves an e-mail or a short code only when door staff TYPED it (method 'manual').
A lookup or scan with no method counts as a camera scan. This drives the real admin v2 frontend in
Chromium against a local admin backend and reads every request body the door sends:
  ID-check mode (the default door mode)
    1. typed e-mail  → /lookup method manual → the ID card → ADMIT → /scan method manual → admitted
    2. camera, a seat's QR (uuid) → /lookup method qr → the ID card → ADMIT → /scan method qr → admitted
    3. camera, a QR that holds only an e-mail → /lookup method qr → not found, no ADMIT button
  Instant admit
    4. typed e-mail, party of 2 → /scan manual → 1 of 2 → ADMIT ONE MORE → /scan manual → complete
    5. camera, a party-of-2 seat → /scan qr → 1 of 2 → ADMIT ONE MORE → /scan qr → complete
    6. camera, a QR that holds only an e-mail → /scan qr → not_found
The camera is Chromium's fake device. window.jsQR is replaced by a stub that decodes the next queued
string, so each "scan" is exactly the code the test chose.

Boots the admin backend on a throwaway SQLite file (never Turso) and the frontend dev server.
Run: MEDX_TEST_ADMIN_PORT=3818 MEDX_TEST_UI_PORT=3819 python3 tests/eventday-method-ui.py [--shots DIR]
"""
import json, os, sys, time, subprocess, tempfile, shutil, urllib.request, urllib.error, pathlib, argparse
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
ADMIN_DIR = ROOT / "admin-portal" / "backend"
UI_DIR = ROOT / "admin-portal" / "frontend-v2"
ADMIN_PORT = int(os.environ.get("MEDX_TEST_ADMIN_PORT", "3818"))
UI_PORT = int(os.environ.get("MEDX_TEST_UI_PORT", "3819"))
ADMIN = f"http://127.0.0.1:{ADMIN_PORT}"
UI = f"http://localhost:{UI_PORT}"

ap = argparse.ArgumentParser()
ap.add_argument("--shots", default="")
args = ap.parse_args()
if args.shots:
    os.makedirs(args.shots, exist_ok=True)

results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS" if cond else "FAIL") + " | " + name + ((" | " + str(detail)[:200]) if detail not in ("", None) else ""), flush=True)

def api(base, path, method="GET", body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "{}")
        except Exception:
            return e.code, {}

def wait_up(url, secs=90):
    t0 = time.time()
    while time.time() - t0 < secs:
        try:
            with urllib.request.urlopen(url, timeout=3) as r:
                if r.status == 200:
                    return True
        except Exception:
            pass
        time.sleep(0.4)
    return False

def main():
    scratch = tempfile.mkdtemp(prefix="medx-eventday-ui-")
    db_path = os.path.join(scratch, "scratch.db")
    env = dict(os.environ, DATABASE_PATH=db_path, TURSO_DATABASE_URL="", TURSO_AUTH_TOKEN="",
               RESEND_API_KEY="", SMTP_USER="", BREVO_API_KEY="", GOOGLE_SHEETS_WEBHOOK="",
               JWT_SECRET="eventday-method-ui-secret", NODE_ENV="test", PORT=str(ADMIN_PORT),
               MEDX_VERIFIED_EMAIL_GATE="")
    procs = []
    procs.append(subprocess.Popen(["node", "server.js"], cwd=str(ADMIN_DIR), env=env,
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
    try:
        if not wait_up(ADMIN + "/health"):
            check("boot: admin backend", False)
            return
        procs.append(subprocess.Popen(["node", "dev-server.js"], cwd=str(UI_DIR),
                                      env=dict(os.environ, PORT=str(UI_PORT), BACKEND=ADMIN, MEMBER_BACKEND=ADMIN),
                                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
        if not wait_up(UI + "/health"):
            check("boot: admin frontend dev server", False)
            return

        # admin login (the founder's seeded password is replaced by the one-time unlock on a fresh DB)
        s, d = api(ADMIN, "/api/auth/login", "POST", {"email": "juginovic.alen@gmail.com", "password": "admin123"})
        if not (s == 200 and d.get("token")):
            s, d = api(ADMIN, "/api/auth/login", "POST", {"email": "vp@medx.hr", "password": "admin123"})
        tok, user = d.get("token"), d.get("user") or {}
        check("boot: seeded admin login", bool(tok), s)
        if not tok:
            return

        stamp = str(int(time.time() * 1000))
        def seat(label):
            email = f"door.ui.{label}+{stamp}@example.com"
            s2, d2 = api(ADMIN, "/api/v2/gala-ops/registrations", "POST",
                         {"name": "Door " + label.capitalize() + " Probe", "email": email, "kind": "vip"}, tok)
            reg = (d2 or {}).get("registration") or {}
            return reg.get("id"), email
        A_id, A_email = seat("typed")        # 1. typed e-mail, ID-check
        B_id, B_email = seat("camera")       # 2. camera uuid, ID-check
        C_id, C_email = seat("emailqr")      # 3 and 6. a QR holding only this e-mail
        D_id, D_email = seat("party")        # 4. typed e-mail, instant, party of 2
        E_id, E_email = seat("partycam")     # 5. camera uuid, instant, party of 2
        check("setup: five paid (vip) gala seats", all([A_id, B_id, C_id, D_id, E_id]))
        # a party of two for D and E (guest_count 1), written straight into the scratch file
        nm = str(ADMIN_DIR / "node_modules" / "libsql")
        js = ("const D=require(process.argv[1]);const d=new D(process.argv[2]);d.exec('PRAGMA busy_timeout = 5000');"
              "for(const id of JSON.parse(process.argv[3]))d.prepare('UPDATE gala_registrations SET guest_count = 1 WHERE id = ?').run(id);d.close()")
        subprocess.run(["node", "-e", js, nm, db_path, json.dumps([D_id, E_id])], check=True)

        sent = []   # (path, body) of every /lookup and /scan the door sends
        with sync_playwright() as pw:
            browser = pw.chromium.launch(args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"])
            ctx = browser.new_context(viewport={"width": 1440, "height": 900}, permissions=["camera"])
            ctx.add_init_script(
                "try{localStorage.setItem('medx_token'," + json.dumps(tok) + ");"
                "localStorage.setItem('medx_user'," + json.dumps(json.dumps(user)) + ");"
                "localStorage.setItem('medx_v2_rehearsal','');localStorage.setItem('medx_v2_instant','');}catch(e){}"
                "window.__qrQueue=[];window.jsQR=function(){return window.__qrQueue.length?{data:window.__qrQueue.shift()}:null};")
            page = ctx.new_page()
            def on_req(r):
                if "/api/v2/eventday/lookup" in r.url or "/api/v2/eventday/scan" in r.url:
                    try:
                        sent.append((r.url.split("/api/v2/eventday/")[1], json.loads(r.post_data or "{}")))
                    except Exception:
                        sent.append((r.url, {}))
            page.on("request", on_req)

            def step(label, action, path):
                """Run action, wait for the next request to `path`, return (body, response json)."""
                with page.expect_response(lambda r: ("/api/v2/eventday/" + path) in r.url and r.request.method == "POST", timeout=20000) as resp:
                    action()
                rr = resp.value
                body = json.loads(rr.request.post_data or "{}")
                try:
                    out = rr.json()
                except Exception:
                    out = {}
                return body, out

            def shot(name):
                if args.shots:
                    page.wait_for_timeout(900)   # let the card's entrance finish
                    page.screenshot(path=os.path.join(args.shots, name + ".png"))

            page.goto(UI + "/event-day?eventday=1&door=gala", wait_until="domcontentloaded")
            page.wait_for_selector('[data-role="scanCode"]', timeout=30000)

            def type_code(v):
                page.fill('[data-role="scanCode"]', v)
                page.click('[data-act="scanSubmit"]')

            # ---- ID-check mode (default)
            body, out = step("typed lookup", lambda: type_code(A_email), "lookup")
            check("ID-check · typed e-mail → /lookup carries method manual", body.get("method") == "manual", body)
            check("ID-check · typed e-mail → the person is found (the typed fallback works)", out.get("ok") is True and (out.get("person") or {}).get("email") == A_email, out.get("result") or (out.get("person") or {}).get("email"))
            page.wait_for_selector('[data-act="idAdmit"][data-key="gala"]', timeout=10000)
            shot("1-idcheck-typed-email-idcard")
            body, out = step("typed admit", lambda: page.click('[data-act="idAdmit"][data-key="gala"]'), "scan")
            check("ID-check · ADMIT after a typed e-mail → /scan carries method manual", body.get("method") == "manual", body)
            check("ID-check · ADMIT after a typed e-mail → admitted", out.get("ok") is True, out.get("result"))
            page.wait_for_timeout(700)

            page.click('[data-act="cam"]')
            page.wait_for_selector("video.mx-ed-video", timeout=10000)
            body, out = step("camera lookup", lambda: page.evaluate("id => window.__qrQueue.push(id)", B_id), "lookup")
            check("ID-check · camera QR (seat id) → /lookup carries method qr", body.get("method") == "qr", body)
            check("ID-check · camera QR (seat id) → the person is found", out.get("ok") is True and (out.get("person") or {}).get("email") == B_email, out.get("result"))
            page.wait_for_selector('[data-act="idAdmit"][data-key="gala"]', timeout=10000)
            shot("2-idcheck-camera-idcard")
            body, out = step("camera admit", lambda: page.click('[data-act="idAdmit"][data-key="gala"]'), "scan")
            check("ID-check · ADMIT after a camera QR → /scan carries method qr", body.get("method") == "qr", body)
            check("ID-check · ADMIT after a camera QR → admitted", out.get("ok") is True, out.get("result"))
            page.wait_for_timeout(700)

            body, out = step("camera email", lambda: page.evaluate("e => window.__qrQueue.push(e)", C_email), "lookup")
            check("ID-check · camera QR holding only an e-mail → /lookup carries method qr", body.get("method") == "qr", body)
            check("ID-check · camera QR holding only an e-mail → not found", out.get("ok") is False and out.get("result") == "not_found", out.get("result"))
            page.wait_for_timeout(500)
            check("ID-check · no ADMIT button for a scanned e-mail", page.locator('[data-act="idAdmit"]').count() == 0)
            shot("3-idcheck-camera-email-notfound")

            # ---- instant admit
            page.click('[data-act="instant"]')
            page.wait_for_timeout(400)
            body, out = step("instant typed", lambda: type_code(D_email), "scan")
            check("Instant · typed e-mail → /scan carries method manual", body.get("method") == "manual", body)
            check("Instant · typed e-mail, party of 2 → 1 of 2 admitted", out.get("ok") is True and out.get("remaining") == 1, (out.get("result"), out.get("remaining")))
            page.wait_for_selector('[data-act="admitMore"][data-n="1"]', timeout=10000)
            shot("4-instant-typed-partial")
            body, out = step("instant typed more", lambda: page.click('[data-act="admitMore"][data-n="1"]'), "scan")
            check("Instant · ADMIT ONE MORE after a typed e-mail → /scan carries method manual", body.get("method") == "manual", body)
            check("Instant · ADMIT ONE MORE after a typed e-mail → the party is complete", out.get("ok") is True and out.get("remaining") == 0, (out.get("result"), out.get("remaining")))
            page.wait_for_timeout(700)

            body, out = step("instant camera", lambda: page.evaluate("id => window.__qrQueue.push(id)", E_id), "scan")
            check("Instant · camera QR (seat id) → /scan carries method qr", body.get("method") == "qr", body)
            check("Instant · camera QR, party of 2 → 1 of 2 admitted", out.get("ok") is True and out.get("remaining") == 1, (out.get("result"), out.get("remaining")))
            page.wait_for_selector('[data-act="admitMore"][data-n="1"]', timeout=10000)
            body, out = step("instant camera more", lambda: page.click('[data-act="admitMore"][data-n="1"]'), "scan")
            check("Instant · ADMIT ONE MORE after a camera QR → /scan carries method qr", body.get("method") == "qr", body)
            check("Instant · ADMIT ONE MORE after a camera QR → the party is complete", out.get("ok") is True and out.get("remaining") == 0, (out.get("result"), out.get("remaining")))
            page.wait_for_timeout(700)

            body, out = step("instant camera email", lambda: page.evaluate("e => window.__qrQueue.push(e)", C_email), "scan")
            check("Instant · camera QR holding only an e-mail → /scan carries method qr", body.get("method") == "qr", body)
            check("Instant · camera QR holding only an e-mail → not_found", out.get("ok") is False and out.get("result") == "not_found", out.get("result"))
            shot("6-instant-camera-email-notfound")

            lookups = [b for (p, b) in sent if p.startswith("lookup")]
            check("every /lookup the door sent carried a method", len(lookups) >= 3 and all(b.get("method") in ("manual", "qr") for b in lookups), [b.get("method") for b in lookups])
            browser.close()
    except Exception as e:
        check("unexpected error: " + str(e), False)
    finally:
        for p in procs:
            try:
                p.kill()
            except Exception:
                pass
        shutil.rmtree(scratch, ignore_errors=True)

main()
passed = sum(1 for _, ok in results if ok)
print(f"\n{passed}/{len(results)} passed")
sys.exit(0 if results and passed == len(results) else 1)
