-- Omni — Slide Studio module: decks built from scratch/topic/document or
-- imported from .pptx, edited on a canvas, exported via pptxgenjs. Includes
-- version snapshots, practice runs with AI coaching, reusable templates
-- (consumable by the Conference Post-Con Deck), and a public bucket for
-- slide images (uploads + AI-generated).
-- Run in the Supabase SQL editor.

-- ------------------------------------------------------------------
-- sl_decks
-- ------------------------------------------------------------------
create table if not exists public.sl_decks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Untitled deck',
  -- { primary, secondary, text, bg, headFont, bodyFont, logoDataUrl } —
  -- same shape as the conference DeckTheme so templates plug into the
  -- Post-Con Deck without conversion.
  theme jsonb not null default '{}'::jsonb,
  -- [{ id, elements: [{ id, type: text|bullets|image|chart|shape,
  --    x, y, w, h (inches), ...type-specific fields }], notes, script }]
  slides jsonb not null default '[]'::jsonb,
  source text not null default 'scratch'
    check (source in ('scratch','topic','document','import','template')),
  is_template boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_sl_decks_user on public.sl_decks(user_id, updated_at desc);

drop trigger if exists sl_decks_set_updated_at on public.sl_decks;
create trigger sl_decks_set_updated_at before update on public.sl_decks
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------
-- sl_versions: snapshots for the refine/undo loop
-- ------------------------------------------------------------------
create table if not exists public.sl_versions (
  id uuid primary key default gen_random_uuid(),
  deck_id uuid not null references public.sl_decks(id) on delete cascade,
  slides jsonb not null default '[]'::jsonb,
  theme jsonb not null default '{}'::jsonb,
  label text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_sl_versions_deck on public.sl_versions(deck_id, created_at desc);

-- ------------------------------------------------------------------
-- sl_practice: rehearsal runs (transcript + per-slide timing + coaching)
-- ------------------------------------------------------------------
create table if not exists public.sl_practice (
  id uuid primary key default gen_random_uuid(),
  deck_id uuid not null references public.sl_decks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  transcript text not null default '',
  -- [{ slideIndex, startSec, endSec }]
  slide_timings jsonb not null default '[]'::jsonb,
  -- { durationSec, wpm, fillerCount, fillers: {word:count} }
  metrics jsonb not null default '{}'::jsonb,
  coaching text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_sl_practice_deck on public.sl_practice(deck_id, created_at desc);

-- ------------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------------
alter table public.sl_decks    enable row level security;
alter table public.sl_versions enable row level security;
alter table public.sl_practice enable row level security;

drop policy if exists "own decks" on public.sl_decks;
create policy "own decks" on public.sl_decks for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own deck versions" on public.sl_versions;
create policy "own deck versions" on public.sl_versions for all
  using (deck_id in (select id from public.sl_decks where user_id = auth.uid()))
  with check (deck_id in (select id from public.sl_decks where user_id = auth.uid()));

drop policy if exists "own practice runs" on public.sl_practice;
create policy "own practice runs" on public.sl_practice for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ------------------------------------------------------------------
-- Storage: public slide-images bucket (uploads + AI-generated art)
-- ------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('slide-images', 'slide-images', true)
on conflict (id) do nothing;

drop policy if exists "view slide images" on storage.objects;
create policy "view slide images" on storage.objects for select
  using (bucket_id = 'slide-images');
drop policy if exists "upload slide images" on storage.objects;
create policy "upload slide images" on storage.objects for insert to authenticated
  with check (bucket_id = 'slide-images');
drop policy if exists "delete slide images" on storage.objects;
create policy "delete slide images" on storage.objects for delete to authenticated
  using (bucket_id = 'slide-images');
