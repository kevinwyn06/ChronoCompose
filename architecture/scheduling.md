# Scheduling

`computeAllotted` calculates planned minutes over active working intervals. `dayIntervals` subtracts
fixed blocks, the free-time reserve, breaks, completed-history blocks, and point keep-clear boundaries.
(It no longer subtracts meals: since 2026-08-19 Lunch and Dinner are ordinary tasks, so they arrive
through `fixedBlocksToday` like any other appointment — see “Routines” below.) `buildDayTimeline` packs the daily timeline
and supplies its day-specific allotment map during synchronous rendering.

**One pool, two readers (Task 29, 2026-08-22).** `allotPool(tasks, B)` is the single computation of the
day's pool — it owns everything from the fixed-block stamping through `avail`, and returns the whole
working set (`map`, `fixed`, `kb`, `cand`, `fin`, `acts`, `di`, `pinnedMin`, `pinBack`, `avail`, …).
`computeAllotted` calls it and then owns the seam, the subtree distribution and the pin floor;
`dayCapacity` calls it and derives the readout figures. Neither recomputes the pool.

This replaced an `opts.capacity` **out-param** on `computeAllotted`. That out-param existed to keep the
readout reading the same two numbers the seam divides — the **pool-agreement invariant** — after the
retired `scheduledLoadOn` disagreed with the drawn grid by up to 7x. When Task 28 deleted the capacity
UI, the out-param looked like dead weight; it was not, because the allotment suite read it through
`dayCapacity` and that coverage was the only proof of the invariant. Lifting the pool retires the
out-param *and* strengthens the guarantee: the invariant is now **structural** — there is one
computation, so the two callers cannot disagree about it — instead of a property two computations
happened to share. `tests/owner-2026-08-22-allot-pool.test.js` pins that.

The rule for anyone extending this: **a caller that needs another figure about the day's pool adds a
field to `allotPool`'s return, never a second computation at the call site.** That is exactly how the
7x drift arrived the first time.

S1 keeps both future learning hooks behind pure seams. `compressionSeam(features, availableMinutes)` is the
default allocator; `orderingSeam(features)` is the default priority, earliest-deadline, then longer-first
order. Both receive feature records without mutating them, so a later learned implementation can use
priority, urgency, slack, labels, or other task fields without changing scheduling callers.


## Subtasks on the timeline and the agenda (owner rulings 2026-08-21 / 2026-08-22)

### A parent with no planned time is a CONTAINER (owner ruling 2026-09-09)

The budget model below — parent keeps its own Planned, its allotment is split among its children in
proportion to theirs, any remainder stays with it — is unchanged **wherever the parent has a figure**.

It had one hole, and it is the shape people actually make: a heading with work under it. Such a parent
asked the day for nothing (`planned` is 0, so `requestedMinutes` is 0), was allotted nothing, and then
split that nothing among its children — so an entire family of real work received no time at all, while
the parent still drew a bar across the chart for it.

`isContainerParent(t, kids)` is true for a non-milestone task that HAS children and no `planned > 0` of
its own. A container is taken out of the middle: its children enter the day's pool directly on their own
dates and Planned (`hasBudgetedParent` is what the pool, the break estimate, the family split and the
packer all ask instead of "does it have a parent"), and the container itself never competes, never
allots, never packs, and draws no Gantt bar. It stays a row in the sheet, which is the whole of what it
is for. Derived on every read like `isChore`, so typing or clearing a Planned figure moves the family
between the two models with no stored state to go stale.

### The shape: C1 and S1

A family is **ONE block with ONE border**, and its children ride inside it as `kids` lines. This replaced
a run of sibling blocks titled `Parent › Child`; what won option C the ruling is that the parent is
exactly one object, and a compound-titled run is not that. Depth is carried by **indent + tick colour**,
not by a second structural device per level. C2 (a lip at every level) is the recorded fallback if depth
reads as ambiguous in use — a CSS change to the same markup, not a different design. C3 (flatten past
depth 2 into a count) is rejected: it makes the block lie about what is scheduled.

The Schedule view draws the same subtree the same way (**S1**), and the constraint that decides it is not
aesthetic: `renderScheduleView` merges blocks, Points and the now-rule into one array sorted by `ms`, so
a parent has to occupy exactly **one sort position**. The two surfaces draw the same day one panel over.

### The active cue: V2, and what "active" means

