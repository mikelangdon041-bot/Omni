-- Omni — Phase 1 schema: profiles, recordings, summary_nodes + storage bucket & RLS
-- Run in the Supabase SQL editor (or psql with the DB password).

-- ------------------------------------------------------------------
-- Extensions
-- ------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ------------------------------------------------------------------
-- updated_at helper
-- ------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ------------------------------------------------------------------
-- profiles  (username/password auth — username lives here)
-- ------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  username     text unique not null,
  display_name text,
  created_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- ------------------------------------------------------------------
-- recordings  (one row per uploaded audio; drives the pipeline)
-- ------------------------------------------------------------------
create table if not exists public.recordings (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  title        text not null default 'Untitled recording',
  storage_path text,                                   -- {user_id}/{recording_id}/original.<ext>
  status       text not null default 'uploading'
               check (status in ('uploading','transcribing','summarizing','complete','error')),
  total_chunks int not null default 0,
  chunks_done  int not null default 0,
  transcript   text not null default '',
  error        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists recordings_user_id_idx on public.recordings(user_id);

drop trigger if exists recordings_set_updated_at on public.recordings;
create trigger recordings_set_updated_at
  before update on public.recordings
  for each row execute function public.set_updated_at();

alter table public.recordings enable row level security;

drop policy if exists "recordings_owner_all" on public.recordings;
create policy "recordings_owner_all" on public.recordings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ------------------------------------------------------------------
-- summary_nodes  (adjacency-list tree of nested bullets)
-- ------------------------------------------------------------------
create table if not exists public.summary_nodes (
  id           uuid primary key default gen_random_uuid(),
  recording_id uuid not null references public.recordings(id) on delete cascade,
  parent_id    uuid references public.summary_nodes(id) on delete cascade,
  content      text not null,
  depth        int not null default 0,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now()
);

create index if not exists summary_nodes_recording_idx on public.summary_nodes(recording_id);
create index if not exists summary_nodes_parent_idx on public.summary_nodes(parent_id);

alter table public.summary_nodes enable row level security;

-- A node is visible/editable if the caller owns its recording.
drop policy if exists "summary_nodes_owner_all" on public.summary_nodes;
create policy "summary_nodes_owner_all" on public.summary_nodes
  for all using (
    exists (
      select 1 from public.recordings r
      where r.id = summary_nodes.recording_id and r.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.recordings r
      where r.id = summary_nodes.recording_id and r.user_id = auth.uid()
    )
  );

-- ------------------------------------------------------------------
-- Storage bucket: private "recordings"
-- ------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('recordings', 'recordings', false)
on conflict (id) do nothing;

-- Authenticated users may touch only objects under their own {user_id}/ prefix.
-- (Server jobs use the service-role key, which bypasses these policies.)
drop policy if exists "recordings_storage_owner_select" on storage.objects;
create policy "recordings_storage_owner_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "recordings_storage_owner_insert" on storage.objects;
create policy "recordings_storage_owner_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "recordings_storage_owner_delete" on storage.objects;
create policy "recordings_storage_owner_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text);
