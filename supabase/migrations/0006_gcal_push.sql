-- ChronoCompose backend — B3b: Google Calendar events.watch push (2026-07-15).
--
-- Closes the gap architecture.md called impossible client-side ("True push notifications need a
-- public server callback"): now that Edge Functions give us a public HTTPS origin, Google can push
-- calendar changes to us instead of the client polling every 60s.
--
-- Design (roadmap "Open questions" #1, notify-to-pull — gcal WRITE credentials stay client-side):
--   1. `gcal-watch` (JWT-authed) registers one events.watch channel per selected calendar, pointed at
--      the public `gcal-notify` URL, and records it in gcal_channels.
--   2. Google POSTs `gcal-notify` on every change. That endpoint is PUBLIC (verify_jwt off) because
--      Google cannot present a Supabase JWT — it authenticates each hit by the per-channel random
--      `token` (X-Goog-Channel-Token) instead, which is why the token lives server-side only.
--   3. `gcal-notify` bumps the caller's gcal_pings row. The open client sees that over Realtime and
--      re-runs the existing client-side gcalImport/mergeCalendarEvents. The server never reads or
--      writes calendar data itself.
--
-- Two tables, deliberately opposite access shapes:
--   gcal_channels — secret (holds the webhook token). RLS on, NO client policies, service_role only,
--                   exactly like gcal_tokens (0003/0004).
--   gcal_pings    — a content-free doorbell (no calendar data, just "something changed, go pull").
--                   The client MUST read it, so it gets a normal owner_id = auth.uid() select policy.

-- ---------------------------------------------------------------------------
-- gcal_channels — one row per (owner, calendar) watch channel. Server-only.
-- ---------------------------------------------------------------------------
create table if not exists public.gcal_channels (
  owner_id    uuid not null references auth.users (id) on delete cascade,
  calendar_id text not null,
  channel_id  uuid not null unique,          -- the id we hand Google; it echoes it as X-Goog-Channel-ID
  resource_id text not null,                 -- Google's opaque id, required to stop the channel
  token       text not null,                 -- shared secret; Google echoes it as X-Goog-Channel-Token
  expiration  timestamptz not null,          -- Google-assigned; ~1 week max, must be renewed before this
  updated_at  timestamptz not null default now(),
  primary key (owner_id, calendar_id)
);

-- gcal-notify looks channels up by the header Google sends, not by owner — keep that lookup indexed.
-- (the `unique` above already provides the index; named here for intent.)

alter table public.gcal_channels enable row level security;
-- (intentionally no CREATE POLICY: authenticated clients get zero access — the token is a secret.)

-- Base grants: a raw-SQL migration does NOT inherit Supabase's defaults, and service_role's BYPASSRLS
-- skips row policies but NOT base-table grants — the 0004 bug. Grant explicitly.
grant select, insert, update, delete on public.gcal_channels to service_role;

create trigger gcal_channels_touch before update on public.gcal_channels
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- gcal_pings — the doorbell. One row per owner, bumped on every Google push.
-- ---------------------------------------------------------------------------
create table if not exists public.gcal_pings (
  owner_id       uuid primary key references auth.users (id) on delete cascade,
  bumped_at      timestamptz not null default now(),
  resource_state text                                  -- Google's X-Goog-Resource-State, for debugging
);

alter table public.gcal_pings enable row level security;

-- The client reads its own doorbell (that's the whole point); it never writes one.
create policy gcal_pings_select_own on public.gcal_pings
  for select to authenticated using (owner_id = auth.uid());

grant select on public.gcal_pings to authenticated;
grant select, insert, update, delete on public.gcal_pings to service_role;

-- Realtime delivers the bump to the open tab (same publication as tasks/habits/journal, 0001).
alter publication supabase_realtime add table public.gcal_pings;
