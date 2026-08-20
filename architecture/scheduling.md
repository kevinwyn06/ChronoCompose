# Scheduling

`computeAllotted` calculates planned minutes over active working intervals. `dayIntervals` subtracts
fixed blocks, the free-time reserve, breaks, completed-history blocks, and point keep-clear boundaries.
(It no longer subtracts meals: since 2026-08-19 Lunch and Dinner are ordinary tasks, so they arrive
through `fixedBlocksToday` like any other appointment — see “Routines” below.) `buildDayTimeline` packs the daily timeline
and supplies its day-specific allotment map during synchronous rendering.

S1 keeps both future learning hooks behind pure seams. `compressionSeam(features, availableMinutes)` is the
default allocator; `orderingSeam(features)` is the default priority, earliest-deadline, then longer-first
order. Both receive feature records without mutating them, so a later learned implementation can use
priority, urgency, slack, labels, or other task fields without changing scheduling callers.

## Allotment: reserve → share → cap (owner report, 2026-08-16)

`compressionSeam` was rewritten. The old shape paid zero-planned tasks off the top, in full, and never
compressed them, and it used `planned` only as a **weight** and never as a **target** — two faces of one
defect, and both halves of the owner's report (*"0 minute tasks are getting 30 minutes while 1 hour tasks
get just a few minutes"*). The shape now is:

```
demand(f)    = f.demand (precomputed by computeAllotted for day B) or requestedMinutes(f)
reserved     = predictManual OR uncompressable rows → allotted = demand, off the top, never squeezed
pool         = max(0, availableMinutes − Σ reserved)
compressible = everything else, sharing `pool` in proportion to demand
allotted(f)  = min(share(f), max(0, demand(f) − spent(f)))     ← the cap
```

- **Surplus is left UNALLOCATED on purpose.** There is no redistribution pass. A loose day should show real
  free time rather than pad every estimate.
- **Deliberate over-subscription is still a feature.** When demand exceeds the pool every compressible row
  shrinks proportionally; the capacity readout reports, it never trims.
- **The cap must run BEFORE the (28a) largest-remainder apportionment.** Run before the cap, the
  apportionment could hand a row a leftover whole minute past its own estimate — the exact thing the cap
  exists for. `left` is therefore derived from the CAPPED total.
- The reserve for an `uncompressable` row subtracts `spent`; a `predictManual` row's does not. A re-typed
  figure means "give me this much *more* today"; a checkbox cannot carry that meaning. Precedent is V5
  block 34 — *"what is freed is the REMAINING demand only"*.
