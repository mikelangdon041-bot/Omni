-- Omni — Territory: add a "clinician type" attribute to KOLs (e.g. Physician,
-- Nurse, NP, PA, Pharmacist, Researcher) so the roster can be filtered by role.
-- Distinct from `specialty` (the medical field) and `title_position` (job title).
-- Run in the Supabase SQL editor.

alter table public.kols
  add column if not exists clinician_type text default '';
