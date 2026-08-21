-- Owner 2026-08-20 (Chain A Task 19): the per-day snooze — the set of days a task is put away ON.
--
-- jsonb, not text[]: the client holds a plain JS array of `ymd` day KEYS ("2026-08-20"), and jsonb is
-- what every other array-valued field in this table already uses (`deps`, `labels`, `pin`), so the
-- mirror stays one shape. The value is only ever compared for identity, so a key is sufficient, and
-- unlike an epoch day-start it cannot be shifted a day by a DST boundary.
--
-- NOT NULL DEFAULT '[]' — unlike `uncompressable` (0013) there is no "never decided" state to preserve:
-- a task has days it is put away on, or it has none, and an existing row correctly reads as none.
alter table public.tasks
  add column if not exists "snoozeDays" jsonb not null default '[]'::jsonb;

comment on column public.tasks."snoozeDays" is
  'set of ymd day keys this task is snoozed ON ("not that day"), as against snoozeUntil''s "not until that date" — migration 0018';
