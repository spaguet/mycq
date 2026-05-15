const CACHE_NAME = 'mycq-static-v28';
const STATIC_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/logo.png',
  './icons/icon-add.png',
  './icons/icon-chat.png',
  './icons/icon-exit.png',
  './icons/icon-inbox.png',
  './icons/icon-pen.png',
  './icons/icon-person.png',
  './icons/icon-send_arrow.png',
  './icons/icon-settings.png',
  './icons/icon-star.png',
  './icons/icon-trash.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((key) => key !== CACHE_NAME)
        .map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => (
      cached || fetch(event.request)
    ))
  );
});
