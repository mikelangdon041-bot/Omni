-- Meeting Prep: a meeting is filed under a person AND a topic, not one or the
-- other. "My 1:1 with Priya" is both, and having to choose meant the topic
-- folders only ever collected the meetings that had nobody attached to them.
--
-- So mp_meetings gets two slots instead of one. The old `folder_id` — which
-- held either kind — becomes the person slot, and anything that was actually
-- filed under a topic is moved across into the new one, so no meeting changes
-- which folder it appears in.
--
-- Uncategorized is still the absence of both, and the person → topic nesting
-- the Folders view shows is read off these two columns; nothing hierarchical
-- is stored.
-- Run in the Supabase SQL editor.

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'mp_meetings'
       and column_name = 'folder_id'
  ) then
    alter table public.mp_meetings rename column folder_id to person_folder_id;
  end if;
end $$;

-- Both `add if not exists` so this file is safe to run twice, and so a
-- database that somehow never got 0030's column still ends up with both.
alter table public.mp_meetings
  add column if not exists person_folder_id uuid references public.mp_folders(id) on delete set null;
alter table public.mp_meetings
  add column if not exists topic_folder_id uuid references public.mp_folders(id) on delete set null;

-- Everything previously filed under a topic moves into the topic slot. Ordered
-- this way round because the rename above put topics in the person column;
-- after this, each column holds only folders of its own kind.
update public.mp_meetings m
   set topic_folder_id = m.person_folder_id,
       person_folder_id = null
  from public.mp_folders f
 where f.id = m.person_folder_id
   and f.kind = 'topic';

drop index if exists public.idx_mp_meetings_folder;
create index if not exists idx_mp_meetings_person_folder on public.mp_meetings(person_folder_id);
create index if not exists idx_mp_meetings_topic_folder on public.mp_meetings(topic_folder_id);
