-- Conversations with the chat, kept when the writer says to keep them.
--
-- Until now closing the panel threw the conversation away: turns lived in
-- React state and the X cleared them. Everything asked and answered about a
-- meeting, a piece or a KOL was gone the moment you looked away from it.
--
-- Four constraints, settled with the user and all load-bearing:
--
-- 1. PRIVATE to whoever asked. These are the asker's notes, not part of the
--    record they are about, so the row is keyed to the user who asked and a
--    shared record does NOT share its chats.
-- 2. NOT auto-saved. Keeping one is a decision made on closing. Do not add a
--    save-on-every-answer; it was considered and rejected.
-- 3. One thread per subject, SEPARATED PER APP. Meeting Prep's questions must
--    not turn up among Writing Studio's, hence app in the key.
-- 4. The context is scoped the same way, which is why `app` is stored rather
--    than inferred: a chat is only ever reopened where it was had.

create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Which app it was had in, so a subject that several apps can talk about
  -- keeps one thread each rather than one shared muddle.
  app text not null,
  -- What it was about. Null subject_id is an app-level chat — asked on a list
  -- page, about nothing in particular.
  subject_kind text not null default '',
  subject_id text not null default '',
  -- The first thing they asked, trimmed. Written on save, so the list reads
  -- as what it was about without a model call to name it.
  title text not null default '',
  -- The conversation, as the panel's own turns.
  turns jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The history list: this user's chats for what they are looking at, newest
-- first, with the app-level ones reachable under the same key.
create index if not exists idx_chats_user_subject
  on public.chats(user_id, app, subject_kind, subject_id, updated_at desc);

-- Everything of theirs in one app, for "the rest of my chats".
create index if not exists idx_chats_user_app on public.chats(user_id, app, updated_at desc);

drop trigger if exists chats_set_updated_at on public.chats;
create trigger chats_set_updated_at before update on public.chats
  for each row execute function public.set_updated_at();

alter table public.chats enable row level security;

-- Constraint 1, enforced rather than promised: the row is reachable only by
-- the person who asked, whatever they were asking about and whoever else can
-- see that record.
drop policy if exists "own chats" on public.chats;
create policy "own chats" on public.chats for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
