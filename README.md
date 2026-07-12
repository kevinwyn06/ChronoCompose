# Life Planner

A single-page Gantt + daily-timeline planner. It replaces the old Google Sheets / Apps Script time
tracker: tasks live in a Gantt chart with dependencies and a critical path, the old auto-scheduling
"today" timeline lives in a right-hand **drawer**, time tracking is done with per-task timers, and Google
Calendar can be imported/exported. Data is stored in the browser's **localStorage** and, if you connect
an account, synced to a **Supabase** backend (offline-first — localStorage stays authoritative on-device).
Cloud sync is **optional**: with no Supabase keys in `config.js` the app runs entirely local, exactly as
before. See "Cloud sync setup" below and `plans/backend-migration-roadmap.md`.

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

Files that must sit next to each other: `index.html`, `support.js`, `config.js`. The app also loads React,
ReactDOM, Google Identity Services, and the Supabase client from CDNs, so you need an internet connection
on first load.

### Deploy it (Vercel — private repo, free)

The app is a static site (no build) — Vercel serves it straight from the private GitHub repo. `vercel.json`
assembles a `dist/` with **only the 3 runtime files** (`index.html`, `config.js`, `support.js`), so `plans/`,
`archive/`, `tests/`, and docs are never published. One-time setup:

1. Vercel dashboard → **Add New… → Project** → import the `ChronoCompose` repo (authorize the Vercel GitHub app).
2. Leave build settings empty so `vercel.json` supplies them (framework: Other; no env vars needed — keys live
   in `config.js`). Deploy → note the production URL. **This project is live at
   <https://chrono-compose.vercel.app/>** (note the hyphen).
3. **Branch model:** `main` is the **deployment branch** (Vercel production = the default branch); `dev` is for
   ongoing work. Deploy a new version by merging `dev → main` (a normal release merge, same as the git workflow)
   — Vercel auto-builds `main` on every push. Pushes to `dev`/feature branches get preview URLs, not production.
4. **Google Cloud** → your OAuth Client → **Authorized JavaScript origins**: add your production origin
   (for this project: `https://chrono-compose.vercel.app` — no trailing slash, no path).
5. **Supabase** → Authentication → **URL Configuration**: set **Site URL** to your production URL with a trailing
   slash (`https://chrono-compose.vercel.app/`) and add both it and `…/index.html` to **Redirect URLs**, so the
   magic link returns to the deployed app.

> **Allow-listed origins on record (2026-07-12):** `https://chrono-compose.vercel.app` is registered in the
> Google OAuth client's JavaScript origins, and `https://chrono-compose.vercel.app/` + `…/index.html` in
> Supabase's Redirect URLs. Magic-link sign-in on the deployed site is verified working (B2 owner e2e passed).

Public keys in `config.js` (gcal Client ID, Supabase publishable key) ship in the bundle — that's fine (they're
public by design). No secret ever ships. Your data is protected by Supabase Row-Level Security, not by the
repo being private.

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
  event's duration, all-day events left blank). Your edits to Planned/notes live in the browser's
  localStorage and are never overwritten by re-importing.
- **Auto-sync**: once connected, the app re-imports automatically — when you change the selected calendars
  or the import window, and in the background while the tab is open (interval configurable in Settings,
  default 60s). "Import now" forces one immediately. (Instant push on Calendar changes isn't possible from a
  static client-side app; it would need a server.)
- **Two-way sync (beta, Settings toggle, off by default)**: when on, your local changes push to Google —
  tasks you create become events in a dedicated **ChronoCompose** calendar, edits to imported tasks update
  their own calendar, and deleting a linked task deletes its event. Writes are debounced/queued (they
  survive reloads and expired sign-ins). Name/times/recurrence round-trip; Planned, Spent, descriptions
  and pins stay local. When off, import is one-way (Calendar → app) as before.
- **Descriptions** are rich text (bold/italic, bullet + numbered lists). Edit them in a task's detail view,
  or click the ▸ chevron next to a task name to expand an inline editor beneath the row.

## Cloud sync setup (optional, one time)

Sync backs up your data and syncs it across devices via a free Supabase project. Skip this to stay fully
local. Full walkthrough (project creation, migrations, RLS): `plans/backend-migration-roadmap.md`.

1. Create a Supabase project and apply the migrations in `supabase/` (see that plan's B0 steps).
2. In the Supabase dashboard → **Project Settings → API**, copy the **Project URL** and the **anon / public**
   key. Both are public and safe to commit — the same rule as the Google Client ID. **Never** copy the
   `service_role` key anywhere in the repo.
3. Paste them into `config.js` as `supabaseUrl` and `supabaseAnonKey`.
4. In the dashboard → **Authentication → URL Configuration → Redirect URLs**, add the exact URL you serve
   the app at (e.g. `http://localhost:8000/index.html`) so the sign-in link returns to the app.
5. In the app: **Settings → Integrations → Account**, enter your email, **Send magic link**, then open the
   link **in the same browser**. You're signed in and your data syncs automatically.

The sign-in session is kept **in memory only** — reloading the tab signs you out (re-send a link), a
deliberate security tradeoff (no token is ever written to disk). Your local data is untouched by signing
out; edits made while signed out queue and push on the next sign-in.

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
