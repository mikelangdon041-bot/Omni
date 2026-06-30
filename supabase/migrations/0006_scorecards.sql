-- Omni — Interview Prep scorecards / structured feedback.
-- One feedback row per interviewer per candidate. Interviewers get access to a
-- candidate via candidate_shares (scope {"role":"interviewer"}). Feedback stays
-- hidden from other interviewers until they submit their own (reduces bias).
-- Run in the Supabase SQL editor.

create table if not exists public.interview_feedback (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  recommendation text
    check (recommendation in ('strong_no', 'no', 'yes', 'strong_yes')),
  ratings jsonb not null default '[]',   -- [{competency, rating(1-4), comment}]
  notes text default '',
  submitted boolean not null default false,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (candidate_id, user_id)
);
create index if not exists idx_interview_feedback_candidate on public.interview_feedback(candidate_id);

drop trigger if exists interview_feedback_set_updated_at on public.interview_feedback;
create trigger interview_feedback_set_updated_at before update on public.interview_feedback
  for each row execute function public.set_updated_at();

-- Has the caller submitted their own feedback for this candidate? (definer →
-- bypasses RLS so it can't recurse on interview_feedback policies.)
create or replace function public.has_submitted_feedback(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.interview_feedback f
    where f.candidate_id = cid and f.user_id = auth.uid() and f.submitted
  );
$$;

alter table public.interview_feedback enable row level security;

-- Author: full control of their own row.
drop policy if exists "feedback_author_all" on public.interview_feedback;
create policy "feedback_author_all" on public.interview_feedback for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Candidate owner: read all feedback on their candidate.
drop policy if exists "feedback_owner_read" on public.interview_feedback;
create policy "feedback_owner_read" on public.interview_feedback for select
  using (public.is_candidate_owner(candidate_id));

-- Peer interviewer: read others' feedback only once submitted AND the caller has
-- submitted their own (hidden-until-submitted).
drop policy if exists "feedback_peer_read" on public.interview_feedback;
create policy "feedback_peer_read" on public.interview_feedback for select
  using (submitted and public.has_submitted_feedback(candidate_id));
