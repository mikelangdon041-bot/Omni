-- Omni — Slide Studio user defaults: preferred theme (colors, fonts,
-- transition) and generation options, applied to every new deck.
-- Run in the Supabase SQL editor.

create table if not exists public.sl_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  -- { primary, secondary, text, bg, headFont, bodyFont, transition }
  theme jsonb not null default '{}'::jsonb,
  -- { aiImages: bool }
  options jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

drop trigger if exists sl_prefs_set_updated_at on public.sl_prefs;
create trigger sl_prefs_set_updated_at before update on public.sl_prefs
  for each row execute function public.set_updated_at();

alter table public.sl_prefs enable row level security;

drop policy if exists "own slide prefs" on public.sl_prefs;
create policy "own slide prefs" on public.sl_prefs for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
