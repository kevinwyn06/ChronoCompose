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

**Delete propagation and the ack ledger (owner 2026-08-20 — RESOLVED).** The reconcile used
to treat "absent from the server" as "not pushed yet" unconditionally: `applyRemoteSnapshot` kept local-only
rows and `syncInitialSync` re-`insert`ed them, and the kv branches stripped deletes from the diff. A device
closed during a delete therefore resurrected the row for everyone. Tombstones are per-origin `localStorage`
and cannot cross, so they could never fix this.

`pp-sync-acked` is a workspace-scoped ledger of ids the backend has **confirmed** — returned by a pull, or
accepted from a push. `syncAbsentDecision(id, acked, pending)` is the single answer to "who is right":

| local row absent from the server | decision |
|---|---|
| acked | the server deleted it → delete locally |
| not acked | we never pushed it → keep and insert |
| a pending unflushed write exists | keep, whatever the ack says |

The un-acked branch **is** the old never-delete rule, kept for the case it was written for: a first sync
must not wipe a never-uploaded workspace, and a wrongly deleted section orphans every task filed under it.
A missing or corrupt ledger reads as "nothing acked" — never the inverse, which would delete a workspace on
one bad parse. Acks are written **after** the backend confirms (post-pull, post-upsert) and dropped after an
accepted delete or a Realtime `DELETE`, so the ledger never claims a row the backend does not have.

Tasks go through `applyRemoteSnapshot(local, remote, tombstones, opts)`; habits, journal and sections go
through `syncKvMergeMap(localMap, remoteMap, tombs, opts)` — one shared merge, replacing three open-coded
copies that each stripped deletes differently. Both take `opts` optionally, so an omitted ledger reproduces
the old keep-everything behaviour exactly.

**Option A (a server-side `deleted_at` soft delete) is CLOSED as WONTFIX, owner 2026-08-21** — it is no
longer on the backlog. It is the more complete answer in the abstract, because it can compare clocks on the
deletion itself where the ack ledger can only resolve existence. But the ledger fixes the resurrection bug
that was actually reported, and the only thing A adds is resolving a delete-versus-concurrent-edit race
that has never been observed here. The cost is a migration, a table that never shrinks, and a
`deleted_at is null` filter on every read path whose *omission* silently resurrects deleted rows — the
same failure this section exists to prevent. Do not reopen without an owner report of a real lost delete.

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

**Closing the insert loop is a synced write (2026-08-20).** `stampEventId` writes `eventId` and
`calendarId`, and **both are in `SYNC_FIELDS`**. It was the one write to mirrored columns that skipped
both funnels — a bare `setState` + `saveTasks`, with no `updatedAt` stamp and no Supabase push. That is
what produced the reported "double import": the server never learned the link, so the next echo of the row
it *did* hold arrived strictly newer (its `touch_updated_at` trigger guarantees that), `mergeRemoteOverLocal`
assigned `eventId = null` back over the stamp, and the following commit saw `!t.eventId` at the outbound
insert guard and queued a **second** insert. Two real Google events for one task, deterministically — not a
race. `stampEventId` now calls `stampUpdated` and `syncOut`, which is all LWW ever needed from it.

The rule, stated generally: **any write to a `SYNC_FIELDS` column must carry a fresh `updatedAt` and reach
`syncOut`, whatever else it skips.** `stampEventId` deliberately skips the other two — no `commit()`, because
Google reporting the id it assigned is not a user step and an undo that reverted the `eventId` would re-arm
the very insert this prevents; and no `gcalSyncOut`, because diffing the id Google just handed us straight
back out to Google would queue an immediate PATCH of the event we just created. Skipping the undo snapshot
and the outbound Calendar diff is fine. Skipping the clock and the Supabase push was the bug.