**Active is the subtask whose scheduled span contains "now"** — the line the red now-rule crosses. Not the
running timer, not the next incomplete child. It is the only one of the three that is a pure function of
the packed layout and the clock, so it cannot disagree with what both surfaces already draw. Two
consequences: **no cue on a day that is not today**, and **a running timer does not move it** — the timer
keeps its own ▶/■ affordance, and the two signals may point at different children because they answer
different questions.

The treatment is **V2** — the gutter tick becomes a filled caret, plus a tint — and that was decided by a
size constraint, not a taste one. A child line is ~10.5px text inside a block whose height comes from
MINUTES, not from content, so a true border (V1) costs ~2px of box on a line with ~6px of slack and
pushes the last child of a short parent out of view. V2 reuses the gutter already reserved for the tick,
so it costs **zero layout** — which is what the e2e asserts, by measuring every line, moving the cue, and
requiring the boxes to be identical. V3 (an inset edge) is the accepted fallback, same markup.

### The depth-ordered splitting rule

*Prefer splitting a task over a subtask, a subtask over a sub-subtask.* The distinction most easily lost:

> **Splitting cost is about cutting THROUGH a node, never about ordering AROUND it.**

Putting one child before an appointment and another after it splits the parent, not either child. A seam
between siblings is **free at every depth**. `layFamily` therefore applies two rules in order: a WHOLE
placement beats a cut at any depth, and only when nothing fits whole is the **shallowest** item cut.
Depth is a **pre-filter only** — within a depth, items keep the order `orderingSeam` gave them.

Two things make the rule reachable at all. `familyQueue` walks to **any depth** (the two-level
subdivision it replaces drew grandchildren nowhere), and a family is laid across its **whole run of
chunks in one pass** — a per-chunk walk could only ever cut at the boundary, so "a whole child either
side of the appointment" was unreachable.

Case 1 — *a plain task absorbs the shortfall* — lives in the packer rather than in `layFamily`: the
strict pass refuses to fragment a subtree, so a flat task takes the hole first. The relaxed pass still
allows a deep cut, which makes it **rare rather than impossible** — better than declaring a day
unschedulable.

### Dragging

**A drag moves the piece you grabbed and everything contained in that piece.** Grab an uncut parent and
the whole family moves, because the whole family *is* that one piece; grab one half of a cut parent and
only the children packed into that half travel. Once a family is one chunk this is what the existing
machinery already says — the drag unit is the CHUNK, and a cut parent has one chunk per piece, so the pin
is `partial` and the other piece stays where the packer put it. The build was therefore mostly a
*removal*: `blockDraggable` used to refuse a parent with children, because there was no single object to
grab.

Two consequences that had to be built deliberately: a **drag-pinned family keeps its children**, or the
drag would appear to dissolve the subtree (the same `layFamily` pass lays the queue into the pinned
span); and the drag handle is the **parent row**, a child line never pinning itself.

### A note for whoever measures this next

A child's minutes are no longer a measurable block height, because the family draws as one block. Each
line therefore declares `data-tl-kid-min`, and `drawnMinutes` apportions the block's **measured** height
across those shares — so "what the sheet charges is what the timeline draws" is still held to a tenth of
a minute, and a drift in the block's own height still fails exactly as it did.

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
3. both clocks set **and not explicitly Flexible** → `clockSpanMinutes`, because an appointment carries
   its duration in its clocks. `uncompressable === false` (a stored user decision, never a derived one)
   skips this rung: an end that may change is an end that no longer states a duration, so a Flexible task
   falls to rung 4. The gate reads the RAW field and lives in `requestedMinutes` — `isUncompressable`
   derives itself from `clockSpanMinutes`, so gating either of those would be circular.
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
deliberately untouched, so the start still holds and only the end floats. Since 2026-08-20 it also gates
`requestedMinutes` rung 3 (above): releasing the end releases the clocks' claim on the duration too, so a
Flexible appointment competes at its `planned` figure or the 5-minute default rather than reserving its
full span. Only an explicit `false` does this; a never-decided clocked task derives as Exact and keeps
its span.

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
  in the past, it is at least the end of today, because the work has not happened and the old date is
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

**The floor is an EXCLUSIVE edge** (owner 2026-09-09). Every end above goes through `endExclusiveOf(t, ms)`,
which is the one place the two meanings `end` carries are reconciled — and the reason a one-day push of a
predecessor used to move nothing at all:

