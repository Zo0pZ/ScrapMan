"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createRateLimiter, createLimiterSet, clientKey } = require("../lib/ratelimit");

/* A controllable clock so window expiry is tested without sleeping. */
function clock(start = 1_000_000) {
  let now = start;
  return { now: () => now, advance: (ms) => { now += ms; } };
}

test("allows requests up to the limit, then refuses", () => {
  const limiter = createRateLimiter({ windowMs: 60_000, max: 3 });
  assert.equal(limiter.check("ip-a").allowed, true);
  assert.equal(limiter.check("ip-a").allowed, true);
  assert.equal(limiter.check("ip-a").allowed, true);

  const blocked = limiter.check("ip-a");
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  assert.ok(blocked.retryAfterMs > 0);
});

test("reports remaining budget before the limit is hit", () => {
  const limiter = createRateLimiter({ windowMs: 60_000, max: 5 });
  assert.equal(limiter.check("ip-a").remaining, 4);
  assert.equal(limiter.check("ip-a").remaining, 3);
});

test("the window expires and the client is allowed again", () => {
  const c = clock();
  const limiter = createRateLimiter({ windowMs: 60_000, max: 2, now: c.now });

  assert.equal(limiter.check("ip-a").allowed, true);
  assert.equal(limiter.check("ip-a").allowed, true);
  assert.equal(limiter.check("ip-a").allowed, false);

  c.advance(59_999);
  assert.equal(limiter.check("ip-a").allowed, false, "still inside the window");

  c.advance(1);
  assert.equal(limiter.check("ip-a").allowed, true, "new window after resetAt");
});

test("retryAfter counts down as the window runs out", () => {
  const c = clock();
  const limiter = createRateLimiter({ windowMs: 10_000, max: 1, now: c.now });

  limiter.check("ip-a");
  const first = limiter.check("ip-a");
  c.advance(4_000);
  const later = limiter.check("ip-a");

  assert.equal(first.allowed, false);
  assert.ok(later.retryAfterMs < first.retryAfterMs);
});

test("one noisy client cannot spend another client's budget", () => {
  const limiter = createRateLimiter({ windowMs: 60_000, max: 2 });
  limiter.check("ip-a");
  limiter.check("ip-a");

  assert.equal(limiter.check("ip-a").allowed, false);
  assert.equal(limiter.check("ip-b").allowed, true);
});

test("clientKey uses the left-most forwarded address", () => {
  assert.equal(
    clientKey({ headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" }, socket: { remoteAddress: "10.0.0.1" } }),
    "203.0.113.9"
  );
  assert.equal(clientKey({ headers: {}, socket: { remoteAddress: "198.51.100.4" } }), "198.51.100.4");
  assert.equal(clientKey({ headers: {} }), "unknown");
});

test("each route gets its own budget", () => {
  const limits = createLimiterSet({ verify: { windowMs: 60_000, max: 1 } });
  const req = { headers: { "x-forwarded-for": "203.0.113.9" } };

  assert.equal(limits.check("verify", req).allowed, true);
  assert.equal(limits.check("verify", req).allowed, false);
  // A different endpoint from the same address is unaffected.
  assert.equal(limits.check("notify-new-listing", req).allowed, true);
});

test("the default budget applies to routes without an explicit rule", () => {
  const limits = createLimiterSet({});
  const req = { headers: { "x-forwarded-for": "203.0.113.9" } };

  let allowed = 0;
  for (let i = 0; i < 200; i += 1) if (limits.check("metal-prices", req).allowed) allowed += 1;

  assert.equal(allowed, 120, "DEFAULT_RULE allows 120 per minute");
});

test("expired keys are swept so memory stays bounded", () => {
  const c = clock();
  const limiter = createRateLimiter({ windowMs: 1_000, max: 5, now: c.now, maxKeys: 10 });

  for (let i = 0; i < 10; i += 1) limiter.check(`ip-${i}`);
  assert.equal(limiter.size, 10);

  c.advance(1_001);
  limiter.check("ip-new");

  assert.ok(limiter.size <= 10, `expected the sweep to keep the map bounded, got ${limiter.size}`);
});
