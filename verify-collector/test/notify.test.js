"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  distanceMiles,
  matchCollector,
  selectRecipients,
  buildNotificationRow,
  formatDistance,
  MAX_RECIPIENTS
} = require("../lib/notify");

const BIRMINGHAM = { lat: 52.4862, lng: -1.8904 };

function listing(overrides) {
  return {
    id: 101,
    homeowner_id: "home-1",
    title: "Old washing machine",
    metal_type: "appliance",
    weight_band: "medium",
    lat: BIRMINGHAM.lat,
    lng: BIRMINGHAM.lng,
    ...overrides
  };
}

function collector(overrides) {
  return {
    profile_id: "col-1",
    verification_status: "verified",
    notify_new_jobs: true,
    service_lat: BIRMINGHAM.lat,
    service_lng: BIRMINGHAM.lng,
    service_radius_miles: 15,
    ...overrides
  };
}

test("distanceMiles is zero for the same point and symmetric", () => {
  assert.equal(distanceMiles(BIRMINGHAM, BIRMINGHAM), 0);
  const a = distanceMiles(BIRMINGHAM, { lat: 51.5074, lng: -0.1278 }); // London
  const b = distanceMiles({ lat: 51.5074, lng: -0.1278 }, BIRMINGHAM);
  assert.ok(Math.abs(a - b) < 1e-9);
  // Birmingham to London is ~101 miles as the crow flies.
  assert.ok(a > 95 && a < 110, `expected ~101 miles, got ${a}`);
});

test("distanceMiles returns null rather than NaN for unusable coordinates", () => {
  assert.equal(distanceMiles({ lat: null, lng: null }, BIRMINGHAM), null);
  assert.equal(distanceMiles(BIRMINGHAM, { lat: 91, lng: 0 }), null);
  assert.equal(distanceMiles(undefined, undefined), null);
  assert.equal(distanceMiles({ lat: "52.4", lng: "-1.89" }, BIRMINGHAM) !== null, true);
});

test("an unverified collector is never notified", () => {
  const result = matchCollector(listing(), collector({ verification_status: "unverified" }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, "not-verified");
});

test("a collector who opted out is never notified", () => {
  const result = matchCollector(listing(), collector({ notify_new_jobs: false }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, "opted-out");
});

test("a collector with no service area is skipped, not sent everything", () => {
  const result = matchCollector(listing(), collector({ service_lat: null, service_lng: null }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no-area");
});

test("radius is respected at the boundary", () => {
  // ~1.4 miles north of the listing.
  const near = { lat: BIRMINGHAM.lat + 0.02, lng: BIRMINGHAM.lng };
  const nearResult = matchCollector(listing(), collector({ service_lat: near.lat, service_lng: near.lng, service_radius_miles: 5 }));
  assert.equal(nearResult.ok, true);

  // ~14 miles away against a 5 mile radius.
  const far = { lat: BIRMINGHAM.lat + 0.2, lng: BIRMINGHAM.lng };
  const farResult = matchCollector(listing(), collector({ service_lat: far.lat, service_lng: far.lng, service_radius_miles: 5 }));
  assert.equal(farResult.ok, false);
  assert.equal(farResult.reason, "out-of-radius");
  assert.ok(farResult.distanceMiles > 5);
});

test("a missing or nonsense radius falls back to the 15 mile default", () => {
  const tenMiles = { lat: BIRMINGHAM.lat + 0.14, lng: BIRMINGHAM.lng };
  assert.equal(matchCollector(listing(), collector({ service_lat: tenMiles.lat, service_lng: tenMiles.lng, service_radius_miles: null })).ok, true);
  assert.equal(matchCollector(listing(), collector({ service_lat: tenMiles.lat, service_lng: tenMiles.lng, service_radius_miles: 0 })).ok, true);
  assert.equal(matchCollector(listing(), collector({ service_lat: tenMiles.lat, service_lng: tenMiles.lng, service_radius_miles: "abc" })).ok, true);
});

test("recipients are nearest-first and exclude the homeowner", () => {
  const recipients = selectRecipients(listing(), [
    collector({ profile_id: "col-far", service_lat: BIRMINGHAM.lat + 0.1 }),
    collector({ profile_id: "home-1" }), // the listing's own homeowner
    collector({ profile_id: "col-near", service_lat: BIRMINGHAM.lat + 0.01 }),
    collector({ profile_id: "col-mid", service_lat: BIRMINGHAM.lat + 0.05 })
  ]);

  assert.deepEqual(recipients.map(r => r.profileId), ["col-near", "col-mid", "col-far"]);
  assert.ok(recipients[0].distanceMiles < recipients[1].distanceMiles);
});

test("ineligible collectors are dropped from the recipient list", () => {
  const recipients = selectRecipients(listing(), [
    collector({ profile_id: "col-ok" }),
    collector({ profile_id: "col-unverified", verification_status: "rejected" }),
    collector({ profile_id: "col-opted-out", notify_new_jobs: false }),
    collector({ profile_id: "col-nowhere", service_lat: null, service_lng: null }),
    null
  ]);
  assert.deepEqual(recipients.map(r => r.profileId), ["col-ok"]);
});

test("recipient fan-out is capped so a dense city cannot flood a single insert", () => {
  const many = Array.from({ length: MAX_RECIPIENTS + 40 }, (_, i) =>
    collector({ profile_id: `col-${i}`, service_lat: BIRMINGHAM.lat + i * 0.0001 })
  );
  assert.equal(selectRecipients(listing(), many).length, MAX_RECIPIENTS);
});

test("a malformed or empty collector list is safe", () => {
  assert.deepEqual(selectRecipients(listing(), undefined), []);
  assert.deepEqual(selectRecipients(listing(), "nope"), []);
  assert.deepEqual(selectRecipients(null, [collector()]), []);
});

test("notification rows carry the facts a collector scans for", () => {
  const row = buildNotificationRow(listing(), { profileId: "col-1", distanceMiles: 2.4 });
  assert.equal(row.user_id, "col-1");
  assert.equal(row.kind, "new-job");
  assert.equal(row.listing_id, 101);
  assert.equal(row.title, "New job 2 miles away");
  assert.equal(row.body, "Old washing machine — trailer load");
  assert.equal(row.href, "jobs");
});

test("row body falls back gracefully for unknown bands and missing titles", () => {
  const row = buildNotificationRow(listing({ title: "", weight_band: "huge" }), { profileId: "c", distanceMiles: 0.2 });
  assert.equal(row.body, "Scrap collection — load");
  assert.equal(row.title, "New job less than a mile away");
});

test("formatDistance is singular at one mile", () => {
  assert.equal(formatDistance(1), "1 mile away");
  assert.equal(formatDistance(3), "3 miles away");
  assert.equal(formatDistance(0.4), "less than a mile away");
  assert.equal(formatDistance(NaN), "nearby");
});
