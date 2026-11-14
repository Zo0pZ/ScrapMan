/* ScrapMan — application entry point.
 *
 * index.html loads this as <script type="module">. Importing the UI modules below is what
 * registers their listeners (modules are deferred, so the DOM is already parsed by the
 * time they run); `init()` then performs the boot-time work that needs the modules loaded.
 *
 * geo.js, supabase-config.js and auth.js remain classic scripts loaded before this module:
 * they publish the globals (scrapmanDb, scrapmanSession, SCRAPMAN_AUTH_CONFIGURED,
 * scrapmanGeocodePostcode) that the modules import state from.
 */

import { renderJobs } from "./ui/jobs.js";
import { personalizeCouncilLink } from "./ui/location.js";
import { handleStripeReturn } from "./ui/payments.js";
import { initHeroCarousel } from "./ui/navigation.js";

export function init() {
  renderJobs();
  personalizeCouncilLink();
  handleStripeReturn();
  initHeroCarousel();

  // Unconfigured (demo) mode never fires scrapman:auth (see auth.js), so the normal trigger
  // for re-checking the carousel never happens either — DOMContentLoaded is what demo mode
  // uses instead (auth.js registers its own scrapmanApplyRoleUI() listener on it first, so
  // by registration order this always runs after that, seeing the correct hidden state).
  document.addEventListener("DOMContentLoaded", initHeroCarousel);

  /* PWA service worker */
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
}

init();
