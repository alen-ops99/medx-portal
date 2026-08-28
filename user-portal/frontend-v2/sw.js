// Med&X member portal v2 — service worker.
// Keep the CACHE_NAME line shape: scripts/stamp-sw.sh rewrites '…-vN' → '…-vN-<sha>' on deploy.
const CACHE_NAME = 'medx-portal-v2-1';

// App shell (same-origin only — cross-origin entries make cache.addAll() reject and the SW never installs).
const SHELL = [
  '/index.html', '/manifest.webmanifest',
  '/css/tokens.css', '/css/app.css',
  '/js/app.js', '/js/config.js', '/js/facts.js', '/js/state.js', '/js/api.js', '/js/ui.js', '/js/router.js', '/js/routes.js', '/js/chrome.js', '/js/member.js',
  '/js/views/home.js', '/js/views/auth.js', '/js/views/notfound.js',
  '/assets/logo.png', '/assets/logo-white.png', '/assets/mark-x.png', '/assets/icons/icon-192.png'
];
// Server-rendered paths (see js/config.js serverPaths) — network only, never cached, never shell-fallbacked.
const SERVER_PREFIXES = ['/api', '/plexus', '/forum', '/apply', '/evaluate', '/pay', '/pass', '/invite', '/invite-success', '/invite-cancelled',
  '/reset-password', '/qr', '/calendar', '/verify-certificate', '/verify', '/r', '/unsubscribe', '/email-prefs', '/donate', '/uploads', '/f',
  '/speaker', '/building-bridges', '/donor-night', '/terms', '/privacy', '/health', '/__staging', '/__admin'];
const isServerPath = p => SERVER_PREFIXES.some(x => p === x || p.startsWith(x + '/'));
const isStatic = p => p.startsWith('/css/') || p.startsWith('/js/') || p.startsWith('/assets/') || p === '/manifest.webmanifest';

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => Promise.all(SHELL.map(u => cache.add(u).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;             // cross-origin (fonts, API on staging) never intercepted
  if (isServerPath(url.pathname)) return;                        // /api/* and every server page: ALWAYS bypass
  if (req.mode === 'navigate') {                                 // navigations: network-first, shell fallback
    event.respondWith(fetch(req).then(res => {
      if (res.ok) caches.open(CACHE_NAME).then(c => c.put('/index.html', res.clone()));
      return res;
    }).catch(() => caches.match('/index.html')));
    return;
  }
  if (isStatic(url.pathname)) {                                  // css / js / assets: cache-first
    event.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok && res.type === 'basic') caches.open(CACHE_NAME).then(c => c.put(req, res.clone()));
      return res;
    })));
  }
});

// Web push (payload {title, body, url}) — same contract as the legacy worker.
self.addEventListener('push', event => {
  let data = {}; try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Med&X', {
    body: data.body || '', icon: '/assets/icons/icon-192.png', badge: '/assets/icons/icon-192.png', data: { url: data.url || '/app/home?app=1' }
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/app/home?app=1';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const open = list.find(c => 'focus' in c);
    if (open) { open.navigate(target); return open.focus(); }
    return self.clients.openWindow(target);
  }));
});
self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil(fetch('/api/push/vapid-key').then(r => r.json()).then(k => self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: k.publicKey || k.key }))
    .then(sub => self.clients.matchAll({ type: 'window' }).then(list => list.forEach(c => c.postMessage({ type: 'medx-push-resubscribe', subscription: sub.toJSON() })))).catch(() => null));
});
