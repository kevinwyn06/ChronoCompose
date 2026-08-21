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

**Integer columns and the queue wedge (owner 2026-08-20).** `start`, `end`, `completion`, `archivedAt`
and `snoozeUntil` are `bigint`; `priority`, `pct`, `planned`, `predicted` and `spent` are `int`. A
**fractional** value in any of them is unsendable — Postgres answers `22P02 invalid input syntax for type
bigint` — and because `syncFlushQueue` sent the whole queue as ONE upsert and kept it on failure, a single
malformed row blocked every write from that origin permanently and silently. Measured on the owner's
account: Vercel 11 tasks, localhost 28, 24 ops stuck, one task with `end = 1785437897142.8572`.

Three layers now hold the invariant, and each is load-bearing on its own:

- `normalizeTask` rounds `INT_MS_FIELDS` so the value cannot exist in memory. **Null stays null** — a
  missing date is not epoch 0. `spent`/`predicted` are excluded: fractional minutes are correct in memory
  and become integer seconds at the wire.
- `syncRowForWrite` rounds `INT_COLUMNS` independently, because a row already in `localStorage` reaches
  the queue **without** passing back through `normalizeTask`. That path is how the wedge formed, so the
  wire layer may not assume normalized input.
- `syncFlushQueue` pre-flights with `syncPartitionWritable` and, on a row-level rejection
  (`syncIsRowLevelReject` — Postgres `22xxx`/`23xxx`), retries **per row** so the healthy majority drains.
  Transport/auth failures are deliberately *not* row-level: retrying an expired JWT one row at a time
  multiplies the failure by the queue length. Failures are surfaced by `syncReportUnwritable`.

**Adding a numeric mirrored field means adding it to `INT_COLUMNS` too**, or the next fractional value
repeats the wedge. `INT_COLUMNS` sits beside `SYNC_FIELDS` for exactly that reason.

**The reconcile rule is still "never delete on first sync", and that is a known open defect** — see
`tasks.md` S1. `applyRemoteSnapshot` keeps local-only rows and `syncInitialSync` re-`insert`s them, and the
kv/sections path strips deletes outright, so a device that was closed during a delete resurrects the row
for everyone. Tombstones are per-origin `localStorage` and cannot cross. Fixing it requires distinguishing
"never pushed" from "server deleted it" — enabling deletes outright would orphan tasks under a section
that a genuine first sync had simply not uploaded yet.

## Google Calendar

`gcalImport`, `mergeCalendarEvents`, and `pruneDeletedEvents` implement pull/merge. Outbound operations
are derived through the commit diff funnel and queued. Pure merge/diff helpers are tested separately from
OAuth and network IO.

**Calendar is two-way only (2026-08-17).** There is no `gcalTwoWay` setting or mode gate: every local
task diff reaches `gcalEnqueue`, while `_gcalApplying` still suppresses an import echo. Existing dated
local-only tasks are **not** swept into Google on upgrade; the `gcalBackfill` button remains the only
broad backfill action. Newly created dated tasks and edits to linked tasks queue normally.

Two queue guards make the transition safe. New operations carry `GCAL_QUEUE_VERSION = 2` plus a unique
`queueId`; non-delete operations persisted by the retired opt-in implementation are unversioned and are
dropped rather than unexpectedly flushed after upgrade. Legacy deletes still drain because their
tombstones may be actively blocking resurrection. The unique id also prevents completion of an older
in-flight PATCH from shifting a newer coalesced edit off the queue. A current pending PATCH is passed
into `mergeCalendarEvents`, which keeps local name, dates, all-day shape, and recurrence authoritative
until the write drains; `planned`, `goal`, `description`, and blocking retain their existing
local-authority rules.

Five ordering guards close races around that queue. Calendar restoration after account sign-in is chained
behind the initial Supabase **task** reconciliation, so an import cannot mint a second local task id while
the already-linked row is still waiting in the cloud pull. A failed initial pull releases its promise gate
and schedules a retry after 30 seconds; Calendar remains blocked until one reconciliation succeeds. An
import snapshots Calendar-owned task fingerprints when its request begins; a local edit made before the
response merges stays authoritative even if its PATCH has already drained from the queue. Finally, absence
from the bounded events list is never deletion evidence: every absent linked event is fetched directly by
id, and only an authoritative 404/410 or cancelled resource permits pruning. The immediate verification
after a successful PATCH still skips that redundant lookup once, but later polls remain safe when a move
put the event outside the window.

The fifth guard (owner report 2026-08-19, *"changing the start and end times also did not update my gcal
task as intended"*) covers the verification pull itself, and it exists because the two guards above cannot
see it. `gcalFlushQueue.finish()` fires that pull the moment a write drains, so the op is already off the
queue, and the fingerprint snapshot was taken from the post-edit state, so nothing reads as changed. If
Google answers with a not-yet-updated copy — most likely for a recurring series, which has to re-expand its
instances after a master PATCH — `mergeCalendarEvents` writes the OLD times back over the edit that was
just successfully pushed. The flush therefore passes `justWrittenTaskIds` into the pull it triggers, and
those tasks stay locally authoritative for it. `preserveEventIds` never covered this: it stops a MOVED
event being read as deleted, not stale content being read as truth.

**All three "whose copy wins a pull" decisions now live in `gcalPendingFor(importFp, justWrittenTaskIds)`**
— queue presence, fingerprint drift, and just-written — so the question has one answer rather than three
call sites. It returns a COPY of the queue: the list is a decision, never an edit to the queue itself.
Protection is per task, so an ordinary inbound change to any other event in the same pull still lands.

These guards do not reconcile or remove duplicates that already exist.

**Deletion/tombstone handling remains load-bearing (2026-08-13).** The old gated funnel once queued no
remote DELETE and — because the tombstone is written inside `gcalEnqueue` — recorded nothing locally.
The next silent import found a live event with no matching task and no tombstone and re-created it, which
is the owner's report that deleted tasks *"came back after a few minutes"*. A delete still supersedes
pending writes for its task, records the event tombstone before network I/O, sends DELETE (accepting
404/410 as already gone), and clears the tombstone only after Google accepts the deletion.

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
