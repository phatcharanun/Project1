const CACHE_NAME = 'camera-gps-app-v4';

const APP_SHELL = [
    './',
    './index.html',
    './pwa/manifest.json',
    './CSS/style.css',
    './js/camera.js',
    './js/location.js',
    './pwa/icons/icon1.svg',
    './pwa/icons/icon2.svg'
];

self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => Promise.all(
            cacheNames
                .filter(cacheName => cacheName !== CACHE_NAME)
                .map(cacheName => caches.delete(cacheName))
        ))
    );
    self.clients.claim();
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request).then(cachedResponse => {
            return cachedResponse || fetch(event.request);
        })
    );
});