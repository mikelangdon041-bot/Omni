-- Meeting Prep: Person / Topic folders. Recordings are filed under a person
-- ("Sam") or a topic ("Compliance") while the meeting is still running, with
-- an "Uncategorized" fallback (folder_id null) carrying a reminder to file it
-- later. This replaces OneNote as the default destination — OneNote stays
-- available as a manual, optional hand-off (see SendToOneNote.tsx), just no
-- longer where a recording lands automatically.
-- Run in the Supabase SQL editor.

create table if not exists public.mp_folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('person','topic')),
  name text not null,
  -- Only meaningful for kind = 'person'. Links this folder to a Territory
  -- Planning KOL so filing a meeting here can also keep kol_id in step
  -- (see /api/meeting/folders). Left null for a person who isn't a KOL —
  -- an MSL, a teammate — and always null for a topic folder.
  kol_id uuid references public.kols(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Case-insensitive: "Sam" and "sam" typed on two different days must land in
-- the same folder rather than silently forking it.
create unique index if not exists idx_mp_folders_user_kind_name
  on public.mp_folders(user_id, kind, lower(name));

-- At most one folder per KOL, so "link a KOL" can't fork the same person
-- into two folders.
create unique index if not exists idx_mp_folders_user_kol
  on public.mp_folders(user_id, kol_id) where kol_id is not null;

create index if not exists idx_mp_folders_user on public.mp_folders(user_id, kind, name);

drop trigger if exists mp_folders_set_updated_at on public.mp_folders;
create trigger mp_folders_set_updated_at before update on public.mp_folders
  for each row execute function public.set_updated_at();

alter table public.mp_folders enable row level security;

drop policy if exists "own mp folders" on public.mp_folders;
create policy "own mp folders" on public.mp_folders for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ------------------------------------------------------------------
-- mp_meetings: which folder a recording lives in, plus where its zipped
-- transcript landed in storage (bucket "transcripts", path
-- {userId}/{folderId|uncategorized}/{meetingId}.zip). Null folder_id is the
-- "Uncategorized" bucket the UI reminds you to file.
-- ------------------------------------------------------------------
alter table public.mp_meetings
  add column if not exists folder_id uuid references public.mp_folders(id) on delete set null;
alter table public.mp_meetings
  add column if not exists transcript_zip_path text not null default '';

create index if not exists idx_mp_meetings_folder on public.mp_meetings(folder_id);
