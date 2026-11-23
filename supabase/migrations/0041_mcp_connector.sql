-- Outlook MCP connector for claude.ai (src/app/api/mcp, src/lib/mcp).
--
-- Omni is the OAuth 2.1 authorization server claude.ai signs in to, and it
-- signs in to Microsoft on the user's behalf. Everything here is read and
-- written with the service role only: RLS is on with no policies, so the anon
-- key sees nothing.
--
-- Secrets at rest:
--   * Microsoft tokens are AES-256-GCM sealed with MCP_TOKEN_KEY (env, never in
--     the database), so a database dump alone cannot read anyone's mail.
--   * Omni's own codes and tokens are stored as SHA-256 hashes, never raw.

-- Clients that registered themselves (RFC 7591 dynamic client registration).
create table if not exists public.mcp_clients (
  client_id text primary key,
  client_secret_hash text,
  client_name text,
  redirect_uris text[] not null,
  token_endpoint_auth_method text not null default 'none',
  created_at timestamptz not null default now()
);

-- One row per Microsoft account that has connected.
create table if not exists public.mcp_ms_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  object_id text not null,
  email text,
  name text,
  refresh_token_enc text not null,
  access_token_enc text,
  access_expires_at timestamptz,
  scope text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, object_id)
);

-- An /authorize request parked while the user is off signing in to Microsoft.
-- id is the state sent to Microsoft. Lives ten minutes.
create table if not exists public.mcp_auth_requests (
  id text primary key,
  client_id text not null references public.mcp_clients (client_id) on delete cascade,
  redirect_uri text not null,
  state text,
  code_challenge text not null,
  scope text,
  resource text,
  ms_code_verifier text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- Authorization codes handed back to the client. Single use, ten minutes.
create table if not exists public.mcp_auth_codes (
  code_hash text primary key,
  client_id text not null references public.mcp_clients (client_id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  account_id uuid not null references public.mcp_ms_accounts (id) on delete cascade,
  scope text,
  resource text,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

-- Access and refresh tokens Omni issued. Refresh tokens rotate; family_id ties
-- a chain together so reuse of an old one can revoke the whole chain.
create table if not exists public.mcp_tokens (
  token_hash text primary key,
  kind text not null check (kind in ('access', 'refresh')),
  client_id text not null references public.mcp_clients (client_id) on delete cascade,
  account_id uuid not null references public.mcp_ms_accounts (id) on delete cascade,
  family_id uuid not null,
  scope text,
  resource text,
  expires_at timestamptz not null,
  rotated_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists mcp_tokens_family_idx on public.mcp_tokens (family_id);
create index if not exists mcp_tokens_account_idx on public.mcp_tokens (account_id);
create index if not exists mcp_tokens_expires_idx on public.mcp_tokens (expires_at);

alter table public.mcp_clients enable row level security;
alter table public.mcp_ms_accounts enable row level security;
alter table public.mcp_auth_requests enable row level security;
alter table public.mcp_auth_codes enable row level security;
alter table public.mcp_tokens enable row level security;
