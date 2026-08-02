# Scheduling

`computeAllotted` calculates planned minutes over active working intervals. `dayIntervals` subtracts
fixed blocks, meals, breaks, and point keep-clear boundaries. `buildDayTimeline` packs the daily timeline
and supplies its day-specific allotment map during synchronous rendering.

S1 keeps both future learning hooks behind pure seams. `compressionSeam(features, availableMinutes)` is
the default linear/proportional-by-planned allocator, including today's spent time and manual Predict
overrides. `orderingSeam(features)` is the default priority, earliest-deadline, then longer-first order.
Both receive feature records without mutating them, so a later learned implementation can use priority,
urgency, slack, labels, or other task fields without changing scheduling callers.

`autoSchedule` and `computeCPM`/`computeSlack` handle dependency-driven scheduling and critical path.
Scheduling shapes are derived from dates, planned duration, and whether each edge has a user-entered clock.
The unrelated manual drag-pin `{day,start,dur}` remains. Dates are epoch milliseconds; all durations are
minutes.

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

Point discrimination is structural: `end:null` plus a clocked start and zero planned minutes. There is no
separate end-pin sentinel. `keepClearToday` supplies the same sorted Point instants to allotment and packing,
and the render merge step preserves a split whose shared boundary is a Point.

Recurrence uses `expandTask` and `rruleToRecur`. Recurring occurrences are derived; changes must preserve
series semantics and recurrence limit/backoff protections.

Current invariants:

- Archived and opted-out tasks do not allot or render as active work.
- Point tasks reserve no duration but split allocatable runs at their clock.
- Fixed tasks pass both the same-day and at-most-one-day guards.
- Ghost draw width may depend on zoom; scheduling span must not.
- Manual movement/resize remains undoable through `commit()`.
- Keep helpers pure and test them through `tests/_load.js` where possible.
