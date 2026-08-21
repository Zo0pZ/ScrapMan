-- ScrapMan — close RLS gaps found in a full-app security review (2026-08-21).
--
-- Run this once against the existing database. Fixes five authorization gaps plus one
-- correctness bug, all in tables whose only real trust boundary is Row Level Security
-- (this app's client talks to Supabase directly with the anon key — see supabase-config.js).
--
-- ---------- 1. job_assignments: accepting a job required no payment or verification ----------
-- The old policy ("for all", auth.uid() = collector_id) let *any* signed-in user insert
-- an assignment for *any* open listing — nothing checked for a job_unlocks row, an
-- active Pro subscription, or even verification_status. acceptJob() in app.js is a
-- plain .insert(); the "Accept job" button only *appearing* once unlocked (app.js) is a
-- UI convenience, not a security boundary. Split into insert/select/update so the
-- payment+verification check only applies at accept-time, not on every later status
-- update (en_route -> arrived -> weighed -> completed) by the same collector.
drop policy if exists "collectors see & manage their own assignments" on job_assignments;

create policy "collectors see their own assignments"
  on job_assignments for select
  using (auth.uid() = collector_id);

create policy "collectors accept jobs they've unlocked, are Pro for, or are verified for"
  on job_assignments for insert
  with check (
    auth.uid() = collector_id
    and exists (
      select 1 from collector_profiles cp
      where cp.profile_id = auth.uid() and cp.verification_status = 'verified'
    )
    and (
      exists (
        select 1 from job_unlocks u
        where u.listing_id = job_assignments.listing_id and u.collector_id = auth.uid()
      )
      or exists (
        select 1 from pro_subscriptions p
        where p.collector_id = auth.uid() and p.status in ('active', 'trialing')
      )
    )
  );

create policy "collectors update their own assignments"
  on job_assignments for update
  using (auth.uid() = collector_id)
  with check (auth.uid() = collector_id);

-- ---------- 2. collector_profiles: a collector could self-grant "Verified" ----------
-- The old policy let a collector write ANY column on their own row, including
-- verification_status/verified_at/ea_carrier/ea_scrap_metal_licence AND
-- rating_avg/rating_count/jobs_completed (meant to be trigger-only, see
-- recalc_collector_rating()). The app's own verify form used to upsert these directly
-- from the browser after calling the EA-check endpoint — nothing stopped skipping that
-- endpoint, or lying about its result. Same write model as job_unlocks/pro_subscriptions
-- now: no client write policy at all. The verify-collector Node app's new
-- /submit-verification endpoint re-runs the EA check itself and writes the result with
-- its service_role key (see verify-collector/server.js's handleSubmitVerification).
drop policy if exists "collectors manage their own verification profile" on collector_profiles;

-- ---------- 3. ratings: nothing stopped rating yourself ----------
-- The old check only verified the rater was *a* participant on the assignment, never
-- that ratee_id was actually the *other* participant (or even that ratee <> rater) — a
-- collector could insert {rater_id: me, ratee_id: me, stars: 5} after any completed job
-- and the recalc_collector_rating trigger would fold it straight into their own average.
drop policy if exists "participants can rate each other on their own assignment" on ratings;
create policy "participants can rate each other on their own assignment"
  on ratings for insert
  with check (
    auth.uid() = rater_id
    and ratee_id <> rater_id
    and exists (
      select 1 from job_assignments a
      join listings l on l.id = a.listing_id
      where a.id = assignment_id
        and (
          (a.collector_id = auth.uid() and ratee_id = l.homeowner_id)
          or (l.homeowner_id = auth.uid() and ratee_id = a.collector_id)
        )
    )
  );

-- ---------- 4. listings: boost payment could be skipped via insert ----------
-- 002_listing_boost.sql revoked UPDATE on is_boosted/boosted_at, but Postgres tracks
-- column privileges per-operation — that never touched INSERT. A homeowner's own
-- .insert() could set is_boosted: true directly on a brand-new listing, no Stripe
-- payment involved. (Existing listings.insert() in app.js never sends these columns,
-- so this doesn't affect any legitimate insert — PostgREST only checks column
-- privileges for columns actually present in the request.)
revoke insert (is_boosted, boosted_at) on listings from authenticated;

-- ---------- 5. (correctness, not security) a cancelled job permanently deadlocked its
-- listing ----------
-- unique (listing_id) is a bare column constraint, not scoped to active statuses,
-- despite the comment claiming "one active collector at a time". sync_listing_status()
-- reopens the listing (status -> 'open') when an assignment is cancelled, but any future
-- accept attempt by anyone still violates the old cancelled row's unique constraint —
-- the listing becomes visibly "open" but structurally unbookable forever. Not currently
-- reachable via the shipped UI (nothing sets status = 'cancelled' yet) but the enum
-- supports it and it's a landmine for whenever that's added.
alter table job_assignments drop constraint if exists job_assignments_listing_id_key;
create unique index if not exists one_active_assignment_per_listing
  on job_assignments (listing_id) where status <> 'cancelled';
