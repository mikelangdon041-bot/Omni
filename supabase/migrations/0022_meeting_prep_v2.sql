-- Meeting Prep v2: supporting documents (with per-doc relevance notes) and
-- persisted brainstormed ideas.
-- Run in the Supabase SQL editor.

alter table public.mp_meetings
  add column if not exists documents jsonb not null default '[]'::jsonb,
  add column if not exists ideas jsonb not null default '[]'::jsonb;

-- documents: [{ id, name, note, text }]
-- ideas:     [{ id, title, detail, added }]
