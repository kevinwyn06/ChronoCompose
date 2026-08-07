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
    settings: data.settings || {},
    /* firstRunSeen suppresses the one-time 3-step coach overlay, which otherwise sits over the
       surfaces under test. */
    prefs: Object.assign({ firstRunSeen: true }, data.prefs || {}),
    sections: data.sections || [],
  };
  await page.addInitScript(([d, midnightExpr]) => {
    const midnight = eval(midnightExpr);
    const DAYMS = 86400000;
    /* Relative day offsets in fixtures are resolved here so fixtures never go stale as the wall
       clock advances — the same fix the date-picker drag fixture needed. */
    /* '+2d' · '0d+4h' · '0d+2h30m' — a day offset, then an optional clock offset within that day.
       The hour/minute tail is what lets a fixture express an APPOINTMENT (a task with a real clock
       span), which is the only way to make the packer split a flexible task into two blocks. */
    const OFF = /^([+-]?\d+)d(?:([+-]?\d+)h)?(?:([+-]?\d+)m)?$/;
    const resolve = (t) => {
      const o = Object.assign({}, t);
      for (const k of ['start', 'end', 'due', 'snoozeUntil']) {
        if (typeof o[k] !== 'string') continue;
        const m = OFF.exec(o[k]);
        if (!m) continue;
        o[k] = midnight + parseInt(m[1], 10) * DAYMS
          + (m[2] ? parseInt(m[2], 10) : 0) * 3600000
          + (m[3] ? parseInt(m[3], 10) : 0) * 60000;
      }
      return o;
    };
    localStorage.setItem('pp-tasks', JSON.stringify(d.tasks.map(resolve)));
    localStorage.setItem('pp-settings', JSON.stringify(d.settings));
    localStorage.setItem('pp-prefs', JSON.stringify(d.prefs));
    localStorage.setItem('pp-sections', JSON.stringify(d.sections));
    /* Mark today's morning summary as already raised. It is a centred modal that would otherwise sit
       over every surface under test on the first tick of a new calendar day. */
    localStorage.setItem('pp-notify', JSON.stringify({ fired: {}, summaryDay: midnight }));
    /* Mark every one-time migration done so a fixture is never silently rewritten on boot. */
    localStorage.setItem('pp-migrations', JSON.stringify({
      'allday-planned-zero': 1, 'pin-collapse': 1, 'sections-from-primary-tag': 1,
      /* 04: `t.pin` became a LIST; leaving this unmarked would let migrateDragPinList rewrite a
         pin-carrying fixture on boot, which is exactly what this key exists to prevent. */
      'drag-pin-list': 1,
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
 * Boot straight onto the Plan tab's Selection or Matrix grid.
 *
 * `dashMode` alone is not enough: `migrateDashMode` only TRUSTS a stored 'plan' when `dashModeV===2`
 * is present too (a legacy 'plan' meant the scheduling board and is remapped to 'overview'). Seeding
 * both is what makes the first paint the grid under test, with no click-through to get there —
 * a click-through would make every one of these specs depend on the tab chrome as well.
 *
 * @param {import('@playwright/test').Page} page
 * @param {'select'|'matrix'} tab
 * @param {object} [data] same shape as `boot`
 */
async function bootPlan(page, tab, data) {
  const d = Object.assign({}, data || {});
  d.prefs = Object.assign({ dashMode: 'plan', dashModeV: 2, planTab: tab === 'matrix' ? 'matrix' : 'select' }, d.prefs || {});
  await boot(page, d);
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
 * @returns {Promise<{title,tip,x,y,w,h,ov,pinned,day,kind,taskId,bg,rail}[]>}
 */
async function timelineBlocks(page) {
  const list = await page.$$eval(BLOCK_SEL, (els) => els.map((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      tip: el.getAttribute('title') || '',
      /* ⧉ is 04b's regroup control and ↺ is V4.3's Reset, which render inside the block like ✕ and ▶ do. */
      title: (el.textContent || '').replace(/[📍📌✕▶■⧉↺]/g, '').trim(),
      x: r.x, y: r.y, w: r.width, h: r.height,
      /* Block 12: the overlap layout's own answer for this block — the fraction of the block band its
         LEFT edge was stepped in by. Reading it alongside the box is what lets an overlap failure say
         "the rule returned 0.5 and the box did not follow" rather than leaving a pixel mystery. */
      ov: Number(el.getAttribute('data-tl-ov') || 0),
      day: Number(el.getAttribute('data-tl-day')),
      kind: el.getAttribute('data-tl-kind') || '',
      taskId: el.getAttribute('data-tl-task') || '',
      bg: cs.backgroundImage || '',
      rail: cs.boxShadow || '',
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

module.exports = {
  seed, boot, bootPlan, bootToday, bootDays, bootSurface, dragBetween, task, defaultTasks, DAY,
  cleanDaySettings, timelineBlocks, settleTimeline, BLOCK_SEL, dayColumns, blocksInColumn,
};
