// Med&X Portal Service Worker
const CACHE_NAME = 'medx-portal-v7';

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

// Push notification event
self.addEventListener('push', (event) => {
    const options = {
        body: event.data ? event.data.text() : 'New notification from Med&X',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        vibrate: [200, 100, 200],
        data: {
            url: '/'
        }
    };

    event.waitUntil(
        self.registration.showNotification('Med&X', options)
    );
});

// Notification click event
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    event.waitUntil(
        clients.openWindow(event.notification.data.url || '/')
    );
});
