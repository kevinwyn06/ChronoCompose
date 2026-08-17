-- ChronoCompose backend — the UNCOMPRESSABLE column, and a nullable `planned` (owner report, 2026-08-16).
--
-- WHY THIS EXISTS
-- Owner: "0 minute tasks are getting 30 minutes while 1 hour tasks get just a few minutes."
-- The client fix has two persisted consequences:
--   1. `uncompressable` — a new NULLABLE boolean on the task meaning "allotted = its planned figure,
--      never compressed". Tri-state: null = "the user has never decided", and the client derives the
--      answer from the row's clocks on every read, so a task that gains clock times later becomes Exact
--      on its own (owner: "uncompressable should rederive"). true/false = a decision the user made in
--      the Time-needed control, and it freezes. It joins SYNC_FIELDS, so it needs a column here — and it
--      must be NULLABLE, or the never-decided state cannot survive a sync round trip and every task on a
--      second device would come back frozen to whatever the first device happened to derive.
--   2. `planned` becomes NULLABLE. `null` = "no time given" (the app falls through to the task's clock
--      span or DEFAULT_TASK_MINUTES); `0` = "deliberately zero, allot nothing". Before this release the
--      two were the same stored value, which is the whole reason the defect above existed.
--
-- ORDERING NOTE — this is load-bearing, and it is 0012's lesson restated. This migration must be applied
-- BEFORE a client carrying `uncompressable` in SYNC_FIELDS talks to the backend, or every task write
-- references a column that does not exist. Adding fields to SYNC_FIELDS also changes syncRowFp, so expect
-- ONE full re-push of every task row on first sync afterwards — the same one-time cost 0008 and 0012 each
-- recorded, and not a sign of anything wrong.
--
-- VERIFICATION is at the bottom. Run it and READ THE OUTPUT. Do not trust "Success. No rows returned" —
-- that is 0011's lesson.

-- ---------------------------------------------------------------------------
-- 1. uncompressable — mirrors task.uncompressable.
-- NULLABLE, with NO default. null is a meaningful third state ("never decided → derive from the clocks"),
-- not a missing value, so every pre-existing row arriving as null is exactly right: the client derives
-- Exact-vs-Flexible from that row's own clocks, every read, until the user picks one.
-- A `not null default false` column would be actively wrong here — it would land every existing
-- appointment as an explicit "Flexible" decision the user never made, and freeze it there.
-- ---------------------------------------------------------------------------
alter table public.tasks
  add column if not exists uncompressable boolean;

-- ---------------------------------------------------------------------------
-- 2. planned becomes nullable.
-- 0001_init.sql declared `planned int not null default 0`, and no migration since has touched its
-- nullability, so this is not a no-op today — but the statement is written idempotently regardless:
-- `drop not null` on an already-nullable column is a no-op, not an error. If `planned` were somehow
-- already nullable in a given deployment this statement would change nothing and the verification below
-- still proves the required state — which is the point of verifying state rather than asserting history.
-- ---------------------------------------------------------------------------
alter table public.tasks
  alter column planned drop not null;

-- ---------------------------------------------------------------------------
-- VERIFICATION — run this after applying and read the two rows it returns.
-- Expect EXACTLY two rows:
--   planned        | YES | (numeric type)
--   uncompressable | YES | boolean
-- BOTH must read YES. `uncompressable = NO` means an older copy of this file was applied (it declared the
-- column `not null default false`); fix it with `alter table public.tasks alter column uncompressable
-- drop not null, alter column uncompressable drop default;` and re-run the verification.
-- `planned.is_nullable = YES` is the one that matters: without it the first client to send null for an
-- unestimated task gets a constraint violation on every row it owns.
-- ---------------------------------------------------------------------------
-- select column_name, is_nullable, data_type
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'tasks'
--     and column_name in ('planned', 'uncompressable')
--   order by column_name;
