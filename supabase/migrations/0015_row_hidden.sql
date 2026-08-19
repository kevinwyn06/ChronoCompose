-- ChronoCompose backend — synced single-row sheet hiding (Block 49, 2026-08-18).
--
-- ORDERING NOTE: apply this migration BEFORE deploying a client carrying `rowHidden` in
-- SYNC_FIELDS, or every task write will reference a column that does not exist. Adding the field
-- changes syncRowFp, so expect one full task re-push on the first upgraded sync. The false default
-- makes every existing row visible and lets old clients safely omit the column from later writes.

alter table public.tasks
  add column if not exists "rowHidden" boolean not null default false;

comment on column public.tasks."rowHidden" is
  'true hides the task row behind a reversible compact sheet marker; independent of archive and scheduling — migration 0015';

-- VERIFICATION — expect: rowHidden | NO | boolean | false
-- select column_name, is_nullable, data_type, column_default
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'tasks'
--     and column_name = 'rowHidden';
