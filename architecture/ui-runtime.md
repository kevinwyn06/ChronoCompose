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

The projection may group a globally interleaved persisted task array, so a row-drop gap cannot be applied
by blindly anchoring on the projection's next task. `reorderRows` translates a re-section drop through the
target band: it anchors before the next row in that band when one exists, otherwise after the band's last
persisted row. That same fallback makes collapsed populated bands append after their hidden rows; empty
bands simply receive their first row.

**Single-row hiding is task state, not a view filter (Block 49).** Right-clicking an ordinary sheet row
offers `Hide row`, which commits mirrored `rowHidden:true`. The task remains in the persisted array at the
same position; it is not archived, deleted, excluded, or removed from scheduling/Calendar reconciliation.
After the normal grouping/sorting/filter projection, consecutive hidden tasks collapse into one 20px
Excel-like seam with a truthful count and a `Show` action that restores the whole run in one commit.
The same structural height is reserved in the Gantt, while hidden tasks leave the flattened task/bar list,
so pane alignment and drag insertion geometry remain shared. Section collapse still owns the entire band;
ordinary filters may temporarily omit a hidden task just as they omit a visible one, and clearing the
filter exposes its marker again. Keyboard row navigation skips hidden rows.

The section-header band is painted from per-theme `--sec-head-bg` / `--sec-head-border` (owner
2026-08-13b), in **both** panes, opaque in both. It previously painted `--top-bg`, which is four units
from `--sheet-bg` in the dark theme and *identical* to it in the light theme, so the header was carried
entirely by a hairline; the flex-grown 1px rule that ran from the task count to the ▲▼✕ controls is
deleted, and only its spacer survives to keep those controls right-aligned. The tokens are per theme
deliberately — one shared rgba is the 2026-08-12 ghost-contrast defect. Measured against the painted task
row: **dark 1.222:1** (`rgb(43,44,49)` vs `rgb(28,28,29)`), **light 1.171:1** (`rgb(238,237,234)` vs
white). Nothing about the band's height or padding changed, so `sectionGeometry` is untouched and the
sheet↔Gantt row-top delta is unmoved at **0.0156px** (identical before and after the change).

V2.9 removed the V2.2 ambient row encodings (`ambientRowBackground`: the ineligibility crosshatch and the
carried-over tint). The predicates behind them remain and are load-bearing — `isInheritedToday` decides
what carries onto today via `isActiveOn` — so only the paint was deleted. Selection, critical-path inset,
and day-hover glow stay.

**2026-08-12 — the PRESSED depth is deleted too; only ACTIVE depth remains.** V2.1 made inclusion a depth
channel and V2.9 left it as "the only visual the inclusion model has". On a real workspace most rows are
included, so the inset shadow meant to mark a state became the sheet's background texture, competing with
striping, hover and selection. Inclusion is now read from `taskInclControl`'s explicit ☑/☐/💤/▶ glyph.
Active depth was kept at the time, on the argument that it marks the running timer — transient,
single-row, and not something the inclusion glyph duplicates. The sheet row and `planCard` share this
channel (V2.11 parity), so both changed together. The generalisation, which the hatch already
demonstrated once: **an ambient channel can only encode a rare state; a state most rows hold needs an
explicit per-row mark.**

**2026-08-13 — ACTIVE depth is deleted as well, and the row now has no ambient state paint at all.**
Owner: *"When a task has its timer running, do not highlight that task, just let the pause/play indicator
do the work."* The 2026-08-12 exemption compared the wrong two things: it asked whether the *inclusion
checkbox* duplicated "running" (it does not) instead of whether anything on the row did. `taskTimerBtn`
does — same row, ■ while running and ▶ while stopped, and it is the control the user actually clicks. So
the accent ring and the accent background wash are both gone from `sheetRow` and `planCard`, and a row's
background is now only selection, hover, or striping. `inclState` still returns `'active'`: the bucket
feeds the popover copy and V2.1's `orderingSeam`, and only stopped being a paint channel. The rule this
settles: **a state that already has a dedicated per-row control does not also get an ambient channel** —
the ambient one is the redundant copy, regardless of how rare the state is.

### Gantt bar legend

