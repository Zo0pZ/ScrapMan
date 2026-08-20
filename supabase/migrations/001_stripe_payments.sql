-- ScrapMan — Stripe payments (job unlocks + Pro subscription).
--
-- Run this once against the existing database (Supabase SQL editor, or `supabase db
-- push` if you adopt the CLI later). It's additive/idempotent-ish — safe to re-run,
-- it just no-ops on anything that already exists.
--
-- What changes and why:
--   * job_unlocks gets an audit trail (amount, currency, Stripe references) and loses
--     its own "insert" policy. Unlocks used to be created by the collector's own
--     browser calling `.upsert()` directly — nothing stopped a collector unlocking a
--     job for free by just calling that themselves. Only the verify-collector Node
--     app's service_role key can insert now, and it only does so after Stripe confirms
--     a real payment (see verify-collector/server.js's webhook handler).
--   * a new pro_subscriptions table tracks each collector's Stripe subscription.
--   * listing_contacts' collector-read policy is widened to also allow anyone with an
--     active/trialing Pro subscription — Pro means "every job's contact details are
--     already visible", not "unlock button skips payment" (the old, purely
--     client-side, fake implementation).

-- ---------- job_unlocks: audit columns + service_role-only writes ----------
alter table job_unlocks
  add column if not exists amount_pence integer,
  add column if not exists currency text,
  add column if not exists stripe_checkout_session_id text,
  add column if not exists stripe_payment_intent_id text;

drop policy if exists "collectors create their own unlocks" on job_unlocks;
-- No insert/update policy is added in its place — service_role (used only by the
-- webhook handler) bypasses RLS entirely, which is exactly the point.

-- ---------- pro_subscriptions ----------
create table if not exists pro_subscriptions (
  collector_id uuid primary key references profiles(id) on delete cascade,
  stripe_customer_id text not null,
  stripe_subscription_id text not null unique,
  status text not null check (status in (
    'active', 'trialing', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired'
  )),
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);

alter table pro_subscriptions enable row level security;

drop policy if exists "collectors see their own subscription" on pro_subscriptions;
create policy "collectors see their own subscription"
  on pro_subscriptions for select using (auth.uid() = collector_id);
-- No insert/update/delete policy — same reasoning as job_unlocks above: only the
-- webhook handler (service_role) is allowed to write to this table.

-- Keep updated_at current on every service_role write.
create or replace function touch_pro_subscriptions_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists pro_subscriptions_touch_updated_at on pro_subscriptions;
create trigger pro_subscriptions_touch_updated_at
  before update on pro_subscriptions
  for each row execute function touch_pro_subscriptions_updated_at();

-- ---------- listing_contacts: Pro subscribers bypass per-job unlocks ----------
drop policy if exists "collectors who unlocked the job can read contact info" on listing_contacts;
drop policy if exists "collectors who unlocked the job or are Pro can read contact info" on listing_contacts;
create policy "collectors who unlocked the job or are Pro can read contact info"
  on listing_contacts for select
  using (
    exists (
      select 1 from job_unlocks u
      where u.listing_id = listing_contacts.listing_id and u.collector_id = auth.uid()
    )
    or exists (
      select 1 from pro_subscriptions p
      where p.collector_id = auth.uid() and p.status in ('active', 'trialing')
    )
  );
