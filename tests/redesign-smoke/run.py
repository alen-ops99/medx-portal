#!/usr/bin/env python3
"""
Med&X USER PORTAL — redesign regression smoke suite.

The gate every redesign build must pass before it is shown. Tests BEHAVIOR through
stable contracts (routes, API responses, localStorage keys, URL params, data-* contract
attributes from design/IMPLEMENTATION_CONTRACT.md) — never visual CSS selectors.

Usage:
    python3 run.py                       # human-readable, exit code = number of FAILs
    python3 run.py --json                # machine-readable JSON on stdout (table on stderr)
    BASE_URL=http://localhost:4000 python3 run.py    # point at a redesign build

Env:
    BASE_URL        target portal (default http://localhost:3018)
    SMOKE_EMAIL     login email    (default juginovic.alen@gmail.com — scratch DB)
    SMOKE_PASSWORD  login password (default admin123 — scratch DB)
    MEDX_TOKEN      pre-minted JWT: used as fallback if the form login fails
                    (e.g. auth rate limit 15/15min), and by SKIP_LOGIN=1
    SKIP_LOGIN=1    skip the form-login journey entirely (uses MEDX_TOKEN)
    HEADED=1        run the browser headed (debugging)

Requires: python3 + playwright (already used by tests/wallet-checkin-ui.py). No new deps.
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

BASE = os.environ.get("BASE_URL", "http://localhost:3018").rstrip("/")
SMOKE_EMAIL = os.environ.get("SMOKE_EMAIL", "juginovic.alen@gmail.com")
SMOKE_PASSWORD = os.environ.get("SMOKE_PASSWORD", "admin123")
ENV_TOKEN = os.environ.get("MEDX_TOKEN", "").strip() or None
SKIP_LOGIN = os.environ.get("SKIP_LOGIN") == "1"
HEADED = os.environ.get("HEADED") == "1"

RUN_TAG = f"ZZSMOKE-{int(time.time())}"
SMOKE_NOTE = f"{RUN_TAG} — automated smoke-suite row, safe to delete"

# Journeys that genuinely fail in the app (not the script) get parked here so the
# suite stays green while the defect is tracked in README.md. id -> reason.
KNOWN_FAILS = {}


class Fail(Exception):
    pass


# ---------------------------------------------------------------- API helper

class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_OPENER = urllib.request.build_opener()
_OPENER_NOREDIR = urllib.request.build_opener(_NoRedirect)


def api(method, path, token=None, body=None, follow_redirects=True, timeout=30):
    """Return (status, headers-dict, raw-bytes, parsed-json-or-None)."""
    url = path if path.startswith("http") else BASE + path
    data = None
    headers = {"Accept": "application/json, text/html;q=0.5"}
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    opener = _OPENER if follow_redirects else _OPENER_NOREDIR
    try:
        with opener.open(req, timeout=timeout) as r:
            raw = r.read()
            status, hdrs = r.status, dict(r.headers)
    except urllib.error.HTTPError as e:  # non-2xx (and suppressed redirects) land here
        raw = e.read()
        status, hdrs = e.code, dict(e.headers)
    except urllib.error.URLError as e:
        raise Fail(f"{method} {path}: connection failed ({e.reason})")
    parsed = None
    try:
        parsed = json.loads(raw.decode("utf-8", "replace"))
    except Exception:
        pass
    return status, hdrs, raw, parsed


def expect(cond, msg):
    if not cond:
        raise Fail(msg)


# ---------------------------------------------------------------- UI helpers

def seeded_context(browser, token, user_json):
    """Fresh browser context with the member session pre-seeded via the CONTRACT
    localStorage keys (medx_user_token / medx_user_data — IMPLEMENTATION_CONTRACT §2.1)."""
    ctx = browser.new_context()
    ctx.add_init_script(
        f"localStorage.setItem('medx_user_token', {json.dumps(token)});"
        f"localStorage.setItem('medx_user_data', {json.dumps(user_json)});"
    )
    ctx.set_default_timeout(15000)
    return ctx


def first_visible(page, css):
    loc = page.locator(f"{css}:visible")
    return loc.first if loc.count() else None


def fill_contract_field(page, value, css_id, label_re):
    """Fill an input located by (1) its served id — part of the backend-rendered page
    contract — or (2) accessible label/placeholder text. Never by styling classes."""
    el = first_visible(page, css_id)
    if el is None:
        try:
            cand = page.get_by_label(re.compile(label_re, re.I))
            if cand.count():
                el = cand.first
        except Exception:
            el = None
    if el is None:
        cand = page.get_by_placeholder(re.compile(label_re, re.I))
        if cand.count():
            el = cand.first
    expect(el is not None, f"could not locate form field {css_id} / '{label_re}'")
    el.fill(value)


def click_by_text(page, name_res, roles=("button", "link")):
    """Click the first visible element whose accessible name matches one of name_res."""
    for pat in name_res:
        rx = re.compile(pat, re.I)
        for role in roles:
            loc = page.get_by_role(role, name=rx)
            for i in range(loc.count()):
                el = loc.nth(i)
                if el.is_visible():
                    el.click()
                    return pat
    return None


def body_text(page):
    try:
        return page.inner_text("body", timeout=5000)
    except Exception:
        return ""


# ---------------------------------------------------------------- shared state

STATE = {"token": None, "user": None}


def need_token():
    tok = STATE["token"] or ENV_TOKEN
    expect(tok, "no session token available (login journey failed and MEDX_TOKEN unset)")
    return tok


def user_json_for_seed():
    u = STATE["user"] or {"email": SMOKE_EMAIL}
    return json.dumps(u) if not isinstance(u, str) else u


# ---------------------------------------------------------------- journeys

def j01_login(pw, browser):
    """Form login → POST /api/auth/login 200 → medx_user_token in localStorage → /api/auth/me 200.
    This is the ONLY form login in the suite (authLimiter: 15 attempts / 15 min / IP)."""
    if SKIP_LOGIN:
        expect(ENV_TOKEN, "SKIP_LOGIN=1 requires MEDX_TOKEN")
        st, _, _, me = api("GET", "/api/auth/me", token=ENV_TOKEN)
        expect(st == 200, f"/api/auth/me with MEDX_TOKEN -> {st}")
        STATE["token"], STATE["user"] = ENV_TOKEN, me
        return "SKIP: form login skipped (SKIP_LOGIN=1); MEDX_TOKEN verified via /api/auth/me 200"

    ctx = browser.new_context()
    ctx.set_default_timeout(15000)
    try:
        page = ctx.new_page()
        page.goto(BASE + "/", wait_until="domcontentloaded")
        page.wait_for_timeout(1500)

        # Reveal the login form if it is not already on screen (landing shows a CTA).
        if first_visible(page, "input[type=email]") is None:
            clicked = click_by_text(page, [r"get started", r"^sign in", r"^log ?in"])
            expect(clicked, "no visible email input and no Get Started / Sign In control found")
            page.locator("input[type=email]:visible").first.wait_for(timeout=8000)

        email_in = first_visible(page, "input[type=email]")
        pwd_in = first_visible(page, "input[type=password]")
        expect(email_in and pwd_in, "login form did not expose visible email+password inputs")
        email_in.fill(SMOKE_EMAIL)
        pwd_in.fill(SMOKE_PASSWORD)

        with page.expect_response(
            lambda r: r.url.startswith(BASE) and r.url.endswith("/api/auth/login")
            and r.request.method == "POST", timeout=20000
        ) as ri:
            if not click_by_text(page, [r"^sign in$", r"^log ?in$", r"^sign in\b"]):
                pwd_in.press("Enter")
        resp = ri.value
        if resp.status == 429:
            raise Fail("auth rate limit hit (15/15min) — wait, or rerun with MEDX_TOKEN + SKIP_LOGIN=1")
        expect(resp.status == 200, f"POST /api/auth/login -> {resp.status}")
        data = resp.json()
        token = data.get("token")
        expect(token, "login 200 but no `token` in response body")

        # Contract: the SPA must persist the session under medx_user_token.
        deadline = time.time() + 6
        stored = None
        while time.time() < deadline:
            stored = page.evaluate("localStorage.getItem('medx_user_token')")
            if stored:
                break
            page.wait_for_timeout(250)
        expect(stored == token, "medx_user_token not persisted to localStorage after login")

        st, _, _, me = api("GET", "/api/auth/me", token=token)
        expect(st == 200, f"/api/auth/me with fresh token -> {st}")
        expect((me or {}).get("email", "").lower() == SMOKE_EMAIL.lower(),
               f"/api/auth/me returned {me and me.get('email')!r}, expected {SMOKE_EMAIL!r}")

        STATE["token"] = token
        STATE["user"] = data.get("user") or me
        return "form login 200, medx_user_token persisted, /api/auth/me 200"
    finally:
        ctx.close()


CORE_DATA_ENDPOINTS = (
    "/api/registrations/my", "/api/rewards/summary", "/api/member/meta",
    "/api/feed/home", "/api/feed", "/api/auth/me",
)


def j02_dashboard(pw, browser):
    """Seeded session boots the SPA: core data endpoints 200, no 5xx, non-empty main,
    session key survives (network issues must never clear it — contract §2.1)."""
    tok = need_token()
    ctx = seeded_context(browser, tok, user_json_for_seed())
    try:
        page = ctx.new_page()
        hits = {}
        errors_5xx = []

        def on_resp(r):
            if not r.url.startswith(BASE) or "/api/" not in r.url:
                return
            path = r.url[len(BASE):].split("?")[0]
            hits[path] = r.status
            if r.status >= 500:
                errors_5xx.append(f"{r.status} {path}")

        page.on("response", on_resp)
        page.goto(BASE + "/", wait_until="domcontentloaded")

        deadline = time.time() + 20
        while time.time() < deadline:
            ok = [p for p in CORE_DATA_ENDPOINTS if hits.get(p) == 200]
            if len(ok) >= 2:
                break
            page.wait_for_timeout(400)
        ok = [p for p in CORE_DATA_ENDPOINTS if hits.get(p) == 200]
        expect(len(ok) >= 2,
               f"expected >=2 core data endpoints to return 200, saw: { {p: hits.get(p) for p in CORE_DATA_ENDPOINTS} }")
        expect(not errors_5xx, f"5xx during dashboard boot: {errors_5xx}")

        page.wait_for_timeout(1500)
        txt = body_text(page)
        expect(len(txt.strip()) > 500, f"rendered body text suspiciously small ({len(txt.strip())} chars)")
        expect(page.evaluate("localStorage.getItem('medx_user_token')") == tok,
               "session token was dropped from localStorage during dashboard boot")
        return f"core endpoints 200: {', '.join(sorted(ok))}; no 5xx; content rendered"
    finally:
        ctx.close()


def j03_plexus_registration(pw, browser):
    """/plexus: pick the FREE conference path via the data-key contract attribute, submit
    ZZSMOKE data -> POST /api/croatians-abroad/register 200 + id; row verified via API."""
    smoke_email = f"zzsmoke-{int(time.time())}@smoke.medx.test"
    ctx = browser.new_context()  # anonymous — keeps the ZZSMOKE row off the real account
    ctx.set_default_timeout(15000)
    try:
        page = ctx.new_page()
        page.goto(BASE + "/plexus", wait_until="domcontentloaded")

        # Contract attribute from the served page: event cards carry data-key.
        card = page.locator('[data-key="conference"]')
        expect(card.count() > 0, "conference card ([data-key=conference]) not found on /plexus")
        card.first.click()

        fill_contract_field(page, "ZZSMOKE-Test", "#pf_first", r"first name")
        fill_contract_field(page, "Row", "#pf_last", r"last name")
        fill_contract_field(page, smoke_email, "#pf_email", r"email")
        fill_contract_field(page, "ZZSMOKE Institute", "#pf_inst", r"institution")
        fill_contract_field(page, "Croatia", "#pf_country", r"country")
        notes = first_visible(page, "#pf_notes") or first_visible(page, "textarea")
        if notes:
            notes.fill(SMOKE_NOTE)

        with page.expect_response(
            lambda r: r.url.startswith(BASE) and "/api/croatians-abroad/register" in r.url
            and r.request.method == "POST", timeout=30000
        ) as ri:
            if not click_by_text(page, [r"complete registration"]):
                sub = first_visible(page, "button[type=submit]")
                expect(sub, "no submit control found on /plexus form")
                sub.click()
        resp = ri.value
        jd = None
        try:
            jd = resp.json()
        except Exception:
            pass
        expect(resp.status == 200, f"POST /api/croatians-abroad/register -> {resp.status} {jd}")
        expect(jd and jd.get("success") and jd.get("id"),
               f"register response missing success/id: {jd}")
        reg_id = jd["id"]

        # Resulting UI state (free path confirms immediately).
        deadline = time.time() + 10
        confirmed = False
        while time.time() < deadline:
            if re.search(r"you are registered|registration confirmed|pre-?registered",
                         body_text(page), re.I):
                confirmed = True
                break
            page.wait_for_timeout(400)
        expect(confirmed, "no registration-confirmed state rendered after 200 response")

        # Row exists via API — the hosted QR endpoint resolves the row server-side...
        st, hdrs, raw, _ = api("GET", f"/qr/{reg_id}.png")
        expect(st == 200 and raw[:4] == b"\x89PNG",
               f"/qr/{reg_id}.png -> {st} (row not resolvable)")
        # ...and, when the session is an admin (scratch default), the admin list shows it.
        via = "/qr/<id>.png"
        st2, _, _, rows = api("GET", "/api/admin/plexus-experience/registrations",
                              token=need_token())
        if st2 == 200 and isinstance(rows, list):
            expect(any(r.get("id") == reg_id for r in rows),
                   "registration id missing from /api/admin/plexus-experience/registrations")
            via += " + admin registrations list"

        # Cleanup: the user portal has NO member-facing delete/cancel for these rows —
        # leave the ZZSMOKE row (notes-tagged, unique email) as documented in README.md.
        return (f"free-path registration {reg_id[:8]}… created ({smoke_email}); "
                f"row verified via {via}; no delete path — ZZSMOKE row left")
    finally:
        ctx.close()


def j04_ticket_qr(pw, browser):
    """My Med&X (#mymedx hash — deep-link contract) shows an existing registration;
    hosted /qr/<regId>.png answers 200 image/png (referenced by sent emails — must survive)."""
    tok = need_token()
    st, _, _, regs = api("GET", "/api/registrations/my", token=tok)
    expect(st == 200 and isinstance(regs, list), f"/api/registrations/my -> {st}")
    expect(regs, "account has no registrations to show (seed the scratch DB)")
    reg = regs[0]
    marker = reg.get("conference_name") or reg.get("invoice_number")
    expect(marker, "registration row carries neither conference_name nor invoice_number")

    ctx = seeded_context(browser, tok, user_json_for_seed())
    try:
        page = ctx.new_page()
        with page.expect_response(
            lambda r: r.url.startswith(BASE) and "/api/registrations/my" in r.url,
            timeout=20000
        ):
            page.goto(BASE + "/#mymedx", wait_until="domcontentloaded")

        found = False
        deadline = time.time() + 12
        clicked_nav = False
        while time.time() < deadline:
            if marker in body_text(page):
                found = True
                break
            if not clicked_nav and time.time() > deadline - 8:
                clicked_nav = bool(click_by_text(page, [r"my med"]))
            page.wait_for_timeout(400)
        expect(found, f"registration marker {marker!r} not rendered on #mymedx")
    finally:
        ctx.close()

    st, hdrs, raw, _ = api("GET", f"/qr/{reg['id']}.png")
    ctype = hdrs.get("Content-Type", "")
    expect(st == 200, f"/qr/{reg['id']}.png -> {st}")
    expect("image/png" in ctype, f"QR content-type {ctype!r}, expected image/png")
    expect(raw[:4] == b"\x89PNG", "QR response is not a PNG bytestream")
    return f"'{marker}' rendered on #mymedx; /qr/{reg['id'][:8]}….png 200 image/png"


def j05_gala_checkout(pw, browser):
    """POST /api/gala/checkout-session honors its contract without paying: with Stripe
    keys -> session URL path; without keys -> the clean 'Stripe is not configured' 400."""
    tok = need_token()
    st, _, _, cfg = api("GET", "/api/plexus/stripe-config")
    expect(st == 200, f"/api/plexus/stripe-config -> {st}")
    stripe_on = bool((cfg or {}).get("enabled"))

    st, _, _, jd = api("POST", "/api/gala/checkout-session", token=tok,
                       body={"registration_id": f"{RUN_TAG}-nonexistent"})
    if not stripe_on:
        expect(st == 400, f"no-key mode: expected 400, got {st} {jd}")
        err = (jd or {}).get("error", "")
        expect("stripe" in err.lower() and "not configured" in err.lower(),
               f"no-key mode: expected clean 'Stripe is not configured' error, got {jd}")
        return "Stripe unconfigured -> clean 400 'Stripe is not configured' (contract holds)"
    # Keys present: a bogus registration_id must 404 (route + auth + lookup wired) —
    # a real approved+unpaid gala registration would instead return 200 {url: stripe…}.
    if st == 200:
        url = (jd or {}).get("url", "")
        expect(url.startswith("https://") and "stripe" in url,
               f"200 but url is not a Stripe checkout URL: {jd}")
        return f"Stripe live -> checkout session URL returned ({url.split('?')[0][:60]}…)"
    expect(st == 404, f"Stripe live: expected 404 for unknown registration_id, got {st} {jd}")
    return "Stripe live -> 404 for unknown registration_id (endpoint + auth wired; not paid)"


def j06_donate_checkout(pw, browser):
    """GET /donate/checkout?amount&frequency&designation -> 302/303 redirect
    (Stripe checkout, or the medx.hr error page when keys are absent — both prove routing)."""
    st, hdrs, _, _ = api("GET", "/donate/checkout?amount=25&frequency=once&designation=plexus",
                         follow_redirects=False)
    expect(st in (302, 303), f"expected 302/303 redirect, got {st}")
    loc = hdrs.get("Location", "")
    expect(loc, "redirect carried no Location header")
    kind = "Stripe checkout" if "stripe" in loc else \
           "medx.hr donate error page (no Stripe key — clean fallback)" if "medx.hr" in loc else loc
    expect("stripe" in loc or "medx.hr" in loc,
           f"redirect points somewhere unexpected: {loc}")
    return f"{st} -> {kind}"


def j07_accelerator_draft(pw, browser):
    """Accelerator application draft: save via API, re-read, assert persistence.
    Uses the intake API when its window is open, else the applications API (ungated)."""
    tok = need_token()
    st, _, _, w = api("GET", "/api/accelerator/intake")
    expect(st == 200, f"/api/accelerator/intake -> {st}")
    window_state = (w or {}).get("state")

    if window_state == "open":
        st, _, _, jd = api("POST", "/api/accelerator/intake/draft", token=tok,
                           body={"payload": {"project_name": RUN_TAG}})
        expect(st == 200 and (jd or {}).get("id"), f"intake draft save -> {st} {jd}")
        draft_id = jd["id"]
        st, _, _, jd2 = api("POST", "/api/accelerator/intake/draft", token=tok,
                            body={"id": draft_id, "payload": {"project_name": RUN_TAG + "-v2"}})
        expect(st == 200, f"intake draft update -> {st} {jd2}")
        st, _, _, mine = api("GET", "/api/accelerator/intake/mine", token=tok)
        expect(st == 200, f"/api/accelerator/intake/mine -> {st}")
        row = next((s for s in (mine or {}).get("submissions", []) if s.get("id") == draft_id), None)
        expect(row, "saved intake draft not returned by /api/accelerator/intake/mine")
        expect(row.get("payload", {}).get("project_name") == RUN_TAG + "-v2",
               f"intake draft payload did not persist the update: {row.get('payload')}")
        return f"intake window open: draft {draft_id[:8]}… saved, updated, persisted via /mine"

    # Window not open (state 'before'/'closed'): the ungated applications API carries drafts.
    st, _, _, jd = api("POST", "/api/accelerator/applications", token=tok, body={
        "first_name": "ZZSMOKE-Test", "last_name": "Row",
        "email": f"zzsmoke-acc-{int(time.time())}@smoke.medx.test",
        "current_institution": f"{RUN_TAG} Institute", "status": "draft",
    })
    expect(st == 200 and (jd or {}).get("id"), f"applications draft save -> {st} {jd}")
    app_id = jd["id"]
    st, _, _, mine = api("GET", "/api/accelerator/my-applications", token=tok)
    expect(st == 200 and isinstance(mine, list), f"/api/accelerator/my-applications -> {st}")
    row = next((a for a in mine if a.get("id") == app_id), None)
    expect(row, "saved application draft not returned by /api/accelerator/my-applications")
    expect(row.get("status") == "draft", f"draft status not persisted: {row.get('status')}")
    expect(row.get("current_institution") == f"{RUN_TAG} Institute",
           "draft field current_institution did not persist")
    return (f"intake window '{window_state}' -> applications API: draft {app_id[:8]}… "
            f"({jd.get('application_number')}) saved + persisted (ZZSMOKE row left)")


def j08_profile(pw, browser):
    """PUT /api/auth/profile round-trip: change institution, re-read, restore original."""
    tok = need_token()
    st, _, _, me = api("GET", "/api/auth/me", token=tok)
    expect(st == 200 and me, f"/api/auth/me -> {st}")

    fields = ("first_name", "last_name", "phone", "institution", "country", "bio",
              "is_public_profile")
    orig = {k: me.get(k) for k in fields}
    marker = f"{(orig.get('institution') or 'Institute')} ·{RUN_TAG}"

    changed = dict(orig, institution=marker)
    st, _, _, jd = api("PUT", "/api/auth/profile", token=tok, body=changed)
    expect(st == 200 and (jd or {}).get("success"), f"profile update -> {st} {jd}")
    st, _, _, me2 = api("GET", "/api/auth/me", token=tok)
    expect(st == 200 and me2.get("institution") == marker,
           f"institution change did not persist (got {me2.get('institution')!r})")

    st, _, _, jd = api("PUT", "/api/auth/profile", token=tok, body=orig)
    expect(st == 200 and (jd or {}).get("success"), f"profile restore -> {st} {jd}")
    st, _, _, me3 = api("GET", "/api/auth/me", token=tok)
    expect(st == 200 and me3.get("institution") == orig["institution"],
           f"institution not restored (got {me3.get('institution')!r})")
    return "institution changed, persisted after re-read, and restored to original"


SERVER_PAGES = ["/plexus", "/donor-night", "/building-bridges", "/forum", "/invite-cancelled"]


def j09_server_pages(pw, browser):
    """Server-rendered pages answer 200 with non-trivial HTML (email-linked URLs — contract)."""
    problems, sizes = [], []
    for p in SERVER_PAGES:
        st, hdrs, raw, _ = api("GET", p)
        ctype = hdrs.get("Content-Type", "")
        if st != 200:
            problems.append(f"{p} -> {st}")
        elif "text/html" not in ctype:
            problems.append(f"{p} content-type {ctype!r}")
        elif len(raw) < 1000:
            problems.append(f"{p} only {len(raw)} bytes")
        else:
            sizes.append(f"{p} ({len(raw)//1024} KB)")
    expect(not problems, "; ".join(problems))
    return "200 + non-trivial HTML: " + ", ".join(sizes)


def j10_auth_guards(pw, browser):
    """Member-only APIs reject a bad token with 401 (and no token, outside dev auto-login)."""
    bad = "zz.smoke.invalid-token"
    st1, _, _, _ = api("GET", "/api/registrations/my", token=bad)
    st2, _, _, _ = api("GET", "/api/auth/me", token=bad)
    expect(st1 == 401, f"/api/registrations/my with invalid token -> {st1}, expected 401")
    expect(st2 == 401, f"/api/auth/me with invalid token -> {st2}, expected 401")

    st3, _, _, _ = api("GET", "/api/registrations/my")  # no Authorization header at all
    if st3 == 401:
        return "invalid token -> 401; missing token -> 401 (production behavior)"
    # Local scratch runs NODE_ENV=development without Turso, which deliberately enables
    # the dev auto-login fallback (user server.js DEV_AUTH_ENABLED) — the middleware is
    # still proven active by the invalid-token 401s above.
    expect(st3 == 200, f"missing token -> unexpected status {st3}")
    return ("invalid token -> 401 on both endpoints; missing token -> 200 via dev "
            "auto-login (NODE_ENV=development scratch only; 401 in production config)")


JOURNEYS = [
    ("LOGIN", j01_login),
    ("DASHBOARD", j02_dashboard),
    ("PLEXUS-REGISTRATION", j03_plexus_registration),
    ("TICKET-QR", j04_ticket_qr),
    ("GALA-CHECKOUT", j05_gala_checkout),
    ("DONATE-CHECKOUT", j06_donate_checkout),
    ("ACCELERATOR-DRAFT", j07_accelerator_draft),
    ("PROFILE", j08_profile),
    ("SERVER-PAGES", j09_server_pages),
    ("AUTH-GUARDS", j10_auth_guards),
]


def main():
    ap = argparse.ArgumentParser(description="Med&X user-portal redesign smoke suite")
    ap.add_argument("--json", action="store_true", help="emit machine-readable JSON on stdout")
    args = ap.parse_args()
    out = sys.stderr if args.json else sys.stdout

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("FATAL: playwright not importable for python3 (pip install playwright)", file=sys.stderr)
        sys.exit(len(JOURNEYS))

    # Fast preflight so a down server fails in one line, not ten.
    try:
        st, _, _, _ = api("GET", "/health", timeout=10)
    except Fail as e:
        print(f"FATAL: {BASE} unreachable — {e}", file=sys.stderr)
        sys.exit(len(JOURNEYS))

    results = []
    print(f"Med&X user-portal redesign smoke suite — {BASE}", file=out)
    print(f"run tag: {RUN_TAG}\n", file=out)

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=not HEADED)
        for name, fn in JOURNEYS:
            t0 = time.time()
            try:
                detail = fn(pw, browser) or ""
                status = "SKIP" if detail.startswith("SKIP:") else "PASS"
                detail = detail[len("SKIP:"):].strip() if status == "SKIP" else detail
            except Fail as e:
                status, detail = "FAIL", str(e)
            except Exception as e:  # script/browser crash — still a failed gate
                status, detail = "FAIL", f"{type(e).__name__}: {e}"
            if status == "FAIL" and name in KNOWN_FAILS:
                status, detail = "KNOWN-FAIL", f"{KNOWN_FAILS[name]} | {detail}"
            results.append({"journey": name, "status": status, "detail": detail,
                            "seconds": round(time.time() - t0, 1)})
            print(f"[{status:>10}] {name:<20} {detail}", file=out)
        browser.close()

    failures = sum(1 for r in results if r["status"] == "FAIL")
    counts = {s: sum(1 for r in results if r["status"] == s)
              for s in ("PASS", "FAIL", "KNOWN-FAIL", "SKIP")}
    print(f"\n{counts['PASS']} pass, {counts['FAIL']} fail, "
          f"{counts['KNOWN-FAIL']} known-fail, {counts['SKIP']} skipped", file=out)

    if args.json:
        print(json.dumps({"base_url": BASE, "run_tag": RUN_TAG, "results": results,
                          "failures": failures}, indent=2))
    sys.exit(failures)


if __name__ == "__main__":
    main()