**Five** independent channels stack on one bar. The owner's 2026-08-13 note that there is *"way too much
visual information to decode intuitively"* has been answered twice since: critical path became a
default-off toggle, and the whole **in-today** channel was deleted outright (see below). One channel was
added back on 2026-08-14 for the reason given next. Recorded here because nothing else states them
together. Chain 6 removes the final recurrence hatch: consecutive occurrence days now merge into the
same plain rounded bar used by an ordinary multi-day task.

**Why one was added on 2026-08-14, against that note.** Dependency scheduling now propagates from a
task's *effective* end, so a bar can move **on its own** as days pass with its predecessor unfinished (see
`scheduling.md`). Unmarked, that is a silent background rewrite of the user's plan — strictly worse than
one more channel. The treatment is deliberately a **shape no other channel uses**: it draws *below* the
bar, where nothing else draws, so it cannot be confused with the remaining −45° recurrence hatch, and it is
on the one axis (vertical position relative to the bar) the legend had left free.

| Channel | Look | Meaning |
|---|---|---|
| Shape | Rounded rectangle | Ordinary task; whole-day width = inclusive start day → inclusive due day |
| | Diamond (45° square) | Milestone (`type`); hollow = open, filled = done |
| Fill | Red (`--danger`) | On the critical path — **off by default**, see below |
| | **Green (`--success-strong`) from the left edge to `pct%`** | % done. A 100% bar is green edge to edge; a 0% bar has no green at all |
| | Accent | The remainder. **Not** priority and **not** tag |
| Displaced | **Dashed `--warn` rule under the bar's full width** + a `»` glyph at its left | `autoSchedule` moved this bar forward because a predecessor is **overdue and unfinished** — not because the user dragged it. Tooltip names the amount: *"pushed Nd by an overdue predecessor"*. Driven by `_schedDisplaced` |
| Transient | 2px `--bar-ring` | Selected |
| | Warm row wash | A day is hovered in a calendar view |
| | **3px `--danger` rule at the bar's left edge, full ROW height** | Dependency barrier: this drag is pressed against the predecessor's end and will go no further. Exists only while the button is held |

**Gantt geometry is date-only (Chain 6 block 43).** Clock time never shifts a bar inside its day: a
clocked appointment and an all-day task on the same date occupy the same whole column, and dragging snaps
to whole days at every zoom. Day indexes, headers, window bounds, previews and committed edits all use
local civil-date ordinals plus local-calendar `setDate` addition, never elapsed `86400000`-millisecond
buckets. Thus Vancouver's 23-hour spring-forward and 25-hour fall-back dates each occupy exactly one
column, and moving a clocked task across either boundary preserves its clock time. Recurrence scope edits
use the same rule; new subsequent-series shifts store a civil `days` count while old `offset` entries
remain readable. A start-only task continues to the right and an end-only task continues to
the left. Those open edges clamp to `ganttVWin` rather than to invented far-away timestamps, so horizontal
scroll and zoom recompute the fill while `ghostSpan` remains unchanged as a finite scheduling predicate.
Because `ganttVWin.d1` is exclusive, a start-only bar's editable right-edge origin is `d1 - 1`, the last
inclusive painted date; this keeps a one-column left edge drag visually and persistently identical.
A task with neither date draws no Gantt bar.

**The Hour zoom is retired (Chain 6 block 47).** Continuous Ctrl/Cmd-wheel scaling remains, but its
semantic label has exactly three values — Month, Week, Day — and even the widest Day scale draws only day
boundaries and date headers. There are no intra-day gridlines or hour ticks; time-of-day belongs to the
timeline and the Start/End sheet columns.

**Recurring paint is day-run based (Chain 6 block 44).** A pure projection groups occurrences whose
start dates occupy consecutive local calendar days, then renders each group as an ordinary solid bar
from the first occurrence start through the last occurrence end. Daily repeats therefore form one
continuous run; weekday repeats form Monday–Friday runs separated by weekend gaps; weekly repeats remain
separate. This is independent of zoom and has no hatch or repeat chip. `recurTooDense` and
`ganttRecurStrip` are deleted rather than retained as a second density rule. The merge is paint-only:
stored recurrence, overrides, and `ghostSpan` scheduling semantics are unchanged.

