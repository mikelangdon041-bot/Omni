-- Omni — Writing Studio: tags on saved pieces, so a growing library can be
-- filtered by the user's own labels alongside the date grouping and type
-- filter in the UI. Run in the Supabase SQL editor.

alter table public.writer_docs
  add column if not exists tags text[] not null default '{}';

-- Tag filtering is a containment check ("has this tag"), which GIN serves.
create index if not exists idx_writer_docs_tags
  on public.writer_docs using gin (tags);
