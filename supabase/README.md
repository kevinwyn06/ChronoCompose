# supabase/ — ChronoCompose backend

Schema-as-migrations for the Supabase backend (schema, row-level security, realtime) and the Edge
Functions, tracked in-repo so every schema change goes through a PR like the rest of the app. Project
setup is in [`SETUP.md`](../SETUP.md).

## Layout

| Path | What |
|---|---|
| `migrations/0001_init.sql` | tasks / habits / journal tables mirroring `normalizeTask` + `pp-habits` / `pp-journal`; `owner_id` + RLS (`owner_id = auth.uid()`); `updated_at` LWW clock; realtime publication. |
| `migrations/0002_grants.sql` | CRUD table privileges for the `authenticated` role (RLS filters rows, but Postgres still needs base grants; raw-SQL migrations don't inherit Supabase's defaults). |
| `migrations/0003_gcal_tokens.sql` | `gcal_tokens` table for **durable Google Calendar sign-in**. RLS **on with no client policies** — the anon/JWT client gets zero access; only the `gcal-oauth` Edge Function (service_role) reads/writes the per-user refresh token. |
| `functions/gcal-oauth/index.ts` | Edge Function (JWT-authed) for the Calendar auth-code flow. `exchange`: swap the browser's one-time code for a refresh token (stored in `gcal_tokens`) + first access token. `token`: re-mint an access token from the stored refresh token (or 404 `{connected:false}`). Holds the OAuth **client secret** (`GCAL_CLIENT_SECRET`), which never ships to the browser (rule 7). |
| `migrations/0006_gcal_push.sql` | **B3b** push tables. `gcal_channels`: one `events.watch` channel per (owner, calendar) + its webhook token — secret, RLS-on-no-policies, service_role only (like `gcal_tokens`). `gcal_pings`: a content-free "something changed" doorbell the client reads over Realtime — normal `owner_id = auth.uid()` select policy. |
| `migrations/0007_drop_pins.sql` | Replaces obsolete schedule-pin columns with nullable `startClock` / `endClock` flags used only to disambiguate explicit midnight from an untimed date. |
| `functions/gcal-watch/index.ts` | **B3b** Edge Function (JWT-authed), one action: `sync` — make Google's watch channels match the calendars the client has selected (register / renew near-expiry / stop deselected). Idempotent. Gets its access token by calling `gcal-oauth`'s `token` action, so refresh-token handling lives in one place. |
| `functions/gcal-notify/index.ts` | **B3b** the public webhook Google POSTs on every calendar change. Deployed `--no-verify-jwt` (Google cannot present a Supabase JWT); authenticates instead by the per-channel token in `gcal_channels`. Bumps `gcal_pings`; reads/writes no calendar data. |
| `tests/rls_isolation.sql` | B0 milestone check — two accounts, cross-account read/write rejected. Manual (not `npm test`). |

`config.toml` is **not committed here** — it holds your `project_id` and is created by
`supabase link` in your own checkout. Don't commit it if it contains anything beyond the public ref;
treat the DB password and `service_role` key as secrets (never in the repo).

## ⚠ ALWAYS reconcile history before `db push`

**Run `supabase migration list` first, every time.** Several migrations here (`0004`, `0005`) were
originally applied **by hand in the SQL editor**, so the remote `supabase_migrations.schema_migrations`
table had no record of them. `db push` then considers them pending and **replays them**.

That is not hypothetical — it happened on 2026-07-15 while pushing `0006`: `db push` silently re-ran
`0004` **and** `0005`. `0004` is only `GRANT`s (idempotent, harmless), but `0005` is

```sql
alter column spent type int using (spent * 60)
```

and Postgres **re-applies a non-trivial `USING` expression even when the column type is already `int`**
(verified: a temp-table probe turned `5` into `300`). So every `tasks.spent` was multiplied by 60 a
second time. It was silent — the values still fit in `int`, so nothing errored. It self-healed only by
luck: a table rewrite doesn't fire `touch_updated_at`, so the untouched `updated_at` let the clients'
correct local rows win row-level LWW and push back over the corruption. **Don't count on that.**

If `migration list` shows a migration applied remotely but missing from history, record it **without
re-running** it:

```sh
supabase migration list                     # compare Local vs Remote columns FIRST
supabase migration repair --status applied 0004   # mark as applied, do NOT execute
supabase db push                            # now only genuinely-new migrations run
```

Rule of thumb for authoring: a migration that rewrites data with `USING` is **not** idempotent. Prefer
applying migrations only via `db push` so history stays honest.

## Applying (owner terminal steps — B0)

Prereq: the Supabase project is set up as described in `SETUP.md`
(project created, CLI installed, `supabase login`, `supabase link --project-ref <ref>`).

```sh
supabase migration list                # ALWAYS first — see the warning above
supabase db push                       # apply migrations/000{1,2,3}_*.sql to the linked project
# then, in the Supabase SQL editor, run supabase/tests/rls_isolation.sql and confirm every
# RAISE NOTICE prints its "expect" value (no "RLS FAIL"). This satisfies the B0 milestone.
```

### Durable Google Calendar sign-in (owner setup)

```sh
supabase secrets set GCAL_CLIENT_SECRET=<OAuth client secret>   # never in config.js / the repo
supabase functions deploy gcal-oauth
```

The OAuth client (Google Cloud) must be a **Web application** type; add each serve origin
(`http://localhost:8000`, the Vercel origin) as an Authorized JavaScript origin. The function reads the
auto-injected `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`; the client sends the
public `clientId` in the request body.

### Google Calendar push — B3b (owner setup)

```sh
supabase db push                                    # applies migrations/0006_gcal_push.sql
supabase functions deploy gcal-watch                # JWT-authed (default)
supabase functions deploy gcal-notify --no-verify-jwt   # PUBLIC — Google can't send a Supabase JWT
```

`--no-verify-jwt` is **required and deliberate** on `gcal-notify` only. It is safe because the function
takes no request body, authenticates every hit against the per-channel secret token in `gcal_channels`
(which RLS hides from all clients), and does nothing but bump a content-free `gcal_pings` doorbell — a
forged hit can at most make your own client re-pull its own calendar, which it already does on a poll.

No Google Cloud / Search Console step is needed: the Calendar API requires only that the receiving URL be
HTTPS with a valid certificate (the domain-verification requirement is Drive-specific), and the Supabase
functions origin satisfies that. Channels are registered by API call using the stored refresh token, so
there is nothing to configure by hand.

## What is NOT synced (stays localStorage-only)

`pp-run` (timer heartbeats), `pp-pomo`, `pp-notify` (fire-once ledger), `pp-prefs` (device-local UI
state). Device-local / ephemeral by nature — syncing them is overhead for no user-visible benefit.

## Next

B1 (pure, offline sync-diff layer + `tests/sync.gen.test.js`) lands in `index.html`; B2 wires the
Supabase JS client and a Settings → Account magic-link panel. B3a gives habits/journal the same
per-change funnel as tasks; **B3b (this change)** adds Google Calendar push. B3c (email morning summary)
was **dropped by the owner (2026-07-15)** — the in-app popup stays the only summary channel.
