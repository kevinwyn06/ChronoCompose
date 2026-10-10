# Architecture map

ChronoCompose is a single-page browser application in `index.html`: one `Component` class mounted with
React by a small bootstrap at the end of `<body>`. Feature code is marked `PP-EXT`. It is local/offline first, with
optional Supabase synchronization and Google Calendar integration.

Read one page, not the whole set:

| Subsystem | Page |
|---|---|
| Task model, persistence, workspaces, backup | `data-storage.md` |
| Allotment, dependencies, recurrence, daily packing | `scheduling.md` |
| Natural-language date/task parsing | `parser.md` |
| Supabase and Google Calendar | `sync-integrations.md` |
| App runtime, views, overlays, timers and UI conventions | `ui-runtime.md` |

Cross-cutting invariants: task mutations use `commit()`; task shape enters through `normalizeTask`; pure
helpers remain Node-VM testable; owned UI changes retain `PP-EXT` markers; new constants are named.

Two shape rules added 2026-08-16, both easy to get wrong from the outside (detail in `scheduling.md`):

- **`planned` is three-valued.** `null` = no time given, `0` = deliberately zero, `> 0` = an estimate. Code
  that treats a missing estimate and a zero estimate as the same value reintroduces the defect the
  2026-08-16 allotment rewrite fixed. `requestedMinutes(t, B)` is the only place that resolves the ladder.
- **"Is this appointment-shaped?" is `clockSpanMinutes(t, B) != null`.** `hasStartTime`/`hasEndTime` derive
  a clock from the timestamp, so "has both clocks" is a strictly wider set than "is an appointment" and
  matches plain multi-day windows. Using the two `has*Time` helpers directly for this question has already
  produced three separate defects.
- **Inside a `commit()` body, never ask an occurrence question through `_occById`.** That memo is built by
  RENDER, so while a mutator runs it still describes the dates as they were drawn. `clockSpanMinutes` routes
  through it (via `occOnDay`/`currentOcc`) and answered `setDate`/`dpApply` from pre-edit data for every
  RECURRING task — the 2026-08-19 "planned time did not update" report. Mutators use `anchorSpanMinutes(t)`,
  which reads the draft task. Do not "fix" this by clearing the memo mid-commit: its contents depend on
  `_horizon`, which only a render computes, so a mid-commit rebuild answers from a different window than the
  one on screen.

**Tooling:** call-site audits on `index.html` must use ripgrep (`rg -n` / the Grep tool). Bash `grep`
silently truncates the file, printing `Binary file index.html matches` and stopping without an error — a
review that trusted it reported a complete call-site list that was missing a reader.

Verification has two layers. `tests/*.test.js` (Node VM + mocked DOM) owns everything provable without a
browser. `tests/e2e/*.spec.js` (Playwright, real Chromium) owns only what the mock DOM structurally
cannot reach — trusted pointer input and a live mount. The boundary is deliberate: the mock DOM has no
hit-testing or pointer capture, so a gesture threshold cannot be proved there, and a dispatched
`MouseEvent` only looks like proof. See "Run and verify" in `AGENTS.md`.

For detail not yet distilled here, locate the exact heading in
`archive/docs/architecture-through-2026-07.md` with `rg` and read only that bounded section.
