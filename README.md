# Life Planner

A single-page Gantt + daily-timeline planner. It replaces the old Google Sheets / Apps Script time
tracker: tasks live in a Gantt chart with dependencies and a critical path, the old auto-scheduling
"today" timeline lives in a right-hand **drawer**, time tracking is done with per-task timers, and Google
Calendar can be imported/exported. All data is stored in the browser's **localStorage** (no backend yet).

## Run it

The app needs to be served over HTTP (Google OAuth refuses `file://`).

```sh
# from this directory
python -m http.server 8000
#   or:  npx serve -l 8000
```

Then open <http://localhost:8000/>.

### Run the tests

```sh
npm test        # node --test over tests/*.test.js — no dependencies to install
```

Files that must sit next to each other: `index.html`, `support.js`. The app also loads React, ReactDOM,
and Google Identity Services from CDNs, so you need an internet connection on first load.

## Google Calendar setup (one time)

Calendar import/export uses client-side OAuth. Signing in is a normal **Google popup**, but Google requires
every app that touches the Calendar API to be registered once — that registration is your **OAuth Client
ID**. You create it a single time; after that you just click **Sign in with Google**.

1. Go to <https://console.cloud.google.com/> → create (or pick) a project.
2. **APIs & Services → Library →** enable **Google Calendar API**.
3. **APIs & Services → OAuth consent screen →** configure it (External is fine; add yourself as a Test user).
4. **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application.**
   - Under **Authorized JavaScript origins** add the exact origin you serve from, e.g.
     `http://localhost:8000`.
   - You do **not** need a redirect URI (the token flow is popup-based).
5. Copy the **Client ID** (looks like `xx...apps.googleusercontent.com`).
6. Paste it **once** into `config.js` (`googleClientId: "..."`). A Client ID is public and safe to commit —
   only a client *secret* is sensitive, and this browser flow uses none.
7. In the app: **⚙ Settings → Google Calendar → Sign in with Google** (popup) → approve → tick the
   calendars you want → **Import**.

> Prefer not to touch `config.js`? You can instead type the Client ID into the field that appears in
> Settings when `config.js` has none — but pasting it into `config.js` once means you never type it again.

- **Import** pulls upcoming events into tasks (calendar name → `@tag`; a new task's **Planned** is the
  event's duration, all-day events left blank). Import is **one-way** (Calendar → app): your edits to
  Planned/Goal/notes live in the browser's localStorage and are never overwritten by re-importing.

## Where things live

| File | Purpose |
|---|---|
| `index.html` | The whole app (DC/React component). Our additions are wrapped in `PP-EXT` markers. |
| `config.js` | Your local config (Google Client ID). Not part of the design; never overwritten by re-syncs. |
| `support.js` | Claude Design (DC) runtime — mounts the component. **Never edit.** |
| `Project Planner.dc.html` | Verbatim copy of the original design file (for easy diffing against future exports). |
| `Project Planner.dc.baseline.html` | Same original, pinned as the merge baseline for re-syncs. |
| `architecture.md` | Technical reference (data model, algorithms, calendar flow, re-sync). |
| `DESIGN_WORKFLOW.md` | How to push changes to / pull changes from Claude Design (two-way). |
| `tools/build-design-file.js` | Generates the design-clean `Project Planner.dc.html` from `index.html`. |
| `tests/` | Node unit tests (`npm test`) for scheduling, timers, allotment, and calendar import. |
| `tasks.md` | Implementation backlog + what's deferred. |
| `CLAUDE.md` | Guidance for future Claude Code sessions. |
| `archive/` | The old Apps Script / Sheets frontend, kept for reference. |

See `architecture.md` for the data model and how the allotted-time / timeline logic was ported.
