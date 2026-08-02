# UI and runtime

`index.html` contains the application and Design document. Never read it wholesale: locate a method or
`PP-EXT` marker with `rg`, then inspect a bounded range. `support.js` is opaque and must not be edited.
`Project Planner.dc.html` and its baseline are required three-way Design-sync artifacts.

Primary views include Gantt, Day/4-Day/Week/Month calendars, Today/Schedule, Focus, Review, Settings,
Archive, habits, and journal. Shared state keys and Design `{{ }}` placeholders retain their names.

Overlay coordinates pass through measured UI-scale helpers because the app runs under a scaled wrapper.
Gantt and sheet rows share explicit height/box-model rules; visible structural changes require a Design
push after implementation. Timers persist in `pp-run`; Pomodoro state is ephemeral in `pp-pomo`.

The V1.5 sheet omits the Start, Due, and % Done columns because those values are edited on the Gantt bar.
The task-name cell keeps a single due/recur chip: overdue, today, tomorrow, within-one-week, and later are
separate semantic color buckets, and recurrence follows the date behind a `↻` glyph. Normal and milestone
rows use the same fixed row height; expanded description height is still measured into the Gantt Y offsets.

Every Gantt element layered above a row stripe owns its own `state.hoverId` enter/leave lifecycle. The bar
wrapper contains the right-side dependency handle, so moving onto the handle cannot clear hover. Collapsed
recurrence strips follow the same rule. Milestones own hover only for row/day glow and deliberately expose
no dependency handle. Bar handles use separate glyph and hit-box sizes: `HIT_MIN_PX` is 24; the %-done
control is an upward caret below the bar, not a circle inside it.

Tests mount the component in a Node VM with mocked runtime/storage. Browser QA uses localhost.
