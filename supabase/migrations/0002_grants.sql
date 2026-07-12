-- ChronoCompose backend — B0 follow-up: table privileges for the authenticated role.
--
-- RLS (enabled in 0001) decides WHICH ROWS a role may see, but Postgres still requires base
-- table privileges for the role to touch the table at all. Tables created via a raw SQL migration
-- do not inherit Supabase's default grants, so `authenticated` was denied outright ("permission
-- denied for table tasks") — including its own rows. Grant the CRUD privileges here; RLS
-- (owner_id = auth.uid()) continues to filter to the caller's own rows on top of these grants.
--
-- `anon` is deliberately NOT granted — only signed-in users sync. service_role bypasses RLS and
-- already has full access.

grant select, insert, update, delete on public.tasks   to authenticated;
grant select, insert, update, delete on public.habits  to authenticated;
grant select, insert, update, delete on public.journal to authenticated;
