// Med&X Portal Service Worker
const CACHE_NAME = 'medx-portal-v8';

// App-shell assets to precache. (icon-512 is install-only and 740KB — left out of precache
// so it isn't fetched on every first load; the browser pulls it from the manifest on install.)
const ASSETS_TO_CACHE = [
    '/index.html',
    '/manifest.json',
    '/icon-192.png',
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap'
];

// Install event - cache assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('Caching assets');
                return cache.addAll(ASSETS_TO_CACHE);
            })
            .then(() => self.skipWaiting())
    );
});

// Activate event - clean old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch event - network-first strategy (always get fresh content, cache as fallback)
self.addEventListener('fetch', (event) => {
    // Skip non-GET requests
    if (event.request.method !== 'GET') return;

    const url = new URL(event.request.url);

    // Never cache API responses — admin edits must reach returning visitors immediately.
    if (url.pathname.startsWith('/api/')) {
        return;
    }

    // Navigations: network-first, fall back to the cached APP SHELL only. We do NOT cache the
    // per-URL document — every tokenized /invite/<base64> and /invite-success?session_id=...
    // is a unique URL, and caching each stored a separate full 5.6MB SPA copy (cache bloat).
    // The SPA is one shell that routes client-side, so one cached /index.html serves all routes.
    if (event.request.mode === 'navigate' || event.request.destination === 'document') {
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    // Refresh the shell cache only from the bare root/index navigations.
                    if (url.pathname === '/' || url.pathname === '/index.html') {
                        const copy = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy));
                    }
                    return response;
                })
                .catch(() => caches.match('/index.html'))
        );
        return;
    }

    // For static assets (fonts, icons, CSS), use cache-first
    event.respondWith(
        caches.match(event.request)
            .then((cachedResponse) => {
                if (cachedResponse) return cachedResponse;
                return fetch(event.request)
                    .then((response) => {
                        if (!response || response.status !== 200 || response.type !== 'basic') return response;
                        const responseToCache = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
                        return response;
                    })
                    .catch(() => null);
            })
    );
});

// URL-safe base64 -> Uint8Array (for the VAPID applicationServerKey on resubscribe)
function urlB64ToUint8Array(base64) {
    const padding = '='.repeat((4 - (base64.length % 4)) % 4);
    const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(b64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
}

// Push notification event. The user portal sends JSON.stringify({ title, body, url });
// fall back gracefully to plain text or a default if the payload is missing/legacy.
self.addEventListener('push', (event) => {
    let payload = { title: 'Med&X', body: 'New notification from Med&X', url: '/?app=1' };
    if (event.data) {
        try {
            const parsed = event.data.json();
            payload.title = parsed.title || payload.title;
            payload.body = parsed.body || payload.body;
            payload.url = parsed.url || payload.url;
        } catch (e) {
            payload.body = event.data.text() || payload.body;
        }
    }
    const options = {
        body: payload.body,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        vibrate: [200, 100, 200],
        data: { url: payload.url }
    };
    event.waitUntil(self.registration.showNotification(payload.title, options));
});

// Notification click event — focus an already-open portal tab if there is one, else open a new one.
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const target = (event.notification.data && event.notification.data.url) || '/?app=1';
    event.waitUntil((async () => {
        const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const c of all) {
            if ('focus' in c) {
                try { if ('navigate' in c) await c.navigate(target); } catch (e) {}
                return c.focus();
            }
        }
        if (clients.openWindow) return clients.openWindow(target);
    })());
});

// Push subscriptions can be rotated/expired by the browser. When that happens, re-subscribe with
// the current VAPID key and ask any open portal tab to persist the fresh subscription (the tab has
// the member's auth token, which the service worker does not). The page also re-checks on load.
self.addEventListener('pushsubscriptionchange', (event) => {
    event.waitUntil((async () => {
        try {
            let appServerKey = null;
            try {
                const r = await fetch('/api/push/vapid-key');
                if (r.ok) { const d = await r.json(); if (d && d.publicKey) appServerKey = urlB64ToUint8Array(d.publicKey); }
            } catch (e) { /* offline — nothing to do */ }
            const opts = { userVisibleOnly: true };
            if (appServerKey) opts.applicationServerKey = appServerKey;
            const sub = await self.registration.pushManager.subscribe(opts);
            const all = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
            for (const c of all) c.postMessage({ type: 'medx-push-resubscribe', subscription: sub.toJSON() });
        } catch (e) { /* best effort */ }
    })());
});