**The second, distinct duplication mechanism (G2b) is fixed 2026-08-25.** `mergeCalendarEvents` built its
`byEid` map once from the task array it was handed, so two merges racing on the same pre-state each added a
task, producing two task ids sharing **one** `calendarId|eventId`. Once formed the collision was permanent:
the map is last-write-wins, so exactly one of the pair was ever updated again, and the prune path only
removes tasks whose event is *missing* from the live calendar — which this one is not. The duplicate was
invisible to both halves of sync and survived forever. See


**Identity is now one thing.** `gcalKey(calendarId, eventId)` is the single spelling, and the merge index
uses it, so the three call sites that disagreed (`byEid` on the bare `eventId`, `handled` on `cid|eid`,
prune/verify on `calendarId|eventId`) now agree. That agreement is a precondition, not a tidy-up: a silent
collapse keyed on the bare event id could merge two rows that legitimately describe the same event id on two
different calendars. A `loose` fallback keyed on the bare id covers **only** a legacy row linked before
`calendarId` was stored — without it the merge reads that row as absent and imports a second copy, creating
the duplicate this change exists to end. A paired hit always beats a loose one, and a loose hit is re-filed
under its pair key the moment its calendar is known.

**Collapse is a silent merge (owner ruling, 2026-08-21).** `collapseEventDuplicates` runs before the index
is built, so the index cannot re-elect the wrong survivor. It keeps the row with the newest `updatedAt`
(ties keep the earliest in array order, so the outcome does not depend on iteration luck) and drops the
rest. Three properties matter:

- **It is silent.** A stray row is a sync artifact the user never created, so surfacing it as a deletion to
  acknowledge is noise. Nothing is added to the import message.
- **It never reaches Google.** The event is fine and is not being deleted; only the surplus local row goes,
  in the manner of `pruneDeletedEvents`, which likewise splices without enqueueing a Calendar op. The local
  delete propagates to Supabase through the shipped ack ledger, so this needs no `deleted_at` migration.
- **Dependencies are re-pointed at the survivor, not deleted.** A merge preserves the graph; dropping the
  edge would silently unblock a successor, and that failure would surface as a task scheduling early with
  nothing pointing back at the collapse. Re-pointing is de-duplicated and cannot produce a self-dependency.

Archived rows and rows without a link are never touched.

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

For OAuth QA, use a throwaway account and never reload mid-session.

### The display-only tier (2026-08-31)

Owner ask: *"birthdays should be migrated"*, then *"This should be in no calendar except the 'birthday'
calendar. it should also respond to the short term import"*, and — on the design — *"we need to make it
smooth to use. Not all events in personal will be display only. And I really don't want display only to be
a per-task toggle the user needs to go through."*

**The problem, measured live on the owner's account 2026-08-31.** The primary calendar carries 19
birthday events (18 yearly-recurring); **17 of them are also on the contacts Birthdays calendar**. They
are two genuinely distinct Google events per person with no shared id, so no merge key exists and
`mergeCalendarEvents` could never collapse them — ticking Birthdays would simply have produced 17 double
rows. Only `Sam's Birthday` and `Quinn's birthday` exist on the primary alone.

**Google already labels these, and the labels are asymmetric.** The *primary* copies carry
`eventType:"birthday"`; the *Birthdays calendar's own* copies come back as plain `default`/`opaque`. A
rule built on either signal alone therefore misses half the duplicates. Two mechanisms compose:

- **Event level** — `gcalEventIsDisplay(ev, tier)`. Display when `eventType` is in
  `GCAL_DISPLAY_EVENT_TYPES` (`birthday`, `workingLocation`, `outOfOffice`), or when
  `transparency === 'transparent'`. `eventType` is tested first, so an explicitly-Busy birthday is still
  a birthday. **`fromGmail` is exempt from the transparency rule** (owner call): a Gmail-derived
  appointment is real work even though Google marks such events Free.
- **Calendar level** — `calTier(cid)` returns `auto` | `tasks` | `display`. `auto` is the default and
  runs the event classifier; the two explicit values skip it entirely, so `tasks` also protects a work
  calendar whose events happen to be marked Free. `GCAL_DISPLAY_DEFAULT_CALS` makes `auto` resolve to
  `display` for the contacts Birthdays calendar, which is what covers the un-labelled half above.

