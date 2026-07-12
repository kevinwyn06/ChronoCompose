# supabase/ — ChronoCompose backend (Phase 12+ backend migration)

Schema-as-migrations for the Supabase backend. See `plans/backend-migration-roadmap.md` for the full
plan; this directory is the **B0** deliverable (schema + RLS + realtime), tracked in-repo so every
schema change goes through a PR like the rest of the app.

## Layout

| Path | What |
|---|---|
| `migrations/0001_init.sql` | tasks / habits / journal tables mirroring `normalizeTask` + `pp-habits` / `pp-journal`; `owner_id` + RLS (`owner_id = auth.uid()`); `updated_at` LWW clock; realtime publication. |
| `migrations/0002_grants.sql` | CRUD table privileges for the `authenticated` role (RLS filters rows, but Postgres still needs base grants; raw-SQL migrations don't inherit Supabase's defaults). |
| `tests/rls_isolation.sql` | B0 milestone check — two accounts, cross-account read/write rejected. Manual (not `npm test`). |

`config.toml` is **not committed here** — it holds your `project_id` and is created by
`supabase link` in your own checkout. Don't commit it if it contains anything beyond the public ref;
treat the DB password and `service_role` key as secrets (never in the repo or chat — CLAUDE.md rule 7).

## Applying (owner terminal steps — B0)

Prereq: the owner's manual walkthrough steps 1–7 in `backend-migration-roadmap.md` are done
(project created, CLI installed, `supabase login`, `supabase link --project-ref <ref>`).

```sh
supabase db push                       # apply migrations/0001_init.sql to the linked project
# then, in the Supabase SQL editor, run supabase/tests/rls_isolation.sql and confirm every
# RAISE NOTICE prints its "expect" value (no "RLS FAIL"). This satisfies the B0 milestone.
```

## What is NOT synced (stays localStorage-only)

`pp-run` (timer heartbeats), `pp-pomo`, `pp-notify` (fire-once ledger), `pp-prefs` (device-local UI
state). Device-local / ephemeral by nature — syncing them is overhead for no user-visible benefit.

## Next

B1 (pure, offline sync-diff layer + `tests/sync.gen.test.js`) lands in `index.html`; B2 wires the
Supabase JS client and a Settings → Account magic-link panel. No network code exists yet at B0/B1.
