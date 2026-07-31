const CACHE = "scrapman-v2";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./icon.svg",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  // Never cache API or map tiles — always go to network, fall back gracefully
  if (url.hostname === "api.postcodes.io" || url.hostname.endsWith("tile.openstreetmap.org")) {
    return; // let the browser handle it normally
  }
  // Cache-first for app shell assets
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