| The task | What `end` holds | Exclusive edge |
|---|---|---|
| ordinary | midnight of the **inclusive last day** — "due that day", as `dueMsOf` has always read it | next midnight (`addLocalDays`, so a DST crossing lands on midnight, not 23:00) |
| `allDay` (the gcal shape) | already the **exclusive** next midnight — which is why `sheetDateParts` subtracts 1ms to display it | unchanged |
| a user-typed **clock** | the exact instant work stops | unchanged |
| **recurring** | `currentOcc(t).end` = `start + recur.durMs`, an instant the rule produced | unchanged — converting it would add a second day to any whole-day occurrence starting at midnight |

The floor read `t.end` raw and so knew about none of them, letting a successor start ON its predecessor's
last day: a full day of overlap that the Gantt draws as one, and a link that ate a day of push before it
reacted. `startFloorFor(t, lb)` then puts that edge in the **successor's** granularity — a task whose start
carries a clock is held to the instant, a date-only task to the day the instant falls in, which is also what
stops `autoSchedule` from writing a non-midnight start that `hasStartTime` would read back as a clock the
user never typed. `depFloorFor` and `autoSchedule` both apply it, so the affordance and the authority still
agree exactly. `computeSlack` measures the same occupancy span for the same reason: on `end - start` a chain
would collect one free day of float per link and stop reading as critical exactly when it was.
`computeCPM` is untouched — it chains relative durations from zero and never reads a stored date.

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

