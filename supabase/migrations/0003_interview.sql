-- Omni — Interview Prep candidate module: candidates, question bank, per-candidate
-- questions, activity timeline, and sharing with other Omni users.
-- Reuses Omni auth/profiles + set_updated_at(). Run in the Supabase SQL editor.

-- ------------------------------------------------------------------
-- candidates
-- ------------------------------------------------------------------
create table if not exists public.candidates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  role_title text default '',
  email text default '',
  phone text default '',
  location text default '',
  status text not null default 'active'
    check (status in ('active','screening','interviewing','offer','hired','rejected','on_hold','archived')),
  resume_url text default '',
  resume_text text default '',
  summary text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_candidates_user_id on public.candidates(user_id);

drop trigger if exists candidates_set_updated_at on public.candidates;
create trigger candidates_set_updated_at before update on public.candidates
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------
-- recordings.candidate_id  (link interview recordings to a candidate)
-- ------------------------------------------------------------------
alter table public.recordings
  add column if not exists candidate_id uuid references public.candidates(id) on delete set null;
create index if not exists idx_recordings_candidate_id on public.recordings(candidate_id);

-- ------------------------------------------------------------------
-- question_bank  (reusable saved questions, per owner)
-- ------------------------------------------------------------------
create table if not exists public.question_bank (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  text text not null,
  category text default '',
  favorite boolean default false,
  source text default 'manual',          -- manual | ai
  created_at timestamptz not null default now()
);
create index if not exists idx_question_bank_user_id on public.question_bank(user_id);

-- ------------------------------------------------------------------
-- candidate_questions  (questions planned/asked for one candidate)
-- ------------------------------------------------------------------
create table if not exists public.candidate_questions (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  text text not null,
  asked boolean default false,
  answer_notes text default '',
  sort_order integer default 0,
  source text default 'manual',          -- manual | bank | ai
  bank_id uuid references public.question_bank(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_candidate_questions_candidate on public.candidate_questions(candidate_id);

-- ------------------------------------------------------------------
-- candidate_activity  (long-term history per candidate)
-- ------------------------------------------------------------------
create table if not exists public.candidate_activity (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  type text not null default 'note',     -- note | status_change | question_asked | recording | share
  body text default '',
  meta jsonb default '{}',
  created_at timestamptz not null default now()
);
create index if not exists idx_candidate_activity_candidate on public.candidate_activity(candidate_id);

-- ------------------------------------------------------------------
-- candidate_shares  (grant another Omni user access to a candidate)
-- ------------------------------------------------------------------
create table if not exists public.candidate_shares (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  shared_with uuid not null references auth.users(id) on delete cascade,
  scope jsonb not null default '{"all": true}',   -- {"all":true} or {"sections":["overview","recordings",...]}
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (candidate_id, shared_with)
);
create index if not exists idx_candidate_shares_with on public.candidate_shares(shared_with);
create index if not exists idx_candidate_shares_candidate on public.candidate_shares(candidate_id);

-- ------------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------------
alter table public.candidates          enable row level security;
alter table public.question_bank       enable row level security;
alter table public.candidate_questions enable row level security;
alter table public.candidate_activity  enable row level security;
alter table public.candidate_shares    enable row level security;

-- candidates: owner full; shared users read-only
drop policy if exists "candidates_owner_all" on public.candidates;
create policy "candidates_owner_all" on public.candidates for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "candidates_shared_select" on public.candidates;
create policy "candidates_shared_select" on public.candidates for select
  using (id in (select candidate_id from public.candidate_shares where shared_with = auth.uid()));

-- helper predicate inlined: a candidate the caller can read (owner or shared)
-- question_bank: owner only
drop policy if exists "question_bank_owner_all" on public.question_bank;
create policy "question_bank_owner_all" on public.question_bank for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- candidate_questions: owner writes; owner+shared read
drop policy if exists "cq_owner_all" on public.candidate_questions;
create policy "cq_owner_all" on public.candidate_questions for all
  using (candidate_id in (select id from public.candidates where user_id = auth.uid()))
  with check (candidate_id in (select id from public.candidates where user_id = auth.uid()));
drop policy if exists "cq_shared_select" on public.candidate_questions;
create policy "cq_shared_select" on public.candidate_questions for select
  using (candidate_id in (select candidate_id from public.candidate_shares where shared_with = auth.uid()));

-- candidate_activity: owner writes; owner+shared read
drop policy if exists "ca_owner_all" on public.candidate_activity;
create policy "ca_owner_all" on public.candidate_activity for all
  using (candidate_id in (select id from public.candidates where user_id = auth.uid()))
  with check (candidate_id in (select id from public.candidates where user_id = auth.uid()));
drop policy if exists "ca_shared_select" on public.candidate_activity;
create policy "ca_shared_select" on public.candidate_activity for select
  using (candidate_id in (select candidate_id from public.candidate_shares where shared_with = auth.uid()));

-- candidate_shares: candidate owner manages; the shared user can see their own row
drop policy if exists "cs_owner_all" on public.candidate_shares;
create policy "cs_owner_all" on public.candidate_shares for all
  using (candidate_id in (select id from public.candidates where user_id = auth.uid()))
  with check (candidate_id in (select id from public.candidates where user_id = auth.uid()));
drop policy if exists "cs_shared_select" on public.candidate_shares;
create policy "cs_shared_select" on public.candidate_shares for select
  using (shared_with = auth.uid());

-- recordings: shared users may read recordings of candidates shared with them
drop policy if exists "recordings_shared_select" on public.recordings;
create policy "recordings_shared_select" on public.recordings for select
  using (candidate_id in (select candidate_id from public.candidate_shares where shared_with = auth.uid()));

-- summary_nodes: shared users may read nodes for those shared recordings
drop policy if exists "summary_nodes_shared_select" on public.summary_nodes;
create policy "summary_nodes_shared_select" on public.summary_nodes for select
  using (
    recording_id in (
      select r.id from public.recordings r
      where r.candidate_id in (
        select candidate_id from public.candidate_shares where shared_with = auth.uid()
      )
    )
  );

-- ------------------------------------------------------------------
-- Storage: private resumes bucket
-- ------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('resumes', 'resumes', false)
on conflict (id) do nothing;

drop policy if exists "resumes_owner_select" on storage.objects;
create policy "resumes_owner_select" on storage.objects for select to authenticated
  using (bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "resumes_owner_insert" on storage.objects;
create policy "resumes_owner_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "resumes_owner_delete" on storage.objects;
create policy "resumes_owner_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text);
