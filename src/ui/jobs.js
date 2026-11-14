import { state, esc, listings, saveJSON } from "../state.js";
import { WEIGHT_LABEL, TYPE_LABEL, TYPE_ICON } from "../domain/labels.js";
import { haversine, nearestNeighborRoute } from "../domain/routing.js";
import { locationLabel } from "./location.js";
import { openThread } from "./messaging.js";
import { startUnlock } from "./payments.js";

let jobsMap, routeMap;

/* ---------- jobs screen ---------- */

/* ---------- accept & track a job (Supabase-only — no demo-mode equivalent) ---------- */
export async function acceptJob(id) {
  if (!SCRAPMAN_AUTH_CONFIGURED || !scrapmanSession) return;
  const { data, error } = await scrapmanDb
    .from("job_assignments")
    .insert({ listing_id: id, collector_id: scrapmanSession.user.id, status: "en_route" })
    .select().single();
  if (error) { alert("Couldn't accept this job — it may have just been taken by someone else."); return; }
  scrapmanStartBroadcastingLocation(data.id);
  alert("Job accepted — the homeowner can now see you on the way. Keep this tab open while you're en route so your location keeps sharing.");
  await Promise.all([renderJobs(), renderActiveAssignment()]);
}

export async function renderActiveAssignment() {
  const el = document.getElementById("activeAssignmentCard");
  if (!el) return;
  if (!SCRAPMAN_AUTH_CONFIGURED || !scrapmanSession || scrapmanRole() !== "collector") {
    el.classList.add("hidden");
    return;
  }
  const { data } = await scrapmanDb
    .from("job_assignments")
    .select("*, listings(title)")
    .eq("collector_id", scrapmanSession.user.id)
    .in("status", ["accepted", "en_route", "arrived", "weighed"])
    .limit(1);
  const active = data && data[0];
  if (!active) { el.classList.add("hidden"); scrapmanStopBroadcastingLocation(); return; }

  el.classList.remove("hidden");
  el.innerHTML = `
    <div class="toggle-row">
      <div><strong>${esc(active.listings.title)}</strong><span>Status: ${esc(active.status.replace("_", " "))} &middot; sharing your location live</span></div>
      <div style="display:flex;gap:8px">
        <button class="add-btn" id="messageCollectionBtn">Message</button>
        <button class="add-btn" id="completeAssignmentBtn">Mark collected</button>
      </div>
    </div>`;
  document.getElementById("messageCollectionBtn").addEventListener("click", () => openThread(active.id));
  document.getElementById("completeAssignmentBtn").addEventListener("click", async () => {
    await scrapmanDb.from("job_assignments").update({ status: "completed" }).eq("id", active.id);
    scrapmanStopBroadcastingLocation();
    renderActiveAssignment();
  });
  // Resumes sharing after a page reload mid-collection — harmless to call again if already running.
  scrapmanStartBroadcastingLocation(active.id);
}

