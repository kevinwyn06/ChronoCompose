# UI and runtime

`index.html` contains the whole application. Never read it wholesale: locate a method or `PP-EXT` marker
with `rg`, then inspect a bounded range.

**Runtime.** React 18 UMD from a CDN; no build step. `<head>` carries the theme script (sets
`<html data-theme>` before first paint) and the one stylesheet. `<script data-pp-app>` holds
`class Component extends AppLogic`. The bootstrap after it mounts a React `Host` into `#pp-root`:
`AppLogic.setState` merges into `this.state` **synchronously** and the host then re-renders, so code may
read `this.state` straight after `setState`; `setState` from the constructor is a no-op. The host renders
the shell (top bar, `role="main"` board, drawer) around the slots `renderVals()` returns (`topcontext`,
`viewtoggle`, `drawertoggle`, `toggleSettings`, `board`, `drawer`), and a render error shows a fixed red
`data-pp-app-error` box instead of unmounting. Props are fixed in the bootstrap's `APP_PROPS`. The unit
loader (`tests/_load.js`) extracts the `data-pp-app` script and supplies its own `AppLogic`/`React` shims.
Until 2026-10-09 this layer was the generated Design runtime `support.js`; it and the Design sync
workflow were removed.

Primary views include Gantt, Day/4-Day/Week/Month calendars, Today/Schedule, Focus, Review, Settings,
Archive, habits, and journal. Shared state keys and Design `{{ }}` placeholders retain their names.

Overlay coordinates pass through measured UI-scale helpers because the app runs under a scaled wrapper.
Gantt and sheet rows share explicit height/box-model rules; visible structural changes require a Design
push after implementation. Timers persist in `pp-run`; Pomodoro state is ephemeral in `pp-pomo`.

### Design system (UI revamp block 11a, 2026-10-04)

Everything in the shell renders at 0.8× (`--pp-shell-zoom`, `SHELL_ZOOM`). The scales below are chosen by
what they RENDER at, and the zoom itself is not touched.

- **Type.** `--fs-1` 13 (caption) · `--fs-2` 14 (label) · `--fs-3` 14 (body) · `--fs-4` 15 · `--fs-5` 18 ·
  `--fs-6` 22 CSS px. These render at 10.4 / 11.2 / 11.2 / 12 / 14.4 / 17.6px. That puts the floor at 10px or
  more for captions and 11px or more for labels and body text. `--fs-2` and `--fs-3` have the same value
  but keep separate names, so the two roles can be tuned apart later. Inline `fontSize` values are literal
  px on the same scale (13/14/15/18/22). The unit layer reads them, and it cannot resolve a `var()`. Nothing
  is set below 13px and nothing is fractional. Display numerals of 24px and up (clocks, the Pomodoro ring)
  sit outside the scale. Column heads and Gantt bar labels (`GANTT_LABEL_FS`) use the caption step.
  `tests/ui-revamp-a11y.test.js` scans the whole file for any size off the scale.
- **Radii.** `--r-1` 4 (chip, input) · `--r-2` 6 (button) · `--r-3` 10 (menu, card, popover) · `--r-4` 16
  (dialog) · `--r-pill`. Circles stay `50%`. Literal radii were mapped onto these: 1–4 → r-1, 5–7 → r-2,
  8–12 → r-3, 14–16 → r-4, 999 → pill.
- **Shadows.** `--sh-1` (bars, cards, timeline blocks) · `--sh-2` (menus, popovers, toasts, drag cards) ·
  `--sh-3` (dialogs, the first-run card). They are tuned per theme. Rings and inset rails (selection,
  pinned edges, the critical inset) are not elevation, so they keep their own values.
