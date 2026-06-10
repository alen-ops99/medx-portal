// Med&X Staff (Admin) Service Worker — minimal, enables PWA install + offline app shell.
// Admin data must always be fresh, so we are network-first for everything and NEVER cache
// API responses; the cache only holds the app shell so the app opens offline.
const CACHE_NAME = 'medx-staff-v1';
const SHELL = ['/index.html', '/manifest.json', '/icon-192.png'];

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((names) => Promise.all(names.map((n) => n !== CACHE_NAME && caches.delete(n))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
    const url = new URL(event.request.url);
    // Never cache API — admin views must reflect live data.
    if (url.pathname.startsWith('/api/')) return;

    // Navigations: network-first, fall back to the cached shell when offline.
    if (event.request.mode === 'navigate' || event.request.destination === 'document') {
        event.respondWith(
            fetch(event.request)
                .then((res) => {
                    if (url.pathname === '/' || url.pathname === '/index.html') {
                        const copy = res.clone();
                        caches.open(CACHE_NAME).then((c) => c.put('/index.html', copy));
                    }
                    return res;
                })
                .catch(() => caches.match('/index.html'))
        );
        return;
    }
    // Other GETs (icons, fonts): cache-first.
    event.respondWith(
        caches.match(event.request).then((cached) => cached || fetch(event.request).then((res) => {
            if (res && res.status === 200 && res.type === 'basic') {
                const copy = res.clone();
                caches.open(CACHE_NAME).then((c) => c.put(event.request, copy));
            }
            return res;
        }).catch(() => null))
    );
});
