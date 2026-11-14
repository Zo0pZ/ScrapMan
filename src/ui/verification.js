import { goTo } from "./navigation.js";

export const VERIFY_ENDPOINT = "/verify-collector";

export function setVerifyStatus(text, kind) {
  const el = document.getElementById("verifyStatus");
  el.textContent = text;
  el.className = "demo-note" + (kind ? ` status-${kind}` : "");
  el.classList.toggle("hidden", !text);
}

export function describeCheckFailure(check, label) {
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
    // /submit-verification (not the plain /verify-collector check) — it re-runs the EA
    // check itself server-side and, only if that succeeds, writes collector_profiles
    // with its own service_role key. The client can no longer write verification_status
    // itself (see supabase/migrations/003_close_rls_gaps.sql) — a self-reported "yes
    // I'm verified" from the browser can't be trusted.
    const { data: { session } } = await scrapmanDb.auth.getSession();
    const res = await fetch(`${VERIFY_ENDPOINT}/submit-verification`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session && session.access_token}`
      },
      body: JSON.stringify({
        businessName: profile.businessName, carrierRef: profile.carrierRef,
        smdCouncil: profile.smdCouncil, smdLicence: profile.smdLicence, insurance: profile.insurance
      })
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

  // The server has already written the verified status above — just refresh our
  // cached copy of it.
  await scrapmanRefreshSession();
  goTo("account");
});

document.getElementById("insuranceGroup").addEventListener("click", e => {
  const pill = e.target.closest(".pill");
  if (!pill) return;
  document.querySelectorAll("#insuranceGroup .pill").forEach(p => p.classList.remove("active"));
  pill.classList.add("active");
});

