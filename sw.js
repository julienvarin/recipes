// Offline support: serve the app shell from cache, refresh it in the background.
const CACHE = "recipes-v3";
const SHELL = ["./", "index.html", "css/app.css", "js/app.js", "js/db.js", "js/parse.js", "js/ingredients.js", "js/ai.js", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  const sameOrigin = url.origin === self.location.origin;
  const sdk = url.hostname === "cdn.jsdelivr.net";
  if (e.request.method !== "GET" || (!sameOrigin && !sdk)) return;

  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const key = sameOrigin && url.search ? url.pathname : e.request; // share-target opens ./?url=…
      const cached = await cache.match(key);
      const network = fetch(e.request)
        .then((res) => {
          if (res.ok) cache.put(key, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window" }).then((list) => (list[0] ? list[0].focus() : self.clients.openWindow("./"))));
});
