-- Omni — Insights admin analytics: let ORG ADMINS read every MSL's survey data
-- (and the KOLs those responses reference) so an admin can analyze the whole
-- organization, while regular MSLs still see only their own (existing policies
-- from 0010 remain). Uses is_org_admin() + current_org_id() from 0005.
-- Run in the Supabase SQL editor.

-- Responses: admins may read all responses in their org.
drop policy if exists "admin read org responses" on public.survey_responses;
create policy "admin read org responses" on public.survey_responses for select
  using (public.is_org_admin() and org_id = public.current_org_id());

-- Answers: admins may read answers belonging to their org's responses.
drop policy if exists "admin read org answers" on public.survey_answers;
create policy "admin read org answers" on public.survey_answers for select
  using (
    public.is_org_admin()
    and response_id in (
      select id from public.survey_responses where org_id = public.current_org_id()
    )
  );

-- KOLs: admins may read every KOL owned by a member of their org (needed so the
-- analytics can group/label by specialty, tier, institution, etc. across MSLs).
-- kols is scoped by user_id only, so map ownership to the org via profiles.
drop policy if exists "admin read org kols" on public.kols;
create policy "admin read org kols" on public.kols for select
  using (
    public.is_org_admin()
    and user_id in (
      select id from public.profiles where org_id = public.current_org_id()
    )
  );
