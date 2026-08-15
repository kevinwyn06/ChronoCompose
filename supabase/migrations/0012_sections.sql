-- ChronoCompose backend — the SECTIONS table (owner report, 2026-08-15).
--
-- WHY THIS EXISTS
-- The owner found the gap by using the app on two origins at once:
--   "My section grouping is different on vercel (main) and local host (dev). That seems to suggest
--    it's not synced - it should be."
-- Correct, and it never was. `pp-sections` had no table here, so section membership and ordering were
-- private to each browser profile. `tasks."sectionId"` has existed since 0008, but the client
-- deliberately held it OUT of SYNC_FIELDS for a good reason stated in that migration: mirroring a
-- REFERENCE whose REFERENT does not sync would restore a fresh device's tasks filed under sections that
-- exist nowhere. This migration removes that objection by giving the referent a home; the client change
-- that adds `sectionId` to SYNC_FIELDS ships with it.
--
-- SHAPE
-- Identical to `habits` / `journal` from 0001: an opaque `{id, data jsonb, updated_at}` blob keyed by the
-- client's own id. That is not laziness — it is what lets the client reuse the whole existing kv sync
-- layer (kvFp / kvStamp / computeKvOps / kvMergeDecision, all pure and already unit-tested) instead of
-- growing a third sync dialect for a four-field entity. `data` holds exactly what `normalizeSection`
-- produces: {id, name, order}. A richer relational shape later is an additive migration, not a rewrite.
--
-- ORDERING NOTE for a fresh backend: this table must exist BEFORE a client carrying `sectionId` in
-- SYNC_FIELDS talks to it, or tasks arrive referencing sections that cannot be pulled. On this
-- deployment that is satisfied by applying 0012 before deploying the 2026-08-15 client.

-- ---------------------------------------------------------------------------
-- sections — mirrors the pp-sections store (V2.6 container entity).
-- ---------------------------------------------------------------------------
create table if not exists public.sections (
  id         text primary key,          -- client-generated ('sec_xxxxxx'), the same key tasks."sectionId" holds
  owner_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,  -- {id, name, order} — normalizeSection's output verbatim
  updated_at timestamptz not null default now()   -- row-level LWW clock, same contract as habits/journal
);
create index if not exists sections_owner_idx on public.sections (owner_id);

-- ---------------------------------------------------------------------------
-- RLS — each user sees and writes only their own rows, same policy shape as 0001.
-- Note this is a SEPARATE statement from the grants below: RLS decides WHICH ROWS, grants decide whether
-- the role may touch the table at all. 0002 exists because that distinction was missed once already.
-- ---------------------------------------------------------------------------
alter table public.sections enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'sections' and policyname = 'sections'
  ) then
    create policy sections on public.sections
      for all
      to authenticated
      using (owner_id = auth.uid())
      with check (owner_id = auth.uid());
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Base-table privileges. Raw-SQL tables do not inherit Supabase's CRUD defaults (0002's finding), so
-- without this `authenticated` is denied the table outright, including its own rows.
-- `anon` is deliberately not granted — only signed-in users sync.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.sections to authenticated;

-- 0011 revoked truncate/references/trigger from the DEFAULT PRIVILEGES for role postgres, so a table
-- created after it should not inherit them. Stated explicitly anyway: this is the first new table since
-- that change, the assumption that it took effect is untested, and re-revoking is free and idempotent.
-- RLS does not filter TRUNCATE — that is the whole point of 0011 — so an inherited grant here would be a
-- silent hole in a table the app now depends on for its grouping.
revoke truncate, references, trigger on public.sections from anon, authenticated;

-- ---------------------------------------------------------------------------
-- keep updated_at honest even if a client forgets to send it on a write (0001's trigger, reused).
-- ---------------------------------------------------------------------------
drop trigger if exists sections_touch on public.sections;
create trigger sections_touch before update on public.sections
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Realtime: without this the client's `sections` changefeed subscription is silently INERT — it
-- subscribes successfully and simply never receives an event, which looks exactly like the bug this
-- migration is fixing.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sections'
  ) then
    alter publication supabase_realtime add table public.sections;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- VERIFICATION — run this after applying and read the output; do not trust "Success. No rows returned".
-- That is 0011's lesson: it was found by checking the catalog rather than the success message.
-- Expect: rls=true · one policy · authenticated holds exactly SELECT/INSERT/UPDATE/DELETE (no TRUNCATE,
-- REFERENCES or TRIGGER) · anon holds nothing · realtime=true.
-- ---------------------------------------------------------------------------
-- select relrowsecurity as rls from pg_class where oid = 'public.sections'::regclass;
-- select policyname, roles, cmd from pg_policies where schemaname='public' and tablename='sections';
-- select grantee, string_agg(privilege_type, ',' order by privilege_type) as privs
--   from information_schema.role_table_grants
--   where table_schema='public' and table_name='sections' and grantee in ('anon','authenticated')
--   group by grantee;
-- select exists (select 1 from pg_publication_tables
--   where pubname='supabase_realtime' and schemaname='public' and tablename='sections') as realtime;
