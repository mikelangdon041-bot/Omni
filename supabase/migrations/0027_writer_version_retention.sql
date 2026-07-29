-- Omni — Writing Studio: how long saved versions are kept.
--
-- Every generate and refine writes a row to writer_versions so any earlier take
-- can be restored. That list only ever grows, and old takes of a piece you sent
-- weeks ago are noise, so versions now age out. 10 days by default; 0 keeps them
-- forever for anyone who wants the full history. Run in the Supabase SQL editor.

alter table public.writer_settings
  add column if not exists version_retention_days integer not null default 10;

-- Pruning runs per document as it is opened, filtered on doc_id + created_at.
create index if not exists idx_writer_versions_doc_created
  on public.writer_versions (doc_id, created_at desc);
