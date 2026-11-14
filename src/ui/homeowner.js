import { esc } from "../state.js";
import { AVG_TIP_RUN_MILES, CAR_MPG, FUEL_PRICE_PER_LITRE, TIME_SAVED_MINUTES_PER_COLLECTION, WEIGHT_BAND_KG, impactTierLabel } from "../domain/rates.js";
import { TYPE_ICON } from "../domain/labels.js";
import { openSheet, closeSheet } from "./navigation.js";
import { startStripeCheckout } from "./payments.js";
import { badgeProgress, formatKg } from "../domain/badges.js";
import { openTransferNote, openDisputeSheet, openProofSheet, proofPhotoUrl } from "./proofs.js";

/* ---------- homeowner "My listings" hub: history, impact counters, boost ---------- */

export async function getMyListings() {
  if (!SCRAPMAN_AUTH_CONFIGURED || !scrapmanSession) return [];
  const { data, error } = await scrapmanDb
    .from("listings")
    .select("*, job_assignments(id, status, accepted_at, updated_at, collector_id, completed_without_proof, profiles(display_name)), job_proofs(photo_path, photo_url)")
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
/* Households get a recycling badge, deliberately not a star rating. The badge is built from
 * the weights collectors actually recorded in job_proofs, so it rewards recycling instead of
 * being a public opinion score attached to somebody's home address. */
function householdBadgeHTML(badge) {
  if (!badge) return "";
  const progress = badgeProgress(badge.total_kg, badge.collections);
  const next = progress.next
    ? `<span class="badge-progress">${esc(formatKg(progress.kgToNext))} to ${esc(progress.next.label)}</span>`
    : `<span class="badge-progress">Top tier &middot; thank you</span>`;
  return `<div class="badge-row">
      <span class="badge-chip tier-${progress.tier.key}">${esc(progress.tier.label)} &middot; ${esc(formatKg(progress.kg))}</span>
      ${next}
    </div>`;
}

export function renderHomeownerImpact(listings, badge) {
  const collected = listings.filter(l => l.status === "collected");
  const timeSavedMins = collected.length * TIME_SAVED_MINUTES_PER_COLLECTION;
  const timeSavedLabel = timeSavedMins >= 60 ? `${(timeSavedMins / 60).toFixed(1)} hrs` : `${timeSavedMins} min`;
  const milesSaved = collected.length * AVG_TIP_RUN_MILES;
  const costSaved = (milesSaved / CAR_MPG) * 4.546 * FUEL_PRICE_PER_LITRE;
  const kgDiverted = collected.reduce((sum, l) => sum + (WEIGHT_BAND_KG[l.weight_band] || WEIGHT_BAND_KG.medium), 0);

  document.getElementById("homeownerImpactStats").innerHTML = `
    ${householdBadgeHTML(badge)}
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
      actionHTML = `<button class="add-btn" data-mark-collected="${assignment.id}" data-listing-id="${l.id}">Mark as collected</button>
        <button class="add-btn" data-dispute="${assignment.id}">Nobody turned up?</button>`;
    } else if (label === "Collected" && assignment) {
      const collectorName = (assignment.profiles && assignment.profiles.display_name) || "your collector";
      metaExtra = ` &middot; by ${esc(collectorName)}`;
      const existingStars = myRatings && myRatings.get(assignment.id);
      const proof = Array.isArray(l.job_proofs) ? l.job_proofs[0] : l.job_proofs;
      const photoPath = proof && (proof.photo_path || proof.photo_url);
      // A household can mark a job collected without evidence (migration 005) — the
      // collector forgot, or their phone died. That path issues no waste transfer note,
      // so say so on the card instead of letting it look like an evidenced job, and
      // offer the weight form to turn it into a real record.
      const noProof = assignment.completed_without_proof === true;
      actionHTML = (existingStars
        ? `<span class="tag">You rated: ${renderStars(existingStars)}</span>`
        : `<button class="add-btn" data-rate="${assignment.id}" data-collector-id="${assignment.collector_id}" data-collector-name="${esc(collectorName)}">Rate your collector</button>`)
        + (noProof
          ? `<span class="tag tag-warning">No collection record</span>`
            + `<button class="add-btn" data-add-proof="${assignment.id}" data-listing-id="${l.id}" data-collector-id="${assignment.collector_id}">Add weight &amp; photo</button>`
          : "")
        + (photoPath ? `<button class="add-btn" data-view-photo="${esc(photoPath)}">View photo</button>` : "")
        + `<button class="add-btn" data-transfer-note="${l.id}">Collection record</button>`
        + `<button class="add-btn" data-dispute="${assignment.id}">Something wrong?</button>`;
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

async function getHouseholdBadge() {
  if (!SCRAPMAN_AUTH_CONFIGURED || !scrapmanSession) return null;
  const { data, error } = await scrapmanDb.rpc("household_badge", { p_homeowner: scrapmanSession.user.id });
  if (error || !data || !data.length) return null;
  return data[0];
}

export async function renderHomeownerListingsHub() {
  if (!SCRAPMAN_AUTH_CONFIGURED || !scrapmanSession) return;
  const [listings, myRatings, badge] = await Promise.all([getMyListings(), getMyRatings(), getHouseholdBadge()]);
  renderHomeownerImpact(listings, badge);
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
  const addProofBtn = e.target.closest("[data-add-proof]");
  if (addProofBtn) {
    openProofSheet({
      assignment_id: Number(addProofBtn.dataset.addProof),
      listing_id: Number(addProofBtn.dataset.listingId),
      collector_id: addProofBtn.dataset.collectorId,
      title: "Record what was collected"
    });
    return;
  }
  const viewPhotoBtn = e.target.closest("[data-view-photo]");
  if (viewPhotoBtn) {
    // The bucket is private: the object path alone is useless, so mint a short-lived
    // signed URL for this participant rather than exposing a permanent public link.
    proofPhotoUrl(viewPhotoBtn.dataset.viewPhoto).then(url => {
      if (url) window.open(url, "_blank", "noopener");
      else alert("That photo isn't available right now — please try again.");
    });
    return;
  }
  const noteBtn = e.target.closest("[data-transfer-note]");
  if (noteBtn) { openTransferNote(Number(noteBtn.dataset.transferNote)); return; }
  const disputeBtn = e.target.closest("[data-dispute]");
  if (disputeBtn) {
    openDisputeSheet({
      assignment_id: Number(disputeBtn.dataset.dispute),
      title: "Something wrong with this collection"
    });
    return;
  }
});

export async function markListingCollected(assignmentId, btn) {
  btn.disabled = true;
  btn.textContent = "Marking as collected…";
  // If the collector already recorded what they took, this is just a status nudge and
  // the job is evidenced. If nothing was recorded, say so on the assignment so the
  // missing transfer note is visible rather than implied.
  const listingId = btn.dataset.listingId ? Number(btn.dataset.listingId) : null;
  let hasProof = false;
  if (listingId) {
    const { data: proof } = await scrapmanDb.from("job_proofs").select("id").eq("listing_id", listingId).maybeSingle();
    hasProof = !!proof;
  }
  const patch = hasProof ? { status: "completed" } : { status: "completed", completed_without_proof: true };
  const { error } = await scrapmanDb.from("job_assignments").update(patch).eq("id", assignmentId);
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

