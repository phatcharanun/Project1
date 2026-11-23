const CACHE_NAME = 'camera-gps-app-v20';

const APP_SHELL = [
    './',
    './index.html',
    './pwa/manifest.json',
    './CSS/style.css',
    './js/camera.js',
    './js/Geofence.js',
    './qr-code-scanner/config.js',
    './qr-code-scanner/scanner.js',
    './qr-code-scanner/index.js',
    './qr-code-scanner/scanner.css',
    './pwa/icons/icon1.svg',
    './pwa/icons/icon2.svg',
    './js/webauthn.js'
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
    // 1. อนุญาตให้คำขอที่ไม่ใช่ GET (เช่น POST /api/geofence/check) ผ่านไปยัง Network ปกติโดยไม่ดักจับ
    if (event.request.method !== 'GET') {
        return;
    }

    const url = new URL(event.request.url);

    // 2. ไม่ดักจับหรือแคช API endpoints
    if (url.pathname.startsWith('/api')) {
        return;
    }

    // 3. ดึงไฟล์ UI / Static Assets จากแคชก่อน ถ้าไม่มีจึงดึงผ่าน Network
    event.respondWith(
        caches.match(event.request).then(cachedResponse => {
            return cachedResponse || fetch(event.request);
        })
    );
});
