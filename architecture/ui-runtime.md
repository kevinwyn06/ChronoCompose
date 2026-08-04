# UI and runtime

`index.html` contains the application and Design document. Never read it wholesale: locate a method or
`PP-EXT` marker with `rg`, then inspect a bounded range. `support.js` is opaque and must not be edited.
`Project Planner.dc.html` and its baseline are required three-way Design-sync artifacts.

Primary views include Gantt, Day/4-Day/Week/Month calendars, Today/Schedule, Focus, Review, Settings,
Archive, habits, and journal. Shared state keys and Design `{{ }}` placeholders retain their names.

Overlay coordinates pass through measured UI-scale helpers because the app runs under a scaled wrapper.
Gantt and sheet rows share explicit height/box-model rules; visible structural changes require a Design
push after implementation. Timers persist in `pp-run`; Pomodoro state is ephemeral in `pp-pomo`.

The V2.3 sheet is a uniform task list rather than a field grid. Each normal row contains priority/done,
task name, removable `@tag` chips plus an inline `@` input, the due/recur chip, a `planned → allotted`
readout, and inclusion/timer/add-time actions. Start, Due, and % Done remain Gantt-owned. The due/recur chip
uses separate overdue, today, tomorrow, within-one-week, and later buckets; recurrence follows the date
behind a `↻` glyph.

`tasksByTagSection` groups each task exactly once by its primary (first) tag. Subtasks inherit their root
task's section so a subtree is never torn apart. Section order follows first appearance in manual/tree order;
untagged work renders under `No tag`. `TAG_SECTION_H` is consumed by matching sheet headers and Gantt rails,
and Gantt `_yTop` continues to index tasks only. Normal and milestone task rows retain the same fixed row
height; expanded description height is still measured into the Gantt Y offsets. Focus uses the same sections
and uniform 52px task rows with `spent / allotted`, a progress fill, done, timer, and `+15` tracked-time actions.

Every Gantt element layered above a row stripe owns its own `state.hoverId` enter/leave lifecycle. The bar
wrapper contains the right-side dependency handle, so moving onto the handle cannot clear hover. Collapsed
recurrence strips follow the same rule. Milestones own hover only for row/day glow and deliberately expose
no dependency handle. Bar handles use separate glyph and hit-box sizes: `HIT_MIN_PX` is 24; the %-done
control is an upward caret below the bar, not a circle inside it.

Tests mount the component in a Node VM with mocked runtime/storage. Browser QA uses localhost.
