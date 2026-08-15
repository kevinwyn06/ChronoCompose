# Scheduling

`computeAllotted` calculates planned minutes over active working intervals. `dayIntervals` subtracts
fixed blocks, meals, breaks, and point keep-clear boundaries. `buildDayTimeline` packs the daily timeline
and supplies its day-specific allotment map during synchronous rendering.

S1 keeps both future learning hooks behind pure seams. `compressionSeam(features, availableMinutes)` is
the default linear/proportional-by-planned allocator, including today's spent time and manual Predict
overrides. `orderingSeam(features)` is the default priority, earliest-deadline, then longer-first order.
Both receive feature records without mutating them, so a later learned implementation can use priority,
urgency, slack, labels, or other task fields without changing scheduling callers.

V2.1 makes today's participation explicit: `included===true` is pressed/in today regardless of the
date window, while false or legacy null is unpressed. The most recently started running timer is the
single stronger active state; it participates even if previously unpressed and packs no earlier than
the current time. Other-day columns remain date-window-derived. Non-Point pressed work with zero
`planned` reserves `DEFAULT_TASK_MINUTES` (30 minutes), compressed evenly only when the pool is smaller.

V2.2 adds two derived ambient signals without gating discretion. `isEligibleToday` requires today's day
inside the real/derived occurrence window and all existing predecessors complete; planned duration is not
part of eligibility. `isInheritedToday` detects unfinished work scheduled automatically or manually on
yesterday, auto-includes legacy/unpressed state today, and yields to explicit off or snooze. Both remain
live *predicates*; neither paints a row any more. The hatch and tint went in V2.9 §2, and the **pressed
depth went on 2026-08-12** — sheet and Gantt rows now carry only selection/hover, ACTIVE depth, the
critical-path inset and the calendar glow. Inclusion is read from `taskInclControl`'s glyph. See
`ui-runtime.md` for why (an ambient channel cannot encode a state most rows hold).

A **dateless recurring** task is expanded from a derived anchor rather than dropped. `renderVals` used to
give one an empty occurrence list; since 2026-08-12 it expands a shadow task built from `recurGhostAnchor`
(pure: anchor on whichever of start/due exists, else today; every occurrence one day) with each occurrence
flagged ghost. `t.start`/`t.end` stay null — dragging an edge commits a real date through the normal
bar-drag path. `ghostDrawSpan` skips its view-fraction floor for any occurrence carrying `occ`, since a
series tiles and does not need any one member enlarged.

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
the numeric sibling of `setPredict`, inside one `commit()`. Nothing else changes: `compressionSeam` already
takes every `predictManual` task's minutes off the top before it splits the pool, so the other tasks
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
| Appointment (fixed) | Start has a time, `end` is set, span is at most one day, and rendering is on its start day | Occupies its literal clock span and shrinks the pool. |
| Point (keep-clear) | Start has a time, `end` is `null`, and `planned` is 0 | Reserves no duration; its clock divides packing intervals. |
| Deadline (due-by) | `end` is set and start is untimed | Packs flexibly, with every minute before `dueMsOf`. |
| Flex | No edge supplies a scheduling clock | Packs freely inside its active date window. |

The fixed predicate has two load-bearing guards: it applies only on the occurrence's own start day and
only when `end - start <= DAY`. A multi-day `Mon 09:00` to `Fri 17:00` window therefore stays flexible
instead of consuming a whole daily pool.

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
task: Lunch, Dinner and the Free-time reserve carry no task at all and are **blocking** by the stated
default `BLOCKING_DEFAULT` (true); a fixed appointment inherits `isBlockingTask(t)` from the task's
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

Current invariants:

- Archived and unpressed tasks do not allot or render as active work today; user pressing is never gated
  by the date window.
- Point tasks reserve no duration but split allocatable runs at their clock.
- Fixed tasks pass both the same-day and at-most-one-day guards.
- Ghost draw width may depend on zoom; scheduling span must not.
- Manual movement/resize remains undoable through `commit()`.
- Keep helpers pure and test them through `tests/_load.js` where possible.
