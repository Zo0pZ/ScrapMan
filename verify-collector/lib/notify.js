"use strict";

/* ScrapMan — nearby-job notification fan-out.
 *
 * Decides *who* gets a "new job near you" alert. Kept pure and separate from the HTTP
 * handler so the distance/eligibility rules can be unit tested without Supabase: the
 * rules are the part that is easy to get subtly wrong (a collector outside their radius,
 * an unverified collector, the homeowner alerting themselves about their own listing).
 *
 * The rows themselves are written by the handler with the service_role key, so a browser
 * can never forge an alert.
 */

const EARTH_RADIUS_MILES = 3958.8;
const DEFAULT_RADIUS_MILES = 15;
const MAX_RECIPIENTS = 250;

const WEIGHT_LABEL = {
  small: "car boot load",
  medium: "trailer load",
  large: "skip load"
};

function toNumber(value) {
  const n = typeof value === "number" ? value : parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

function hasCoords(lat, lng) {
  return lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

/* Great-circle distance in miles (haversine). Same maths as the frontend's
 * src/domain/routing.js, repeated here because this service is plain CommonJS and must
 * not import ES modules from the browser bundle. */
function distanceMiles(from, to) {
  const lat1 = toNumber(from && from.lat);
  const lng1 = toNumber(from && from.lng);
  const lat2 = toNumber(to && to.lat);
  const lng2 = toNumber(to && to.lng);
  if (!hasCoords(lat1, lng1) || !hasCoords(lat2, lng2)) return null;

  const rad = deg => (deg * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(a)));
}

/* Does this collector want this job?
 *
 * Returns { ok, distanceMiles, reason } — the reason is what makes the unit tests (and
 * any future support question) answerable: "why didn't I get an alert for that job?"
 *   not-verified   — only verified collectors get alerts
 *   opted-out      — notify_new_jobs is false
 *   no-area        — collector has no service location saved, so nothing can be matched
 *   out-of-radius  — outside service_radius_miles
 */
function matchCollector(listing, collector) {
  if (!collector || collector.verification_status !== "verified") {
    return { ok: false, distanceMiles: null, reason: "not-verified" };
  }
  if (collector.notify_new_jobs === false) {
    return { ok: false, distanceMiles: null, reason: "opted-out" };
  }

  const radius = toNumber(collector.service_radius_miles);
  const limit = radius !== null && radius > 0 ? radius : DEFAULT_RADIUS_MILES;

  const miles = distanceMiles(
    { lat: listing.lat, lng: listing.lng },
    { lat: collector.service_lat, lng: collector.service_lng }
  );

  if (miles === null) {
    return { ok: false, distanceMiles: null, reason: "no-area" };
  }
  if (miles > limit) {
    return { ok: false, distanceMiles: miles, reason: "out-of-radius" };
  }

  return { ok: true, distanceMiles: miles, reason: "match" };
}

/* Eligible collectors, nearest first. The homeowner is excluded even if they happen to
 * hold a collector profile too — nobody needs an alert about their own listing. */
function selectRecipients(listing, collectors) {
  if (!listing) return [];
  const rows = Array.isArray(collectors) ? collectors : [];

  return rows
    .filter(c => c && c.profile_id && c.profile_id !== listing.homeowner_id)
    .map(c => ({ collector: c, ...matchCollector(listing, c) }))
    .filter(r => r.ok)
    .sort((a, b) => a.distanceMiles - b.distanceMiles)
    .slice(0, MAX_RECIPIENTS)
    .map(r => ({ profileId: r.collector.profile_id, distanceMiles: r.distanceMiles }));
}

function formatDistance(miles) {
  if (!Number.isFinite(miles)) return "nearby";
  if (miles < 1) return "less than a mile away";
  const rounded = Math.round(miles);
  return `${rounded} mile${rounded === 1 ? "" : "s"} away`;
}

/* The notification row. The body deliberately leads with the money-adjacent facts a
 * collector scans for: what it is, how big, how far. */
function buildNotificationRow(listing, recipient) {
  const title = listing.title || "Scrap collection";
  const weight = WEIGHT_LABEL[listing.weight_band] || "load";
  return {
    user_id: recipient.profileId,
    kind: "new-job",
    listing_id: listing.id,
    title: `New job ${formatDistance(recipient.distanceMiles)}`,
    body: `${title} — ${weight}`,
    href: "jobs"
  };
}

module.exports = {
  EARTH_RADIUS_MILES,
  DEFAULT_RADIUS_MILES,
  MAX_RECIPIENTS,
  distanceMiles,
  matchCollector,
  selectRecipients,
  buildNotificationRow,
  formatDistance
};
