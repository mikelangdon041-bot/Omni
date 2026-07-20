-- Meeting Prep — a single free-text "Explain" field: the fast path where the
-- user just describes the meeting in their own words, and the AI extracts
-- attendees/objectives/concerns from it. Sits alongside (not replacing) the
-- structured Objective/Background/Concerns boxes.
-- Run in the Supabase SQL editor.

alter table public.mp_meetings
  add column if not exists explain text not null default '';
