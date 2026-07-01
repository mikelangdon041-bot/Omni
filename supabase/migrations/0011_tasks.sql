-- Omni — global tasks. One to-do list for the whole framework: tasks from any
-- app (territory, interview prep, …) surface together in the top bar. Each task
-- optionally links back to the thing it's about (a KOL, an interview, etc.).
-- Run in the Supabase SQL editor.

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  notes text default '',
  app text not null default 'general',      -- general | territory | interview
  link text default '',                      -- where clicking the task goes
  entity_label text default '',              -- e.g. the KOL or candidate name
  due_date timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_tasks_user on public.tasks(user_id, completed_at);
create index if not exists idx_tasks_due on public.tasks(due_date);

drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at before update on public.tasks
  for each row execute function public.set_updated_at();

alter table public.tasks enable row level security;

drop policy if exists "tasks_own_all" on public.tasks;
create policy "tasks_own_all" on public.tasks for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
