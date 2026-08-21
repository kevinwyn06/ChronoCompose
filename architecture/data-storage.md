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
| `planned` | Planned duration in minutes, **nullable since 2026-08-16 and three-valued**: `null` = no time given (renders `—`), `0` = deliberately zero (renders `0:00`), `> 0` = an estimate. Participates in derived shape discrimination; `requestedMinutes` is the only place the three cases are resolved. Mirrored column made nullable by migration `0013`. |
| `uncompressable` | Tri-state, 2026-08-16. `true` = "Exact": the day reserves this task's figure off the top and never compresses it, and it is a precondition of `isFixedOn`. `false` = "Flexible". `null` = **never decided**, and `isUncompressable(t)` — the only reader — derives the answer from `clockSpanMinutes(t) != null` on every read, so a task that gains clocks later becomes Exact by itself. A stored `true`/`false` is a decision and outranks the derivation. In `SYNC_FIELDS`; **nullable** column added by migration `0013`. |
| `included` | `true` means pressed into today; `false`/`null` are unpressed. A dateless task defaults `true`; a task with either date defaults `null`, so hand-created and Calendar-imported future work does not enter today early. |
| `includedExplicit` | Boolean provenance for `included`, added by migration `0014`. `true` only when the user manually presses work into today; `false` for dateless automatic inclusion, dated bound-derived inclusion, unpresses, defaults, and migrated legacy rows. It lets incoming sync distinguish a current decision from the old unconditional `included:true` default. |
| `snoozeIndef` | Boolean DATELESS snooze, added by migration `0016` (owner, 2026-08-19). `snoozeUntil` answers “not until when”; this answers “not until something happens”, and the two are independent — an expired `snoozeUntil` still falls back to `included`, and this one does not expire at all. `snoozeWakeReason(t, B, now)` is the only thing that ends it: an explicit include, a real start arriving, a due date passing, or the last blocking predecessor completing. It asks “is it woken”, never “was it woken TODAY”, so a wake missed while the app was closed still fires. `NOT NULL DEFAULT false` — unlike `uncompressable` there is no “never decided” state to preserve. In `SYNC_FIELDS`. |
| `rowHidden` | Boolean sheet-row visibility, added by migration `0015`. `true` replaces the ordinary row with a reversible compact marker; it does not archive/delete the task or change scheduling, inclusion, Calendar identity, or persisted order. |
| `startClock` / `endClock` | Whether an edge carries a user-typed time. `null` derives from the timestamp; an explicit flag is needed only to distinguish a deliberate `00:00` from a bare date. |
| `pin` | `null` or a list `[{day, start, dur, partial?}]` -- drawer timeline blocks dragged to a clock time, each fixed for its own day only. `partial:true` pins one chunk of a split task and leaves the rest flexible; no flag means the whole task is fixed that day. Legacy single-object rows still read, and `migrateDragPinList` normalizes them once. This manual drag-pin is unrelated to derived scheduling shapes. |

**Epoch-ms fields are INTEGERS, and `normalizeTask` is what guarantees it (owner 2026-08-20).**
`start`, `end`, `completion`, `archivedAt` and `snoozeUntil` (`INT_MS_FIELDS`) are rounded on every
normalize. A fractional timestamp has no meaning in a day planner and is actively harmful: the mirrored
columns are `bigint`, so one fractional `end` wedged an entire account's sync queue — see
`architecture/sync-integrations.md`. **Null stays null**; a missing date is not epoch 0. `spent` and
`predicted` are deliberately NOT rounded here — they are fractional minutes by design, and
`syncRowForWrite` converts them to integer seconds on the way out.

All task mutation, undo snapshotting, persistence, auto-scheduling, and outbound diffs flow through
`commit()`. Do not create a second mutation path.

## Workspace storage

The app is local/offline first. `wsKey(base)` returns a bare key for the anonymous workspace and
`base::<uid>` for an authenticated workspace. Scoped access uses `lsGet`, `lsSet`, and `lsRemove`.

