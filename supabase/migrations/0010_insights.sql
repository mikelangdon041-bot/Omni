-- Omni — Insights module schema: a canonical, org-scoped, branching survey that
-- every MSL answers per KOL (so answers are comparable across profiles), the
-- per-MSL responses/answers, and saved analysis configs for the workbench.
--
-- Ownership model:
--   survey_templates / survey_questions / survey_options — ORG-scoped, readable
--     by any org member, writable only by org admins (is_org_admin()).
--   survey_responses / survey_answers / saved_analyses — per-MSL (owner-only),
--     matching the existing per-user kols RLS.
--
-- Reuses helpers from earlier migrations: public.set_updated_at() (0001),
-- public.current_org_id() and public.is_org_admin() (0005). Run in the Supabase
-- SQL editor.

-- ------------------------------------------------------------------
-- survey_templates: the canonical survey, one org owns many; the most-recent
-- published one drives the module.
-- ------------------------------------------------------------------
create table if not exists public.survey_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null default 'KOL Insights Survey',
  product text default '',
  description text default '',
  status text not null default 'draft' check (status in ('draft','published','archived')),
  version integer not null default 1,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_survey_templates_org on public.survey_templates(org_id);

drop trigger if exists survey_templates_set_updated_at on public.survey_templates;
create trigger survey_templates_set_updated_at before update on public.survey_templates
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------
-- survey_questions: the branching tree. A question with parent_option_id set is
-- only shown when that option is selected in its parent question.
-- ------------------------------------------------------------------
create table if not exists public.survey_questions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.survey_templates(id) on delete cascade,
  parent_question_id uuid references public.survey_questions(id) on delete cascade,
  parent_option_id uuid,  -- FK added after survey_options exists (see below)
  section text default '',
  text text not null default '',
  help_text text default '',
  type text not null default 'single'
    check (type in ('single','multi','boolean','scale','number','text')),
  scale_min integer default 1,
  scale_max integer default 10,
  required boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_survey_questions_template on public.survey_questions(template_id);
create index if not exists idx_survey_questions_parent on public.survey_questions(parent_question_id);

-- ------------------------------------------------------------------
-- survey_options: choices for single/multi/boolean questions.
-- ------------------------------------------------------------------
create table if not exists public.survey_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.survey_questions(id) on delete cascade,
  label text not null default '',
  value text default '',
  color text default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_survey_options_question on public.survey_options(question_id);

-- Now that survey_options exists, wire the branching FK on survey_questions.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'survey_questions_parent_option_fk'
  ) then
    alter table public.survey_questions
      add constraint survey_questions_parent_option_fk
      foreign key (parent_option_id) references public.survey_options(id) on delete cascade;
  end if;
end $$;

-- ------------------------------------------------------------------
-- survey_responses: one survey instance per KOL per MSL.
-- ------------------------------------------------------------------
create table if not exists public.survey_responses (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.survey_templates(id) on delete cascade,
  kol_id uuid not null references public.kols(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid references public.organizations(id) on delete set null,
  status text not null default 'not_started'
    check (status in ('not_started','in_progress','complete')),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kol_id, user_id, template_id)
);
create index if not exists idx_survey_responses_user on public.survey_responses(user_id);
create index if not exists idx_survey_responses_kol on public.survey_responses(kol_id);

drop trigger if exists survey_responses_set_updated_at on public.survey_responses;
create trigger survey_responses_set_updated_at before update on public.survey_responses
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------
-- survey_answers: one row per answered question in a response.
-- value jsonb shape: { optionIds:[uuid], scale:int, number:num, text:string }
-- ------------------------------------------------------------------
create table if not exists public.survey_answers (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null references public.survey_responses(id) on delete cascade,
  question_id uuid not null references public.survey_questions(id) on delete cascade,
  value jsonb not null default '{}',
  answered_at timestamptz not null default now(),
  unique (response_id, question_id)
);
create index if not exists idx_survey_answers_response on public.survey_answers(response_id);
create index if not exists idx_survey_answers_question on public.survey_answers(question_id);

-- ------------------------------------------------------------------
-- saved_analyses: workbench chart configs (spec jsonb — see lib/insights/types).
-- ------------------------------------------------------------------
create table if not exists public.saved_analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid references public.organizations(id) on delete set null,
  template_id uuid references public.survey_templates(id) on delete set null,
  title text not null default 'Untitled analysis',
  spec jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_saved_analyses_user on public.saved_analyses(user_id);

drop trigger if exists saved_analyses_set_updated_at on public.saved_analyses;
create trigger saved_analyses_set_updated_at before update on public.saved_analyses
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------------
alter table public.survey_templates enable row level security;
alter table public.survey_questions enable row level security;
alter table public.survey_options   enable row level security;
alter table public.survey_responses enable row level security;
alter table public.survey_answers   enable row level security;
alter table public.saved_analyses   enable row level security;

-- Templates: org members read; org admins write.
drop policy if exists "templates_read" on public.survey_templates;
create policy "templates_read" on public.survey_templates for select
  using (org_id = public.current_org_id());
drop policy if exists "templates_write" on public.survey_templates;
create policy "templates_write" on public.survey_templates for all
  using (org_id = public.current_org_id() and public.is_org_admin())
  with check (org_id = public.current_org_id() and public.is_org_admin());

-- Questions: read if the template is in your org; write if you're an org admin.
drop policy if exists "questions_read" on public.survey_questions;
create policy "questions_read" on public.survey_questions for select
  using (template_id in (
    select id from public.survey_templates where org_id = public.current_org_id()
  ));
drop policy if exists "questions_write" on public.survey_questions;
create policy "questions_write" on public.survey_questions for all
  using (public.is_org_admin() and template_id in (
    select id from public.survey_templates where org_id = public.current_org_id()
  ))
  with check (public.is_org_admin() and template_id in (
    select id from public.survey_templates where org_id = public.current_org_id()
  ));

-- Options: read/write follow their question's template.
drop policy if exists "options_read" on public.survey_options;
create policy "options_read" on public.survey_options for select
  using (question_id in (
    select q.id from public.survey_questions q
    join public.survey_templates t on t.id = q.template_id
    where t.org_id = public.current_org_id()
  ));
drop policy if exists "options_write" on public.survey_options;
create policy "options_write" on public.survey_options for all
  using (public.is_org_admin() and question_id in (
    select q.id from public.survey_questions q
    join public.survey_templates t on t.id = q.template_id
    where t.org_id = public.current_org_id()
  ))
  with check (public.is_org_admin() and question_id in (
    select q.id from public.survey_questions q
    join public.survey_templates t on t.id = q.template_id
    where t.org_id = public.current_org_id()
  ));

-- Responses: owner-only.
drop policy if exists "own responses" on public.survey_responses;
create policy "own responses" on public.survey_responses for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Answers: owner via parent response.
drop policy if exists "own answers" on public.survey_answers;
create policy "own answers" on public.survey_answers for all
  using (response_id in (select id from public.survey_responses where user_id = auth.uid()))
  with check (response_id in (select id from public.survey_responses where user_id = auth.uid()));

-- Saved analyses: owner-only.
drop policy if exists "own analyses" on public.saved_analyses;
create policy "own analyses" on public.saved_analyses for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
