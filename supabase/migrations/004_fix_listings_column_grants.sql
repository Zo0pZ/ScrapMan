-- Corrects 002_listing_boost.sql's is_boosted/boosted_at protection, which never
-- actually worked (discovered while applying 003_close_rls_gaps.sql's is_boosted
-- INSERT fix and finding it had the same problem): `authenticated` holds a
-- TABLE-LEVEL grant of INSERT/UPDATE on listings, and a column-level REVOKE cannot
-- restrict access below what a table-level GRANT already provides in Postgres — the
-- table-level grant simply supersedes it, it isn't intersected with the column-level
-- one. information_schema.column_privileges/has_column_privilege() report the
-- *effective* privilege, which is granted either way — so both the original UPDATE
-- revoke and 003's INSERT revoke were silent no-ops. The correct pattern is to revoke
-- the table-level grant for these operations entirely and re-grant only the specific
-- columns that should be writable.
revoke insert, update on listings from authenticated;

grant insert (homeowner_id, title, metal_type, weight_band, urgency, lat, lng, address, photo_url)
  on listings to authenticated;

grant update (title, metal_type, weight_band, urgency, lat, lng, address, photo_url)
  on listings to authenticated;

-- is_boosted, boosted_at, status, homeowner_id, id, created_at are deliberately excluded
-- from both grants above: is_boosted/boosted_at only ever change via the verify-collector
-- Node app's service_role key after a confirmed Stripe payment; status only changes via
-- the sync_listing_status trigger (SECURITY DEFINER — runs as its owner, unaffected by
-- these grants); homeowner_id/id/created_at should never change after creation.
