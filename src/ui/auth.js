/* ---------- auth (accounts, gated entirely by SCRAPMAN_AUTH_CONFIGURED) ---------- */
export let authMode = "signup";
export let authRoleChoice = "homeowner";

export function setAuthRoleChoice(role) {
  authRoleChoice = role;
  document.querySelectorAll("#authRoleGroup .pill").forEach(p => p.classList.toggle("active", p.dataset.roleChoice === role));
}

export function applyAuthMode() {
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
  setAuthRoleChoice(pill.dataset.roleChoice);
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

