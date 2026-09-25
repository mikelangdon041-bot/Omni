-- Meeting Prep: the question bank.
--
-- Questions used to exist only as four or five lines inside the brief, which
-- is the right number for a document read on the way in and the wrong number
-- for the thing you hold during the meeting. The bank is a long ranked list,
-- grouped into categories, that the writer picks from and arranges into the
-- order they will actually ask them in.
--
-- { items: [{ id, text, category, why, followUp, forWhom, rank, picked,
--             backup, asked, order, source }],
--   generatedAt }
alter table public.mp_meetings
  add column if not exists questions jsonb not null default '{}'::jsonb;
