import { esc } from "../state.js";
import { openSheet, closeSheet } from "./navigation.js";
import {
  parseWeightKg,
  buildTransferNote,
  transferNoteHtml,
  transferNoteReference,
  PAYMENT_METHODS
} from "../domain/transferNote.js";

/* ---------- proof of collection, disputes, and the printable transfer note ----------
 *
 * Why this screen exists: the app used to jump straight from "scheduled" to "collected"
 * with nothing recorded. In scrap the argument is always about weight, so the collector
 * now records what actually changed hands — kilograms, how it was paid, an optional
 * photo and note — and that row is what completes the job.
 *
 * The completion itself is done by a database trigger (record_collection_proof in
 * migration 006), not by this module. One insert therefore: marks the assignment
 * completed, writes the statutory transfer note, and notifies the homeowner. Doing it
 * client-side would let a crafted request mark a job complete with no proof at all.
 */

let pending = null;

function el(id) {
  return document.getElementById(id);
}

function showError(id, message) {
  const box = el(id);
  if (!box) return;
  box.textContent = message || "";
  box.hidden = !message;
}

function paymentOptions() {
  return PAYMENT_METHODS.map(
    (method) => `<option value="${esc(method.value)}">${esc(method.label)}</option>`
  ).join("");
}

/* ---------- proof sheet ---------- */

export function openProofSheet(assignment) {
  pending = assignment || null;
  if (!pending) return;

  const title = el("proofTitle");
  if (title) title.textContent = pending.title || "Confirm collection";

  const payment = el("proofPayment");
  if (payment && !payment.querySelectorAll("option").length) payment.innerHTML = paymentOptions();

  const weight = el("proofWeight");
  if (weight) weight.value = "";
  const note = el("proofNote");
  if (note) note.value = "";
  const photo = el("proofPhoto");
  if (photo) photo.value = "";
  showError("proofError", "");
  const status = el("proofStatus");
  if (status) status.hidden = true;

  openSheet("overlay-proof");
}

/* The job-proofs bucket is private (see migration 007), so the stored object path is not
 * a URL. Mint a short-lived signed link for the participant looking at it. */
export async function proofPhotoUrl(path) {
  if (!path || !SCRAPMAN_AUTH_CONFIGURED) return "";
  const { data, error } = await scrapmanDb.storage.from("job-proofs").createSignedUrl(path, 300);
  if (error) {
    console.error(error);
    return "";
  }
  return (data && data.signedUrl) || "";
}

async function uploadProofPhoto(listingId, file) {
  if (!file) return null;
  if (!SCRAPMAN_AUTH_CONFIGURED) return null;
  const safeName = String(file.name || "photo.jpg").replace(/[^a-zA-Z0-9._-]/g, "-");
  const path = `${listingId}/${Date.now()}-${safeName}`;
  const { error } = await scrapmanDb.storage.from("job-proofs").upload(path, file, {
    cacheControl: "3600",
    upsert: false
  });
  return error ? null : path;
}

export async function submitCollectionProof() {
  if (!pending) return;
  const button = el("proofSubmit");
  const weightInput = el("proofWeight");
  const weight = parseWeightKg(weightInput ? weightInput.value : "");
  if (!weight) {
    showError("proofError", "Enter the weight in kilograms — between 1 and 50,000.");
    return;
  }

  if (!SCRAPMAN_AUTH_CONFIGURED || !scrapmanSession || !scrapmanSession.user) {
    showError("proofError", "Sign in to record a collection.");
    return;
  }

  const payment = el("proofPayment");
  const note = el("proofNote");
  const photoInput = el("proofPhoto");
  const file = photoInput && photoInput.files && photoInput.files[0] ? photoInput.files[0] : null;

  if (button) {
    button.disabled = true;
    button.textContent = "Recording…";
  }
  showError("proofError", "");

  try {
    const photoPath = await uploadProofPhoto(pending.listing_id, file);
    const { error } = await scrapmanDb.from("job_proofs").insert({
      listing_id: pending.listing_id,
      assignment_id: pending.assignment_id,
      // A household may record the weight on the assigned collector's behalf (their phone
      // died, they never bothered). The RLS policy requires the row to point at the
      // collector actually on the job, so never stamp the signed-in user's id blindly.
      collector_id: pending.collector_id || scrapmanSession.user.id,
      weight_kg: weight,
      payment_method: payment ? payment.value : "electronic",
      note: note && note.value.trim() ? note.value.trim().slice(0, 500) : null,
      photo_path: photoPath
    });

    if (error) {
      const duplicate = /duplicate|unique/i.test(error.message || "");
      showError(
        "proofError",
        duplicate
          ? "This job already has a collection record."
          : "Could not record the collection. Please try again."
      );
      return;
    }

    const status = el("proofStatus");
    if (status) {
      status.hidden = false;
      status.textContent = `Collection recorded. Transfer note ${transferNoteReference(
        pending.listing_id,
        new Date()
      )} issued.`;
    }
    if (typeof window.scrapmanRefreshJobs === "function") window.scrapmanRefreshJobs();
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Record collection";
    }
  }
}

