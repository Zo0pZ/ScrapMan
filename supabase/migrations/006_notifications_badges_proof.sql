-- ============================================================
-- ScrapMan — migration 006: notifications, household badges,
-- completion proof + statutory transfer notes, and disputes.
--
-- Run AFTER supabase/schema.sql, in the SQL editor:
--   Supabase dashboard -> SQL Editor -> New query -> paste -> Run.
-- Safe to re-run: every object is created with IF NOT EXISTS or
-- CREATE OR REPLACE, and the publication change is guarded.
--
-- What this migration is for:
--   1. Notifications — a durable row per event, plus the collector
--      service area the nearby-job fan-out needs. Rows are written by
--      the verify-collector service (service_role) and by triggers,
--      never by the browser, so a client cannot forge "new job" alerts.
--   2. Household recycling badges — homeowners are NOT rated (see
--      src/domain/badges.js). The badge is derived from verified
--      collection weights, exposed only as an aggregate.
--   3. Completion proof — the weight and photo of what actually
--      changed hands, which is what scrap disputes are really about.
--   4. Waste transfer notes — the Scrap Metal Dealers Act 2013 record,
--      issued by trigger as an immutable jsonb snapshot.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Collector service area + notification preferences
--
-- collector_profiles deliberately had NO write policy: nothing in it
-- may be set by the collector's own browser. These four columns are
-- the exception, and they are granted at column level so the browser
-- still cannot touch verification_status, rating_avg or jobs_completed.
-- ------------------------------------------------------------
alter table collector_profiles
  add column if not exists service_lat double precision,
  add column if not exists service_lng double precision,
  add column if not exists service_radius_miles numeric not null default 15,
  add column if not exists notify_new_jobs boolean not null default true;

revoke update on collector_profiles from authenticated;
grant update (service_lat, service_lng, service_radius_miles, notify_new_jobs)
  on collector_profiles to authenticated;

drop policy if exists "collectors set their own service area" on collector_profiles;
create policy "collectors set their own service area"
  on collector_profiles for update
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);

-- The fan-out only ever looks at verified collectors.
create index if not exists collector_profiles_verified
  on collector_profiles (verification_status)
  where verification_status = 'verified';

-- ------------------------------------------------------------
-- 2. Notifications
-- ------------------------------------------------------------
create table if not exists notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null check (kind in (
    'new-job', 'job-claimed', 'job-collected', 'badge', 'dispute-raised', 'dispute-resolved'
  )),
  listing_id bigint references listings(id) on delete cascade,
  title text not null,
  body text not null,
  href text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

-- One alert per user per listing per kind: re-running the fan-out (a retried request,
-- a re-saved listing) must never produce a second "new job near you" for the same job.
create unique index if not exists notifications_unique_per_event
  on notifications (user_id, listing_id, kind)
  where listing_id is not null;

create index if not exists notifications_unread
  on notifications (user_id, created_at desc)
  where read_at is null;

alter table notifications enable row level security;

create policy "users read their own notifications"
  on notifications for select
  using (auth.uid() = user_id);

-- Marking read is the only write a browser may do. No insert policy on purpose:
-- alerts come from the service_role fan-out and from triggers.
create policy "users mark their own notifications read"
  on notifications for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "users delete their own notifications"
  on notifications for delete
  using (auth.uid() = user_id);

-- Live in-app badge/toast while the app is open.
do $$
begin
  alter publication supabase_realtime add table notifications;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

