-- ChronoCompose backend — the BATCHED task-field migration (2026-08-06, serial chain block 10).
--
-- A standing instruction: batch the deliberately local-only task fields into ONE
-- schema/sync migration rather than shipping a one-off per field. This is that batch. Three columns
-- land together so public.tasks never needs a fourth additive migration for fields already written.
--
-- Column names are QUOTED camelCase, matching the JS keys verbatim. The sync body built by
-- syncRowOf/computeSyncOps IS the task object with no field-mapping layer, so a column whose name
-- differs from its field posts to a nonexistent column and stalls the whole queue — the `pin` rename
-- trap. Field name == column name is the invariant, not a style preference.
--
-- All three are NULLABLE with no default. That is deliberate: `null` already carries meaning in the
-- client for each of them, and a nullable add is a metadata-only DDL in Postgres (no table rewrite,
-- no lock held over the data), so existing rows need no backfill and no re-push beyond the single
-- expected full push caused by the sync fingerprint gaining fields.

-- blocking: TRI-STATE busy-interval semantics for a task's fixed clock span (normalizeTask).
--   true  = blocking   — nothing else may be scheduled through the span
--   false = background — a container (a "Work 08:00–18:30" event) the user works inside
--   null  = inherit the client's BLOCKING_DEFAULT, which is blocking
-- Seeded on first Google Calendar import from the event's `transparency` ('transparent' => false).
-- Owner decision 2026-08-06. Enters SYNC_FIELDS with this migration.
alter table public.tasks add column if not exists blocking boolean;

-- snoozeUntil: date-only epoch ms; null = no active snooze. Previously local-only and named in the
-- batching instruction by name. Enters SYNC_FIELDS with this migration.
alter table public.tasks add column if not exists "snoozeUntil" bigint;

-- sectionId: id into the pp-sections store. The COLUMN is created here so the tasks table is done,
-- but the field deliberately stays OUT of SYNC_FIELDS: pp-sections itself has no Supabase table, so
-- mirroring the reference alone would restore a fresh device's tasks pointing at sections that exist
-- nowhere. Promoting it later is then a one-line client change with no further SQL.
alter table public.tasks add column if not exists "sectionId" text;

comment on column public.tasks.blocking      is 'tri-state busy semantics: true=blocking, false=background, null=inherit client default (blocking) — migration 0008';
comment on column public.tasks."snoozeUntil" is 'date-only epoch ms; null = not snoozed — migration 0008';
comment on column public.tasks."sectionId"   is 'pp-sections id; column exists but is NOT yet in the client SYNC_FIELDS (the sections store is unsynced) — migration 0008';
