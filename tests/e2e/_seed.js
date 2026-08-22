/* Workspace seeding for e2e.
   The whole app boots from scoped `pp-*` keys, so `addInitScript` — which runs before page scripts on
   the FIRST load — is the entire fixture mechanism. No navigate/write/re-navigate dance.

   Keys are written unscoped on purpose: `wsKey` only appends `::<workspace>` when a workspace is signed
   in, and e2e runs anonymous. See `architecture/data-storage.md`. */

const DAY = 86400000;

/** Midnight today, in the browser's local zone at page-eval time. */
const MIDNIGHT_EXPR = `(()=>{const d=new Date();d.setHours(0,0,0,0);return d.getTime();})()`;

/** Minimal task; `normalizeTask` fills every other field on load. */
function task(id, name, extra) {
  return Object.assign({ id, name, type: 'Proportional', included: true, planned: 60 }, extra || {});
}

/**
 * Seed localStorage before the app boots.
 * @param {import('@playwright/test').Page} page
 * @param {{tasks?: any[], settings?: object, prefs?: object, sections?: any[]}} data
 */
async function seed(page, data = {}) {
  const payload = {
    tasks: data.tasks || defaultTasks(),
    /* Block 31: the alpha usage tracker defaults ON in the app, which is right for the owner's own
       sessions and wrong for a test run — every spec would POST to the local sink and litter
       `.telemetry/`. Seed it OFF, and let the one spec that is ABOUT the tracker seed it back on. */
    settings: Object.assign({ usageTracking: false }, data.settings || {}),
    /* firstRunSeen suppresses the one-time 3-step coach overlay, which otherwise sits over the
       surfaces under test. */
    prefs: Object.assign({ firstRunSeen: true }, data.prefs || {}),
    sections: data.sections || [],
    /* Block 13: 'light' | 'dark'. `pp-theme` is a GLOBAL key read by the inline bootstrap at the very
       top of index.html, before React exists — seeding it is the only way to pin a theme deterministically
       (the fallback reads prefers-color-scheme, which a screenshot must not depend on). */
    theme: (data.theme === 'light' || data.theme === 'dark') ? data.theme : null,
    /* Block 13: running timers, as {taskId: minutesAlreadyRunning}. `startTimer` stamps
       `startedAt = Date.now()` and `stopTimerAt` credits the wall-clock delta, so backdating `startedAt`
       is how a journey gets a REALISTIC amount of accrued time (a tab left open over lunch) without the
       spec sleeping for it. `timerHeartbeat` only refreshes `beat`; it never settles or truncates a run. */
    run: data.run || null,
    /* Block 13: seed the fixture ONCE. Playwright cannot remove an init script, so without this a
       `page.reload()` would re-write `pp-tasks` from the fixture and silently erase everything the
       journey just did — which is exactly what "spent time survives a reload" has to prove. The chrome
       suppressors below are re-stamped on EVERY load regardless: they are not journey state, and the
       morning-summary modal keys off the day it is currently being read on. */
    once: !!data.seedOnce,
  };
  await page.addInitScript(([d, midnightExpr]) => {
    const midnight = eval(midnightExpr);
    const DAYMS = 86400000;
    const already = d.once && localStorage.getItem('e2e-seeded') === '1';
    /* Relative day offsets in fixtures are resolved here so fixtures never go stale as the wall
       clock advances — the same fix the date-picker drag fixture needed. */
    /* '+2d' · '0d+4h' · '0d+2h30m' — a day offset, then an optional clock offset within that day.
       The hour/minute tail is what lets a fixture express an APPOINTMENT (a task with a real clock
       span), which is the only way to make the packer split a flexible task into two blocks. */
    const OFF = /^([+-]?\d+)d(?:([+-]?\d+)h)?(?:([+-]?\d+)m)?$/;
    const resolve = (t) => {
      const o = Object.assign({}, t);
      /* Block 30b added `completion` and `archivedAt`: the capacity readout's "all done" state is
         defined by work FINISHED on a day, so a fixture has to be able to say when. Same relative
         syntax, same reason — an absolute stamp would go stale as the wall clock advances. */
      for (const k of ['start', 'end', 'due', 'snoozeUntil', 'completion', 'archivedAt']) {
        if (typeof o[k] !== 'string') continue;
        const m = OFF.exec(o[k]);
        if (!m) continue;
        o[k] = midnight + parseInt(m[1], 10) * DAYMS
          + (m[2] ? parseInt(m[2], 10) : 0) * 3600000
          + (m[3] ? parseInt(m[3], 10) : 0) * 60000;
      }
      /* PP-EXT (owner 2026-08-20): `onListSince` takes the SAME relative syntax but resolves to a `ymd`
         day KEY rather than epoch ms, because that is the shape the field stores (it is compared for
         identity, never arithmetic — see architecture/data-storage.md). Resolved here so a fixture can
         say "on the list since two days ago" without hard-coding a date that goes stale. */
      if (typeof o.onListSince === 'string') {
        const m = OFF.exec(o.onListSince);
        if (m) {
          const dt = new Date(midnight + parseInt(m[1], 10) * DAYMS);
          const p2 = n => String(n).padStart(2, '0');
          o.onListSince = dt.getFullYear() + '-' + p2(dt.getMonth() + 1) + '-' + p2(dt.getDate());
        }
      }
      /* Recurrence bounds are dates too. Keep them relative for the same reason as task edges: a
         finite recurring-run gesture fixture must not become wholly past as the wall clock advances. */
      if (o.recur && typeof o.recur.until === 'string') {
        const m = OFF.exec(o.recur.until);
        if (m) {
          o.recur = Object.assign({}, o.recur, { until: midnight + parseInt(m[1], 10) * DAYMS
            + (m[2] ? parseInt(m[2], 10) : 0) * 3600000
            + (m[3] ? parseInt(m[3], 10) : 0) * 60000 });
        }
      }
      return o;
    };
    if (!already) {
      localStorage.setItem('pp-tasks', JSON.stringify(d.tasks.map(resolve)));
      localStorage.setItem('pp-settings', JSON.stringify(d.settings));
      localStorage.setItem('pp-prefs', JSON.stringify(d.prefs));
      localStorage.setItem('pp-sections', JSON.stringify(d.sections));
      if (d.run) {
        const now = Date.now(); const r = {};
        Object.keys(d.run).forEach((id) => {
          const startedAt = now - Math.max(0, +d.run[id] || 0) * 60000;
          r[id] = { startedAt, beat: now };
        });
        localStorage.setItem('pp-run', JSON.stringify(r));
      }
      if (d.once) localStorage.setItem('e2e-seeded', '1');
    }
    if (d.theme) localStorage.setItem('pp-theme', d.theme);
    /* Mark today's morning summary as already raised. It is a centred modal that would otherwise sit
       over every surface under test on the first tick of a new calendar day. Re-stamped on every load,
       including a seed-once reload, because the day it must suppress is the day being loaded. */
    localStorage.setItem('pp-notify', JSON.stringify({ fired: {}, summaryDay: midnight }));
    /* 2026-08-19: the routines seed/migration lives in its own key (it runs from componentDidMount, not
       from runOnceMigrations, because it needs `state` and commit()). Marked done for the same reason
       as everything below: a fixture must contain exactly the tasks it seeded. The spec that is ABOUT
       routines clears this key itself. */
    localStorage.setItem('pp-mig-routines', '1');
    /* Mark every one-time migration done so a fixture is never silently rewritten on boot. */
    localStorage.setItem('pp-migrations', JSON.stringify({
      'allday-planned-zero': 1, 'pin-collapse': 1, 'sections-from-primary-tag': 1,
      /* 04: `t.pin` became a LIST; leaving this unmarked would let migrateDragPinList rewrite a
         pin-carrying fixture on boot, which is exactly what this key exists to prevent. */
      'drag-pin-list': 1,
      /* Allotment rules 2026-08-16. `migratePlannedNull` rewrites EVERY stored `planned:0` to `null`
         exactly once (before that pass, 0 and "never estimated" were the same value). Left unmarked it
         would erase the one distinction a fixture now has to be able to express, and a spec seeding
         `planned:0` would boot showing `—`. `uncompressable-rederive` is marked for the same reason:
         it RELEASES to null every stored value that merely restates the clock derivation, so a fixture
         that seeds the field explicitly would otherwise be un-seeded on boot. (The older
         `uncompressable-backfill` key no longer exists in the app; only this one is live.) */
      'planned-null-unset': 1, 'uncompressable-rederive': 1,
      /* Owner session 2026-08-17: fixtures express CURRENT inclusion state explicitly. The real
         migration cannot distinguish an old default true from a genuine press and would therefore
         rewrite future-window fixtures (and a press persisted across a seed-once reload). */
      'included-dated-default': 1,
    }));
  }, [payload, MIDNIGHT_EXPR]);
}

