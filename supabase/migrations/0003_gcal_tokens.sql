-- ChronoCompose backend — durable Google Calendar sign-in (persistent-logins work, 2026-07-13).
--
-- The GIS *token* flow the client used before returns only a ~1h access token with no refresh
-- token, so a reload dropped the Calendar connection. We move to the OAuth *auth-code* flow: the
-- client obtains a one-time code (popup), the `gcal-oauth` Edge Function exchanges it for a refresh
-- token using the OAuth client SECRET (which must never ship in the public config.js — rule 7), and
-- stores the refresh token HERE, server-side, scoped to the user. The function then mints short-lived
-- access tokens on demand. The browser never sees or stores the refresh token.
--
-- Security: RLS is enabled with NO policies for the `authenticated` role, so the anon/JWT client can
-- never select/insert/update this table. Only the Edge Function — using the service_role key, which
-- bypasses RLS — reads and writes it. This is deliberately the opposite of the tasks/habits/journal
-- tables, which the client owns.

create table if not exists public.gcal_tokens (
  owner_id      uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  refresh_token text not null,
  updated_at    timestamptz not null default now()
);

alter table public.gcal_tokens enable row level security;
-- (intentionally no CREATE POLICY: authenticated clients get zero access; service_role bypasses RLS.)

-- keep updated_at honest on refresh-token rotation (reuses the shared trigger fn from 0001_init.sql).
create trigger gcal_tokens_touch before update on public.gcal_tokens
  for each row execute function public.touch_updated_at();
