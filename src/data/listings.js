/* ScrapMan — the open-listings data source.
 *
 * Extracted from app.js. The important change is not the move: fetching now goes through
 * one object that de-duplicates concurrent loads. Previously the Jobs screen could fetch
 * the whole listings table more than once per render, because renderJobs, initJobsMap and
 * renderRoute each owned their own query.
 *
 * There is deliberately no long-lived cache here. Rows are re-read on every call, exactly
 * as before, so accepting or unlocking a job can never leave a stale list on screen; the
 * single-flight promise only collapses *concurrent* callers into one query.
 *
 * `fetchRows` is injected so this can be tested without Supabase — see
 * test/data/listings.test.js, which asserts that two concurrent renders issue one query.
 */

/**
 * Shape a raw `listings` row (with its embedded contact) for the UI.
 *
 * listing_contacts is RLS-gated by job_unlocks OR an active Pro subscription — the embed
 * comes back null for any job the signed-in collector hasn't unlocked (and isn't Pro for),
 * so its presence alone tells us whether the job is unlocked; no separate job_unlocks
 * lookup is needed.
 *
 * @typedef {object} Job
 * @property {any} id
 * @property {any} title
 * @property {any} type
 * @property {any} weight
 * @property {any} lat
 * @property {any} lng
 * @property {any} address
 * @property {any} urgency
 * @property {boolean} boosted
 * @property {boolean} unlocked
 * @property {any} contactName
 * @property {any} contactPhone
 * @property {any} fullAddress
 */

/**
 * @param {any} row
 * @returns {Job}
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
 * @returns {{ openJobs: () => Promise<Job[]> }}
 */
export function createListingsSource({ fetchRows }) {
  /** @type {Promise<any[]>|null} */
  let inflight = null;

  async function load() {
    if (inflight) return inflight; // concurrent renders share one query
    inflight = fetchRows().then(rows => (rows || []).map(mapListingRow));
    try {
      return await inflight;
    } finally {
      inflight = null; // next call re-reads; a failure never sticks
    }
  }

  return {
    /** Open jobs, re-read from the backend on each call. @returns {Promise<Job[]>} */
    openJobs() {
      return load();
    }
  };
}
