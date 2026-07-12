-- B0 milestone check — RLS provably isolates one user's rows from another.
-- Run manually in the Supabase SQL editor (or `supabase test db`) AFTER `supabase db push`.
-- This is NOT part of `npm test` — B0 has no client code yet (roadmap B0 "Tests").
--
-- How to read it: we impersonate two auth users via request.jwt.claims and assert that user B
-- can neither read nor write user A's rows. Expected result is printed by each RAISE NOTICE.

begin;

-- Two fake user ids (any uuids; they need not exist in auth.users for policy evaluation,
-- but the FK on owner_id does — so seed them as service_role first, outside RLS).
-- Simulate that seeding by disabling RLS for the insert, as the service_role key would.
set local role postgres;

-- pretend these are two magic-link accounts
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.test')
on conflict (id) do nothing;

insert into public.tasks (id, owner_id, name) values
  ('rls-a-1', '00000000-0000-0000-0000-00000000000a', 'A owns this')
on conflict (id) do nothing;

-- ---- Now act as user B (authenticated role + B's uid) ----
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}';

-- 1) B cannot SELECT A's row → expect 0
do $$
declare n int;
begin
  select count(*) into n from public.tasks where id = 'rls-a-1';
  raise notice 'B sees A''s row count = % (expect 0)', n;
  if n <> 0 then raise exception 'RLS FAIL: cross-account read leaked'; end if;
end $$;

-- 2) B cannot UPDATE A's row → expect 0 rows affected
do $$
declare n int;
begin
  update public.tasks set name = 'hijacked' where id = 'rls-a-1';
  get diagnostics n = row_count;
  raise notice 'B updated A''s rows = % (expect 0)', n;
  if n <> 0 then raise exception 'RLS FAIL: cross-account update succeeded'; end if;
end $$;

-- 3) B cannot INSERT a row owned by A → expect a policy violation (with check)
do $$
begin
  insert into public.tasks (id, owner_id, name)
    values ('rls-b-forge', '00000000-0000-0000-0000-00000000000a', 'forged as A');
  raise exception 'RLS FAIL: B inserted a row owned by A';
exception
  when insufficient_privilege or check_violation then
    raise notice 'B insert-as-A correctly rejected (expect this line)';
end $$;

-- 4) B CAN insert/read its own rows → expect 1
do $$
declare n int;
begin
  insert into public.tasks (id, owner_id, name)
    values ('rls-b-1', '00000000-0000-0000-0000-00000000000b', 'B owns this');
  select count(*) into n from public.tasks where id = 'rls-b-1';
  raise notice 'B sees its own row count = % (expect 1)', n;
  if n <> 1 then raise exception 'RLS FAIL: user cannot read own row'; end if;
end $$;

raise notice 'RLS isolation checks passed.';

rollback; -- leave no test rows behind
