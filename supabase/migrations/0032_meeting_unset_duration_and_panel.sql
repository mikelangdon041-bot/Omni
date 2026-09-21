-- Meeting Prep: a meeting's length and type are unknown until someone says.
--
-- duration_min defaulted to 30 and meeting_type to 'kol_1on1', and both went
-- to the brief model as facts. A panel the writer never gave a length for
-- came back as "This is a 30-minute live panel" with a minute-by-minute run of
-- show, and was briefed as a one-on-one with a KOL.
--
-- Now an unset duration is null and a new meeting's type is 'other' until the
-- writer picks one or the Explain pre-pass reads one out of what they wrote.
-- 'panel' joins the list for moderating or chairing a session.
--
-- Every existing meeting had duration 30 (24 of 24 when this ran), so none of
-- them had been set on purpose: they are cleared rather than left claiming a
-- length nobody gave.

alter table public.mp_meetings alter column duration_min drop not null;
alter table public.mp_meetings alter column duration_min set default null;
update public.mp_meetings set duration_min = null where duration_min = 30;

alter table public.mp_meetings alter column meeting_type set default 'other';
alter table public.mp_meetings drop constraint if exists mp_meetings_meeting_type_check;
alter table public.mp_meetings add constraint mp_meetings_meeting_type_check
  check (meeting_type in ('kol_1on1','advisory_board','internal','congress',
                          'presentation','panel','difficult','first_meeting','other'));

-- The panel that surfaced this was saved as a KOL 1-on-1 by the old default.
update public.mp_meetings set meeting_type = 'panel'
  where id = '319839e9-ec6b-4775-acb9-a8552ee0c54b';
