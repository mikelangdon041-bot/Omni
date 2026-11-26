-- Outlook MCP connector, PC route: claude.ai → /api/mcp → this queue → a
-- helper on the user's PC (public/outlook/omni-bridge.ps1) → classic Outlook.
-- No Microsoft Graph and no Entra app, so no tenant consent: Outlook on the PC
-- is already signed in.
--
-- The PC polls through the two functions below with the anon key and its own
-- bridge token. They are SECURITY DEFINER and check the token's hash, so the
-- tables themselves stay closed (RLS on, no policies for the queue).

-- Omni tokens can now belong to an Omni user (PC route) instead of a
-- Microsoft account (Graph route). Exactly one of the two is set.
alter table public.mcp_tokens alter column account_id drop not null;
alter table public.mcp_tokens add column if not exists user_id uuid references auth.users (id) on delete cascade;
alter table public.mcp_tokens drop constraint if exists mcp_tokens_owner;
alter table public.mcp_tokens add constraint mcp_tokens_owner check ((account_id is null) <> (user_id is null));
create index if not exists mcp_tokens_user_idx on public.mcp_tokens (user_id);

alter table public.mcp_auth_codes alter column account_id drop not null;
alter table public.mcp_auth_codes add column if not exists user_id uuid references auth.users (id) on delete cascade;
alter table public.mcp_auth_codes drop constraint if exists mcp_auth_codes_owner;
alter table public.mcp_auth_codes add constraint mcp_auth_codes_owner check ((account_id is null) <> (user_id is null));

-- One PC per user answers for the connector. Separate from outlook_runners on
-- purpose: re-pairing the reminders runner from the pane must not unplug this.
create table if not exists public.outlook_bridges (
  user_id uuid primary key references auth.users (id) on delete cascade,
  token_hash text not null unique,
  last_seen timestamptz,
  last_note text not null default '',
  created_at timestamptz not null default now()
);
alter table public.outlook_bridges enable row level security;
drop policy if exists "own bridge" on public.outlook_bridges;
create policy "own bridge" on public.outlook_bridges
  for select using (auth.uid() = user_id);

-- Tool calls waiting for, or answered by, the PC. Rows live for seconds: the
-- server deletes each one as soon as it has read the answer, and anything
-- older than ten minutes is swept.
create table if not exists public.mcp_pc_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  tool text not null,
  args jsonb not null default '{}'::jsonb,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'done', 'error', 'expired')),
  result jsonb,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  finished_at timestamptz
);
create index if not exists mcp_pc_jobs_queue_idx on public.mcp_pc_jobs (user_id, status, created_at);
alter table public.mcp_pc_jobs enable row level security;

-- The PC asks for work. Records the check-in, expires anything that waited
-- too long (the server has already told Claude it failed, so running it late
-- would be wrong, above all for send_mail), and claims the oldest job.
create or replace function public.mcp_bridge_poll(p_token text, p_note text default 'ok')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
  j record;
begin
  select user_id into uid from outlook_bridges
   where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if uid is null then
    raise exception 'unknown bridge token' using errcode = '28000';
  end if;
  update outlook_bridges set last_seen = now(), last_note = left(coalesce(p_note, ''), 200)
   where user_id = uid;
  update mcp_pc_jobs set status = 'expired'
   where user_id = uid and status = 'queued' and created_at < now() - interval '40 seconds';
  update mcp_pc_jobs set status = 'running', claimed_at = now()
   where id = (
     select id from mcp_pc_jobs
      where user_id = uid and status = 'queued'
      order by created_at
      limit 1
      for update skip locked)
  returning id, tool, args into j;
  if j.id is null then
    return null;
  end if;
  return jsonb_build_object('id', j.id, 'tool', j.tool, 'args', j.args);
end;
$$;

-- The PC answers a job it claimed.
create or replace function public.mcp_bridge_finish(p_token text, p_job uuid, p_ok boolean, p_result jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
begin
  select user_id into uid from outlook_bridges
   where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if uid is null then
    raise exception 'unknown bridge token' using errcode = '28000';
  end if;
  update mcp_pc_jobs
     set status = case when p_ok then 'done' else 'error' end,
         result = p_result,
         finished_at = now()
   where id = p_job and user_id = uid and status = 'running';
  return found;
end;
$$;

revoke all on function public.mcp_bridge_poll(text, text) from public;
revoke all on function public.mcp_bridge_finish(text, uuid, boolean, jsonb) from public;
grant execute on function public.mcp_bridge_poll(text, text) to anon, authenticated;
grant execute on function public.mcp_bridge_finish(text, uuid, boolean, jsonb) to anon, authenticated;
