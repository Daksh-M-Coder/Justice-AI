const CACHE_NAME = 'justiceai-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  // Clear old caches
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      );
    })
  );
});

self.addEventListener('fetch', event => {
  // Let dynamic API requests pass straight through to the internet
  if (event.request.url.includes('/analyze') || event.request.url.includes('/chat') || event.request.url.includes('firestore')) {
    event.respondWith(fetch(event.request).catch(() => {
      // If offline, return a specific JSON or offline Response
      return new Response(JSON.stringify({ error: "You are offline. Please check your internet connection." }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }));
    return;
  }

  // Network-first strategy for static assets, falling back to cache if offline
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Cache external scripts like Firebase, html2pdf if we want, but letting browser handle is fine
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
