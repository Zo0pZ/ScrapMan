/* ScrapMan — guide-rate and estimate assumptions.
 *
 * Extracted verbatim from app.js so the numbers that drive the collector dashboard and
 * the homeowner impact counters live in one documented place instead of being scattered
 * through a 1685-line script. Every value here is a clearly-labelled estimate, not a
 * measured per-job figure — the app does not record actual collected weight, fuel spend
 * or per-trip mileage.
 */

/* ---------- collector dashboard assumptions ---------- */
export const SCRAP_YARD_DISCOUNT = 0.35;        // guide price = LME spot x (1 - this); yards typically pay 20-50% below spot
export const WEIGHT_BAND_KG = { small: 15, medium: 60, large: 150 }; // rough midpoints for "car boot / trailer load / skip load"
export const AVG_MILES_SAVED_PER_CLUSTERED_JOB = 1.8; // typical saving the route optimiser finds vs point-to-point
export const VAN_MPG = 28;
export const FUEL_PRICE_PER_LITRE = 1.48;
export const CO2_KG_PER_MILE = 0.25; // light commercial van, UK average
export const BRASS_FRACTION_OF_COPPER = 0.72; // brass scrap isn't LME-traded; priced as a share of copper's value
export const STEEL_GUIDE_RATE_PER_KG = 0.15;  // steel scrap isn't LME-traded either; flat local guide rate

/* ---------- homeowner impact counter assumptions ---------- */
export const TIME_SAVED_MINUTES_PER_COLLECTION = 45; // avoiding a round trip to the local tip/recycling centre
export const AVG_TIP_RUN_MILES = 6;                  // typical round-trip mileage to a local tip
export const CAR_MPG = 45;                           // average UK petrol/diesel car, not VAN_MPG (that's for a collector's van)
export const IMPACT_TIER_KG = [ // "recycled material score" — simple weight-diverted tiers, low to high
  { kg: 200, label: "Gold" },
  { kg: 50, label: "Silver" },
  { kg: 0, label: "Bronze" }
];

/* ---------- metal price feed ---------- */
export const MATERIAL_FEED_ENDPOINT = "/verify-collector";
export const MATERIAL_PRICES_CACHE_KEY = "scrapman_metal_prices";
export const MATERIAL_PRICES_MAX_AGE = 24 * 60 * 60 * 1000; // 1 day, matches the server's own cache window

// Fallback guide rates (GBP/kg) used only if the live feed can't be reached at all.
export const STATIC_MATERIAL_RATES = { copper: 6.20, aluminum: 1.55, zinc: 2.10, lead: 1.75 };

/**
 * Which impact tier a weight-diverted total falls into.
 * @param {number} kg
 * @returns {string}
 */
export function impactTierLabel(kg) {
  const tier = IMPACT_TIER_KG.find(t => kg >= t.kg);
  return tier ? tier.label : IMPACT_TIER_KG[IMPACT_TIER_KG.length - 1].label;
}

/**
 * Guide price per kg for a metal type, from a live feed table with a static fallback.
 * Brass and steel aren't LME-traded, so they're derived from copper/steel guide rates.
 * @param {string} type
 * @param {Record<string, number>} table
 * @returns {number}
 */
export function rateForMetalType(type, table) {
  const rates = table || STATIC_MATERIAL_RATES;
  if (type === "ferrous") return STEEL_GUIDE_RATE_PER_KG;
  if (type === "nonferrous") return rates.copper ?? STATIC_MATERIAL_RATES.copper;
  if (type === "appliance") return STEEL_GUIDE_RATE_PER_KG * 0.8; // appliances are mostly steel with some copper content
  // "mixed" — a blend of copper and brass, the most common homeowner load
  const copper = rates.copper ?? STATIC_MATERIAL_RATES.copper;
  return copper * (1 - BRASS_FRACTION_OF_COPPER) + copper * BRASS_FRACTION_OF_COPPER;
}
