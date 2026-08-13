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
Schedule chips):** a click without a drag opens details; dragging pins THAT block — only the dragged chunk
follows the cursor, only its own minutes are pinned, and its ✕ unpins just that block. **Double-click never
opens details anywhere** — bars and blocks route their no-drag click through the existing mouseup branch, so
one gesture cannot both drag and open. The inclusion popover on the row status glyph is strictly
inclusion/exclusion and carries no time-tracking action.

Two mechanics that gesture map depends on, both fixed 2026-08-12 after the e2e layer caught them:

- **The row's double-click does NOT come from the browser's `dblclick`.** The first click opens the
  detail modal — a `position:fixed; inset:0` scrim with a large centred card — so the second press lands
  on the overlay, not the row. The click target changes mid-sequence, Chromium resets its click count,
  and `dblclick` is never synthesised on the row. So `rowClick` records `{id, t, x, y}` in `_rowDblTag`
  and the modal's scrim AND card both run `detailDblFollowUp`, which consumes a one-shot press within
  `ROW_DBLCLICK_MS` (400) and `ROW_DBLCLICK_PX` (6): it closes the detail and activates the task.
  `rowDblClick` remains wired and still fires wherever no modal intervened; both routes share
  `activateFromGesture`. Anything new that opens an overlay on a single click inherits this problem.
- **Every drag starter is primary-button only.** `startBarDrag` had no `e.button` guard, so a right press
  began a bar drag whose zero-distance release was read as a click: right-clicking a bar opened the
  detail panel instead of the bar menu, and `preventDefault` swallowed the context menu. `startBarDrag`,
  `startLink`, `startSplit` and `startColDrag` now return on any non-primary button, joining
  `rowPointerDown`, `headPointerDown`, `secPointerDown`, `cardPointerDown`, `blockPointerDown` and
  `edgePointerDown`, which already did. A mousedown handler that calls `preventDefault` must guard.

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
what carries onto today via `isActiveOn` — so only the paint was deleted. Selection, critical-path inset,
and day-hover glow stay.

**2026-08-12 — the PRESSED depth is deleted too; only ACTIVE depth remains.** V2.1 made inclusion a depth
channel and V2.9 left it as "the only visual the inclusion model has". On a real workspace most rows are
included, so the inset shadow meant to mark a state became the sheet's background texture, competing with
striping, hover and selection. Inclusion is now read from `taskInclControl`'s explicit ☑/☐/💤/▶ glyph.
Active depth is kept deliberately: it marks the running timer — transient, single-row, and not something
the inclusion glyph duplicates. The sheet row and `planCard` share this channel (V2.11 parity), so both
changed together. The generalisation, which the hatch already demonstrated once: **an ambient channel can
only encode a rare state; a state most rows hold needs an explicit per-row mark.**

**Inclusion click rule (2026-08-12).** Clicking the glyph on an **unpressed** row includes it directly —
that state's popover held exactly one action, making it a confirmation dialog attached to a checkbox. The
popover still opens for pressed/active/snoozed, which offer real alternatives (snooze today, snooze
until…, take out of today). The rule is: *a click with one possible outcome performs it; a click with
several opens the menu.* Both paths go through the same mutators, so undo is identical either way.

