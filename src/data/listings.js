/* ScrapMan — the open-listings data source.
 *
 * Extracted from app.js. The important change is not the move: it is that fetching is now
 * funnelled through one object that de-duplicates concurrent loads. Previously the Jobs
 * screen fetched the whole listings table up to three times per render (renderJobs,
 * initJobsMap, renderRoute each called getAllJobs()), because every renderer owned its own
 * query.
 *
 * `fetchRows` is injected so this can be tested without Supabase — see
 * test/data/listings.test.js, which asserts that two concurrent renders produce exactly
 * one query.
 */

/**
 * Shape a raw `listings` row (with its embedded contact) for the UI.
 *
 * listing_contacts is RLS-gated by job_unlocks OR an active Pro subscription — the embed
 * comes back null for any job the signed-in collector hasn't unlocked (and isn't Pro for),
 * so its presence alone tells us whether the job is unlocked; no separate job_unlocks
 * lookup is needed.
 *
 * @param {any} row
 * @returns {object}
 */
export function mapListingRow(row) {
  const contact = row.listing_contacts || null;
  return {
    id: row.id, title: row.title, type: row.metal_type, weight: row.weight_band,
    lat: row.lat, lng: row.lng, address: row.address, urgency: row.urgency,
    boosted: !!row.is_boosted,
    unlocked: !!contact,
    contactName: contact && contact.contact_name, contactPhone: contact && contact.contact_phone,
    fullAddress: contact && contact.full_address
  };
}

/**
 * The real Supabase query, as an injectable row fetcher.
 * @param {any} db Supabase client
 * @returns {() => Promise<any[]>}
 */
export function supabaseRowFetcher(db) {
  return async () => {
    const { data, error } = await db
      .from("listings")
      .select("*, listing_contacts(contact_name, contact_phone, full_address)")
      .eq("status", "open")
      .order("is_boosted", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) { console.error(error); return []; }
    return data || [];
  };
}

/**
 * A single-flight listings source.
 *
 * @param {{fetchRows: () => Promise<any[]>}} deps
 */
export function createListingsSource({ fetchRows }) {
  /** @type {any[]|null} */
  let cached = null;
  /** @type {Promise<any[]>|null} */
  let inflight = null;

  async function load(fresh) {
    if (!fresh && cached) return cached;
    if (!fresh && inflight) return inflight; // concurrent renders share one query
    inflight = (async () => {
      const rows = await fetchRows();
      cached = rows.map(mapListingRow);
      return cached;
    })();
    try {
      return await inflight;
    } finally {
      inflight = null;
    }
  }

  return {
    /**
     * Open jobs. `fresh` forces a reload (use after accepting/unlocking/collecting so the
     * UI never shows a stale unlock state); the default reuses whatever was just fetched.
     * @param {{fresh?: boolean}} [opts]
     * @returns {Promise<any[]>}
     */
    openJobs(opts = {}) {
      return load(!!opts.fresh);
    },
    /** Drop the cache after a mutation, so the next read is guaranteed current. */
    invalidate() {
      cached = null;
    }
  };
}
