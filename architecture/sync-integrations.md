# Sync and integrations

## Supabase

Supabase is optional and offline first. The client persists its managed session under `pp-auth`, restores
it on mount, switches to a UID-scoped workspace, reconciles cloud/local state, subscribes to Realtime, and
flushes queued changes. Tasks use row-level last-write-wins clocks; habits and journal use parallel JSONB
blob synchronization. Queue and tombstone stores survive reloads.

Migrations `0001`–`0007` cover schema/grants, Google token custody, second-level spent/predicted storage,
Google push notifications, and nullable scheduling clock flags. Migration `0007` removes the obsolete
schedule-pin columns. Reconcile migration history before any database push.

**Migration `0013` (2026-08-16) IS APPLIED** — run against the live project on 2026-08-16 and verified
against `information_schema`: `planned | YES | integer`, `uncompressable | YES | boolean`.
`supabase/migrations/0013_uncompressable.sql` adds
the `uncompressable` boolean — **nullable, no default**, because the client field is tri-state and `null`
carries the meaningful "never decided → derive from the clocks" state — and drops the `not null` on `planned`. Both are required by the 2026-08-16 allotment work; see
`scheduling.md`.

- **Ordering is load-bearing, and it restates 0012's lesson:** apply 0013 **before** any client carrying
  `uncompressable` in `SYNC_FIELDS` talks to the backend, or every task write references a column that does
  not exist.
- **`drop not null` on `planned` is not a formality.** `0001_init.sql` declares `planned int not null
  default 0` and no migration since had touched its nullability, so without this the first client to send
  `null` for an unestimated task gets a constraint violation on every row it owns. The statement is
  idempotent (`drop not null` on an already-nullable column is a no-op, not an error).
- Adding a field to `SYNC_FIELDS` changes `syncRowFp`, so expect **one full re-push of every task row** on
  first sync — the same one-time cost 0008 and 0012 each recorded, not a sign of anything wrong.
- Verify against `information_schema`, not the SQL editor's "Success. No rows returned" (0011's lesson).
  The query is in the migration's footer; expect `planned | YES` and `uncompressable | YES | boolean`.

## Google Calendar

`gcalImport`, `mergeCalendarEvents`, and `pruneDeletedEvents` implement pull/merge. Outbound operations
are derived through the commit diff funnel and queued. Pure merge/diff helpers are tested separately from
OAuth and network IO.

**Deletions are NOT gated on `gcalTwoWay` (2026-08-13).** Every other outbound op is. `gcalTwoWay`
defaults to **false**, and `gcalSyncOut` used to return on that flag before computing any op, so deleting
a linked task queued no remote DELETE *and* — because the tombstone is written inside `gcalEnqueue` —
recorded nothing locally either. The next silent `gcalImport` then found a live Google event with no
matching task and no tombstone and re-created it, which is the owner's report that deleted tasks *"came
back after a few minutes"*. `gcalSyncOut` now always computes the diff and, with two-way off, enqueues
only the ops `isGcalDeleteOp` accepts (`delete`, `deleteInstance`, `cancelInsert`); `gcalFlushQueue`
carries the matching rule and drops any non-deletion it finds while two-way is off. The asymmetry is
deliberate: an **edit** is a continuous opinion about content and pushing it without consent would
overwrite events ChronoCompose does not own, whereas a **delete** is one settled fact, the confirm dialog
already promises it, and the alternative is a row that resurrects itself.

**The app's own calendar is implicit (2026-08-13).** `GCAL_OWN_CAL_NAME` (`'ChronoCompose'`) is a
**reserved** calendar name: `gcalEnsureCalendar` adopts an existing calendar with that summary
(case/whitespace-insensitive, via `isOwnCalendar`) rather than creating a second one. `calTag` returns
`''` for it, so its events import **untagged** into the regular task pool — every task in that calendar is
a ChronoCompose task by definition, so an `@chronocompose` label restates the app's own name rather than
describing anything. Every other calendar keeps its tag, which carries real provenance. `calNameOf` falls
back to the reserved name when `ccCalId` matches but the calendar list has not loaded, because removing
the tag also removed what used to rescue that fallback. Retroactively cleaned by the
`implicit-own-calendar-tag` one-time migration.

The browser holds only a short-lived access token in memory. The refresh token is server-held in
`public.gcal_tokens` and reachable only through the `gcal-oauth` Edge Function. `events.watch`
notifications are content-free prompts to pull; they do not send calendar contents through the webhook.

For OAuth QA, follow the account/origin restrictions in `AGENTS.md` and never reload mid-session.