- **Buttons** (`.pp-btn`). The base is Secondary. Modifiers: `--primary` (accent fill with `--on-accent`
  ink), `--outline` (the pressed state of a primary toggle, such as the Focus hero's Stop), `--ghost`,
  `--danger`, `--icon` (square), `--block`. Sizes are `--sm` 24, md 30 (default) and `--lg` 36 CSS px. md and
  lg meet `HIT_MIN_PX` on their own box. `--sm` keeps its 24px look and extends a transparent `::before` to
  a 30px hit box. `BTN_LG_PX` mirrors `--lg`, so the unit layer can check the hero's buttons. `.pp-tbtn` is
  the legacy name for Secondary md and shares the rule. `.pp-tool` (toolbar), `.pp-search` and
  `.pp-iconbtn` (the template's ⚙) are 30px. Segmented is `.pp-seg`/`.pp-seg-btn`: 24px look, 30px hit box.
  The common buttons now come from this set: quick add's Add, the date picker's Done and Clear, the % popover's
  Set, first-run and coach, the demo banner, the Focus hero's Start/Stop/Done, Review's and the Journal's
  arrows, Month's Today and "+ Add habit". The Pomodoro keeps its phase-coloured pair.
- **Contrast.** Every text token (`--text*`, `--btn-text`, `--tag-text`, `--link`, `--danger*`, `--warn`,
  `--success`, `--due-*`, `--gantt-label`, `--tl-win-fg`) clears 4.5:1 against every RESTING surface token
  in both themes. That covers bg, top, sheet, alt, gantt, side, card, menu, chip, button, input, field, tag,
  section band and weekend. Hover washes are transient and are not in the set. The unit test computes this
  from the hex. The faint pair is no longer below the floor. It still steps down from muted, so "faint"
  now means quieter, not illegible. Placeholders use `--text-faint2`, not the browser's #757575. Out-of-month
  Month cells dim to 0.75, not 0.45. The owner-ruled invariants are untouched: the timeline hue and the
  saturation floor (`theme-tokens.spec`), the section band ratio (≥ 1.12, checked in the unit test) and
  the pinned red edges.
- **Focus.** One ring for everything that takes focus: `:focus-visible{outline:var(--focus-w) solid
  var(--focus-ring)!important; outline-offset:var(--focus-gap)}`. `--focus-w` and `--focus-gap` are 2.5px.
  Chromium snaps an outline to whole device pixels, so a 2px outline inside the 0.8 shell drew ONE pixel.
  2.5px renders as 2. The rule is `!important` so the dozen inline `outline:'none'` styles cannot hide it.
  Fields inside rows and tight cells (`.pp-num`, `.pp-sel`, row inputs, contenteditable, menu items) draw the
  ring inside (`calc(-1 * var(--focus-w))`). Only two focus rules switch it off. The dialog card hosts the
  trap, and its fields carry the ring. The search input's box draws the ring through `:focus-within`.
- **Names.** `installA11yNames()` runs once in the constructor and wraps `React.createElement`. A control
  with a `title` and no visible letters or digits (‹ › ✕ ▲ ▼ ▶ ■ ⋯ ⚙ 💤, or nothing) gets `aria-label` =
  its title. So does a field with only a title or placeholder. Words win over the title (label in name),
  and an explicit `aria-label` or `aria-labelledby` always wins. `a11yAutoName` is the pure rule. A Settings
  row hands its label to its switch or field (`withA11yLabel`). The switch's hit box is 46×30 around the
  same 40×22 track.
- **Structure.** `<html lang="en">`. The top bar has `role="banner"` and the board has `role="main"`. These
  are role attributes on the Design template's divs, not new elements, so they need a Design push. The page
  tabs sit in a `<nav aria-label="Primary">` with `display:contents`.
- **Narrow windows.** The sheet's Actions column is `position:sticky; right:0` (`STICKY_ACTIONS_STYLE`). Row
  cells inherit the row's own paint, and the header cell paints `--top-bg`. At 1024px, or at 200% zoom, the
  sheet compresses over its middle columns instead of clipping the timer and add-time controls away.
  `tests/e2e/a11y-sweep.spec.js` checks the rendered type floor on every main surface, a visible ring on
  real Tab presses, and that Actions and the plan header's Today / ‹ › are unclipped at 1024px and 800px.

### Click targets on the Plan page (targets pass 1, 2026-10-04)

The Plan page's sheet, toolbar, column headers and Gantt now meet `HIT_MIN_PX` as RENDERED px. A hit box
is 30 CSS px, which renders at 24 under the 0.8 shell. Measured over the Plan page in both themes, the
share of targets under 24 rendered px fell from 70.2% to 18.6%. The probe walks each control out from its
centre with `elementFromPoint`, so it measures what a pointer actually hits.

- **Real buttons.** Every clickable `div`/`span` on these surfaces is now a `<button type="button">`: the
  circle, ☰, the subtask caret, the date cells, Time needed, the On-today box, snooze, play, the tag ×, link
  and predecessor chips, the section caret, name and ▲ ▼ ✕, and "+ Add task". `rowBtnProps` builds a row
  control: `type=button`, `tabIndex -1` (decision 31: the row menu carries the row's actions and the arrows
  move the selection) and the `.pp-hb` class. After a pointer click it hands focus on to the focusable host
  (the row, or a card), which is where a click on the old div left it, so the arrow keys keep working.
  The % Done cell is `role="slider"` (`tabIndex -1`, ← → step it). Sortable column headers are Tab stops,
  and Enter or Space sorts them (`aria-sort`). "+ Add task" is a Tab stop.
- **`.pp-hb` / `.pp-hba`.** `.pp-hb` resets a button to look like the span it replaced. Both classes add a
  transparent `::before` hit box. Its size is `--hb-w`/`--hb-h` (30px by default) and `--hb-dx`/`--hb-dy`
  shift it. Each class declares its own defaults, so a sized parent's values never inherit. The glyph never
  grows. Two places are packed tight, and their boxes are shifted so they meet rather than overlap:
  - The check cell: the circle's box sits 1.5px left, and the drag dot keeps a 16.5px box in the cell's
    padding. The whole row drags as well, and the circle is used more.
  - The name line: the subtask caret leans left and ☰ leans right over the row number. ☰ drops 5.5px, so
    its box runs from the row's top edge over the chip line. The chip line's own fields and buttons stack
    above it (`.pp-chipline`, z 1).

  The title line clips with `overflow:clip` and a 12px clip margin, not `hidden`, so those boxes can leave
  the strip. The ellipsis still truncates the text at the box's own edge.
- **Section headers** are z 3. Their controls lift their boxes 3px, so the boxes reach 6px into the row
  above and none into the first row below. ▲ ▼ ✕ are spaced 30px apart. The right padding is 12, which
  keeps ✕ clear of the pane divider's 30px hit area (`.pp-divider::before`, 6px into the sheet and 18px
  over the plan pane).
- **Actions** is 156px, up from 104. That fits On-today, snooze and play at 30px each and the worked field
  at 48. At 104 the row overflowed the cell, and block 11a's clip hid the On-today checkbox entirely. The
  worked field and the Planned field (`.pp-row .pp-num`) are 30px tall. The worked field still LOOKS 24px:
  3px transparent borders, the paint clipped to the padding box, and its outline drawn as an inset shadow.
- **Gantt.** Every bar target is `GANTT_HIT_PX` tall: a hit strip under the body (`data-gantt-bar-hit`,
  the same press and right-click as the body), both grips, and the %-done band. The grip's outside
  extension is now the grip's CHILD, so the grip and its extension are one 30×30 target with one handler.
  `PCT_GRAB_PX` went from 12 to 15, so the band is 30 wide. A bar needs 44px to hold a band; a narrower
  bar keeps the caret. The caret is z 1, below the band and the grips. The milestone diamond gets a 30px
  `.pp-hba` box.
- **Still under 24, on purpose:**
  - Column resize grips (`.pp-rsz`): widening them takes the header's sort and reorder surface.
  - The tag field, tag ×, snooze-day × and the % numeral: they live in 18px strips (the chip line, the %
    track) that clip.
  - The section band itself (24px, held by Gantt row alignment) and the empty-section line (18px,
    decision 30).
  - The hover-gated %-done caret under a bar.
  - A one-day bar's body between its two grips.
  - The first section's controls, where the sticky column header covers their upward reach.
  - ☰ where an @ field sits directly under it.
- **Tests.** `tests/plan-targets.test.js` fails on any clickable non-button, without role and tabIndex,
  in the sheet, the toolbar, the pane header or a Gantt bar. It also pins decision 31's Tab rules.
  `tests/e2e/plan-targets.spec.js` measures the rendered hit boxes and drives the keyboard. It proves that
  a press on the hit strip drags a bar and that the row's drag dot still owns its centre.

### Click targets everywhere else (targets pass 2, 2026-10-04)

Pass 2 takes pass 1's machinery (`.pp-hb`, `.pp-hba`, `rowBtnProps`) to every other surface: the top bar,
the Day / 4-Day / Week / Month / Agenda views, Focus, Review and Habits, the Journal, the Archive, Settings,
the detail dialog, quick add and the filter popover. Same probe as pass 1, run over the whole app, 1600×900,
both themes: see the before/after table in the pass's report.

- **`HIT_BOX_PX`** (named constants) is `ceil(HIT_MIN_PX / SHELL_ZOOM)` = 30: the local size that RENDERS
  at `HIT_MIN_PX`. Many controls were sized `HIT_MIN_PX` local px, which renders at 19.2. The timeline's left
  control column (✕ ⧉ ↺ 💤), its bottom edge handle, the day-bound handles, the detail dialog's fields,
  quick add's field, Settings' number fields and the Journal's list buttons now use it.
- **Real buttons.** Timeline ▶ and the left controls, the agenda's ▶ and ✕, the Focus list's circle, name
  and ▶, the "Not in today" band, the editor toolbar, Habits' day cells, Daily / Weekdays, weekday toggles
  and unlink ✕, the Journal's disclosures, mood chips, "clear", ↻ and list rows, the archive row's name,
  Settings' row density and column chips, "↺ Reset columns", the Day view's zoom toggle.
- **Tab order.** Where a list has no row selection, its primary control is a Tab stop: the Focus list (circle,
  name and ▶ — there is no row menu there, so all three), the archive row's name, the Journal's lists. Each
  timeline view (the Day column, the whole 4-Day / Week grid, the Agenda list, Focus's timeline) is ONE Tab
  stop, a roving tabindex (`blockKeyProps`, `tlNavNext`, `tlRovingPick`, `tlRovingFix`): tabIndex 0 on the
  last-focused block, else the first block at or after now, -1 on the rest. ↑ / ↓ walk the day in time,
  ← / → jump to the nearest-in-time block of the adjacent day that has any, Home / End the day's first /
  last, Enter / Space open, Shift+F10 opens the row menu. Blocks render at -1 with `data-tl-nav` (start) and
  `data-tl-nav-day`; `tlRovingFix` (mount / update) names the stop per view in the DOM. A block's small
  controls are buttons with `tabIndex -1`, decision 31's rule for a row. A habit's 14-day strip is one Tab stop (the latest scheduled day) and ← / → walk it
  (`habitCellKey`). The editor toolbar works from the keyboard too (a key press puts the caret back first).
- **Section headers on the Plan sheet** are stops in the arrow-key walk (`sheetNavStops`, `sheetNavNext`,
  `secHeadKey`). A plain ↑ from a section's first row lands on its header and clears the row selection;
  ↓ goes back in. Shift and Ctrl arrows still walk rows only. On a header: Enter / Space collapse or expand
  (an empty section: add a task to it), ← / → collapse / expand, F2 renames (focus returns to the header),
  Alt+↑ / Alt+↓ move it, Delete deletes it (the ✕'s own delete: tasks go to No section, Undo toast, Ctrl+Z),
  and Shift+F10 opens the section menu (`renderSecMenu`, `state.menu.sec`) with all of these. While a header
  holds the cursor it is the sheet's one Tab stop. There was no delete confirm to reuse; the undo is the
  safety net, as it is for ✕.
- **Fitting without growing.** A field that must be 30px tall but sits on a shorter line gets negative
  margins (`height:30px; margin:-4px 0`) so the line keeps its height. Where 30px boxes cannot all fit, the
  box is the pitch and no more: a habit day cell's box is its 18px pitch wide (14 days on a 288px card) and
  30 tall. A control inside a timeline block is clipped by the block, so the ▶ box is shifted inward
  (`--hb-dx:-4px; --hb-dy:4px`) to sit wholly inside it.
- **Still under 24, on purpose:** a timeline block's own height (it is its duration: a 15-minute chip is
  20px), so its controls on a chip shorter than 30px; habit day cells' width; the Month view's "+N more"
  where the cell clips below it; pass 1's list for the Plan sheet and Gantt.
- **Tests.** `tests/app-targets.test.js` scans the render paths above for bare clickables, pins the Tab
  rules and drives the section-header keys. `tests/e2e/app-targets.spec.js` measures a representative target
  per surface, drives the top bar, Settings tabs, Focus hero, Review / Journal arrows, a timeline block and
  the section headers with real keys, and proves a habit cell and a timeline block under the real mouse.

### Truthful settings and the first minute (UI revamp block 11b, 2026-10-04)

- **Settings, signed out.** The Google Calendar section shows one line ("Sign in to your account to connect
  Google Calendar.") and a Sign in button (`data-settings-signin` → `focusSyncSignIn`, the email field
  `data-settings-email`). Connect, Backfill, Import, the import window and the poll interval render only when
  `state.sync.connected`, because `gcalConnect` needs the account session. `gcalBackfillNote(connected, n)` says
  "All dated tasks are already on Google" only when the calendar is connected. Developer copy (config.js,
  `tools/static-server.mjs`, `.telemetry/`) lives in code comments, not in the UI. Journal weather is under
  General › Journal. The tabs are a tab set: `role=tablist` with a name, one Tab stop (the selected tab),
  `settingsTabKey` maps ←/→ (wrapping), Home and End, and one `role=tabpanel` (`#pp-settings-panel`)
  labelled by the selected tab.
- **Top-bar right slot.** The Design template's `{{ drawertoggle }}` slot sits just left of the gear and used to
  render nothing; it now renders `renderTopRight()` = [sync status][timer pill]. No new placeholder, so no
  Design push. `renderTopContext()` is the nav only. `syncStatusModel(sync, configured)` is PURE over the
  existing sync state (no request): Local only · Sign in to sync / Syncing… / Synced / Sync error / Sign in again
  to sync. The status is a quiet button that opens Settings on Integrations; its name never contains
  "Settings", so the gear stays the only control with that name.
- **One date language.** `LOCALE` ('en-US') in the named constants and `fmtDate(msOrDate, opts)` are the only
  route to `toLocaleDateString`; `tests/ui-revamp-truth.test.js` fails on any other `toLocale*String` call and on
  `Intl.DateTimeFormat` used for anything but the time zone. The owner's zh-CN machine had painted "10月4日".
- **First run.** A new workspace is seeded with its routines, so "no tasks" was never true and the welcome
  never showed. `workTaskCount()` counts active non-routine tasks; `firstRunModal`, `firstRunStep` and the
  welcome use it (the non-modal "No tasks yet" card keeps the literal count). The morning summary does not
  open over the welcome. Load demo no longer marks the first run seen, so Clear demo brings the welcome back.
  The demo files into Work / Study / Personal (reusing same-named sections; the ones it creates are listed in
  `pp-prefs.demoSectionIds` and removed by Clear demo once empty) and carries no tag chips.
- **Small fixes.** The light toast has its own edge and lift (`--toast-border`, `--toast-sh`). The habit ⋯ menu
  closes on an outside press (a transparent fixed catcher) and on Escape (a ladder rung right after the detail
  menu; focus returns to its ⋯). Review's partial-week line reads "vs this time last week". The detail's
  Project row reads ChronoCompose (`PROJECT` keeps its name).

Pointer gestures (owner-set 2026-08-04). **Sheet row:** single click selects and opens the detail panel;
ctrl/cmd-click toggles selection; shift-click selects a range **in screen order** (the rendered
projection — sections, sort, collapse — via `selRangeIds`), ctrl/cmd+shift-click adds that range;
**double-click on the title edits it inline** (UI revamp block 6, decision 11 — it no longer starts a
timer; the timer lives on the play button); right-click opens the row context menu. A click on empty sheet
space or a section header's own surface clears the selection; the **Gantt's empty lane** selects its row
but never opens the detail (`rowClick(e,id,{noDetail:true})`) and has no double-click. **Gantt bar, milestone, and collapsed recurrence strip:** a click
without a drag opens details; dragging the body moves it, dragging an edge sets a date, a no-drag click on
an edge opens the date picker; right-click opens the bar menu. **Scheduled block (Today timeline and
Schedule chips):** a click without a drag opens details; dragging pins THAT block — only the dragged chunk
follows the cursor, only its own minutes are pinned, and its ✕ unpins just that block. **Double-click never
opens details anywhere** — bars and blocks route their no-drag click through the existing mouseup branch, so
one gesture cannot both drag and open. The inclusion popover on the row status glyph is strictly
inclusion/exclusion and carries no time-tracking action.

Keyboard (UI revamp block 6; block 7 adds the bar menu's keyboard path below). Sheet rows (`data-pp-row`, `role=row`, `aria-selected`) are a roving tab
stop — `rovingRowId` gives exactly one row `tabIndex 0`. A focused row owns the row keys in `rowKey`:
↑/↓/Home/End move and select (Ctrl moves focus only, Shift extends), Space toggles, Enter opens, F2
renames inline, Shift+F10 / the context-menu key open the row menu. The row and bar menus are `role=menu`
(`menuProps`/`menuKeyDown`: focus to the first item, arrows, Enter/Space; Esc closes through `onKey` and
`closeMenu` returns focus to the row). The row menu's **Dates and progress…** item opens the BAR menu for that task (`openBarMenuFromRow`) — anchored under its bar when the bar is on screen — so Shift+F10 → that item → Enter reaches dates, progress, repeat and shape without a pointer; Escape returns focus to the row (`_barMenuReturn`). `?` opens the shortcut sheet (`SHORTCUTS()`, a Dialog); F6 moves
focus to the toast's Undo. Two or more selected rows swap the sheet toolbar for the bulk-action bar
(`renderBulkBar`, same `PLAN_STRIP_H`).

**Bulk snooze (owner ask 2026-10-07).** The row menu (multi-select aware) carries a **Snooze** block —
Today, a typed **Until…** box (`parseSnoozeText`), and **Until it's relevant** — and the bulk bar a
**Snooze** picker (Today, 3 days, 1 week, Until it's relevant). Both call `snoozeMulti(ids, kind, text)`:
one commit, one undo step, writing exactly what `snoozeToday` / `snoozeUntilText` / `snoozeIndefinitely`
write per task. `snoozeEligible` skips done, archived and milestone rows, and the toast counts the skips.
The typed box stops its own key events, or `menuKeyDown` would claim Space and Enter mid-phrase
(`tests/e2e/bulk-snooze.spec.js`). The row menu now scrolls inside the viewport (`maxHeight`).

Two mechanics that gesture map depends on, both fixed 2026-08-12 after the e2e layer caught them:

- **The row's double-click does NOT come from the browser's `dblclick`.** The first click opens the
  detail modal — a `position:fixed; inset:0` scrim with a large centred card — so the second press lands
  on the overlay, not the row. The click target changes mid-sequence, Chromium resets its click count,
  and `dblclick` is never synthesised on the row. So `rowClick` records `{id, t, x, y}` in `_rowDblTag`
  and the modal's scrim AND card both run `detailDblFollowUp`, which consumes a one-shot press within
  `ROW_DBLCLICK_MS` (400) and `ROW_DBLCLICK_PX` (6). Since UI revamp block 6 the tag also records whether
  the first press was on the title line (`[data-pp-title]`): if so the follow-up closes the detail and
  starts the inline title editor (`startInlineEdit`; Enter/blur save through `rename`, Esc cancels), and a
  short `_suppressRowClickUntil` keeps the trailing click from reopening the detail; off the title the
  press is consumed and the detail stays open. `rowDblClick` remains wired for surfaces where no modal
  intervened. Anything new that opens an overlay on a single click inherits this problem.
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

A running timer is visible everywhere (UI revamp block 9). One model, `timerPillModel(running, tasks, now)`,
names the ACTIVE task (`activeTaskId`'s rule) and its current segment's elapsed (`fmtElapsed`: `m:ss`, then
`h:mm:ss`); it feeds four surfaces. **Top-bar pill** (`renderTimerPill`, `data-timer-pill`): rendered in the
`{{ topcontext }}` slot right of the nav — no new Design placeholder — and absent when idle; dot, the name (a
`<button>` that opens the detail), tabular elapsed, "+N" under multitask, and a `<button>` Stop sized
`HIT_MIN_PX/SHELL_ZOOM`. **Tab title** (`docTitleFor` via `syncDocTitle` on mount/update): `▶ 0:12 · Name —
ChronoCompose` while running, `APP_TITLE` otherwise (the document had no title before). **Running block**
(today only, `runBlockModel`): the packer draws a running task from NOW for what is LEFT of its day, so the
fill is PROGRESS — worked today ÷ (worked + still drawn) — as a `TL_RUN_BAR_PX` bar along the block's foot
(`data-tl-run-fill`), plus the elapsed label (`data-tl-run-elapsed`; not on compact chips). **Pomodoro**: a
session FOLLOWS the most recently started timer (`pomoBindRun`, applied in `startTimer` — phase and clock
untouched), and with no session a running timer is MIRRORED (`pomoPanelModel` mode `mirror`): the task named,
the ring counting its elapsed up against one focus interval, Start binding the session to that task without
stopping it. Idle with nothing running is unchanged. A FOCUS phase **pauses when its task's timer stops**
(decision 43 follow-up; a judgement call): every stop path — row ▶/■, pill Stop, `T`, the Focus hero's Stop
and Done, completing, deleting or archiving — ends in `stopTimerAt`, which calls `pomoOnTimerStop`. That
freezes the phase with `pp-pomo.pausedRemaining` (pure `pomoPause`/`pomoResume`; `pomoState` reports a
paused phase as never done, so `pomoTick` cannot roll it and no pomodoro is counted). Starting any timer
resumes it in `startTimer` (so switching tasks — stop A, start B — is pause-then-resume in one call, net
untouched), as does the panel's **Resume** (`data-pomo-resume`; the panel carries `data-pomo-paused` and
the label "Paused"). A break is not bound to a timer and keeps running; a standalone session (`taskId`
null) ignores other timers; the session's own moves (roll to break, Stop) run under `_pomoApplying` and
never leave a pause. Completing (`toggleDone`, `setPct` to 100), deleting (`deleteMulti`, the series
delete) and archiving (`archiveMulti`) now stop the task's timer (`commitStoppingTimers`) — before, a
timer outlived its task in `pp-run`. **One action, one Undo:** the credit happens inside the action's own
`commit()` (same task snapshot), and the running map + Pomodoro session from before the action are pushed
as a PAIRED `timers` record on the interleaved undo log (`_timersUndo`/`_timersRedo`, kind `'timers'`) —
the mechanism `deleteSection` uses for its paired `sections` record. One Ctrl+Z (or the toast's Undo)
restores the task, its timer from its original `startedAt` (credit and timer revert together, so no time is
lost or double-counted) and the session; redo mirrors it. With no timer running among the ids it is a plain
`commit`, one entry, as before. **`T`** stops the timer the pill shows
(`stopActiveTimer`); stop only, inert when idle, listed in `SHORTCUTS()`. Everything rides the existing 1 s
run tick — no separate ticker. Sheet rows still get no ambient running paint (2026-08-13 ruling): the pill
and the block are not a second channel on the row, they are the timer's only presence off it.

**Focus is laid out around a "Now" hero (UI revamp block 10a; decision 9 kept Focus as its own tab).** Two
columns: a WORK column and the existing from-now timeline (`data-focus-timeline`, unchanged). The work
column stacks the hero, a habits strip, then the task list beside one Note|Scratchpad panel. From 1280px
those two sit side by side, each scrolling on its own. Below 1280px they stack and the whole work column
scrolls. The CSS classes are `.pp-focus-work`, `.pp-focus-lower` and `.pp-focus-pane`; the media query reads
viewport px, so the shell zoom does not move the breakpoint.
- **Hero model.** `focusNowModel(run, chunks, now, n, isRoutine)` is PURE. The hero is the RUNNING timer's
  task; else the timeline block spanning now; else the next block today; else none. `next` lists the
  following blocks, one per task, at most `FOCUS_NEXT_N`. Meals never qualify. Routines (`isRoutineTask`)
  are never the idle hero and never "next up", but a running routine is still the hero.
- **Hero rendering.** `renderFocusNow` draws `data-focus-hero=<running|current|next|none>`. It holds the
  Pomodoro as its timer segment (`renderPomodoroPanel({inHero, taskId})`). Then come the name (opens the
  task), spent-today/allotted as a bar and a sentence, Start/Stop (`data-focus-hero-toggle`,
  `startTimer`/`stopTimer`, so the single-timer policy applies) and Done. Next up is the third segment.
  The hero renders no `data-task-id`, so the task-list row queries are unaffected.
- **Pomodoro colours are tokens.** A focus phase and the mirror use `--accent`; a break uses `--calm`. The
  ring used to be a literal salmon red. Inside the hero the Pomodoro's own Start is outlined, because the
  task's Start is the primary action. An idle Start binds to the hero's task, which replaces the old picker.
  The gear is a `HIT_MIN_PX` button (`data-pomo-gear`). Called bare, the panel still renders a
  self-contained card.
- **Habits strip.** `renderFocusHabitStrip` puts today's habits on one row as `habitChip` toggles (shared
  with the Today view; real buttons at `HIT_MIN_PX`/`SHELL_ZOOM`), with a done count and "+ Add habit".
  With nothing due it is a single line. `habitDraftField(stateKey, qa)` is the inline name field
  (owner 2026-08-24: Enter commits, Escape abandons, blank is a no-op). Focus and the Habits view both use
  it, so neither creates an unnamed "New habit".
- **Note | Scratchpad tabs.** `renderFocusNotes` shows one editor at a time. Note is today's journal entry
  (`pp-journal`, `#pp-journal-editor`); Scratchpad is the running doc (`pp-scratch`, `#pp-scratch-editor`).
  The tab persists as `focusNoteTab` in `pp-prefs` (default `scratch`). `gotoScratchpad` (`n`) selects the
  Scratchpad tab.
- **Music.** `renderMusicDock` is kept, but it renders only when `MUSIC_WIRED` is true (false until an
  audio engine exists).

**Habit consistency counts from creation.** `habitTrackStart(hb)` is the day tracking starts: `createdAt`,
or an earlier deliberately ticked day, because a back-filled check opens the window. `habitConsistency`
stops there. Today counts only once it is done, which is the streak's grace. The Habits view draws the
days before the habit started as dashed "before" cells (`data-habit-cell`) and adds weekday ticks under
the 14-day strip. It moves Delete behind a ⋯ menu (`data-habit-menu`) and shows `—` when there is nothing
to score yet.

### Review, Journal and Archive (UI revamp block 10b, 2026-10-04)

**Review is a weekly review.** The page header carries `‹ This week ›` (`renderReviewWeekNav`,
`state.reviewWeekOff`: weeks back from this one, never above 0; a "This week" button returns). Weeks run
Sunday to Saturday, like `weekStartMs`. The Stats column is now "Week in review" (`renderReviewWeek`); the
legacy `stats` page view renders the same thing. Habits and Needs planning stay beside it.

- **One ledger.** `reviewTrackedByDay()` folds every task's `spentByDay`, plus a running timer's live part on
  the day it started, into `{ymd: {total, bySec}}`. Archived tasks count; milestones do not. Every card and
  the day grid read this one map, so a day reads the same everywhere. The old grid drew 35 days over a 14-day
  ledger and showed real days as `0:00`.
- **Equal-length comparison.** `reviewWeekData(off)` compares the week with the week before over the SAME
  number of days. This week so far (Sunday to today, `n` days) is compared with the same `n` days of last week;
  a past week is compared with the whole week before it. `perDay` is `null` for days still to come, never 0.
  `reviewVsText` says which comparison it is.
- **Time by section.** Minutes group by the root section (`rootSectionId`), drawn in `sectionHue`, the
  Gantt/timeline colour. A Routines section is drawn in `--routine-edge`, as routines are elsewhere. Tags were
  folded into sections, so the old "Time by tag" read everything as "untagged". `statsData` still returns
  `byTag` for its old tests, but nothing renders it.
- **Cards answer one question each**: How much did I track? · What did I finish? · Where did the time go? ·
  Were my estimates right? · When did I work? Each gives an answer with units (`fmtHM`: "12h 40m") and a
  delta against the comparison window (`fmtDeltaHM`). "Finished" counts completions stamped in the window: a
  repeat counts each completed occurrence, and routines are counted apart. The estimate pairs finished
  non-repeating tasks that had a Planned budget with all the time they took. Dropped: on-time rate (an
  all-day end's due instant is ambiguous, so it cannot be computed truthfully), today's plan-vs-actual (that
  is Today's job), and the overdue/to-plan counts.
- **The day grid** (`reviewHeat`) shows `REVIEW_HEAT_WEEKS` whole weeks ending at the selected week, with
  real data on every day up to today. Its steps are `REVIEW_HEAT_STEPS`, accent mixed into `--card-bg`, and the
  lightest step stays legible on the light theme. Each week column is a ≥ `HIT_MIN_PX` button that opens that
  week, and its total sits under it.
- **Empty states.** A card with nothing in it explains what will appear there and how. When there is no data
  at all, a lead card explains the page and there is no empty grid or "0:00 / 0:00" legend. Empty-state copy
  uses `--text-mut`, not `--text-faint`, which fails AA on the light theme. An empty Habits column gives up
  width and says what will appear in one top-aligned line.

**Review queues leave routines out.** `reviewSkip(t)` is true for routines (`isRoutineTask`), Points
(`isPointTask`), and clock-only tasks (a written start clock on a task that does not compress,
`isUncompressable`). Their time is their clock, not a Planned budget. `reviewUnplanned()` (the `unplanned` chip
minus archived work, milestones and `reviewSkip`) is the **only** builder of a Needs-planning list: Review's
column, the Journal rail, `statsData.unplanned` and the morning summary (`morningSummaryData`) all read it. Do
not filter the `unplanned` chip directly for a Needs-planning surface — the morning summary once did and kept
listing the seeded routines on later days (`tests/morning-summary-planning.test.js`). `agingTasks` (the "Still
relevant?" prompt) applies `reviewSkip` as well.

**The Journal opens on "Your day".** `journalDayModel(B)` merges `journalActuals` and `journalAutoLog` into one
row per task: `done`, `worked` or `planned` (today only). Rows run done → worked → planned, most time first.
Routines fold away: one with tracked time keeps its row, a ticked one without time is listed by name, and a
planned-only one is dropped. The card (`data-journal-day`) leads the main column, always expanded, ahead of the
prompts and the entry. It shows at most `JOURNAL_DAY_ROWS` done/worked rows and `JOURNAL_DAY_PLANNED_ROWS`
planned rows before "+N more". Done and Actuals left the rail. The day arrows are real `<button>`s with
labels, sized `HIT_MIN_PX / SHELL_ZOOM` so they render at 24px (`data-journal-nav`). There is no Shutdown flow
in the app (Shutdown is a Todoist routine), so nothing links from it.

**Archive.** `archiveRows()` gives each archived task the one date its row shows: `Done <completion>` for a
completed task, `Archived <archivedAt>` for one never completed. Rows sort by that date, newest first. The date
column is 150px and never wraps. Delete is a quiet text button rather than a red one on every row.
"← Back to Plan" stays.

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
rows aligned by construction rather than by two call sites agreeing. Sections are the **only** grouping.

**Group by is deleted (owner 2026-09-10).** Owner: *"Section view should always be the case and not
mutually exclusive with included."* `state.groupBy`, `setGroupBy`, `effectiveGroupBy`,
`inclusionProjection` and the `__incl_in` / `__incl_out` bands are gone; a stored `groupBy:'inclusion'`
migrates to `inclOnly:true`. Inclusion is a **filter** now — see *The Included filter* below — which is
what lets it compose with sections instead of replacing them. The drag-a-row-across-the-divider gesture
went with the bands: a row drag re-sections and reorders, and inclusion is written by the row's own
checkbox (`taskInclControl`), which the 2026-08-20 ruling had already made the single path for it.

**An empty section drops out of a FILTERED view (owner 2026-09-10).** Owner: *"Filter views should remove
empty sections from view."* An empty section you made still renders when nothing is filtering — it is a
container you keep — but while `hasFilters()` is true a header over nothing says only "your filter
excluded all of this", which is a row spent on an absence. Judged on the section's own post-filter
emptiness, so the No-section bucket needs no special case.

`sectionGeometry`
is the one vertical-geometry pass, returning `_yTop` (indexed by the flattened task list) **and**
`_secLayout` (each band's full extent); the second exists because `_yTop` cannot answer "which section
owns this Y", and an empty band owns Y-space but no row. `sectionAtY` resolves a drop into a band,
including an empty or collapsed one. A row drag re-sections inside the same `commit()` as the reorder, so
one drag is one undo step. The header height comes from `sectionHeaderH(sec)`: `TAG_SECTION_H` for a
section with tasks (collapsed or not), the thin `SECTION_EMPTY_H` for an EMPTY one (UI revamp block 6 —
"empty states collapse"; it is still a band in `_secLayout`, so still a drop target, and it shows "+ add").
Both are consumed by matching sheet headers and Gantt rails, and Gantt `_yTop` continues to index tasks only. Normal and milestone task rows retain the
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
striping, hover and selection. Inclusion is now read from `taskInclControl`'s explicit ☑/☐/💤 glyph.
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
| | **Section hue at full strength from the left edge to `pct%`** (UI revamp block 8) | % done. A 100% bar is the full hue edge to edge; a 0% bar has no fill at all |
| | **Section hue, toned** (UI revamp blocks 7–8) | The remainder: the task's root section's colour (`taskHue`, the same hue the Day/Week/Agenda blocks are filled from; `SECCOL_NONE` with no section) mixed toward `--gantt-bg` by `ganttTone`. **Not** priority and **not** tag |
| | Neutral `--routine-bg` | A routine (`isRoutineTask`) — see the block 8 section below |
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

### Readable Gantt (UI revamp block 7, 2026-10-04)

**Bars carry their names again.** The 2026-08-12 removal (see the note above `ganttBlock`) was about
density: a daily repeat drew one label per occurrence. Both causes are now gone — Chain 6 block 44 merges
consecutive occurrence days into one run, and **a repeat names only its first painted run** (`lab.show` from
`renderGantt`). `ganttLabelPlan(name, w, room)` is the pure rule: inside when the whole name fits (leaving
`GANTT_PCT_RESERVE_PX` for the n% readout), outside when the whole name fits in the `room` up to the next bar
in the same row, otherwise whichever side shows more, and nothing below `GANTT_LABEL_MIN_PX`. A diamond has
no inside. Labels are `pointerEvents:none`. An inside label is drawn ONCE in one ink (`ganttLabelInk`, UI revamp
block 8 — block 7's two clipped copies read as a seam through the word). While the link dots show, an
outside label steps past them.

**One colour meaning.** A bar's remainder is its section hue (`ganttBarPaint` → `ganttHueOf`, one lookup
context per render). Critical (opt-in) still outranks it; priority is the sheet's circle only. Block 8
replaced the green done-fill with the hue itself (see below), which retired the green-on-green overlap
block 7 had accepted.

**Tooltip.** The native `title` on the bar body and diamond is retired: it would have doubled the drawn
tooltip. `renderBarTip` draws "Name · Tue Oct 06 → Thu Oct 08 · 1:30 planned" (`barTipModel`: start through
`fmtDT`, end through `fmtEnd`, planned through `fmtDur`; displacement and the description snippet as extra
lines) as a fixed overlay anchored through `uiPt`. Its machine-readable twin is `data-gantt-tip` on the bar
body, which starts with the name (then ` · occ n` on a repeat) — **e2e specs address bars by
`[data-gantt-tip^="Name ·"]`**, not by `title`.

**Row ↔ bar link.** One `hoverId`, as before: entering a bar writes `hoverId` and `barTip` in ONE setState
(`barHoverEnter`), so the sheet row takes its hover fill; a hovered sheet row rings its bar with
`--bar-hover-ring` (`data-gantt-hover="1"`). No mousemove-driven state.

**Hit boxes.** A Gantt handle's box is `GANTT_HIT_PX` = ⌈`HIT_MIN_PX`/`SHELL_ZOOM`⌉ local px, so it RENDERS at
24px. Each resize grip keeps its 7px inside part (`BAR_GRIP_PX`, so `pctGrabZone` is untouched) and gains a
`BAR_GRIP_OUT_PX` extension outside the edge (`data-gantt-edge-ext`), live only while THIS bar is under the
pointer (`barTip`) or dragging — at rest a press beside a bar still belongs to the empty lane. The link dots
moved out past the extension (`left/right: calc(100% + BAR_GRIP_OUT_PX)`) so the two never share a pixel.

**Feedback during the gesture.** `renderDragChip` floats a chip beside the pointer (raw client px through
`uiPt`, `DRAG_CHIP_DX/DY`): during a Gantt drag it names the dates the release will write
(`ganttDragChipText` — both ends for a move, only the moved edge for a resize, plus the day delta and "held
by a dependency" when clamped); during a Day/Week/4-Day block drag it names the landing time
(`blockDragChipText`). It appears only past the same 4px slop every gesture uses, and the drop's toast with
Undo is unchanged.

### A quiet Gantt (UI revamp block 8, 2026-10-04)

Block 7's full-saturation hues made the chart loud next to the sheet. The rules now:

- **Body = the hue toned toward the pane.** `ganttTone(hue, base)` mixes the section hue into `--gantt-bg`
  at `GANTT_TONE` (0.55) — the same family as the Day/Week blocks' mix into `--tl-fill-base` — and steps
  further toward the pane (never below `GANTT_TONE_MIN`) until the label ink clears `TEXT_AA` (4.5:1). The
  pane colour is read from the live `--gantt-bg` token once per theme (`ganttToneBase`), so there is no
  second copy of its hex; with no DOM (the unit layer) the hue is returned untoned. The hue itself rides on
  `data-gantt-hue`, which is what tests compare against the timeline.
- **Progress fill = the hue at full strength** (`pctFillPaint(pct, paint.fill)`), so done and remaining are
  one colour at two strengths in every section. "Done" is simply a 100% fill; there is no green bar any
  more. The sheet's own % Done track keeps `--success-strong`.
- **One label ink.** `ganttLabelInk` takes the body's ink for the whole label; where the label crosses the
  fill and that ink is below AA there, a 1–2px halo in the opposite ink (`data-gantt-label-halo`) carries
  it instead of a second colour. A 100% bar's label takes the fill's ink. The in-bar n% readout takes the
  surface ink too (it used to be fixed white, which failed on the light theme's paler bodies).
- **Diamonds** are outlines, so they take the full hue (the toned body would vanish at 2px).
- **Routines are neutral** on the Gantt as everywhere: `--routine-bg` body, `--routine-fg` ink.

### The `Time needed` column

Owner, 2026-08-17: *"I wanted it as a column, not as something inside the detail panel."* `colDefs()`
carries `{k:'exact', w:104, l:'Time needed'}`, visible by default, between `% Done` and `actions`, and
At introduction, `name` was trimmed 354 → 250. Block 45 temporarily divided 140px of that width between
the returning Start and End columns. Owner testing widened Task from 110px to 180px; the divider-delta coupling below
now lets column geometry grow without changing which rightmost sheet content was already visible.

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
no date-specific preference path. Both cells are 70px. The Task column now defaults to 180px after owner
testing found 110px too cramped.

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
usable pixel floor and the last-column maximum remains reachable.

UI revamp block 6: the maximum is no longer the bare column edge once the user has CHOSEN a width.
`sheetMaxWidthPx()` adds `NAME_COL_GROW_PX` when a split is saved for the current key (or a drag is in
flight), `clampSplitPct` allows the same allowance, and the Task column is the one flexible column
(`colFlex`: `1 0 <w>px`), so the extra width goes to Task first while Actions stays flush right — still no
trailing whitespace. An unsaved default still opens at the column edge. Selection keeps its separate triage
floor and 28–78% clamp. The revised
`sheet-default-width.spec.js` covers Today and Schedule at 1280, 1600, and 1920 pixels, real divider
compression/persistence, the right-edge clamp, and real column resize/hide/reorder gestures.

Column resize, hide/show, and reset translate their total local-pixel width delta into the divider's
rendered percentage. Changing columns therefore moves the divider by exactly the same distance and
preserves the existing horizontal clipping; only dragging the divider changes how much is clipped.

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
- `props.showCriticalPath` — the mount prop in the bootstrap's `APP_PROPS`, default `true`; an explicit
  `false` vetoes the setting (an app-wide kill switch).

**Do not collapse these into one flag.** The two flags answer different
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

**The hatch collision logged in the backlog is resolved by this deletion.** The two hatches read alike at a
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
**Plan** (`renderDashPlan`, V2.10) owned Selection and Matrix via `state.planTab`. The split was a
statement about what each surface answers: the six Overview views place work **in time**, the Plan views
decide **what is in today**. Before V2.10 all eight sat in one toggle, which read as "pick one instead of
the others" rather than "decide, then place". Both later moved: block 27a rehomed Selection into
Overview's left pane, and A8b (2026-08-21) deleted the Matrix outright.

Both tabs render their sub-view selector through `renderFilterBar`'s leading slot, so the same chips and
sort narrow every surface. `dashMode` and `planView` both survived a meaning change in V2.10 and are read
through the pure `migrateDashMode` / `migratePlanView` helpers, never raw: `'plan'` named the scheduling
board before the rename and the selection surface after it (disambiguated by a `dashModeV: 2` stamp), and
`planView` may still hold `'select'`/`'matrix'`, which have left that enum. Both failures land a returning
user on a surface they never chose, without erroring — hence the named helpers and their tests.

**Selection** is a set of derived origin buckets (`originOf`) rendered as `planCard`s.
**Matrix** was an Eisenhower grid beside it, sharing one card-drag path. It is **deleted** (owner ruling
A8b, 2026-08-21) along with `renderMatrixView`, the Eisenhower axes, and the shared drag: the surface was
retired in V5 block 32 for never touching inclusion or scheduling, and once Task 8 made ticking the
Selection gesture the drag had no consumer left. Do not resurrect either from git history without an
owner decision — this deletion IS the decision. `unpressed` renders visibly distinct (dashed edge) so
undecided work is never displayed as decided work.

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

**The inclusion checkbox is a checkbox (owner 2026-09-11).** Owner: *"When ticking the checkbox of an
included task, immediately make it excluded and unticked until it's triggered. Have a seperate button for
a scheduled snooze."* `taskInclControl` now acts in BOTH directions and opens no menu in either: ticking is
`tickOnToday`, unticking is `untickOnToday` → `snoozeIndefinitely`, which is off until the work itself asks
again (it starts, it falls due, or its last dependency finishes). The 2026-08-20 asymmetry — unticking
opens the window because three durations are three different answers — was right about the answers and
wrong about the control; the durations moved to **`taskSnoozeBtn`**, a 💤 sibling in the same actions cell
on the sheet row and on line 3 of the card, which opens the same `inclActionRows` menu. That button
replaces the card's old 💤 shortcut, which snoozed until tomorrow without asking, so the two surfaces can
no longer offer different snooze gestures.

The glyphs split with the controls: **💤 means a SCHEDULED snooze**, and the open-ended state the checkbox
writes renders as a plain unticked ☐ whose tooltip names its wake triggers. `snoozeIsOpenEnded` is that
distinction and `snoozeUntilLabel` is the sentence every surface prints — `new Date(null)` had been
rendering "Invalid Date" wherever a dateless snooze was described, which the untick makes the common case.
A deliberately narrow scope note: the menu still exists, and it is still the only place "Turn on" and a
date live, so the popover and the detail-panel field are unchanged apart from that label.

**V2.11 — the cards ARE the row.** Eleven shared builders (`taskDisp`, `taskDoneCircle`, `taskDueRecurChip`,
`taskInlineTags`, `taskDepChips`, `taskInclControl`, `taskSnoozeBtn`, `taskFlowCell`, `taskTimerBtn`,
`taskAddTimeBtn`, `taskDescToggle`) are the single definition of every list-row control, and both `renderSheet`'s row and
`planCard` call them, so parity holds by construction rather than by two copies agreeing. Cards carry the
row's gestures too (click → details, right-click → row menu; double-click no longer activates — UI
revamp block 6) while mousedown
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
same lossy gesture this app has always refused.

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
— the old strip to the right of a bar that used to hold this readout — is deleted. Since UI revamp block 7
a bar's right holds the grip extension, the link dot and, when the name does not fit inside, the name.

*History worth keeping:* the caret's drag gesture worked, and `tests/e2e/pct-drag.spec.js` proved it with
real pointer input in both directions. The owner still could not use it. A 24×16 box, invisible until hover,
in the 10px gap below the bar, is not findable — a passing gesture test is not a usable control.

### The Escape ladder

`onKey`'s Escape branch is a ladder, and exactly one rung fires per press — most transient first:

0. **a focused field** — revert to its focus-time value, then blur (owner, 2026-08-19)
1. **an in-flight drag** — `_edgeDrag`, then `_blockDrag`
2. **the topmost overlay** — `datePick` › `pctPop` › `inclPick` › `barMenu` › `quickOpen` › `scopePrompt` ›
   `settingsOpen` › `colMenu` › `selCols` › `menu`
3. **the open detail sheet** — `detailId`
4. **the row selection** — `clearSelection()`, which empties `selectedIds`, `selCols` *and* `selCursor`

**Rung 0 is not a convenience exception to the ordering** (owner: *“esc should be able to get the user out
of fields like the planned duration”*). A field the user is mid-keystroke in is strictly more transient than
a drag — the drag rungs cannot even fire while a field holds focus, so nothing below it is reachable anyway.

It REVERTS, then blurs, and the order matters: every `onBlur` in the sheet writes through `commit()`, so a
bare blur would SAVE and make Escape the one key in the ladder that commits. Restoring the focus-time value
first means the blur handler writes back an unchanged value and no undo entry is created. The draft is
captured by a document-level `focusin` rather than a shared field `onFocus`, because there is no shared
`onFocus` — fields are built by several different helpers; one record suffices because only one element can
hold focus, and `focusout` clears it so a stale draft can never be restored into the wrong element. Fields
belonging to an overlay are excluded: `datePick` and `pctPop` own their own Escape and rung 0 must never
steal an overlay close from them.

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

### Enter confirms a single-value editor (owner, 2026-08-19)

The owner: *“enter doesn’t have, one needs to press enter then done”*. The date picker’s TIME box blurred on
Enter, and blur only updated the picker’s DRAFT — `dpApply`, on the Done button, is what wrote the task. So
setting a time cost a key and then a click.

Enter now calls `dpSetTime` and then `dpApply`, in that order, inside `dpApply`’s single `commit()`, so the
whole edit stays one undo entry. `onBlur` still calls `dpSetTime` alone, so Tab commits and moves on
*without* closing — which is the only way to set a time and then adjust the date.

**The general rule this establishes:** any single-value editor with a confirming button must also confirm on
Enter and cancel on Escape. A new editor that offers a Done button and no Enter is a defect, not a gap.

### Bare typed hours inherit the field’s meridiem (owner, 2026-08-19)

The owner: *“I’ll think ‘okay this task is 10pm, I want it to be 9pm instead’ and type 9 only for it to end
up as 9am.”* Decision: keep the current field’s meridiem.

`resolveBareHour(tok, currentMs, dayWindow, otherEdgeMs)` is pure and rung-ordered: an explicit meridiem
always wins; an hour **above 12** passes through untouched (load-bearing — `clockH` does `h % 12` before
adding 12, so `17` with an inherited `am` would come back as 5am); otherwise the field’s own meridiem is
inherited; an empty field prefers whichever reading falls inside `[dayStart, dayEnd]`; a tie breaks toward
the task’s other clock; and with nothing to go on, am.

`parseClockTok` now also accepts the one-letter forms `9a` / `9p`. Without that the owner’s own listed form
`9p` did not parse at all and set no time.

### Day-bound handles

The timeline’s hour gutter carries two 7px grab strips, top and bottom, that drag `settings.dayStart` /
`dayEnd`. They reuse the `_edgeDrag` record, so the 4px promotion threshold, the `uiPt` px→minute rule and
the existing Escape rung (which nulls `_edgeDrag` without caring what KIND it is) all apply unchanged. Alt
drags free; otherwise the bound snaps to 5 minutes. A press that never crosses the threshold, or a drag that
lands back on the same value, writes nothing — a stray press must not consume a Ctrl+Z.

They sit in the GUTTER, never over the block area, and only on the labelled column. A full-width strip at
the column’s bottom edge covered any block dragged there and swallowed its clicks. Block gestures are used
constantly and must win the pointer.

**Undo for the day bounds is its own record.** No setting has ever been part of the task history —
`snapshot()` serialises `state.tasks` and nothing else — and the owner chose a bounds-only record over
moving all of `settings` into that history. `_undoKind` interleaves the two stacks so Ctrl+Z always undoes
the most recent ACTION rather than preferring one stack, which is what keeps “bounds drag, then three task
edits, then four undos” behaving the way a user expects.

### The inclusion popover offers three distinct actions (owner, 2026-08-19)

The owner: *“Snooze today and take out of today are practically the exact same thing and is therefore
useless.”* They no longer are:

| Action | Mutator | Meaning | Ends when |
|---|---|---|---|
| **Not today** | `snoozeToday` | not yet | midnight |
| **Snooze indefinitely** | `snoozeIndefinitely` | not yet, open-ended | one of the four wake triggers |
| **Take out of today** | `setIncludedOff` | not chosen | the task’s own triggers press it back |

This keeps the existing division of labour intact — *snooze means “not today”, unpressed means “not
chosen”*. The third option gives “not now” an open-ended form; it does not blur the line. A dateless snooze
has no day to print, so the popover names the EVENTS that end it instead of formatting a date that does not
exist.

### Nest intent depends on the drop target's kind (owner, 2026-08-19)

A row drag carries two possible meanings on one gesture: *file this into that section* and *nest this under
that row*. They used to be told apart by horizontal offset alone — `dx = e.clientX - rd.startX`, the
distance from the GRAB POINT, past `ROW_NEST_DEADZONE` (14px).

That made the section drop unreliable in a way that looked arbitrary. Drift more than 14px right while
crossing into a section and `steps` went positive, `projectRowDrop` gave the row a parent, and the section
gate (`drop.parentId==null && res.sectionPos!=null`) closed — so `sectionId` was never written and the row
silently stayed where it was. Leftward travel produced NEGATIVE steps, which only outdent an already-root
row, so parentId stayed null by luck. Hence the owner's report: *"dragging into section only works when I
drag to the left little bit of the section, not for the whole section row."*

The rule now: **a drop that lands in a different band than the drag started in is a section drop, and
carries no nest intent.** `steps` is forced to 0 for it. Owner: *"There's no valid intent behind 'nesting
under this section'."* Nesting is untouched WITHIN a band, which is where it means something — rearranging
a row among the siblings it already lives with. Moving a row into another section and then nesting it there
is two gestures, deliberately: each says one thing.

`projectRowDrop` is unchanged and remains pure and unit-tested (`tests/dragnest.test.js`); the fix is about
which intent the call site hands it. `tests/e2e/drop-into-section-band.spec.js` sweeps five offsets over
both a section header and a row inside the band, and pins same-section nesting separately so the scope
cannot quietly become a removal.

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
a column the hours are readable without labels: a stronger line every sixth hour, `pointerEvents:none` so
it cannot intercept a block drag. The alternating band per hour that V4.1 added beside it was **deleted**
by the owner on 2026-08-20 (Task 17): the stronger sixth-hour line carries the same rhythm without
striping the surface the blocks are read against.

Blocks used to distinguish **locked** from **auto-scheduled** by marking the RARE case with a heavier
border (V5 block 25b, `TL_LOCK_BORDER_PX` in `--tl-lock-border`). **The owner CUT that on 2026-08-20**
(Task 23), having been shown three restyled replacements: *"they look better. I just don't see the need
for a locked indicator at all."* Every block carries `TL_BLK_BORDER_PX` now, on the timeline and on the
Schedule agenda chip alike — the two carried the same signal deliberately, so they lost it together.
`--tl-lock-border` is gone with it. `tests/e2e/block-colour.spec.js` asserts the ABSENCE (one border
width across locked and auto blocks), because "no signal" can regress as quietly as a signal can.
What survives says something else: a **dashed** border still means drag-pinned or a fixed window (the
shape of the day, not its lock state), and the 📌/📍 glyphs still name why a block sits where it does.

**The pinned EDGE rule (owner 2026-09-10).** Owner: *"Give tasks with pins and times a inside facing red
border on the side(s) with the pin in the timelines."* A block runs top = start → bottom = end, so the
side is the edge whose **instant** the user actually fixed:

| shape | top | bottom |
|---|---|---|
| drag pin (carries its own `pin.dur`) | red | red |
| clock-fixed appointment, end time written | red | red |
| clock-fixed appointment, open end | red | — |
| auto-scheduled | — | — |

Drawn as two `inset` `box-shadow` layers (`TL_PIN_EDGE_PX`, `--tl-pin-edge`) rather than a border, so it
cannot change the block's box and it faces *into* the block as the ruling asks; they are listed **before**
the left rail so the red owns the corners the two share — the rail says who placed the block, this says
which instant is nailed down, and the nailed instant is the more specific claim.

The edges are decided at BUILD time (`dragBlocksOn` / `fixedBlocksToday` → `fixTop`/`fixBot`, carried
through `dayIntervals`'s `addBusy` onto the chunk) because only there is the unclipped instant still
known: a block cut by midnight **or by the day window** draws an edge nobody placed, and that edge is not
fixed. `data-tl-fixedge` (`top` | `bottom` | `both`) is the e2e hook, so a failure never has to match on
a colour. Scope is `renderDayColumn` — the drawer and the Week/4-Day grid — per the owner's ruling; the
Schedule agenda chips and the Gantt bars are deliberately untouched.
V5 block 25a **deleted** the diagonal hatch that used to mark auto-scheduled blocks, along with
`--tl-hatch`: nearly everything is auto-scheduled, so the texture covered ~90% of the week and carried no
information — the same measurement that retired `ambientRowBackground` in V2.9.

**Block colour has exactly one source** (V5 block 25c, `tlSurface()` — `TL_TYP()`'s four per-kind
families are retired). **What that source encodes changed on 2026-08-19**: a task block is filled with its
**section's** hue, not its priority. Owner: *"Assign different colors to different sections for the timeline
blocks"* / *"Get rid of the priority coloring."* The scope is the **timeline only** — the sheet, the month
calendar, the dashboards and the priority picker / P1–P4 filter chips all still read `PCOL`, because on a
picker the colour *is* the control's meaning rather than decoration.

**Stored at creation (owner 2026-09-12).** *"Give each section a color at instantiation time. Don't have it
change if I delete a [section]."* The first cut assigned `SECCOL` by position in `sectionsInOrder`, so
deleting or reordering a section re-coloured every section after it. A section now carries a `color`
string, picked once by `pickSectionColor` (the least-used `SECCOL` hue, palette order breaking ties, so a
freed hue is reused before any is doubled) in `addSectionTo` and `migrateSectionsFromTags`. It rides inside
the `sections.data` jsonb, so no migration was needed. Legacy sections are frozen with the hue they already
wore (their order position) by `ensureSectionColors` — once at startup through `backfillSectionColors`, and
on every sections pull so the frozen value is pushed back. `sectionHue` reads `color` and falls back to
order position only for a section not yet backfilled. A task with no section — and one whose `sectionId`
points at a deleted section — takes the reserved `SECCOL_NONE` rather than borrowing whichever section
happens to sit first.

**Focus-mode timeline (owner 2026-09-12).** `renderDayColumn` takes two options only Focus passes.
`fromNow` starts the column at the later of the day start and now (keeping at least
`FOCUS_TL_MIN_SPAN_MIN` visible, and dropping the start-bound handle, which is off-canvas). `fill` makes the
column a flex slot that never scrolls: the body's slot is measured by `observeFocusTLHeight` (kept apart
from `_tlAvailH`, which belongs to the scrolling Today/multi-day wrappers) and fed back as `availH`, so the
Unscheduled box is subtracted before the day is fitted. That box is bounded to `FOCUS_UNSCHED_MAX` single-line
rows plus a "+N more unscheduled" count. Cover: `tests/e2e/owner-2026-09-12-focus-timeline-fit.spec.js`.

`rootSectionId(t, byId, defById)` is now the single answer to "which section is this task in?", shared by
`tasksBySection` and the timeline's `taskHue`, so the colour and the grouping cannot disagree about where a
task lives. A subtask has no section of its own; it inherits its root ancestor's, which is the rule the
sheet has always filed by.

Historically the block was filled with the task's own `PCOL[priority]`, the identical map the
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

The Schedule agenda's chips (`renderScheduleView`) carry the same idiom as of 2026-08-25:
`data-sched-block`, `data-sched-task`, and `data-sched-kind` (`drag` when the chip is draggable,
`static` when it is not). The kind is not decoration — it says which code path a click on that chip
takes. A draggable chip has `onClick:null` and opens details through the block **mouseup**'s no-move
branch; a non-draggable one opens details through its own `onClick`. A spec that cannot tell the two
apart cannot say which one it proved. Families additionally carry `data-sched-family` and
`data-sched-kid`, from the C1 subtask ruling. Pinned by `tests/e2e/block-click-details.spec.js`.

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

### Timeline legibility (UI revamp block 8, 2026-10-04)

**Compact chips.** A block of `TL_COMPACT_MAX_MIN` (20) minutes or less — or one whose drawn height is under
`TL_FULL_MIN_PX`, which is what a 45-minute block becomes in a Week column — renders as a one-line chip
(`tlIsCompact`, `data-tl-compact="1"`): the name, then its start time, ellipsised, at least `TL_CHIP_H_PX`
tall, no ▶ column unless it is running. Block and chip titles are `TL_BLOCK_FS` (14 local px), so they
RENDER at ≥ `TL_TEXT_MIN_RENDER_PX` (11px) under the 0.8 shell. The start time is the `data-tl-chip-time`
attribute drawn by a CSS `::after`, so the block's text — what the hover card, the specs (`timelineBlocks`)
and assistive tech read as its title — is still exactly the name. Applies wherever `renderDayColumn` draws:
Day, 4-Day, Week and the Focus side timeline.

A chip is taller than its minutes, so it spills into whatever follows. `tlChipLayout` (pure, one pass down
the column) keeps both readable: a chip never starts above the previous chip's bottom (a run of short
blocks reads as a list — each names its own start time, so the nudge cannot misstate when it is), and a
regular block a chip spills into keeps its TRUE top but pads its title below the spill, the chip painting
above it at z 2 (under Points and the now-line). A block being dragged is placed exactly where the pointer
puts it. The heights the layout returns are drawing, not accounting: a chip's box no longer equals its
minutes, which is why it is marked `data-tl-compact`.

**The visible range.** It used to be exactly the day window, so a Wakeup at the day start sat flush under
the column header and a Shutdown near the end ran off the bottom of every Week column. `tlViewRange(B, win,
items)` widens the window so the first and last block whose time the TASK states (a clock appointment or
routine — `fixed` without a drag pin) or Point keeps `TL_RANGE_PAD_MIN` of room, snapped outward to
`TL_RANGE_SNAP_MIN`, clamped to the day's midnights (`tlRangeItems`). Packed and dragged blocks never widen
it — the packer only places inside the window, and a range that followed a drop would rescale the column
under the pointer; a chip at the very end of the column lifts to stay inside it instead. Clock windows
(Free time) are settings and never widen it either. The room outside the window gets a faint `--tl-outside`
wash (`data-tl-outside`). A multi-day grid builds each day once and shares ONE range (`multiDayRange`,
minutes from midnight) across its columns and the hour gutter (`renderHourGutter(availH, range)`), so the
labels still sit on their lines. The day-bound handles stay on the bound's own line (they already did,
since Task 12), and Focus's from-now column keeps its own start. Block drags are unaffected: the px→minute
conversion is relative.

**Routines are neutral** (`isRoutineTask`: the Routines section, an `@routines` tag, or a daily repeat at a
clock time). The Routines section's palette slot happened to be `SECCOL[5]` red — the same red as danger
and the current-block border — so every Wakeup/Lunch/Dinner read as an alarm. `tlSurface` now gives a
routine `--routine-bg` / `--routine-fg` / `--routine-border` and a neutral rail; its pinned edges stay
`--tl-pin-edge` red, because the owner's 2026-09-10 edge rule covers every clock-pinned block. The 📌 glyph
names it (`data-tl-routine`). The neutral fill holds on the Gantt and the month calendar too. Red stays
for danger and for pinned instants: critical path, pinned edges, the now-line.

**Month.** `monthCellLines` decides a cell (pure): real work first, ranked by priority (P1 first) then
planned duration (longest first); every routine folded into ONE "📌 N routines" line
(`data-pp-month-routines`); display-only events last. At most `MONTH_MAX_LINES` rows: when the cell
overflows, the routine line keeps its row, work gives way, and the last row is a real **"+N more"** button
(`data-pp-month-more`) counting tasks. It opens the day list (`state.monthMore`, `data-pp-month-pop`),
anchored to its cell by grid position: every work item (opens the task), the routines under their own
label, the events, and "Open week" (sets `weekAnchor`, switches to Week). A scrim closes it on an outside
press; Escape closes it as its own rung of the ladder, after the bar menu. The unlabelled count badge in
the cell corner is gone; the cell's tooltip says "N tasks · M routines".

**One "Exact" chip.** The sheet's Time-needed chip drew a decided Exact solid and a derived one outlined,
so routines (which store the decision) looked like a different control. Exact is now always the accent
outline on `--accent-soft`; decided vs derived is the italic face and `data-exact-src` (`set` | `derived`),
as for Flexible.

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

## The 2026-08-20 owner round, surface by surface

**Selection is two equal columns** (`selectionLayout`, Task 9). Five buckets stacked — Overdue/New/
Continued on your plate, Upcoming/Snoozed not — with each COLUMN owning the scrollbar and each bucket
header `position: sticky` inside it. Sections size to content; equal vertical bands were rejected because
they starve a busy Continued to give an empty New the same room. Column widths are equal flex factors that
read no count at all. `selectionColCount` is what the left pane's width floor reads, so the floor cannot
drift from what is painted, and `selectionFlat` walks the same layout so j/k moves the way the eye does.

**Timeline block controls** are a column of `HIT_MIN_PX` slots and the block's left padding follows the
slot COUNT. Three of them appear only when the task has earned them (✕ unpin, ⧉ regroup, ↺ reset); the
fourth, 💤 per-day snooze (Task 19), applies to every block there is and is therefore **hover-gated** —
mounting it unconditionally took a `HIT_MIN_PX` column off the left of every block, which 34 drag specs
reported at once. Hover-gated controls are children of the block that owns the hover, per the standing
rule. `tests/e2e/_seed.js` strips the control glyphs out of a block's title, and 💤 had to join that list
because it appears mid-drag.

**The block hover card** (Task 18) replaced the native `title` string for blocks that belong to a task: a
tooltip cannot carry a progress bar or two lines of different weight. `blockTooltipModel` is pure and
decides which countdown LEADS, which is a statement about who chose the time — a start clock leads with
"starts in", a deadline-only task with "due in" and its packer-chosen start as the secondary, a running
task with a progress bar and "ends in" alone. The card is a SIBLING of the block, never a child: the block
clips its own overflow to ellipsise long titles, and a card inside it would be clipped with them.

**Day-bound handles** (Task 12) are a `HIT_MIN_PX` hit box carrying a 3px bar and a grip, positioned at
the bound's own line rather than at the body edge — because `TL_BOUND_PAD_MIN` of hatched room opens in
the drag direction on drag-start and moves those two apart. `px` is computed from the UNPADDED window so
opening the room never rescales the day under the cursor; only `H` grows. The readout is the 12-hour
formatter; the STORED bound stays `HH:MM`, which is the settings format and not a rendering.

**Drag autoscroll** (Task 20) is one helper called from `onMouseMove` before any branch decides what the
move means, wired to the timeline drawer and the sheet. Speed ramps with depth into the edge zone, and it
is driven by pointer MOVES rather than a timer: a stationary pointer stops scrolling, and "stops when the
drag ends" is true by construction rather than by clearing an interval. A consequence worth knowing when
writing specs: a drag that reaches an edge scrolls the container, so one instant in the day can sit at
different viewport y's during a single gesture — assert the readout, not the box.

**The Schedule view's now-marker** (Task 24) is a rule BETWEEN entries, not the day timeline's
absolutely-positioned `nowLine`: an agenda list has no pixel-per-minute axis. It sorts into the same
ordered `items` list the chips and Points merge into, so it lands between the right two entries, and a tie
goes to the block — the rule marks where you are up TO.

**The sheet** gained two columns where there was one cell with an arrow (Task 27). `planned` keeps its key
so saved `colW`/`colHidden`/`colOrder` still name the column they always named, and `orderedCols` appends
`allot` to any older order. `planned` stays three-valued — `null` is an em dash, `0` renders `0:00` — and
both columns render `H:MM`, never the clock formatter. `taskFlowCell` survives as the CARD's rendering,
where the arrow still says which number feeds which because a card has no columns.

**Deleted this round**: the capacity readout, both the Today header figure and the per-day Week/4-Day
strip (`CAP_STRIP_H` and the reserved height with it); the Today view's active-task banner, Pomodoro bar
and music dock (Focus keeps the panel and the dock, and the pomo state machine is untouched — since UI
revamp block 10a the panel lives in Focus's Now hero and the dock renders only when `MUSIC_WIRED`); the
alternating hour band; and the `+15 min` button, replaced by a box that SETS today's tracked minutes.

## The filter bar (2026-08-25 redesign)

The Phase 7/C3 bar carried thirteen controls — five smart chips, four priority dots behind a
`Filters ▾` popover, a Sort select plus a direction chip, a Group select, and a field/contains pair.
Owner ruling: *"active today and startable and overdue and running are not selectors I would ever click
on. Get rid of the sort dropdown. The grouping shouldn't be a dropdown. I want a search bar where while
typing it gives a preview and when hitting enter it generates a filter view."*

The bar is now one row: a search field taking the leftover width, a **Horizon** segmented control, the
`Unplanned` and `Included` chips, `+ Section`, `Clear all`, then the untouched `leading` slot
(List/Selection toggle and the six view tabs). Horizon is the bar's one segmented control — it answers
"pick exactly one of N". `Included` is a chip because a chip is an independent on/off, which is exactly
what makes it composable with the rest (owner 2026-09-10; it replaced the `Section | Incl` segment).
Every chip carries `data-pp-chip` + `data-active` as its e2e hook.

### The Included filter

Owner, 2026-09-10: *"Included should include only included tasks and subtasks. An excluded subtask should
not be included just bc its parent task is included. A excluded parent task should still be shown if it
has included subtasks."* Two rules pulling opposite ways, which is why `inclOnlyKeepSet` is a keep-SET
and not a per-row predicate:

- inclusion is asked of the task **itself** (`inclBand`), so an excluded subtask no longer rides in on
  its parent's ticket — the grouping asked it of the subtree ROOT, which was the first half of the report;
- every **ancestor** of a kept task is kept whatever its own inclusion says, or the row could not be drawn
  at its indent. One included child is enough; the parent's other, excluded children stay hidden.

The set is built over `state.tasks`, not over the list being filtered: `visibleTasks` has already dropped
rows hidden by a collapsed parent by the time `filterTasks` runs, and a collapsed parent holding included
work must not vanish because the evidence for it was folded away.

**Only work that is still owed (owner 2026-09-11).** *"'Included' and 'Focus mode' task lists should only
include tasks with non zero time. In particular, if a task is marked as complete for today, even if it is
recurring, it should be taken off the list."* Both halves are one question — does this task still ask
something of today — so both live in `inclBand`, the only predicate the two surfaces share. `hasWorkToday`
vetoes on `requestedMinutes(t, today) === 0` (a deliberate `planned:0` — a dated marker, a top-hover
deadline line — asks for nothing; an unestimated task keeps its `DEFAULT_TASK_MINUTES` and stays) and on
`doneForToday`.

`doneForToday` asks completion of TODAY's occurrence via `occInDay`, deliberately not
`occPct(t, currentOccIdx(t))` — the shape Focus's own `taskDone` used. `currentOcc` prefers the first
occurrence with work LEFT in it, so the instant you ticked today's box it walked on to tomorrow's and
reported the task unfinished again; that is the whole "even if it is recurring" half of the report. Do not
substitute `allotOf` for `requestedMinutes` here: the allotment is computed FROM inclusion, so reading it
would close a loop.

Nothing is dropped silently — Focus still shows the vetoed rows in its counted "Not in today" band, and
the sheet shows them the moment the Included chip is off.

### Two parallel systems, never both authoritative

The chip/horizon path keeps the existing `state.chips` / `state.colFilters` / `state.inclOnly`
plumbing. Search gets its own pure `(text) → AST` parser and `(task, AST) → bool` evaluator.
`filterTasks` stays the single entry point and dispatches to **exactly one** of the two.

### The search grammar

| Token | Means |
|---|---|
| bare words | substring over name **and** description |
| `"two words"` | phrase |
| `/section` | section name, prefix-matched |
| `@tag` | label |
| `p1` … `p4` | priority |
| `by:` `before:` `after:` `due:` `start:` | dates, through `parseDateText` |
| `calendar:` | source calendar name |
| `is:unplanned\|done\|running\|overdue\|recurring\|milestone` | the retired smart chips |
| `-` prefix on any token | negation |
| `AND` / `OR` (uppercase only) | explicit combination — overrides the default below |
| `(` … `)` | grouping |
| `-(` … `)` | negate a whole group |

**Same-type tokens OR; different types AND.** `@work @home` is "either tag"; `@work p1` is "both".
Negation produces a *separate* group, so `@work -@home` reads "tagged work AND not tagged home" rather
than an OR over a mixed bag. Dates route through `parseDateText` — the same parser quick-add and the
When line use — so the language cannot drift from them and needs no date code of its own. Nothing
throws: an unrecognised token degrades to free text.

**Explicit operators (2026-08-30).** `AND` and `OR` are operators **only in uppercase**; `and`/`or` in any
other case are free text, so nothing anyone typed before they existed changed meaning. Precedence is
**adjacency > AND > OR**: a run of bare adjacent tokens is scored by the default rule above and an
operator joins the runs around it, so `@work @home AND p1` is `(work OR home) AND p1`. Parentheses
regroup, and a leading `-` negates a whole group — `-(p1 AND @work)` excludes tasks that are BOTH, which
`-p1 -@work` (excludes EITHER) cannot say.

The parse is three layers, all pure: `searchTokens` (lexer) → `parseSearchQuery` (recursive descent,
`parseSearchOr`/`parseSearchAnd`/`parseSearchRun`, leaves classified by `searchTerm`) → `searchEval`.
The AST has four node kinds: `{op:'default',groups}` — today's flat structure, unchanged, and the reason
an operator-free query still exposes `.groups` at the root — plus `and`, `or` and `not`.

Outside quotes, `(` and `)` are **always** their own tokens, so `(@work OR @home)` parses with the close
paren glued to `@home`. Accepted cost: a literal parenthesis must be quoted (`"("`).

Malformed input repairs rather than throwing, because the bar previews on every keystroke: a dangling or
leading operator is dropped, an unclosed `(` closes at end of line, a `)` with no `(` degrades to free
text, and `()` contributes nothing.

`is:unplanned` delegates to `matchChip(t,'unplanned',{})`, so the one surviving chip and its search
spelling cannot disagree. The placeholder **is** the grammar; there is no help popover by design.

### Invocation and preview

`s` opens and focuses the field, under the same guard as `q` (`isEditingTarget` excludes every editing
target, contentEditable included, plus ctrl/meta and an open detail panel). `/` is deliberately left
free. Typing shows a match count via `searchPreviewCount`, computed off `state.tasks` and **never**
through `visibleTasks` — the sheet must not move while the user is still typing. Enter applies; Escape
clears and blurs.

### Suspension is read-time, and writes nothing

Owner ruling: *"When search is active all other filters/sorts are saved and overridden. They will be
recovered when exiting the search view."* Implemented as **read-time suspension**, not
snapshot-and-rewrite. `state.horizon`, `chips`, `colFilters`, `inclOnly` and `sort` are never touched
while a search runs; every reader asks `searchActive()` / `effectiveSort()` instead. "Restored exactly" is therefore **the absence of a write** — it cannot drift, cannot
half-apply, and cannot strand the user mid-search if the tab dies. It is also what keeps the two systems
from ever both being authoritative. While a search runs the horizon and the chips are visibly
**parked** (dimmed, `pointerEvents:none`) rather than removed: the user must be able to see what is
coming back.

### The horizon slider

`horizonMatch(t, B, days)` = the task's span reaches into `[B, B+days]` **or** `t.included === true`
(owner: *"Include if a task has any overlap with the window filter, or if the user has included it."*).
Two consequences fall out of sharing the span derivation with `onListNow` rather than restating it:

- a **dateless task passes every horizon** for free — `ghostSpan` anchors it at today, so it reaches any
  window starting today. That holds the standing tenet (the laziest path never silently drops a task)
  with no special case to keep in sync. Note the premise correction: a dateless task is not "always
  included today"; it is the ghost span, not inclusion, that carries it through.
- an explicitly included task always survives, whatever its dates say.

The **near edge is deliberately open**: a span entirely in the past still matches, because overdue work
must never leave the surface. Repeats are answered from the recurrence rule — `occReach` expands once on
the series' horizon and asks whether any occurrence starts at or before the far edge — never by scanning
days, so a 1y horizon does not cost 365 packs. Clicking the **active** notch clears the horizon, which
is what keeps it one control instead of seven.

### The `check` column is the priority column

Owner: *"Make the first column the priority column. There's no instance in which we'd want to sort
completed/uncompleted anyways."* This adds **no column** — `check` already *was* the priority readout
(`taskDoneCircle` fills its circle with `PCOL[t.priority]`, and right-click cycles priority); it lacked
only a header and a sort key. It stays `lock:true` (not hideable, reorderable or selectable), so
sortability had to come apart from `lock`: `sortKeyOf(k)` resolves a column's sort key (`check` →
`priority`), and both the header and the column context menu route through it so the two cannot
disagree. A locked-but-sortable header gets a plain `onClick` rather than reaching `headPointerDown`,
which owns reorder-drag and ctrl-click selection — neither of which a locked column allows.

### Prefs migration

`migrateFilterPrefs(pf)` is pure over the raw prefs object: retired chip keys are dropped (`unplanned`
survives), `groupBy` is gone from the output entirely and a stored `'inclusion'` becomes `inclOnly:true`
(someone looking at the split was asking to separate today's work from the rest, and the filter is the
surviving way to ask that), a saved sort naming `tags`/`calendar` is cleared (both
stay *filterable* via `@tag` / `calendar:`, but neither has a column and the Sort select is gone), and
`horizon` is validated against `HORIZONS` so a hand-edited pref cannot produce a phantom window.
`colFilters` is deliberately untouched — `colFilters.priority` is still a supported spec, simply no
longer authored by a chip.


## Dependency arrows, and the two link dots (owner reports 2026-09-09)

Three reports about one control. The first was misdiagnosed the first time round and is corrected below:
*"Arrows start from the middle of a block and point down."* The reading recorded here was that the line
already left the predecessor's right edge and only turned too early, so the 13px stub was widened to 14
and the vertical leg moved to the middle of the gap. That was treating a symptom.

**The line did not leave the right edge** (owner, 2026-09-09b: *"dependency arrows must originate and end
from the side of a bar and must extend some distance past the bar, even if it needs to bend more times."*)
`renderArrows` departed from `xOf(occ.end)`, and bars are painted by INCLUSIVE day — `ganttDayBarGeometry`
gives `(last-first+1)*dayW` — so that x is the **left edge of the bar's final column**, one whole day-width
inside the bar. A column is always wider than the stub, so the vertical leg turned while still on top of
the bar it had just left, which is precisely the reported shape. `ganttBarRightX(allDay, start, end)` is
the departure pixel now: the day after the last painted one, derived by the same expression `ganttBlock`
uses to pick its `endDay`, so the arrow and the bar cannot drift apart at any zoom. The target side never
had the problem — `xOf(occ.start)` already is the target bar's left edge.

The **lane is spent outward only**. Signed, a negative lane subtracted from the departure walked the turn
back inside the bar it had just left, and at `L = -14` the approach landed past the arrowhead's own x, so
the last run went right-to-left and the marker pointed into the target instead of at it. Each lane now
pushes whichever end it belongs to further out, which keeps every edge's geometry distinct while both runs
stay at least one full `ARROW_STUB_PX` clear of their bar.

`arrowPath(sx, sy, tx, ty, lane, rowH)`, `arrowCorridorX` and `arrowLanes`/`arrowFanOffsets` are PURE and
own the whole geometry (`tests/dep-arrows.test.js`):

- **Forward** (a real gap): out the side, down the CORRIDOR at the midpoint of the gap, then in — so both
  horizontal runs are visible and roughly equal. Same row and a clear gap is one straight line, no
  corners drawn where none are needed.
- **Backward** (the target starts at or before the predecessor's end): out right, across the channel
  between the two rows, back left, then in. Six segments, which is what makes it read as a detour.
- **Lanes.** Edges are collected BEFORE they are routed, because sharing a corridor is a fact about the
  set and not about either edge — the old inline single pass could only ever draw them on top of each
  other. Parallel legs alternate either side of the true corridor, clamped so a lane never pushes a
  corridor outside the gap it belongs to.
- **Fan-out.** Several edges leaving one bar spread across its height, centred, so they do not start on
  one pixel and read as a single thick line that splits somewhere off to the right.

**Two link dots.** `startLink(e, task, occIdx, dir)` takes a direction: `'succ'` (the historic trailing
dot — "drag to what comes after") and `'pred'` (the new leading dot — "drag to what must come first"),
resolved on mouseup by writing the edge the other way round. Both dots sit fully OUTSIDE their edge,
clear of that side's resize grip, with the small circle drawn inside a `HIT_MIN_PX` box — the C3 rule,
now applied twice. The 2026-07-26 note that "there is exactly one link handle" is superseded, and the
objection it recorded (a circle drawn INSIDE the bar) is honoured rather than reversed.

The leading dot also answers the report more directly than as a handle: during a drag from anywhere, the
end you can aim at is shown on every other bar. The drop always worked — the whole row is the target —
but nothing on screen said where to let go.

### An arrow is anchored on the bar, not on the occurrence list (owner 2026-09-11)

Owner: *"arrows should be rerendered when dates change."* `renderArrows` runs on every paint and always
did; what had drifted was WHICH occurrence it measured. It read `_occById` raw — `occs[0]` for a target,
the matching `idx` for a source — and the bars loop does two things to that list before painting it: it
drops a repeat's past and completed occurrences, then MERGES what survives into runs. So `occs[0]` is
routinely an occurrence drawn nowhere, and editing a repeat's dates re-rendered the arrow faithfully onto
the invisible one.

The second half only a live gesture shows. A recurring bar previews its drag through `forceUpdate` alone
(`onMouseMove` returns early for repeats instead of remapping `state.tasks`), so `_occById` is unchanged
for the whole gesture by design — the block slid and the arrow stayed. Non-recurring drags remap the task
array and were already live.

`arrowOccOf(task, occHint)` is both fixes in one place: project the painted occurrences into runs, pick
the run the edge names (`runOccIdxs`, so a dep on occurrence 5 anchors on the run that holds it), then
apply the live drag shift using the identical expression `ganttBlock` uses — so the arrow and the bar
cannot land on different days. `predEnd`/`tgtStart` read it; `ganttBarRightX` still owns the pixel.

Note for whoever tests this: the `d` attribute is in SVG **user** units and the board runs at `zoom:0.8`,
so adding the svg's client x to a raw `M` coordinate compares two spaces and reads 25% long. Map through
`getScreenCTM()`.

### A fully merged repeat is not asked which occurrences a drag meant (owner 2026-09-11)

Owner: *"Rescheduling a recurring block: if all occurances are merged together, then dragging the start or
end should not have a popup for if its an individual or bulk change."* The scope prompt exists to resolve
an ambiguity; when every occurrence the chart PAINTS has merged into one run there is none — "this run",
"this and following" and "all occurrences" all move the same, only, block, so the question is a click that
cannot change the outcome.

`isWholeSeriesRun(taskId, runIdxs)` is the test, judged on the painted set (future and unfinished — the
exact set the bars loop draws) because the merged block the user is holding is what the question is about.
A run of one is deliberately NOT this case: nothing was merged, and a lone remaining occurrence is still
distinguishable from the series it belongs to. The scope applied is **`all`**, not `this`: it moves the
series WINDOW rather than writing a per-occurrence override for every member, so an unambiguous gesture
leaves no residue. `applyScope(scope, sp)` takes an optional prompt so the drag can reach the same body
without a round trip through the overlay.

## Subtask rows read as contained (owner report 2026-09-09)

*"Subtask row should be clearly indented."* Two things were wrong and the step size was the smaller.
`SUBTASK_INDENT_PX` is 20 (was 16 — under one character of the row's own 13px text), and a **guide rule
per ancestor level** is drawn through the whole row height: whitespace states depth only by comparison
with the row above, a rule states containment on the row you are looking at. A childless row **reserves
the collapse caret's column**, without which a leaf one level deeper than a parent started only ~4px
further right — the missing caret ate most of the step, so the indent was lying.

## Task links (owner ask 2026-09-09)

A task carries an ordered set of `{url, label}` — the pages and apps the work is done in, so starting it
is one gesture instead of hunting for six tabs. An app is not a second kind of thing: a deep link
(`obsidian://`, `slack://`) is a URL with another scheme.

The **scheme rule is a safety rule**. These strings become an `href`, so a `javascript:` URL from a bad
import or a hand-edited backup would be a script that runs when the user clicks their own task. It is
filtered in `normalizeTask` (everything entering memory), again in `taskLinks` at read time, and again in
`openTaskLink`. Anything else with a scheme is allowed — an allowlist of apps would be wrong the day
another one is installed.

The detail panel edits the set; the row chip and the row menu open it. "Open all" is the tab-group
gesture. Reading or writing the browser's REAL tabs needs an extension (`chrome.tabs`, `chrome.tabGroups`)
and is out of scope for a web page; this is the store such an extension would read from and write to.
