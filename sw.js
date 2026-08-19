const CACHE = "scrapman-v15";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./geo.js",
  "./supabase-config.js",
  "./auth.js",
  "./app.js",
  "./manifest.json",
  "./scrapman-logo-icon-only.svg",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2",
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Space+Grotesk:wght@600;700&display=swap"
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
  // Never cache API calls, Supabase, or map tiles — always go to network, fall back gracefully
  if (url.hostname === "api.postcodes.io" || url.hostname.endsWith("tile.openstreetmap.org") ||
      url.hostname.endsWith(".supabase.co") || url.pathname === "/verify-collector") {
    return; // let the browser handle it normally
  }
  // Network-first for the app shell: whenever you're online you always get the current
  // code (no stale-cache trap after a deploy), and the cache is purely an offline
  // fallback. Cache-first was tried here originally and repeatedly served stale JS
  // after edits during development — network-first with a cache fallback is the safer
  // default for files that change often, vs. content-hashed assets that never do.
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