The merged bar is also one **interaction unit**. Its projection carries the member occurrence indexes
and the true first/last occurrence bounds; it never silently borrows only the first occurrence identity.
Dragging the body previews and commits the same civil-day shift to every member. The left resize grip
edits only the first occurrence's start boundary, and the right grip edits only the last occurrence's end
boundary. The recurrence scope dialog therefore says **This run** for a merged bar; **All occurrences**
retains its series-wide meaning. A run edit is one `commit()` and consequently one undo entry.

**Progress is a Fill value, not a separate channel (2026-08-15).** It used to be its own row — a flat
`rgba(255,255,255,0.28)` veil over the bar body — and the owner could not read it: *"the contrast is not
high enough on the left and right of the percent complete bar, especially for ghost bars which already
have a gradient."* Two independent reasons it failed. A ghost's base is already dissolving to transparent,
so a translucent white laid over it has almost nothing to lighten and the two halves of the bar converge;
and the `rgba` was hardcoded, so light mode inherited a value tuned in dark.

The done portion is now `--success-strong` and the remainder is the task's base colour, which **removes a
channel rather than adding one**: green already meant "100% done" as a Fill value, and under this rule a
100% bar is entirely green by construction, so the special case and its legend row both disappear. Both
extremes coincide with a bar edge — the highest-contrast line on the chart — so neither needs a special
case. What it costs, stated plainly: a green bar no longer means *finished* unless it is green edge to
edge.

`pctFillPaint(pct)` is pure — percentage in, `{width, background}` or `null` out. Chain 6 block 47
retired the ghost-specific masks, so the green done portion and accent remainder are both solid regardless
of which date edges are present.

The in-bar `n%` readout is unchanged (white with a text shadow, its own contrast rather than either
fill's), as are the on-bar grab band, `pctGrabZone`, the caret below the bar, and `PCT_GRAB_PX` /
`BAR_GRIP_PX` / `PCT_LABEL_MIN_W`.

### The `Time needed` column

Owner, 2026-08-17: *"I wanted it as a column, not as something inside the detail panel."* `colDefs()`
carries `{k:'exact', w:104, l:'Time needed'}`, visible by default, between `% Done` and `actions`, and
At introduction, `name` was trimmed 354 → 250 so the **pixel total stayed 730**. Block 45 later divides
140px of that name width between the returning Start and End columns, preserving the same 730px total.
Block 46 subsequently replaced the permanent first-run floor with the draggable, last-column clamp below.

The cell shows `isUncompressable(t)` — the *resolved* value — so a never-decided task reads its answer off
its own clocks and changes when they do. Decided and derived are drawn differently on purpose (solid chip
vs faint italic), the same distinction the Planned column draws between `—` and `0:00`. Clicking toggles
through `setUncompressable`, the one mutator the detail panel's control also uses, so the two surfaces
cannot drift. Sorting is a `bool` key on the resolved value.

**The hit target is the chip, not the cell**, and that is a correction the e2e layer forced: a row-wide
toggle meant clicking the *centre of a row* stopped opening the task, because adding a column moved the
row's midpoint into this cell. `% Done` earns its full-cell surface because position along it *encodes*
the value; a two-state chip encodes nothing, so it takes a `HIT_MIN_PX` chip and leaves the rest of the
cell to `rowClick`.

Row cells carry **`data-cellk`** — deliberately not `data-colk`, which is the *header* cell's identity
(the reorder hit test walks up to it, the width spec selects it). It exists so a spec can address a cell by
column instead of doing arithmetic on the row's box; five specs used to click a row's geometric centre and
so silently depended on which column the current widths put there.

### The `Start` and `End` columns

Chain 6 block 45 reverses V2.3 for these two fields only. `colDefs()` carries ordinary, visible-by-default
`start` and `end` entries, so the existing column machinery supplies hide, reorder, resize and reset with
no date-specific preference path. Both cells are 70px and `name` is 110px; the visible-column total
remains 730px, which is now also the divider's default last-column cap before its 20px gutter.

### Sheet pane divider

Chain 6 block 46 supersedes block 26's permanent all-columns-fit `minWidth`. An untouched sheet opens to
the pixel edge of its visible columns plus `SHEET_COL_PAD_PX`; the pane carries that value as `maxWidth`,
so it cannot be dragged into nuisance whitespace. Dragging left deliberately compresses the sheet and
makes its own horizontal scroller the route to clipped columns. The saved value remains the existing
per-view percentage in scoped `pp-prefs.viewSplit`; no task or sync schema changes.

`clampSplitPct` compares the pointer with the live `sheetMinWidthPx()` on every move. Because the board
rectangle is rendered pixels while column widths are local CSS pixels inside the app zoom, it converts
with `uiScale()` rather than assuming 0.8. Hiding or resizing a column therefore moves the cap immediately;
reordering leaves it unchanged. The sheet's lower bound is the responsive `SHEET_PANE_MIN_PX` (capped by
28%), not the visible-column edge: on a wide board or after hiding columns, every position between that
usable pixel floor and the last-column maximum remains reachable. Selection keeps its separate triage
floor and 28–78% clamp. The revised
`sheet-default-width.spec.js` covers Today and Schedule at 1280, 1600, and 1920 pixels, real divider
compression/persistence, the right-edge clamp, and real column resize/hide/reorder gestures.

