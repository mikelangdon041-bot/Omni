-- Omni — Conference Planning v2: shared-KOL linkage, meeting/session
-- recordings, reminder dedupe for the cron, and Post-Con deck templates.
-- Run in the Supabase SQL editor.

-- ------------------------------------------------------------------
-- conf_contacts → shared KOL directory (territory `kols` table)
-- ------------------------------------------------------------------
alter table public.conf_contacts
  add column if not exists kol_id uuid references public.kols(id) on delete set null;
create index if not exists idx_conf_contacts_kol on public.conf_contacts(kol_id);

-- ------------------------------------------------------------------
-- recordings (session lectures + KOL meeting audio → transcript → summary)
-- ------------------------------------------------------------------
create table if not exists public.conf_recordings (
  id            uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conferences(id) on delete cascade,
  event_id      uuid references public.conf_events(id) on delete cascade,
  contact_id    uuid references public.conf_contacts(id) on delete cascade,
  user_id       uuid references auth.users(id) on delete set null,
  title         text not null default '',
  status        text not null default 'recording'
                check (status in ('recording','transcribing','summarizing','complete','error')),
  transcript    text not null default '',
  summary       text not null default '',
  error         text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_conf_rec_event on public.conf_recordings(event_id);
create index if not exists idx_conf_rec_contact on public.conf_recordings(contact_id);

drop trigger if exists conf_recordings_set_updated_at on public.conf_recordings;
create trigger conf_recordings_set_updated_at
  before update on public.conf_recordings
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------
-- reminder dedupe (the cron may run every few minutes; never re-notify)
-- ------------------------------------------------------------------
create table if not exists public.conf_sent_reminders (
  id            uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conferences(id) on delete cascade,
  kind          text not null,      -- before15 | start | food7am
  item_id       uuid not null,      -- event id / assignment id
  user_id       uuid not null,
  sent_at       timestamptz not null default now(),
  unique (kind, item_id, user_id)
);

-- ------------------------------------------------------------------
-- Post-Con deck templates (org-wide; uploaded .pptx lives in storage)
-- ------------------------------------------------------------------
create table if not exists public.conf_deck_templates (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  name         text not null,
  storage_path text not null default '',
  theme        jsonb not null default '{}',   -- extracted colors/fonts/logo
  mapping      jsonb not null default '{}',   -- AI-proposed + user-corrected plan
  guidance     text not null default '',
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

-- ------------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------------
alter table public.conf_recordings enable row level security;
drop policy if exists "conf_recordings_org_all" on public.conf_recordings;
create policy "conf_recordings_org_all" on public.conf_recordings for all
  using (public.conf_org(conference_id) = public.current_org_id())
  with check (public.conf_org(conference_id) = public.current_org_id());

alter table public.conf_sent_reminders enable row level security;
drop policy if exists "conf_sent_reminders_org_read" on public.conf_sent_reminders;
create policy "conf_sent_reminders_org_read" on public.conf_sent_reminders for select
  using (public.conf_org(conference_id) = public.current_org_id());
-- writes happen via the service role (cron)

alter table public.conf_deck_templates enable row level security;
drop policy if exists "conf_deck_templates_org_all" on public.conf_deck_templates;
create policy "conf_deck_templates_org_all" on public.conf_deck_templates for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- ------------------------------------------------------------------
-- realtime
-- ------------------------------------------------------------------
do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.conf_recordings';
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;
end $$;