Scoped keys: `pp-tasks`, `pp-sections`, `pp-settings`, `pp-prefs`, `pp-gcal`, `pp-run`, `pp-pomo`,
`pp-notify`, `pp-migrations`, `pp-mig-routines`, `pp-habits`, `pp-journal`, `pp-scratch`,
`pp-journal-prompts`, sync queues, and tombstones.

**Four settings were deleted on 2026-08-19**: `lunchStart`, `lunchEnd`, `dinnerStart`, `dinnerEnd`.
Meals are tasks now (see `architecture/scheduling.md`, “Routines replace the hardcoded meals”). Unknown
keys are inert, so a persisted `pp-settings` blob that still carries the four is harmless — nothing
reads them, and `migrateRoutines` is what converts their VALUES before they stop mattering.

`pp-scratch` (V3.1) is the **running scratchpad**: one record `{html, updatedAt}` holding a single
continuous rich-text document per workspace — not per day and not per task. It reuses `richField`, so
the stored value is the same sanitized HTML subset the journal entry and task descriptions produce; an
edit that empties the field stores `''`, never `<br>`. Nothing in the app rotates, truncates, or clears
it (that is what "append-only" means here — there is no processing step). `normalizeScratch` also reads
a bare string as the document itself, so a hand-edited backup cannot lose notes to a shape mismatch.
Surfaced in Focus (its home, hotkey `n`) and echoed as a Journal rail card; both render the same
`fieldKey`, so they are two views of one document, never two copies. It is **local-only** — `KV_TABLES`
names real Supabase tables, so it joins the deferred sync batch — and until then `BACKUP_KEYS` is its only
portability. (This used to name `pp-sections` as the sibling example; that store was promoted to a synced
table on 2026-08-15 — see below — so the remaining local-only stores are this one and
`pp-journal-prompts`.)