Each cell is a compact two-line read: local calendar date, then a clock only when
`hasStartTime`/`hasEndTime` says that edge carries one. A bare midnight date therefore never invents
`00:00`, while an explicitly entered midnight remains visible. All-day ends display their inclusive last
day even though storage keeps the exclusive next-midnight edge. Recurring rows display the current
occurrence's edges without rewriting the recurrence.

Clicking either cell calls the existing `openDatePick`; editing, natural-language parsing, recurrence
semantics and `commit()` therefore remain owned by the picker path introduced earlier. `data-date-clock`
is the browser-test hook for the otherwise visual clock-presence distinction.

### The `% Done` column

Owner, same report: *"I would prefer to add percent complete back as a column which then updates the gantt
bars."* `colDefs()` carries `{k:'pct', w:96, l:'% Done'}`, visible by default, after `Planned → Allotted`
and before `actions`. It hides, reorders, resizes and resets for free, because all of that machinery reads
`colDefs()`.

The cell draws a slim track under the same green-done / base-remainder rule, with the numeral on it. Two
gestures, and the split is about what a *zero-distance* press means:

- **press the track** — drag to set, and a click is the same path at zero distance. `startPctDrag(…,
  'set')`; the drag surface is the full row height and the full cell width, so the numeral is drawn
  *inside* the hit box rather than being a second small target (`HIT_MIN_PX` tenet).
- **press the numeral** — `openPctPop`, for an exact typed value. It sits at the right end of the track,
  which keeps the centre of the cell — the most natural place to click a value — on the drag path.

Both write through **`setPct`**, which is occurrence-aware for repeats and funnels through one `commit()`.
The Gantt reads the same state, so the bar updates on the same commit: there is no second write path and
nothing to keep synchronised. Recurring tasks show `occPct(t, currentOccIdx(t))` — the same value the bar
and the popover show, so all three agree. `mode` on `pctDrag` is the *only* difference between the two
surfaces: `'pop'` (the Gantt band and caret) opens the popover on a click, `'set'` (the cell) resolves it
as a value.

Nothing new is persisted — `pct` is an existing field, already in `SYNC_FIELDS` — so this carries no
fingerprint change and no migration.

**Critical path is a toggle, default OFF (2026-08-13b).** Owner instruction — *"I don't think critical
paths are going to be helpful to the average user"* — and the direct answer to the "too much visual
information" note above: one of the channels is now opt-in, so the default bar carries one fewer.
`_showCP` comes from `cpDisplayOn()`, which is gated on **two** sources and requires **both**:

- `settings.criticalPath` — the owned `DEFAULT_SETTINGS` key, default `false`, surfaced as *Highlight
  critical path* in Settings › General beside the other display switches.
- `props.showCriticalPath` — the **Design** prop declared in the `data-dc-script data-props` JSON, whose
  default is `true` and which stays the Design-side kill switch (an explicit `false` vetoes the setting).

