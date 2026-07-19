
    (function () {
        try {
            var deferred = null;
            window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferred = e; });
            function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream; }
            function isStandalone() { return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; }
            function iosSheet() {
                if (document.getElementById('medxIosInstallSheet')) return;
                var m = document.createElement('div');
                m.id = 'medxIosInstallSheet';
                m.style.cssText = 'position:fixed;inset:0;z-index:100001;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;padding:20px;font-family:system-ui,-apple-system,sans-serif;';
                m.innerHTML = '<div style="background:#fff;color:#15110f;border-radius:16px;max-width:360px;width:100%;padding:22px;text-align:center;">'
                    + '<div style="font-size:34px;margin-bottom:8px;">📲</div>'
                    + '<h3 style="margin:0 0 8px;font-size:18px;">Add Med&X to your Home Screen</h3>'
                    + '<p style="margin:0 0 6px;font-size:14px;color:#5b5650;line-height:1.6;">1. Tap the <strong>Share</strong> icon in your browser bar</p>'
                    + '<p style="margin:0 0 16px;font-size:14px;color:#5b5650;line-height:1.6;">2. Choose <strong>Add to Home Screen</strong></p>'
                    + '<button id="medxIosSheetClose" style="background:#15110f;color:#fff;border:none;border-radius:10px;padding:10px 22px;font-weight:600;cursor:pointer;">Got it</button>'
                    + '</div>';
                document.body.appendChild(m);
                m.onclick = function (e) { if (e.target === m || e.target.id === 'medxIosSheetClose') m.remove(); };
            }
            window.MedXInstall = {
                isIOS: isIOS,
                isStandalone: isStandalone,
                hasNativePrompt: function () { return !!deferred; },
                showIosInstructions: iosSheet,
                trigger: function () {
                    if (isStandalone()) {
                        try { if (typeof ToastSystem !== 'undefined') ToastSystem.info('Med&X is already installed on this device.'); } catch (e) {}
                        return;
                    }
                    if (deferred) {
                        deferred.prompt();
                        try { deferred.userChoice.then(function () { deferred = null; }); } catch (e) { deferred = null; }
                        return;
                    }
                    // No native prompt (iOS Safari, or the event has not fired) -> show Add to Home Screen steps.
                    iosSheet();
                }
            };
        } catch (e) { /* never let the install helper break the app */ }
    })();
    