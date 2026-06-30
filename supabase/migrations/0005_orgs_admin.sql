-- Omni — multi-tenant organizations + admin roles + impersonation audit +
-- per-app settings. Each user belongs to one organization (company); data stays
-- per-user with explicit sharing within the org. Run in the Supabase SQL editor.

-- ------------------------------------------------------------------
-- organizations
-- ------------------------------------------------------------------
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------
-- profiles: org membership + role + active flag
-- ------------------------------------------------------------------
alter table public.profiles
  add column if not exists org_id uuid references public.organizations(id) on delete set null;
alter table public.profiles
  add column if not exists role text not null default 'member'
    check (role in ('member', 'admin', 'owner'));
alter table public.profiles
  add column if not exists is_active boolean not null default true;

-- ------------------------------------------------------------------
-- impersonation_audit
-- ------------------------------------------------------------------
create table if not exists public.impersonation_audit (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references auth.users(id) on delete set null,
  target_id uuid references auth.users(id) on delete set null,
  org_id uuid,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

-- ------------------------------------------------------------------
-- per-app settings (one row per user+app)
-- ------------------------------------------------------------------
create table if not exists public.user_app_settings (
  user_id uuid not null references auth.users(id) on delete cascade,
  app text not null,
  settings jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (user_id, app)
);

-- ------------------------------------------------------------------
-- SECURITY DEFINER helpers (bypass RLS internally; avoid recursion)
-- ------------------------------------------------------------------
create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from public.profiles where id = auth.uid();
$$;

create or replace function public.is_org_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'owner') and is_active
  );
$$;

-- ------------------------------------------------------------------
-- Backfill: put existing users into one organization, make them owner.
-- ------------------------------------------------------------------
do $$
declare
  oid uuid;
begin
  if exists (select 1 from public.profiles where org_id is null) then
    if not exists (select 1 from public.organizations) then
      insert into public.organizations (name) values ('My Company') returning id into oid;
    else
      select id into oid from public.organizations order by created_at limit 1;
    end if;
    update public.profiles set org_id = oid, role = 'owner' where org_id is null;
  end if;
end $$;

-- ------------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------------
alter table public.organizations     enable row level security;
alter table public.user_app_settings enable row level security;
alter table public.impersonation_audit enable row level security;

drop policy if exists "org_members_read" on public.organizations;
create policy "org_members_read" on public.organizations for select
  using (id = public.current_org_id());
drop policy if exists "org_admin_update" on public.organizations;
create policy "org_admin_update" on public.organizations for update
  using (id = public.current_org_id() and public.is_org_admin());

drop policy if exists "uas_owner_all" on public.user_app_settings;
create policy "uas_owner_all" on public.user_app_settings for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- audit: org admins may read their org's rows (writes happen via service role)
drop policy if exists "audit_admin_read" on public.impersonation_audit;
create policy "audit_admin_read" on public.impersonation_audit for select
  using (org_id = public.current_org_id() and public.is_org_admin());
