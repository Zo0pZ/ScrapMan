import test from "node:test";
import assert from "node:assert/strict";
import { haversine, nearestNeighborRoute, routeDistance } from "../../src/domain/routing.js";

const DEPOT = { lat: 52.4862, lng: -1.8904 }; // Birmingham

test("haversine returns zero for the same point", () => {
  assert.equal(haversine(DEPOT, DEPOT), 0);
});

test("haversine matches a known distance", () => {
  // Birmingham -> London, roughly 163 km as the crow flies.
  const london = { lat: 51.5074, lng: -0.1278 };
  const km = haversine(DEPOT, london);
  assert.ok(km > 155 && km < 170, `expected ~163km, got ${km}`);
});

test("nearestNeighborRoute visits the closest job first", () => {
  const jobs = [
    { id: "far", lat: 53.5, lng: -1.9 },
    { id: "near", lat: 52.5, lng: -1.9 },
    { id: "mid", lat: 53.0, lng: -1.9 }
  ];
  const route = nearestNeighborRoute(jobs, DEPOT);
  assert.deepEqual(route.map(j => j.id), ["near", "mid", "far"]);
});

test("nearestNeighborRoute keeps every job exactly once", () => {
  const jobs = [
    { id: "a", lat: 52.5, lng: -1.9 },
    { id: "b", lat: 51.5, lng: -0.1 },
    { id: "c", lat: 53.5, lng: -2.9 }
  ];
  const route = nearestNeighborRoute(jobs, DEPOT);
  assert.equal(route.length, 3);
  assert.deepEqual(new Set(route.map(j => j.id)), new Set(["a", "b", "c"]));
});

test("nearestNeighborRoute annotates each leg with its distance", () => {
  const jobs = [{ id: "a", lat: 52.5, lng: -1.9 }];
  const [first] = nearestNeighborRoute(jobs, DEPOT);
  assert.equal(first.legDist, haversine(DEPOT, jobs[0]));
});

test("nearestNeighborRoute handles an empty list", () => {
  assert.deepEqual(nearestNeighborRoute([], DEPOT), []);
});

test("routeDistance sums the legs from the depot", () => {
  const jobs = [{ id: "a", lat: 52.5, lng: -1.9 }, { id: "b", lat: 52.6, lng: -1.9 }];
  const expected = haversine(DEPOT, jobs[0]) + haversine(jobs[0], jobs[1]);
  assert.equal(routeDistance(jobs, DEPOT), expected);
});
