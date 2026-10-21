-- Meeting Prep: the Reading tab.
--
--  reading   what to read before the meeting: a short overview of the
--            subject, a list of real sources (found by search, or added by
--            the writer) each with what it actually says, what is still
--            unsettled about the subject, and the writer's standing steer on
--            which sources they want ("peer-reviewed data, not consultancy
--            reports"). Its own column rather than inside `brief`, because a
--            brief regenerate rewrites `brief` and must never take the
--            reading list, or the writer's feedback on it, with it.

alter table public.mp_meetings
  add column if not exists reading jsonb not null default '{}'::jsonb;
