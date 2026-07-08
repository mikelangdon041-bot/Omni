-- Omni — Territory: clinical-trials interest on the KOL strategy tab.
-- A checkbox plus rich-text notes (which trial / indication they care about).
-- Run in the Supabase SQL editor.

alter table public.kols
  add column if not exists interested_in_trials boolean default false,
  add column if not exists trials_interest_notes text default '';
