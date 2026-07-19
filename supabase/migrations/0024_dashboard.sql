-- Omni — Dashboard module: saved chart tiles built from any module's data via
-- the AI "ask to visualize" flow. Cross-module org-wide reads (the manager
-- view) happen through the service-role client in application code, scoped
-- explicitly by org_id + role there — no new RLS needed on the source
-- modules' tables for that. This migration only adds storage for the tiles
-- themselves. Run in the Supabase SQL editor.

create table if not exists public.dashboard_tiles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  title text not null default '',
  dataset_id text not null,        -- catalog dataset id, e.g. "territory.kols"
  spec jsonb not null default '{}', -- { groupBy, measure, chartType, scope }
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_dashboard_tiles_org on public.dashboard_tiles(org_id);
create index if not exists idx_dashboard_tiles_creator on public.dashboard_tiles(created_by);

drop trigger if exists dashboard_tiles_set_updated_at on public.dashboard_tiles;
create trigger dashboard_tiles_set_updated_at before update on public.dashboard_tiles
  for each row execute function public.set_updated_at();

alter table public.dashboard_tiles enable row level security;

-- Creator has full control over their own tiles.
drop policy if exists "own dashboard tiles" on public.dashboard_tiles;
create policy "own dashboard tiles" on public.dashboard_tiles for all
  using (auth.uid() = created_by) with check (auth.uid() = created_by);

-- Org admins/owners ("managers") can additionally read every tile in their
-- org, so they see what their reports have built.
drop policy if exists "admin read org dashboard tiles" on public.dashboard_tiles;
create policy "admin read org dashboard tiles" on public.dashboard_tiles for select
  using (public.is_org_admin() and org_id = public.current_org_id());
