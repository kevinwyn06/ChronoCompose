-- ChronoCompose backend — let a client-supplied updated_at win (2026-08-08, chain 4 block 16, F7).
--
-- The problem this fixes is a LAST-WRITE-WINS comparison across TWO DIFFERENT CLOCKS.
--
-- The client merges a pulled snapshot with applyRemoteSnapshot: newer `updated_at` wins. That value
-- is the EDIT time on the way in. But on the way OUT, syncRowForWrite used to delete the clock and
-- let the `tasks_touch` trigger stamp now() — the FLUSH time. Offline-first means those two can be
-- arbitrarily far apart: an edit made Monday and flushed Friday arrives stamped Friday and silently
-- overwrites an edit genuinely made Thursday on another device. No error, no conflict, no undo.
--
-- The fix has two halves. The client now sends its own `updated_at` (block 16). This half makes the
-- trigger DEFER to that value instead of clobbering it, while keeping the original guarantee that a
-- client which sends nothing still gets an honest clock.
--
-- Deferring is safe against a lying client for the only thing that matters here: the value is the
-- ordering key for that user's OWN rows, under RLS, and a client that mis-stamps only mis-orders its
-- own edits — exactly what it can already do by editing its own local store.
--
-- Idempotent: create-or-replace of the function body only. No DDL, no lock beyond the catalog update,
-- and the existing triggers (tasks / habits / journal / gcal tables) pick the new body up as-is.

create or replace function public.touch_updated_at() returns trigger
  language plpgsql as $$
begin
  -- INSERT: honour an explicit client value, else now().
  if tg_op = 'INSERT' then
    if new.updated_at is null then new.updated_at = now(); end if;
    return new;
  end if;
  -- UPDATE: honour the client only when it actually SENT a (different) clock. PostgREST sends the
  -- full row, so an unchanged updated_at means "client did not stamp this write" -> stamp it now().
  if new.updated_at is null or new.updated_at is not distinct from old.updated_at then
    new.updated_at = now();
  end if;
  return new;
end $$;
