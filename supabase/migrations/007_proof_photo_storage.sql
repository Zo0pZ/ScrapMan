-- 007 — Collection-proof photos: private bucket, participant-scoped policies,
--       and the job_proofs columns the proof sheet actually writes.
--
-- Why this exists: src/ui/proofs.js has always uploaded to a "job-proofs" storage
-- bucket, but no migration ever created that bucket or any policy on it. Proof
-- uploads therefore either failed silently (the proof saved with no photo) or, if
-- the bucket had been created by hand as public, exposed doorstep photos of
-- people's homes to anyone with the URL. A proof photo is evidence in a dispute —
-- it must be readable only by the two parties on that job.
--
-- Path convention written by the client: <listing_id>/<timestamp>-<safe-filename>
-- so the first path segment identifies the job, which is what the policies below
-- use to decide who may read or write an object.

-- ------------------------------------------------------------
-- 1. Private bucket
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'job-proofs',
  'job-proofs',
  false,
  5242880, -- 5 MB: a phone photo, not a video
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ------------------------------------------------------------
-- 2. job_proofs columns the proof sheet writes
-- ------------------------------------------------------------
-- 006 created the table before the proof sheet settled on its shape. The sheet
-- inserts assignment_id, payment_method and photo_path, so without these the
-- insert fails with "column does not exist" and no proof can ever be recorded.
alter table job_proofs
  add column if not exists assignment_id bigint references job_assignments(id) on delete set null,
  add column if not exists payment_method text,
  add column if not exists photo_path text;

comment on column job_proofs.photo_path is
  'Object path inside the private job-proofs bucket (e.g. 42/1712345678-load.jpg). Render with a short-lived signed URL, never a public URL.';

create index if not exists job_proofs_assignment_idx on job_proofs (assignment_id);

-- ------------------------------------------------------------
-- 2b. Make a proof-less completion say so
-- ------------------------------------------------------------
-- A household can already mark its own job collected (migration 005) when the
-- collector forgets to. That path writes no job_proofs row, so the job looks
-- identical to a properly evidenced one and the waste transfer note — the record
-- that matters in a dispute — silently never existed. The flag makes the difference
-- visible instead of implicit: reports can count unevidenced completions, the card
-- shows a "no proof" marker, and the household is offered the weight form.
alter table job_assignments
  add column if not exists completed_without_proof boolean not null default false;

comment on column job_assignments.completed_without_proof is
  'True when the household marked the job collected without a job_proofs row, so no waste transfer note was issued.';

-- When the weight is finally recorded — usually the household adding it after tapping
-- "Mark as collected" — the job is evidenced after all, so the marker must clear itself.
create or replace function public.clear_completed_without_proof()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update job_assignments
     set completed_without_proof = false
   where completed_without_proof
     and (id = new.assignment_id or listing_id = new.listing_id);
  return new;
end $$;

drop trigger if exists job_proofs_clear_no_proof on job_proofs;
create trigger job_proofs_clear_no_proof
  after insert on job_proofs
  for each row execute function public.clear_completed_without_proof();

-- ------------------------------------------------------------
-- 3. Storage policies — participants only, read and write
-- ------------------------------------------------------------
drop policy if exists "participants upload proof photos" on storage.objects;
drop policy if exists "participants read proof photos" on storage.objects;

-- Upload: only the assigned collector or the listing's household, and only into a
-- folder named after a job they are actually party to.
create policy "participants upload proof photos"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'job-proofs'
    and exists (
      select 1
      from job_assignments a
      join listings l on l.id = a.listing_id
      where a.listing_id::text = split_part(storage.objects.name, '/', 1)
        and a.status <> 'cancelled'
        and (auth.uid() = a.collector_id or auth.uid() = l.homeowner_id)
    )
  );

-- Read: same two parties. This also governs createSignedUrl(), so the UI can mint
-- a short-lived link for display without ever making the object public.
create policy "participants read proof photos"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'job-proofs'
    and exists (
      select 1
      from job_assignments a
      join listings l on l.id = a.listing_id
      where a.listing_id::text = split_part(storage.objects.name, '/', 1)
        and (auth.uid() = a.collector_id or auth.uid() = l.homeowner_id)
    )
  );

-- No update or delete policy on purpose: a photo that can be replaced afterwards
-- is not evidence, and the proof row it belongs to is immutable for the same reason.
