/* Service Worker: App offline verfügbar, Updates sofort (Netz zuerst, Cache als Reserve). */
const CACHE = "ast-1.4.0";
const FILES = ["./", "index.html", "style.css", "core.js", "app.js", "data/recipes_all.json", "data/alchemy.json",
  "manifest.webmanifest", "icons/icon-64.png", "icons/icon-192.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("message", (e) => { if (e.data === "skip") self.skipWaiting(); });
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return; // Preis-API direkt
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request).then((m) => m || caches.match("index.html")))
  );
});
