-- Homeowners previously had no way to mark their own listing collected — only the
-- assigned collector could update job_assignments at all. If a collector never
-- bothers to tap "Mark collected" after physically picking the item up (easy to
-- forget, they're not always looking at the app), the homeowner's listing stays
-- stuck at "Scheduled" forever, and the rate-your-collector prompt (gated on
-- status = 'collected') never appears either.
--
-- This is a second, PERMISSIVE policy alongside the existing collector one (Postgres
-- RLS ORs multiple permissive policies for the same command together) — deliberately
-- narrow: a homeowner can update any assignment on their own listing, but the
-- with check clause only ever allows the resulting status to be 'completed'. They
-- can't use this to set en_route/arrived/weighed/cancelled — those stay collector-only.
create policy "homeowners can mark their own listing collected"
  on job_assignments for update
  using (
    exists (select 1 from listings l where l.id = listing_id and l.homeowner_id = auth.uid())
  )
  with check (
    status = 'completed'
    and exists (select 1 from listings l where l.id = listing_id and l.homeowner_id = auth.uid())
  );
