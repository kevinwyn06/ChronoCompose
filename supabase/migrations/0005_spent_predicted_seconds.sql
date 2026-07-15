-- ChronoCompose backend — spent/predicted stored as INTEGER SECONDS (2026-07-14).
--
-- 0001 declared tasks.spent and tasks.predicted as `int` (whole minutes), mirroring normalizeTask's
-- numeric defaults. But the CLIENT keeps both as FRACTIONAL minutes:
--   * spent accumulates each timer segment as (end-startedAt)/60000 (index.html stopTimerAt) —
--     deliberately fractional so many short sessions don't bleed time to per-stop rounding.
--   * predicted is set to the computed allotment (allotOf(id).computed) on a manual-predict toggle,
--     which is fractional.
-- The tasks upsert mirrors the task row 1:1, so the first fractional value to reach Postgres threw
--   invalid input syntax for type integer: "2009.2121333333334"
-- and stalled the whole sync queue (surfaced as the Settings "Last sync error" banner).
--
-- Fix: store both as INTEGER SECONDS instead of integer minutes. The client converts at its two
-- mapping choke points only (syncRowForWrite: round(min*60) on write; rowToTask: sec/60 on read),
-- so app internals stay minutes-float and second-level precision survives the round-trip. Existing
-- rows hold whole minutes, so multiply by 60 in place. spentByDay stays jsonb minutes (jsonb already
-- tolerates the fractional values; not a scalar int column, so it never hit the error).

alter table public.tasks
  alter column spent     type int using (spent * 60),      -- was whole minutes -> now seconds
  alter column predicted type int using (predicted * 60);

comment on column public.tasks.spent     is 'lifetime tracked time, INTEGER SECONDS (client keeps fractional minutes; converted at sync boundary — migration 0005)';
comment on column public.tasks.predicted is 'predicted/allotted time, INTEGER SECONDS (see spent — migration 0005)';
