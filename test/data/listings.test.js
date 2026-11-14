import test from "node:test";
import assert from "node:assert/strict";
import { mapListingRow, createListingsSource } from "../../src/data/listings.js";

test("mapListingRow marks a job unlocked when the RLS-gated contact embed is present", () => {
  const job = mapListingRow({
    id: 7, title: "Old radiators", metal_type: "ferrous", weight_band: "medium",
    lat: 52.5, lng: -1.9, address: "B1 1AA", urgency: "week", is_boosted: true,
    listing_contacts: { contact_name: "Sam", contact_phone: "0700", full_address: "1 High St" }
  });
  assert.equal(job.unlocked, true);
  assert.equal(job.contactName, "Sam");
  assert.equal(job.fullAddress, "1 High St");
  assert.equal(job.boosted, true);
  assert.equal(job.type, "ferrous");
});

test("mapListingRow marks a job locked when the contact embed is null", () => {
  const job = mapListingRow({ id: 8, title: "Copper pipe", listing_contacts: null });
  assert.equal(job.unlocked, false);
  assert.equal(job.contactName, null);
});

test("two concurrent renders issue exactly one listings query", async () => {
  let calls = 0;
  const source = createListingsSource({
    fetchRows: async () => { calls += 1; return [{ id: 1, title: "Load" }]; }
  });

  // This is the regression the refactor exists to prevent: renderJobs + initJobsMap
  // used to fetch independently, so one Jobs render queried the table twice.
  const [a, b] = await Promise.all([source.openJobs(), source.openJobs()]);

  assert.equal(calls, 1);
  assert.deepEqual(a, b);
  assert.equal(a.length, 1);
});

test("a repeated read reuses the fetched rows until invalidated", async () => {
  let calls = 0;
  const source = createListingsSource({
    fetchRows: async () => { calls += 1; return []; }
  });

  await source.openJobs();
  await source.openJobs();
  assert.equal(calls, 1);

  source.invalidate();
  await source.openJobs();
  assert.equal(calls, 2);
});

test("fresh:true always re-queries after a mutation", async () => {
  let calls = 0;
  const source = createListingsSource({
    fetchRows: async () => { calls += 1; return [{ id: calls }]; }
  });

  const first = await source.openJobs();
  const second = await source.openJobs({ fresh: true });

  assert.equal(calls, 2);
  assert.equal(first[0].id, 1);
  assert.equal(second[0].id, 2);
});

test("a failed fetch does not leave the source permanently stuck", async () => {
  let calls = 0;
  const source = createListingsSource({
    fetchRows: async () => {
      calls += 1;
      if (calls === 1) throw new Error("network down");
      return [{ id: 2 }];
    }
  });

  await assert.rejects(() => source.openJobs());
  const jobs = await source.openJobs();
  assert.equal(jobs.length, 1);
  assert.equal(calls, 2);
});