**Milestone ⇄ task (2026-08-12).** `setType`/`setTypeMulti` are reachable from three surfaces — the row
menu (`renderMenu`), the Gantt bar menu (`renderBarMenu`, where point-vs-span is the menu's own remit),
and the detail panel's **Type** field. The conversion writes **only** `type`: a milestone draws as a
diamond at its start and its `end` is never read, so collapsing the span would destroy the due date for
no rendering benefit and make the round trip lossy. `allMilestones(ids)` drives the label so it cannot
disagree with the action on a mixed selection.

**Row-menu ↔ detail-panel parity (2026-08-12).** Everything in the row menu is reachable from the detail
panel. The panel previously lacked type, section, duplicate, archive and delete. All five call the
existing mutators rather than reimplementing — load-bearing for `deleteMulti`, which routes a recurring
delete to the scope prompt instead of guessing which occurrences were meant. Parity is by shared mutator,
not by two renderers that happen to agree (the drift this repo has already paid for twice).

The Dashboard has four tabs (`dashMode`): **Overview · Plan · Focus · Review**. Overview
(`renderDashOverview`) is the sheet + Gantt split and owns the six scheduling views via `state.planView`;
**Plan** (`renderDashPlan`, V2.10) owns Selection and Matrix via `state.planTab`. The split is a statement
about what each surface answers: the six Overview views place work **in time**, the two Plan views decide
**what is in today**. Before V2.10 all eight sat in one toggle, which read as "pick one instead of the
others" rather than "decide, then place".

Both tabs render their sub-view selector through `renderFilterBar`'s leading slot, so the same chips and
sort narrow every surface. `dashMode` and `planView` both survived a meaning change in V2.10 and are read
through the pure `migrateDashMode` / `migratePlanView` helpers, never raw: `'plan'` named the scheduling
board before the rename and the selection surface after it (disambiguated by a `dashModeV: 2` stamp), and
`planView` may still hold `'select'`/`'matrix'`, which have left that enum. Both failures land a returning
user on a surface they never chose, without erroring — hence the named helpers and their tests.

**Selection** is a 3×2 grid of derived origin columns (`originOf`: existing/new/extra) by inclusion rows;
**Matrix** is an Eisenhower grid whose urgency axis is derived from dates while importance is read from
`priority`. Both render `planCard` and share one card-drag path; the drop zone string encodes only the
target row/half, so sideways movement is structurally a no-op rather than a suppressed gesture.
`unpressed` renders visibly distinct (dashed edge) so undecided work is never displayed as decided work.

**V2.11 — the cards ARE the row.** Ten shared builders (`taskDisp`, `taskDoneCircle`, `taskDueRecurChip`,
`taskInlineTags`, `taskDepChips`, `taskInclControl`, `taskFlowCell`, `taskTimerBtn`, `taskAddTimeBtn`,
`taskDescToggle`) are the single definition of every list-row control, and both `renderSheet`'s row and
`planCard` call them, so parity holds by construction rather than by two copies agreeing. Cards carry the
row's gestures too (click → details, double-click → activate, right-click → row menu) while mousedown
still arms the card drag. Two things stay sheet-only on purpose: the **row-drag grip** and the **subtask
caret** — in the sheet a drag reorders and re-nests, on a card it includes/excludes, and one gesture
cannot mean both. The card's description panel uses `state.cardDescOpen`, never `state.descOpen`,
because the sheet's panel is measured (`observeDescPanel` → `_descH` → `yOfRow`) to offset the Gantt's
rows — a card sharing that state would silently shift bars.

**Inclusion is four states, not five.** V2.11 retired `off` (`included===false`): `setIncludedOff` writes
`null`, and snoozes until tomorrow **exactly when `isInheritedToday` would otherwise re-include the task
on the spot** — without that branch, unpressing carried-over work would be a silent no-op. Snooze means
"not today"; unpressed means "not chosen". The one-time `retire-off` migration folds surviving `false`
into `null`. Consequence: nothing vetoes V2.2 inheritance any more, so mid-window work can no longer
reach the Extra column.

**Origin columns** are `overdue | existing | new | extra`. `overdue` outranks every other rule and its
column renders only while occupied; `new` admits both a window that opened today and a snooze that ended
today (`snoozeEndedToday`, read off `snoozeUntil`, which is never cleared on expiry). `rescheduleToToday`
is the Overdue card's `→ Today` control — per card, never per column, because a bulk date rewrite is the
same lossy gesture the Matrix drag rules already refuse.

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
control is an upward caret below the bar, not a circle inside it. The timeline block's unpin ✕ and regroup ⧉
follow the same rule: the glyph stays 16px inside a transparent `HIT_MIN_PX`-wide, full-height hit column at
the block's left edge, and the block's left padding clears that column so the title never shares its pixels.

A block drag in flight outranks every overlay in `onKey`'s Escape chain: Escape drops `_blockDrag` (or
`_edgeDrag`), the block repaints at its real start and size, and the release that follows falls through
`onMouseUp` without writing — so a cancelled drag commits nothing and leaves nothing to undo. Both drags'
px→minutes conversion runs through `uiPt`, because `e.clientY` is viewport px while `_curColPx` is
px-per-minute in the zoomed subtree's local space; without it the block travelled `uiScale`× the pointer's
distance. Both use the same 4px raw promotion threshold.