function defaultTasks() {
  return [
    task('e2e-1', 'Alpha task', { start: '0d', end: '+2d', priority: 1 }),
    task('e2e-2', 'Beta task', { start: '0d', end: '+1d', priority: 2 }),
    task('e2e-3', 'Gamma task', { start: '+1d', end: '+3d', priority: 3 }),
  ];
}

/** Load the app and wait for the React tree to mount. */
async function boot(page, data) {
  await seed(page, data);
  await page.goto('/index.html');
  await page.locator('[data-task-id]').first().waitFor({ state: 'attached', timeout: 15000 });
}

/**
 * Boot straight onto the Selection grid.
 *
 * V5 block 32: the Eisenhower matrix is RETIRED and unreachable, so this helper no longer has a second
 * destination — `'matrix'` is rejected loudly rather than silently seeding a pref that
 * `migrateLeftSurface` would rewrite to 'select', which would make a matrix spec look like it passed.
 *
 * V5 block 27a RE-POINTED this helper and nothing else: the two grids moved out of a Dashboard tab of
 * their own into Overview's LEFT pane, so the pref that puts them on screen is now `leftSurface` rather
 * than `dashMode:'plan'` + `planTab`. Every spec that calls `bootPlan` keeps its assertions verbatim —
 * which is the point of seeding the destination in one helper instead of clicking through tab chrome in
 * each spec. (The old pref pair is still honoured, by `migrateLeftSurface`; that path is pinned in the
 * unit layer, `tests/v2-plan-tab.test.js`, where it belongs.)
 *
 * Note this does NOT go through `boot`: `boot` waits for `[data-task-id]`, a task-sheet row, and on a
 * triage surface the sheet is not the left pane's content. It waits on a card instead.
 *
 * @param {import('@playwright/test').Page} page
 * @param {'select'} tab
 * @param {object} [data] same shape as `boot`
 */
