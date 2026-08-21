-- ScrapMan — "Boost my listing" (Stripe one-off payment, homeowner side).
--
-- Run this once against the existing database (Supabase SQL editor, or `supabase db
-- push`). Additive/idempotent-ish — safe to re-run.
--
-- What changes and why:
--   * listings gets is_boosted/boosted_at. A boosted listing sorts to the top of the
--     collector feed with a highlighted badge (see app.js's renderJobs()).
--   * Same write model as job_unlocks/pro_subscriptions (see 001_stripe_payments.sql):
--     only the verify-collector Node app's service_role key is allowed to flip
--     is_boosted, and only after Stripe confirms a real payment (see its webhook
--     handler). The existing "homeowners manage their own listings" policy is `for
--     all`, so without the column-level revoke below a homeowner's own browser could
--     just call `.update({ is_boosted: true })` on their own listing for free —
--     row-level security alone doesn't stop that since they DO own the row; only a
--     column grant can.

alter table listings
  add column if not exists is_boosted boolean not null default false,
  add column if not exists boosted_at timestamptz;

revoke update (is_boosted, boosted_at) on listings from authenticated;
