-- Omni — Conference Planning. A shared, org-scoped workspace for running
-- multi-day conferences as a team: roster, schedule (with booth shifts),
-- key contacts, sessions, posters, insights, food coordination, venue map,
-- and announcements. Run in the Supabase SQL editor.

-- ------------------------------------------------------------------
-- conferences (the event itself)
-- ------------------------------------------------------------------
create table if not exists public.conferences (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  name          text not null,
  slug          text not null default '',
  location      text not null default '',
  venue_address text not null default '',
  start_date    date not null,
  end_date      date not null,
  timezone      text not null default 'America/New_York',
  floor_plan_url text not null default '',
  active        boolean not null default true,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_conferences_org on public.conferences(org_id, active);

-- Org of a conference — SECURITY DEFINER so child-table policies can check it
-- without recursive RLS lookups.
create or replace function public.conf_org(conf uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from public.conferences where id = conf;
$$;

-- ------------------------------------------------------------------
-- attendees (event-scoped roster; optionally linked to a login/profile)
-- ------------------------------------------------------------------
create table if not exists public.conference_attendees (
  id            uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conferences(id) on delete cascade,
  user_id       uuid references auth.users(id) on delete set null,
  name          text not null,
  email         text not null default '',
  phone         text not null default '',
  role          text not null default '',
  department    text not null default '',
  color         text not null default '#e11d48',
  is_lead       boolean not null default false,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_conf_attendees_conf on public.conference_attendees(conference_id, active);

-- ------------------------------------------------------------------
-- schedule events
-- ------------------------------------------------------------------
create table if not exists public.conf_events (
  id              uuid primary key default gen_random_uuid(),
  conference_id   uuid not null references public.conferences(id) on delete cascade,
  title           text not null,
  event_type      text not null default 'session'
                  check (event_type in ('booth','educational','competitor','contact_meeting','session','poster','custom')),
  custom_label    text not null default '',
  description     text not null default '',
  location        text not null default '',
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  cancelled       boolean not null default false,
  show_in_sessions boolean not null default false,   -- custom events surfaced on the Sessions tab
  is_private      boolean not null default false,    -- visible only to creator
  created_by      uuid references auth.users(id) on delete set null,
  suspected_priority text check (suspected_priority in ('high','medium','low')),
  confirmed_priority text check (confirmed_priority in ('high','medium','low','not_relevant')),
  priority_set_by uuid references auth.users(id) on delete set null,
  priority_set_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_conf_events_conf on public.conf_events(conference_id, starts_at);

create table if not exists public.conf_event_assignments (
  id            uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conferences(id) on delete cascade,
  event_id      uuid not null references public.conf_events(id) on delete cascade,
  attendee_id   uuid not null references public.conference_attendees(id) on delete cascade,
  created_at    timestamptz not null default now(),
  unique (event_id, attendee_id)
);
create index if not exists idx_conf_assign_event on public.conf_event_assignments(event_id);
create index if not exists idx_conf_assign_conf on public.conf_event_assignments(conference_id);

-- Booth coverage slots. attendee_id null = open slot.
create table if not exists public.conf_event_shifts (
  id            uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conferences(id) on delete cascade,
  event_id      uuid not null references public.conf_events(id) on delete cascade,
  attendee_id   uuid references public.conference_attendees(id) on delete cascade,
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists idx_conf_shifts_event on public.conf_event_shifts(event_id);

-- ------------------------------------------------------------------
-- per-person session notes (+ structured post-event fields)
-- ------------------------------------------------------------------
create table if not exists public.conf_session_notes (
  id              uuid primary key default gen_random_uuid(),
  conference_id   uuid not null references public.conferences(id) on delete cascade,
  event_id        uuid not null references public.conf_events(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  notes           text not null default '',
  images          text[] not null default '{}',
  attendance      text not null default '',
  questions_asked text not null default '',
  impact          text not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (event_id, user_id)
);
create index if not exists idx_conf_snotes_event on public.conf_session_notes(event_id);

-- ------------------------------------------------------------------
-- key contacts (external VIPs) + meeting notes
-- ------------------------------------------------------------------
create table if not exists public.conf_contacts (
  id                    uuid primary key default gen_random_uuid(),
  conference_id         uuid not null references public.conferences(id) on delete cascade,
  name                  text not null,
  tier                  text not null default 'medium' check (tier in ('high','medium','low')),
  institution           text not null default '',
  title                 text not null default '',
  email                 text not null default '',
  phone                 text not null default '',
  photo_url             text not null default '',
  interests             text[] not null default '{}',
  background            text not null default '',
  engagement_activities text not null default '',
  meeting_objectives    text not null default '',
  links                 jsonb not null default '[]',   -- [{label, url}]
  custom_fields         jsonb not null default '{}',   -- {key: value}
  ai_summary            text not null default '',
  archived              boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists idx_conf_contacts_conf on public.conf_contacts(conference_id, archived);

create table if not exists public.conf_contact_meetings (
  id            uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conferences(id) on delete cascade,
  contact_id    uuid not null references public.conf_contacts(id) on delete cascade,
  event_id      uuid references public.conf_events(id) on delete set null,
  meeting_date  date not null,
  meeting_time  text not null default '',
  location      text not null default '',
  notes         text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_conf_meetings_contact on public.conf_contact_meetings(contact_id);
create index if not exists idx_conf_meetings_event on public.conf_contact_meetings(event_id);

-- ------------------------------------------------------------------
-- posters (free-text dates by design; sessions may contain sub-posters)
-- ------------------------------------------------------------------
create table if not exists public.conf_posters (
  id            uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conferences(id) on delete cascade,
  parent_id     uuid references public.conf_posters(id) on delete cascade,
  is_session    boolean not null default false,
  sub_index     int,
  session_label text not null default '',
  date          text not null default '',   -- free text, e.g. "April 22, WEDNESDAY"
  time          text not null default '',   -- free text, e.g. "10:30 AM"
  title         text not null,
  authors       text not null default '',
  location      text not null default '',
  abstract      text not null default '',
  ai_summary    text not null default '',
  suspected_priority text check (suspected_priority in ('high','medium','low')),
  confirmed_priority text check (confirmed_priority in ('high','medium','low','not_relevant')),
  priority_set_by uuid references auth.users(id) on delete set null,
  priority_set_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_conf_posters_conf on public.conf_posters(conference_id);
create index if not exists idx_conf_posters_parent on public.conf_posters(parent_id);

create table if not exists public.conf_poster_reps (
  id            uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conferences(id) on delete cascade,
  poster_id     uuid not null references public.conf_posters(id) on delete cascade,
  attendee_id   uuid not null references public.conference_attendees(id) on delete cascade,
  unique (poster_id, attendee_id)
);
create index if not exists idx_conf_preps_poster on public.conf_poster_reps(poster_id);

create table if not exists public.conf_poster_notes (
  id            uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conferences(id) on delete cascade,
  poster_id     uuid not null references public.conf_posters(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  notes         text not null default '',
  images        text[] not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (poster_id, user_id)
);
create index if not exists idx_conf_pnotes_poster on public.conf_poster_notes(poster_id);

-- ------------------------------------------------------------------
-- insights: parent = a captured item; children = distilled bullets
-- ------------------------------------------------------------------
create table if not exists public.conf_insights (
  id            uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conferences(id) on delete cascade,
  user_id       uuid references auth.users(id) on delete set null,
  parent_id     uuid references public.conf_insights(id) on delete cascade,
  sort_order    int not null default 0,
  title         text not null default '',
  notes         text not null default '',   -- rich text body (manual entries)
  transcription text not null default '',
  summary       text not null default '',
  status        text not null default 'complete'
                check (status in ('uploading','transcribing','summarizing','complete','error')),
  source_type   text not null default '',   -- physician / nurse / pharmacist / competitor / ...
  event_id      uuid references public.conf_events(id) on delete set null,
  contact_id    uuid references public.conf_contacts(id) on delete set null,
  poster_id     uuid references public.conf_posters(id) on delete set null,
  categories    text[] not null default '{}',
  focus_areas   text[] not null default '{}',
  product_lines text[] not null default '{}',
  insight_date  date,
  suspected_priority text check (suspected_priority in ('high','medium','low')),
  confirmed_priority text check (confirmed_priority in ('high','medium','low','not_relevant')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_conf_insights_conf on public.conf_insights(conference_id);
create index if not exists idx_conf_insights_parent on public.conf_insights(parent_id);

-- configurable, color-coded insight category taxonomy (seeded per conference)
create table if not exists public.conf_categories (
  id            uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conferences(id) on delete cascade,
  name          text not null,
  color         text not null default '#6c6982',
  sort_order    int not null default 0,
  unique (conference_id, name)
);

create table if not exists public.conf_daily_summaries (
  id            uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conferences(id) on delete cascade,
  date          date not null,
  content       text not null default '',
  guidance      text not null default '',
  updated_at    timestamptz not null default now(),
  unique (conference_id, date)
);

create table if not exists public.conf_booth_logs (
  id             uuid primary key default gen_random_uuid(),
  conference_id  uuid not null references public.conferences(id) on delete cascade,
  date           date not null,
  attendee_count text not null default '',
  patterns       text not null default '',
  standout       text not null default '',
  custom         text not null default '',
  updated_at     timestamptz not null default now(),
  unique (conference_id, date)
);

-- ------------------------------------------------------------------
-- food coordination
-- ------------------------------------------------------------------
create table if not exists public.conf_food_orders (
  id              uuid primary key default gen_random_uuid(),
  conference_id   uuid not null references public.conferences(id) on delete cascade,
  order_date      date not null,
  meal            text not null default 'lunch'
                  check (meal in ('breakfast','lunch','dinner','snack','coffee')),
  restaurant      text not null default '',
  menu_url        text not null default '',
  group_order_url text not null default '',
  deadline        timestamptz,
  status          text not null default 'open'
                  check (status in ('open','closed','ordered','delivered')),
  orderer_attendee_id uuid references public.conference_attendees(id) on delete set null,
  notes           text not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_conf_food_conf on public.conf_food_orders(conference_id, order_date);

create table if not exists public.conf_food_items (
  id            uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conferences(id) on delete cascade,
  order_id      uuid not null references public.conf_food_orders(id) on delete cascade,
  attendee_id   uuid references public.conference_attendees(id) on delete set null,
  item          text not null,
  instructions  text not null default '',
  created_at    timestamptz not null default now()
);
create index if not exists idx_conf_fitems_order on public.conf_food_items(order_id);

-- broadcast (recipient null) or DM (visible to sender + recipient only)
create table if not exists public.conf_food_messages (
  id            uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conferences(id) on delete cascade,
  order_id      uuid not null references public.conf_food_orders(id) on delete cascade,
  sender_id     uuid references auth.users(id) on delete set null,
  recipient_id  uuid references auth.users(id) on delete set null,
  message       text not null,
  created_at    timestamptz not null default now()
);
create index if not exists idx_conf_fmsgs_order on public.conf_food_messages(order_id);

-- one row per day: coordinators for the day, or an explicit skip
create table if not exists public.conf_food_assignments (
  id            uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conferences(id) on delete cascade,
  date          date not null,
  attendee_ids  uuid[] not null default '{}',
  skipped       boolean not null default false,
  updated_at    timestamptz not null default now(),
  unique (conference_id, date)
);

-- ------------------------------------------------------------------
-- venue map pins
-- ------------------------------------------------------------------
create table if not exists public.conf_venue_pins (
  id            uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conferences(id) on delete cascade,
  label         text not null,
  pin_type      text not null default 'custom'
                check (pin_type in ('meeting_point','team_hub','custom')),
  description   text not null default '',
  x             double precision not null,   -- 0..1 relative to image width
  y             double precision not null,   -- 0..1 relative to image height
  color         text not null default '#e11d48',
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
create index if not exists idx_conf_pins_conf on public.conf_venue_pins(conference_id, active);

-- ------------------------------------------------------------------
-- announcements + priority audit
-- ------------------------------------------------------------------
create table if not exists public.conf_announcements (
  id            uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conferences(id) on delete cascade,
  sender_id     uuid references auth.users(id) on delete set null,
  message       text not null,
  created_at    timestamptz not null default now()
);
create index if not exists idx_conf_ann_conf on public.conf_announcements(conference_id, created_at);

create table if not exists public.conf_priority_history (
  id            uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conferences(id) on delete cascade,
  item_type     text not null,   -- event | poster | insight
  item_id       uuid not null,
  field         text not null,   -- suspected | confirmed
  value         text,
  set_by        uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists idx_conf_prio_item on public.conf_priority_history(item_type, item_id);

-- ------------------------------------------------------------------
-- updated_at triggers
-- ------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'conferences','conference_attendees','conf_events','conf_session_notes',
    'conf_contacts','conf_contact_meetings','conf_posters','conf_poster_notes',
    'conf_insights','conf_food_orders'
  ] loop
    execute format('drop trigger if exists %I_set_updated_at on public.%I', t, t);
    execute format(
      'create trigger %I_set_updated_at before update on public.%I
         for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;

-- ------------------------------------------------------------------
-- RLS — everything is shared org-wide (a conference is a team workspace)
-- ------------------------------------------------------------------
alter table public.conferences enable row level security;
drop policy if exists "conferences_org_all" on public.conferences;
create policy "conferences_org_all" on public.conferences for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

do $$
declare
  t text;
begin
  foreach t in array array[
    'conference_attendees','conf_events','conf_event_assignments','conf_event_shifts',
    'conf_session_notes','conf_contacts','conf_contact_meetings','conf_posters',
    'conf_poster_reps','conf_poster_notes','conf_insights','conf_categories',
    'conf_daily_summaries','conf_booth_logs','conf_food_orders','conf_food_items',
    'conf_food_messages','conf_food_assignments','conf_venue_pins',
    'conf_announcements','conf_priority_history'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%s_org_all" on public.%I', t, t);
    execute format(
      'create policy "%s_org_all" on public.%I for all
         using (public.conf_org(conference_id) = public.current_org_id())
         with check (public.conf_org(conference_id) = public.current_org_id())', t, t);
  end loop;
end $$;

-- ------------------------------------------------------------------
-- realtime: live multi-user sync for the shared surfaces
-- ------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'conferences','conference_attendees','conf_events','conf_event_assignments',
    'conf_event_shifts','conf_session_notes','conf_contacts','conf_contact_meetings',
    'conf_posters','conf_poster_reps','conf_poster_notes','conf_insights',
    'conf_food_orders','conf_food_items','conf_food_messages','conf_food_assignments',
    'conf_venue_pins','conf_announcements'
  ] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;
      when undefined_object then null;
    end;
  end loop;
end $$;

-- ------------------------------------------------------------------
-- storage: public bucket for floor plans, poster photos, slides, contact photos
-- ------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('conference', 'conference', true)
on conflict (id) do nothing;

drop policy if exists "conference_storage_read" on storage.objects;
create policy "conference_storage_read" on storage.objects
  for select using (bucket_id = 'conference');

drop policy if exists "conference_storage_insert" on storage.objects;
create policy "conference_storage_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'conference');

drop policy if exists "conference_storage_delete" on storage.objects;
create policy "conference_storage_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'conference');