Busy/free doing most of the work is not a coincidence. Across the owner's whole account every real task
is `opaque` and every informational event is `transparent`; *"does this consume my time"* is the same
question as *"is this a task"*, and the user already answered it in Google.

**A display event is not a task, and that is the entire safety argument.** It never enters `pp-tasks`.
It therefore cannot be scheduled, cannot be pushed to Supabase, cannot reach `gcalEnqueue` — and so can
never issue a remote `DELETE` against the owner's Google Calendar — and cannot collide with the
de-duplication machinery. It lives in `pp-calevents` (`{items, updatedAt}`, local-only, in
`BACKUP_KEYS`), and `calEventTasks()` projects it to read-only pseudo-tasks under the `ce:` id prefix.
Those are appended to **`_calTasks` only** — after filtering, because a filter says which of your *tasks*
to work on — so the calendar views that already map over tasks render them and every mutating or syncing
path stays blind to them.

**Occurrences are stored FLAT**, exactly as `singleEvents=true` expanded them inside the import window;
no recurrence rule is kept. That is what makes the per-calendar Short term setting apply to them for
free — the window *is* `timeMax`, so shortening it simply stops producing occurrences.

**Conversion needs no one-time migration.** `pruneDisplayTasks` removes a task row whose event has just
been classified display-only, locally, with no tombstone and no `gcalEnqueue` — the same "splice, never
enqueue" contract `pruneDeletedEvents` and `collapseEventDuplicates` hold. The next import reclassifies
and the stale rows leave by themselves, in **both** directions: flip a calendar back to `Tasks` and the
events re-import as ordinary tasks.

`results` is deliberately **not** filtered before `gcalVerifyMissing` / `pruneDeletedEvents`. A display
event is live on Google, and removing it from the liveness evidence would make its absence read as a
deletion. Only `taskResults` reaches `mergeCalendarEvents`.

Render surfaces: month-view chips (italic, no priority dot, and **excluded from the day's task count** —
a birthday is not work owed), a `data-pp-calinfo` band under each day-grid column header, and a line
under each Schedule-view day divider. The day-grid body and the Schedule agenda are `buildDayTimeline`'s
output, which never schedules these, so a header band is the only honest place they can appear there.

The picker's `maxHeight` went 360px → **540px** with the tier row, which is a third line per calendar.
That is the same clipping defect 360px was raised to fix the day before; it is re-sized *with* the row
rather than after the next report.

#### Three defects the first round missed (2026-08-31)

Owner report on the shipped feature: *"from what I saw I don't think it's working."* The first round's
tests covered the classifier, the store and the prune **in isolation**, all passed, and the feature still
did not work — which is the lesson worth keeping: unit-testing the pieces of a pull says nothing about
the pull. The follow-up drives the real `gcalImport` end to end with a stubbed `gcalFetch`
(`tests/display-only-import.test.js`), and that is what found these.

- **The view cache never invalidated.** `_calTasks` is rebuilt behind a gate whose keys are all
  task-state identities (`state.tasks`, sort, filters, sections, horizon…). A display event lives
  *outside* `state.tasks`, so an import that changed no task changed none of those keys — and once the
  birthdays are display-only, changing no task is the ordinary case. The events sat in storage, correctly
  classified and stored, and never reached a view until some unrelated edit happened to invalidate the
  cache. `calEventTasks()` is now memoized on the raw stored string, and its array identity is a cache
  key. This is the one the owner actually saw.
- **A write did not repaint.** `saveCalEvents` is not `setState`, and nothing else in the render path can
  observe `pp-calevents`, so even a correctly invalidated cache would not have been re-read until the
  next unrelated render. It now calls `forceUpdate` — but only when the stored items actually differ, so
  an idle poll re-storing identical events still costs nothing.
