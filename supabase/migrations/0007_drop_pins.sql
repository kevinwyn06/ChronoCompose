-- Schedule pins removed 2026-07-26: every scheduling shape (fixed / point / due-by / flex) is now
-- derived from start, end, planned and whether each date carries a user-typed time.
-- See plans/2026-07-26-remove-schedule-pins.md.
alter table public.tasks add column if not exists "startClock" boolean;  -- null = derive from timestamp
alter table public.tasks add column if not exists "endClock" boolean;    -- true/false = explicit

alter table public.tasks drop column if exists "pinStart";
alter table public.tasks drop column if exists "pinEnd";