**Do not collapse these into one flag**, and do not "simplify" the owner's default into the props JSON
instead. That JSON is Design-owned, so the next Direction B pull (`DESIGN_WORKFLOW.md`) would restore
`default:true` and silently turn the channel back on for every user. The two flags answer different
questions: the prop asks *may this app draw critical paths at all*, the setting asks *does this user want
them*.

The toggle changes only what is **drawn** — `computeCPM` still runs and `_cpm` is still built, so nothing
about scheduling, slack or ordering depends on it. The channel it gates is not just the bar fill: the
sheet row's left inset, the milestone diamond colour, and the dependency-arrow accent all read `_showCP`.
The detail panel's "critical path / Xd slack" readout is deliberately **not** gated — it is a labelled
text field the user opened on purpose, not ambient paint.

Pinned by `tests/critical-path-toggle.test.js` (the gate's truth table, and that `computeCPM` is
identical either way) and `tests/e2e/critical-path-toggle.spec.js` (the paint, on a real mount). Note for
future test authors: `tests/_load.js`'s `make()` passes `showCriticalPath:true`, which used to be enough
to paint and no longer is — a test that wants CP paint must **opt in explicitly** with
`c.state.settings.criticalPath = true` rather than weakening the gate.

**Ghost paint is retired (Chain 6 block 47).** Start-only and end-only tasks are ordinary solid bars whose
missing side clamps to the visible row edge; tasks with neither date draw no bar. `ghostSpan` deliberately
survives as a finite scheduling predicate and is not a rendering contract. The ghost CSS tokens, gradient
helpers, dotted outlines, and viewport-fraction widening are deleted.

**The in-today channel is deleted from Gantt bars (2026-08-13).** The +45° gold hatch, the whole-bar
`BAR_OPTED_OUT_OPACITY` mute, and the `☐`/`💤` top-right glyphs are all gone, along with the constant. This
is the third application of the same rule, after V2.9 §2 and the ACTIVE-depth removal above: **a state that
already has a dedicated per-row control does not also get an ambient channel.** `taskInclControl` sits on
the row and says exactly this, so the bar paint was the redundant copy.

Only the *paint* went. The predicates are load-bearing and untouched — `isOptedOut` and `inclState` still
drive the inclusion popover's copy, V2.1's `orderingSeam`, and `taskInclControl` itself. The month
calendar's day chips keep their own muted-chip treatment; that is a different surface, with no per-chip
control on it to be redundant with.

**The hatch collision logged in `tasks.md` is resolved by this deletion.** The two hatches read alike at a
glance and meant unrelated things — −45° accent = collapsed repeat, +45° gold = not in today. Deleting the
gold one leaves exactly one hatch on the chart, so there is nothing left to confuse it with, and neither
hatch had to be retuned.

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

**Selection band sizing, and the two defects it took to get right (2026-08-13).** Each column carries its
own divider, and its two halves are balanced by pure flexbox — `flex-basis` = content height,
`flex-shrink` ∝ 1/basis — so the scaled shrink factors are equal, a deficit is removed from both halves
equally in px, and "equal max scroll" falls out without any DOM measurement. `selectionSplitHeights`
mirrors that arithmetic in JS for the unit layer. Owner report: *"12 included tasks in a column and I
won't be able to even see the excluded tasks at all."*

1. **The mirror was not the layout.** `selectionSplitHeights` applied a `SEL_HALF_MIN_PX` floor and was
   unit-tested; the renderer set `minHeight:0`, which omitted the floor *and* disabled flexbox's own
   automatic min-content floor. The mirror said 72px, the browser drew 0. The floor is now a real CSS
   `min-height` using the same constant, and a **flat px value** — a first attempt at `min(112px, 45%)`
   applied no floor at all, because the percentage resolves against a parent with `minHeight:0` and an
   indefinite height and takes the whole `min()` with it. The column carries `overflow:hidden` so a
   column too short for two floors clips, which is what `selectionSplitHeights` now models.
2. **The floor then broke the balance, invisibly.** With Excluded frozen on its min-height, Included was
   the only unfrozen item — and its `flex-shrink` was below 1, so CSS §9.7's *"if the sum of the unfrozen
   items' flex-shrink factors is less than one, multiply the free space by that sum"* clamp applied and it
   shrank by 8% of a 471px deficit, overflowing its column by 400px. Shrink factors are now normalised by
   `SEL_SHRINK_CEIL` to stay ≥ 1, which preserves the ratio (and so the equal-shrink property) exactly.

