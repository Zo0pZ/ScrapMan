/* ScrapMan prototype — mock data + local logic only, no backend */

const DEPOT = { lat: 52.4862, lng: -1.8904, label: "Your start point (Birmingham)" };

const MOCK_JOBS = [
  { id: 1, title: "Old washing machine", type: "appliance", weight: "medium", lat: 52.4780, lng: -1.9025, address: "Edgbaston, B15", urgency: "today" },
  { id: 2, title: "Copper pipe offcuts", type: "nonferrous", weight: "small", lat: 52.4915, lng: -1.9200, address: "Ladywood, B16", urgency: "week" },
  { id: 3, title: "Steel garden gate + railings", type: "ferrous", weight: "medium", lat: 52.4700, lng: -1.8800, address: "Moseley, B13", urgency: "norush" },
  { id: 4, title: "Dead car battery x4", type: "nonferrous", weight: "small", lat: 52.5010, lng: -1.8700, address: "Aston, B6", urgency: "today" },
  { id: 5, title: "Fridge freezer, cooker, dishwasher", type: "appliance", weight: "large", lat: 52.4550, lng: -1.9300, address: "Selly Oak, B29", urgency: "week" },
  { id: 6, title: "Scaffold poles, mixed lengths", type: "ferrous", weight: "large", lat: 52.4990, lng: -1.9100, address: "Hockley, B18", urgency: "norush" },
  { id: 7, title: "Brass fittings, old radiators", type: "nonferrous", weight: "medium", lat: 52.4650, lng: -1.8600, address: "Sparkbrook, B11", urgency: "today" },
  { id: 8, title: "Skip-load mixed metal, house clearance", type: "ferrous", weight: "large", lat: 52.5100, lng: -1.9350, address: "Handsworth, B21", urgency: "week" }
];

const WEIGHT_LABEL = { small: "Car boot", medium: "Trailer load", large: "Skip load" };
const URGENCY_LABEL = { today: "Today", week: "This week", norush: "No rush" };
const TYPE_LABEL = { ferrous: "Ferrous", nonferrous: "Non-ferrous", appliance: "Appliance", mixed: "Mixed" };
const TYPE_ICON = {
  ferrous: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h10"/></svg>',
  nonferrous: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2-2 2.6-2.6Z"/></svg>',
  appliance: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="2"/><line x1="5" y1="9" x2="19" y2="9"/><circle cx="9" cy="6" r="0.6" fill="currentColor" stroke="none"/></svg>',
  mixed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="10" width="9" height="9" rx="1.5"/><circle cx="16.5" cy="9.5" r="5"/></svg>'
};

let routeIds = JSON.parse(localStorage.getItem("scrapman_route") || "[]");
let activeFilter = "all";
let jobsMap, routeMap;

/* ---------- navigation ---------- */
function goTo(screen) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById("screen-" + screen).classList.add("active");
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.nav === screen));
  if (screen === "jobs") setTimeout(initJobsMap, 0);
  if (screen === "route") setTimeout(renderRoute, 0);
}

document.querySelectorAll("[data-nav]").forEach(el => {
  el.addEventListener("click", () => goTo(el.dataset.nav));
});

