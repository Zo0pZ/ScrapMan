/* ---------- homeowner "My listings" hub: history, impact counters, boost ---------- */

export async function getMyListings() {
  if (!SCRAPMAN_AUTH_CONFIGURED || !scrapmanSession) return [];
  const { data, error } = await scrapmanDb
    .from("listings")
    .select("*, job_assignments(id, status, accepted_at, updated_at, collector_id, profiles(display_name))")
    .eq("homeowner_id", scrapmanSession.user.id)
    .order("created_at", { ascending: false });
  if (error) { console.error(error); return []; }
  return data || [];
}

// A homeowner's own submitted ratings, keyed by assignment_id — lets the listings
// list show "you rated ★★★★☆" instead of the "Rate your collector" prompt once
// they've already done it, without a separate query per listing.
export async function getMyRatings() {
  if (!SCRAPMAN_AUTH_CONFIGURED || !scrapmanSession) return new Map();
  const { data, error } = await scrapmanDb
    .from("ratings")
    .select("assignment_id, stars")
    .eq("rater_id", scrapmanSession.user.id);
  if (error) { console.error(error); return new Map(); }
  return new Map((data || []).map(r => [r.assignment_id, r.stars]));
}

export const STATUS_DATE_VERB = { Pending: "Listed", Scheduled: "Scheduled", Collected: "Collected", Cancelled: "Cancelled" };

// listings.status is already kept in sync with its assignment by the sync_listing_status
// trigger (see schema.sql) — this just relabels it for display and picks the relevant
// timestamp for the timestamped collection log.
export function homeownerListingStatus(listing) {
  const embedded = listing.job_assignments;
  const assignment = (Array.isArray(embedded) ? embedded[0] : embedded) || null;
  if (listing.status === "collected") return { label: "Collected", at: assignment && assignment.updated_at, assignment };
  if (listing.status === "cancelled") return { label: "Cancelled", at: assignment && assignment.updated_at, assignment };
  if (listing.status === "assigned") return { label: "Scheduled", at: assignment && assignment.accepted_at, assignment };
  return { label: "Pending", at: listing.created_at, assignment };
}

export function renderStars(stars) {
  return "&#9733;".repeat(stars) + "&#9734;".repeat(5 - stars);
}

// Time/fuel/weight are all estimates — see the assumptions block near the top of this
// file. mpg here means UK imperial miles-per-gallon (4.546 L/gal), same as the
// collector ROI tracker's fuel figure.
export function renderHomeownerImpact(listings) {
  const collected = listings.filter(l => l.status === "collected");
  const timeSavedMins = collected.length * TIME_SAVED_MINUTES_PER_COLLECTION;
  const timeSavedLabel = timeSavedMins >= 60 ? `${(timeSavedMins / 60).toFixed(1)} hrs` : `${timeSavedMins} min`;
  const milesSaved = collected.length * AVG_TIP_RUN_MILES;
  const costSaved = (milesSaved / CAR_MPG) * 4.546 * FUEL_PRICE_PER_LITRE;
  const kgDiverted = collected.reduce((sum, l) => sum + (WEIGHT_BAND_KG[l.weight_band] || WEIGHT_BAND_KG.medium), 0);

  document.getElementById("homeownerImpactStats").innerHTML = `
    <div class="stat-box save"><strong>${timeSavedLabel}</strong><span>Time saved</span></div>
    <div class="stat-box save"><strong>&pound;${costSaved.toFixed(0)}</strong><span>Fuel &amp; cost saved</span></div>
    <div class="stat-box save"><strong>${kgDiverted.toFixed(0)} kg</strong><span>${impactTierLabel(kgDiverted)} &middot; diverted</span></div>
  `;
}

export function renderMyListingsList(listings, myRatings) {
  const list = document.getElementById("myListingsList");
  if (!listings.length) {
    list.innerHTML = `<p class="job-meta">No listings yet — head to List to get your first collection booked.</p>`;
    return;
  }
  list.innerHTML = listings.map(l => {
    const { label, at, assignment } = homeownerListingStatus(l);
    const dateLabel = at ? new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "";
    let actionHTML = "";
    let metaExtra = "";
    if (label === "Pending") {
      actionHTML = l.is_boosted
        ? `<span class="tag boosted-tag">&#128640; Boosted</span>`
        : `<button class="add-btn" data-boost="${l.id}">Boost &mdash; &pound;1.99</button>`;
    } else if (label === "Scheduled" && assignment) {
      // Normally the collector taps "Mark collected" themselves once they've done the
      // job — this is the homeowner's own fallback for when that doesn't happen (easy
      // to forget when you're not looking at the app), so their listing doesn't stay
      // stuck at "Scheduled" forever with no way to rate the collector afterwards.
      const collectorName = (assignment.profiles && assignment.profiles.display_name) || "your collector";
      metaExtra = ` &middot; ${esc(collectorName)}`;
      actionHTML = `<button class="add-btn" data-mark-collected="${assignment.id}">Mark as collected</button>`;
    } else if (label === "Collected" && assignment) {
      const collectorName = (assignment.profiles && assignment.profiles.display_name) || "your collector";
      metaExtra = ` &middot; by ${esc(collectorName)}`;
      const existingStars = myRatings && myRatings.get(assignment.id);
      actionHTML = existingStars
        ? `<span class="tag">You rated: ${renderStars(existingStars)}</span>`
        : `<button class="add-btn" data-rate="${assignment.id}" data-collector-id="${assignment.collector_id}" data-collector-name="${esc(collectorName)}">Rate your collector</button>`;
    }
    return `
    <div class="job-card ${l.is_boosted ? "boosted" : ""}">
      <span class="job-icon" aria-hidden="true">${TYPE_ICON[l.metal_type] || TYPE_ICON.mixed}</span>
      <div class="job-body">
        <h4>${esc(l.title)}</h4>
        <p class="job-meta">${esc(l.address)}</p>
        <div class="job-tags">
          <span class="status-pill status-${label.toLowerCase()}">${label}</span>
          ${dateLabel ? `<span class="tag">${STATUS_DATE_VERB[label]} ${esc(dateLabel)}${metaExtra}</span>` : ""}
        </div>
        ${actionHTML ? `<div class="job-actions">${actionHTML}</div>` : ""}
      </div>
    </div>`;
  }).join("");
}

