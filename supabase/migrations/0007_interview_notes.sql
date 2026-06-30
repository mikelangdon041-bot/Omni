-- Omni — Interview Prep: structured candidate notes (impressions / strengths /
-- opportunities, rich HTML) and written interview notes (interviews without a
-- recording). Run in the Supabase SQL editor.

-- Structured overview notes on the candidate (rich HTML).
alter table public.candidates
  add column if not exists overall_impressions text default '';
alter table public.candidates
  add column if not exists strengths text default '';
alter table public.candidates
  add column if not exists opportunities text default '';

-- Written interviews (no audio): a rich-text write-up tied to a candidate.
create table if not exists public.interview_notes (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Interview notes',
  content text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_interview_notes_candidate on public.interview_notes(candidate_id);

drop trigger if exists interview_notes_set_updated_at on public.interview_notes;
create trigger interview_notes_set_updated_at before update on public.interview_notes
  for each row execute function public.set_updated_at();

alter table public.interview_notes enable row level security;

-- Author full control; candidate owner reads all; shared interviewers read.
drop policy if exists "inotes_author_all" on public.interview_notes;
create policy "inotes_author_all" on public.interview_notes for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "inotes_owner_read" on public.interview_notes;
create policy "inotes_owner_read" on public.interview_notes for select
  using (public.is_candidate_owner(candidate_id));
drop policy if exists "inotes_shared_read" on public.interview_notes;
create policy "inotes_shared_read" on public.interview_notes for select
  using (public.is_candidate_shared(candidate_id));
