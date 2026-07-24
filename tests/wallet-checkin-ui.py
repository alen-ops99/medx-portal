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

            # 8) FIX 3 — the camera scanner PAUSES after a decode and needs an explicit "Scan next" tap
            #    to continue (owner: it "keeps scanning continuously" while the phone is lifted to read the
            #    result). Drive the REAL decode path: stub QRCapture.decode to return a valid code once, let
            #    scanFrame accept it, and assert the loop froze + the resume overlay appeared; then resume
            #    via the explicit control and assert it re-armed. Falls back to the pause control directly
            #    if the headless fake-camera video never reaches readyState>=2.
            set_event("conference")
            _, reg3 = api("/api/registrations", "POST", {"conference_id": conf, "ticket_type_id": ticket}, tok)
            drove_real = page.evaluate("""(code) => {
                EventCheckin.paused = false; EventCheckin.lastScan = null; EventCheckin.lastScanTime = 0;
                const btn = document.getElementById('eventCheckinResume'); if (btn) btn.style.display = 'none';
                const v = document.getElementById('eventCheckinVideo');
                if (EventCheckin.stream && v && v.readyState >= 2) {
                    let fired = false;
                    window.__origDecode = QRCapture.decode;
                    QRCapture.decode = async () => { if (fired) return null; fired = true; return code; };
                    EventCheckin.scanFrame();
                    return true;
                }
                // Fake camera not ready in headless — exercise the pause control directly instead.
                EventCheckin.pauseScan(); EventCheckin.verifyCode(code);
                return false;
            }""", reg3["registration_id"])
            page.wait_for_function("() => EventCheckin.paused === true", timeout=6000)
            page.wait_for_timeout(300)
            paused = page.evaluate("() => EventCheckin.paused")
            overlay_shown = page.evaluate("() => { const b=document.getElementById('eventCheckinResume'); return !!b && getComputedStyle(b).display !== 'none'; }")
            scanframe_noop = page.evaluate("() => { EventCheckin.scanFrame(); return EventCheckin.paused === true; }")
            page.screenshot(path=str(OUT / "08_scanner_paused.png"))
            if not paused: failures.append(f"scanner did not pause after a decode (real-drive={drove_real})")
            if not overlay_shown: failures.append("'Scan next' resume overlay not visible after a decode")
            if not scanframe_noop: failures.append("scanFrame kept running while paused (should be a no-op)")
            # Resume via the explicit "Scan next" control and confirm the loop re-arms.
            page.click("#eventCheckinResume")
            page.wait_for_timeout(200)
            resumed = page.evaluate("() => EventCheckin.paused === false")
            overlay_hidden = page.evaluate("() => { const b=document.getElementById('eventCheckinResume'); return !b || getComputedStyle(b).display === 'none'; }")
            if not resumed: failures.append("scanner did not resume after tapping 'Scan next'")
            if not overlay_hidden: failures.append("resume overlay still visible after resume")
            page.evaluate("() => { if (window.__origDecode) { QRCapture.decode = window.__origDecode; window.__origDecode = null; } }")

            # 9) FIX 3 — the GLOBAL Quick Check-in scanner (the floating QR button the owner actually uses)
            #    exposes the same pause + "Scan next" resume plumbing.
            page.evaluate("() => App.openGlobalQRScanner()")
            page.wait_for_selector("#globalQRStatus", timeout=8000)
            # Let the async camera-start settle first: it writes the status line ("Point camera…" or a
            # camera-error) AFTER getUserMedia resolves, and in production the pause is triggered by a
            # decode that only happens once the camera is live — so wait past that write before pausing,
            # otherwise the late status write would clobber the "Scan next" button (a test-only race).
            page.wait_for_function("() => { const s=document.getElementById('globalQRStatus'); return s && !/Starting camera/i.test(s.innerText); }", timeout=8000)
            page.wait_for_timeout(250)
            page.evaluate("() => App._pauseGlobalScan()")
            page.wait_for_timeout(150)
            g_paused = page.evaluate("() => App._globalScanPaused === true")
            g_btn = page.evaluate("() => { const s=document.getElementById('globalQRStatus'); return !!s && /Scan next/i.test(s.innerText); }")
            page.screenshot(path=str(OUT / "09_global_paused.png"))
            if not g_paused: failures.append("global scanner did not set the pause guard")
            if not g_btn: failures.append("global scanner missing the 'Scan next' resume control")
            page.evaluate("() => App._resumeGlobalScan()")
            page.wait_for_timeout(150)
            if not page.evaluate("() => App._globalScanPaused === false"): failures.append("global scanner did not clear the pause guard on resume")
            try: page.evaluate("() => App.closeGlobalQRScanner()")
            except Exception: pass

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
