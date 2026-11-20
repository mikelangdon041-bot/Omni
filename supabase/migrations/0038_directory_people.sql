-- The people a meeting invite can be addressed to, so "set up a meeting with
-- Shane and Glenn" arrives in Outlook with their addresses already filled in.
--
-- Two ways in, and `source` says which:
--   'import'  - a company directory or contacts export the user uploaded
--   'outlook' - someone on an email the Outlook pane read (from, to, cc),
--               learned as a side effect so the list grows on its own
-- An import outranks what was learned: it carries title and department, and a
-- display name from a mail header is often "Last, First" or just the address.
--
-- PRIVATE to the user who imported it. A company directory is the user's own
-- reference, not something shared across the org through Omni.

create table if not exists public.directory_people (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default '',
  -- Stored lowercase, so one person is one row however a header capitalised it.
  email text not null,
  title text not null default '',
  department text not null default '',
  source text not null default 'import' check (source in ('import', 'outlook')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, email)
);

create index if not exists idx_directory_people_user on public.directory_people(user_id);

drop trigger if exists directory_people_set_updated_at on public.directory_people;
create trigger directory_people_set_updated_at before update on public.directory_people
  for each row execute function public.set_updated_at();

alter table public.directory_people enable row level security;

drop policy if exists "own directory" on public.directory_people;
create policy "own directory" on public.directory_people for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
