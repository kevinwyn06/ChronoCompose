# UI and runtime

`index.html` contains the application and Design document. Never read it wholesale: locate a method or
`PP-EXT` marker with `rg`, then inspect a bounded range. `support.js` is opaque and must not be edited.
`Project Planner.dc.html` and its baseline are required three-way Design-sync artifacts.

Primary views include Gantt, Day/4-Day/Week/Month calendars, Today/Schedule, Focus, Review, Settings,
Archive, habits, and journal. Shared state keys and Design `{{ }}` placeholders retain their names.

Overlay coordinates pass through measured UI-scale helpers because the app runs under a scaled wrapper.
Gantt and sheet rows share explicit height/box-model rules; visible structural changes require a Design
push after implementation. Timers persist in `pp-run`; Pomodoro state is ephemeral in `pp-pomo`.

Pointer gestures (owner-set 2026-08-04). **Sheet row:** single click selects and opens the detail panel;
ctrl/cmd-click toggles selection; shift-click selects a range; **double-click makes the task active**;
right-click opens the row context menu. **Gantt bar, milestone, and collapsed recurrence strip:** a click
without a drag opens details; dragging the body moves it, dragging an edge sets a date, a no-drag click on
an edge opens the date picker; right-click opens the bar menu. **Scheduled block (Today timeline and
Schedule chips):** a click without a drag opens details; dragging pins it to a time. **Double-click never
opens details anywhere** — bars and blocks route their no-drag click through the existing mouseup branch, so
one gesture cannot both drag and open. The inclusion popover on the row status glyph is strictly
inclusion/exclusion and carries no time-tracking action.

Timer concurrency is one policy in one place (V2.4). `settings.multitask` defaults to **false**, and
`startTimer` calls `stopOtherTimers` before starting, so every surface that starts a timer — sheet row,
Focus row, timeline block, Pomodoro, shape-driven auto-start — inherits the strict single-timer rule
without its own branch. Turning the setting on restores concurrency. `activateTask(id)` is the separate
"make this the active task" path: it stops only the **prior active** timer, leaving independently-started
multitask timers alone. The active task is still *derived* (`activeTaskId()` = the most recent start in
`pp-run`), so activation persists with no new field, and V2.1's ordering seam plus `notBefore` clamp
already place it at the current time.

The V2.3 sheet is a uniform task list rather than a field grid. Each normal row contains priority/done,
task name, removable `@tag` chips plus an inline `@` input, the due/recur chip, a `planned → allotted`
readout, and inclusion/timer/add-time actions. Start, Due, and % Done remain Gantt-owned. The due/recur chip
uses separate overdue, today, tomorrow, within-one-week, and later buckets; recurrence follows the date
behind a `↻` glyph.

Sections are a first-class `pp-sections` entity (`{id,name,order}`) plus `task.sectionId` (V2.6); the V2.3
`tasksByTagSection` tag-derived grouping is retired, because a tag is a non-exclusive attribute and a
section is an exclusive container. `tasksBySection` groups each task exactly once; subtasks inherit their
root task's section so a subtree is never torn apart. Section order follows `order` ascending, ties broken
by id; the `No section` bucket always renders last and is not a thing anyone made — it cannot be renamed,
reordered, deleted, or dragged.

`sectionProjection` is the single projection **both panes consume**, which is what keeps sheet and Gantt
rows aligned by construction rather than by two call sites agreeing. It has three `Group by` modes:
`section`, `inclusion` (V2.9), and `none` (one flat, header-less band). `inclusionProjection` emits the
same band shape, so the inclusion division is a sibling grouping mode rather than a level above sections —
nesting it above would render a section holding both included and excluded work twice. `sectionGeometry`
is the one vertical-geometry pass, returning `_yTop` (indexed by the flattened task list) **and**
`_secLayout` (each band's full extent); the second exists because `_yTop` cannot answer "which section
owns this Y", and an empty band owns Y-space but no row. `sectionAtY` resolves a drop into a band,
including an empty or collapsed one. A row drag re-sections **or** re-includes inside the same `commit()`
as the reorder, so one drag is one undo step. `TAG_SECTION_H` is consumed by matching sheet headers and
Gantt rails, and Gantt `_yTop` continues to index tasks only. Normal and milestone task rows retain the
same fixed row height; expanded description height is still measured into the Gantt Y offsets. Focus uses
the same sections and uniform 52px task rows with `spent / allotted`, a progress fill, done, timer, and
`+15` tracked-time actions.

V2.9 removed the V2.2 ambient row encodings (`ambientRowBackground`: the ineligibility crosshatch and the
carried-over tint). The predicates behind them remain and are load-bearing — `isInheritedToday` decides
what carries onto today via `isActiveOn` — so only the paint was deleted. V2.1 pressed/active depth,
selection, critical-path inset, and day-hover glow all stay.

Two full-width Plan sub-views join the six scheduling views (`isFullPlanView`): **Selection**, a 3×2 grid
of derived origin columns (`originOf`: existing/new/extra) by inclusion rows, and **Matrix**, an Eisenhower
grid whose urgency axis is derived from dates while importance is read from `priority`. Both render
`planCard` and share one card-drag path; the drop zone string encodes only the target row/half, so
sideways movement is structurally a no-op rather than a suppressed gesture. `unpressed` renders visibly
distinct from `off` (dashed edge) so undecided work is never displayed as rejected work.

Drags that must also place a text caret — sheet row, section header, column reorder — cannot call
`preventDefault` on mousedown, so text-selection suppression happens at **drag begin** instead: a
`pp-dragging` class on the board root (never `document.body`, so Journal prose stays copyable) plus
`getSelection().removeAllRanges()` to clear what was highlighted before the threshold. The CSS carves out
`input`, `textarea`, and `[contenteditable]` because `user-select` inherits. The class is released in
exactly one place — the top of `onMouseUp`, above every returning branch — plus a window-blur guard.

Every Gantt element layered above a row stripe owns its own `state.hoverId` enter/leave lifecycle. The bar
wrapper contains the right-side dependency handle, so moving onto the handle cannot clear hover. Collapsed
recurrence strips follow the same rule. Milestones own hover only for row/day glow and deliberately expose
no dependency handle. Bar handles use separate glyph and hit-box sizes: `HIT_MIN_PX` is 24; the %-done
control is an upward caret below the bar, not a circle inside it.

Tests mount the component in a Node VM with mocked runtime/storage. Browser QA uses localhost.
