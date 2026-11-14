"use strict";

/* ScrapMan — route table for the verify-collector service.
 *
 * cPanel's Node app proxy may or may not strip the mount path ("/verify-collector")
 * before a request reaches this process, so every route is matched by *suffix*
 * rather than by exact pathname: the same table works whether req.url arrives as
 * "/create-checkout-session" or "/verify-collector/create-checkout-session".
 *
 * The important change from the original if/else chain: an unmatched path returns
 * no route (the server answers 404) instead of falling through to the verification
 * handler, which used to answer *every* unrecognised URL with an Environment Agency
 * lookup result.
 */

/* An error a handler can throw to reject a request with a specific 4xx status,
   instead of the catch-all 502 that upstream failures get. */
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

/* Strip a trailing slash so "/verify-collector/metal-prices/" matches the same route
   as "/verify-collector/metal-prices". The root path is left alone. */
function normalizePathname(pathname) {
  const value = String(pathname || "/");
  return value.length > 1 && value.endsWith("/") ? value.replace(/\/+$/, "") : value;
}

function endsWithPath(pathname, suffix) {
  return pathname === suffix || pathname.endsWith(suffix);
}

/**
 * @typedef {object} Route
 * @property {string} name      Handler key the server switches on.
 * @property {string} path      Suffix to match against the request pathname.
 * @property {string[]} methods HTTP methods this route accepts.
 * @property {boolean} [jsonBody] Handler wants a parsed JSON body.
 * @property {boolean} [rawBody] Handler wants the untouched bytes (Stripe webhook).
 */

/* Routes, most specific first. */
/** @type {Route[]} */
const ROUTES = [
  { name: "webhook", path: "/webhook", methods: ["POST"], rawBody: true },
  { name: "metal-prices", path: "/metal-prices", methods: ["GET"] },
  { name: "create-unlock-session", path: "/create-checkout-session", methods: ["POST"], jsonBody: true },
  { name: "create-pro-session", path: "/create-subscription-session", methods: ["POST"] },
  { name: "create-boost-session", path: "/create-boost-session", methods: ["POST"], jsonBody: true },
  { name: "submit-verification", path: "/submit-verification", methods: ["POST"], jsonBody: true },
  { name: "customer-portal", path: "/customer-portal", methods: ["POST"] },
  // Fan-out of a newly listed job to verified collectors inside their service radius.
  // Must come before the generic /verify routes below, which match as suffixes.
  { name: "notify-new-listing", path: "/notify-new-listing", methods: ["POST"], jsonBody: true },
  // The original check-only verification endpoint (the client's VERIFY_ENDPOINT base).
  // Kept last: it is the shortest suffix, so anything more specific must win first.
  { name: "verify", path: "/verify-collector", methods: ["GET", "POST"], jsonBody: true },
  { name: "verify", path: "/verify", methods: ["GET", "POST"], jsonBody: true }
];

/**
 * Find the route for a request.
 * @param {Route[]} routes
 * @param {string} method
 * @param {string} pathname
 * @returns {{route: Route|null, methodMismatch: boolean}} methodMismatch lets the
 *   caller answer 405 (path exists, method doesn't) rather than 404.
 */
function matchRoute(routes, method, pathname) {
  const normalized = normalizePathname(pathname);
  let methodMismatch = false;
  for (const route of routes) {
    if (!endsWithPath(normalized, route.path)) continue;
    if (route.methods.includes(method)) return { route, methodMismatch: false };
    methodMismatch = true;
  }
  return { route: null, methodMismatch };
}

module.exports = { ROUTES, matchRoute, normalizePathname, endsWithPath, HttpError };