- `computed` is the **counterfactual auto value**, never a copy of `allotted`: the share the row would have
  received had it competed normally. `togglePredictManual` and the V4.3 edge-drag snap-back both exist to
  compare the two. Its pool is re-derived as `max(0, availableMinutes − (reservedSum − thisRow))` — *not*
  `pool + thisRow`, since `pool` is clamped at 0 and the additive form would invent minutes — and it is
  weighted by `f.autoDemand` (the row's demand with any manual override taken out), or "auto" grows with the
  override and a drag-back never converges.

**`planned` is three-valued.** `null` = no time given (renders `—`), `0` = deliberately zero (renders
`0:00`), `> 0` = an estimate. `requestedMinutes(t, B)` is the single definition of what one task asks day B
for, and its branch order is the design:

1. `predictManual` → the typed figure.
2. `planned != null` → the figure, so a deliberate `0` asks for 0 and competes normally.
3. both clocks set → `clockSpanMinutes`, because an appointment carries its duration in its clocks.
4. otherwise → `DEFAULT_TASK_MINUTES`, now **5** (was 30). Named cost: unestimated work renders as a sliver
   in the timeline, a deliberate nudge to estimate.

Creation sites preserve the same distinction: quick add without a duration, new subtasks, and imported
all-day events write `null`; a typed zero remains `0`. Ambiguity chooser tuples shape dates only and never
overwrite the duration parsed from quick-add text.

**`clockSpanMinutes(t, B)` is the appointment-shaped predicate, and new code should use it.**
`hasStartTime`/`hasEndTime` DERIVE a clock from the timestamp when the explicit flags are null, so "has both
clocks" is a strictly **wider** set than "is an appointment" — a plain multi-day window at non-midnight
timestamps satisfies it. That single confusion mis-scaled `requestedMinutes` (a 2-day window demanding 2880
minutes from a per-day method) and mis-defaulted `uncompressable`. `clockSpanMinutes` applies `isFixedOn`'s
own day-fit test once and returns `null` — not 0 — for every other shape, so a caller can tell "no span to
read" from "a zero-length span".

**`uncompressable`** is a **tri-state** field ("Time needed: Flexible / Exact" in the detail panel, written
through `setUncompressable` → `commit()`). Ticked, the row reserves off the top and is never compressed. It
**gates `isFixedOn`**, so unticking a clocked task stops it being a fixed block — and `notBeforeMsOf` is
deliberately untouched, so the start still holds and only the end floats.

`null` means **never decided**, and `isUncompressable(t)` — the single reader, the rule `isBlockingTask`
follows for `blocking` — then derives the answer from `clockSpanMinutes(t) != null` **on every read**. So a
task that gains clock times later becomes Exact by itself (owner, 2026-08-16: *"uncompressable should
rederive"*); the earlier shape stamped the boolean once in `normalizeTask` and froze it there. A stored
`true`/`false` is a user **decision** and outranks the derivation permanently. `normalizeTask` stores
nothing; `computeAllotted` resolves the field when it builds the seam's features, so `compressionSeam`
still receives a plain boolean. It is in `SYNC_FIELDS` and needs Supabase migration `0013` (**nullable**
column — the never-decided state has to survive a round trip).

**Breaks** default to `settings.breakMin` **3** (was 0); the `break-min-default` local migration delivers it
to workspaces that have already saved settings. The pool's break estimate reserves `breakMin` per whole
family rather than per competing family — deliberately in the safe direction (it only ever under-allots),
after a pin was found to shrink the competing count and hand the remaining tasks `breakMin` extra minutes
each.

V2.1 makes today's participation explicit: `included===true` is pressed/in today regardless of the
date window, while false or null is unpressed. Since 2026-08-17 creation follows datedness: a dateless
quick task defaults to `true`, while any task carrying a start or end defaults to `null` and waits for
its occurrence window (or a later explicit press). The most recently started running timer is the
single stronger active state; it participates even if previously unpressed and packs no earlier than
the current time. Other-day columns remain date-window-derived. (V2.1 also gave non-Point pressed work with
zero `planned` a 30-minute reserve paid off the top and never compressed. **That rule is retired as of
2026-08-16** — see "Allotment: reserve → share → cap" above: `planned:null` now falls through the
`requestedMinutes` ladder to a 5-minute default and competes for the pool like anything else, while
`planned:0` deliberately asks for nothing.)

V2.2 adds two derived ambient signals without gating discretion. `isEligibleToday` requires today's day
inside the real/derived occurrence window and all existing predecessors complete; planned duration is not
part of eligibility. `isInheritedToday` detects unfinished work scheduled automatically or manually on
yesterday, auto-includes legacy/unpressed state today, and yields to explicit off or snooze. Both remain
live *predicates*; neither paints a row any more. The hatch and tint went in V2.9 §2, and the **pressed
depth went on 2026-08-12** — sheet and Gantt rows now carry only selection/hover, ACTIVE depth, the
critical-path inset and the calendar glow. Inclusion is read from `taskInclControl`'s glyph. See
`ui-runtime.md` for why (an ambient channel cannot encode a state most rows hold).

A **dateless recurring** task is expanded from a derived anchor rather than dropped from scheduling.
`renderVals` builds a shadow task with `recurGhostAnchor` (pure: anchor on whichever of start/due exists,
else today; every occurrence one day), while `t.start`/`t.end` stay null. Chain 6 block 47 removes the
old ghost paint: a task with neither raw edge now keeps an empty Gantt row, while these derived occurrences
remain available to the scheduling predicates.

**Dependency scheduling** (2026-08-14). `autoSchedule` pushes each task's dates so a finish-to-start edge
is never violated, and the rule is `Math.max(t.start, floor)` — strictly monotone, so a predecessor moved
*earlier* never drags a successor back, and slack absorbs a later move until it reaches 0. Propagation
walks successors only, so dragging a successor never moves its predecessor. Two things were added on
2026-08-14 and both are pure:

- **Propagation runs from the EFFECTIVE end, not the planned one.** `effectiveEndOf(t, now)` is the end a
  successor is actually anchored to: for an **unfinished, non-recurring** task whose planned end is already
  in the past, it is at least the start of today, because the work has not happened and the old date is
  fiction. The difference between `plannedEndOf` and `effectiveEndOf` is the **overrun**, and it absorbs
  slack and pushes successors exactly as a later drag does. Three cases deliberately keep the planned end:
  a **finished** task (`doneOn` — it really did end there), a **recurring** task (its `currentOcc(t).end` is
  rule-driven, and the carve-out that a series is never itself moved is unchanged), and anything
  unscheduled. `now` is an argument, so every rung is unit-testable without clock games.
- **A drag-time clamp.** `depFloorFor(id, tasks, now, skip)` is the earliest start the dependencies permit,
  and it is the **single source** the clamp and `autoSchedule` both read. `startBarDrag` captures the floor
  once at pointer-down (skipping the dragged subtree, which moves with the pointer); `clampBarToDeps(mode,
  r, floor)` applies it per mousemove. The clamp is an **affordance, not a second source of truth** —
  `autoSchedule` inside `commit()` remains the authority, and because both compute the same floor it has
  nothing left to correct on a clamped drop, so there is no rubber-band jump on release. An `end`-edge drag
  is never clamped (it does not move the start), and a `start`-edge drag that would invert the bar is left
  alone rather than emitting a bad span.

**Named consequence, handled rather than hidden:** with the effective end in play, a successor's dates move
*on their own* as days pass with its predecessor unfinished — a background rewrite of the user's plan.
`autoSchedule` therefore publishes `this._schedDisplaced` (`{taskId: displacementMs}`), the credit carried
down the topo order so a task three links from the overdue one still knows why it moved, and `ganttBlock`
gives a displaced bar its own visual channel so the movement is attributable. See the Gantt bar legend in
`ui-runtime.md`.

`computeCPM`/`computeSlack` handle the critical path and float. **They disagree with each other and always
have:** `computeCPM` builds its network from *durations starting at time zero* and ignores actual dates,
while `computeSlack` works from real timestamps — so the red critical-path paint and the panel's "Xd slack"
readout can contradict each other on the same task. Out of scope for the 2026-08-14 pass; logged rather
than silently widened.
Scheduling shapes are derived from dates, planned duration, and whether each edge has a user-entered clock.
The unrelated manual drag-pin remains, now as a LIST on `pin`: `[{day, start, dur, partial?}]`. The drag unit
is the timeline CHUNK, not the task, so a task that packs into several chunks (interrupted by an appointment,
a meal or a Point) can have one chunk pinned while the rest repacks. A record carrying `partial:true` fixes
only those minutes: they are drawn as a fixed block and carved out of the free intervals, while the task stays
in the flexible pool for its remainder (`allotOf(id).allotted` is the day TOTAL, `pinnedMin` the fixed slice,
`flexAllot(id)` the difference). Because those minutes are added back to the pool the seam divides, a drag
does not change any task's daily total. A record without `partial` is a WHOLE-task pin — the pre-04 meaning,
where the task leaves the pool entirely and is stamped `fixed` (`hasFullDragPinToday`). Pins are identified by
`(day, start)`, never by chunk index, so a pin survives a repack that changes the chunk count. Legacy
single-object `pin` rows read as whole pins and are normalized once by `migrateDragPinList`; the Supabase
column stays the same jsonb field. Dates are epoch milliseconds; all durations are minutes.

A pin may be dropped ACROSS an appointment — the overlap is permitted on purpose — so the pin's drawn span
and the free time it costs are two different measures, and `computeAllotted` keeps them apart. `pinnedMin`
is the whole drawn span (the task's flexible remainder must shrink by all of it, or it draws more than its
allotment); the amount added back to the pool is `netBusyClaim`, which attributes every busy minute to
exactly one interval — non-pin busy first, then pins in start order — so minutes shared with an appointment,
or shared between two pins, are counted once and never handed back as time the day does not have.

**Regroup** (`regroupSpan` / `regroupTask`) is the recovery path for a task the day has split: it re-joins
every chunk into one contiguous block by pinning the task's whole drawn span as a WHOLE-task pin. The slot is
the earliest gap at or after the task's current start that fits the total, where the walls are the immovable
things only (appointments, meals, other tasks' pins) — flexible work is not an obstacle because it repacks
around the new pin. `regroupSpan` returns `null` when the task has fewer than two chunks or when no gap fits,
and the timeline renders the affordance only when it returns a span, so the control never offers a no-op.

**Body-drag vs edge-drag** (V4.2). A timeline block carries two gestures with two different meanings.
Body-drag answers *when* — it is the drag-pin above, unchanged. Edge-drag (the block's bottom edge) answers
*how much*: it is a **sticky manual allotted override**, written through the existing `predicted` /
`predictManual` pair — the same field the sheet's Predict column writes — and not through a new field or a
per-block one. `edgePointerDown` captures the task's current `allotted` for that day, `edgeAllotFor(base,
deltaMin)` is the pure delta step (floored at `EDGE_MIN_ALLOT`), and the release calls `setAllottedManual`,
the numeric sibling of `setPredict`, inside one `commit()`. Nothing else changes: `compressionSeam` still
reserves every `predictManual` task's minutes off the top before it splits the pool (that is the "reserve"
step of the 2026-08-16 seam, now shared with `uncompressable`), so the other tasks
re-compress around the fixed one, the override survives every later re-pack, and `fixedBlocksToday` remains
the single source `computeAllotted` and `buildDayTimeline` share. Reset is the existing `∿ / ✎` toggle
(`togglePredictManual`); V4.3 owns a dedicated Reset control. `blockResizable` restricts the gesture to
blocks whose own allotment the seam decides — not a family block (subdivided among its children), not a
subtask (its share is handed down by `distribute`), not an appointment or a pin (their spans are their
own). Because `predicted` is a **task** field and not a per-day one, an edge-drag in a future column
overrides that task's allotment on every day; a per-day override would be a data-model change.

**Snapping** (V4.3). Both gestures resolve their drop through a single precedence, and the precedence *is*
the feature: **original → neighbour magnet → grid**, with the original's window wider than either of the
others (`PIN_ORIG_MAGNET` 18 min vs `PIN_MAGNET` 10 and `PIN_SNAP` 15; `ALLOT_ORIG_MAGNET` 12 vs
`ALLOT_SNAP` 5). Near where the block began, nothing else can win — that is what "priority snap, stronger
than grid increments" means. Both snaps are opt-in through an `opts` argument (`snapPinStart(raw, dur, B,
targets, opts)`, `edgeAllotFor(base, deltaMin, opts)`), so every pre-V4.3 call site is unchanged.
`opts.free` — **Alt held**, read live off each mousemove — disables every snap and places to the minute,
though the window clamp and `EDGE_MIN_ALLOT` still apply: free placement is free *within* the day.

Landing on the original does not merely restore the number, it restores the **auto formatting**: the
body-drag release hands the day's pin back (`unpinBlock`) and the edge-drag release clears the manual flag
(`clearAllottedManual`) instead of writing `predicted = computed`, which would leave the task frozen out of
the next re-compression. For an already-pinned block the original is not where the gesture started but
where the packer *would* put it — `autoStartFor(id, B)` re-packs the day once, at pointer-down, against a
copy of the tasks with that day's pins for the task removed. A block that was never pinned is already at
its original, so a drag out and back writes nothing at all rather than pinning it where it already was.

**Reset** is `resetBlock(id, B)`: one `commit()` that clears `predictManual` *and* that day's pins, so a
single Ctrl+Z recovers the whole restoration. `predicted` is left alone, exactly as `togglePredictManual`
leaves it — the seam only honours it while the flag is set. `blockOverridden(t, B)` is the predicate the
render uses. Resetting an already-auto block writes nothing, so it never leaves an empty undo entry.

## Derived scheduling shapes

| Shape | Test | Behaviour |
|---|---|---|
| Appointment (fixed) | Start has a time, `end` is set, span is at most one day, rendering is on its start day, **and `uncompressable` is true** | Occupies its literal clock span and shrinks the pool. Untick "Exact" and it leaves `fixedBlocksToday` for the compressible set, but `notBeforeMsOf` still holds its start — only the end floats. |
| Point (keep-clear) | Start has a time, `end` is `null`, and `planned` is 0 | Reserves no duration; its clock divides packing intervals. |
| Deadline (due-by) | `end` is set and start is untimed | Packs flexibly, with every minute before `dueMsOf`. |
| Flex | No edge supplies a scheduling clock | Packs freely inside its active date window. |
| History (frozen past) | The task is complete on day B and its position that day is derivable | Spans `[where it sat, its completion instant]`, emitted as **blocking** busy with `taskId:null`. It is not an allotment — the completed task claims nothing from the pool, it only stops the pool from counting hours the day has already spent. |

The fixed predicate has two load-bearing guards: it applies only on the occurrence's own start day and
only when `end - start <= DAY`. A multi-day `Mon 09:00` to `Fri 17:00` window therefore stays flexible
instead of consuming a whole daily pool.

Recurring day-specific reads use `occOnDay(t, B)`, which returns `null` when no occurrence overlaps that
day. `occForDay` retains its legacy always-an-object contract for guarded render paths. Derived Exact is
therefore day-aware: an undecided recurring appointment reserves its clock span only on its real
occurrence day; an explicit `uncompressable` decision still wins on every day.

Bare dates are stored at midnight. `hasStartTime` and `hasEndTime` normally derive clock presence from the
timestamp; nullable `startClock` / `endClock` flags only disambiguate a deliberately typed `00:00` from an
untimed date. Clearing TIME restores midnight and a `null` derive flag. An untimed midnight due date means
end-of-day, while explicit midnight is that exact instant.

**Pool agreement invariant**: `fixedBlocksToday(B, tasks)` is the single source for fixed blocks.
`computeAllotted` passes it to `dayIntervals` as `extraBusy` (the pool shrinks by fixed spans and the fixed
task's allotment is its span) and `buildDayTimeline` uses the same call for its free slots and block
rendering, so allotment and packing cannot disagree. Unscheduled leftovers carry a reason:
`'no room before due'` or `'day full'`.

**Blocking vs background busy intervals** (owner decision 2026-08-06, block 10). Every busy interval
`dayIntervals` builds now carries `blocking:boolean`. It is a property of the INTERVAL, not only of a
task: the Free-time reserve and a completed-history block carry no task at all and are **blocking** by
the stated default `BLOCKING_DEFAULT` (true) — as Lunch and Dinner did until they became tasks on
2026-08-19; a fixed appointment inherits `isBlockingTask(t)` from the task's
tri-state `blocking` field (`null` = inherit); and a **drag pin is background**, because two hand-placed
blocks may overlap each other and that permission predates this flag. The field is set on first Google
Calendar import from the event's `transparency` (`transparent` ⇒ background) via `blockingFromEvent`,
and by the detail panel's "Busy type" control (`setBlocking`, routed through `commit()`).

Block 10 only **annotates**. Nothing branches on `blocking` to schedule, pack or render differently —
a background appointment still consumes its span from the pool exactly as before. Block 11 is what
consumes it (a dropped chunk splits around blocking busy; Alt keeps the contiguous behaviour).

Point discrimination is structural: `end:null` plus a clocked start and zero planned minutes. There is no
separate end-pin sentinel. `keepClearToday` supplies the same sorted Point instants to allotment and packing,
and the render merge step preserves a split whose shared boundary is a Point.

Recurrence uses `expandTask` and `rruleToRecur`. Recurring occurrences are derived; changes must preserve
series semantics and recurrence limit/backoff protections.

## Overlapping fixed blocks are charged once (owner report, 2026-08-19)

The owner: *“the computation of time that is free does not account for the fact that if there is overlap
between two fixed tasks there is double or multicounted time.”*

Diagnosis first (`tests/owner-2026-08-19-overlap-accounting.test.js`). `dayIntervals` was never at fault:
its sweep does `cur = Math.max(cur, b.end)`, so it unions overlapping busy correctly. The defect was the
allotment **stamping**, which gave each fixed block its whole drawn span. Two appointments overlapping by
30 minutes claimed 120 minutes against a day that had only lost 90, so the identity came to 1470 against a
1440-minute day.

The fix reuses `netBusyClaim`, which already solved exactly this for drag pins (04b): it attributes every
busy minute to exactly one interval, earliest start first. Fixed blocks now go through the same call, so
an overlap is charged to whichever appointment was there first and never twice. Two other candidates were
measured and **ruled out**: `brkFams` (the gap is 30 minutes at `breakMin` 0 and at 3 alike) and `minChunk`
(under saturated demand the packer fills the pool exactly, on the overlap fixture and on a deliberately
fragmented day, at the default and at 1). The owner’s “time that is not filled” symptom did **not**
reproduce and still wants its own repro from real data.

## Freezing the elapsed past (owner report, 2026-08-19)

The owner: *“Suppose I finished a task early. Great, the schedule should move. But it should not reschedule
as if that task never existed.”* Decision: freeze the elapsed span, free the remainder **from the
completion moment** — a task packed 13:30–14:30 and ticked at 14:10 keeps 13:30–14:10 and returns the last
20 minutes.

`completedHistoryBlocks(B, tasks, now)` is the whole mechanism, and it is pure: `now` is an argument, never
`Date.now()`. It finds each completed task’s position from three sources, cheapest first — an appointment’s
occurrence, then a drag pin, both of which carry the start as DATA — and only what is left enters a
**single** re-pack of day B with the completed tasks restored to the competing set. One pass, not one per
task; that is why B1 needed no narrowed fallback, and `tests/owner-2026-08-19-freeze-past.test.js` COUNTS
the packs rather than trusting the claim. A completed task with no derivable start yields no block: it
occupied no hours, so there are none to freeze.

The helper carries a **re-entrancy guard**. `packStart` and `computeAllotted` both consult it, and its own
re-pack calls `buildDayTimeline`, which consults both. Returning `[]` while a computation is already in
flight is not a shortcut but the required semantics: that inner pack asks “where would these have sat had
nothing been completed”, and such a day has no history blocks and no history floor.

**The history floor.** `packStart` returns the LATER of “now” and the last completion today. Nothing may be
placed before a moment the day has already spent. On a day with no completions this is byte-identical to
the pre-2026-08-19 behaviour.

**A break after each completion** (owner: *“remember to add a break after the task is marked done”*).
`historyBusyToday` is the single point of use shared by `computeAllotted` and `_buildDayTimelineInner`; it
extends each history block’s end by `settings.breakMin`. The break is added there and **not** inside
`completedHistoryBlocks`, because that helper answers “what hours did this consume” and a break is not
consumed hours. Because the pool and the packer read the same call, the pool-agreement invariant holds with
no second break mechanism.

## Day bounds are dragged, not typed (owner decision, 2026-08-19)

*“Instead of having the day start and day end be a setting, have them the dragable objects in the timeline
views”*, and *“Global setting, dragged”* — the handles edit `settings.dayStart` / `dayEnd` for every day,
not a per-day override. The Settings row is retired; `DEFAULT_SETTINGS` still carries the values, they
simply have one editor instead of two.

`setDayBounds` clamps `dayEnd > dayStart` so an inverted drag is never stored, and writes both bounds in
ONE record so a single Ctrl+Z restores both. The handles live in the hour GUTTER, never over the block
area: a full-width strip at the column’s bottom edge sat on top of any block dragged there and swallowed
its clicks (`tests/e2e/timeline-drag.spec.js` caught exactly that on the unpin target). Block gestures are
used constantly and must win the pointer; the gutter is dead space that never holds a block.

## Start moves end; end sets duration (owner decision, 2026-08-19)

*“If both start and end time exist, changing one should change the other by preserving the duration.”* A
start-clock edit now slides the end by the same delta; an end edit still rewrites `planned` from the new
span. The gate is `clockSpanMinutes(t) != null`, **not** `hasStartTime && hasEndTime` — the latter is a
strictly wider set and admits a multi-day window at non-midnight timestamps, whose end must not be dragged.

This NARROWS but does not repeal the 2026-08-17 rule that a clock edit makes the booked span the plan: the
span is still the plan on every path; a start edit simply no longer changes the span.

## Routines replace the hardcoded meals (owner decision, 2026-08-19)

Lunch and Dinner were two `addBusy` calls with no task behind them, so they could not be renamed, moved for
one day, completed, or given a duration. They are now ordinary tasks in a `Routines` section, alongside
Breakfast and two Points, Wake up and Shut down.

New workspaces seed all five. An existing workspace’s migration carries **only Lunch and Dinner**, at
whatever clocks its settings held. That asymmetry is deliberate: the four settings encoded exactly two
blocks of reserved time, and seeding Breakfast as well would silently reserve 30 minutes a day the
workspace never had. The regression that matters asserts `dayIntervals` output is minute-identical before
and after the migration.

The structural `meal` chunk kind survives, now meaning the one busy interval left with no task behind it:
the free-time reserve.

## Indefinite snooze (owner decision, 2026-08-19)

*“Snooze today and take out of today are practically the exact same thing and is therefore useless.”*
`snoozeIndef` is a DATELESS snooze: `snoozeUntil` answers “not until when”, this answers “not until
something happens”. `snoozeWakeReason(t, B, now)` gives the owner’s four wake rungs — an explicit include,
a real start arriving, a due date passing, or the last blocking predecessor completing — and asks “is it
woken”, never “was it woken TODAY”, so a wake missed while the app was closed still fires. A woken task
reads as `new` (today brought it back), not as inherited work.

Current invariants:

- Archived and unpressed tasks do not allot or render as active work today; user pressing is never gated
  by the date window.
- Point tasks reserve no duration but split allocatable runs at their clock.
- No row is ever allotted more than `max(0, demand − spent)`; surplus stays unallocated rather than being
  redistributed.
- "Is this appointment-shaped?" is `clockSpanMinutes(t, B) != null`, never `hasStartTime && hasEndTime`.
- Fixed tasks pass both the same-day and at-most-one-day guards.
- Ghost draw width may depend on zoom; scheduling span must not.
- Overlapping fixed blocks are attributed once, via `netBusyClaim`: the fixed set plus the pool never
  exceeds the window.
- Nothing is ever packed before the history floor — the later of “now” and the last completion today.
- The pool and the packer read the SAME busy set: `fixedBlocksToday(B, tasks)` plus `historyBusyToday(B, tasks)`.
- `completedHistoryBlocks` re-packs at most ONCE per call, whatever the number of completed tasks.
- Manual movement/resize remains undoable through `commit()`.
- Keep helpers pure and test them through `tests/_load.js` where possible.
