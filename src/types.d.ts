/* Type declarations for the ES-module frontend.
 *
 * Two separate concerns live here, both caused by moving app.js into src/ (where tsconfig
 * actually looks): root-level app.js was never covered by `include`, so none of this code had
 * been typechecked before.
 */

/* 1. Globals published by the classic scripts.
 *
 * index.html loads geo.js, supabase-config.js and auth.js as plain <script> tags, before the
 * module entry point. They cannot be ES modules: the plain council SEO pages load geo.js and
 * auth.js too, and those pages have no build step. So they publish their API on `window` and
 * src/state.js + src/ui/* read it directly.
 *
 * Typed `any` on purpose — those scripts are not part of the checkJs surface yet, so any
 * signature written here would be an unverified guess. When they are converted, delete the
 * matching line below and the compiler will point at every real call site.
 */
declare var scrapmanDb: any;
declare var scrapmanSession: any;
declare var SCRAPMAN_AUTH_CONFIGURED: any;
declare var scrapmanRole: any;
declare var scrapmanApplyRoleUI: any;
declare var scrapmanLoadProfile: any;
declare var scrapmanEmitAuthChange: any;
declare var scrapmanRefreshSession: any;
declare var scrapmanSignUp: any;
declare var scrapmanSignIn: any;
declare var scrapmanSignOut: any;
declare var scrapmanRequestPasswordReset: any;
declare var scrapmanUpdatePassword: any;
declare var scrapmanGeocodePostcode: any;
declare var scrapmanReverseGeocode: any;
declare var scrapmanRequestGeolocation: any;
declare var scrapmanAutoLocate: any;
declare var scrapmanSavedLocation: any;
declare var scrapmanSaveLocation: any;
declare var scrapmanLocationFromApiResult: any;
declare var scrapmanCouncilSlug: any;
declare var scrapmanCouncilLink: any;
declare var scrapmanHaversine: any;
declare var scrapmanStartBroadcastingLocation: any;
declare var scrapmanStopBroadcastingLocation: any;
declare var scrapmanSubscribeToLocation: any;
declare var scrapmanUnsubscribeFromLocation: any;

/* Leaflet, loaded from the CDN by index.html. The map code feature-detects it
 * (`typeof L === "undefined"`) so the rest of the screen still renders offline. */
declare var L: any;

/* 2. DOM typing conveniences for the UI glue.
 *
 * The UI modules query an element and then use the property of the concrete element it always
 * is ("value" on an input, "disabled" on a button). TypeScript types getElementById() as
 * HTMLElement and querySelector() as Element, neither of which carries those members, so every
 * call site would need its own JSDoc cast — ~90 of them, which buries the logic in casts.
 *
 * These augmentations describe what this app actually queries. Deliberately narrow: no index
 * signature, so a genuinely misspelled member is still a compile error.
 */
interface HTMLElement {
  value: string;
  disabled: boolean;
  href: string;
  setCustomValidity(message: string): void;
  reportValidity(): boolean;
}

interface Element {
  dataset: DOMStringMap;
  onclick: any;
}

interface EventTarget {
  /** e.target is an EventTarget, but in every handler here it is an element. */
  closest<E extends Element = Element>(selectors: string): E | null;
  /** e.target is a <form> in the submit handlers. */
  reset(): void;
  /** e.target is a <form> or a container in the delegated handlers. */
  querySelector(selectors: string): Element | null;
  /** e.target is the file <input> in the photo handler. */
  files: any;
}

interface Navigator {
  /** iOS Safari home-screen flag (isStandalone() in src/ui/account.js). */
  standalone?: boolean;
}

interface Window {
  /** Legacy IE/Edge check in isIOS(). */
  MSStream?: unknown;
}
