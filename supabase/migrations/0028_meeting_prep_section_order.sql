-- Meeting Prep — the user's own order for the brief's boxes.
--
-- An array of section keys, e.g. ["agenda","objective","attendees",...].
-- Keys not listed keep their natural position after the ones that are, so an
-- order saved today still works when the default blueprint gains a section.
-- Empty means "the default order".
-- Run in the Supabase SQL editor.

alter table public.mp_settings
  add column if not exists section_order jsonb not null default '[]'::jsonb;
