/* ScrapMan — shared location helpers.
   Used by the app (app.js) and by the plain council SEO pages.
   Everything here degrades quietly: geolocation denied, offline, or the
   postcodes.io API being unreachable all just resolve to null rather than throw. */

/* admin_district (postcodes.io) -> ScrapMan council landing page */
const SCRAPMAN_COUNCILS = {
  "Birmingham": "free-scrap-collection-birmingham.html",
  "Coventry": "free-scrap-collection-coventry.html",
  "Dudley": "free-scrap-collection-dudley.html",
  "Sandwell": "free-scrap-collection-sandwell.html",
  "Solihull": "free-scrap-collection-solihull.html",
  "Walsall": "free-scrap-collection-walsall.html",
  "Wolverhampton": "free-scrap-collection-wolverhampton.html"
};

const SCRAPMAN_LOCATION_KEY = "scrapman_user_location";
const SCRAPMAN_LOCATION_MAX_AGE = 24 * 60 * 60 * 1000; // 1 day

function scrapmanHaversine(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function scrapmanSavedLocation() {
  try {
    const loc = JSON.parse(localStorage.getItem(SCRAPMAN_LOCATION_KEY));
    return loc && loc.ts && (Date.now() - loc.ts) < SCRAPMAN_LOCATION_MAX_AGE ? loc : null;
  } catch { return null; }
}

function scrapmanSaveLocation(loc) {
  localStorage.setItem(SCRAPMAN_LOCATION_KEY, JSON.stringify({ ...loc, ts: Date.now() }));
}

function scrapmanLocationFromApiResult(r) {
  if (!r) return null;
  return {
    lat: r.latitude,
    lng: r.longitude,
    postcode: r.postcode,
    outcode: r.outcode,
    council: r.admin_district,
    label: r.admin_ward ? `${r.admin_ward}, ${r.outcode}` : (r.outcode || r.postcode)
  };
}

/* Turn raw lat/lng (eg. from the GPS) into a postcode + council via postcodes.io reverse lookup. */
async function scrapmanReverseGeocode(lat, lng) {
  try {
    const res = await fetch(`https://api.postcodes.io/postcodes?lon=${lng}&lat=${lat}&limit=1`);
    if (!res.ok) return null;
    const data = await res.json();
    const loc = scrapmanLocationFromApiResult(data.result && data.result[0]);
    if (loc) scrapmanSaveLocation(loc);
    return loc;
  } catch { return null; }
}

/* Turn a typed postcode into lat/lng + council. */
async function scrapmanGeocodePostcode(postcode) {
  const clean = String(postcode || "").trim().replace(/\s+/g, "");
  if (!clean) return null;
  try {
    const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(clean)}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== 200 || !data.result) return null;
    const loc = scrapmanLocationFromApiResult(data.result);
    if (loc) scrapmanSaveLocation(loc);
    return loc;
  } catch { return null; }
}

/* Ask the browser for GPS coordinates and resolve them to a location.
   Always resolves (never rejects) — null means denied/unsupported/unavailable. */
function scrapmanRequestGeolocation() {
  return new Promise(resolve => {
    if (!("geolocation" in navigator)) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      async pos => resolve(await scrapmanReverseGeocode(pos.coords.latitude, pos.coords.longitude)),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 10 * 60 * 1000 }
    );
  });
}

/* Silent check — only returns a location if the browser has *already* granted
   geolocation permission, so it never triggers a permission prompt on its own. */
async function scrapmanAutoLocate() {
  const cached = scrapmanSavedLocation();
  if (cached) return cached;
  if (!("permissions" in navigator)) return null;
  try {
    const status = await navigator.permissions.query({ name: "geolocation" });
    if (status.state === "granted") return await scrapmanRequestGeolocation();
  } catch { /* not all browsers support querying geolocation permission */ }
  return null;
}
