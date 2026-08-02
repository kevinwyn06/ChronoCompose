# Data and storage

## Task model

Tasks are normalized by `normalizeTask`. Core fields include IDs/title, `start`/`end` epoch
milliseconds, `planned`/`spent` minutes, `pct`, scheduling `type`, labels, dependencies, recurrence,
parent/tree order, inclusion/snooze state, archive state, Calendar identity, and backend `updatedAt`.
Categories are `@tags` in `labels`; `type` is never a category.

Scheduling-specific fields:

| Field | Meaning |
|---|---|
| `start` / `end` | Epoch milliseconds or `null`; bare dates sit at local midnight. |
| `planned` | Planned duration in minutes; participates in derived shape discrimination. |
| `startClock` / `endClock` | Whether an edge carries a user-typed time. `null` derives from the timestamp; an explicit flag is needed only to distinguish a deliberate `00:00` from a bare date. |
| `pin` | `null` or `{day, start, dur}` -- a drawer timeline block dragged to a clock time, fixed for that day only. This manual drag-pin is unrelated to derived scheduling shapes. |

All task mutation, undo snapshotting, persistence, auto-scheduling, and outbound diffs flow through
`commit()`. Do not create a second mutation path.

## Workspace storage

The app is local/offline first. `wsKey(base)` returns a bare key for the anonymous workspace and
`base::<uid>` for an authenticated workspace. Scoped access uses `lsGet`, `lsSet`, and `lsRemove`.

Scoped keys: `pp-tasks`, `pp-settings`, `pp-prefs`, `pp-gcal`, `pp-run`, `pp-pomo`,
`pp-notify`, `pp-migrations`, `pp-habits`, `pp-journal`, sync queues, and tombstones.

Global keys: `pp-theme`, `pp-sync`, `pp-workspace`, `pp-accounts`, and `pp-auth`. `pp-auth` is the
one approved persisted account-session path. Google refresh tokens live only server-side in
`public.gcal_tokens`; client secrets are Edge Function secrets.

Account switching is a clean workspace switch. Anonymous or another account's local rows are never
silently imported into a new account. Backup helpers round-trip `pp-*` data; Pomodoro is ephemeral.
