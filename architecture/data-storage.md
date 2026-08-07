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
| `included` | `true` means pressed into today; `false`/legacy `null` are unpressed. New tasks default pressed. |
| `startClock` / `endClock` | Whether an edge carries a user-typed time. `null` derives from the timestamp; an explicit flag is needed only to distinguish a deliberate `00:00` from a bare date. |
| `pin` | `null` or a list `[{day, start, dur, partial?}]` -- drawer timeline blocks dragged to a clock time, each fixed for its own day only. `partial:true` pins one chunk of a split task and leaves the rest flexible; no flag means the whole task is fixed that day. Legacy single-object rows still read, and `migrateDragPinList` normalizes them once. This manual drag-pin is unrelated to derived scheduling shapes. |

All task mutation, undo snapshotting, persistence, auto-scheduling, and outbound diffs flow through
`commit()`. Do not create a second mutation path.

## Workspace storage

The app is local/offline first. `wsKey(base)` returns a bare key for the anonymous workspace and
`base::<uid>` for an authenticated workspace. Scoped access uses `lsGet`, `lsSet`, and `lsRemove`.

Scoped keys: `pp-tasks`, `pp-sections`, `pp-settings`, `pp-prefs`, `pp-gcal`, `pp-run`, `pp-pomo`,
`pp-notify`, `pp-migrations`, `pp-habits`, `pp-journal`, `pp-scratch`, `pp-journal-prompts`, sync
queues, and tombstones.

`pp-scratch` (V3.1) is the **running scratchpad**: one record `{html, updatedAt}` holding a single
continuous rich-text document per workspace — not per day and not per task. It reuses `richField`, so
the stored value is the same sanitized HTML subset the journal entry and task descriptions produce; an
edit that empties the field stores `''`, never `<br>`. Nothing in the app rotates, truncates, or clears
it (that is what "append-only" means here — there is no processing step). `normalizeScratch` also reads
a bare string as the document itself, so a hand-edited backup cannot lose notes to a shape mismatch.
Surfaced in Focus (its home, hotkey `n`) and echoed as a Journal rail card; both render the same
`fieldKey`, so they are two views of one document, never two copies. Like `pp-sections` it is
**local-only** — `KV_TABLES` names real Supabase tables, so it joins the deferred sync batch — and until
then `BACKUP_KEYS` is its only portability.

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
additive migration. `sectionId` nonetheless stays **out** of `SYNC_FIELDS`: its value is an id into
`pp-sections`, and that store has no Supabase table, so mirroring the reference alone would leave a
fresh device's tasks pointing at sections that exist nowhere. Promoting it is later a one-line client
change with no SQL. Column names are quoted camelCase and must equal the JS field name verbatim — the
row is mirrored 1:1 with no mapping layer, which is the `pin` rename trap.

`blocking` is tri-state (`true` blocking / `false` background / `null` inherit `BLOCKING_DEFAULT`), so
`null` is the value every pre-existing row holds and no data backfill is needed. Upgrading costs one
full push (the sync fingerprint gained two fields). Downgrading is safe: an old client neither reads
nor writes the new columns, and PostgREST leaves columns absent from an upsert payload untouched, so
the server-side values survive an old client's writes.

Global keys: `pp-theme`, `pp-sync`, `pp-workspace`, `pp-accounts`, and `pp-auth`. `pp-auth` is the
one approved persisted account-session path. Google refresh tokens live only server-side in
`public.gcal_tokens`; client secrets are Edge Function secrets.

Account switching is a clean workspace switch. Anonymous or another account's local rows are never
silently imported into a new account. Backup helpers round-trip `pp-*` data; Pomodoro is ephemeral.