async function bootPlan(page, tab, data) {
  if (tab === 'matrix') throw new Error('bootPlan: the matrix surface was retired in block 32');
  const d = Object.assign({}, data || {});
  d.prefs = Object.assign({ mainView: 'dashboard', dashMode: 'overview', dashModeV: 2,
    leftSurface: 'select' }, d.prefs || {});
  await seed(page, d);
  await page.goto('/index.html');
  await page.locator('[data-card-id]').first().waitFor({ state: 'attached', timeout: 15000 });
}

/**
 * Boot straight onto a dashboard mode ('focus' | 'review' | 'plan' | 'overview') or onto a page view
 * ('journal', 'stats', …). Seeded rather than clicked, for the same reason `bootPlan` seeds its tab.
 *
 * `dashModeV:2` is stamped for the same reason `bootPlan` stamps it: without it `migrateDashMode`
 * re-derives the mode from the legacy enum.
 *
 * Does NOT wait for `[data-task-id]` — a full-screen dashboard mode does not render the task sheet, so
 * `boot`'s own wait would time out. Callers wait on whatever they are about to assert.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{view?: string, dashMode?: string}} where
 * @param {object} [data] same shape as `boot`
 */
async function bootSurface(page, where, data) {
  const d = Object.assign({}, data || {});
  const pf = { firstRunSeen: true };
  if (where.view) pf.mainView = where.view;
  if (where.dashMode) { pf.mainView = pf.mainView || 'dashboard'; pf.dashMode = where.dashMode; pf.dashModeV = 2; }
  d.prefs = Object.assign(pf, d.prefs || {});
  await seed(page, d);
  await page.goto('/index.html');
}

/**
 * Settings that make the day's packing deterministic, mirroring the unit layer's `cleanDay`
 * (`tests/_load.js`): the whole window is one pool, no meals, no free-time reserve, and
 * `packFromNow:false` so the wall clock cannot move where blocks land.
 * @param {string} endHHMM window end, e.g. '10:00'
 */
/**
 * A meal as a TASK. From 2026-08-19 Lunch and Dinner are ordinary tasks in the Routines section, not two
 * clock pairs in `settings` — so a fixture that needs a real lunch window seeds one of these instead of
 * setting `lunchStart`/`lunchEnd`. An `uncompressable` clocked appointment is blocking busy through
 * `fixedBlocksToday`, which is exactly what the settings-derived block used to be.
 * @param {string} id
 * @param {string} name
 * @param {string} startOff `0d+12h30m` — the seed's day-offset-plus-clock form
 * @param {string} endOff
 */
