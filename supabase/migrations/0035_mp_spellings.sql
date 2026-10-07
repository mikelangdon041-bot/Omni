-- Meeting Prep: spellings the user has corrected, remembered across meetings.
--
-- Speech recognition gets the same words wrong every time: a product, a
-- system, a colleague's surname. Fixing one in a meeting used to fix it in
-- that meeting only, so the next recording came back with the same mistake.
-- Each entry is {"wrong": "...", "right": "..."}; new notes are written with
-- the right spelling and the wrong one is replaced in whatever comes back.
-- mp_settings already carries the owner-only RLS policy.

alter table public.mp_settings
  add column if not exists spellings jsonb not null default '[]'::jsonb;