`SEL_HALF_MIN_PX` is derived, not picked: `SEL_CARD_EST_PX + SEL_BAND_LABEL_PX` = one whole card plus its
band caption. Larger would be worse — the floor overrides the balance whenever it bites, so a floor above
what the balance naturally hands the smaller half would trade the owner's equal-scroll rule for the
visibility rule at ratios where both were already satisfiable.

**Focus splits by inclusion (2026-08-13).** Owner: *"a separator between the tasks that are included for
today and the ones that are not, with the included ones at the top, and the excluded ones [collapsed] by
default."* The task column renders included work first (still grouped by `sectionProjection`), then an
accent rule that doubles as the collapse control, then a flat `Not in today` list behind
`state.focusExclOpen` (session-only, default collapsed, **always counted**). The division is
`inclusionRow`, the shared V2.9 §4 derivation, so Focus adds no new opinion about what is in today.
Sections are kept for Included and dropped for Excluded rather than nested under both — nesting would
print a section holding both kinds twice, which is V2.9 §6's rule and the density failure that killed
sections-as-tags.

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

Task descriptions are keyboard-first rich text (owner 2026-08-18). All three task surfaces share
`richEditor`; it renders only the content-editable field, with no formatting toolbar. Native browser
keyboard shortcuts remain available, while a Space after an exact line-start `-`, `*`, or numeric
enumerator such as `1.` converts that line to an unordered or ordered list and removes the marker.
The line-start check spans adjacent inline nodes (native bold/italic/underline split one visual line into
several nodes) and treats Chromium's Enter blocks plus `<br>` as line boundaries, so a mid-line marker
cannot autoformat merely because it begins a new text node. Mid-line punctuation and decimals stay literal.
Storage, blur commits, paste, undo, and sanitization retain
the existing rich-HTML contract; Journal and Scratch continue to use the separate generic `richField`.

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
no dependency handle. Bar handles use separate glyph and hit-box sizes: `HIT_MIN_PX` is 24. The timeline block's unpin ✕ and regroup ⧉
follow the same rule: the glyph stays 16px inside a transparent `HIT_MIN_PX`-wide, full-height hit column at
the block's left edge, and the block's left padding clears that column so the title never shares its pixels.

### The %-done control on a Gantt bar

Two targets, both starting `startPctDrag`, both `ew-resize`:

- **The band (primary, 2026-08-15).** A `PCT_GRAB_PX`-half-width band ON the bar, full bar height, centred
  on the fill edge, drawn as a faint vertical seam that strengthens on hover. **Not hover-gated** — it lives
  on the bar's own drag surface, so a press inside it means "% done" by design.
- **The caret (secondary).** The upward caret below the bar, hover-gated, kept as the fallback for bars too
  narrow to hold a band and for anyone who already learned it.

`pctGrabZone(w, pct)` is the whole geometry, and it is pure. The band is **shifted, never clipped**, until it
clears both `BAR_GRIP_PX` resize grips, and returns `null` when the body between the grips cannot hold a full
band. That rule is the owner's constraint stated directly: at 0% and 100% the fill edge sits *on* a grip, and
a band that overlapped one would cost the bar its resize handle at the two most common percentages there are.
The band also stacks at `zIndex 2`, *below* the grips at 3, so a geometry bug still cannot win the overlap.

Consequence worth knowing: inside the band a press sets % instead of moving dates, so at 0% the band occupies
a stretch of the bar's left body. That is the accepted trade — the grips, which are the genuinely ambiguous
part, are what the clearance rule protects.

The percentage is drawn as small overlaid text **inside** the bar (`data-pct-label`), right-aligned,
`pointerEvents:none`, dropped entirely below `PCT_LABEL_MIN_W` and at 0% rather than clipped. `ganttSideRow`
— the old strip to the right of a bar that used to hold this readout — is deleted; nothing is drawn to a
bar's right any more except the link dot.

*History worth keeping:* the caret's drag gesture worked, and `tests/e2e/pct-drag.spec.js` proved it with
real pointer input in both directions. The owner still could not use it. A 24×16 box, invisible until hover,
in the 10px gap below the bar, is not findable — a passing gesture test is not a usable control.

