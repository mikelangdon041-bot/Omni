-- send_mail must never send the same draft twice. Right after Send(), classic
-- Outlook keeps listing the message in Drafts as unsent for a few seconds, so
-- a repeated send_mail with the same draft_id sent a second copy (2026-11-27).
-- The server claims each draft here before relaying the send; a second claim
-- fails on the primary key. Only a hash of the Outlook id is kept.
create table if not exists public.mcp_sent_drafts (
  user_id uuid not null references auth.users (id) on delete cascade,
  draft_hash text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, draft_hash)
);
alter table public.mcp_sent_drafts enable row level security;
