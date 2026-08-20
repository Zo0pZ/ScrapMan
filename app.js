/* ScrapMan — homeowner/collector scrap collection marketplace. Backed by Supabase (see supabase-config.js). */
/* Location helpers (geolocation, reverse geocoding, council lookup) live in geo.js */

let DEPOT = { lat: 52.4862, lng: -1.8904, label: "Birmingham" };
let usingDefaultLocation = true;
let locationAttempted = false;

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

async function fetchUnlockedIds() {
  if (!SCRAPMAN_AUTH_CONFIGURED || !scrapmanSession) return [];
  const { data } = await scrapmanDb.from("job_unlocks").select("listing_id").eq("collector_id", scrapmanSession.user.id);
  return (data || []).map(r => r.listing_id);
}

async function unlockJob(id) {
  if (!SCRAPMAN_AUTH_CONFIGURED || !scrapmanSession) return;
  await scrapmanDb.from("job_unlocks").upsert({ listing_id: id, collector_id: scrapmanSession.user.id });
}
function isPro() { return !!loadJSON("scrapman_pro", null)?.active; }
function setPro(active) {
  if (active) saveJSON("scrapman_pro", { active: true, since: Date.now() });
  else localStorage.removeItem("scrapman_pro");
}
function getCollector() {
  if (!SCRAPMAN_AUTH_CONFIGURED || !scrapmanSession) return null;
  const cp = scrapmanSession.collectorProfile;
  return cp ? {
    businessName: cp.business_name, carrierRef: cp.carrier_ref, smdCouncil: cp.smd_council,
    smdLicence: cp.smd_licence, status: cp.verification_status,
    eaCarrier: cp.ea_carrier, eaScrapMetalLicence: cp.ea_scrap_metal_licence
  } : null;
}
function isVerified() { return getCollector()?.status === "verified"; }

/* ---------- navigation ---------- */
function goTo(screen) {
  // Signed-out + configured: everything except the auth screen redirects to sign-up/sign-in.
  if (SCRAPMAN_AUTH_CONFIGURED && !scrapmanSession && screen !== "auth") {
    screen = "auth";
  }
  if (screen !== "thread") unsubscribeFromThreadMessages();
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById("screen-" + screen).classList.add("active");
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.nav === screen));
  if (screen === "jobs") { updateLocationUI(); setTimeout(initJobsMap, 0); ensureLocation().then(initJobsMap); renderActiveAssignment(); }
  if (screen === "route") { updateLocationUI(); setTimeout(renderRoute, 0); ensureLocation().then(renderRoute); }
  if (screen === "track") renderTrack();
  if (screen === "home") personalizeCouncilLink();
  if (screen === "list") prefillPostcodeFromLocation();
  if (screen === "messages") renderMessages();
  if (screen === "thread") renderThread();
  if (screen === "account") { renderAccount(); personalizeCouncilLink(); }
}

document.querySelectorAll("[data-nav]").forEach(el => {
  el.addEventListener("click", () => goTo(el.dataset.nav));
});

/* ---------- auth (accounts, gated entirely by SCRAPMAN_AUTH_CONFIGURED) ---------- */
let authMode = "signup";
let authRoleChoice = "homeowner";

function applyAuthMode() {
  const isSignup = authMode === "signup";
  document.getElementById("authTitle").textContent = isSignup ? "Join ScrapMan" : "Welcome back";
  document.getElementById("authSub").textContent = isSignup
    ? "Choose how you'll use ScrapMan — homeowners and collectors get different apps from here on."
    : "Sign in to pick up where you left off.";
  document.getElementById("authRoleGroup").classList.toggle("hidden", !isSignup);
  document.getElementById("authNameField").classList.toggle("hidden", !isSignup);
  document.getElementById("authSubmitBtn").textContent = isSignup ? "Create account" : "Sign in";
  document.getElementById("authToggleMode").textContent = isSignup ? "Already have an account? Sign in" : "New here? Create an account";
  document.getElementById("forgotPasswordLink").classList.toggle("hidden", isSignup);
}
applyAuthMode();

document.getElementById("authToggleMode").addEventListener("click", () => {
  authMode = authMode === "signup" ? "signin" : "signup";
  applyAuthMode();
});

