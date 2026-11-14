/* ScrapMan — distance and route planning.
 *
 * Pure geometry and ordering only: no DOM, no network, no app state. `depot` is passed in
 * rather than read from a global so the optimiser can be unit-tested with fixed
 * coordinates.
 *
 * geo.js keeps its own copy of the haversine formula because it is also loaded standalone
 * by the plain council pages; the two must stay numerically identical.
 */

/**
 * Great-circle distance in kilometres between two {lat,lng} points.
 * @param {{lat: number, lng: number}} a
 * @param {{lat: number, lng: number}} b
 * @returns {number}
 */
export function haversine(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/**
 * Order jobs by repeatedly hopping to the nearest unvisited one, starting at the depot.
 * Nearest-neighbour is deliberate: it is O(n^2) but instantaneous for the handful of jobs
 * a collector does in a day, and a genuinely optimal route would need a solver.
 *
 * @param {Array<{lat: number, lng: number}>} jobs
 * @param {{lat: number, lng: number}} depot
 * @returns {Array<object>} the same jobs, ordered, each with the `legDist` that took it there
 */
export function nearestNeighborRoute(jobs, depot) {
  const remaining = [...jobs];
  const order = [];
  let current = depot;
  while (remaining.length) {
    let bestIdx = 0, bestDist = Infinity;
    remaining.forEach((j, i) => {
      const d = haversine(current, j);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    });
    const next = remaining.splice(bestIdx, 1)[0];
    order.push({ ...next, legDist: bestDist });
    current = next;
  }
  return order;
}

/**
 * Total distance of an ordered route, including the leg from the depot to the first stop.
 * @param {Array<{lat: number, lng: number}>} orderedJobs
 * @param {{lat: number, lng: number}} depot
 * @returns {number}
 */
export function routeDistance(orderedJobs, depot) {
  let total = 0;
  let cur = depot;
  for (const j of orderedJobs) {
    total += haversine(cur, j);
    cur = j;
  }
  return total;
}
