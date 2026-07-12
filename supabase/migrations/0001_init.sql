-- ChronoCompose backend — B0 initial schema (backend-migration-roadmap.md → sub-phase B0).
--
-- Mirrors normalizeTask() in index.html 1:1 (mechanical translation, not a redesign).
-- Column names are QUOTED camelCase so they match the JS task-object keys exactly — the sync
-- body built by computeSyncOps (B1) is the task row verbatim, with no field-mapping layer to
-- drift out of sync. deps / spentByDay / recur / labels / pin are jsonb (graphs/maps/arrays, not
-- relations worth normalizing yet). `updated_at` is the row-level last-write-wins clock (B1).
--
-- owner_id + RLS (owner_id = auth.uid()) are present from day one so multiuser (ROADMAP Phase 12+
-- item 5) is a later policy/sharing-UI change, not a schema rewrite.
--
-- Deliberately NOT migrated (stay localStorage-only, see roadmap B0): pp-run, pp-pomo, pp-notify,
-- pp-prefs. Device-local / ephemeral — syncing them is overhead for no user-visible benefit.

-- ---------------------------------------------------------------------------
-- tasks — mirrors the architecture.md task-object table + goal/allDay (both in normalizeTask &
-- BACKUP_KEYS; the roadmap's B0 field list was non-exhaustive, "mirror normalizeTask 1:1" governs).
-- ---------------------------------------------------------------------------
create table if not exists public.tasks (
  id             text primary key,
  owner_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,

  name           text not null default '',
  "start"        bigint,                 -- epoch ms, null = dateless
  "end"          bigint,                 -- epoch ms (the sheet's due Date), null = dateless
  priority       int  not null default 4,
  deps           jsonb not null default '[]'::jsonb,
  pct            int  not null default 0,
  planned        int  not null default 0,
  predicted      int  not null default 0,
  "predictManual" boolean not null default false,
  spent          int  not null default 0,        -- lifetime tracked minutes
  "spentByDay"   jsonb not null default '{}'::jsonb, -- {'YYYY-MM-DD': minutes}
  completion     bigint,                 -- epoch ms or null
  recur          jsonb,                  -- recurrence object or null
  labels         jsonb not null default '[]'::jsonb,
  description    text not null default '',
  goal           text not null default '',
  wbs            text,
  "type"         text not null default 'Proportional', -- Milestone | Proportional (scheduling marker)
  "allDay"       boolean not null default false,
  "calendarId"   text,
  "eventId"      text,
  "pinStart"     boolean,                -- null = infer (effPins)
  "pinEnd"       boolean,                -- null = infer
  included       boolean,                -- null = infer (today ∈ [start,due] date-only)
  "archivedAt"   bigint,                 -- null or epoch ms
  "parentId"     text references public.tasks (id) on delete cascade, -- subtask nesting; cascade matches commit()
  pin            jsonb,                  -- drag-pin {day,start,dur} or null (that-day-only)

  updated_at     timestamptz not null default now() -- row-level LWW clock (B1 applyRemoteSnapshot)
);
create index if not exists tasks_owner_idx  on public.tasks (owner_id);
create index if not exists tasks_parent_idx on public.tasks ("parentId");

-- ---------------------------------------------------------------------------
-- habits / journal — mirror pp-habits / pp-journal shapes. These persist as JSON blobs today
-- (per-user maps keyed by date/id); kept as jsonb `data` per row so the shape can evolve without
-- a migration, with `id` the natural key the client already uses. If a richer relational shape is
-- wanted later it's an additive migration, not a rewrite.
-- ---------------------------------------------------------------------------
create table if not exists public.habits (
  id         text primary key,
  owner_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists habits_owner_idx on public.habits (owner_id);

create table if not exists public.journal (
  id         text primary key,          -- entry id (client-generated, e.g. the day/uuid key)
  owner_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists journal_owner_idx on public.journal (owner_id);

-- ---------------------------------------------------------------------------
-- Row-Level Security: each user sees/writes only their own rows. owner_id = auth.uid().
-- ---------------------------------------------------------------------------
alter table public.tasks   enable row level security;
alter table public.habits  enable row level security;
alter table public.journal enable row level security;

do $$
declare tbl text;
begin
  foreach tbl in array array['tasks','habits','journal'] loop
    execute format($f$
      create policy %1$I on public.%1$I
        for all
        to authenticated
        using (owner_id = auth.uid())
        with check (owner_id = auth.uid());
    $f$, tbl);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- keep updated_at honest even if a client forgets to send it on a write.
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger
  language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger tasks_touch   before update on public.tasks   for each row execute function public.touch_updated_at();
create trigger habits_touch  before update on public.habits  for each row execute function public.touch_updated_at();
create trigger journal_touch before update on public.journal for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Realtime: enable the Postgres changefeed for the multi-device push path (sub-phase B3).
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.habits;
alter publication supabase_realtime add table public.journal;
