#!/usr/bin/env python3
"""
wallet-checkin-ui.py — Playwright drive of the admin scanner UI states.

Boots the admin backend on a throwaway SQLite DB (NODE_ENV=test) with a mock Google Wallet key,
seeds a conference + ticket + registration via the API, then drives the EXISTING Event Check-in
scanner modal through its unified-check-in states and screenshots each one:
  valid (ADMIT) · already-checked-in · wrong-event · invalid · manual lookup + manual check-in.

Run: python3 tests/wallet-checkin-ui.py
Screens -> /tmp/wallet-checkin-screens/*.png
"""
import json, os, sys, time, subprocess, tempfile, shutil, urllib.request, urllib.error, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
ADMIN_DIR = ROOT / "admin-portal" / "backend"
PORT = 3210
BASE = f"http://127.0.0.1:{PORT}"
OUT = pathlib.Path("/tmp/wallet-checkin-screens"); OUT.mkdir(parents=True, exist_ok=True)
ISSUER = "3388000000023175280"

def api(path, method="GET", body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token: req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")

def main():
    scratch = tempfile.mkdtemp(prefix="medx-ui-")
    env = dict(os.environ,
        DATABASE_PATH=os.path.join(scratch, "scratch.db"),
        TURSO_DATABASE_URL="", TURSO_AUTH_TOKEN="", RESEND_API_KEY="", SMTP_USER="",
        JWT_SECRET="wallet-ui-test-secret", NODE_ENV="test", PORT=str(PORT),
        GOOGLE_WALLET_ISSUER_ID=ISSUER,
        GOOGLE_WALLET_OAUTH_URL="http://127.0.0.1:9/token",
        GOOGLE_WALLET_OBJECTS_BASE="http://127.0.0.1:9/v1")
    srv = subprocess.Popen(["node", "server.js"], cwd=str(ADMIN_DIR), env=env,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    failures = []
    try:
        for _ in range(80):
            try:
                s, _d = api("/health")
                if s == 200: break
            except Exception: pass
            time.sleep(0.5)
        else:
            print("FAIL: admin server did not boot"); sys.exit(1)

        _, d = api("/api/auth/login", "POST", {"email": "juginovic.alen@gmail.com", "password": "admin123"})
        tok = d.get("token"); assert tok, d
        _, d = api("/api/admin/conferences", "POST", {"name": "UI Test Conf", "year": 2026}, tok)
        conf = d["id"]
        _, d = api(f"/api/admin/conferences/{conf}/tickets", "POST", {"name": "General", "price_regular": 0}, tok)
        ticket = d["id"]
        _, reg = api("/api/registrations", "POST", {"conference_id": conf, "ticket_type_id": ticket}, tok)
        reg_id, invoice = reg["registration_id"], reg["invoice_number"]
        print("seeded reg", reg_id, invoice)

        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, args=[
                "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"])
            ctx = browser.new_context(viewport={"width": 430, "height": 900})
            try: ctx.grant_permissions(["camera"], origin=BASE)
            except Exception: pass
            page = ctx.new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(BASE + "/", wait_until="domcontentloaded")
            page.wait_for_load_state("networkidle")
            # Inject the admin token so the SPA is authenticated, then open the existing scanner modal.
            page.evaluate("(t) => { try { App.token = t; } catch(e){}; localStorage.setItem('medx_token', t); }", tok)
            page.wait_for_timeout(300)

            def open_scanner():
                page.evaluate("() => EventCheckin.open()")
                page.wait_for_selector("#eventCheckinManual", timeout=8000)
            def verify(code):
                page.fill("#eventCheckinManual", code)
                page.click("#eventCheckinOverlay button:has-text('Verify')")
                page.wait_for_selector("#eventCheckinResultArea >> div", timeout=8000)
                page.wait_for_timeout(400)
            def set_event(ev):
                page.evaluate("(ev) => { EventCheckin.event = ev; EventCheckin.renderModal(); }", ev)
                page.wait_for_selector("#eventCheckinManual", timeout=8000)

            # The scanner should open preselected on the active-by-date gate (conference).
            open_scanner()
            page.screenshot(path=str(OUT / "01_scanner_open.png"))
            sel_event = page.evaluate("() => EventCheckin.event")
            if sel_event != "conference": failures.append(f"default gate expected conference, got {sel_event}")

            # 1) VALID conference check-in
            verify(reg_id)
            txt = page.inner_text("#eventCheckinResultArea")
            page.screenshot(path=str(OUT / "02_valid_admit.png"))
            if "ADMIT" not in txt.upper(): failures.append("valid state missing ADMIT: " + txt[:120])

            # 2) ALREADY checked in (repeat)
            verify(reg_id)
            txt = page.inner_text("#eventCheckinResultArea")
            page.screenshot(path=str(OUT / "03_already.png"))
            if "ALREADY CHECKED IN" not in txt.upper(): failures.append("already state missing: " + txt[:120])

            # 3) WRONG EVENT (scan the conference-only pass at the gala gate)
            set_event("gala")
            verify(reg_id)
            txt = page.inner_text("#eventCheckinResultArea")
            page.screenshot(path=str(OUT / "04_wrong_event.png"))
            if "NOT VALID FOR THIS EVENT" not in txt.upper(): failures.append("wrong_event state missing: " + txt[:120])

            # 4) INVALID ticket
            set_event("conference")
            verify("totally-bogus-code")
            txt = page.inner_text("#eventCheckinResultArea")
            page.screenshot(path=str(OUT / "05_invalid.png"))
            if "INVALID" not in txt.upper() and "NOT VALID" not in txt.upper(): failures.append("invalid state missing: " + txt[:120])

            # 5) MANUAL LOOKUP + manual check-in (fresh reg so it isn't already checked)
            _, reg2 = api("/api/registrations", "POST", {"conference_id": conf, "ticket_type_id": ticket}, tok)
            page.evaluate("() => { document.querySelector('#eventCheckinOverlay details').open = true; }")
            page.fill("#eventCheckinLookup", reg2["invoice_number"])
            page.click("#eventCheckinOverlay button:has-text('Search')")
            page.wait_for_selector("#eventCheckinLookupResults button", timeout=8000)
            page.screenshot(path=str(OUT / "06_manual_lookup.png"))
            page.click("#eventCheckinLookupResults button")
            page.wait_for_selector("#eventCheckinResultArea >> div", timeout=8000)
            page.wait_for_timeout(400)
            txt = page.inner_text("#eventCheckinResultArea")
            page.screenshot(path=str(OUT / "07_manual_checkin.png"))
            if "ADMIT" not in txt.upper() and "VALID" not in txt.upper(): failures.append("manual check-in state missing: " + txt[:120])

            if errors: failures.append("page JS errors: " + " | ".join(errors[:3]))
            browser.close()
    finally:
        srv.terminate()
        try: srv.wait(timeout=5)
        except Exception: srv.kill()
        shutil.rmtree(scratch, ignore_errors=True)

    print("\nScreens written to", OUT)
    for f in sorted(OUT.glob("*.png")): print("  ", f.name)
    if failures:
        print("\nFAILURES:")
        for f in failures: print("  -", f)
        sys.exit(1)
    print("\nUI states OK (7 screenshots, no page JS errors)")

if __name__ == "__main__":
    main()
