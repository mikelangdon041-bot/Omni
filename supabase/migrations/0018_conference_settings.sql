-- Omni — Conference settings + configurable questions + org-visible KOLs.
-- Run in the Supabase SQL editor.
--
--  * conferences.settings          — per-conference JSON config: which tabs
--    are enabled and the organizer-editable session/KOL question lists.
--  * conf_session_notes.custom_answers — answers to organizer-added session
--    questions, keyed by question key.
--  * conf_contacts.custom_sections — answers to organizer-added KOL profile
--    questions, keyed by question key.
--  * kols org-wide READ policy     — teammates can view (not edit) each
--    other's territory KOLs. Enables "import a colleague's KOL" into a
--    conference and fixes "Open in Territory Planning" showing "KOL not
--    found" for KOLs a teammate imported.

alter table public.conferences
  add column if not exists settings jsonb not null default '{}'::jsonb;

alter table public.conf_session_notes
  add column if not exists custom_answers jsonb not null default '{}'::jsonb;

alter table public.conf_contacts
  add column if not exists custom_sections jsonb not null default '{}'::jsonb;

-- Who captured an insight, as a display name. Used by data imported from
-- other systems where the author has no auth user in this project.
alter table public.conf_insights
  add column if not exists created_by_name text not null default '';

-- Org of a user — SECURITY DEFINER so policies can check another user's org
-- without tripping profiles RLS.
create or replace function public.user_org(uid uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from public.profiles where id = uid;
$$;

-- Keep "own kols" for writes; add org-wide read.
drop policy if exists "org read kols" on public.kols;
create policy "org read kols" on public.kols for select
  using (public.user_org(user_id) = public.current_org_id());

-- Teammates' display names (KOL import "by MSL" filter, rosters, admin lists).
drop policy if exists "org read profiles" on public.profiles;
create policy "org read profiles" on public.profiles for select
  using (public.user_org(id) = public.current_org_id());
