#!/usr/bin/env python3
"""scripts/make-icons.py — render the App Icon artboard's PRIMARY tile (App Icon & Splash.dc.html:
ink gradient ground, gold ring inset, italic Fraunces ampersand, crimson diamond) to PNG with
headless Chromium (Playwright). Outputs assets/icons/: icon-192/512 (rounded, purpose "any"),
icon-maskable-192/512 (square full-bleed — the platform applies its own mask), apple-touch-icon (180,
square) and icon-1024 (store master). Run from anywhere:  python3 scripts/make-icons.py
"""
import os, sys
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'assets', 'icons')
os.makedirs(OUT, exist_ok=True)

# artboard values at 180px (App Icon & Splash.dc.html › "01 · APP ICON — THE AMPERSAND MARK", PRIMARY · 180)
BASE = 180.0
def tile(size, rounded):
    s = size / BASE
    radius = f"{40*s:.2f}px" if rounded else "0"
    ring_radius = f"{30*s:.2f}px" if rounded else "0"
    return f"""
<div id="tile" style="width:{size}px;height:{size}px;border-radius:{radius};background:linear-gradient(135deg,#221c17 0%,#191512 60%,#14100d 100%);position:relative;display:flex;align-items:center;justify-content:center;overflow:hidden">
  <div style="position:absolute;inset:{12*s:.2f}px;border:{1.5*s:.2f}px solid rgba(201,169,98,.5);border-radius:{ring_radius}"></div>
  <span style="font-family:Fraunces,serif;font-style:italic;font-weight:600;font-size:{104*s:.2f}px;color:#c9a962;line-height:1;margin-top:{-8*s:.2f}px">&amp;</span>
  <span style="position:absolute;right:{34*s:.2f}px;bottom:{32*s:.2f}px;width:{14*s:.2f}px;height:{14*s:.2f}px;background:#9b1b22;transform:rotate(45deg)"></span>
</div>"""

PAGE = """<!DOCTYPE html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..700;1,9..144,300..700&display=swap" rel="stylesheet">
<style>body{margin:0;background:transparent}</style></head><body>%s</body></html>"""

JOBS = [
    ('icon-1024.png', 1024, True), ('icon-512.png', 512, True), ('icon-192.png', 192, True),
    ('icon-maskable-512.png', 512, False), ('icon-maskable-192.png', 192, False), ('apple-touch-icon.png', 180, False),
]
with sync_playwright() as pw:
    browser = pw.chromium.launch()
    page = browser.new_page(viewport={'width': 1200, 'height': 1200}, device_scale_factor=1)
    for name, size, rounded in JOBS:
        page.set_content(PAGE % tile(size, rounded), wait_until='load')
        page.evaluate("document.fonts.load('italic 600 100px Fraunces')")
        page.wait_for_function("document.fonts.check('italic 600 100px Fraunces')", timeout=20000)
        page.wait_for_timeout(150)
        el = page.query_selector('#tile')
        el.screenshot(path=os.path.join(OUT, name), omit_background=rounded)
        print('icon:', name, size)
    browser.close()
print('done →', os.path.abspath(OUT))
