-- Fix: "infinite recursion detected in policy for relation candidates" (42P17).
-- The candidate-sharing policies referenced each other (candidates <-> candidate_shares
-- <-> candidate_questions/activity) via sub-selects, which re-triggered each table's
-- RLS in a loop. Replace those cross-table sub-selects with SECURITY DEFINER helper
-- functions (which bypass RLS internally), breaking the cycle.

create or replace function public.is_candidate_owner(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.candidates c
    where c.id = cid and c.user_id = auth.uid()
  );
$$;

create or replace function public.is_candidate_shared(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.candidate_shares s
    where s.candidate_id = cid and s.shared_with = auth.uid()
  );
$$;

-- candidates: owner policy is fine (auth.uid() = user_id). Recreate the shared
-- SELECT to use the helper instead of a sub-select into candidate_shares.
drop policy if exists "candidates_shared_select" on public.candidates;
create policy "candidates_shared_select" on public.candidates for select
  using (public.is_candidate_shared(id));

-- candidate_shares
drop policy if exists "cs_owner_all" on public.candidate_shares;
create policy "cs_owner_all" on public.candidate_shares for all
  using (public.is_candidate_owner(candidate_id))
  with check (public.is_candidate_owner(candidate_id));

-- candidate_questions
drop policy if exists "cq_owner_all" on public.candidate_questions;
create policy "cq_owner_all" on public.candidate_questions for all
  using (public.is_candidate_owner(candidate_id))
  with check (public.is_candidate_owner(candidate_id));
drop policy if exists "cq_shared_select" on public.candidate_questions;
create policy "cq_shared_select" on public.candidate_questions for select
  using (public.is_candidate_shared(candidate_id));

-- candidate_activity
drop policy if exists "ca_owner_all" on public.candidate_activity;
create policy "ca_owner_all" on public.candidate_activity for all
  using (public.is_candidate_owner(candidate_id))
  with check (public.is_candidate_owner(candidate_id));
drop policy if exists "ca_shared_select" on public.candidate_activity;
create policy "ca_shared_select" on public.candidate_activity for select
  using (public.is_candidate_shared(candidate_id));

-- recordings: shared users read recordings of candidates shared with them
drop policy if exists "recordings_shared_select" on public.recordings;
create policy "recordings_shared_select" on public.recordings for select
  using (candidate_id is not null and public.is_candidate_shared(candidate_id));

-- summary_nodes: shared users read nodes for those shared recordings
drop policy if exists "summary_nodes_shared_select" on public.summary_nodes;
create policy "summary_nodes_shared_select" on public.summary_nodes for select
  using (
    exists (
      select 1 from public.recordings r
      where r.id = summary_nodes.recording_id
        and r.candidate_id is not null
        and public.is_candidate_shared(r.candidate_id)
    )
  );
