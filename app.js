/* ScrapMan prototype — mock data + local logic only, no backend */

const DEPOT = { lat: 52.4862, lng: -1.8904, label: "Your start point (Birmingham)" };

/* Contact details are inert fakes: names invented, phones from the
   Ofcom drama range (07700 900xxx), addresses fictional. */
const MOCK_JOBS = [
  { id: 1, title: "Old washing machine", type: "appliance", weight: "medium", lat: 52.4780, lng: -1.9025, address: "Edgbaston, B15", urgency: "today",
    contactName: "Sandra P.", contactPhone: "07700 900123", fullAddress: "42 Willow Rd, Edgbaston B15 2TT" },
  { id: 2, title: "Copper pipe offcuts", type: "nonferrous", weight: "small", lat: 52.4915, lng: -1.9200, address: "Ladywood, B16", urgency: "week",
    contactName: "Dev K.", contactPhone: "07700 900234", fullAddress: "8 Monument Ct, Ladywood B16 8UZ" },
  { id: 3, title: "Steel garden gate + railings", type: "ferrous", weight: "medium", lat: 52.4700, lng: -1.8800, address: "Moseley, B13", urgency: "norush",
    contactName: "Margaret H.", contactPhone: "07700 900345", fullAddress: "117 Oakfield Ave, Moseley B13 9DJ" },
  { id: 4, title: "Dead car battery x4", type: "nonferrous", weight: "small", lat: 52.5010, lng: -1.8700, address: "Aston, B6", urgency: "today",
    contactName: "Tommy R.", contactPhone: "07700 900456", fullAddress: "3 Victoria Works, Aston B6 5RQ" },
  { id: 5, title: "Fridge freezer, cooker, dishwasher", type: "appliance", weight: "large", lat: 52.4550, lng: -1.9300, address: "Selly Oak, B29", urgency: "week",
    contactName: "Priya S.", contactPhone: "07700 900567", fullAddress: "29 Harborne Ln, Selly Oak B29 6SN" },
  { id: 6, title: "Scaffold poles, mixed lengths", type: "ferrous", weight: "large", lat: 52.4990, lng: -1.9100, address: "Hockley, B18", urgency: "norush",
    contactName: "Big Dave", contactPhone: "07700 900678", fullAddress: "Unit 4, Pitsford St, Hockley B18 6LJ" },
  { id: 7, title: "Brass fittings, old radiators", type: "nonferrous", weight: "medium", lat: 52.4650, lng: -1.8600, address: "Sparkbrook, B11", urgency: "today",
    contactName: "Aisha B.", contactPhone: "07700 900789", fullAddress: "64 Ladypool Rd, Sparkbrook B11 4JE" },
  { id: 8, title: "Skip-load mixed metal, house clearance", type: "ferrous", weight: "large", lat: 52.5100, lng: -1.9350, address: "Handsworth, B21", urgency: "week",
    contactName: "Colin W.", contactPhone: "07700 900890", fullAddress: "12 Grove Ln, Handsworth B21 9ES" }
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

/* ---------- helpers & state ---------- */
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function loadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}
function saveJSON(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

let routeIds = loadJSON("scrapman_route", []);
let activeFilter = "all";
let jobsMap, routeMap;
let currentThread = null;
let pendingUnlockId = null;
let deferredInstallPrompt = null;

function unlockedIds() { return loadJSON("scrapman_unlocked", []); }
function isUnlocked(id) { return unlockedIds().includes(id); }
function unlockJob(id) {
  const ids = unlockedIds();
  if (!ids.includes(id)) { ids.push(id); saveJSON("scrapman_unlocked", ids); }
}
function isPro() { return !!loadJSON("scrapman_pro", null)?.active; }
function setPro(active) {
  if (active) saveJSON("scrapman_pro", { active: true, since: Date.now() });
  else localStorage.removeItem("scrapman_pro");
}
function getCollector() { return loadJSON("scrapman_collector", null); }
function isVerified() { return getCollector()?.status === "verified"; }
function getMessages() { return loadJSON("scrapman_messages", {}); }
function getThread(id) { return getMessages()[id] || []; }
function sendMessage(id, from, text) {
  const all = getMessages();
  (all[id] = all[id] || []).push({ from, text, ts: Date.now() });
  saveJSON("scrapman_messages", all);
}
function myListingIds() { return loadJSON("scrapman_listings", []).map(l => l.id); }
function resetDemo() {
  Object.keys(localStorage)
    .filter(k => k.startsWith("scrapman_"))
    .forEach(k => localStorage.removeItem(k));
  location.reload();
}

/* ---------- navigation ---------- */
function goTo(screen) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById("screen-" + screen).classList.add("active");
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.nav === screen));
  if (screen === "jobs") setTimeout(initJobsMap, 0);
  if (screen === "route") setTimeout(renderRoute, 0);
  if (screen === "messages") renderMessages();
  if (screen === "thread") renderThread();
  if (screen === "account") renderAccount();
}