`pp-journal-prompts` (V3.2) is the **guided journal's prompt set**: `{items:[{id,kind,text}],
updatedAt}`. It stores the *questions*, never the answers — prompts are guidance, and the day's single
`pp-journal` entry remains the only place a day's writing lives, so deleting a prompt can never delete
text. **Absence of the key means "never configured"** and seeds `DEFAULT_JOURNAL_PROMPTS()`; a *stored*
empty list means "I deleted them all" and is honoured. Those two states must stay distinguishable —
`loadJournalPrompts` therefore tests the raw value for `null` rather than falling back on an empty
`items`, and `resetJournalPrompts` **removes** the key rather than writing today's defaults into it, so a
later change to the default set still reaches the user. `kind` is `text` | `scratch` | `aging`; the two
derived kinds render their own body (the scratchpad review, the surface-aging list) instead of asking
for an answer, and re-wording a derived prompt keeps its kind. An unknown `kind` degrades to `text`
rather than being dropped. Local-only on the same terms as `pp-scratch`.

**"Today's lines" in the scratchpad lives in `pp-prefs`, not in `pp-scratch`.**
`scratchDayMark:{ymd, blocks}` is a high-water mark — the block index today's lines start at — stamped
by `stampScratchDayMark` on the first content-changing write of a new day and never moved again that
day. It is deliberately *outside* the document: the `pp-scratch` record shape stays exactly
`{html, updatedAt}`, so **no migration of an existing pad is possible or needed**, and clearing prefs
costs a day's highlight but never a line of text. A stale or missing mark reads as "nothing has been
typed today", so a legacy pad highlights nothing rather than everything. `splitScratchBlocks` does the
splitting with a tag-depth scan rather than a DOM parse, so it is pure and unit-testable under Node.

`agingTasks()` (the `aging` prompt) is **fully derived** — no new persisted field. A task is aging when
its `start` is at least `AGING_DAYS` (14) old, it has no recorded time, and it is not archived, complete,
or a milestone; undated tasks have no measurable age and are left to Extra/unplanned. Capped at
`JOURNAL_AGING_MAX` (8): a review cue, not a backlog dump.

`pp-prefs` view state includes `groupBy` (`section` | `inclusion` | `none`), `planView` (the Plan tab's
sub-view, now including `select` and `matrix`), and `collapsedSections` (band key → truthy when
collapsed). The inclusion bands use the reserved keys `__incl_in` / `__incl_out`; **absence of a key is
not "expanded"** for `__incl_out`, which defaults to collapsed, so collapse toggles pass the effective
painted state rather than reading the stored value alone. `pp-settings` gained `eisenhowerUrgentDays`
(default 2). The Selection and Matrix views add **no** persisted task fields — they write the existing
`included`, `snoozeUntil`, and `priority`.

**The batched sync migration (0008, block 10).** `snoozeUntil` and the new `blocking` field entered
`SYNC_FIELDS` **together**, as the one batch the backlog asked for rather than a migration per field.
`supabase/migrations/0008_blocking_snooze_section.sql` adds all three columns — `blocking`,
`"snoozeUntil"` and `"sectionId"` — nullable with no default, so the tasks table needs no further
additive migration. `sectionId` nonetheless stayed **out** of `SYNC_FIELDS` at that point: its value is an
id into `pp-sections`, and that store had no Supabase table, so mirroring the reference alone would leave a
fresh device's tasks pointing at sections that exist nowhere. Column names are quoted camelCase and must
equal the JS field name verbatim — the row is mirrored 1:1 with no mapping layer, which is the `pin`
rename trap.

**Sections sync (migration 0012, 2026-08-15).** That deferral is now closed, and `sectionId` is in
`SYNC_FIELDS`. The owner found the gap by using the app on two origins: *"My section grouping is different
on vercel (main) and local host (dev). That seems to suggest it's not synced - it should be."*

`supabase/migrations/0012_sections.sql` creates `public.sections` with the same `{id, owner_id, data jsonb,
updated_at}` shape as `habits`/`journal` — RLS on `owner_id = auth.uid()`, CRUD granted to `authenticated`
only, `truncate/references/trigger` revoked, the `touch_updated_at` trigger, and the table added to the
`supabase_realtime` publication (without which the client's changefeed subscription is silently inert).

Client side: `sections` joins `KV_TABLES`, so the store rides the existing **kv blob funnel** and inherits
its whole tested pure layer (`kvFp` / `kvStamp` / `computeKvOps` / `kvMergeDecision`) rather than growing a
third sync dialect. `saveSections` is the choke point, exactly as `saveHabits` is for habits — every section
mutation already routed through it. `sectionsToMap`/`sectionsFromMap` convert between the id-keyed map the
funnel diffs and the ordered list the app renders; **`sectionsFromMap` re-sorts by `order` with id as the
tiebreak**, which is not optional — rows come back from Postgres in pull order, and two devices agreeing on
the rows while disagreeing on the order is the reported bug wearing a different hat.

The rule the deferral was protecting still stands and is now pinned by a test: **the reference and the
referent sync together or not at all.** Shipping `sectionId` without the `sections` table is the dangling-id
trap 0008 refused to walk into; on a fresh backend, apply 0012 *before* deploying a client that carries the
field.

`blocking` is tri-state (`true` blocking / `false` background / `null` inherit `BLOCKING_DEFAULT`), so
`null` is the value every pre-existing row holds and no data backfill is needed. Upgrading costs one
full push (the sync fingerprint gained two fields). Downgrading is safe: an old client neither reads
nor writes the new columns, and PostgREST leaves columns absent from an upsert payload untouched, so
the server-side values survive an old client's writes.

Global keys: `pp-theme`, `pp-sync`, `pp-workspace`, `pp-accounts`, `pp-anon-promote`, and `pp-auth`. `pp-auth` is the
one approved persisted account-session path. Google refresh tokens live only server-side in
`public.gcal_tokens`; client secrets are Edge Function secrets.

Account switching is a clean workspace switch. Anonymous or another account's local rows are never
silently imported into a new account. Backup helpers round-trip `pp-*` data; Pomodoro is ephemeral.

**Anon promotion (V5 block 17, F5).** "Never silently imported" is not the same as "unreachable".
`syncBeginWorkspaceSwitch` now calls `anonPromotionOffer(uid)` *before* the reload — the one moment
both namespaces are addressable — and the user chooses. Accepting runs `promoteAnonInto(uid)`, which
is non-destructive on **both** sides: account rows are merged with, never replaced (tasks and habits
appended, sections merged by name, journal days and the scratchpad concatenated, preference keys
adopted only where the account has nothing), and the anon namespace is never cleared, so a wrong
answer is recoverable by signing out. Declining says so in plain words. Promoted task ids are
**regenerated** and `parentId`/`deps`/`sectionId` remapped, because `tasks.id` is a global PK on the
backend — importing anon ids verbatim is the 2026-07-15 RLS collision. The per-account decision lives
in the global `pp-anon-promote` ledger (`{uid:{choice,at}}`), which makes a second sign-in neither
re-ask nor duplicate rows. `promoteAnonInto` writes storage for a workspace that is not yet mounted,
so it is the one data path that cannot go through `commit()`; the reload re-hydrates it through the
normal constructor path. The older `importAnonInto` remains for a future explicit Settings import.

## One-time migrations (`pp-migrations`)

`runOnceMigrations` is called once, from the constructor, against the LOCAL task list. Each entry is
guarded by its own flag in `pp-migrations` and each writes that flag whether or not it changed anything,
so a migration that becomes a no-op still stops running. **A test that exercises a migration must clear
its flag first** — a fresh component already has every flag set, so calling `runOnceMigrations` again
silently asserts against a no-op.

Current flags, in execution order: `allday-planned-zero`, `schedule-pins-removed`,
`sections-from-primary-tag`, `retire-off`, `drag-pin-list`, `strip-section-tags` (2026-08-13),
`implicit-own-calendar-tag` (2026-08-13), `planned-null-unset` (2026-08-16), `uncompressable-rederive`
(2026-08-16), `included-dated-default` (2026-08-17).

One further flag, `break-min-default` (2026-08-16), shares the `pp-migrations` ledger but does **not** run
from `runOnceMigrations`: it lives in `migrateSettings`, whose only call site is `loadSettings`, and it
deliberately does not persist the migrated settings object — `saveSettings` calls `setState` and the
constructor is still building `this.state` at that point. The flag is recorded immediately, so the lift
happens once; the value persists on the user's next settings write, and until then the in-memory value is
the one every reader sees.

**`pp-mig-routines` (2026-08-19) is a key of its own, not a flag in the `pp-migrations` ledger.** It runs
from `initRoutines`, called in `componentDidMount` — NOT from `runOnceMigrations`, which runs inside the
constructor before `state` exists and therefore cannot use `commit()`. Creating tasks needs both.

It branches on whether the workspace is new: no persisted `pp-tasks` means a fresh workspace and
`seedRoutines()` creates all five routines; anything else is an existing workspace and `migrateRoutines()`
carries **only Lunch and Dinner**, at whatever clocks the four deleted settings held. The narrowing is
deliberate and is covered by a test: seeding Breakfast into an existing workspace would silently reserve 30
minutes a day it never had, and the acceptance criterion for that migration is that `dayIntervals` output
is minute-identical across it.

The flag is what makes a deleted routine stay deleted — without it, a user who removes Lunch would find it
back on the next load. E2E fixtures stamp `pp-mig-routines` in `tests/e2e/_seed.js` for the same reason the
other flags are stamped there: a fixture must contain exactly the tasks it seeded.

**The three 2026-08-16 additions ship the allotment fix to existing workspaces.**

- **`planned-null-unset`** rewrites the stored `0` that used to mean "unset" to `null`, so `0` can start
  meaning "deliberately zero". Without it the fix reaches only tasks created after the upgrade.
- **`allday-planned-zero`** clears legacy imported all-day estimates directly to `null`. Its result is
  order-independent with `planned-null-unset`: either order ends at unestimated, and neither pass can
  recreate a deliberate zero. New all-day imports also start at `null`.
- **`break-min-default`** writes `settings.breakMin = 3` onto any workspace still holding `0`. A default
  change alone reaches nobody who has ever saved settings, which is why this is a migration and not just a
  new value in `DEFAULT_SETTINGS`.
- **`uncompressable-rederive`** clears `uncompressable` back to `null` on every row whose stored value only
  restates the clock derivation, releasing the rows an earlier build of this branch froze by stamping them.
  A value that **contradicts** the derivation is the only evidence of a real user decision, and is kept.
  The predicate is `clockSpanMinutes` — *not* `hasStartTime && hasEndTime`, which is a wider set and would
  treat plain multi-day windows as reserved-off-the-top while they never qualify as `isFixedOn`. The key is
  deliberately not the earlier `uncompressable-backfill`, which some devices already have marked done.

**`included-dated-default` (2026-08-17)** clears legacy `included:true` from dated rows whose real or
derived occurrence window does not contain today. The old default and a genuine press stored the same
bit, so the local one-time migration necessarily clears a small number of real presses too; this
owner-accepted cost is preferable to every future or imported event entering today permanently.
Migration `0014` adds mirrored `includedExplicit` provenance: only a manual press writes `true`, while
defaults, automatic inclusion, unpresses, and migrated rows carry `false`. The incoming correction runs
only without explicit provenance, so an old-client default is still corrected but a current press survives
pulls and later remote-winning edits. Apply `0014` before deploying a client with the field in
`SYNC_FIELDS`; adding it causes the expected one-time full task re-push.

**Synced row hiding (migration 0015, 2026-08-18).** `rowHidden` is an explicit non-null boolean on
`public.tasks` and in `SYNC_FIELDS`. Apply `0015_row_hidden.sql` before deploying the client field; an
older schema rejects every task write that names a missing column. As with 0014, the fingerprint change
causes one expected full task re-push on first upgraded sync. Existing and old-client rows default false.
Old-client writes omit the column, so PostgREST preserves a current client's hidden state.
Migration `0015` is **APPLIED** and catalog verified: `rowHidden | NO | boolean | false`.

**Indefinite snooze (migration 0016, 2026-08-19).** `snoozeIndef` is an explicit non-null boolean on
`public.tasks` and in `SYNC_FIELDS`. `0016_snooze_indef.sql` had to be applied before the client field;
an older schema rejects every task write that names a missing column. As with 0014 and 0015, adding it
to `SYNC_FIELDS` changes the fingerprint and causes one expected full task re-push on first upgraded
sync. Existing and old-client rows default false, and old-client writes omit the column so PostgREST
preserves a current client's value.

Migration `0016` is **APPLIED** (2026-08-20, run in the Supabase SQL editor because `config.toml` is
deliberately not committed) and catalog verified: `snoozeIndef | NO | boolean | false`. Re-verify with
the usual catalog query:

```sql
select column_name, is_nullable, data_type, column_default
  from information_schema.columns
 where table_name='tasks' and column_name='snoozeIndef';