- **A deselected calendar's events were immortal.** `mergeCalEvents` replaced the calendars an import
  reached and kept everything else, so unticking a calendar left its display events rendering forever
  with no row to delete. It now also drops any calendar absent from `gcal.selected`. Tasks deliberately
  behave the other way (a deselect keeps them, because they may carry local edits); there is nothing
  local to preserve in a display event, and it rebuilds from Google on the next import. A calendar that
  is still selected but was not *reached* this run keeps what it had — absence from one import is not
  evidence, the same rule `pruneDeletedEvents` follows.

Verified in a real browser on an isolated origin (a second static server port, anonymous workspace, so
the owner's account was never touched): month-view chips and the day-grid band both render, the Gantt
sheet shows only the task, and `pp-tasks` contains no birthday.

#### The window test on a recurring series asks the occurrences, not the anchor (2026-08-31)

`pruneOutOfWindow` compared `t.start > farMs`. A recurring import stores the **master's** start, which
for a yearly birthday is the birth year — so the test was false forever and **every recurring event on a
short-term calendar was permanently immune to the window**, while non-recurring ones pruned correctly.
That asymmetry is precisely why the owner's hand-made yearly birthdays ignored Short term and the
contacts Birthdays calendar (one non-recurring event per year) obeyed it.

It now asks whether the series has an occurrence **overlapping `[now, farMs]`**. The overlap test matters
as much as the switch to occurrences: `expandTask` starts at `recurStartIndex`, an estimate that can
undershoot into the past, so testing `start <= farMs` alone would keep every recurring row forever —
trading one direction of the bug for the other. Cost is bounded by `recurStartIndex` (today − 2 days) and
`RECUR_MAX`, so a twenty-year-old anchor still expands a handful of occurrences.

This is a general defect, not a birthday one: it affected any recurring event on any short-term calendar.

### Per-calendar import lookahead (2026-08-25)

Owner ask: *"Make a toggle for calendars making them short term input with a config for how long into the
future it looks (e.g. 1 month) or else birthdays and holidays will pile up and completely saturate the
planning page."*

The toggle and the length are **per calendar**, stored as `gcal.lookahead[calendarId] = {shortTerm, len}`
where `len` is one of `1w · 1m · 3m · 6m · 1y · all`. `calLookaheadDays(cid)` resolves that to a day count,
or `null` for unlimited — which is the answer for an unconfigured calendar, for `shortTerm:false`, and for
`len:'all'`. **The default is unlimited, so nothing changes until a calendar is actually made short-term.**
A birthday calendar can be capped at a month while a work calendar stays unrestricted.

`gcal.lookahead` is persisted by `saveGcal` and re-read by `loadGcal`. Both mattered: `saveGcal` writes a
**whitelist** of keys rather than the whole object, so a key added to only one side would work for a session
and silently forget itself on reload.

Two places consume it, and they cover new and existing events respectively:

- `gcalImport` builds **`timeMax` per calendar** (`farFor(cid)`) instead of one global `g.window` bound. The
  global window remains the fallback for any calendar without its own setting.
- `pruneOutOfWindow(tasks, cid, farMs)` runs in **both** apply branches (the silent clone and the explicit
  commit), dropping rows already stored beyond a now-shortened window. Without it, turning a calendar
  short-term would only affect future imports and the existing pile-up would stay.

The prune requires an `eventId` and matches on `calendarId`, so a locally created task can never be removed
by a calendar's window, and one calendar's setting never touches another's rows. It writes **no tombstone**,
which is deliberate: a pruned event must re-import on its own once it comes into range.

Distinct from the filter bar's horizon slider, which shares the goal and none of the code: the **slider
hides** far-future work that exists; **this stops it existing**. See `architecture/ui-runtime.md`.

### The calendar picker: paging, and the calendars Google will not enumerate (2026-08-30)

Owner report: *"the birthday calendar is missing, and I think some other ones are too. I suspect it might
have been merged into personal or something."* Nothing merges calendars — `gcalListCalendars` maps the
`calendarList` items straight to picker rows. Two independent defects produced the symptom.

**Google does not return the Birthdays calendar from `calendarList` — at all.** Measured live against
`qa@example.com` on 2026-08-30: the bare call returned **3** entries, and
`?showHidden=true&maxResults=250` returned the **same 3**, every one of them `hidden:false`. Yet
`GET /calendars/addressbook%23contacts%40group.v.calendar.google.com` answered **200** with summary
`Birthdays`, and its `events` endpoint answered 200. **Sidebar visibility in Google Calendar is not
`calendarList` membership.** That is why the calendar is plainly not hidden in Google and still never
reached the picker: the picker is built purely from `calendarList`, so such a calendar could never be
ticked no matter what the user did on Google's side.

`GCAL_UNLISTED_CALS` names those ids (today: the Birthdays calendar). After the list returns,
`gcalAppendUnlisted` probes each id that the list did not already carry and appends the ones this account
can actually read. Each probe is caught independently — an id this account cannot read, or one Google
retires, must degrade to *"not offered in the picker"* and never to a failed calendar list. An id the list
already carried is not probed at all, so if Google ever starts enumerating Birthdays this costs nothing and
cannot produce a duplicate row. `calendars.get` carries no `backgroundColor` (that field lives on the
`calendarList` resource), so these rows fall through to the picker's existing `#888` swatch default.

**`showHidden` is deliberately not sent.** Every calendar on the tested account reports `hidden:false`, so
it would buy nothing, and it would start surfacing calendars the user removed from their Google list on
purpose. `hidden:true` is Google's *"hide from my list"*, which is a different setting from the sidebar
checkbox (`selected`) — conflating the two is what made `showHidden` look like the fix.

**`gcalListCalendarPages` follows `nextPageToken`.** The old call sent no parameters, so it took Google's
100-entry default and dropped everything past page one with no error and no way for the user to tell.
`GCAL_CAL_PAGE` is 250, Google's per-page cap.

**The picker's `maxHeight` was 140px.** That was sized for one-line rows; the per-calendar *Short term*
control added 2026-08-25 took each entry to ~44px, so the box clipped at ~3.2 calendars and hid the rest
behind a scroll with no affordance — measured live, `clientHeight 139` against `scrollHeight 178` at only
**three** calendars. It is 360px now, ~8 rows before scrolling. This, not any merge, is what "some other
ones are missing too" was.

Still open: `gcalDropGone` unchecks a calendar that 404/410s with no user-facing notice, so a calendar can
stop importing silently. Unproven on the owner's account, and untouched here.

#### Invariant: an appended unlisted calendar is not evidence for `gcalReconcileLinks` (2026-08-31)

`gcalAppendUnlisted` and `gcalReconcileLinks` read the same array with opposite assumptions, and the
combination destroyed data until this was fixed. The probe **must** catch every error — a retired or
unreadable id may not fail the whole calendar list — so a plain 503 silently drops the Birthdays row.
`gcalReconcileLinks` then saw a list it believes is authoritative, missing that calendar, and cleared
`calendarId`/`eventId` on every task imported from it. Nothing restores the link on the next successful
list, and a re-import creates a duplicate instead.

So `GCAL_UNLISTED_CALS` ids are **always known** to `gcalReconcileLinks`. Absence from `calendarList` is
what defines these calendars; it can never also be the signal that one has gone away. The evidence that a
calendar is really gone is a 404/410 from its *events* endpoint during an import, and `gcalDropGone`
already acts on exactly that. The general rule for anything new here: only a list that could in principle
contain an id may be used to conclude that id is missing.

`gcalListCalendarPages` also stops when Google hands back a `nextPageToken` it has already used. Nothing
in the API promises tokens strictly advance, and the recursion has no other terminator — a repeated token
refetches the same page forever and the returned promise never settles.

Editing a task imported from a read-only calendar (Birthdays is one) queues a PATCH that Google answers
403. `gcalFlushQueue` treats 400/403/404 as permanent and drops the op without retrying, so the queue
cannot jam; a local *delete* still sticks, because the tombstone is cleared only on a successful DELETE.
A local title/time edit, though, is simply lost at the next pull (a known gap).
#### A fourth: reclassification was limited to the import window (2026-08-31)

Owner report, after the three above were fixed: *"Why is Alex Rivera's birthday still shown as a row?"* —
one survivor, every other birthday correctly demoted. Her birthday had fallen nine days earlier, and with
a 30-day window her yearly series appears in **no** `events.list` response until the following August.

`displayKeys` was built only from events an import fetched, so a row whose event lies outside the window
could not be reclassified — it would have stayed a task for eleven months, and the same holds for any
already-imported row on a short window. Note this is *not* the `pruneOutOfWindow` path: that runs only for
calendars explicitly marked short-term, and her calendar was not one.

The fix costs no extra request. `gcalVerifyMissing` already makes an authoritative by-id lookup for
exactly these rows — a linked task absent from a bounded response is precisely its candidate set — and the
resource it fetched carried `eventType` and `transparency`, the two fields the classifier reads, before
discarding everything but the cancelled check. It now returns `{missing, display}` and `gcalImport` unions
the display half into `displayKeys`. The prune stays a local splice: no tombstone, no queued DELETE.

*(Superseded the same day: the demoted row was at first deliberately **not** written to `pp-calevents`, on
the reasoning that an out-of-window event has nothing to draw. The owner rejected that — demoting a task
must not delete the fact — so the probed resource is now carried back and stored. See the next section.)*
#### Display events are series, not dates (2026-08-31)

Owner, on the fix above: *"her birthday should still be treated as a birthday."* Demoting the task row was
right; letting the birthday cease to exist was not. The first store held one record per fetched
*occurrence*, which was wrong twice: N occurrences of a series inside the window drew N chips, and the
event vanished the instant the window moved past it.

A stored display event now carries the master's `recur`, anchored at the master's own start, so one record
covers every year. `calEventTasks` passes that rule through to the pseudo-task, which means the month grid
and the day-header glow expand it for free — both already go through `expandTask` via `tasksOnDay` /
`tasksByDayMap`. `calEventsOnDay` (the day-grid band and the Schedule list) had to be switched from a raw
start/end compare to the same expansion, or a yearly series would only ever have matched its anchor year.

Consequence worth stating plainly: a display event no longer depends on the import window at all. The
window governs which events are *discovered*; once one is stored as a series it renders on every date its
rule produces, however far ahead the user navigates.
#### Display events get their own unbounded discovery pass (2026-08-31)

Owner: *"Why do I not see birthdays say in 2028? Now that they don't occupy a row we should import all
occurrences."* Storing the rule (above) made a *discovered* birthday render forever, but discovery itself
was still the task pull: `singleEvents=true`, `timeMin=now`, `timeMax=now+window`. A birthday eleven months
out therefore appeared in no response at all — there was nothing to store, let alone expand. The only
reason Alex Rivera's showed up was that a stale task row existed for the by-id probe to find.

`gcalImport` now issues a **second request per calendar**, for the display tier only:

```
events?singleEvents=false&maxResults=250&timeMin=<now>          (no timeMax)
```

`singleEvents=false` returns series **masters** with their `RRULE` instead of expanded instances, and an
endless yearly rule matches any `timeMin` — so one request finds every birthday on a calendar whatever the
date of its next occurrence. Skipped for calendars pinned to the `tasks` tier, which by definition produce
no display events. A failure is swallowed per calendar and the windowed pass stores what it saw, exactly
as before.

Two consequences that needed handling:

- **The contacts Birthdays calendar carries no `RRULE`.** It states each person's birthday as a separate
  non-recurring event per year, with no `eventType` either. `gcalIsAnnual` therefore treats *anything* on
  that calendar — plus any explicit `eventType:'birthday'` — as annual, and `calEventFrom` synthesises
  `{kind:'year', n:1}`. Declared sources only; a title is never used to guess.
- **Which means the same person now arrives once per year.** Those ids carry the year (`2026_BIRTHDAY_x`,
  `2027_BIRTHDAY_x`), so N copies would have become N overlapping yearly series stacking N chips on one
  day. `gcalSeriesKey` strips the leading year from an annual event's id, and the import keeps one record
  per series: a candidate with a rule beats one without, and among equals the earlier anchor wins.

The per-calendar **Short term** window no longer constrains this tier in any way. That is deliberate — a
lookahead states how far ahead *work* is planned, and a birthday is not work.

#### One person, one chip: folding cross-calendar copies (2026-08-31)

Owner, immediately after the pass above landed: *"the issue is the duplicate birthdays is so confusing."*

Google keeps a contact's birthday in **two** places — on the address-book calendar, and as its own
`eventType:'birthday'` copy on the primary calendar. Different calendar, different event id, no field
linking them, so nothing in the import can tell they are the same fact and both are stored. Widening
`gcalSeriesKey` across calendars would be wrong: series identity is per-calendar, and the store is also
what makes unticking a calendar remove exactly what that calendar owns.

`dedupeAnnualDisplay` folds them on the way to the screen instead, inside `calEventTasks`:

- **Only annual events** (`recur.kind === 'year'`) are candidates. Two ordinary meetings sharing a name on
  one day are two meetings and both still draw.
- Matched on **normalized title + month + day** — not the raw start, because the primary master is anchored
  at the *birth* year while the contacts copy sits in the current one.
- The survivor is the lowest `cid|eid`, so the visible chip does not hop between calendars, and colours,
  from import to import.
- **The store keeps both records.** This is a presentation fold: untick the winning calendar and the other
  copy takes over. It also stays correct when one calendar fails to import and its old events carry
  forward, which a fold at import time would not.

## Dropping a repeat is a STATEMENT, not a silence (owner report 2026-09-09)

`eventBodyOf` used to write `recurrence` only when a local rule existed. Turning recurrence OFF therefore
sent a PATCH that said nothing about it: Google kept the RRULE, and the next poll or ping imported the
event back as a series and reinstated the rule — the owner saw the task go non-recurring and revert a few
seconds later. When `includeRecurrence` is set, an absent rule is now written as `recurrence: []`, which
is how Google converts a series to a single event.

The “never rewrite RRULE features we do not model” guard is unaffected: it lives in `computeOutboundOps`,
which is what decides whether `includeRecurrence` is true at all (only when `recurRuleKey` actually
changed).

## A repeat pushes ONE OCCURRENCE (owner report 2026-09-09)

Under the series-window model a repeat’s `start`/`end` are the WINDOW; `recur.durMs` is the occurrence.
Google’s `DTSTART`/`DTEND` on a recurring master mean the opposite: they describe one occurrence, and the
rule supplies the rest. Handing the window to `timesBodyOf` alongside an RRULE therefore gives *every*
occurrence the length of the whole series — the owner’s week view was a stack of week-long bands, one per
day of a daily rule. Read `eventBodyOf`’s `occEnd`, and note the two other places the same boundary bites:

- `mergeCalendarEvents`’ **update** branch assigns `t.start`/`t.end` directly and so bypasses
  `normalizeTask`, the single funnel that performs the window conversion. It repeats the conversion
  inline. The **first-import** branch does not need to — it goes through `normalizeTask`.
- Neither fix can heal an already-mangled calendar, because `computeOutboundOps` only patches a task
  whose own fingerprint changed. `gcalRepairRepeatOps`, run once via the `gcal-repeat-occurrence-length`
  flag, is what re-states the corrected body to Google.

`diffOverrideOps` was always correct here: per-occurrence ops carry real occurrence edges.