/* ---------- distance ---------- */
function haversine(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/* ---------- geocoding (postcodes.io, free, no key) ---------- */
async function geocodePostcode(postcode) {
  const clean = postcode.trim().replace(/\s+/g, "");
  if (!clean) return null;
  try {
    const res = await fetch(
      `https://api.postcodes.io/postcodes/${encodeURIComponent(clean)}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== 200 || !data.result) return null;
    return { lat: data.result.latitude, lng: data.result.longitude };
  } catch {
    return null;
  }
}

/* ---------- jobs screen ---------- */
function getAllJobs() {
  const extra = JSON.parse(localStorage.getItem("scrapman_listings") || "[]");
  return MOCK_JOBS.concat(extra);
}

function renderJobs() {
  const list = document.getElementById("jobList");
  const jobs = getAllJobs()
    .filter(j => activeFilter === "all" || j.type === activeFilter)
    .map(j => ({ ...j, dist: haversine(DEPOT, j) }))
    .sort((a, b) => a.dist - b.dist);

  list.innerHTML = jobs.map(j => `
    <div class="job-card">
      <span class="job-icon" aria-hidden="true">${TYPE_ICON[j.type] || TYPE_ICON.mixed}</span>
      <div class="job-body">
        <h4>${j.title}</h4>
        <p class="job-meta">${j.address} &middot; ${j.dist.toFixed(1)} mi away</p>
        <div class="job-tags">
          <span class="tag">${TYPE_LABEL[j.type] || j.type}</span>
          <span class="tag">${WEIGHT_LABEL[j.weight] || j.weight}</span>
          ${j.urgency === "today" ? '<span class="tag urgent">Wanted today</span>' : ""}
        </div>
        <button class="add-btn ${routeIds.includes(j.id) ? "added" : ""}" data-id="${j.id}">
          ${routeIds.includes(j.id) ? "Added ✓" : "Add to route"}
        </button>
      </div>
    </div>
  `).join("");

  list.querySelectorAll(".add-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.id);
      if (routeIds.includes(id)) {
        routeIds = routeIds.filter(x => x !== id);
      } else {
        routeIds.push(id);
      }
      localStorage.setItem("scrapman_route", JSON.stringify(routeIds));
      renderJobs();
      initJobsMap();
    });
  });
}

document.getElementById("filterRow").addEventListener("click", e => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  document.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
  chip.classList.add("active");
  activeFilter = chip.dataset.filter;
  renderJobs();
});

function initJobsMap() {
  const el = document.getElementById("jobsMap");
  if (!el || el.offsetParent === null) return;
  if (jobsMap) { jobsMap.remove(); jobsMap = null; }
  jobsMap = L.map("jobsMap", { zoomControl: false, attributionControl: false }).setView([DEPOT.lat, DEPOT.lng], 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(jobsMap);
  L.marker([DEPOT.lat, DEPOT.lng]).addTo(jobsMap).bindPopup("You are here");
  getAllJobs().filter(j => activeFilter === "all" || j.type === activeFilter).forEach(j => {
    const marker = L.circleMarker([j.lat, j.lng], {
      radius: 8,
      color: routeIds.includes(j.id) ? "#1e293b" : "#059669",
      fillColor: routeIds.includes(j.id) ? "#334155" : "#059669",
      fillOpacity: 0.9,
      weight: 2
    }).addTo(jobsMap);
    marker.bindPopup(j.title);
  });
  renderJobs();
}

/* ---------- route planner ---------- */
function nearestNeighborRoute(jobs) {
  const remaining = [...jobs];
  const order = [];
  let current = DEPOT;
  while (remaining.length) {
    let bestIdx = 0, bestDist = Infinity;
    remaining.forEach((j, i) => {
      const d = haversine(current, j);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    });
    const next = remaining.splice(bestIdx, 1)[0];
    order.push({ ...next, legDist: bestDist });
    current = next;
  }
  return order;
}

function renderRoute() {
  const jobs = getAllJobs().filter(j => routeIds.includes(j.id));
  const emptyEl = document.getElementById("routeEmpty");
  const contentEl = document.getElementById("routeContent");

  if (!jobs.length) {
    emptyEl.classList.remove("hidden");
    contentEl.classList.add("hidden");
    return;
  }
  emptyEl.classList.add("hidden");
  contentEl.classList.remove("hidden");

  const ordered = nearestNeighborRoute(jobs);
  const totalDist = ordered.reduce((sum, j) => sum + j.legDist, 0);

  // naive "as listed" order, for comparison
  let naiveDist = 0, cur = DEPOT;
  jobs.forEach(j => { naiveDist += haversine(cur, j); cur = j; });

  const avgSpeedMph = 25;
  const driveMinutes = (totalDist / avgSpeedMph) * 60;
  const stopMinutes = ordered.length * 8;
  const totalMinutes = Math.round(driveMinutes + stopMinutes);
  const savedMinutes = Math.max(0, Math.round(((naiveDist - totalDist) / avgSpeedMph) * 60));

  document.getElementById("routeStats").innerHTML = `
    <div class="stat-box"><strong>${ordered.length}</strong><span>Stops</span></div>
    <div class="stat-box"><strong>${totalDist.toFixed(1)} mi</strong><span>Total drive</span></div>
    <div class="stat-box save"><strong>${totalMinutes} min</strong><span>Est. time</span></div>
  `;

  document.getElementById("routeList").innerHTML = ordered.map((j, i) => `
    <li>
      <span class="stop-num">${i + 1}</span>
      <div class="stop-body">
        <h4>${j.title}</h4>
        <span>${j.address} &middot; +${j.legDist.toFixed(1)} mi</span>
      </div>
    </li>
  `).join("") + (savedMinutes > 5 ? `
    <div class="upsell">
      <p>Optimised ordering saves you <strong>~${savedMinutes} minutes</strong> vs collecting in the order jobs came in.</p>
    </div>
  ` : "");

  const el = document.getElementById("routeMap");
  if (routeMap) { routeMap.remove(); routeMap = null; }
  routeMap = L.map("routeMap", { zoomControl: false, attributionControl: false }).setView([DEPOT.lat, DEPOT.lng], 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(routeMap);
  L.marker([DEPOT.lat, DEPOT.lng]).addTo(routeMap).bindPopup("Start");
  const latlngs = [[DEPOT.lat, DEPOT.lng]];
  ordered.forEach((j, i) => {
    L.circleMarker([j.lat, j.lng], { radius: 9, color: "#1e293b", fillColor: "#059669", fillOpacity: 1, weight: 2 })
      .addTo(routeMap)
      .bindTooltip(String(i + 1), { permanent: true, direction: "center", className: "route-num-tip" });
    latlngs.push([j.lat, j.lng]);
  });
  L.polyline(latlngs, { color: "#059669", weight: 3, dashArray: "6 6" }).addTo(routeMap);
  routeMap.fitBounds(latlngs, { padding: [24, 24] });
}

/* ---------- list scrap form ---------- */
let selectedWeight = "";
const PHOTO_PLACEHOLDER = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8a2 2 0 0 1 2-2h1.2l.9-1.5A2 2 0 0 1 9.8 3.5h4.4a2 2 0 0 1 1.7 1l.9 1.5H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Z"/><circle cx="12" cy="13" r="3.5"/></svg>
  <span>Tap to add a photo</span>
`;

document.getElementById("photoPreview").addEventListener("click", () => {
  document.getElementById("photoInput").click();
});
document.getElementById("photoInput").addEventListener("change", e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const preview = document.getElementById("photoPreview");
    preview.style.backgroundImage = `url(${reader.result})`;
    preview.innerHTML = "";
  };
  reader.readAsDataURL(file);
});

document.getElementById("weightGroup").addEventListener("click", e => {
  const pill = e.target.closest(".pill");
  if (!pill) return;
  document.querySelectorAll("#weightGroup .pill").forEach(p => p.classList.remove("active"));
  pill.classList.add("active");
  selectedWeight = pill.dataset.weight;
});

document.getElementById("postcode").addEventListener("input", () => {
  document.getElementById("postcode").setCustomValidity("");
});

document.getElementById("listForm").addEventListener("submit", async e => {
  e.preventDefault();

  const submitBtn = e.target.querySelector('button[type="submit"]');
  const postcodeInput = document.getElementById("postcode");
  submitBtn.disabled = true;
  submitBtn.textContent = "Finding your location…";

  const coords = await geocodePostcode(postcodeInput.value);

  submitBtn.disabled = false;
  submitBtn.textContent = "List it — free";

  if (!coords) {
    postcodeInput.setCustomValidity("We couldn't find that postcode — please check it.");
    postcodeInput.reportValidity();
    return;
  }
  postcodeInput.setCustomValidity("");

  const listings = JSON.parse(localStorage.getItem("scrapman_listings") || "[]");
  const newListing = {
    id: 1000 + listings.length,
    title: document.getElementById("itemTitle").value,
    type: document.getElementById("metalType").value || "mixed",
    weight: selectedWeight || "small",
    lat: coords.lat,
    lng: coords.lng,
    address: postcodeInput.value.toUpperCase(),
    urgency: document.getElementById("urgency").value
  };
  listings.push(newListing);
  localStorage.setItem("scrapman_listings", JSON.stringify(listings));

  e.target.reset();
  document.getElementById("photoPreview").style.backgroundImage = "";
  document.getElementById("photoPreview").innerHTML = PHOTO_PLACEHOLDER;
  document.querySelectorAll("#weightGroup .pill").forEach(p => p.classList.remove("active"));
  selectedWeight = "";
  goTo("confirm");
});

/* ---------- init ---------- */
renderJobs();

/* ---------- PWA service worker ---------- */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
