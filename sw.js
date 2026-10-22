/* Service Worker: App offline verfügbar, Updates sofort (Netz zuerst, Cache als Reserve). */
const CACHE = "ast-1.8.2";
const FILES = ["./", "index.html", "style.css?v=1.8.2", "core.js?v=1.8.2", "app.js?v=1.8.2", "data/recipes_all.json", "data/alchemy.json", "data/journals.json", "data/enchant.json",
  "manifest.webmanifest", "icons/icon-64.png", "icons/icon-192.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  // immer frisch vom Server holen, nicht aus dem Browser-Cache
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: "reload" })))));
  self.skipWaiting();
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
    fetch(e.request.url, { cache: "no-cache", credentials: "same-origin" }).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then((m) => m || caches.match("index.html")))
  );
});