export async function renderTrack() {
  const emptyEl = document.getElementById("trackEmpty");
  const contentEl = document.getElementById("trackContent");
  scrapmanUnsubscribeFromLocation();
  if (!SCRAPMAN_AUTH_CONFIGURED || !scrapmanSession) {
    emptyEl.classList.remove("hidden");
    contentEl.classList.add("hidden");
    return;
  }
  const { data } = await scrapmanDb
    .from("job_assignments")
    .select("*, listings(*)")
    .in("status", ["accepted", "en_route", "arrived", "weighed"])
    .order("accepted_at", { ascending: false })
    .limit(1);
  const active = data && data[0];
  if (!active) {
    emptyEl.classList.remove("hidden");
    contentEl.classList.add("hidden");
    return;
  }
  emptyEl.classList.add("hidden");
  contentEl.classList.remove("hidden");

  const { data: collectorProfile } = await scrapmanDb.from("profiles").select("display_name").eq("id", active.collector_id).single();
  const { data: collectorRating } = await scrapmanDb.from("collector_profiles").select("rating_avg").eq("profile_id", active.collector_id).single();

  document.getElementById("trackCollectorCard").innerHTML = `
    <div class="toggle-row">
      <div><strong>${esc((collectorProfile && collectorProfile.display_name) || "Your collector")}</strong>
        <span>${esc(active.listings.title)} &middot; status: ${esc(active.status.replace("_", " "))}</span></div>
      <div style="display:flex;align-items:center;gap:8px">
        ${collectorRating && collectorRating.rating_avg ? `<span class="badge-verified">★ ${esc(collectorRating.rating_avg)}</span>` : ""}
        <button class="add-btn" id="trackMessageBtn">Message</button>
      </div>
    </div>`;
  document.getElementById("trackMessageBtn").addEventListener("click", () => openThread(active.id));

  const mapEl = document.getElementById("trackMap");
  let trackMap = null;
  if (typeof L !== "undefined" && mapEl) {
    trackMap = L.map("trackMap", { zoomControl: false, attributionControl: false }).setView([active.listings.lat, active.listings.lng], 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(trackMap);
    L.marker([active.listings.lat, active.listings.lng]).addTo(trackMap).bindPopup("Collection address");
  }

  let collectorMarker = null;
  scrapmanSubscribeToLocation(active.id, pos => {
    if (!trackMap) return;
    if (!collectorMarker) collectorMarker = L.marker([pos.lat, pos.lng]).addTo(trackMap).bindPopup("Your collector");
    else collectorMarker.setLatLng([pos.lat, pos.lng]);
    trackMap.panTo([pos.lat, pos.lng]);
  });
}


export function contactBlockHTML(j) {
  if (!j.contactName && !j.contactPhone) {
    return `<div class="contact-block"><p class="contact-missing">Contact details weren't provided for this listing.</p></div>`;
  }
  return `
    <div class="contact-block">
      <strong>${esc(j.contactName || "Homeowner")}</strong>
      ${j.contactPhone ? `<a href="tel:${esc(j.contactPhone.replace(/\s/g, ""))}">${esc(j.contactPhone)}</a>` : ""}
      <span>${esc(j.fullAddress || j.address)}</span>
    </div>`;
}

/**
 * @param {any[]} [prefetched] rows the caller already loaded — pass them in so a screen
 *   that also needs the list for its map doesn't trigger a second listings query.
 */

export async function renderJobs(prefetched) {
  const list = document.getElementById("jobList");
  const allJobs = prefetched || await listings.openJobs();
  const jobs = allJobs
    .filter(j => state.activeFilter === "all" || j.type === state.activeFilter)
    .map(j => ({ ...j, dist: haversine(state.depot, j) }))
    .sort((a, b) => (Number(b.boosted) - Number(a.boosted)) || (a.dist - b.dist));

  list.innerHTML = jobs.map(j => {
    const unlocked = j.unlocked;
    return `
    <div class="job-card ${j.boosted ? "boosted" : ""}">
      <span class="job-icon" aria-hidden="true">${TYPE_ICON[j.type] || TYPE_ICON.mixed}</span>
      <div class="job-body">
        <h4>${esc(j.title)}</h4>
        <p class="job-meta">${esc(j.address)} &middot; ${j.dist.toFixed(1)} mi away</p>
        <div class="job-tags">
          ${j.boosted ? '<span class="tag boosted-tag">&#128640; Boosted</span>' : ""}
          <span class="tag">${TYPE_LABEL[j.type] || esc(j.type)}</span>
          <span class="tag">${WEIGHT_LABEL[j.weight] || esc(j.weight)}</span>
          ${j.urgency === "today" ? '<span class="tag urgent">Wanted today</span>' : ""}
        </div>
        ${unlocked ? contactBlockHTML(j) : ""}
        <div class="job-actions">
          <button class="add-btn ${state.routeIds.includes(j.id) ? "added" : ""}" data-id="${j.id}">
            ${state.routeIds.includes(j.id) ? "Added ✓" : "Add to route"}
          </button>
          ${unlocked
            ? `<button class="add-btn accept-btn" data-accept="${j.id}">Accept job</button>`
            : `<button class="add-btn unlock-btn" data-unlock="${j.id}">Unlock contact — £1.50</button>`}
        </div>
      </div>
    </div>`;
  }).join("");
}

/* One delegated listener survives re-renders */
document.getElementById("jobList").addEventListener("click", e => {
  const addBtn = e.target.closest(".add-btn[data-id]");
  if (addBtn) {
    const id = Number(addBtn.dataset.id);
    if (state.routeIds.includes(id)) {
      state.routeIds = state.routeIds.filter(x => x !== id);
    } else {
      state.routeIds.push(id);
    }
    saveJSON("scrapman_route", state.routeIds);
    initJobsMap();
    return;
  }
  const unlockBtn = e.target.closest("[data-unlock]");
  if (unlockBtn) {
    startUnlock(Number(unlockBtn.dataset.unlock));
    return;
  }
  const acceptBtn = e.target.closest("[data-accept]");
  if (acceptBtn) {
    acceptJob(Number(acceptBtn.dataset.accept));
    return;
  }
});


/* ---------- filters ---------- */
document.getElementById("filterRow").addEventListener("click", e => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  document.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
  chip.classList.add("active");
  state.activeFilter = chip.dataset.filter;
  renderJobs();
});

