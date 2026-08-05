-- Omni — the Microsoft connection, so finished meeting notes can land in
-- OneNote without anyone copying them there.
--
-- One row per user, holding the OAuth tokens Graph needs. Deliberately NOT
-- readable by the browser: RLS is on and there are no policies at all, so the
-- anon and authenticated roles are denied outright and every read goes through
-- the server with the service role. A refresh token is a standing key to
-- someone's notebooks — it has no business being fetchable by page JavaScript,
-- and "the client only ever calls our API" is a convention, not a control.
--
-- Run in the Supabase SQL editor.

create table if not exists public.microsoft_accounts (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  -- Shown in Settings so you can tell which account is connected, and spot the
  -- personal one you linked by mistake instead of the work one.
  account_email text,
  account_name  text,
  access_token  text        not null,
  refresh_token text        not null,
  -- Access tokens last about an hour. Stored rather than assumed so a refresh
  -- happens when it is actually due, not on a guess.
  expires_at    timestamptz not null,
  scope         text,
  -- Where the last debrief was sent. The next one defaults here, because the
  -- honest answer to "which page?" is almost always "the same one as last time"
  -- and re-picking a notebook, a section and a page every meeting is the
  -- clicking this feature exists to remove.
  last_section_id text,
  last_section_name text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.microsoft_accounts enable row level security;
-- No policies on purpose. See the note above.

comment on table public.microsoft_accounts is
  'Microsoft Graph OAuth tokens per user, for the OneNote hand-off. Server-only: RLS is enabled with no policies, so only the service role can read it.';