function mealTask(id, name, startOff, endOff) {
  return task(id, name, {
    start: startOff, end: endOff, startClock: true, endClock: true,
    uncompressable: true, planned: null, priority: 4,
  });
}

function cleanDaySettings(endHHMM) {
  return {
    allotMode: 'today', packFromNow: false, freeTime: 0,
    dayStart: '00:00', dayEnd: endHHMM,
    lunchStart: '00:00', lunchEnd: '00:00', dinnerStart: '00:00', dinnerEnd: '00:00',
  };
}

/**
 * Boot straight onto the Today view, whose right pane is `renderDayColumn` — the vertical timeline
 * whose blocks carry the drag-to-pin gesture. Seeded, not clicked, for the same reason `bootPlan`
 * seeds its tab.
 *
 * Also waits out the first re-render: `renderDayColumn` paints once at the fallback `TL_PXPM` scale
 * and again once the ResizeObserver reports the pane height, so a box read too early is at the wrong
 * scale. `settleTimeline` waits for the geometry to stop moving.
 */
async function bootToday(page, data) {
  const d = Object.assign({}, data || {});
  d.prefs = Object.assign({ mainView: 'today' }, d.prefs || {});
  await boot(page, d);
  await page.locator(BLOCK_SEL).first().waitFor({ state: 'attached', timeout: 15000 });
  await settleTimeline(page);
}

/* V4.1 gave every timeline block a stable `data-tl-block` hook. Before that these were addressed by
   matching three tooltip STRINGS, so a copy change in `renderDayColumn` broke every spec here and read
   as a gesture regression. Address blocks by the attribute; never go back to the titles. */
const BLOCK_SEL = '[data-tl-block]';

/**
 * Every timeline block, top to bottom.
 * `day` is the epoch-ms midnight of the column the block was rendered into (`data-tl-day`), which is
 * what makes "it landed on the right DAY" assertable on the 4-Day/Week grid.
 * `kind` is 'auto' | 'pinned' | 'fixed' | 'meal' — V4.1's locked-vs-auto-scheduled distinction.
 * `ov` is block 12's overlap-layout left fraction (0 = full width).
 * @returns {Promise<{title,tip,x,y,w,h,ov,pinned,day,kind,taskId,bg,rail,borderW,borderStyle,borderColor}[]>}
 */
async function timelineBlocks(page) {
  const list = await page.$$eval(BLOCK_SEL, (els) => els.map((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      tip: el.getAttribute('title') || '',
      /* ⧉ is 04b's regroup control, ↺ is V4.3's Reset and 💤 is Task 19's per-day snooze — all render
         INSIDE the block like ✕ and ▶ do, so all of them have to come out of the title. 💤 is
         hover-gated, which means it appears mid-drag (the pointer is on the block) and a spec that did
         not strip it would silently stop finding the block it was dragging. */
      title: (el.textContent || '').replace(/[📍📌✕▶■⧉↺💤]/g, '').trim(),
      x: r.x, y: r.y, w: r.width, h: r.height,
      /* Block 12: the overlap layout's own answer for this block — the fraction of the block band its
         LEFT edge was stepped in by. Reading it alongside the box is what lets an overlap failure say
         "the rule returned 0.5 and the box did not follow" rather than leaving a pixel mystery. */
      ov: Number(el.getAttribute('data-tl-ov') || 0),
      day: Number(el.getAttribute('data-tl-day')),
      kind: el.getAttribute('data-tl-kind') || '',
      taskId: el.getAttribute('data-tl-task') || '',
      /* Owner ruling C1 (2026-08-21): a family is ONE block with its children as lines inside it, so a
         child's minutes are declared on the line rather than drawn as a height of their own. The block
         is still MEASURED; `drawnMinutes` only apportions that measurement across these. */
      kids: [...el.querySelectorAll('[data-tl-kid]')].map((k) => ({
        id: k.getAttribute('data-tl-kid'),
        min: Number(k.getAttribute('data-tl-kid-min') || 0),
      })),
      bg: cs.backgroundImage || '',
      rail: cs.boxShadow || '',
      /* V5 block 25b: the lock signal is border WIDTH first (survives greyscale) and colour second.
         Reported as three separate fields so a spec can assert the width channel on its own — a
         "locked blocks look different" test that only compared colour would still pass if the heavy
         border were replaced by a tint, which is exactly the failure this block has to make loud. */
      borderW: parseFloat(cs.borderTopWidth) || 0,
      borderStyle: cs.borderTopStyle || '',
      borderColor: cs.borderTopColor || '',
      pinned: el.getAttribute('data-tl-kind') === 'pinned',
    };
  }));
  return list.sort((a, b) => a.y - b.y);
}

