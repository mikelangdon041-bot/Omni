-- 0017: first-class "symposium" and "cme" event types on conference events.
-- The check constraint was created inline in 0013_conference.sql, so it carries
-- the default name conf_events_event_type_check.

alter table conf_events drop constraint if exists conf_events_event_type_check;

alter table conf_events add constraint conf_events_event_type_check
  check (event_type in (
    'booth',
    'educational',
    'symposium',
    'cme',
    'competitor',
    'contact_meeting',
    'session',
    'poster',
    'custom'
  ));