A block's **body** and its bottom **edge** are two gestures (V4.2): the body repositions (drag-pin), the edge
resizes the task's allotted minutes. They must be distinguishable *before* the press, so the edge handle
carries `cursor:ns-resize` against the body's `grab`, a visible 26×3 grip, and its own tooltip. Per the
hit-target tenet the grip is not the target: the target is a full-width `HIT_MIN_PX`-tall strip
(`data-tl-edge`, `data-tl-edge-task`) at the block's bottom, inset past the ✕/⧉ column when one is present so
it can never steal that control's bottom corner. The handle is rendered only on blocks at least
`EDGE_MIN_BLOCK_PX` (3×`HIT_MIN_PX`) tall, which leaves the body a target twice the handle's size and makes a
press in a block's upper half unambiguously a body-drag; shorter blocks are body-drag only and are resized
from the sheet's Predict column instead. The handle stops propagation, so `_blockDrag` and `_edgeDrag` are
mutually exclusive by construction rather than by precedence.

V4.3 adds a **Reset ↺** control and a snap-back cue. The left edge of a block is now a *column* of
`HIT_MIN_PX` slots rather than one fixed position: ✕ (unpin), ⧉ (regroup) and ↺ (reset) each take a slot,
and both the block's left padding and the edge handle's inset follow the slot **count**. ↺
(`data-tl-reset`, `data-tl-reset-task`) is offered only on a block whose task carries a manual allotment —
a pin-only override already has the ✕, and two adjacent controls doing the same thing is worse than one.
While a drag sits on the priority snap-to-original the block is **ringed** instead of shadowed, because
"let go here and this goes back to being the app's decision" is otherwise invisible before the release.

Every child of a block now carries a **stable key**. The left controls are a spread array whose length
changes as ↺ appears, and React reconciles keyless siblings by *position*: without keys the ▶ timer's
handler ended up on a DOM node that had shifted under the pointer, so the click after a resize started a
timer on the task just resized — which, being the active task, was then pulled to `now` and fell out of
the day. Any future block child must be keyed for the same reason.

The multi-day grid (V4.1) is `renderMultiDayView` over N `renderDayColumn`s that share one hour gutter and
one vertical scroll. Each column carries `data-tl-col` (its day, epoch-ms midnight) and `data-tl-today`;
weekend columns are tinted and today's is accent-washed, and the day header shows the month on the first
column and wherever a month turns over, so a straddling week still says which month each half is in. Inside
a column the hours are readable without labels: an alternating band per hour plus a stronger line every
sixth hour, both `pointerEvents:none` so neither can intercept a block drag, with each band painted before
its own hour line.

Blocks distinguish **locked** from **auto-scheduled** by marking the RARE case (V5 block 25b). A
clock-fixed or hand-pinned block carries a `TL_LOCK_BORDER_PX` border in `--tl-lock-border` and a solid
inset left rail; everything the app placed carries `TL_BLK_BORDER_PX`. The signal is border **width**
first, so it survives greyscale, and the 📌/📍 glyphs remain the non-colour channel on top of that.
V5 block 25a **deleted** the diagonal hatch that used to mark auto-scheduled blocks, along with
`--tl-hatch`: nearly everything is auto-scheduled, so the texture covered ~90% of the week and carried no
information — the same measurement that retired `ambientRowBackground` in V2.9.

