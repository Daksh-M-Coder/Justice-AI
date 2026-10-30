/*
 * JusticeAI service worker — hand-written (plan step 33: next-pwa or hand-written).
 * Rules:
 *   - never cache /api/* : those responses are personal, and a stale letter is worse than none
 *   - app shell: network first, fall back to cache so a phone in a court corridor still opens it
 *   - static assets (_next/static, icons, fonts): cache first, they are content-hashed
 */
const VERSION = "justiceai-v2";
const SHELL = "/";
const STATIC_CACHE = `${VERSION}-static`;
const SHELL_CACHE = `${VERSION}-shell`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((c) => c.addAll([SHELL, "/login", "/manifest.webmanifest", "/icon.svg"]))
      .catch(() => undefined),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // never intercept the API

  if (url.pathname.startsWith("/_next/static/") || /\.(svg|png|woff2?|css|js)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req)
            .then((res) => {
              const copy = res.clone();
              caches.open(STATIC_CACHE).then((c) => c.put(req, copy));
              return res;
            })
            .catch(() => Response.error()),
      ),
    );
    return;
  }

  // pages: network first so a fix ships immediately, cache as the safety net
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match(SHELL))),
  );
});
