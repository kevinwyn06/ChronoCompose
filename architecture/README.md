# Architecture map

ChronoCompose is a single-page browser application in `index.html`, mounted as a Codex Design document by
the opaque `support.js` runtime. Owned extensions are marked `PP-EXT`. It is local/offline first, with
optional Supabase synchronization and Google Calendar integration.

Read one page, not the whole set:

| Subsystem | Page |
|---|---|
| Task model, persistence, workspaces, backup | `data-storage.md` |
| Allotment, dependencies, recurrence, daily packing | `scheduling.md` |
| Natural-language date/task parsing | `parser.md` |
| Supabase and Google Calendar | `sync-integrations.md` |
| Design runtime, views, overlays, timers and UI conventions | `ui-runtime.md` |

Cross-cutting invariants: task mutations use `commit()`; task shape enters through `normalizeTask`; pure
helpers remain Node-VM testable; owned UI changes retain `PP-EXT` markers; new constants are named.

Verification has two layers. `tests/*.test.js` (Node VM + mocked DOM) owns everything provable without a
browser. `tests/e2e/*.spec.js` (Playwright, real Chromium) owns only what the mock DOM structurally
cannot reach — trusted pointer input and a live mount. The boundary is deliberate: the mock DOM has no
hit-testing or pointer capture, so a gesture threshold cannot be proved there, and a dispatched
`MouseEvent` only looks like proof. See "Run and verify" in `AGENTS.md`.

For detail not yet distilled here, locate the exact heading in
`archive/docs/architecture-through-2026-07.md` with `rg` and read only that bounded section.
