-- Omni — Territory v2: cleaner vocabulary + MSL activity reporting.
--
-- 1) how_met: rename the legacy value 'unresponsive_emails' (it always meant
--    the KOL *responded* to email outreach) to 'responded_emails', and retire
--    the unused 'special_program' option.
-- 2) activities: can now be MSL events (clinical/payer presentations, MIRFs,
--    trainings, congress activity) with an optional attendee count, and can
--    exist without a KOL (backfilled from the monthly report page). user_id
--    makes those rows ownable; existing rows are backfilled from their KOL.
-- 3) territory_category_labels: org-level renames for the reporting
--    categories (e.g. a company that says "Scientific exchange"); editable
--    by org admins, readable by everyone in the org.
--
-- Run in the Supabase SQL editor.

-- ------------------------------------------------------------------
-- 1) how_met vocabulary
-- ------------------------------------------------------------------
alter table public.kols drop constraint if exists kols_how_met_check;
update public.kols set how_met = 'responded_emails' where how_met = 'unresponsive_emails';
update public.kols set how_met = 'other' where how_met = 'special_program';
alter table public.kols add constraint kols_how_met_check
  check (how_met in ('conference','responded_emails','commercial_introduction',
                     'clinical_trial_site','meets_regularly','other'));

-- ------------------------------------------------------------------
-- 2) activities as general MSL events
-- ------------------------------------------------------------------
alter table public.activities
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists attendees integer;
alter table public.activities alter column kol_id drop not null;

update public.activities a set user_id = k.user_id
  from public.kols k
  where a.kol_id = k.id and a.user_id is null;

create index if not exists idx_activities_user_id on public.activities(user_id);

drop policy if exists "own activities" on public.activities;
create policy "own activities" on public.activities for all
  using (
    (user_id is not null and user_id = auth.uid())
    or (kol_id is not null and kol_id in (select id from public.kols where user_id = auth.uid()))
  )
  with check (
    (user_id is not null and user_id = auth.uid())
    or (kol_id is not null and kol_id in (select id from public.kols where user_id = auth.uid()))
  );

-- ------------------------------------------------------------------
-- 3) org-level category labels
-- ------------------------------------------------------------------
create table if not exists public.territory_category_labels (
  org_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  label text not null,
  updated_at timestamptz not null default now(),
  primary key (org_id, key)
);

alter table public.territory_category_labels enable row level security;

drop policy if exists "tcl_org_read" on public.territory_category_labels;
create policy "tcl_org_read" on public.territory_category_labels for select
  using (org_id = public.current_org_id());

drop policy if exists "tcl_admin_write" on public.territory_category_labels;
create policy "tcl_admin_write" on public.territory_category_labels for all
  using (org_id = public.current_org_id() and public.is_org_admin())
  with check (org_id = public.current_org_id() and public.is_org_admin());
