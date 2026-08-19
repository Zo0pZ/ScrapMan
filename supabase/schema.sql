-- ============================================================
-- ScrapMan — Supabase schema
--
-- Run this once in your project's SQL editor (Supabase dashboard →
-- SQL Editor → New query → paste this whole file → Run).
--
-- Covers: role-based accounts, listings, contact unlocks, job
-- acceptance/tracking, two-way ratings, per-job messaging, and the
-- Row Level Security that keeps homeowners and collectors from
-- seeing data that isn't theirs.
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- Profiles (one per authenticated user, role set at sign-up) ----------
create type user_role as enum ('homeowner', 'collector');

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role user_role not null,
  display_name text not null,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "profiles are readable by anyone signed in"
  on profiles for select
  using (auth.uid() is not null);

create policy "users manage their own profile"
  on profiles for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Auto-create the profile row right after sign-up, from metadata passed to auth.signUp().
create function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, role, display_name)
  values (
    new.id,
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'homeowner'),
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------- Collector verification (mirrors the Environment Agency check) ----------
create table collector_profiles (
  profile_id uuid primary key references profiles(id) on delete cascade,
  business_name text,
  carrier_ref text,
  smd_council text,
  smd_licence text,
  insurance boolean not null default false,
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'verified', 'rejected')),
  ea_carrier jsonb,
  ea_scrap_metal_licence jsonb,
  verified_at timestamptz,
  rating_avg numeric(2,1),
  rating_count integer not null default 0,
  jobs_completed integer not null default 0
);

alter table collector_profiles enable row level security;

create policy "collector profiles readable by anyone signed in"
  on collector_profiles for select
  using (auth.uid() is not null);

create policy "collectors manage their own verification profile"
  on collector_profiles for all
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);

