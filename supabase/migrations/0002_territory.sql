-- Omni — Territory Planning module schema (KOLs, activities, meetings, goals,
-- reminders, push subscriptions, feedback) + kol-photos storage bucket.
-- Reuses Omni's existing auth + public.profiles (from 0001) and the
-- public.set_updated_at() trigger function. Run in the Supabase SQL editor.

-- ------------------------------------------------------------------
-- kols: the rep's territory of contacts
-- ------------------------------------------------------------------
create table if not exists public.kols (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  specialty text default '',
  address text default '',
  phone text default '',
  email text default '',
  institution text default '',
  is_product_a_user boolean default false,
  is_product_b_user boolean default false,
  website_office text default '',
  website_pubmed text default '',
  website_other text default '',
  photo_url text default '',
  title_position text default '',
  society_associations text default '',
  leadership_appointments text default '',
  publications text default '',
  how_met text default 'other'
    check (how_met in ('conference','unresponsive_emails','commercial_introduction',
                       'clinical_trial_site','meets_regularly','special_program','other')),
  how_met_other text default '',
  relationship_level text default 'not_yet_established'
    check (relationship_level in ('not_yet_established','infancy','hesitant','moderate','strong','advocate')),
  other_info text default '',
  areas_of_interest text default '',
  potential_collaborations text default '',
  primary_objective text default '',
  backup_questions text default '',
  engagement_score integer default 0,
  priority integer default 0,
  tier text default '',
  kol_status text default 'active',          -- active | moved | retired | archived
  list_name text default '',
  latitude double precision,
  longitude double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_kols_user_id on public.kols(user_id);

drop trigger if exists kols_set_updated_at on public.kols;
create trigger kols_set_updated_at before update on public.kols
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------
-- activities: the timeline (outreach cycles -> meetings)
-- ------------------------------------------------------------------
create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  kol_id uuid not null references public.kols(id) on delete cascade,
  type text not null,                        -- outbound | inbound | unsolicited | meeting | note | status_change
  status text default 'no_outreach',
  outreach_method text,                      -- email | phone | in_person | video_call | text | other
  outreach_number integer default 1,
  meeting_cycle integer default 1,           -- 0 = special-program sentinel
  date timestamptz not null default now(),
  notes text default '',                     -- sanitized HTML (rich text)
  status_other text default '',
  program_product text,
  program_indication text,
  program_manager text,
  program_agreed_to_meeting boolean,
  program_training_date timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_activities_kol_id on public.activities(kol_id);
create index if not exists idx_activities_date on public.activities(date);

-- ------------------------------------------------------------------
-- meetings: detailed records
-- ------------------------------------------------------------------
create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  kol_id uuid not null references public.kols(id) on delete cascade,
  activity_id uuid references public.activities(id) on delete set null,
  meeting_number integer not null,
  date timestamptz not null default now(),
  meeting_method text,                       -- in_person | video_call | phone
  topics_discussed text default '',
  topics_missed text default '',
  materials_shared jsonb default '[]',       -- [{ type, description }]
  follow_up_actions text default '',
  confirmed boolean default false,
  ai_summary text default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_meetings_kol_id on public.meetings(kol_id);

-- ------------------------------------------------------------------
-- quarterly_goals: strategy tab
-- ------------------------------------------------------------------
create table if not exists public.quarterly_goals (
  id uuid primary key default gen_random_uuid(),
  kol_id uuid not null references public.kols(id) on delete cascade,
  year integer not null,
  quarter integer not null check (quarter between 1 and 4),
  goal text not null,
  discussed boolean default false,
  carried_from_quarter integer,
  carried_from_year integer,
  sort_order integer default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_quarterly_goals_kol_id on public.quarterly_goals(kol_id);

drop trigger if exists goals_set_updated_at on public.quarterly_goals;
create trigger goals_set_updated_at before update on public.quarterly_goals
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------
-- reminders / tasks
-- ------------------------------------------------------------------
create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kol_id uuid references public.kols(id) on delete cascade,
  meeting_id uuid references public.meetings(id) on delete set null,
  title text not null,
  description text default '',
  due_date timestamptz not null,
  sent boolean default false,
  dismissed boolean default false,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_reminders_user_id on public.reminders(user_id);
create index if not exists idx_reminders_due_date on public.reminders(due_date);

-- ------------------------------------------------------------------
-- push_subscriptions
-- ------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists idx_push_sub_endpoint on public.push_subscriptions(endpoint);

-- ------------------------------------------------------------------
-- feedback
-- ------------------------------------------------------------------
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  username text default '',
  type text default 'bug' check (type in ('bug','idea','other')),
  priority text default 'medium' check (priority in ('low','medium','high','critical')),
  message text not null,
  page text default '',
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------
-- RLS — everything scoped to the owner (rep)
-- ------------------------------------------------------------------
alter table public.kols               enable row level security;
alter table public.activities         enable row level security;
alter table public.meetings           enable row level security;
alter table public.quarterly_goals    enable row level security;
alter table public.reminders          enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.feedback           enable row level security;

drop policy if exists "own kols" on public.kols;
create policy "own kols" on public.kols for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- child tables check ownership through the parent kol
drop policy if exists "own activities" on public.activities;
create policy "own activities" on public.activities for all
  using (kol_id in (select id from public.kols where user_id = auth.uid()))
  with check (kol_id in (select id from public.kols where user_id = auth.uid()));

drop policy if exists "own meetings" on public.meetings;
create policy "own meetings" on public.meetings for all
  using (kol_id in (select id from public.kols where user_id = auth.uid()))
  with check (kol_id in (select id from public.kols where user_id = auth.uid()));

drop policy if exists "own goals" on public.quarterly_goals;
create policy "own goals" on public.quarterly_goals for all
  using (kol_id in (select id from public.kols where user_id = auth.uid()))
  with check (kol_id in (select id from public.kols where user_id = auth.uid()));

drop policy if exists "own reminders" on public.reminders;
create policy "own reminders" on public.reminders for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own push subs" on public.push_subscriptions;
create policy "own push subs" on public.push_subscriptions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "insert feedback" on public.feedback;
create policy "insert feedback" on public.feedback for insert
  with check (auth.uid() = user_id);
drop policy if exists "read own feedback" on public.feedback;
create policy "read own feedback" on public.feedback for select
  using (auth.uid() = user_id);

-- ------------------------------------------------------------------
-- Storage: public kol-photos bucket
-- ------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('kol-photos', 'kol-photos', true)
on conflict (id) do nothing;

drop policy if exists "view kol photos" on storage.objects;
create policy "view kol photos" on storage.objects for select
  using (bucket_id = 'kol-photos');
drop policy if exists "upload kol photos" on storage.objects;
create policy "upload kol photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'kol-photos');
drop policy if exists "update kol photos" on storage.objects;
create policy "update kol photos" on storage.objects for update to authenticated
  using (bucket_id = 'kol-photos');
drop policy if exists "delete kol photos" on storage.objects;
create policy "delete kol photos" on storage.objects for delete to authenticated
  using (bucket_id = 'kol-photos');
