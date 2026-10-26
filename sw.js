// Offline support. The app shell is fetched network-first (so an update is never mixed with
// stale files) and falls back to the cache when offline.
const CACHE = "recipes-v9";
const SHELL = ["./", "index.html", "css/app.css", "js/app.js", "js/db.js", "js/parse.js", "js/ingredients.js", "js/ai.js", "js/sync.js", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png"];

self.addEventListener("install", (e) => {
  // cache: "reload" skips the browser's HTTP cache, so every file comes from the same deploy.
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;

  if (url.origin === self.location.origin) {
    const key = url.search ? url.pathname : e.request; // share-target opens ./?url=…
    e.respondWith(
      fetch(e.request, { cache: "no-cache" })
        .then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put(key, res.clone()));
          return res;
        })
        .catch(() => caches.match(key).then((hit) => hit || caches.match("./")))
    );
    return;
  }

  // The pinned AI SDK from the CDN never changes: cache first.
  if (url.hostname === "cdn.jsdelivr.net") {
    e.respondWith(
      caches.match(e.request).then(
        (hit) =>
          hit ||
          fetch(e.request).then((res) => {
            if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
            return res;
          })
      )
    );
  }
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window" }).then((list) => (list[0] ? list[0].focus() : self.clients.openWindow("./"))));
});