/* ---------- dispute sheet ---------- */

export function openDisputeSheet(assignment) {
  pending = assignment || null;
  if (!pending) return;
  const title = el("disputeTitle");
  if (title) title.textContent = pending.title || "Dispute this collection";
  const reason = el("disputeReason");
  if (reason) reason.value = "";
  showError("disputeError", "");
  openSheet("overlay-dispute");
}

export async function submitDispute() {
  if (!pending) return;
  const reason = el("disputeReason");
  const text = reason ? reason.value.trim() : "";
  if (text.length < 10) {
    showError("disputeError", "Please describe what went wrong (at least 10 characters).");
    return;
  }
  if (!SCRAPMAN_AUTH_CONFIGURED || !scrapmanSession || !scrapmanSession.user) {
    showError("disputeError", "Sign in to raise a dispute.");
    return;
  }

  const button = el("disputeSubmit");
  if (button) {
    button.disabled = true;
    button.textContent = "Sending…";
  }
  try {
    const { error } = await scrapmanDb.from("job_disputes").insert({
      listing_id: pending.listing_id,
      assignment_id: pending.assignment_id,
      raised_by: scrapmanSession.user.id,
      reason: text.slice(0, 1000)
    });
    if (error) {
      showError("disputeError", "Could not raise the dispute. Please try again.");
      return;
    }
    closeSheet();
    const status = el("proofStatus");
    if (status) {
      status.hidden = false;
      status.textContent = "Dispute raised — both sides can now see it on the job.";
    }
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Raise dispute";
    }
  }
}

/* ---------- printable transfer note ---------- */

export async function openTransferNote(listingId) {
  if (!SCRAPMAN_AUTH_CONFIGURED || !listingId) return;

  const { data, error } = await scrapmanDb
    .from("waste_transfer_notes")
    .select("reference,issued_at,payload")
    .eq("listing_id", Number(listingId))
    .maybeSingle();

  if (error || !data) {
    const status = el("proofStatus");
    if (status) {
      status.hidden = false;
      status.textContent = "No transfer note yet — one is issued the moment the collection is recorded.";
    }
    return;
  }

  const note = data.payload && data.payload.reference ? data.payload : buildTransferNote(data);
  const root = el("printRoot");
  if (!root) return;
  root.innerHTML = transferNoteHtml(note);
  document.body.classList.add("printing");
  window.print();
  window.setTimeout(() => document.body.classList.remove("printing"), 500);
}

/* ---------- wiring ---------- */

export function initProofs() {
  const submit = el("proofSubmit");
  if (submit) submit.addEventListener("click", submitCollectionProof);

  const dispute = el("disputeSubmit");
  if (dispute) dispute.addEventListener("click", submitDispute);

  // The sheets' own close buttons already work through navigation.js; these two give the
  // sheets a secondary "Cancel" affordance that clears the pending job reference.
  ["proofCancel", "disputeCancel"].forEach((id) => {
    const button = el(id);
    if (button) {
      button.addEventListener("click", () => {
        pending = null;
        closeSheet();
      });
    }
  });
}
