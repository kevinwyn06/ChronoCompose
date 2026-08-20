-- Owner 2026-08-19: a dateless, indefinite snooze. NOT NULL DEFAULT false -- unlike `uncompressable`
-- (0013) there is no "never decided" state to preserve: a task is either indefinitely snoozed or not.
alter table public.tasks
  add column if not exists "snoozeIndef" boolean not null default false;