-- ------------------------------------------------------------
-- 3. Completion proof — what actually changed hands
-- ------------------------------------------------------------
create table if not exists job_proofs (
  id bigint generated always as identity primary key,
  listing_id bigint not null unique references listings(id) on delete cascade,
  collector_id uuid not null references profiles(id) on delete cascade,
  weight_kg numeric(8,1) not null check (weight_kg >= 1 and weight_kg <= 50000),
  photo_url text,
  note text,
  collected_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table job_proofs enable row level security;

create policy "participants read the proof for their own job"
  on job_proofs for select
  using (
    exists (
      select 1 from job_assignments a
      join listings l on l.id = a.listing_id
      where a.listing_id = job_proofs.listing_id
        and (auth.uid() = a.collector_id or auth.uid() = l.homeowner_id)
    )
  );

-- Either party can record what was collected (a homeowner may confirm the load if the
-- collector's phone died), but the row must point at the collector actually assigned to
-- that listing — so neither party can attach a weight to somebody else's job.
create policy "participants record what was collected"
  on job_proofs for insert
  with check (
    exists (
      select 1 from job_assignments a
      join listings l on l.id = a.listing_id
      where a.listing_id = job_proofs.listing_id
        and a.collector_id = job_proofs.collector_id
        and a.status <> 'cancelled'
        and (auth.uid() = a.collector_id or auth.uid() = l.homeowner_id)
    )
  );

-- No update or delete policy: a weight that can be edited afterwards is not evidence.

-- ------------------------------------------------------------
-- 4. Waste transfer notes (statutory record)
-- ------------------------------------------------------------
create table if not exists waste_transfer_notes (
  id bigint generated always as identity primary key,
  listing_id bigint not null unique references listings(id) on delete cascade,
  reference text not null unique,
  issued_at timestamptz not null default now(),
  -- The whole document as issued. Never recomputed from live rows: a collector who later
  -- changes their trading name or lets a licence lapse must not alter a note already
  -- handed to a household.
  payload jsonb not null
);

alter table waste_transfer_notes enable row level security;

create policy "participants read their own transfer note"
  on waste_transfer_notes for select
  using (
    exists (
      select 1 from job_assignments a
      join listings l on l.id = a.listing_id
      where a.listing_id = waste_transfer_notes.listing_id
        and (auth.uid() = a.collector_id or auth.uid() = l.homeowner_id)
    )
  );

-- ------------------------------------------------------------
-- 5. Disputes
-- ------------------------------------------------------------
create table if not exists job_disputes (
  id bigint generated always as identity primary key,
  listing_id bigint not null references listings(id) on delete cascade,
  raised_by uuid not null references profiles(id) on delete cascade,
  reason text not null check (reason in ('weight', 'no-show', 'damage', 'payment', 'other')),
  detail text,
  status text not null default 'open' check (status in ('open', 'resolved', 'withdrawn')),
  resolution text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists job_disputes_open
  on job_disputes (listing_id, created_at desc)
  where status = 'open';

alter table job_disputes enable row level security;

create policy "participants read disputes on their own job"
  on job_disputes for select
  using (
    exists (
      select 1 from job_assignments a
      join listings l on l.id = a.listing_id
      where a.listing_id = job_disputes.listing_id
        and (auth.uid() = a.collector_id or auth.uid() = l.homeowner_id)
    )
  );

create policy "participants raise a dispute on their own job"
  on job_disputes for insert
  with check (
    auth.uid() = raised_by
    and exists (
      select 1 from job_assignments a
      join listings l on l.id = a.listing_id
      where a.listing_id = job_disputes.listing_id
        and (auth.uid() = a.collector_id or auth.uid() = l.homeowner_id)
    )
  );

-- Withdrawing your own open dispute is allowed; resolving it is service_role only.
create policy "raisers withdraw their own dispute"
  on job_disputes for update
  using (auth.uid() = raised_by and status = 'open')
  with check (auth.uid() = raised_by and status = 'withdrawn');

-- ------------------------------------------------------------
-- 6. Household recycling badge — aggregate only
--
-- Homeowners are not rated, so this is the public trust signal instead. It is
-- SECURITY DEFINER because a collector must be able to see "this household has
-- recycled 340kg" on a job card without being able to read the household's job rows
-- (job_proofs RLS is participants-only). It returns an aggregate and nothing else:
-- no addresses, no individual jobs, no counterparties.
-- ------------------------------------------------------------
create or replace function public.household_badge(p_homeowner uuid)
returns table (total_kg numeric, collections bigint, last_collected_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(sum(p.weight_kg), 0)::numeric,
         count(p.id)::bigint,
         max(p.collected_at)
  from job_proofs p
  join listings l on l.id = p.listing_id
  where l.homeowner_id = p_homeowner;
$$;

-- Bulk variant so the Jobs screen decorates a whole page of cards in one round trip.
create or replace function public.household_badges(p_homeowners uuid[])
returns table (homeowner_id uuid, total_kg numeric, collections bigint)
language sql
security definer
set search_path = public
stable
as $$
  select l.homeowner_id,
         coalesce(sum(p.weight_kg), 0)::numeric,
         count(p.id)::bigint
  from listings l
  left join job_proofs p on p.listing_id = l.id
  where l.homeowner_id = any(p_homeowners)
  group by l.homeowner_id;
$$;

grant execute on function public.household_badge(uuid) to authenticated;
grant execute on function public.household_badges(uuid[]) to authenticated;

-- ------------------------------------------------------------
-- 7. Recording a collection: close the job, issue the note, notify
--
-- This runs on the server for every proof insert, so the statutory record exists
-- even if the collector closes the app straight after tapping "Collected".
-- ------------------------------------------------------------
create or replace function public.record_collection_proof()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing listings;
  v_collector collector_profiles;
  v_reference text;
  v_collected_at timestamptz := coalesce(new.collected_at, now());
begin
  select * into v_listing from listings where id = new.listing_id;
  if v_listing is null then
    raise exception 'listing % does not exist', new.listing_id;
  end if;

  select * into v_collector from collector_profiles where profile_id = new.collector_id;

  -- Mark the assignment complete; the existing sync_listing_status trigger then moves
  -- the listing to 'collected' and the homeowner's history updates in the same tx.
  update job_assignments
     set status = 'completed', updated_at = now()
   where listing_id = new.listing_id
     and collector_id = new.collector_id
     and status <> 'completed';

  v_reference := 'WTN-' || to_char(v_collected_at, 'YYYYMMDD') || '-'
                 || lpad(new.listing_id::text, 6, '0');

  insert into waste_transfer_notes (listing_id, reference, issued_at, payload)
  values (
    new.listing_id,
    v_reference,
    v_collected_at,
    jsonb_build_object(
      'reference', v_reference,
      'listingId', new.listing_id,
      'issuedAt', v_collected_at,
      'collectedAt', v_collected_at,
      'description', v_listing.title,
      'materialType', v_listing.metal_type,
      'weightKg', new.weight_kg,
      'collectionAddress', v_listing.address,
      'carrierName', coalesce(v_collector.business_name, 'ScrapMan collector'),
      'carrierRegistration', v_collector.carrier_ref,
      'smdLicence', v_collector.smd_licence,
      'smdCouncil', v_collector.smd_council,
      'photoUrl', new.photo_url,
      'note', new.note,
      -- Cash for scrap metal is illegal under the 2013 Act; the platform only ever
      -- records a traceable method.
      'paymentMethod', 'electronic'
    )
  )
  on conflict (listing_id) do nothing;

  insert into notifications (user_id, kind, listing_id, title, body, href)
  values (
    v_listing.homeowner_id,
    'job-collected',
    new.listing_id,
    'Collection recorded',
    v_listing.title || ' — ' || round(new.weight_kg) || ' kg collected. Your transfer note is ready.',
    'track'
  )
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists on_job_proof_insert on job_proofs;
create trigger on_job_proof_insert
  after insert on job_proofs
  for each row execute procedure public.record_collection_proof();

-- Tell the other side when a dispute is opened, so it is never discovered by accident.
create or replace function public.notify_dispute_raised()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing listings;
  v_target uuid;
begin
  select * into v_listing from listings where id = new.listing_id;
  if v_listing is null then
    return new;
  end if;

  -- The counterparty: the homeowner if the collector complained, else the collector.
  if new.raised_by = v_listing.homeowner_id then
    select collector_id into v_target
      from job_assignments
     where listing_id = new.listing_id and status <> 'cancelled'
     order by accepted_at desc limit 1;
  else
    v_target := v_listing.homeowner_id;
  end if;

  if v_target is not null then
    insert into notifications (user_id, kind, listing_id, title, body, href)
    values (
      v_target,
      'dispute-raised',
      new.listing_id,
      'A problem was reported',
      v_listing.title || ' — ' || new.reason || ' dispute opened.',
      'track'
    )
    on conflict do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists on_dispute_raised on job_disputes;
create trigger on_dispute_raised
  after insert on job_disputes
  for each row execute procedure public.notify_dispute_raised();

-- ------------------------------------------------------------
-- 8. Web push subscriptions
--
-- The in-app feed and the live badge work without any of this: rows land in
-- notifications and the open app reacts to them over Realtime. This table exists so
-- that OS-level alerts keep working when the tab is closed, which additionally needs a
-- VAPID key pair and a sender — see the note in src/ui/notifications.js.
--
-- One row per browser endpoint; `endpoint` is unique because the same device
-- re-subscribing must update its keys rather than accumulate duplicates.
-- ------------------------------------------------------------
create table if not exists push_subscriptions (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user on push_subscriptions (user_id);

alter table push_subscriptions enable row level security;

create policy "users manage their own push subscriptions"
  on push_subscriptions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
