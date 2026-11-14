"use strict";

/* ScrapMan — pure Stripe helpers.
 *
 * Stripe moved current_period_end from the Subscription object down to each
 * subscription item on newer API versions/accounts, so read whichever is present
 * rather than assuming one shape. Pure so it can be tested without a live key. */
function subscriptionPeriodEnd(subscription) {
  if (!subscription) return null;
  const seconds =
    subscription.current_period_end ||
    (subscription.items && subscription.items.data && subscription.items.data[0]
      && subscription.items.data[0].current_period_end);
  return seconds ? new Date(seconds * 1000).toISOString() : null;
}

module.exports = { subscriptionPeriodEnd };
