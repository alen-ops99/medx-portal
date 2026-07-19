
    (function () {
        try {
            var STANDALONE = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
            if (STANDALONE) return; // already installed
            if (localStorage.getItem('medx_install_dismissed') === '1') return;
            var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
            var deferred = null;
            window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferred = e; showBanner(); });
            // iOS never fires beforeinstallprompt — show the banner after a short delay so it's not jarring on first paint.
            if (isIOS) setTimeout(showBanner, 4000);

            function showBanner() {
                if (document.getElementById('medxInstallBanner')) return;
                // Only inside the app (logged in) — never on the splash/sign-in screen.
                if (!localStorage.getItem('medx_user_token')) return;
                var b = document.createElement('div');
                b.id = 'medxInstallBanner';
                b.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:99999;max-width:520px;margin:0 auto;background:#1d1a17;color:#fff;border:1px solid rgba(155,27,34,0.5);border-radius:14px;padding:12px 14px;display:flex;align-items:center;gap:12px;box-shadow:0 8px 30px rgba(0,0,0,0.4);font-family:system-ui,-apple-system,sans-serif;';
                var A2T = function (k, fallback) { try { var v = (window.MedXI18n && MedXI18n.t) ? MedXI18n.t(k) : k; return (v && v !== k) ? v : fallback; } catch (e) { return fallback; } };
                b.innerHTML = '<div style="width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,var(--gold),#b49650);display:flex;align-items:center;justify-content:center;flex-shrink:0;color: var(--ink);font-size:18px;">🎟️</div>'
                    + '<div style="flex:1;min-width:0;"><div style="font-weight:700;font-size:14px;">' + A2T('pwa.a2hsTitle', 'Add Med&X to your home screen') + '</div><div style="font-size:12px;color: var(--muted);">' + A2T('pwa.a2hsDesc', 'Your tickets and schedule, always within reach.') + '</div></div>'
                    + '<button id="medxInstallGo" style="background:#9b1b22;color:#fff;border:none;border-radius:9px;padding:9px 14px;font-weight:700;font-size:13px;cursor:pointer;flex-shrink:0;">' + A2T('pwa.installBtn', 'Install') + '</button>'
                    + '<button id="medxInstallX" aria-label="Dismiss" style="background:transparent;border:none;color: var(--muted);font-size:18px;cursor:pointer;flex-shrink:0;padding:4px 6px;">×</button>';
                document.body.appendChild(b);
                document.getElementById('medxInstallX').onclick = function () { b.remove(); localStorage.setItem('medx_install_dismissed', '1'); };
                document.getElementById('medxInstallGo').onclick = async function () {
                    if (deferred) {
                        deferred.prompt();
                        try { await deferred.userChoice; } catch (e) {}
                        deferred = null; b.remove();
                    } else {
                        // iOS / no native prompt → show instructions
                        showIosInstructions();
                    }
                };
            }
            function showIosInstructions() {
                var m = document.createElement('div');
                m.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;padding:20px;font-family:system-ui,-apple-system,sans-serif;';
                m.innerHTML = '<div style="background:#fff;color: var(--ink);border-radius:16px;max-width:360px;width:100%;padding:22px;text-align:center;">'
                    + '<div style="font-size:34px;margin-bottom:8px;">📲</div>'
                    + '<h3 style="margin:0 0 8px;font-size:18px;">Add to Home Screen</h3>'
                    + '<p style="margin:0 0 6px;font-size:14px;color:var(--ink-soft);line-height:1.6;">1. Tap the <strong>Share</strong> icon <span style="display:inline-block;">↑</span> in your browser bar</p>'
                    + '<p style="margin:0 0 16px;font-size:14px;color:var(--ink-soft);line-height:1.6;">2. Choose <strong>“Add to Home Screen”</strong></p>'
                    + '<button id="medxIosClose" style="background:var(--ink);color:#fff;border:none;border-radius:10px;padding:10px 22px;font-weight:600;cursor:pointer;">Got it</button>'
                    + '</div>';
                document.body.appendChild(m);
                m.onclick = function (e) { if (e.target === m || e.target.id === 'medxIosClose') m.remove(); };
            }
        } catch (e) { /* never let the install banner break the app */ }
    })();
    