document.getElementById("authRoleGroup").addEventListener("click", e => {
  const pill = e.target.closest(".pill");
  if (!pill) return;
  document.querySelectorAll("#authRoleGroup .pill").forEach(p => p.classList.remove("active"));
  pill.classList.add("active");
  authRoleChoice = pill.dataset.roleChoice;
});

document.getElementById("authForm").addEventListener("submit", async e => {
  e.preventDefault();
  const btn = document.getElementById("authSubmitBtn");
  const statusEl = document.getElementById("authStatus");
  statusEl.classList.add("hidden");
  btn.disabled = true;
  btn.textContent = authMode === "signup" ? "Creating account…" : "Signing in…";

  const email = document.getElementById("authEmail").value;
  const password = document.getElementById("authPassword").value;
  const result = authMode === "signup"
    ? await scrapmanSignUp({ email, password, role: authRoleChoice, displayName: document.getElementById("authDisplayName").value || email.split("@")[0] })
    : await scrapmanSignIn({ email, password });

  btn.disabled = false;
  applyAuthMode();

  if (result.error) {
    statusEl.textContent = result.error.message || "Something went wrong — please try again.";
    statusEl.className = "demo-note status-error";
    statusEl.classList.remove("hidden");
    if (result.error.code === "already_registered") {
      authMode = "signin";
      applyAuthMode();
      document.getElementById("authEmail").value = email;
    }
    return;
  }
  if (authMode === "signup" && result.data && !result.data.session) {
    statusEl.textContent = "Check your email to confirm your account, then sign in.";
    statusEl.className = "demo-note status-ok";
    statusEl.classList.remove("hidden");
    authMode = "signin";
    applyAuthMode();
    return;
  }
  goTo("home");
});

document.getElementById("signOutBtn").addEventListener("click", async () => {
  await scrapmanSignOut();
  goTo("auth");
});

/* ---------- forgot / reset password ---------- */
document.getElementById("forgotPasswordLink").addEventListener("click", () => {
  document.getElementById("forgotEmail").value = document.getElementById("authEmail").value;
  document.getElementById("forgotStatus").classList.add("hidden");
  openSheet("overlay-forgotPassword");
});

document.getElementById("sendResetBtn").addEventListener("click", async () => {
  const btn = document.getElementById("sendResetBtn");
  const statusEl = document.getElementById("forgotStatus");
  const email = document.getElementById("forgotEmail").value;
  if (!email) return;
  btn.disabled = true;
  btn.textContent = "Sending…";
  const result = await scrapmanRequestPasswordReset(email);
  btn.disabled = false;
  btn.textContent = "Send reset link";
  statusEl.textContent = result.error
    ? (result.error.message || "Something went wrong — please try again.")
    : "Check your email for a link to reset your password.";
  statusEl.className = "demo-note " + (result.error ? "status-error" : "status-ok");
  statusEl.classList.remove("hidden");
});

window.addEventListener("scrapman:passwordRecovery", () => {
  closeSheet();
  goTo("reset-password");
});

document.getElementById("resetPasswordForm").addEventListener("submit", async e => {
  e.preventDefault();
  const btn = document.getElementById("resetPasswordSubmitBtn");
  const statusEl = document.getElementById("resetPasswordStatus");
  const newPassword = document.getElementById("newPassword").value;
  const confirmNewPassword = document.getElementById("confirmNewPassword").value;
  statusEl.classList.add("hidden");

  if (newPassword !== confirmNewPassword) {
    statusEl.textContent = "Those passwords don't match.";
    statusEl.className = "demo-note status-error";
    statusEl.classList.remove("hidden");
    return;
  }

  btn.disabled = true;
  btn.textContent = "Setting password…";
  const result = await scrapmanUpdatePassword(newPassword);
  btn.disabled = false;
  btn.textContent = "Set new password";

  if (result.error) {
    statusEl.textContent = result.error.message || "Something went wrong — please try again.";
    statusEl.className = "demo-note status-error";
    statusEl.classList.remove("hidden");
    return;
  }
  e.target.reset();
  goTo("home");
});

