const CACHE_NAME = 'camera-gps-app-v1';
const APP_SHELL = [
    './',
    './index.html',
    './manifest.json',
    './CSS/style.css',
    './js/camera.js',
    './js/location.js',
    './icons/icon-192.png',
    './icons/icon-512.png'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
    );
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request).then(cachedResponse => {
            return cachedResponse || fetch(event.request);
        })
    );
});