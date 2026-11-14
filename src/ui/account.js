/* ---------- account screen ---------- */
export function renderAccount() {
  // accVerify/accPro are collector-only (data-role="collector" hides them from
  // homeowners via scrapmanApplyRoleUI). Skip building their content at all for a
  // signed-in homeowner rather than just relying on the CSS to hide it — but only
  // once accounts/roles are real; in unconfigured demo mode (no accounts at all)
  // they still render as a preview, same as every other data-role element.
  if (SCRAPMAN_AUTH_CONFIGURED && scrapmanRole() && scrapmanRole() !== "collector") {
    document.getElementById("accVerify").innerHTML = "";
    document.getElementById("accPro").innerHTML = "";
    renderInstallRow();
    return;
  }

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
         <div><strong>ScrapMan Pro</strong><span>Unlimited contact unlocks</span></div>
         <button class="add-btn" id="manageProBtn">Manage subscription</button>
       </div>`
    : `<div class="toggle-row">
         <div><strong>Free plan</strong><span>&pound;1.50 per contact unlock</span></div>
         <button class="add-btn" id="accGoProBtn">Go Pro</button>
       </div>`;
  const manageBtn = document.getElementById("manageProBtn");
  if (manageBtn) manageBtn.addEventListener("click", async () => {
    manageBtn.disabled = true;
    manageBtn.textContent = "Redirecting to Stripe…";
    try {
      await startStripeCheckout("/customer-portal");
    } catch {
      manageBtn.disabled = false;
      manageBtn.textContent = "Manage subscription";
      alert("Couldn't open the billing portal — please try again in a moment.");
    }
  });
  const goProBtn = document.getElementById("accGoProBtn");
  if (goProBtn) goProBtn.addEventListener("click", () => {
    const btn = document.getElementById("proBtn");
    btn.disabled = false;
    btn.textContent = "Subscribe — £6.99/mo";
    openSheet("overlay-pro");
  });

  renderInstallRow();
}


/* ---------- install prompt ---------- */
export function isStandalone() {
  return matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
}
export function isIOS() {
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

export function renderInstallRow() {
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