export async function renderHomeownerListingsHub() {
  if (!SCRAPMAN_AUTH_CONFIGURED || !scrapmanSession) return;
  const [listings, myRatings] = await Promise.all([getMyListings(), getMyRatings()]);
  renderHomeownerImpact(listings);
  renderMyListingsList(listings, myRatings);
}

document.getElementById("myListingsList").addEventListener("click", e => {
  const boostBtn = e.target.closest("[data-boost]");
  if (boostBtn) { startBoost(Number(boostBtn.dataset.boost)); return; }
  const rateBtn = e.target.closest("[data-rate]");
  if (rateBtn) {
    startRating(Number(rateBtn.dataset.rate), rateBtn.dataset.collectorId, rateBtn.dataset.collectorName);
    return;
  }
  const markCollectedBtn = e.target.closest("[data-mark-collected]");
  if (markCollectedBtn) markListingCollected(Number(markCollectedBtn.dataset.markCollected), markCollectedBtn);
});

export async function markListingCollected(assignmentId, btn) {
  btn.disabled = true;
  btn.textContent = "Marking as collected…";
  const { error } = await scrapmanDb.from("job_assignments").update({ status: "completed" }).eq("id", assignmentId);
  if (error) {
    btn.disabled = false;
    btn.textContent = "Mark as collected";
    alert("Couldn't update this listing — please try again.");
    console.error(error);
    return;
  }
  renderHomeownerListingsHub();
}

/* ---------- rate your collector (homeowner, on a Collected listing) ---------- */
export let pendingRatingAssignmentId = null;
export let pendingRatingCollectorId = null;
export let selectedRatingStars = 0;

export function paintStars(upTo) {
  document.querySelectorAll("#starPicker .star-btn").forEach(btn => {
    btn.classList.toggle("selected", Number(btn.dataset.star) <= upTo);
  });
}

document.querySelectorAll("#starPicker .star-btn").forEach(btn => {
  btn.addEventListener("mouseenter", () => paintStars(Number(btn.dataset.star)));
  btn.addEventListener("mouseleave", () => paintStars(selectedRatingStars));
  btn.addEventListener("click", () => {
    selectedRatingStars = Number(btn.dataset.star);
    paintStars(selectedRatingStars);
  });
});

export function startRating(assignmentId, collectorId, collectorName) {
  pendingRatingAssignmentId = assignmentId;
  pendingRatingCollectorId = collectorId;
  selectedRatingStars = 0;
  paintStars(0);
  document.getElementById("rateCollectorName").textContent = `How was your collection with ${collectorName || "your collector"}?`;
  document.getElementById("rateComment").value = "";
  document.getElementById("rateStatus").classList.add("hidden");
  const btn = document.getElementById("submitRatingBtn");
  btn.disabled = false;
  btn.textContent = "Submit rating";
  openSheet("overlay-rate");
}

document.getElementById("submitRatingBtn").addEventListener("click", async () => {
  if (pendingRatingAssignmentId == null) return;
  const statusEl = document.getElementById("rateStatus");
  if (!selectedRatingStars) {
    statusEl.textContent = "Pick a star rating first.";
    statusEl.className = "demo-note status-error";
    statusEl.classList.remove("hidden");
    return;
  }
  const btn = document.getElementById("submitRatingBtn");
  btn.disabled = true;
  btn.textContent = "Submitting…";
  const { error } = await scrapmanDb.from("ratings").insert({
    assignment_id: pendingRatingAssignmentId,
    rater_id: scrapmanSession.user.id,
    ratee_id: pendingRatingCollectorId,
    stars: selectedRatingStars,
    comment: document.getElementById("rateComment").value.trim() || null
  });
  btn.disabled = false;
  btn.textContent = "Submit rating";
  if (error) {
    statusEl.textContent = "Couldn't submit your rating — please try again.";
    statusEl.className = "demo-note status-error";
    statusEl.classList.remove("hidden");
    console.error(error);
    return;
  }
  closeSheet();
  renderHomeownerListingsHub();
});

export let pendingBoostId = null;

export function startBoost(id) {
  pendingBoostId = id;
  const btn = document.getElementById("boostBtn");
  btn.disabled = false;
  btn.textContent = "Boost — £1.99";
  openSheet("overlay-boost");
}

document.getElementById("boostBtn").addEventListener("click", async () => {
  if (pendingBoostId == null) return;
  const btn = document.getElementById("boostBtn");
  btn.disabled = true;
  btn.textContent = "Redirecting to Stripe…";
  try {
    await startStripeCheckout("/create-boost-session", { listingId: pendingBoostId });
  } catch {
    btn.disabled = false;
    btn.textContent = "Boost — £1.99";
    alert("Couldn't start checkout — please try again in a moment.");
  }
});

