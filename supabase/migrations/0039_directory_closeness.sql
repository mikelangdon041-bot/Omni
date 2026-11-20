-- Which Rachel. "Send it to Rachel" should mean the Rachel you actually write
-- to, without a surname, and when that does not settle it, the one nearest you
-- in the org: your own reports, then your manager's team, then your
-- department, then your company.
--
-- sent_count / last_sent: how often you sent mail to them in the last year,
--   counted from Sent Items by scripts/export-outlook-directory.ps1, and
--   bumped by the Outlook pane each time you invite them.
-- relation: where they sit relative to you, from the same export:
--   'report' (direct), 'team' (further down your line), 'manager', 'peer'
--   (same manager), or '' for everyone else.
-- company: the legal entity, so the US company outranks the Italian one.

alter table public.directory_people
  add column if not exists sent_count integer not null default 0,
  add column if not exists last_sent date,
  add column if not exists relation text not null default '',
  add column if not exists company text not null default '',
  add column if not exists is_me boolean not null default false;

-- "+1 for each person I just invited", for the pane. Invoker rights, so RLS
-- still limits it to the caller's own rows.
create or replace function public.directory_bump(emails text[])
returns void
language sql
security invoker
set search_path = public
as $$
  update public.directory_people
     set sent_count = sent_count + 1,
         last_sent = current_date
   where user_id = auth.uid()
     and email = any (select lower(e) from unnest(emails) e);
$$;

grant execute on function public.directory_bump(text[]) to authenticated;
