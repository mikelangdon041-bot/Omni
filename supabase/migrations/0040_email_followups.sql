-- Reminders and follow-ups from the Outlook pane.
--
-- The pane only runs while it is open on an email, so it cannot send anything
-- next week or notice that nobody answered. A small scheduled task on the
-- user's own PC does that through classic Outlook (public/outlook/omni-runner.ps1):
--
--   reminder  written in the pane now; the runner hands it to Outlook with
--             "Do not deliver before" set, and Exchange holds it until then.
--   follow-up the runner watches the conversation. If nobody but the user has
--             written in it since the anchor (the reminder, or the moment it
--             was set up) by followup_at, it writes the follow-up as a reply
--             to the latest message, and either sends it or leaves it in
--             Drafts with an Outlook reminder, as chosen when it was set up.
--
-- The runner authenticates with a token of its own (outlook_runners), never a
-- user session: /api/outlook/runner looks the token's hash up with the
-- service role.

create table if not exists public.email_followups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The email it was set up from: Office's internetMessageId when it had one
  -- (a draft does not), and the subject either way.
  message_id text not null default '',
  thread_subject text not null default '',
  -- Who it goes to: [{ "name": "...", "email": "..." }]
  to_people jsonb not null default '[]'::jsonb,
  subject text not null default '',

  reminder_at timestamptz,
  reminder_body text not null default '',
  -- none: no reminder. pending: waiting for the PC to hand it to Outlook.
  -- scheduled: Outlook has it. failed / cancelled.
  reminder_status text not null default 'none'
    check (reminder_status in ('none', 'pending', 'scheduled', 'failed', 'cancelled')),

  followup_at timestamptz,
  followup_body text not null default '',
  followup_mode text not null default 'draft' check (followup_mode in ('draft', 'send')),
  -- none / waiting / replied (someone answered, nothing sent) / drafted /
  -- sent / failed / cancelled
  followup_status text not null default 'none'
    check (followup_status in ('none', 'waiting', 'replied', 'drafted', 'sent', 'failed', 'cancelled')),

  -- What the PC last said about it, in words, for the pane.
  result text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists email_followups_user_open
  on public.email_followups (user_id)
  where reminder_status = 'pending' or followup_status = 'waiting';

drop trigger if exists email_followups_updated_at on public.email_followups;
create trigger email_followups_updated_at
  before update on public.email_followups
  for each row execute function public.set_updated_at();

alter table public.email_followups enable row level security;
drop policy if exists "own followups" on public.email_followups;
create policy "own followups" on public.email_followups
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- One PC per user does the sending. token_hash is the sha256 (hex) of the
-- token the runner holds; the token itself is never stored.
create table if not exists public.outlook_runners (
  user_id uuid primary key references auth.users (id) on delete cascade,
  token_hash text not null unique,
  last_seen timestamptz,
  -- "Outlook isn't open", "ok", ... from the last check-in.
  last_note text not null default '',
  created_at timestamptz not null default now()
);

alter table public.outlook_runners enable row level security;
drop policy if exists "own runner" on public.outlook_runners;
create policy "own runner" on public.outlook_runners
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