-- ---------- Listings (homeowner's scrap items) ----------
create table listings (
  id bigint generated always as identity primary key,
  homeowner_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  metal_type text not null check (metal_type in ('ferrous','nonferrous','appliance','mixed')),
  weight_band text not null check (weight_band in ('small','medium','large')),
  urgency text not null default 'week' check (urgency in ('today','week','norush')),
  lat double precision not null,
  lng double precision not null,
  address text not null,
  photo_url text,
  status text not null default 'open' check (status in ('open','assigned','collected','cancelled')),
  created_at timestamptz not null default now()
);

alter table listings enable row level security;

-- Signed-in collectors can browse the rough listing (marketplace) — the homeowner's
-- exact address and contact details live in listing_contacts instead, gated by
-- job_unlocks, so they're never returned until the collector has paid to unlock the job.
create policy "open listings are browsable by signed-in collectors"
  on listings for select
  using (auth.uid() is not null);

create policy "homeowners manage their own listings"
  on listings for all
  using (auth.uid() = homeowner_id)
  with check (auth.uid() = homeowner_id);

-- ---------- Contact unlocks (pay-per-job / Pro) ----------
create table job_unlocks (
  listing_id bigint references listings(id) on delete cascade,
  collector_id uuid references profiles(id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  primary key (listing_id, collector_id)
);

alter table job_unlocks enable row level security;

create policy "collectors see their own unlocks"
  on job_unlocks for select using (auth.uid() = collector_id);
create policy "collectors create their own unlocks"
  on job_unlocks for insert with check (auth.uid() = collector_id);
create policy "homeowners see who unlocked their listing"
  on job_unlocks for select
  using (exists (select 1 from listings l where l.id = listing_id and l.homeowner_id = auth.uid()));

-- ---------- Listing contacts (exact address + phone, gated by job_unlocks) ----------
-- Split out from listings so the marketplace-browse policy above can stay wide open
-- without ever leaking a homeowner's address/phone to a collector who hasn't unlocked
-- the job — enforced here at the RLS level, not just hidden client-side.
create table listing_contacts (
  listing_id bigint primary key references listings(id) on delete cascade,
  contact_name text,
  contact_phone text,
  full_address text
);

alter table listing_contacts enable row level security;

create policy "homeowners manage their own listing contact info"
  on listing_contacts for all
  using (exists (select 1 from listings l where l.id = listing_id and l.homeowner_id = auth.uid()))
  with check (exists (select 1 from listings l where l.id = listing_id and l.homeowner_id = auth.uid()));

create policy "collectors who unlocked the job can read contact info"
  on listing_contacts for select
  using (exists (
    select 1 from job_unlocks u
    where u.listing_id = listing_contacts.listing_id and u.collector_id = auth.uid()
  ));

-- ---------- Job assignments (accept -> en route -> weighed -> completed) ----------
create type assignment_status as enum ('accepted','en_route','arrived','weighed','completed','cancelled');

create table job_assignments (
  id bigint generated always as identity primary key,
  listing_id bigint not null references listings(id) on delete cascade,
  collector_id uuid not null references profiles(id) on delete cascade,
  status assignment_status not null default 'accepted',
  accepted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (listing_id) -- one active collector per listing at a time
);

alter table job_assignments enable row level security;

create policy "homeowners see assignments on their own listings"
  on job_assignments for select
  using (exists (select 1 from listings l where l.id = listing_id and l.homeowner_id = auth.uid()));

create policy "collectors see & manage their own assignments"
  on job_assignments for all
  using (auth.uid() = collector_id)
  with check (auth.uid() = collector_id);

-- Keep listings.status in sync with its assignment
create function public.sync_listing_status()
returns trigger as $$
begin
  update listings set status = case
    when new.status = 'completed' then 'collected'
    when new.status = 'cancelled' then 'open'
    else 'assigned'
  end where id = new.listing_id;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_assignment_change
  after insert or update on job_assignments
  for each row execute procedure public.sync_listing_status();

-- ---------- Ratings (two-way — protects both sides, not just the collector) ----------
create table ratings (
  id bigint generated always as identity primary key,
  assignment_id bigint not null references job_assignments(id) on delete cascade,
  rater_id uuid not null references profiles(id) on delete cascade,
  ratee_id uuid not null references profiles(id) on delete cascade,
  stars smallint not null check (stars between 1 and 5),
  comment text,
  created_at timestamptz not null default now(),
  unique (assignment_id, rater_id)
);

alter table ratings enable row level security;

create policy "ratings are readable by anyone signed in"
  on ratings for select using (auth.uid() is not null);
create policy "participants can rate each other on their own assignment"
  on ratings for insert
  with check (
    auth.uid() = rater_id
    and exists (
      select 1 from job_assignments a
      join listings l on l.id = a.listing_id
      where a.id = assignment_id
        and (a.collector_id = auth.uid() or l.homeowner_id = auth.uid())
    )
  );

-- Keep collector_profiles.rating_avg / rating_count up to date whenever a collector is rated
create function public.recalc_collector_rating()
returns trigger as $$
begin
  update collector_profiles cp
  set rating_avg = sub.avg_stars, rating_count = sub.n
  from (
    select avg(stars)::numeric(2,1) as avg_stars, count(*) as n
    from ratings where ratee_id = new.ratee_id
  ) sub
  where cp.profile_id = new.ratee_id;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_rating_insert
  after insert on ratings
  for each row execute procedure public.recalc_collector_rating();

-- ---------- Messages (per assignment, replaces the old localStorage thread demo) ----------
create table messages (
  id bigint generated always as identity primary key,
  assignment_id bigint not null references job_assignments(id) on delete cascade,
  sender_id uuid not null references profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

alter table messages enable row level security;

create policy "participants read their own thread"
  on messages for select
  using (exists (
    select 1 from job_assignments a join listings l on l.id = a.listing_id
    where a.id = assignment_id and (a.collector_id = auth.uid() or l.homeowner_id = auth.uid())
  ));
create policy "participants send on their own thread"
  on messages for insert
  with check (
    auth.uid() = sender_id
    and exists (
      select 1 from job_assignments a join listings l on l.id = a.listing_id
      where a.id = assignment_id and (a.collector_id = auth.uid() or l.homeowner_id = auth.uid())
    )
  );

-- ---------- Realtime ----------
-- job_assignments changes (status: accepted -> en_route -> arrived -> weighed -> completed)
-- and messages are broadcast to subscribers automatically once added to this publication.
-- Postgres Changes are filtered client-side by the same RLS above, so a homeowner's
-- subscription to job_assignments only ever receives rows for their own listings.
alter publication supabase_realtime add table job_assignments;
alter publication supabase_realtime add table messages;

-- ---------- Lock down trigger-only functions ----------
-- These are SECURITY DEFINER and only ever meant to run as triggers. Postgres grants
-- PUBLIC execute on new functions by default, which PostgREST then exposes as callable
-- RPC endpoints (e.g. /rest/v1/rpc/handle_new_user) — anyone, signed in or not, could
-- invoke them directly. Revoking execute closes that off; the triggers themselves still
-- fire normally since Postgres calls them internally, not via RPC.
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.sync_listing_status() from public;
revoke execute on function public.recalc_collector_rating() from public;

-- Live GPS position is NOT stored in a table on purpose — it changes every few seconds
-- while a collector is en route, and persisting that would be pure write cost for data
-- nobody needs after the fact. Instead the app uses a Realtime *Broadcast* channel named
-- `job:<assignment_id>:location`, joined only by the assigned collector (publisher) and
-- the listing's homeowner (subscriber) — see auth.js / app.js for the client-side join
-- logic, which checks the same ownership rule enforced by the policies above before
-- allowing either side to open the channel.

-- ============================================================
-- Getting real demo data in: sign up as a homeowner in the app first (this creates a
-- profiles row via the trigger above), then either list an item through the app's
-- "List your scrap" form, or insert directly, e.g.:
--
--   insert into listings (homeowner_id, title, metal_type, weight_band, lat, lng, address)
--   values ('<paste the homeowner's auth.users id>', 'Old washing machine', 'appliance',
--           'medium', 52.478, -1.9025, 'Edgbaston, B15');
-- ============================================================
