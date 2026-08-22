const CACHE_NAME = 'camera-gps-app-v3';

const APP_SHELL = [
    './',
    './index.html',
    './manifest.json',
    './CSS/style.css',
    './js/camera.js',
    './js/location.js',
    './icons/icon1.svg',
    './icons/icon2.svg'
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