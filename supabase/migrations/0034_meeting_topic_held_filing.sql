-- Meeting Prep: four small facts a meeting needs so the app can stop nagging
-- and the AI can stop guessing.
--
--  topic            the subject of the session itself. A panel has a session
--                   title that is not the meeting's name, and that title is
--                   what the research and the questions have to serve.
--  held_at          "we had this one". Until now a meeting only left Upcoming
--                   by having a date in the past, so an undated meeting sat
--                   there forever.
--  no_date          "there is no date and that is fine" — the difference
--                   between not having answered yet and having answered none.
--  filing_reviewed  the person/topic folders were set deliberately, including
--                   to neither. Uncategorized is then a choice, not a gap, so
--                   picking "No topic" finally does something.

alter table public.mp_meetings
  add column if not exists topic text not null default '',
  add column if not exists held_at timestamptz,
  add column if not exists no_date boolean not null default false,
  add column if not exists filing_reviewed boolean not null default false;

comment on column public.mp_meetings.topic is
  'Subject of the session itself (panel title, agenda line) when it differs from the meeting title. Pinned at the top of every tab; drives research, brief and questions.';
comment on column public.mp_meetings.held_at is
  'Set when the writer marks the meeting as held, so it leaves Upcoming whether or not it ever had a date.';
comment on column public.mp_meetings.no_date is
  'The writer said this meeting has no date on purpose.';
comment on column public.mp_meetings.filing_reviewed is
  'The writer set the person/topic folders deliberately, including to neither.';

-- A meeting whose date has already passed has plainly been held; marking all
-- of those now means the Past list reads the same before and after this
-- migration, and "move back to upcoming" works on them too.
update public.mp_meetings
   set held_at = date
 where held_at is null
   and date is not null
   and date < now() - interval '1 hour';
