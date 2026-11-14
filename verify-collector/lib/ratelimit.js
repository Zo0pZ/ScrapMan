"use strict";

/* ScrapMan — per-client rate limiting for the public API.
 *
 * The verification proxy spends an outbound request on the Environment Agency
 * register for every call, and that quota is shared and finite. Without a limit,
 * one script can burn the whole day's allowance for everybody and pin this app's
 * single vCPU. Checkout creation and the notification fan-out are similarly
 * expensive to repeat.
 *
 * Deliberately in-memory: one Node process per app, no shared store to operate.
 * The tradeoff is that counters reset on restart and are not shared across
 * instances — fine at one instance, and the limits below are abuse brakes rather
 * than billing meters.
 */

const DEFAULT_RULE = { windowMs: 60_000, max: 120 };

/* Best-effort client identity. Behind the hosting proxy every request arrives from
   the proxy, so the left-most X-Forwarded-For entry is the only useful signal. */
function clientKey(req) {
  const forwarded = req.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded || "";
  const first = String(raw).split(",")[0].trim();
  const socket = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : "unknown";
  return first || socket;
}

/* Fixed-window counter. A fixed window can let through up to 2x the limit across a
   window boundary; that is an acceptable simplification for an abuse brake and
   keeps the state and the tests trivial. */
function createRateLimiter({ windowMs = 60_000, max = 60, now = Date.now, maxKeys = 10_000 } = {}) {
  const buckets = new Map();

  function sweep(at) {
    for (const [key, entry] of buckets) {
      if (entry.resetAt <= at) buckets.delete(key);
    }
  }

  return {
    check(key) {
      const at = now();
      let entry = buckets.get(key);
      if (!entry || entry.resetAt <= at) {
        // Bound memory under a spray of unique keys: drop everything already expired
        // before adding another entry.
        if (buckets.size >= maxKeys) sweep(at);
        entry = { count: 0, resetAt: at + windowMs };
        buckets.set(key, entry);
      }
      entry.count += 1;
      const allowed = entry.count <= max;
      return {
        allowed,
        remaining: Math.max(0, max - entry.count),
        retryAfterMs: allowed ? 0 : Math.max(0, entry.resetAt - at)
      };
    },
    reset() {
      buckets.clear();
    },
    get size() {
      return buckets.size;
    }
  };
}

/* One limiter per route name, created lazily so each endpoint can have its own
   budget. `rules` maps a route name to { windowMs, max }. */
function createLimiterSet(rules = {}, options = {}) {
  const limiters = new Map();

  function limiterFor(name) {
    if (!limiters.has(name)) {
      limiters.set(name, createRateLimiter({ ...DEFAULT_RULE, ...(rules[name] || {}), ...options }));
    }
    return limiters.get(name);
  }

  return {
    check(name, req) {
      const scope = name || "default";
      const result = limiterFor(scope).check(clientKey(req));
      return { ...result, scope };
    },
    reset() {
      for (const limiter of limiters.values()) limiter.reset();
      limiters.clear();
    }
  };
}

module.exports = { DEFAULT_RULE, clientKey, createRateLimiter, createLimiterSet };
