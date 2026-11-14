"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { subscriptionPeriodEnd } = require("../lib/stripe-helpers");

test("reads current_period_end from the subscription top level", () => {
  const end = subscriptionPeriodEnd({ current_period_end: 1767225600 });
  assert.equal(end, new Date(1767225600 * 1000).toISOString());
});

test("falls back to the first subscription item (newer Stripe API shapes)", () => {
  const end = subscriptionPeriodEnd({
    items: { data: [{ current_period_end: 1767225600 }] }
  });
  assert.equal(end, new Date(1767225600 * 1000).toISOString());
});

test("prefers the top-level value when both are present", () => {
  const end = subscriptionPeriodEnd({
    current_period_end: 1767225600,
    items: { data: [{ current_period_end: 9999999999 }] }
  });
  assert.equal(end, new Date(1767225600 * 1000).toISOString());
});

test("returns null when no period end is present", () => {
  assert.equal(subscriptionPeriodEnd({}), null);
  assert.equal(subscriptionPeriodEnd({ items: { data: [] } }), null);
  assert.equal(subscriptionPeriodEnd(null), null);
});
