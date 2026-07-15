-- ChronoCompose backend — durable Google Calendar sign-in fix (2026-07-14).
--
-- 0003 created public.gcal_tokens with RLS enabled and NO policies, on the assumption (see
-- 0002_grants.sql, lines 9-10) that "service_role bypasses RLS and already has full access". That
-- assumption is wrong for the same reason 0002 had to grant `authenticated`: a table created via a
-- raw SQL migration does NOT inherit Supabase's default grants, and service_role's BYPASSRLS only
-- skips ROW policies, not base-table GRANTs. So the gcal-oauth Edge Function (which reaches the table
-- with the service_role key) was denied outright — every exchange/token call failed with
-- "permission denied for table gcal_tokens", breaking durable Calendar sign-in end to end.
--
-- Grant the base privileges here. RLS stays enabled with no policies, so anon/authenticated clients
-- still get zero access (the browser must never see the refresh token — rule 5/7); only service_role,
-- now that it holds the grant, can read/write it.

grant select, insert, update, delete on public.gcal_tokens to service_role;