/** The day columns of a 4-Day/Week grid, left to right: {day, isToday, x, w}. */
async function dayColumns(page) {
  const list = await page.$$eval('[data-tl-col]', (els) => els.map((el) => {
    const r = el.getBoundingClientRect();
    return { day: Number(el.getAttribute('data-tl-col')), isToday: el.getAttribute('data-tl-today') === '1', x: r.x, w: r.width };
  }));
  return list.sort((a, b) => a.x - b.x);
}

/** Blocks rendered inside ONE day column, addressed through the DOM rather than through `data-tl-day`,
 *  so the two hooks corroborate each other instead of restating the same attribute. */
async function blocksInColumn(page, dayMs) {
  return page.$$eval(`[data-tl-col="${dayMs}"] [data-tl-block]`, (els) => els.map((el) => ({
    title: (el.textContent || '').replace(/[📍📌✕▶■⧉]/g, '').trim(),
    day: Number(el.getAttribute('data-tl-day')),
    kind: el.getAttribute('data-tl-kind') || '',
  })));
}

/**
 * Boot straight onto a multi-day grid ('day4' = next 4 days, 'week' = the anchored Sun–Sat week).
 * Seeded rather than clicked, for the same reason `bootToday` seeds its view.
 */
async function bootDays(page, view, data) {
  const d = Object.assign({}, data || {});
  d.prefs = Object.assign({ mainView: view === 'week' ? 'week' : 'day4' }, d.prefs || {});
  await boot(page, d);
  await page.locator('[data-tl-col]').first().waitFor({ state: 'attached', timeout: 15000 });
  await settleTimeline(page);
}

/** Wait until two consecutive reads of the block geometry agree. */
async function settleTimeline(page) {
  let prev = '';
  for (let i = 0; i < 25; i++) {
    const now = JSON.stringify((await timelineBlocks(page)).map((b) => [Math.round(b.y), Math.round(b.h)]));
    if (now === prev && now !== '[]') return;
    prev = now;
    await page.waitForTimeout(80);
  }
}

/**
 * A real pointer drag from one element to another, past the 4px promotion threshold.
 * Stepped on purpose: the app promotes a pending drag on the FIRST move past the threshold and then
 * resolves the drop zone from `elementFromPoint` on every subsequent move, so a single jump would
 * exercise neither. Playwright's `page.mouse` issues trusted CDP input; a dispatched MouseEvent would
 * skip hit-testing and pointer capture and prove nothing here.
 */
async function dragBetween(page, fromLocator, toLocator) {
  const a = await fromLocator.boundingBox();
  const b = await toLocator.boundingBox();
  if (!a || !b) throw new Error('dragBetween: a locator had no box (not visible?)');
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
}

/* ===== Block 13: cross-subsystem readers =====================================================
   The journey spec asserts that two INDEPENDENT renderings of the same day agree — the allotment the
   sheet prints per task, and the minutes the timeline actually draws. Both are read off the DOM, for
   block 03's reason: there is no app handle on `window`, and reading state through a back door would
   only prove the back door works. */

/** `fmtDur`'s `h:mm` back to minutes. `'—'` (not included today) reads as null, never as 0. */
function parseDur(s) {
  const m = /^(\d+):(\d{2})$/.exec(String(s || '').trim());
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}

/**
 * Today's allotment per task, as the SHEET prints it — `taskFlowCell`'s `[title="Allotted today"]`
 * span inside each `[data-task-id]` card. This is `computeAllotted`'s answer, rendered.
 * Tasks not included today carry `title="Not included today"` and are absent from the map.
 * @returns {Promise<Record<string, number>>}
 */
async function allottedByTask(page) {
  const rows = await page.$$eval('[data-task-id]', (els) => els.map((el) => {
    const span = el.querySelector('[title="Allotted today"]');
    return { id: el.getAttribute('data-task-id'), txt: span ? (span.textContent || '') : null };
  }));
  const out = {};
  rows.forEach((r) => { if (r.txt == null) return; const v = parseDur(r.txt); if (v != null) out[r.id] = v; });
  return out;
}

