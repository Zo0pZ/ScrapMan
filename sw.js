const CACHE = "scrapman-v21";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./geo.js",
  "./supabase-config.js",
  "./auth.js",
  "./src/main.js",
  "./src/state.js",
  "./src/domain/labels.js",
  "./src/domain/rates.js",
  "./src/domain/routing.js",
  "./src/data/listings.js",
  "./src/ui/account.js",
  "./src/ui/auth.js",
  "./src/ui/collector.js",
  "./src/ui/homeowner.js",
  "./src/ui/jobs.js",
  "./src/ui/listScrap.js",
  "./src/ui/location.js",
  "./src/domain/badges.js",
  "./src/domain/transferNote.js",
  "./src/ui/messaging.js",
  "./src/ui/notifications.js",
  "./src/ui/proofs.js",
  "./src/ui/navigation.js",
  "./src/ui/payments.js",
  "./src/ui/verification.js",
  "./manifest.json",
  "./scrapman-logo-icon-only.svg",
  "./scrapman-logo-icon-only-mark.svg",
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
  // "reload" forces this fetch past the browser's own HTTP cache — without it, network-first
  // can still be silently satisfied by a stale cached response, defeating the point.
  e.respondWith(
    fetch(e.request, { cache: "reload" })
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

/* ---------- web push ----------
 *
 * Push is deliberately additive. The in-app feed is driven by rows in the `notifications`
 * table, so alerts still work with no push subscription at all (permission denied, iOS
 * Safari, a browser that never asked). This handler only paints the system notification;
 * clicking it focuses an existing window and lets notifications.js decide where to go.
 */
self.addEventListener("push", event => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // A push that isn't JSON still deserves a notification rather than a silent failure.
    payload = { body: event.data ? event.data.text() : "" };
  }
  const title = payload.title || "ScrapMan";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "You have a new update.",
      icon: "./scrapman-logo-icon-only.svg",
      badge: "./scrapman-logo-icon-only-mark.svg",
      // tag collapses repeats of the same event instead of stacking them.
      tag: payload.tag || "scrapman",
      data: { href: payload.href || "./" }
    })
  );
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const href = (event.notification.data && event.notification.data.href) || "./";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(clients => {
      for (const client of clients) {
        if ("focus" in client) {
          // Hand the destination to the already-running app, then raise that window —
          // avoids a second cold start and keeps the app's own router in charge.
          client.postMessage({ type: "scrapman:open", href });
          return client.focus();
        }
      }
      return self.clients.openWindow(href);
    })
  );
});
