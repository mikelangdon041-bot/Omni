-- Omni — Dashboard: manager-defined teams (a subset of the org a manager
-- picks, for scoping KPIs without needing full org-admin) + stored Excel
-- imports (so an uploaded workbook becomes just another visualizable
-- dataset). Run in the Supabase SQL editor.

-- ------------------------------------------------------------------
-- dashboard_teams / dashboard_team_members
-- ------------------------------------------------------------------
create table if not exists public.dashboard_teams (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null default 'My Team',
  manager_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
-- One team per manager keeps this simple — a manager builds one roster.
create unique index if not exists idx_dashboard_teams_manager on public.dashboard_teams(manager_id);

create table if not exists public.dashboard_team_members (
  team_id uuid not null references public.dashboard_teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
create index if not exists idx_dashboard_team_members_team on public.dashboard_team_members(team_id);

alter table public.dashboard_teams enable row level security;
alter table public.dashboard_team_members enable row level security;

-- A manager fully owns their own team row.
drop policy if exists "own team" on public.dashboard_teams;
create policy "own team" on public.dashboard_teams for all
  using (auth.uid() = manager_id) with check (auth.uid() = manager_id and org_id = public.current_org_id());

-- Org admins can see every team in their org (oversight), not edit others'.
drop policy if exists "admin read org teams" on public.dashboard_teams;
create policy "admin read org teams" on public.dashboard_teams for select
  using (public.is_org_admin() and org_id = public.current_org_id());

-- A manager manages membership of their own team.
drop policy if exists "own team members" on public.dashboard_team_members;
create policy "own team members" on public.dashboard_team_members for all
  using (team_id in (select id from public.dashboard_teams where manager_id = auth.uid()))
  with check (team_id in (select id from public.dashboard_teams where manager_id = auth.uid()));

-- Org admins can read every team's membership in their org.
drop policy if exists "admin read org team members" on public.dashboard_team_members;
create policy "admin read org team members" on public.dashboard_team_members for select
  using (
    public.is_org_admin()
    and team_id in (select id from public.dashboard_teams where org_id = public.current_org_id())
  );

-- A member can see which team(s) they belong to (so the dashboard can show
-- "you're on Jane's team" context if needed later).
drop policy if exists "read own membership" on public.dashboard_team_members;
create policy "read own membership" on public.dashboard_team_members for select
  using (auth.uid() = user_id);

-- ------------------------------------------------------------------
-- dashboard_imports: an uploaded workbook, stored whole. Org-shared like
-- conference data — anyone in the org can visualize it, only the uploader
-- or an org admin can remove it.
-- ------------------------------------------------------------------
create table if not exists public.dashboard_imports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  title text not null,
  columns jsonb not null default '[]',  -- [{ key, label, type: "string"|"number" }]
  rows jsonb not null default '[]',     -- [{ <column key>: value, ... }]
  row_count int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_dashboard_imports_org on public.dashboard_imports(org_id);

alter table public.dashboard_imports enable row level security;

drop policy if exists "org read imports" on public.dashboard_imports;
create policy "org read imports" on public.dashboard_imports for select
  using (org_id = public.current_org_id());

drop policy if exists "create own imports" on public.dashboard_imports;
create policy "create own imports" on public.dashboard_imports for insert
  with check (org_id = public.current_org_id() and created_by = auth.uid());

drop policy if exists "delete own or admin imports" on public.dashboard_imports;
create policy "delete own or admin imports" on public.dashboard_imports for delete
  using (
    org_id = public.current_org_id()
    and (created_by = auth.uid() or public.is_org_admin())
  );
