/* ScrapMan — shared application state and small helpers.
 *
 * Only the state that genuinely crosses module boundaries lives here. Anything a single
 * screen owns (its carousel timer, its current thread id, its map instance) stays local to
 * that screen, which is why this object is deliberately small.
 *
 * `depot` is the collector's working location: seeded with Birmingham, then replaced by
 * geo.js's geolocation/reverse-geocode results. It lives here rather than in the location
 * module because the Jobs list, the route planner and the dashboard all measure from it.
 */

import { createListingsSource, supabaseRowFetcher } from "./data/listings.js";

function loadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}
function saveJSON(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

export const state = {
  depot: { lat: 52.4862, lng: -1.8904, label: "Birmingham" },
  usingDefaultLocation: true,
  locationAttempted: false,
  routeIds: loadJSON("scrapman_route", []),
  activeFilter: "all"
};

/* One listings source for the whole app, so concurrent renders share a single query
   instead of each screen fetching the table for itself. */
export const listings = createListingsSource({
  fetchRows: () => (SCRAPMAN_AUTH_CONFIGURED && scrapmanDb
    ? supabaseRowFetcher(scrapmanDb)()
    : Promise.resolve([]))
});

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

export { loadJSON, saveJSON };

// Real subscription status, fetched server-side and cached on scrapmanSession by
// auth.js — only ever written by the Stripe webhook handler in verify-collector/.
export function isPro() {
  const sub = scrapmanSession && scrapmanSession.proSubscription;
  return !!sub && (sub.status === "active" || sub.status === "trialing");
}

export function getCollector() {
  if (!SCRAPMAN_AUTH_CONFIGURED || !scrapmanSession) return null;
  const cp = scrapmanSession.collectorProfile;
  return cp ? {
    businessName: cp.business_name, carrierRef: cp.carrier_ref, smdCouncil: cp.smd_council,
    smdLicence: cp.smd_licence, status: cp.verification_status,
    eaCarrier: cp.ea_carrier, eaScrapMetalLicence: cp.ea_scrap_metal_licence,
    ratingAvg: cp.rating_avg, ratingCount: cp.rating_count
  } : null;
}

export function isVerified() { return getCollector()?.status === "verified"; }
