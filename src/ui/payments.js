import { isVerified } from "../state.js";
import { goTo, openSheet, closeSheet } from "./navigation.js";
import { renderJobs } from "./jobs.js";
import { renderAccount } from "./account.js";
import { renderHomeownerListingsHub } from "./homeowner.js";

let pendingUnlockId = null;

/* ---------- unlock & payment (real Stripe Checkout — see verify-collector/server.js) ----------
   Both flows redirect the whole page to Stripe's hosted checkout page; nothing is
   provisioned until Stripe's webhook confirms the payment server-side (see
   supabase/migrations/001_stripe_payments.sql for why the client can't grant this
   itself). Same cPanel Node app as VERIFY_ENDPOINT (declared further down) — kept as
   its own constant here rather than referencing that one, since it's declared later
   in this file and top-level `const` can't be read before its own declaration runs. */
export const BILLING_ENDPOINT = "/verify-collector";

export async function startStripeCheckout(path, body) {
  const { data: { session } } = await scrapmanDb.auth.getSession();
  const res = await fetch(`${BILLING_ENDPOINT}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session && session.access_token}`
    },
    body: JSON.stringify(body || {})
  });
  if (!res.ok) throw new Error(`status ${res.status}`);
  const { url } = await res.json();
  window.location.href = url;
}

export async function startUnlock(id) {
  if (!isVerified()) {
    openSheet("overlay-verifyPrompt");
    return;
  }
  pendingUnlockId = id;
  const payBtn = document.getElementById("payBtn");
  payBtn.disabled = false;
  payBtn.textContent = "Pay £1.50";
  openSheet("overlay-pay");
}

document.getElementById("payBtn").addEventListener("click", async () => {
  if (pendingUnlockId == null) return;
  const payBtn = document.getElementById("payBtn");
  payBtn.disabled = true;
  payBtn.textContent = "Redirecting to Stripe…";
  try {
    await startStripeCheckout("/create-checkout-session", { listingId: pendingUnlockId });
  } catch {
    payBtn.disabled = false;
    payBtn.textContent = "Pay £1.50";
    alert("Couldn't start checkout — please try again in a moment.");
  }
});

document.getElementById("verifyPromptBtn").addEventListener("click", () => {
  closeSheet();
  goTo("verify");
});

/* ---------- Pro subscription (real Stripe Checkout, recurring) ---------- */
document.getElementById("goProBtn").addEventListener("click", () => {
  const btn = document.getElementById("proBtn");
  btn.disabled = false;
  btn.textContent = "Subscribe — £6.99/mo";
  openSheet("overlay-pro");
});

document.getElementById("proBtn").addEventListener("click", async () => {
  const btn = document.getElementById("proBtn");
  btn.disabled = true;
  btn.textContent = "Redirecting to Stripe…";
  try {
    await startStripeCheckout("/create-subscription-session");
  } catch {
    btn.disabled = false;
    btn.textContent = "Subscribe — £6.99/mo";
    alert("Couldn't start checkout — please try again in a moment.");
  }
});

/* Returning from Stripe Checkout — the page does a full reload at success_url/cancel_url,
   so this just needs to run once at boot (see the init section at the bottom of this file). */
export function handleStripeReturn() {
  const params = new URLSearchParams(window.location.search);
  const status = params.get("stripe");
  if (!status) return;
  const flow = params.get("flow");
  history.replaceState(null, "", window.location.pathname);

  if (status === "success" && flow === "pro") {
    // Pro status is cached on scrapmanSession — refresh it so isPro() reflects the
    // webhook's write (which usually lands before this redirect completes, but not
    // guaranteed), then re-render whatever's currently showing it.
    scrapmanRefreshSession().then(() => { renderAccount(); renderJobs(); });
    alert("You're on ScrapMan Pro — every job's contact details are now visible.");
  } else if (status === "success" && flow === "boost") {
    setTimeout(renderHomeownerListingsHub, 1500); // give the webhook a moment to land
    alert("Boost paid — your listing now sits at the top of collectors' feeds.");
  } else if (status === "success") {
    setTimeout(renderJobs, 1500); // give the webhook a moment to land
    alert("Payment received — the contact details are unlocked below.");
  } else if (status === "cancel") {
    alert("Checkout was cancelled — nothing was charged.");
  }
}

/* ---------- verification (live-checked against the EA public register) ---------- */
