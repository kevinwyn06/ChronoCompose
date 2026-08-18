-- ChronoCompose backend — explicit-inclusion provenance (owner session Block 36 review, 2026-08-18).
--
-- `included:true` historically meant two indistinguishable things: the old unconditional creation
-- default and a user's manual "Include today" press. Block 36 must clear the former once without
-- clearing the latter on every Supabase pull. `includedExplicit` is provenance, not a third inclusion
-- state: true means a current client recorded a manual press; false means automatic/default/unpressed.
--
-- ORDERING NOTE: apply this migration BEFORE deploying a client carrying `includedExplicit` in
-- SYNC_FIELDS, or every task write will reference a column that does not exist. The default is false so
-- pre-migration rows and rows inserted by an old client remain eligible for the one-time correction.
-- Old-client updates omit the column and therefore preserve the last provenance written by a current
-- client. Adding the field changes syncRowFp, so expect one full task re-push after upgrade.

alter table public.tasks
  add column if not exists "includedExplicit" boolean not null default false;

comment on column public.tasks."includedExplicit" is
  'true only for a current-client manual Include-today press; false for automatic/default/unpressed inclusion — migration 0014';

-- VERIFICATION — expect: includedExplicit | NO | boolean | false
-- select column_name, is_nullable, data_type, column_default
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'tasks'
--     and column_name = 'includedExplicit';
