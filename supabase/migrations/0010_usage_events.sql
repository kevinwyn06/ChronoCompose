-- ChronoCompose — block 33: alpha usage telemetry uploads.
--
-- Block 31 built the usage tracker local-only ("must NOT sync to Supabase"). The owner REVERSED that
-- on 2026-08-11 for one concrete reason: alpha testing happens on the DEPLOYED site, which has no
-- writable filesystem, so the `.telemetry/` disk sink in tools/static-server.mjs only ever fires on
-- localhost. Without a server-side sink the deployed sessions — the ones that matter — die with the tab.
--
-- This table is NOT part of the sync path. It never enters SYNC_FIELDS, KV_TABLES or BACKUP_KEYS, it
-- has no `updated_at` and no touch trigger, and it takes no part in last-write-wins reconciliation or
-- snapshot restore. It is a one-directional, append-only log.
--
-- The redaction gate in index.html (`trackFieldKind`) remains the security boundary: what lands in
-- `payload` is exactly what that gate emitted — key identities, action names, ids and counts. Typed
-- content never reaches the client buffer, so it can never reach this table.

create table if not exists public.usage_events (
  id         bigserial primary key,
  owner_id   uuid   not null default auth.uid() references auth.users (id) on delete cascade,
  session    text   not null,                    -- client session id (no account identity in it)
  ts         bigint not null,                    -- epoch ms, the CLIENT clock
  payload    jsonb  not null,                    -- the redacted event object, verbatim
  created_at timestamptz not null default now()  -- the SERVER clock; keep both, a skewed client clock
                                                 -- must not be the only record of when this happened
);

-- The read pattern is "one session for one owner", in insertion order (id).
create index if not exists usage_events_owner_session_idx on public.usage_events (owner_id, session);

-- ---------------------------------------------------------------------------
-- RLS: a user may append to, and read back, only their own rows.
-- NO update policy and NO delete policy — deliberately. An append-only log the client cannot rewrite
-- is worth more than a tidy one; PostgreSQL denies any command with no matching policy.
-- ---------------------------------------------------------------------------
alter table public.usage_events enable row level security;

create policy usage_events_insert on public.usage_events
  for insert
  to authenticated
  with check (owner_id = auth.uid());

create policy usage_events_select on public.usage_events
  for select
  to authenticated
  using (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Grants. RLS picks the rows; Postgres still needs the base-table privilege (see 0002_grants.sql —
-- tables made by raw SQL do not inherit Supabase's defaults). select + insert only, matching the
-- policies above. `anon` gets NOTHING, exactly as in 0002: an anonymous/local workspace does not
-- upload at all, and the client treats that as a normal state, not an error.
-- ---------------------------------------------------------------------------
grant select, insert on public.usage_events to authenticated;
grant usage, select on sequence public.usage_events_id_seq to authenticated;