**Block colour has exactly one source** (V5 block 25c, `tlSurface()` — `TL_TYP()`'s four per-kind
families are retired). A task block is filled with the task's own `PCOL[priority]`, the identical map the
month calendar's chips, the sheet and the Gantt read, mixed into the near-neutral per-theme
`--tl-fill-base`; the theme contributes tone only, which is why a block's hue is the same in both themes.
There is deliberately no timeline-only palette, and `tests/e2e/block-colour.spec.js` proves the timeline
and the month calendar agree on the hue for the same task. The `dayIntervals` clock windows (Lunch,
Dinner, Free time) are settings rather than work and take no hue at all: `--tl-win-*` gives them a bare
wash inside a dashed outline, no rail and no timer, so they read as the shape of the day.

Every block carries `data-tl-block`,
`data-tl-day` (the column's day), `data-tl-kind` (`auto` · `pinned` · `fixed` · `meal`) and `data-tl-task`.
Those hooks are the supported way for tests to address a block — the e2e layer previously matched three
tooltip **strings**, so a copy change read as a gesture regression.

**Overlapping blocks** are laid out by `overlapLayout(list, px)` — pure, `tests/overlap.test.js`. The owner
spec (2026-08-06, Google Calendar as the reference) is *"side by side if the titles will overlap (50/50),
offset otherwise (~90/10), recursively defined for >2 tasks"*, and the rule is: group blocks into clusters
(connected components under time intersection — abutting is **not** intersection, so an ordinary packed day
is untouched), sort each cluster by start, and run every block from its own left edge to the cluster's
**right** edge with the later block on top. Only the left edge moves; each step is a fraction of the
**remaining** width — `OVERLAP_STEP_TITLE` (0.5) when the next block's top falls inside the current one's
top `TITLE_BAND_PX`, `OVERLAP_STEP_OFFSET` (0.1) when it does not. Three or more blocks fall out of the same
recursion with no special case. The title-band test is a **pixel** test, so the same pair can legitimately
read 50/50 zoomed out and 90/10 fitted. The renderer takes the returned fraction as a `calc()` left edge
(the band's px insets stay exact at any column width, which is what makes it hold in the narrow 4-Day/Week
columns), publishes it as `data-tl-ov`, and stacks by `z` clamped to `OVERLAP_MAX_Z` so a cluster can never
paint over the Points (4) or now-line (5) layers. Overlap only exists between things the **user** placed —
clock-fixed events, hand pins, meals — because the packer never lays two flexible chunks over each other.

The Today drawer's vertical **zoom is a two-level toggle** (V4.4): `DRAWER_ZOOM_FIT` (1 — the whole day
fitted to the pane) ⇄ `DRAWER_ZOOM_EXPANDED` (3 — the body outgrows the pane and the drawer's
`overflow:auto` wrapper scrolls). It replaces Track B Group 2's ＋/－ incremental stepping, whose
`DRAWER_ZOOM_MIN`/`MAX`/`STEP` are retired. Two pure helpers own the mapping —
`drawerZoomFactor(expanded)` and `drawerZoomIsExpanded(zoom)` — and `renderDayColumn` **snaps**
`opts.zoom` through them rather than clamping it into a range, so any value that is not exactly the
expanded level renders as fit and no third scale can exist. `toggleDrawerZoom` is the whole state
transition. The level stays **session-only** in the instance field `_drawerZoom` (owner, 2026-07-22): it
is never React state and never a `pp-*` key, so a reload is fitted again. The control is one
`HIT_MIN_PX`-square target carrying `data-tl-zoom` (`fit` | `expanded`). It belongs to the **day drawer
only** — the 4-Day/Week columns pass no `zoom` and therefore always render fitted.

Because the drag's px→minute conversion reads the scale the column rendered at (`_curColPx` → `bd.px`,
after `uiPt`), changing the level changes that conversion; a body-drag lands on the same minute at both
levels, and `tests/e2e/drawer-zoom.spec.js` holds that at the non-default level specifically.

Tests mount the component in a Node VM with mocked runtime/storage. Browser QA uses localhost.