**A repeat's `start`/`end` are the SERIES WINDOW (owner ruling 2026-09-09).** `t.start` is the anchor —
the first day the rule may produce an occurrence, and the index every override is measured from. `t.end`
is the last instant it may, and **null means unbounded**. How long ONE occurrence lasts is `recur.durMs`.
`recur.until` is retired to a legacy INPUT (an imported RRULE, quick-add's "until" clause); `normalizeTask`
folds it into `t.end`, so stored data holds exactly one series end.

Read it through the accessors, never off the fields — that is what keeps an unconverted row correct:

- `recurDurMs(t)` — the occurrence's length. Falls back to the anchor span for a legacy row; coerces
  "never stated" to 0, because an expansion needs a number.
- `seriesEndMs(t)` — the last instant, or null. `setSeriesEnd(t, ms)` writes it back through whichever
  shape the task is in.
- `anchorEndMs(t)` — the ANCHOR OCCURRENCE's end: `t.end` for a plain task, `t.start + durMs` for a
  repeat, and **null** when no length was ever stated. That last case is a repeating Point, which is why
  this is not the same question as `recurDurMs`.

The trap, and it caught five readers: for a repeat, **`t.end` is not an occurrence edge**. Anything asking
"does this end carry a clock", "how long is this", "is the end open", or "when did this open" must go
through `anchorEndMs`/`recurDurMs`. `isPointTask` reading `t.end` made every unbounded repeat a Point —
and a Point is vetoed off every day but its own, so a daily standup stopped competing for time at all.

`isScheduled` follows from this: a repeat is scheduled once it has an anchor AND a stated length
(`durMs != null`, zero included — a same-day repeat means a zero-length occurrence on purpose). A length
that was never stated still reads as a ghost, which is what keeps the half-dated repeat drawable.

Mutators: `setDate` and the date picker on a repeat edit the WINDOW, and only the anchor re-indexes the
series. The occurrence's length is edited through `setOccDuration` or the When line. Clearing a repeat's
END unbounds the series; clearing its START is refused.

**Writing a window in text (owner ruling 2026-09-09, second half).** *"The details of each occurrence
should be stored in the detail panel and be parsed."* `shapeRecurWindow` binds a PARSED rule to this
model, and it is the last thing `shapeParsedTask` does:

- a typed **clock range** ("daily 9–10am") is one occurrence → it becomes `durMs`, the anchor keeps its
  clock, and the window is left open;
- a typed **day range** ("every wednesday from 1 Sep to 30 Sep") is the window itself, and the occurrence
  is whatever length the text gave, else day-granular;
- an **`until`** clause is the window's end and nothing else.

`durMs` is written UNCONDITIONALLY, including as 0. That is what stops `normalizeTask`'s legacy
conversion from firing on fresh input and re-reading a new window as one very long occurrence — the same
defect arriving through the front door. The shaping is gated on the TEXT having named a rule, because
`reconcileWhen` deliberately retains a rule the title never mentioned, and re-shaping there would read a
window the text said nothing about as absent and erase the series end.

A series end is stored as an **exclusive** instant, matching the window's `end` everywhere else:
`expandTask` caps on occurrence STARTS, so "until 30 Sep" held as 30 Sep 00:00 would drop every
occurrence on the day the user named.

`whenSentence` prints rule, then window, then occurrence — and the ORDER is a round-trip requirement, not
a style choice. The clock-range matcher demands whitespace or end-of-string after the closing time, so a
clock followed by `, from …` is not recognised at all and the time is silently lost. Every shape the line
prints is asserted to parse back into the task it came from (`tests/repeat-window-parsing.test.js`).

### The lead window, and the circle that never reaches forward (owner rulings 2026-08-24)

**How far ahead a repeat reaches:** *you never see more than one period ahead, and never more than
`RECUR_LEAD_MAX_DAYS` (30) ahead.* `recurPeriodDays` is the single definition of a rule's period —
`recurStartIndex` divides by it rather than keeping a second per-kind table — and `recurLeadDays` is
`min(period, cap)`. `occWithinLead` measures from the **start of today**, not from `now`, so the answer
cannot change part-way through a day and flicker a task off the list at an arbitrary hour.

Daily, weekly and monthly repeats are unaffected: their next occurrence is always inside the window. A
yearly repeat leaves today's surfaces once its occurrence is settled and returns 30 days before the next
one. **Nothing is deleted** — the series, its overrides and its Gantt row are untouched; the occurrence
is simply not yet today's business.

**The gate sits on BOTH surfaces, and it asks about `pending` rather than about today (fixed
2026-08-25).** As first shipped it lived inside `originOf`'s "today's occurrence is done" branch, and
`occInDay` is null on every day the series does not fall on — so the gate was unreachable on 364 days
out of 365, and a ticked-off birthday came back the next morning and stayed for eleven months. It now
asks whether the **next occurrence with work left in it** (`nextPendingOcc`) is inside the window, which
is both the fix and the simpler statement of the rule: if that one is beyond the window there is nothing
to do now, whatever today happens to contain. It cannot hide a live occurrence today — an unfinished one
IS `pending`, zero days out.

`originOf` decides which triage **bucket** a task sits in; `isActiveOn` decides whether it takes a slice
of **today**. Gating only the first left the two disagreeing about the same task — the list saying "not
today's business" while the timeline drew a block and claimed minutes — because `included===true` is
sticky (a real press, and V2.11 retired the "Off" that cleared it). `recurBeyondLeadToday` is the shared
predicate; the today-branch of `isActiveOn` consults it **below** the running-timer check, since a timer
the user actually started outranks every rule here.

Two guards are load-bearing:

- **Missed occurrences are carved out.** `nextPendingOcc` looks forward from today, so a renewal missed
  last week is not in it, and vetoing on "the next one is eleven months out" would take an owed deadline
  off today's list — the silent drop the standing tenet forbids, committed by the rule meant to reduce
  noise. `hasMissedOcc` asks the stored occurrences, not `taskDisp`.
- **An unreadable rule is never judged.** `recurPeriodDays` and `occStart` both fall back for an
  unrecognised `kind` and their fallbacks **disagree**, so `recurKindKnown` gates the gate. Treating "I
  could not tell" as "hide it" would make legacy data silently vanish from today.
  **Trap when writing fixtures:** `occStart`'s fallback is *weekly*, and it is silent. The valid `kind`
  values are the `RECUR_PRESETS` keys — `day · weekday · week · month · year` — **not** the human labels,
  so a test seeding `kind:'yearly'` gets a weekly series that passes for the wrong reason. Cost a
  debugging round on 2026-08-25.

### How far a repeat reaches, and why there are two horizons

Three horizons exist and they answer different questions. Confusing them produced the 2026-08-25 defect
where a yearly birthday displayed a passed occurrence at 100% with no way back.

| horizon | value | question it answers |
|---|---|---|
| `_horizon` | `max(furthest non-recurring task end + 75d, max recur.until)` | how far the **chart** is drawn |
| `occReach(t)` | `recur.until`, else `today + 366d` | what occurrences the **series** has |
| `nextPendingOcc` | same as `occReach` | what is **owed next** |

`_horizon` is a rendering fact and must never be the last word on a series: a yearly occurrence is ~362
days out, so it usually falls outside `_horizon` entirely, and an expansion bounded by it contains only
occurrences that have already passed. `currentOcc` therefore consults `occReach` before falling back to
`occs[occs.length-1]`, and `toggleDone` consults it for its target so the circle acts on the occurrence
the row is displaying rather than becoming a dead control.

`occReach` is deliberately **not** folded into `_horizon`: that would expand every daily repeat to 366
occurrences into `_occById` on each structural change, to fix a case only yearly rules hit.

Moving the DISPLAY forward hides nothing, and this is the invariant to preserve: `isOverdueBucket`
reports repeats through `hasMissedOcc`, never through `currentOcc`. Pinned by
`tests/owner-2026-08-25-yearly-completion.test.js`, whose load-bearing negative is exactly that.

`recurBeyondLeadToday` caches per paint (`_leadGate`, dropped wherever `_occById` is), because
`nextPendingOcc` expands up to `RECUR_MAX` occurrences and the predicate runs inside per-task-per-day
loops.

**The window also decides supersession, and closing that loop fixed an older bug.** "Last Wednesday's
standup is superseded by next Wednesday's" is true of a weekly rule and false of a yearly one, so
`isOverdueBucket` treats a pending occurrence as superseding only when it is inside the window — *near
enough to supersede* is the same question as *near enough to show*. It also had to stop asking
`isOverdueToday` for the repeat case: that reads `taskDisp` → `currentOcc`, which reports the occurrence
to **display** and therefore skips a missed one, so a yearly renewal three days overdue reported next
year's date and read as on time. `hasMissedOcc` asks the stored occurrences instead. An overdue
occurrence is never gated by the window — that is the standing tenet, and it outranks the noise
reduction the window exists for.

**`toggleDone` on a repeat is a toggle, not a ladder.** It acts on the first occurrence **on or after
today**, completing it or un-completing it. The old behaviour advanced — a second click completed the
NEXT occurrence, which on a yearly series silently marked one twelve months out as done with no way back
but undo. The target is deliberately not `currentOcc`: that skips completed occurrences, so reading the
target from it would walk to next year's the instant this year's was done and hand the fast-forward
straight back. The catch-up branch (clearing every missed occurrence in one click) is unchanged — acting
on more than one is what that click means.

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

### Re-anchoring a recurring series invalidates occurrence-indexed state

`recur.overrides` and `recur.shifts` are keyed by occurrence index relative to `task.start`. If a date
editor moves either base edge onto another calendar day, those indices name different real occurrences,
so both collections are cleared in the same task commit. This prevents an old completion and its history
reservation from transferring to the newly dated first occurrence. A same-day clock-only edit keeps the
collections because it still describes the same occurrence. `recur.until` is retained: it bounds the
series itself and is not occurrence-indexed.

## Indefinite snooze (owner decision, 2026-08-19)

*“Snooze today and take out of today are practically the exact same thing and is therefore useless.”*
`snoozeIndef` is a DATELESS snooze: `snoozeUntil` answers “not until when”, this answers “not until
something happens”. `snoozeWakeReason(t, B, now)` gives the owner’s four wake rungs — an explicit include,
a real start arriving, a due date passing, or the last blocking predecessor completing — and asks “is it
woken”, never “was it woken TODAY”, so a wake missed while the app was closed still fires. A woken task
reads as `new` (today brought it back), not as inherited work.

**Inclusion follows the dates (owner ruling 2026-09-09).** Two rules, and they are separate.

1. **A direct date edit re-derives.** `setDate`, `clearDate`, the picker and the When line all call
   `reDeriveInclusion`, which clears a snooze and an `included===true` that has no explicit provenance.
   `includedExplicit` is the note the owner asked the backend to take, and it is honoured in BOTH
   directions: a task pressed into today by hand keeps its press across any number of date edits. This is
   called from MUTATORS only — a gesture that says "this happens then" — never from a render or a sweep.
2. **The date arriving beats the snooze.** A snooze — dated or indefinite — is cancelled when the task's
   own window OPENS on a day LATER than the one the snooze was set on. `snoozedAt` records that day, and
   without it the rule would defeat itself: putting away a task whose window opens today would wake it in
   the same breath, making the snooze verbs inert on exactly the work people use them on.

`snoozeActive(t, B, now)` is the ONE predicate every surface asks (`isOptedOut`, `inclState`,
`autoIncludedToday`, `onListNow`). It replaced four hand-rolled copies of "snoozeUntil ahead, or
snoozeIndef with no wake" — which is how a dated snooze and an open-ended one came to be answered
differently by different surfaces. The four original wake rungs are unchanged, `hasStartTime` gate
included: dropping that gate would wake an indefinite snooze on any task whose window merely started at
some point in the past, which is nearly all of them.

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

## The five-bucket triage partition (owner decision, 2026-08-20)

The Selection surface files every task into exactly one of five buckets. `ORIGIN_KEYS()` is
`['overdue','new','continued','upcoming','snoozed']` and `originOf(t)` is the only thing that assigns
one. `upcoming` is the exhaustive FALLBACK, the same role `No section` plays, so nothing can fall out of
the view.

The rules, in the order `originOf` applies them:

1. **Overdue outranks everything**, including the departures below. Once work is late, why it arrived
   stopped being the interesting question. This is a stated rule with its own guard, not an accident of
   statement order, and it is what stops the laziest user path from silently dropping a deadline.
   One exception: a REPEAT with a live occurrence still ahead is not overdue — last Wednesday's standup
   is superseded by next Wednesday's, not owed.
2. **Finished work leaves the surface entirely** — `originOf` returns `null` and `selectionProjection`
   drops it. Not greyed in place, not at the next rollover: immediately. A non-recurring task at 100%
   goes; a recurring series whose last occurrence is done goes.
3. **A completed recurring occurrence with more to come lands in `upcoming`.** This is the only case
   where completing something MOVES a task between buckets instead of removing it, because the next
   occurrence genuinely is still ahead.
4. **`onListSince` decides the rest.** Equal to today's key → `new`; earlier → `continued`. The spec
   phrases Continued as "onListSince < today AND included", but a non-null key already *means* on the
   list — that is what `sweepOnListSince` maintains — so the second clause is a restatement, and
   implementing it as one keeps a single definition of "on the list" instead of two that can drift.
   A8c (owner, 2026-08-21): because a passed window no longer clears the key, **a rescued overdue task
   lands in `continued`, not `new`** — it is old work still being carried. `originOf` and
   `sweepOnListSince` both read the overdue rule from `isOverdueBucket` so they cannot disagree about it.
5. Otherwise an active snooze (dated or indefinite) reads `snoozed`, and everything else is `upcoming`.

**The buckets are derived, but they are not untouchable.** The old comment claimed "no user gesture moves
a task between them — only the calendar does", and that is now false: ticking an undated task stamps
`onListSince` and moves it Upcoming → New, and snoozing moves anything to Snoozed. What remains true is
the weaker, useful thing — a bucket is never *assigned*. It is read off state that changes by acting on
the work rather than by filing it.

**Only `overdue` collapses when empty** (`selectionCols`). Every other bucket keeps its place so the
surface has a stable shape, and an empty New is itself information: nothing arrived today.

### What was deleted

`inclusionRow` and `setInclusionRow` are gone. They gave Selection a second, vertical dimension
(Included over Excluded inside each column) and the partition replaces it outright — Snoozed is a bucket
now, and everything else on the surface is on the list by definition. Do not reintroduce a row dimension
there. The SHEET keeps its own Included/Excluded grouping (`groupBy==='inclusion'`), which answers a
different question on a different surface; its predicate is `inclBand`/`setInclBand`, named separately so
it cannot be mistaken for a Selection concept again.

### A known consequence of an observed field

Because `onListSince` is observed rather than derived, a workspace that was closed for a week stamps
TODAY on the first sweep after it reopens, so long-standing work can read as `new` for a day. That is
inherent to observing rather than deriving — the alternative is re-deriving arrival from the window,
which is the rule the owner rejected — and it is why Task 3 ships a one-time backfill for workspaces
that predate the field.

## Appointments never inherit (owner decision, 2026-08-20, spec A2)

`isInheritedToday` returns false for any task where `clockSpanMinutes(t, yesterday) != null`. V2.2
inheritance — "unfinished work that participated yesterday carries into today" — is right for flexible
work and wrong for a fixed booking: yesterday's 09:00 standup does not become today's 09:00 standup by
not having been ticked. An appointment exists on the days its occurrence covers, and on no others.

**The predicate is `clockSpanMinutes`, never `hasStartTime`/`hasEndTime`.** Those two derive a clock from
the timestamp, so "has both clocks" is a strictly wider set than "is an appointment" — it also catches a
three-week task that merely starts and ends at non-midnight instants, which must keep carrying over.
Three separate defects have come from that substitution. `clockSpanMinutes` also refuses a span longer
than a day, which is why a multi-day conference is not caught: Tuesday is *inside* its occurrence, so
inheritance was never what put it on today's list.

**Suppressing is not forgetting.** A missed appointment still reaches Overdue through `originOf`. The
missed-flight case in `tests/owner-2026-08-20-inheritance.test.js` pins this and is deliberately marked
not optional — it is the standing rule that the laziest user path must never silently drop a deadline.

The guard asks about *yesterday*, the day being inherited from. If that occurrence cannot be resolved
(a cold `_occById` memo), `clockSpanMinutes` returns null and the guard does not fire — the safe
direction, leaving the task visible rather than vanishing it.

## "Has a usable window" is not "has two edges" (owner ruling, 2026-08-21)

`isScheduled(t)` is `start != null && end != null`. It was being used for **two different questions** at
once — *does this task have a usable window?* and *does it have both edges?* — and the dateless exclusion
rode on the conflation. Today was the single day in the app decided by a predicate chain that consulted
it; every other day went through `ghostSpan`, which handles a one-edge task correctly. The two paths
therefore disagreed, and the owner saw the disagreement directly: a quick-added `test today` was **absent
from today's list and present on tomorrow's**, `test today at 4pm` appeared on **no day at all**, a daily
repeat **skipped its first day**, and a task with **no date was included while the same task with a date
was not**. Only an explicit clock range like `3pm-4pm` — the one phrasing yielding two edges — worked.
That is the exact inverse of the tenet the predicates exist to serve ("What? Of course it should be auto
included"), and it penalised precisely the users who supplied a date.

The conflation is now split into the two questions it was hiding:

| Helper | Question |
|---|---|
| `hasDate(t)` | Is there **any** real edge? This is the dateless exclusion, and it is still necessary: `ghostSpan` anchors a dateless span at today, so without it every someday pick would trivially qualify. |
| `todayWindow(t, B)` | The window — `isScheduled ? occForDay : ghostSpan`, the same selection `isActiveOn` already uses on every other day. Safe to hand `ghostSpan` a raw `B` here (unlike `isActiveOn`'s other-day branch, which must anchor at the real today) because `B` **is** today in every caller. |

Three call sites carried the old guard and now share these: `autoIncludedToday`, `startsToday`, and
`onListNow`. The third mattered most in practice — its short-circuit made the `ghostSpan` arm of its own
selection unreachable, so `onListSince` was never stamped and `originOf` filed work today had just brought
in under **Upcoming** rather than **New**. A task missing from Included was simultaneously mis-filed in
triage, because both predicates failed together on the same input.

**`ghostStart` replaces `isScheduled` as the "window opened today" test.** A *derived* start edge is not an
opening. Without that clause a deadline-only task, whose ghost start is re-derived at today every day,
would file as New every day until its deadline.

**A typed start clock with no stated end is a keep-clear Point.** Owner ruling 2026-08-21, verbatim:
*"My default task duration for point tasks is wrong. test today at 4pm should be no duration, marker at
4pm in both the schedule and timeline. We should retain the point behaviour."*

This **reverses** a ruling made hours earlier the same day and shipped in `v0.8.0`, which gave such a task
`end = start + DEFAULT_TASK_MINUTES`. Both rulings are recorded because the reversal carries the lesson:
the first was made to answer *"should it be a point or a span to end of day?"*, and the question was
malformed. The observation behind it — that `test today at 4pm` occupied no day — was **not the Point's
fault**. It was the inclusion inversion described above, in `autoIncludedToday` / `startsToday` /
`onListNow`. Fix that, and a Point behaves exactly as designed: auto-included today, drawn as a ◆ marker
on the timeline and in the Schedule view, reserving no minutes while its clock still splits the packer's
free intervals. Inventing a duration was treating the symptom.

So R2/R10 and the chooser's `anchor` candidate emit `end: null`, `endClock: null`. The chooser's third
slot stays empty, now as a **closed decision** rather than a reservation: a duration the user did not type
is not to be invented. `isPointTask`, `keepClearToday`, `pointsToday` and the F3 own-day veto are the
machinery, unchanged throughout; only whether the parser reaches them changed, twice.

A **bare day** (`test today`) is deliberately left one-edged — no duration is invented for a phrase that
named no time. It stays open-ended, and `ghostSpan`'s half-ghost branch carries it forward to the next day
rather than dropping it, which is the shortest-effort tenet and not a residue of this defect.

Pinned in `tests/owner-2026-08-21-auto-inclusion.test.js` and
`tests/e2e/owner-2026-08-21-auto-inclusion.spec.js`; diagnosis in
`docs/superpowers/findings/2026-08-21-parser-inclusion-defects.md`.

## The checkbox is the gesture (owner decision, 2026-08-20, spec A6)

Ticking a task puts it on today. Unticking opens the snooze window. **The asymmetry is the design, not an
inconsistency.**

- **Ticking needs no further information.** "Yes, today" is a complete answer, so `tickOnToday(id)` just
  does it, in one commit: `included = true`, `includedExplicit = true`, any snooze cleared, and
  `onListSince` stamped **if it is null**. Only a null key is stamped — re-ticking work that has been on
  the list for a week must not reset its age, which is the whole point of the field. This also honours
  the 2026-08-12 rule that a click with one possible outcome performs it rather than opening a
  single-item menu, which is a confirmation dialog for a checkbox.
- **Unticking is not a complete answer.** "Not today", "not until Thursday" and "not until it matters"
  differ, and the app cannot choose for the user. `untickOnToday(e, id)` opens the snooze window and
  **writes nothing** until a variant is picked — no optimistic unpress, no placeholder snooze. There is
  nothing to undo because nothing happened.

The `onListSince` stamp is what moves an **undated** task from Upcoming to New: such a task has no window
to observe, so an explicit press is the only evidence it arrived (see `onListNow`).

Keyboard: `space` ticks, and deliberately does not untick — a sweep that opened a popover on every other
press would not be a sweep.

**Retained on purpose: `isUndecided`.** "Never looked at" must not render identically to "decided
against". It now separates Upcoming from Snoozed, and the dashed card edge is the channel that says so.

**Deleted:** the Selection view's vertical-only card drag and the two-row band sizing —
`selectionHalfFlex`, `selectionSplitHeights`, `SEL_CARD_EST_PX`, `SEL_BAND_LABEL_PX`, `SEL_SHRINK_CEIL`,
`SEL_HALF_MIN_PX`, plus their unit and e2e tests. This first left `planCard` attaching a drag only when
handed a `zone`, with the Matrix as the last caller that passed one. **A8b (owner, 2026-08-21) deleted the
rest:** the Matrix surface, the Eisenhower axes, and the whole shared chain `cardPointerDown` →
`beginCardDrag` → `resolveCardZone` → the `onMouseUp` drop branch. `planCard` has no `zone` parameter at
all now, and no surface in the app starts a card drag.


## What "split" means (owner 2026-08-20, Task 22)

The ⧉ regroup control exists to rejoin work the day has **split**. Its gate used to be
`data.chunks.filter(x => x.id === c.id).length > 1`, which counts CHUNKS. Task 21 found that a partial
drag-pin and the packed remainder abut — two chunks, zero gap, one continuous bar — so the control was
offered on work that was never apart. The mechanism: `buildDayTimeline`'s same-id merge runs over the
packer's `segs`, and the pinned and fixed pieces are appended afterwards by `busy.forEach`, so nothing
merges across that boundary. The merge is not wrong; it runs before half its input exists.

`chunkPieces(chunks, id, kcMs)` is the answer: a pure fold of same-id chunks wherever they touch or
overlap, and the gate counts ITS output. "Is this task split" now means "are there pieces the user can
see are apart".

**The fold is for counting, not for rendering** — a deliberate correction to the plan's wording, made
because two established rules said otherwise. `fixedBlocksToday` emits one block per PIN RECORD, and the
✕ unpin control is per block; folding a pinned piece into a packed one would leave the user unable to
unpin minutes they had placed by hand, and would make a bar carrying two pins report one. Tests 18 and
20 in `tests/scheduling.gen.test.js` encode that render rule and still pass untouched.

`kcMs` are keep-clear instants — a Point's clock. A run split there is split on purpose ("no work crosses
this moment"), so the fold must never undo it.