```

**The two 2026-08-13 additions share one principle: a container's name is not one of the user's tags.**

- **`strip-section-tags`.** Owner: *"Sections should not be a tag."* V2.6 made sections a first-class
  entity but its migration deliberately read the primary `@tag` and **left it on the task**, so a task in
  section "Research" also wore an `@research` chip and the app went on presenting a section as a kind of
  tag — the exact model V2.6 existed to break. `migrateSectionsFromTags` now **consumes** the tag it
  promotes, and this second flag re-sweeps workspaces that already ran the old version (which is all of
  them, hence a separate flag: re-running `sections-from-primary-tag` would also re-promote tags in a
  workspace where the user has since deleted those sections on purpose). Two consequences worth knowing:
  the promotion pass now only ever **assigns** a `sectionId` and never clears one, because a second run
  would otherwise find no tags and null out the sections it had just created; and `sectionTagStrippable`
  exempts tasks linked to an **external** calendar, whose first label is owned and re-added by
  `mergeCalendarEvents` — stripping it would start a churn loop and break the calendar chip.
- **`implicit-own-calendar-tag`.** Strips the reserved `@chronocompose` tag wherever it appears. Applied
  to every task rather than only currently-linked ones, because the name is reserved. See
  `architecture/sync-integrations.md`.