### The Escape ladder

`onKey`'s Escape branch is a ladder, and exactly one rung fires per press — most transient first:

1. **an in-flight drag** — `_edgeDrag`, then `_blockDrag`
2. **the topmost overlay** — `datePick` › `pctPop` › `inclPick` › `barMenu` › `quickOpen` › `scopePrompt` ›
   `settingsOpen` › `colMenu` › `selCols` › `menu`
3. **the open detail sheet** — `detailId`
4. **the row selection** — `clearSelection()`, which empties `selectedIds`, `selCols` *and* `selCursor`

Rung 4 is last on purpose: it can never steal from a drag cancel or an overlay close. It is also the only
rung guarded by `isEditingTarget`, so Escape inside an inline title editor, a description, or the quick-add
input never wipes the row being edited. A new rung goes in transience order, not at the top.

**Rungs 3 and 4 collapse into one press when the open sheet is the sole selected row** (owner, 2026-08-15).
A row click is *one* gesture — `rowClick` writes `selectedIds` and `detailId` in the same `setState` — so
charging one Escape per half made the deselect look absent: the first press closed the sheet and the row
stayed lit. One gesture, one press. When the two have genuinely drifted apart (a sheet opened from a card or
the Gantt while a different range is selected) they are separate contexts and the ladder still charges
separately. The sheet's own ✕ (`Close (Esc)`) closes without clearing, which is how a lit row with no sheet
is reached.

### Keyboard navigation of the selection

`↑`/`↓` move the selection one **visible** row (`_visTasks`, not `state.tasks` — arrows must reach the row
below the one on screen, not skip through collapsed and filtered rows); `Shift+↑`/`Shift+↓` extend the range
from `_selAnchor`, which is shared with shift-click so the two extend the *same* range; `Enter` opens the
current row, and does nothing on a multi-row range rather than guessing which row was meant. A plain arrow
move deliberately does **not** open the sheet — `↓↓↓` would be unusable, and each sheet would land under the
next Escape.

The keys are claimed **only while something is selected**, so with an empty selection the arrows still scroll
the pane. The Selection grid is excluded because it already owns `j`/`k`/`space` for the same "current row"
idea. This exists because a persistent selection that carries no keyboard affordance is pure cost — the
owner's report was *"I'm unable to use arrow keys or enter on that sticky highlighted task… that's why I
think it's too sticky"*, which is a complaint about the selection returning nothing, not about it persisting.

**Nothing selected is the default and a holdable state.** No renderer falls back to the first task when
`selectedIds` is empty, and nothing re-seeds it; every write is an explicit user act (row/card click,
shift-range, quick-add's just-created row, `j`/`k`). Before the ladder grew rung 4 the only way back to
empty was clicking the exact background of a pane (`e.target===e.currentTarget`) — a sliver of pixels — so
in practice a task stayed highlighted forever.

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

### Boundary notifications (PR #126, 2026-08-16)

There is now exactly **one** task notification type, `taskBoundary`. `deadlineRisk` is deleted outright
(owner: *"its just a nuisance alarm"*), and the old clocked-start heads-up and block-end notification are
merged into it. The body is assembled from two optional halves — "X has ended" and "Y will start" — so one
half, the other, or the pair all render from a single builder.

**Triggers:** every clocked start fires, and every block end fires; **coincident ones merge into a single
notification**. This is an owner correction made during implementation — *"no info loss compared to having
both, but less nuisance"* — and it supersedes the spec's narrower "the day's first task start" wording,
which was not what was intended.

There is **no lead time**, so the 5-minute lead constant retires with the heads-up. `NOTIFY_GRACE_MS`
stays, as the missed-tick window. The three Settings toggles collapse to one. `notifyPlan` remains pure.

Note the `uncompressable` interaction (see `scheduling.md`): `isFixedOn` is gated on the field, so a clocked
task with "Exact" unticked no longer generates a block-end notification. That is intended — an unticked
task's end genuinely floats, so there is no fixed end to announce.

Tests mount the component in a Node VM with mocked runtime/storage. Browser QA uses localhost.
