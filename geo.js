/* ScrapMan — shared location helpers.
   Used by the app (app.js) and by the plain council SEO pages.
   Everything here degrades quietly: geolocation denied, offline, or the
   postcodes.io API being unreachable all just resolve to null rather than throw. */

/* Swaps the async-loaded Leaflet stylesheet from media="print" (non-render-blocking)
   to "all" once it's actually fetched. Done here instead of an inline onload= attribute
   so the page's CSP can omit script-src 'unsafe-inline'.
   The link is tiny and starts fetching as soon as <head> is parsed, so by the time this
   script (near the end of <body>) runs, it may well have already finished loading —
   in which case the "load" event already fired and a listener alone would miss it
   forever, leaving the map permanently unstyled. `.sheet` is populated once a
   stylesheet has been fetched and parsed regardless of whether its media currently
   matches, so checking it first covers that race. */
(function () {
  var leafletCss = document.getElementById("leafletCssAsync");
  if (!leafletCss) return;
  function activate() { leafletCss.media = "all"; }
  if (leafletCss.sheet) activate();
  else leafletCss.addEventListener("load", activate);
})();

/* Turn a postcodes.io admin_district name (eg. "Bristol, City of", "St Helens")
   into GOV.UK's find-local-council URL slug (eg. "bristol", "st-helens"). GOV.UK
   doesn't expose this as an API — the slug is just their own hyphenated council
   name — so this is a best-effort match rather than a guaranteed one; a handful
   of councils with irregular official spellings can still 404 through to
   GOV.UK's own not-found page rather than a specific result. */
function scrapmanCouncilSlug(council) {
  return String(council || "")
    .split(",")[0] // drop unitary-authority suffixes like ", City of" / ", County of"
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/* Every UK council has a page here — no per-council data to maintain. */
function scrapmanCouncilLink(council) {
  const slug = scrapmanCouncilSlug(council);
  return slug ? `https://www.gov.uk/find-local-council/${slug}` : "https://www.gov.uk/find-local-council";
}

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
