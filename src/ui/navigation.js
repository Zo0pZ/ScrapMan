import { ensureLocation, updateLocationUI, personalizeCouncilLink } from "./location.js";
import { initJobsMap, renderRoute, renderActiveAssignment, renderTrack } from "./jobs.js";
import { prefillPostcodeFromLocation } from "./listScrap.js";
import { renderAccount } from "./account.js";
import { renderCollectorDashboard } from "./collector.js";
import { renderHomeownerListingsHub } from "./homeowner.js";
import { renderMessages, renderThread, unsubscribeFromThreadMessages } from "./messaging.js";
import { setAuthRoleChoice } from "./auth.js";

/* ---------- navigation ---------- */
// Home and Pricing are the two screens marked data-public in index.html — browsable
// without an account (marketing pitch + full pricing). Reaching them the first time
// (page load, before any goTo() call) worked, but clicking to any OTHER screen and
// back did not: every screen except literally "auth" used to force-redirect there,
// so once you navigated away signed out, even clicking the Home tab just kept
// re-showing Auth with no way back short of a refresh. Keep this list in sync with
// which screens actually carry data-public content.
export const PUBLIC_SCREENS_SIGNED_OUT = ["auth", "home", "pricing"];

export function goTo(screen) {
  // Signed-out + configured: anything not public redirects to sign-up/sign-in.
  if (SCRAPMAN_AUTH_CONFIGURED && !scrapmanSession && !PUBLIC_SCREENS_SIGNED_OUT.includes(screen)) {
    screen = "auth";
  }
  if (screen !== "thread") unsubscribeFromThreadMessages();
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById("screen-" + screen).classList.add("active");
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.nav === screen));
  if (screen === "jobs") { updateLocationUI(); setTimeout(initJobsMap, 0); ensureLocation().then(initJobsMap); renderActiveAssignment(); }
  if (screen === "route") { updateLocationUI(); setTimeout(renderRoute, 0); ensureLocation().then(renderRoute); }
  if (screen === "track") { renderTrack(); renderHomeownerListingsHub(); }
  if (screen === "home") {
    personalizeCouncilLink();
    if (scrapmanRole() === "collector") renderCollectorDashboard();
  }
  if (screen === "list") prefillPostcodeFromLocation();
  if (screen === "messages") renderMessages();
  if (screen === "thread") renderThread();
  if (screen === "account") { renderAccount(); personalizeCouncilLink(); }
}

document.querySelectorAll("[data-nav]").forEach(el => {
  el.addEventListener("click", () => {
    // Most screens bounce a signed-out visitor to the auth screen by goTo() below
    // (Home/Pricing are the exceptions — see PUBLIC_SCREENS_SIGNED_OUT) — if the
    // element they clicked was itself role-specific (e.g. "Get my scrap collected" vs
    // "Find jobs near me"), carry that choice over so the right pill is already
    // selected on the register form instead of defaulting back to homeowner.
    if (el.dataset.role === "homeowner" || el.dataset.role === "collector") {
      setAuthRoleChoice(el.dataset.role);
    }
    goTo(el.dataset.nav);
  });
});


/* ---------- Home hero carousel ----------
   Both .hero-slide elements are data-public, so while the role is still unknown
   (signed out) scrapmanApplyRoleUI() leaves both visible — this turns that into an
   actual swipeable/auto-advancing carousel between the homeowner and collector
   pitches. The moment a role IS known, exactly one slide stays visible (the other
   gets .hidden by the normal data-role gating, unrelated to this function), and this
   just detects that and leaves it as a plain static hero — no dots, no timer. */
export let heroCarouselTimer = null;

export function initHeroCarousel() {
  const track = document.getElementById("heroTrack");
  const dotsEl = document.getElementById("heroDots");
  if (!track || !dotsEl) return;

  clearInterval(heroCarouselTimer);
  heroCarouselTimer = null;

  const visible = [...track.children].filter(s => !s.classList.contains("hidden"));
  if (visible.length <= 1) { dotsEl.classList.add("hidden"); return; }
  dotsEl.classList.remove("hidden");

  const dots = [...dotsEl.children];
  const goToSlide = i => track.scrollTo({ left: track.clientWidth * i, behavior: "smooth" });
  // Any manual interaction (a dot, or swiping/scrolling the track directly) stops the
  // auto-advance for good — resuming it after a manual pick would just fight whoever
  // is still reading the slide they chose.
  const stopAutoAdvance = () => { clearInterval(heroCarouselTimer); heroCarouselTimer = null; };

  dots.forEach((dot, i) => { dot.onclick = () => { goToSlide(i); stopAutoAdvance(); }; });
  track.onscroll = () => {
    const i = Math.round(track.scrollLeft / (track.clientWidth || 1));
    dots.forEach((dot, di) => dot.classList.toggle("active", di === i));
  };
  track.addEventListener("pointerdown", stopAutoAdvance, { once: true });

  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
    heroCarouselTimer = setInterval(() => {
      const current = Math.round(track.scrollLeft / (track.clientWidth || 1));
      goToSlide((current + 1) % visible.length);
    }, 6000);
  }
}

window.addEventListener("scrapman:auth", () => {
  scrapmanApplyRoleUI();
  initHeroCarousel();
  const onAuthScreen = document.getElementById("screen-auth").classList.contains("active");
  if (scrapmanSession && onAuthScreen) goTo("home");
  if (SCRAPMAN_AUTH_CONFIGURED && !scrapmanSession && !onAuthScreen) goTo("auth");
  // Covers the case goTo("home") doesn't: a returning collector whose session loads
  // asynchronously while the Home screen is already active from the static markup
  // (see the "init" section further down, which can't know the role yet).
  const onHomeScreen = document.getElementById("screen-home").classList.contains("active");
  if (onHomeScreen && scrapmanRole() === "collector") renderCollectorDashboard();
});

/* ---------- bottom sheets ---------- */
export function openSheet(id) {
  closeSheet();
  document.getElementById(id).classList.add("open");
}
export function closeSheet() {
  document.querySelectorAll(".overlay.open").forEach(o => o.classList.remove("open"));
}
document.querySelectorAll(".overlay").forEach(o => {
  o.addEventListener("click", e => { if (e.target === o) closeSheet(); });
});
document.querySelectorAll(".sheet-close").forEach(btn => {
  btn.addEventListener("click", closeSheet);
});

