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

For detail not yet distilled here, locate the exact heading in
`archive/docs/architecture-through-2026-07.md` with `rg` and read only that bounded section.
