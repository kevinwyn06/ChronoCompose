-- Owner 2026-08-20 (Chain A): the day a task arrived on today's list.
-- TEXT, not bigint: the client stores a `ymd` day KEY ("2026-08-20"), never epoch ms. The value is only
-- ever compared for identity, so a key is sufficient, and it cannot be shifted a day by DST the way an
-- epoch day-start can. NULLABLE with no default -- null means "not on the list", which is both the
-- correct state for a brand-new row and what every existing row should read as until the client's
-- one-time backfill (or its maintenance pass) writes a real day.
alter table public.tasks
  add column if not exists "onListSince" text;

comment on column public.tasks."onListSince" is
  'ymd day key of the day this task arrived on today''s list; null = not on the list — migration 0017';
