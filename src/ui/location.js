import { state } from "../state.js";
import { openSheet, closeSheet } from "./navigation.js";
import { initJobsMap, renderRoute } from "./jobs.js";

/* ---------- distance & geocoding ---------- */
/* geocodePostcode still comes from geo.js; haversine is imported from src/domain/routing.js */
export const geocodePostcode = scrapmanGeocodePostcode;

/* ---------- user location (collector's own position, or a homeowner's council lookup) ---------- */
export function locationLabel() {
  return state.usingDefaultLocation ? `${state.depot.label} (default — set yours)` : state.depot.label;
}

export function applyLocation(loc) {
  state.depot = { lat: loc.lat, lng: loc.lng, label: loc.label, postcode: loc.postcode, council: loc.council };
  state.usingDefaultLocation = false;
}

export function updateLocationUI() {
  document.querySelectorAll(".location-label").forEach(el => { el.textContent = locationLabel(); });
  document.querySelectorAll(".location-row").forEach(el => el.classList.toggle("is-default", state.usingDefaultLocation));
}

/* Called when a collector opens Jobs/Route — resolves a real starting point once per
   session (from cache, or a silent check if permission was already granted), then
   leaves it to the "Change" control after that so we never nag with repeat prompts. */
export async function ensureLocation() {
  if (state.locationAttempted) { updateLocationUI(); return; }
  state.locationAttempted = true;
  const loc = (await scrapmanAutoLocate()) || (await scrapmanRequestGeolocation());
  if (loc) applyLocation(loc);
  updateLocationUI();
}

export async function setLocationFromGPS() {
  const btn = document.getElementById("useGpsBtn");
  btn.disabled = true;
  btn.textContent = "Finding you…";
  const loc = await scrapmanRequestGeolocation();
  btn.disabled = false;
  btn.textContent = "Use my current location";
  if (!loc) { alert("Couldn't get your location — check location permissions, or enter a postcode below."); return; }
  applyLocation(loc);
  updateLocationUI();
  closeSheet();
  refreshLocationDependentScreens();
}

document.getElementById("useGpsBtn").addEventListener("click", setLocationFromGPS);

document.getElementById("setLocationBtn").addEventListener("click", async () => {
  const input = document.getElementById("locationPostcode");
  const btn = document.getElementById("setLocationBtn");
  btn.disabled = true;
  btn.textContent = "Finding…";
  const loc = await scrapmanGeocodePostcode(input.value);
  btn.disabled = false;
  btn.textContent = "Set location";
  if (!loc) { input.setCustomValidity("We couldn't find that postcode."); input.reportValidity(); return; }
  input.setCustomValidity("");
  applyLocation(loc);
  updateLocationUI();
  input.value = "";
  closeSheet();
  refreshLocationDependentScreens();
});

document.querySelectorAll(".location-change").forEach(btn => {
  btn.addEventListener("click", () => openSheet("overlay-location"));
});

export function refreshLocationDependentScreens() {
  if (document.getElementById("screen-jobs").classList.contains("active")) initJobsMap();
  if (document.getElementById("screen-route").classList.contains("active")) renderRoute();
}

/* Account screen: point the council-charges link at the homeowner's own council when
   we already know it (never forces a permission prompt on its own). */
export async function personalizeCouncilLink() {
  const accLinkEl = document.getElementById("accCouncilLink");
  if (!accLinkEl) return;
  const loc = scrapmanSavedLocation() || await scrapmanAutoLocate();
  if (!loc || !loc.council) return;
  accLinkEl.href = scrapmanCouncilLink(loc.council);
  document.getElementById("accCouncilSub").textContent = `${loc.council}'s bulky waste charges`;
}

