-- Omni — Writing Studio module: draft/edit anything (emails first-class),
-- with saved styles ("memory"-like rules + voices analyzed from samples),
-- version history for the refine loop, and per-user settings (signature,
-- diff highlighting, variant count). Run in the Supabase SQL editor.

-- ------------------------------------------------------------------
-- writer_docs: one piece of writing (email, doc, message, …)
-- ------------------------------------------------------------------
create table if not exists public.writer_docs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  doc_type text not null default 'email'
    check (doc_type in ('email','document','message','social','summary','other')),
  mode text not null default 'create' check (mode in ('create','edit')),
  title text not null default '',
  -- Guided intake: chips + free text, kept as one JSON blob so new chips
  -- never need a migration. { actions:[], tone:[], audience:[], length,
  --   background, keyPoints, ask, recipient, styleIds:[] }
  context jsonb not null default '{}'::jsonb,
  original text not null default '',          -- the user's own draft (edit mode)
  content text not null default '',           -- current working output (HTML)
  subject text not null default '',           -- email subject (email type)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_writer_docs_user on public.writer_docs(user_id, updated_at desc);

drop trigger if exists writer_docs_set_updated_at on public.writer_docs;
create trigger writer_docs_set_updated_at before update on public.writer_docs
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------
-- writer_versions: every generation (incl. variants) for the redo loop
-- ------------------------------------------------------------------
create table if not exists public.writer_versions (
  id uuid primary key default gen_random_uuid(),
  doc_id uuid not null references public.writer_docs(id) on delete cascade,
  content text not null default '',
  subject text not null default '',
  instructions text not null default '',      -- the guidance that produced it
  variant_label text not null default '',     -- 'A' | 'B' | … when variants on
  created_at timestamptz not null default now()
);
create index if not exists idx_writer_versions_doc on public.writer_versions(doc_id, created_at desc);

-- ------------------------------------------------------------------
-- writer_styles: saved styles — plain rules or a voice analyzed from samples
-- ------------------------------------------------------------------
create table if not exists public.writer_styles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  kind text not null default 'rules' check (kind in ('rules','voice')),
  rules text not null default '',             -- freeform rules the user wrote
  voice_profile text not null default '',     -- AI analysis of uploaded samples
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_writer_styles_user on public.writer_styles(user_id);

drop trigger if exists writer_styles_set_updated_at on public.writer_styles;
create trigger writer_styles_set_updated_at before update on public.writer_styles
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------
-- writer_settings: one row per user (signature, diff toggle, variant count)
-- ------------------------------------------------------------------
create table if not exists public.writer_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  signature text not null default '',         -- HTML, appended to emails
  show_diff boolean not null default true,
  variant_count integer not null default 1 check (variant_count between 1 and 4),
  updated_at timestamptz not null default now()
);

drop trigger if exists writer_settings_set_updated_at on public.writer_settings;
create trigger writer_settings_set_updated_at before update on public.writer_settings
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------
-- RLS — everything owner-scoped
-- ------------------------------------------------------------------
alter table public.writer_docs     enable row level security;
alter table public.writer_versions enable row level security;
alter table public.writer_styles   enable row level security;
alter table public.writer_settings enable row level security;

drop policy if exists "own writer docs" on public.writer_docs;
create policy "own writer docs" on public.writer_docs for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own writer versions" on public.writer_versions;
create policy "own writer versions" on public.writer_versions for all
  using (doc_id in (select id from public.writer_docs where user_id = auth.uid()))
  with check (doc_id in (select id from public.writer_docs where user_id = auth.uid()));

drop policy if exists "own writer styles" on public.writer_styles;
create policy "own writer styles" on public.writer_styles for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own writer settings" on public.writer_settings;
create policy "own writer settings" on public.writer_settings for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
