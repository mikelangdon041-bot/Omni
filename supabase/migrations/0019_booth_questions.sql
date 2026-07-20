-- Omni — Organizer-configurable booth-log questions.
-- Run in the Supabase SQL editor.
--
--  * conf_booth_logs.custom_answers — answers to organizer-added booth-log
--    questions (conferences.settings.booth_questions), keyed by question
--    key, mirroring conf_session_notes.custom_answers / conf_contacts.custom_sections.

alter table public.conf_booth_logs
  add column if not exists custom_answers jsonb not null default '{}'::jsonb;
