-- ChronoCompose — block 34 follow-up: take TRUNCATE (and the other structural privileges) away from
-- the two PostgREST roles.
--
-- FOUND while verifying 0010 against the catalog rather than trusting "Success. No rows returned":
--   usage_events | anon          | REFERENCES,TRIGGER,TRUNCATE
--   usage_events | authenticated | INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE
-- Neither migration granted those. They arrive from Supabase's DEFAULT PRIVILEGES on `public`, which
-- 0002_grants.sql did not know about — its comment says raw-SQL tables "do not inherit Supabase's
-- default grants", and for INSERT/SELECT/UPDATE/DELETE that held. It does not hold for these three.
--
-- Why it matters: **RLS does not filter TRUNCATE.** Row-level policies gate SELECT/INSERT/UPDATE/DELETE
-- row by row; TRUNCATE is a table-level DDL-ish operation that policies never see. So the append-only
-- guarantee 0010 states in its own header — "NO update policy and NO delete policy, an append-only log
-- the client cannot rewrite" — was true for DELETE and false for TRUNCATE. The same gap sits on `tasks`:
-- a role that could issue TRUNCATE could empty it wholesale, RLS notwithstanding.
--
-- Severity in practice: LOW. PostgREST never issues TRUNCATE, so there is no request an anon or
-- authenticated caller can make through the API that reaches it, and both roles are only reachable
-- through PostgREST. This is defence in depth and a correctness fix for a documented guarantee, not an
-- incident. It is reverted by re-granting, so it is also cheap to undo if some future tool needs it.
--
-- REFERENCES and TRIGGER go too, for the same reason they were never wanted: a client role has no
-- business adding a foreign key or a trigger to a table it merely reads and writes rows in.

revoke truncate, references, trigger on public.tasks        from anon, authenticated;
revoke truncate, references, trigger on public.habits       from anon, authenticated;
revoke truncate, references, trigger on public.journal      from anon, authenticated;
revoke truncate, references, trigger on public.usage_events from anon, authenticated;

-- AMENDED 2026-08-12, after applying the four lines above against production and re-checking the
-- catalog: 18 structural grants SURVIVED, on three tables no migration in this repo names —
--   gcal_channels | gcal_pings | gcal_tokens
-- They come from the same default-privilege source. This is the more serious half of the finding:
-- all three have RLS ENABLED, and gcal_channels and gcal_tokens have ZERO policies, so ordinary
-- SELECT/INSERT/UPDATE/DELETE is denied outright for both roles. TRUNCATE is the one operation that
-- walks past that, and `anon` held it — on the table storing Google Calendar tokens. Deny-all RLS
-- over a table an anonymous role can empty is not deny-all.
revoke truncate, references, trigger on public.gcal_tokens   from anon, authenticated;
revoke truncate, references, trigger on public.gcal_channels from anon, authenticated;
revoke truncate, references, trigger on public.gcal_pings    from anon, authenticated;

-- And stop the next raw-SQL table from inheriting them. `postgres` is the role these migrations run as,
-- so this is the default-privilege set that produced the grants above.
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger on tables from anon, authenticated;

-- Deliberately NOT touched: the CRUD grants from 0002 and 0010, every RLS policy, and service_role
-- (which bypasses RLS by design and is never exposed to the browser).