/**
 * The minutes the timeline DRAWS, per task, read back out of block heights.
 *
 * `renderDayColumn` lays a block out as `height = max(13, minutes*px - 2)` in the app's LOCAL space,
 * which `getBoundingClientRect` then reports through the `zoom:0.8` wrapper at index.html:191. Both
 * the scale and the −2 inset are therefore unknown at read time, and guessing either one biases every
 * multi-chunk task by the number of chunks it has (a 3-chunk task read with an unscaled −2 comes back
 * ~3 minutes light — measured, not theorised).
 *
 * So calibrate with TWO blocks of known duration and solve `h = a·m + b` outright: `a` absorbs the
 * zoom and the pane scale, `b` absorbs the inset. Nothing about the app's internal units is assumed,
 * which also means a future zoom change cannot silently skew these numbers.
 *
 * @param {import('@playwright/test').Page} page
 * @param {Array<{pick: (b: any) => boolean, minutes: number}>} cal exactly two, each matching one block
 * @returns {Promise<{byTask: Record<string, number>, total: number, a: number, b: number}>}
 */
async function drawnMinutes(page, cal) {
  const blocks = await timelineBlocks(page);
  if (!Array.isArray(cal) || cal.length !== 2) throw new Error('drawnMinutes: needs exactly two calibrators');
  const pts = cal.map((c, i) => {
    const hit = blocks.filter(c.pick);
    if (hit.length !== 1) throw new Error(`drawnMinutes: calibrator ${i} matched ${hit.length} blocks, expected 1`);
    return { h: hit[0].h, m: c.minutes };
  });
  if (pts[0].m === pts[1].m) throw new Error('drawnMinutes: the two calibrators must differ in duration');
  const a = (pts[1].h - pts[0].h) / (pts[1].m - pts[0].m);
  const b = pts[0].h - a * pts[0].m;
  /* `Math.max(13, …)` clamps very short blocks, and a clamped block cannot be inverted — it reports
     the floor, not its duration. The fit already knows the scale: `b = −2·s`, so the floor in the
     same measured units is `13·s = −6.5·b`. Refuse rather than quietly return a wrong number; a
     fixture that produces slivers needs a bigger `minChunk`. */
  const floorPx = -6.5 * b;
  const byTask = {}; let total = 0; let clamped = 0;
  blocks.forEach((bl) => {
    /* 0.1px of slack: Chromium snaps layout to 1/64px, so a clamped block measures a hair over 13·s. */
    if (bl.h <= floorPx + 0.1) { clamped++; return; }
    if (bl.kind === 'meal' || !bl.taskId) return; /* meals are the day's furniture, not anyone's allotment */
    const mins = (bl.h - b) / a;
    total += mins;
    /* A family block's MEASURED minutes are apportioned across its declared child shares. The block is
       still the ruler — a height that drifts still fails — but the minutes land on the tasks the sheet
       actually charges, which under C1 are the children and not the parent that contains them. */
    const declared = bl.kids.reduce((n, k) => n + k.min, 0);
    if (bl.kids.length && declared > 0) {
      bl.kids.forEach((k) => { byTask[k.id] = (byTask[k.id] || 0) + mins * (k.min / declared); });
      return;
    }
    byTask[bl.taskId] = (byTask[bl.taskId] || 0) + mins;
  });
  if (clamped) throw new Error(`drawnMinutes: ${clamped} block(s) hit the 13px height floor and cannot be measured`);
  return { byTask, total, a, b };
}

/** Click one of the six main-view tabs by its label ('Gantt' | '4-Day' | 'Week' | 'Today' | …). */
async function switchView(page, label) {
  await page.locator(`[role="tab"][title="${label}"]`).click();
}

/**
 * Switch Overview's LEFT pane between its three surfaces (V5 block 27a).
 *
 * Before the rehoming, "go from the triage grid to the board" was a Dashboard TAB change. It is now a
 * pane change, because both live on Overview — so a spec that used to click the Overview tab to reach
 * the sheet has to click here instead, or it stays on the grid it was already looking at.
 *
 * @param {import('@playwright/test').Page} page
 * @param {'list'|'select'} key  (V5 block 32: 'matrix' retired — no such button exists)
 */
async function switchLeftSurface(page, key) {
  await page.locator(`[data-surface-btn="${key}"]`).click();
}

module.exports = {
  seed, boot, bootPlan, bootToday, bootDays, bootSurface, dragBetween, task, mealTask, defaultTasks, DAY,
  cleanDaySettings, timelineBlocks, settleTimeline, BLOCK_SEL, dayColumns, blocksInColumn,
  parseDur, allottedByTask, drawnMinutes, switchView, switchLeftSurface,
};
