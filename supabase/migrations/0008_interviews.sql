-- Omni — Interviews as first-class, schedulable, assignable workspaces.
-- An "interview" is a planned session for a candidate: it can be assigned to a
-- teammate, scheduled ahead of time, opened full-screen during the meeting, and
-- holds rich notes, planned questions (with per-question answer notes), an
-- optional audio recording, next steps and a follow-up date.
--
-- Access model: candidate owners + org admins/owners see everything; a regular
-- member sees only the interviews assigned to them (plus that candidate's
-- overview + their own scorecard). Run in the Supabase SQL editor.

-- ------------------------------------------------------------------
-- interviews
-- ------------------------------------------------------------------
create table if not exists public.interviews (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  assignee_id uuid references auth.users(id) on delete set null,
  title text not null default 'Interview',
  stage text default 'interview',            -- phone_screen | interview | panel | onsite | reference_check | other
  scheduled_at timestamptz,
  duration_min integer,
  location text default '',
  status text not null default 'scheduled'
    check (status in ('scheduled','in_progress','complete','canceled')),
  notes text default '',                     -- rich HTML (main interview notes)
  next_steps text default '',
  follow_up_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_interviews_candidate on public.interviews(candidate_id);
create index if not exists idx_interviews_assignee on public.interviews(assignee_id);

drop trigger if exists interviews_set_updated_at on public.interviews;
create trigger interviews_set_updated_at before update on public.interviews
  for each row execute function public.set_updated_at();

-- Link recordings + planned questions to a specific interview.
alter table public.recordings
  add column if not exists interview_id uuid references public.interviews(id) on delete set null;
create index if not exists idx_recordings_interview on public.recordings(interview_id);

alter table public.candidate_questions
  add column if not exists interview_id uuid references public.interviews(id) on delete set null;
create index if not exists idx_cq_interview on public.candidate_questions(interview_id);

-- Free-text notes on a recording (rich HTML), shown on the recording view.
alter table public.recordings
  add column if not exists notes text default '';

-- ------------------------------------------------------------------
-- in-app notifications (assignments, etc.)
-- ------------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,   -- recipient
  type text not null default 'interview_assigned',
  title text not null,
  body text default '',
  link text default '',
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_notifications_user on public.notifications(user_id, read);

-- ------------------------------------------------------------------
-- interview invites (for people not yet in the org)
-- ------------------------------------------------------------------
create table if not exists public.interview_invites (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid references public.interviews(id) on delete cascade,
  email text default '',
  username text default '',
  token text unique,
  invited_by uuid references auth.users(id) on delete set null,
  accepted boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_invites_interview on public.interview_invites(interview_id);

-- ------------------------------------------------------------------
-- Helper: is the caller an assignee of any interview for this candidate?
-- SECURITY DEFINER so candidate/question/recording policies can call it
-- without recursing through interviews' own RLS.
-- ------------------------------------------------------------------
create or replace function public.is_interview_assignee_of(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.interviews i
    where i.candidate_id = cid and i.assignee_id = auth.uid()
  );
$$;

-- ------------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------------
alter table public.interviews        enable row level security;
alter table public.notifications     enable row level security;
alter table public.interview_invites enable row level security;

-- interviews: candidate owner full control; assignee may read + update
-- (edit notes/status while running the interview).
drop policy if exists "interviews_owner_all" on public.interviews;
create policy "interviews_owner_all" on public.interviews for all
  using (public.is_candidate_owner(candidate_id))
  with check (public.is_candidate_owner(candidate_id));

drop policy if exists "interviews_assignee_select" on public.interviews;
create policy "interviews_assignee_select" on public.interviews for select
  using (assignee_id = auth.uid());

drop policy if exists "interviews_assignee_update" on public.interviews;
create policy "interviews_assignee_update" on public.interviews for update
  using (assignee_id = auth.uid())
  with check (assignee_id = auth.uid());

-- candidates: an assignee can read the candidate they're assigned to interview.
drop policy if exists "candidates_assignee_select" on public.candidates;
create policy "candidates_assignee_select" on public.candidates for select
  using (public.is_interview_assignee_of(id));

-- candidate_questions: assignee can read + update (answer notes, order) for
-- candidates they're assigned to interview.
drop policy if exists "cq_assignee_select" on public.candidate_questions;
create policy "cq_assignee_select" on public.candidate_questions for select
  using (public.is_interview_assignee_of(candidate_id));
drop policy if exists "cq_assignee_update" on public.candidate_questions;
create policy "cq_assignee_update" on public.candidate_questions for update
  using (public.is_interview_assignee_of(candidate_id))
  with check (public.is_interview_assignee_of(candidate_id));

-- recordings: assignee can read + upload recordings for their interviews.
drop policy if exists "recordings_assignee_select" on public.recordings;
create policy "recordings_assignee_select" on public.recordings for select
  using (candidate_id is not null and public.is_interview_assignee_of(candidate_id));
drop policy if exists "recordings_assignee_insert" on public.recordings;
create policy "recordings_assignee_insert" on public.recordings for insert
  with check (candidate_id is not null and public.is_interview_assignee_of(candidate_id));

-- summary_nodes: assignee can read summary nodes for their assigned recordings.
drop policy if exists "summary_nodes_assignee_select" on public.summary_nodes;
create policy "summary_nodes_assignee_select" on public.summary_nodes for select
  using (
    recording_id in (
      select r.id from public.recordings r
      where r.candidate_id is not null
        and public.is_interview_assignee_of(r.candidate_id)
    )
  );

-- notifications: recipient reads + updates (mark read) their own. Inserts are
-- performed server-side with the service role (assigning for a teammate).
drop policy if exists "notifications_own_select" on public.notifications;
create policy "notifications_own_select" on public.notifications for select
  using (user_id = auth.uid());
drop policy if exists "notifications_own_update" on public.notifications;
create policy "notifications_own_update" on public.notifications for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- interview_invites: the inviter can see their invites.
drop policy if exists "invites_owner_select" on public.interview_invites;
create policy "invites_owner_select" on public.interview_invites for select
  using (invited_by = auth.uid());