document.querySelectorAll("[data-nav]").forEach(el => {
  el.addEventListener("click", () => goTo(el.dataset.nav));
});

/* ---------- bottom sheets ---------- */
function openSheet(id) {
  closeSheet();
  document.getElementById(id).classList.add("open");
}
function closeSheet() {
  document.querySelectorAll(".overlay.open").forEach(o => o.classList.remove("open"));
}
document.querySelectorAll(".overlay").forEach(o => {
  o.addEventListener("click", e => { if (e.target === o) closeSheet(); });
});
document.querySelectorAll(".sheet-close").forEach(btn => {
  btn.addEventListener("click", closeSheet);
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
  const extra = loadJSON("scrapman_listings", []);
  return MOCK_JOBS.concat(extra);
}

function contactBlockHTML(j) {
  if (!j.contactName && !j.contactPhone) {
    return `<div class="contact-block"><p class="contact-missing">Contact details weren't captured for this demo listing.</p></div>`;
  }
  return `
    <div class="contact-block">
      <strong>${esc(j.contactName || "Homeowner")}</strong>
      ${j.contactPhone ? `<a href="tel:${esc(j.contactPhone.replace(/\s/g, ""))}">${esc(j.contactPhone)}</a>` : ""}
      <span>${esc(j.fullAddress || j.address)}</span>
    </div>`;
}

function renderJobs() {
  const list = document.getElementById("jobList");
  const jobs = getAllJobs()
    .filter(j => activeFilter === "all" || j.type === activeFilter)
    .map(j => ({ ...j, dist: haversine(DEPOT, j) }))
    .sort((a, b) => a.dist - b.dist);

  list.innerHTML = jobs.map(j => {
    const unlocked = isUnlocked(j.id);
    return `
    <div class="job-card">
      <span class="job-icon" aria-hidden="true">${TYPE_ICON[j.type] || TYPE_ICON.mixed}</span>
      <div class="job-body">
        <h4>${esc(j.title)}</h4>
        <p class="job-meta">${esc(j.address)} &middot; ${j.dist.toFixed(1)} mi away</p>
        <div class="job-tags">
          <span class="tag">${TYPE_LABEL[j.type] || esc(j.type)}</span>
          <span class="tag">${WEIGHT_LABEL[j.weight] || esc(j.weight)}</span>
          ${j.urgency === "today" ? '<span class="tag urgent">Wanted today</span>' : ""}
        </div>
        ${unlocked ? contactBlockHTML(j) : ""}
        <div class="job-actions">
          <button class="add-btn ${routeIds.includes(j.id) ? "added" : ""}" data-id="${j.id}">
            ${routeIds.includes(j.id) ? "Added ✓" : "Add to route"}
          </button>
          ${unlocked
            ? `<button class="add-btn msg-btn" data-msg="${j.id}">Message</button>`
            : `<button class="add-btn unlock-btn" data-unlock="${j.id}">${isPro() ? "Unlock — included in Pro" : "Unlock contact — £1.50"}</button>`}
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
    if (routeIds.includes(id)) {
      routeIds = routeIds.filter(x => x !== id);
    } else {
      routeIds.push(id);
    }
    saveJSON("scrapman_route", routeIds);
    initJobsMap();
    return;
  }
  const unlockBtn = e.target.closest("[data-unlock]");
  if (unlockBtn) {
    startUnlock(Number(unlockBtn.dataset.unlock));
    return;
  }
  const msgBtn = e.target.closest("[data-msg]");
  if (msgBtn) openThread(Number(msgBtn.dataset.msg));
});

/* ---------- unlock & mock payment ---------- */
function startUnlock(id) {
  if (!isVerified()) {
    openSheet("overlay-verifyPrompt");
    return;
  }
  if (isPro()) {
    unlockJob(id);
    renderJobs();
    return;
  }
  pendingUnlockId = id;
  const payBtn = document.getElementById("payBtn");
  payBtn.disabled = false;
  payBtn.textContent = "Pay £1.50";
  openSheet("overlay-pay");
}

document.getElementById("payBtn").addEventListener("click", () => {
  const payBtn = document.getElementById("payBtn");
  payBtn.disabled = true;
  payBtn.textContent = "Processing…";
  setTimeout(() => {
    payBtn.textContent = "Paid ✓";
    if (pendingUnlockId != null) unlockJob(pendingUnlockId);
    pendingUnlockId = null;
    setTimeout(() => { closeSheet(); renderJobs(); }, 500);
  }, 400);
});

document.getElementById("verifyPromptBtn").addEventListener("click", () => {
  closeSheet();
  goTo("verify");
});

/* ---------- Pro (demo subscription) ---------- */
document.getElementById("goProBtn").addEventListener("click", () => {
  const btn = document.getElementById("proBtn");
  btn.disabled = false;
  btn.textContent = "Subscribe — £6.99/mo";
  openSheet("overlay-pro");
});

document.getElementById("proBtn").addEventListener("click", () => {
  const btn = document.getElementById("proBtn");
  btn.disabled = true;
  btn.textContent = "Processing…";
  setTimeout(() => {
    btn.textContent = "Subscribed ✓";
    setPro(true);
    setTimeout(() => { closeSheet(); renderJobs(); }, 500);
  }, 400);
});

/* ---------- verification (demo) ---------- */
document.getElementById("verifyForm").addEventListener("submit", e => {
  e.preventDefault();
  saveJSON("scrapman_collector", {
    businessName: document.getElementById("bizName").value,
    carrierRef: document.getElementById("carrierRef").value,
    smdCouncil: document.getElementById("smdCouncil").value,
    smdLicence: document.getElementById("smdLicence").value,
    insurance: document.querySelector("#insuranceGroup .pill.active")?.dataset.ins === "yes",
    status: "verified",
    verifiedAt: Date.now()
  });
  goTo("account");
});

document.getElementById("insuranceGroup").addEventListener("click", e => {
  const pill = e.target.closest(".pill");
  if (!pill) return;
  document.querySelectorAll("#insuranceGroup .pill").forEach(p => p.classList.remove("active"));
  pill.classList.add("active");
});

/* ---------- account screen ---------- */
function renderAccount() {
  const c = getCollector();
  document.getElementById("accVerify").innerHTML = c && c.status === "verified"
    ? `<div class="toggle-row">
         <div><strong>${esc(c.businessName || "Collector")}</strong>
           <span>Carrier reg ${esc(c.carrierRef || "—")} &middot; ${esc(c.smdCouncil || "—")} licence ${esc(c.smdLicence || "—")}</span></div>
         <span class="badge-verified">✓ Verified</span>
       </div>
       <p class="demo-note">Demo — in a live service these details would be checked against the Environment Agency and council registers.</p>`
    : `<div class="toggle-row">
         <div><strong>Not verified</strong><span>Verify your licences to unlock homeowner contacts.</span></div>
         <button class="add-btn" data-nav="verify" id="accVerifyBtn">Get verified</button>
       </div>`;
  const vBtn = document.getElementById("accVerifyBtn");
  if (vBtn) vBtn.addEventListener("click", () => goTo("verify"));

  document.getElementById("accPro").innerHTML = isPro()
    ? `<div class="toggle-row">
         <div><strong>ScrapMan Pro</strong><span>Unlimited contact unlocks — demo subscription</span></div>
         <button class="add-btn" id="cancelProBtn">Cancel</button>
       </div>`
    : `<div class="toggle-row">
         <div><strong>Free plan</strong><span>&pound;1.50 per contact unlock</span></div>
         <button class="add-btn" id="accGoProBtn">Go Pro</button>
       </div>`;
  const cancelBtn = document.getElementById("cancelProBtn");
  if (cancelBtn) cancelBtn.addEventListener("click", () => { setPro(false); renderAccount(); renderJobs(); });
  const goProBtn = document.getElementById("accGoProBtn");
  if (goProBtn) goProBtn.addEventListener("click", () => {
    const btn = document.getElementById("proBtn");
    btn.disabled = false;
    btn.textContent = "Subscribe — £6.99/mo";
    openSheet("overlay-pro");
  });

  renderInstallRow();
}

document.getElementById("resetDemoBtn").addEventListener("click", () => {
  if (confirm("Reset all demo data? Listings, unlocks, messages and your profile will be cleared.")) resetDemo();
});

/* ---------- messaging (demo) ---------- */
function threadIds() {
  const ids = new Set(Object.keys(getMessages()).map(Number));
  unlockedIds().forEach(id => ids.add(id));
  return [...ids];
}

function openThread(id) {
  currentThread = id;
  goTo("thread");
}

function renderMessages() {
  const listEl = document.getElementById("threadList");
  const emptyEl = document.getElementById("messagesEmpty");
  const jobs = getAllJobs();
  const ids = threadIds().filter(id => jobs.some(j => j.id === id));

  if (!ids.length) {
    emptyEl.classList.remove("hidden");
    listEl.innerHTML = "";
    return;
  }
  emptyEl.classList.add("hidden");
  listEl.innerHTML = ids.map(id => {
    const job = jobs.find(j => j.id === id);
    const msgs = getThread(id);
    const last = msgs[msgs.length - 1];
    return `
      <button class="thread-row" data-thread="${id}">
        <div>
          <h4>${esc(job.title)}</h4>
          <span>${last ? esc(last.text) : "Start the conversation"}</span>
        </div>
        ${last ? `<time>${new Date(last.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>` : ""}
      </button>`;
  }).join("");
}

document.getElementById("threadList").addEventListener("click", e => {
  const row = e.target.closest("[data-thread]");
  if (row) openThread(Number(row.dataset.thread));
});

function threadRole(id) {
  return myListingIds().includes(id) ? "homeowner" : "collector";
}

function renderThread() {
  if (currentThread == null) { goTo("messages"); return; }
  const job = getAllJobs().find(j => j.id === currentThread);
  document.getElementById("threadTitle").textContent = job ? job.title : "Conversation";
  const me = threadRole(currentThread);
  const msgs = getThread(currentThread);
  const listEl = document.getElementById("msgList");
  listEl.innerHTML = msgs.length
    ? msgs.map(m => `
        <div class="msg ${m.from === me ? "me" : ""}">
          <p>${esc(m.text)}</p>
          <span class="msg-meta">${m.from === "collector" ? "Collector" : "Homeowner"} &middot; ${new Date(m.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        </div>`).join("")
    : `<p class="msg-empty">No messages yet — say hello and agree a pickup time.</p>`;
  listEl.scrollTop = listEl.scrollHeight;
}

document.getElementById("msgForm").addEventListener("submit", e => {
  e.preventDefault();
  const input = document.getElementById("msgInput");
  const text = input.value.trim();
  if (!text || currentThread == null) return;
  const me = threadRole(currentThread);
  const threadAtSend = currentThread;
  sendMessage(threadAtSend, me, text);
  input.value = "";
  renderThread();
  // Canned demo reply from the other side
  const reply = me === "collector"
    ? "Great — it's in the front garden, knock when you arrive 👍"
    : "No problem, I can swing by tomorrow morning if that suits?";
  setTimeout(() => {
    sendMessage(threadAtSend, me === "collector" ? "homeowner" : "collector", reply);
    if (currentThread === threadAtSend &&
        document.getElementById("screen-thread").classList.contains("active")) {
      renderThread();
    }
  }, 1500);
});

/* ---------- install prompt ---------- */
function isStandalone() {
  return matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
}
function isIOS() {
  return /iP(hone|ad|od)/.test(navigator.userAgent) && !window.MSStream;
}

window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault();
  deferredInstallPrompt = e;
  if (!localStorage.getItem("scrapman_install_dismissed") && !isStandalone()) {
    document.getElementById("installBanner").classList.remove("hidden");
  }
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  document.getElementById("installBanner").classList.add("hidden");
});

document.getElementById("installBtn").addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  document.getElementById("installBanner").classList.add("hidden");
});

document.getElementById("installDismiss").addEventListener("click", () => {
  localStorage.setItem("scrapman_install_dismissed", "1");
  document.getElementById("installBanner").classList.add("hidden");
});

function renderInstallRow() {
  const row = document.getElementById("accInstall");
  if (isStandalone()) { row.classList.add("hidden"); return; }
  if (deferredInstallPrompt || isIOS()) {
    row.classList.remove("hidden");
  } else {
    row.classList.add("hidden");
  }
}

document.getElementById("accInstallBtn").addEventListener("click", () => {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
  } else if (isIOS()) {
    openSheet("overlay-ios");
  }
});

/* ---------- filters ---------- */
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
  if (typeof L === "undefined") { renderJobs(); return; } // CDN unreachable/offline — list still works
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
    marker.bindPopup(esc(j.title));
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
        <h4>${esc(j.title)}</h4>
        <span>${esc(j.address)} &middot; +${j.legDist.toFixed(1)} mi</span>
      </div>
    </li>
  `).join("") + (savedMinutes > 5 ? `
    <div class="upsell">
      <p>Optimised ordering saves you <strong>~${savedMinutes} minutes</strong> vs collecting in the order jobs came in.</p>
    </div>
  ` : "");

  const el = document.getElementById("routeMap");
  if (typeof L === "undefined") return; // stats + stop list above still render offline
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

  const listings = loadJSON("scrapman_listings", []);
  const newListing = {
    id: 1000 + listings.length,
    title: document.getElementById("itemTitle").value,
    type: document.getElementById("metalType").value || "mixed",
    weight: selectedWeight || "small",
    lat: coords.lat,
    lng: coords.lng,
    address: postcodeInput.value.toUpperCase(),
    urgency: document.getElementById("urgency").value,
    contactName: document.getElementById("contactName").value,
    contactPhone: document.getElementById("contactPhone").value
  };
  listings.push(newListing);
  saveJSON("scrapman_listings", listings);

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
