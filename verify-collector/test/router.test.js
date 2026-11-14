"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ROUTES, matchRoute, normalizePathname, HttpError } = require("../lib/router");

test("normalizePathname strips a trailing slash but keeps the root", () => {
  assert.equal(normalizePathname("/verify-collector/metal-prices/"), "/verify-collector/metal-prices");
  assert.equal(normalizePathname("/"), "/");
  assert.equal(normalizePathname(""), "/");
});

test("routes match with or without the cPanel mount path", () => {
  assert.equal(matchRoute(ROUTES, "GET", "/metal-prices").route.name, "metal-prices");
  assert.equal(matchRoute(ROUTES, "GET", "/verify-collector/metal-prices").route.name, "metal-prices");
  assert.equal(matchRoute(ROUTES, "GET", "/verify-collector/metal-prices/").route.name, "metal-prices");
});

test("every endpoint the browser actually calls is routed", () => {
  const calls = [
    ["GET", "/verify-collector/metal-prices"],
    ["POST", "/verify-collector/create-checkout-session"],
    ["POST", "/verify-collector/create-subscription-session"],
    ["POST", "/verify-collector/create-boost-session"],
    ["POST", "/verify-collector/submit-verification"],
    ["POST", "/verify-collector/customer-portal"],
    ["POST", "/verify-collector/webhook"],
    ["GET", "/verify-collector"]
  ];
  for (const [method, path] of calls) {
    const { route } = matchRoute(ROUTES, method, path);
    assert.ok(route, `${method} ${path} should match a route`);
  }
});

test("an unknown path matches nothing so the server answers 404", () => {
  const { route, methodMismatch } = matchRoute(ROUTES, "POST", "/definitely-not-a-route");
  assert.equal(route, null);
  assert.equal(methodMismatch, false);
});

test("an unknown path is not silently treated as a verification request", () => {
  // Regression guard: the old fallback ran the EA lookup for any unmatched URL.
  const { route } = matchRoute(ROUTES, "GET", "/typo-verify");
  assert.equal(route, null);
});

test("a known path with the wrong method reports a mismatch, not a 404", () => {
  const { route, methodMismatch } = matchRoute(ROUTES, "PUT", "/verify-collector/metal-prices");
  assert.equal(route, null);
  assert.equal(methodMismatch, true);
});

test("the webhook is flagged as needing the raw body", () => {
  const { route } = matchRoute(ROUTES, "POST", "/verify-collector/webhook");
  assert.equal(route.name, "webhook");
  assert.equal(route.rawBody, true);
});

test("POST handlers that read a body are flagged as jsonBody", () => {
  for (const path of ["/create-checkout-session", "/create-boost-session", "/submit-verification"]) {
    const { route } = matchRoute(ROUTES, "POST", `/verify-collector${path}`);
    assert.equal(route.jsonBody, true, `${path} should parse a JSON body`);
  }
});

test("HttpError carries the 4xx status a handler wants", () => {
  const err = new HttpError(400, "Missing listingId");
  assert.equal(err.status, 400);
  assert.equal(err.message, "Missing listingId");
  assert.ok(err instanceof Error);
});