window.addEventListener("scrapman:auth", () => {
  scrapmanApplyRoleUI();
  const onAuthScreen = document.getElementById("screen-auth").classList.contains("active");
  if (scrapmanSession && onAuthScreen) goTo("home");
  if (SCRAPMAN_AUTH_CONFIGURED && !scrapmanSession && !onAuthScreen) goTo("auth");
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

/* ---------- distance & geocoding ---------- */
/* haversine / geocodePostcode are provided by geo.js (scrapmanHaversine / scrapmanGeocodePostcode) */
const haversine = scrapmanHaversine;
const geocodePostcode = scrapmanGeocodePostcode;

/* ---------- user location (collector's own position, or a homeowner's council lookup) ---------- */
function locationLabel() {
  return usingDefaultLocation ? `${DEPOT.label} (default — set yours)` : DEPOT.label;
}

function applyLocation(loc) {
  DEPOT = { lat: loc.lat, lng: loc.lng, label: loc.label, postcode: loc.postcode, council: loc.council };
  usingDefaultLocation = false;
}

function updateLocationUI() {
  document.querySelectorAll(".location-label").forEach(el => { el.textContent = locationLabel(); });
  document.querySelectorAll(".location-row").forEach(el => el.classList.toggle("is-default", usingDefaultLocation));
}

/* Called when a collector opens Jobs/Route — resolves a real starting point once per
   session (from cache, or a silent check if permission was already granted), then
   leaves it to the "Change" control after that so we never nag with repeat prompts. */
async function ensureLocation() {
  if (locationAttempted) { updateLocationUI(); return; }
  locationAttempted = true;
  const loc = (await scrapmanAutoLocate()) || (await scrapmanRequestGeolocation());
  if (loc) applyLocation(loc);
  updateLocationUI();
}

async function setLocationFromGPS() {
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

function refreshLocationDependentScreens() {
  if (document.getElementById("screen-jobs").classList.contains("active")) initJobsMap();
  if (document.getElementById("screen-route").classList.contains("active")) renderRoute();
}

/* Home screen: point the council-charges link at the homeowner's own council when we
   already know it (never forces a permission prompt on its own). */
async function personalizeCouncilLink() {
  const linkEl = document.getElementById("councilLink");
  const accLinkEl = document.getElementById("accCouncilLink");
  if (!linkEl && !accLinkEl) return;
  const loc = scrapmanSavedLocation() || await scrapmanAutoLocate();
  if (!loc || !loc.council) return;
  const href = scrapmanCouncilLink(loc.council);
  if (linkEl) {
    linkEl.href = href;
    linkEl.textContent = `See ${loc.council}'s bulky waste charges →`;
    document.getElementById("locateCouncilBtn")?.classList.add("hidden");
  }
  if (accLinkEl) {
    accLinkEl.href = href;
    document.getElementById("accCouncilSub").textContent = `${loc.council}'s bulky waste charges`;
  }
}

document.getElementById("locateCouncilBtn")?.addEventListener("click", async btnEvent => {
  const btn = btnEvent.currentTarget;
  btn.disabled = true;
  const loc = await scrapmanRequestGeolocation();
  btn.disabled = false;
  if (!loc) { alert("Couldn't get your location — check your browser's location permissions."); return; }
  const linkEl = document.getElementById("councilLink");
  if (loc.council) {
    linkEl.href = scrapmanCouncilLink(loc.council);
    linkEl.textContent = `See ${loc.council}'s bulky waste charges →`;
    btn.classList.add("hidden");
  } else {
    linkEl.textContent = "Couldn't work out your council — try entering a postcode instead →";
  }
});

/* ---------- jobs screen ---------- */
function mapListingRow(row) {
  // listing_contacts is RLS-gated by job_unlocks — this embed comes back null for any
  // job the signed-in collector hasn't unlocked, so no extra round trip is needed.
  const contact = row.listing_contacts || null;
  return {
    id: row.id, title: row.title, type: row.metal_type, weight: row.weight_band,
    lat: row.lat, lng: row.lng, address: row.address, urgency: row.urgency,
    contactName: contact && contact.contact_name, contactPhone: contact && contact.contact_phone,
    fullAddress: contact && contact.full_address
  };
}

async function getAllJobs() {
  if (!SCRAPMAN_AUTH_CONFIGURED || !scrapmanDb) return [];
  const { data, error } = await scrapmanDb
    .from("listings")
    .select("*, listing_contacts(contact_name, contact_phone, full_address)")
    .eq("status", "open")
    .order("created_at", { ascending: false });
  if (error) { console.error(error); return []; }
  return (data || []).map(mapListingRow);
}

/* ---------- accept & track a job (Supabase-only — no demo-mode equivalent) ---------- */
async function acceptJob(id) {
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

async function renderActiveAssignment() {
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

async function renderTrack() {
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

function contactBlockHTML(j) {
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

async function renderJobs() {
  const list = document.getElementById("jobList");
  const [allJobs, unlockedNow] = await Promise.all([getAllJobs(), fetchUnlockedIds()]);
  const jobs = allJobs
    .filter(j => activeFilter === "all" || j.type === activeFilter)
    .map(j => ({ ...j, dist: haversine(DEPOT, j) }))
    .sort((a, b) => a.dist - b.dist);

  list.innerHTML = jobs.map(j => {
    const unlocked = unlockedNow.includes(j.id);
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
            ? `<button class="add-btn accept-btn" data-accept="${j.id}">Accept job</button>`
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
  const acceptBtn = e.target.closest("[data-accept]");
  if (acceptBtn) {
    acceptJob(Number(acceptBtn.dataset.accept));
    return;
  }
});

/* ---------- unlock & mock payment ---------- */
async function startUnlock(id) {
  if (!isVerified()) {
    openSheet("overlay-verifyPrompt");
    return;
  }
  if (isPro()) {
    await unlockJob(id);
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
  setTimeout(async () => {
    payBtn.textContent = "Paid ✓";
    if (pendingUnlockId != null) await unlockJob(pendingUnlockId);
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

/* ---------- verification (live-checked against the EA public register) ---------- */
const VERIFY_ENDPOINT = "/verify-collector";

function setVerifyStatus(text, kind) {
  const el = document.getElementById("verifyStatus");
  el.textContent = text;
  el.className = "demo-note" + (kind ? ` status-${kind}` : "");
  el.classList.toggle("hidden", !text);
}

function describeCheckFailure(check, label) {
  if (!check || !check.checked) return null;
  if (!check.found) {
    const hint = check.closestMatches && check.closestMatches.length
      ? ` Closest matches on the register: ${check.closestMatches.map(m => m.number || m).join(", ")}.`
      : "";
    return `${label} not found on the register.${hint} Double-check the number.`;
  }
  if (check.expired) return `${label} was found but expired on ${check.expiryDate}.`;
  return null;
}

document.getElementById("verifyForm").addEventListener("submit", async e => {
  e.preventDefault();
  const submitBtn = e.target.querySelector('button[type="submit"]');
  const profile = {
    businessName: document.getElementById("bizName").value,
    carrierRef: document.getElementById("carrierRef").value,
    smdCouncil: document.getElementById("smdCouncil").value,
    smdLicence: document.getElementById("smdLicence").value,
    insurance: document.querySelector("#insuranceGroup .pill.active")?.dataset.ins === "yes"
  };

  submitBtn.disabled = true;
  submitBtn.textContent = "Checking the register…";
  setVerifyStatus("", null);

  let result;
  try {
    const res = await fetch(VERIFY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ carrierRef: profile.carrierRef, council: profile.smdCouncil, licenceNumber: profile.smdLicence })
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    result = await res.json();
  } catch {
    result = null; // verification service unreachable — e.g. the verify-collector Node app isn't running
  }

  submitBtn.disabled = false;
  submitBtn.textContent = "Check & submit for verification";

  if (!result) {
    // Verification service unreachable — surface the failure rather than silently
    // marking the collector verified (that would let a network blip bypass the check).
    setVerifyStatus("We couldn't reach the verification service — please try again in a moment.", "error");
    return;
  }

  if (!result.verified) {
    const problems = [
      describeCheckFailure(result.carrier, "Waste carrier registration"),
      describeCheckFailure(result.scrapMetalLicence, "Scrap metal dealer licence")
    ].filter(Boolean);
    setVerifyStatus(problems.join(" ") || "We couldn't verify those details — please check and try again.", "error");
    return;
  }

  await scrapmanDb.from("collector_profiles").upsert({
    profile_id: scrapmanSession.user.id,
    business_name: profile.businessName, carrier_ref: profile.carrierRef,
    smd_council: profile.smdCouncil, smd_licence: profile.smdLicence, insurance: profile.insurance,
    verification_status: "verified", verified_at: new Date().toISOString(),
    ea_carrier: result.carrier, ea_scrap_metal_licence: result.scrapMetalLicence
  });
  await scrapmanRefreshSession();
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
  const verifyNote = c && c.eaCarrier
    ? `<p class="demo-note status-ok">Verified live against the Environment Agency register${c.eaCarrier.expiryDate ? ` &middot; carrier reg expires ${esc(c.eaCarrier.expiryDate)}` : ""}${c.eaScrapMetalLicence && c.eaScrapMetalLicence.expiryDate ? ` &middot; licence expires ${esc(c.eaScrapMetalLicence.expiryDate)}` : ""}.</p>`
    : "";
  document.getElementById("accVerify").innerHTML = c && c.status === "verified"
    ? `<div class="toggle-row">
         <div><strong>${esc(c.businessName || "Collector")}</strong>
           <span>Carrier reg ${esc(c.carrierRef || "—")} &middot; ${esc(c.smdCouncil || "—")} licence ${esc(c.smdLicence || "—")}</span></div>
         <span class="badge-verified">✓ Verified</span>
       </div>
       ${verifyNote}`
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

/* ---------- messaging (per accepted job, backed by the real `messages` table — RLS
   restricts each thread to that job's homeowner + assigned collector) ---------- */
let scrapmanMessageChannel = null;

function unsubscribeFromThreadMessages() {
  if (scrapmanMessageChannel) { scrapmanDb.removeChannel(scrapmanMessageChannel); scrapmanMessageChannel = null; }
}

function subscribeToThreadMessages(assignmentId) {
  unsubscribeFromThreadMessages();
  if (!scrapmanDb) return;
  scrapmanMessageChannel = scrapmanDb
    .channel(`thread:${assignmentId}:messages`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `assignment_id=eq.${assignmentId}` }, () => renderThread())
    .subscribe();
}

async function fetchMyThreads() {
  if (!SCRAPMAN_AUTH_CONFIGURED || !scrapmanSession) return [];
  const { data, error } = await scrapmanDb
    .from("job_assignments")
    .select("id, status, listings(title)")
    .order("accepted_at", { ascending: false });
  if (error) { console.error(error); return []; }
  return data || [];
}

async function fetchThreadMessages(assignmentId) {
  const { data, error } = await scrapmanDb
    .from("messages")
    .select("*, profiles:sender_id(display_name)")
    .eq("assignment_id", assignmentId)
    .order("created_at", { ascending: true });
  if (error) { console.error(error); return []; }
  return data || [];
}

async function sendThreadMessage(assignmentId, body) {
  if (!scrapmanSession) return;
  await scrapmanDb.from("messages").insert({ assignment_id: assignmentId, sender_id: scrapmanSession.user.id, body });
}

function openThread(id) {
  currentThread = id;
  goTo("thread");
  subscribeToThreadMessages(id);
}

async function renderMessages() {
  const listEl = document.getElementById("threadList");
  const emptyEl = document.getElementById("messagesEmpty");
  const threads = await fetchMyThreads();

  if (!threads.length) {
    emptyEl.classList.remove("hidden");
    listEl.innerHTML = "";
    return;
  }
  emptyEl.classList.add("hidden");
  const previews = await Promise.all(threads.map(async t => ({ thread: t, msgs: await fetchThreadMessages(t.id) })));
  listEl.innerHTML = previews.map(({ thread, msgs }) => {
    const last = msgs[msgs.length - 1];
    return `
      <button class="thread-row" data-thread="${thread.id}">
        <div>
          <h4>${esc(thread.listings.title)}</h4>
          <span>${last ? esc(last.body) : "Start the conversation"}</span>
        </div>
        ${last ? `<time>${new Date(last.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>` : ""}
      </button>`;
  }).join("");
}

document.getElementById("threadList").addEventListener("click", e => {
  const row = e.target.closest("[data-thread]");
  if (row) openThread(Number(row.dataset.thread));
});

async function renderThread() {
  if (currentThread == null) { goTo("messages"); return; }
  const { data: assignment } = await scrapmanDb.from("job_assignments").select("id, listings(title)").eq("id", currentThread).single();
  document.getElementById("threadTitle").textContent = assignment ? assignment.listings.title : "Conversation";

  const myId = scrapmanSession.user.id;
  const msgs = await fetchThreadMessages(currentThread);
  const listEl = document.getElementById("msgList");
  listEl.innerHTML = msgs.length
    ? msgs.map(m => `
        <div class="msg ${m.sender_id === myId ? "me" : ""}">
          <p>${esc(m.body)}</p>
          <span class="msg-meta">${esc((m.profiles && m.profiles.display_name) || "")} &middot; ${new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        </div>`).join("")
    : `<p class="msg-empty">No messages yet — say hello and agree a pickup time.</p>`;
  listEl.scrollTop = listEl.scrollHeight;
}

document.getElementById("msgForm").addEventListener("submit", async e => {
  e.preventDefault();
  const input = document.getElementById("msgInput");
  const text = input.value.trim();
  if (!text || currentThread == null) return;
  input.value = "";
  await sendThreadMessage(currentThread, text);
  renderThread();
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

async function initJobsMap() {
  const el = document.getElementById("jobsMap");
  if (!el || el.offsetParent === null) return;
  if (typeof L === "undefined") { renderJobs(); return; } // CDN unreachable/offline — list still works
  if (jobsMap) { jobsMap.remove(); jobsMap = null; }
  jobsMap = L.map("jobsMap", { zoomControl: false, attributionControl: false }).setView([DEPOT.lat, DEPOT.lng], usingDefaultLocation ? 11 : 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(jobsMap);
  L.marker([DEPOT.lat, DEPOT.lng]).addTo(jobsMap).bindPopup(usingDefaultLocation ? "Default location — set yours" : "You are here");
  const jobs = await getAllJobs();
  jobs.filter(j => activeFilter === "all" || j.type === activeFilter).forEach(j => {
    const marker = L.circleMarker([j.lat, j.lng], {
      radius: 8,
      color: routeIds.includes(j.id) ? "#037a56" : "#e05f00",
      fillColor: routeIds.includes(j.id) ? "#04966b" : "#ff6b00",
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

async function renderRoute() {
  const jobs = (await getAllJobs()).filter(j => routeIds.includes(j.id));
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
  routeMap = L.map("routeMap", { zoomControl: false, attributionControl: false }).setView([DEPOT.lat, DEPOT.lng], usingDefaultLocation ? 11 : 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(routeMap);
  L.marker([DEPOT.lat, DEPOT.lng]).addTo(routeMap).bindPopup(`Start — ${locationLabel()}`);
  const latlngs = [[DEPOT.lat, DEPOT.lng]];
  ordered.forEach((j, i) => {
    L.circleMarker([j.lat, j.lng], { radius: 9, color: "#037a56", fillColor: "#04966b", fillOpacity: 1, weight: 2 })
      .addTo(routeMap)
      .bindTooltip(String(i + 1), { permanent: true, direction: "center", className: "route-num-tip" });
    latlngs.push([j.lat, j.lng]);
  });
  L.polyline(latlngs, { color: "#ff6b00", weight: 3, dashArray: "6 6" }).addTo(routeMap);
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

/* If we already know the homeowner's location (cached, or previously granted),
   prefill the postcode field — only ever touches it while it's still empty. */
function prefillPostcodeFromLocation() {
  const input = document.getElementById("postcode");
  if (input.value) return;
  const loc = scrapmanSavedLocation();
  if (loc && loc.postcode) input.value = loc.postcode;
}

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

  const newListing = {
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

  if (!SCRAPMAN_AUTH_CONFIGURED || !scrapmanSession) {
    alert("Something went wrong — please sign in and try again.");
    return;
  }

  const { data: inserted, error } = await scrapmanDb.from("listings").insert({
    homeowner_id: scrapmanSession.user.id,
    title: newListing.title, metal_type: newListing.type, weight_band: newListing.weight,
    urgency: newListing.urgency, lat: newListing.lat, lng: newListing.lng, address: newListing.address
  }).select().single();
  if (error || !inserted) {
    alert("Couldn't create your listing — please try again.");
    return;
  }
  await scrapmanDb.from("listing_contacts").insert({
    listing_id: inserted.id, contact_name: newListing.contactName, contact_phone: newListing.contactPhone
  });

  e.target.reset();
  document.getElementById("photoPreview").style.backgroundImage = "";
  document.getElementById("photoPreview").innerHTML = PHOTO_PLACEHOLDER;
  document.querySelectorAll("#weightGroup .pill").forEach(p => p.classList.remove("active"));
  selectedWeight = "";
  goTo("confirm");
});

/* ---------- init ---------- */
renderJobs();
personalizeCouncilLink();

/* ---------- PWA service worker ---------- */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
