import { esc, getCollector, loadJSON, saveJSON } from "../state.js";
import { AVG_MILES_SAVED_PER_CLUSTERED_JOB, BRASS_FRACTION_OF_COPPER, CO2_KG_PER_MILE, FUEL_PRICE_PER_LITRE, MATERIAL_FEED_ENDPOINT, MATERIAL_PRICES_CACHE_KEY, MATERIAL_PRICES_MAX_AGE, SCRAP_YARD_DISCOUNT, STATIC_MATERIAL_RATES, STEEL_GUIDE_RATE_PER_KG, VAN_MPG, WEIGHT_BAND_KG } from "../domain/rates.js";
import { TYPE_ICON } from "../domain/labels.js";

/* ---------- collector dashboard (Home screen, collector role) ---------- */

export async function fetchMetalPrices() {
  const cached = loadJSON(MATERIAL_PRICES_CACHE_KEY, null);
  if (cached && cached.ts && (Date.now() - cached.ts) < MATERIAL_PRICES_MAX_AGE) return cached.feed;

  try {
    const res = await fetch(`${MATERIAL_FEED_ENDPOINT}/metal-prices`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const feed = await res.json();
    if (feed.live) saveJSON(MATERIAL_PRICES_CACHE_KEY, { feed, ts: Date.now() });
    return feed;
  } catch {
    return { live: false, fetchedAt: null, rates: STATIC_MATERIAL_RATES };
  }
}

// Brass and steel aren't LME-traded, so they're always shown as estimates — everything
// else is only an estimate when the live feed couldn't be reached (see fetchMetalPrices).
export function buildMaterialRateTable(feed) {
  const r = feed.rates || STATIC_MATERIAL_RATES;
  const copper = r.copper ?? STATIC_MATERIAL_RATES.copper;
  return [
    { key: "copper", label: "Copper", ratePerKg: copper, estimated: !feed.live },
    { key: "brass", label: "Brass", ratePerKg: copper * BRASS_FRACTION_OF_COPPER, estimated: true },
    { key: "steel", label: "Heavy Steel", ratePerKg: STEEL_GUIDE_RATE_PER_KG, estimated: true },
    { key: "aluminum", label: "Aluminium", ratePerKg: r.aluminum ?? STATIC_MATERIAL_RATES.aluminum, estimated: !feed.live },
    { key: "zinc", label: "Zinc", ratePerKg: r.zinc ?? STATIC_MATERIAL_RATES.zinc, estimated: !feed.live },
    { key: "lead", label: "Lead", ratePerKg: r.lead ?? STATIC_MATERIAL_RATES.lead, estimated: !feed.live }
  ];
}

export function renderMaterialFeed(feed) {
  const table = buildMaterialRateTable(feed);
  document.getElementById("materialFeed").innerHTML = table.map(m => `
    <div class="material-tile ${m.estimated ? "estimated" : ""}">
      <strong>&pound;${m.ratePerKg.toFixed(2)}/kg</strong>
      <span class="material-name">${esc(m.label)}${m.estimated ? " (est.)" : ""}</span>
    </div>
  `).join("");
  document.getElementById("materialFeedUpdated").textContent = feed.live
    ? `LME spot &middot; ${new Date(feed.fetchedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
    : "Guide rates — live feed unavailable";
  return table;
}

export function rateForMetalType(type, table) {
  const rate = key => { const m = table.find(x => x.key === key); return m ? m.ratePerKg : 0; };
  if (type === "nonferrous") return rate("copper");
  if (type === "ferrous" || type === "appliance") return rate("steel");
  return (rate("copper") + rate("steel")) / 2; // mixed / unknown
}

export async function fetchCollectorJobHistory() {
  const empty = { all: [], today: 0, thisWeek: 0, thisMonth: 0, lifetime: 0, recent: [] };
  if (!SCRAPMAN_AUTH_CONFIGURED || !scrapmanSession) return empty;
  const { data, error } = await scrapmanDb
    .from("job_assignments")
    .select("updated_at, listings(title, address, metal_type, weight_band)")
    .eq("collector_id", scrapmanSession.user.id)
    .eq("status", "completed")
    .order("updated_at", { ascending: false });
  if (error) { console.error(error); return empty; }
  const all = data || [];

  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const startOfWeek = new Date(now);
  const mondayOffset = (startOfWeek.getDay() + 6) % 7; // getDay(): Sun=0 ... Sat=6 -> Monday-indexed
  startOfWeek.setHours(0, 0, 0, 0);
  startOfWeek.setDate(startOfWeek.getDate() - mondayOffset);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  return {
    all,
    lifetime: all.length,
    today: all.filter(a => new Date(a.updated_at) >= startOfDay).length,
    thisWeek: all.filter(a => new Date(a.updated_at) >= startOfWeek).length,
    thisMonth: all.filter(a => new Date(a.updated_at) >= startOfMonth).length,
    recent: all.slice(0, 5)
  };
}

export function renderJobHistoryUI(history) {
  const c = getCollector();
  document.getElementById("collectorRatingBadge").innerHTML = c && c.ratingCount
    ? `&#9733; ${Number(c.ratingAvg).toFixed(1)} &middot; ${c.ratingCount} review${c.ratingCount === 1 ? "" : "s"}`
    : "No ratings yet";
  document.getElementById("jobHistoryStats").innerHTML = `
    <div class="stat-box"><strong>${history.today}</strong><span>Today</span></div>
    <div class="stat-box"><strong>${history.thisWeek}</strong><span>This week</span></div>
    <div class="stat-box"><strong>${history.thisMonth}</strong><span>This month</span></div>
    <div class="stat-box save"><strong>${history.lifetime}</strong><span>All time</span></div>
  `;
  document.getElementById("jobHistoryList").innerHTML = history.recent.length
    ? history.recent.map(r => {
        const l = r.listings || {};
        return `
          <div class="job-card">
            <span class="job-icon" aria-hidden="true">${TYPE_ICON[l.metal_type] || TYPE_ICON.mixed}</span>
            <div class="job-body">
              <h4>${esc(l.title || "Collection")}</h4>
              <p class="job-meta">${esc(l.address || "")} &middot; collected ${new Date(r.updated_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</p>
            </div>
          </div>`;
      }).join("")
    : `<p class="job-meta">No completed collections yet — they'll show up here once you mark a job collected.</p>`;
}

// Fuel/CO2/revenue are all estimates — see the assumptions block near the top of this
// file. mpg here means UK imperial miles-per-gallon (4.546 L/gal), matching everything
// else in this app (£, UK postcodes, UK councils).
export function renderRoiTracker(history, table) {
  const milesSaved = history.lifetime * AVG_MILES_SAVED_PER_CLUSTERED_JOB;
  const fuelSaved = (milesSaved / VAN_MPG) * 4.546 * FUEL_PRICE_PER_LITRE;
  const co2SavedKg = milesSaved * CO2_KG_PER_MILE;

  const revenue = history.all.reduce((sum, a) => {
    const l = a.listings || {};
    const kg = WEIGHT_BAND_KG[l.weight_band] || WEIGHT_BAND_KG.medium;
    const rate = rateForMetalType(l.metal_type, table) * (1 - SCRAP_YARD_DISCOUNT);
    return sum + kg * rate;
  }, 0);

  document.getElementById("roiStats").innerHTML = `
    <div class="stat-box save"><strong>&pound;${fuelSaved.toFixed(0)}</strong><span>Fuel saved</span></div>
    <div class="stat-box save"><strong>&pound;${revenue.toFixed(0)}</strong><span>Revenue earned</span></div>
    <div class="stat-box save"><strong>${co2SavedKg.toFixed(0)} kg</strong><span>CO&#8322; saved</span></div>
  `;
}

export let currentMaterialTable = [];

export function populateCalculatorMaterials(table) {
  const select = document.getElementById("calcMaterial");
  const prevValue = select.value;
  select.innerHTML = table.map(m => `<option value="${m.key}">${esc(m.label)}${m.estimated ? " (est.)" : ""}</option>`).join("");
  if (table.some(m => m.key === prevValue)) select.value = prevValue;
}

export function recalcScrapCalculator(table) {
  const weight = parseFloat(document.getElementById("calcWeight").value) || 0;
  const material = table.find(m => m.key === document.getElementById("calcMaterial").value) || table[0];
  const offer = material ? weight * material.ratePerKg * (1 - SCRAP_YARD_DISCOUNT) : 0;
  document.getElementById("calcResult").textContent = `Estimated offer: £${offer.toFixed(2)}`;
}

/* These two survive re-renders the same way jobList's delegated listener does (see
   above) — attached once here rather than re-attached every renderCollectorDashboard(). */
document.getElementById("calcWeight").addEventListener("input", () => recalcScrapCalculator(currentMaterialTable));
document.getElementById("calcMaterial").addEventListener("change", () => recalcScrapCalculator(currentMaterialTable));

// Compliance status used to have its own card here too — removed in favour of the
// Account screen's accVerify card (renderAccount()), which already shows the same
// verified/not-verified status, business name, carrier reg, and SMD licence details,
// so collectors now see it in one place instead of two slightly different copies.
export async function renderCollectorDashboard() {
  const [feed, history] = await Promise.all([fetchMetalPrices(), fetchCollectorJobHistory()]);
  currentMaterialTable = renderMaterialFeed(feed);
  populateCalculatorMaterials(currentMaterialTable);
  recalcScrapCalculator(currentMaterialTable);

  renderJobHistoryUI(history);
  renderRoiTracker(history, currentMaterialTable);
}