export async function initJobsMap() {
  const el = document.getElementById("jobsMap");
  if (!el || el.offsetParent === null) return;
  if (typeof L === "undefined") { renderJobs(); return; } // CDN unreachable/offline — list still works
  if (jobsMap) { jobsMap.remove(); jobsMap = null; }
  jobsMap = L.map("jobsMap", { zoomControl: false, attributionControl: false }).setView([state.depot.lat, state.depot.lng], state.usingDefaultLocation ? 11 : 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(jobsMap);
  L.marker([state.depot.lat, state.depot.lng]).addTo(jobsMap).bindPopup(state.usingDefaultLocation ? "Default location — set yours" : "You are here");
  const jobs = await listings.openJobs();
  jobs.filter(j => state.activeFilter === "all" || j.type === state.activeFilter).forEach(j => {
    const markerColor = state.routeIds.includes(j.id) ? "#037a56" : j.boosted ? "#c98a00" : "#e05f00";
    const marker = L.circleMarker([j.lat, j.lng], {
      radius: 8,
      color: markerColor,
      fillColor: state.routeIds.includes(j.id) ? "#04966b" : j.boosted ? "#ffcf40" : "#ff6b00",
      fillOpacity: 0.9,
      weight: 2
    }).addTo(jobsMap);
    marker.bindPopup(esc(j.title) + (j.boosted ? " — Boosted" : ""));
  });
  renderJobs(jobs); // reuse the rows already fetched for the map — one query per render
}


/* ---------- route planner ---------- */
export async function renderRoute() {
  const jobs = (await listings.openJobs()).filter(j => state.routeIds.includes(j.id));
  const emptyEl = document.getElementById("routeEmpty");
  const contentEl = document.getElementById("routeContent");

  if (!jobs.length) {
    emptyEl.classList.remove("hidden");
    contentEl.classList.add("hidden");
    return;
  }
  emptyEl.classList.add("hidden");
  contentEl.classList.remove("hidden");

  const ordered = nearestNeighborRoute(jobs, state.depot);
  const totalDist = ordered.reduce((sum, j) => sum + j.legDist, 0);

  // naive "as listed" order, for comparison
  let naiveDist = 0;
  /** @type {{lat: number, lng: number}} */
  let cur = state.depot;
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
        <h4>${esc(j.title)}</h4>
        <span>${esc(j.address)} &middot; +${j.legDist.toFixed(1)} mi</span>
      </div>
    </li>
  `).join("") + (savedMinutes > 5 ? `
    <div class="upsell">
      <p>Optimised ordering saves you <strong>~${savedMinutes} minutes</strong> vs collecting in the order jobs came in.</p>
    </div>
  ` : "");

  if (typeof L === "undefined") return; // stats + stop list above still render offline
  if (routeMap) { routeMap.remove(); routeMap = null; }
  routeMap = L.map("routeMap", { zoomControl: false, attributionControl: false }).setView([state.depot.lat, state.depot.lng], state.usingDefaultLocation ? 11 : 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(routeMap);
  L.marker([state.depot.lat, state.depot.lng]).addTo(routeMap).bindPopup(`Start — ${locationLabel()}`);
  const latlngs = [[state.depot.lat, state.depot.lng]];
  ordered.forEach((j, i) => {
    L.circleMarker([j.lat, j.lng], { radius: 9, color: "#037a56", fillColor: "#04966b", fillOpacity: 1, weight: 2 })
      .addTo(routeMap)
      .bindTooltip(String(i + 1), { permanent: true, direction: "center", className: "route-num-tip" });
    latlngs.push([j.lat, j.lng]);
  });
  L.polyline(latlngs, { color: "#ff6b00", weight: 3, dashArray: "6 6" }).addTo(routeMap);
  routeMap.fitBounds(latlngs, { padding: [24, 24] });
}

