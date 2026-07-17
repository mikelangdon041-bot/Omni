-- Omni — Meeting Prep module: structured intake → AI brief (with refine
-- loop), "grill me" rehearsal with coaching, and a post-meeting debrief that
-- can log straight into Territory Planning when a KOL is linked.
-- Run in the Supabase SQL editor.

-- ------------------------------------------------------------------
-- mp_meetings: one meeting being prepped
-- ------------------------------------------------------------------
create table if not exists public.mp_meetings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '',
  meeting_type text not null default 'kol_1on1'
    check (meeting_type in ('kol_1on1','advisory_board','internal','congress',
                            'presentation','difficult','first_meeting','other')),
  date timestamptz,
  duration_min integer not null default 30,
  format text not null default 'in_person'
    check (format in ('in_person','video_call','phone')),
  location text not null default '',
  kol_id uuid references public.kols(id) on delete set null,
  -- [{ name, role, org, notes }]
  attendees jsonb not null default '[]'::jsonb,
  objectives text not null default '',        -- rich HTML
  background text not null default '',        -- rich HTML
  concerns text not null default '',          -- rich HTML
  prior_transcript text not null default '',  -- transcript of a previous meeting
  -- Generated brief: { sections: [{ key, title, content }], generatedAt }
  brief jsonb not null default '{}'::jsonb,
  -- Grill-me rehearsal: [{ id, question, modelAnswer, userAnswer, coaching,
  --   revealed }]
  grill jsonb not null default '[]'::jsonb,
  -- Debrief: { transcript, summary, actions: [{ text, done }] }
  debrief jsonb not null default '{}'::jsonb,
  territory_logged boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_mp_meetings_user on public.mp_meetings(user_id, updated_at desc);

drop trigger if exists mp_meetings_set_updated_at on public.mp_meetings;
create trigger mp_meetings_set_updated_at before update on public.mp_meetings
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------
-- mp_settings: per-user brief customization (extra sections, permanently
-- saved to the profile so every future brief includes them)
-- ------------------------------------------------------------------
create table if not exists public.mp_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  -- [{ key, title, prompt }]
  custom_sections jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

drop trigger if exists mp_settings_set_updated_at on public.mp_settings;
create trigger mp_settings_set_updated_at before update on public.mp_settings
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------------
alter table public.mp_meetings enable row level security;
alter table public.mp_settings enable row level security;

drop policy if exists "own mp meetings" on public.mp_meetings;
create policy "own mp meetings" on public.mp_meetings for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own mp settings" on public.mp_settings;
create policy "own mp settings" on public.mp_settings for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
