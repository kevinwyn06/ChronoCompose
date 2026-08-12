const { test, expect } = require('@playwright/test');
const { boot, task, allottedByTask } = require('./_seed');

/* V5 block 15 / F1 — a sheet filter must not move the day.
 *
 * `renderVals` used to compute the allotment map from `_visTasks`, the sheet's FILTERED projection.
 * Clicking a priority chip therefore re-divided the pool among the surviving rows: every printed
 * "Allotted today" inflated, and every filtered-out task fell to 0 — which meant `flexAllot` returned
 * 0 and `buildDayTimeline` never even listed it as unscheduled.
 *
 * The existing pool-agreement check in `day-in-the-life.spec.js` cannot see this and is deliberately
 * left alone: both of its sides read the same `_allot`, so a poisoned map is self-consistent. This
 * spec instead compares the SAME task's figure before and after a filter — an external reference the
 * bug cannot satisfy. It is here rather than in the unit layer because the thing under test is a real
 * click on the real filter chip reaching the real render path.
 */

/* Wall-clock independent by construction: `packFromNow:false` (block 15 flipped the DEFAULT to true,
   so a fixture that wants a fixed pool must now say so explicitly). */
const settings = {
  allotMode: 'today', packFromNow: false, freeTime: 0,
  dayStart: '08:00', dayEnd: '18:00',
  lunchStart: '00:00', lunchEnd: '00:00', dinnerStart: '00:00', dinnerEnd: '00:00',
  minChunk: 30, breakMin: 0,
};

/* Three tasks, three priorities, so the P1 chip keeps exactly one row and hides two. */
const tasks = [
  task('f-a', 'Alpha', { start: '0d', end: '+1d', priority: 1, planned: 120 }),
  task('f-b', 'Beta', { start: '0d', end: '+1d', priority: 2, planned: 120 }),
  task('f-c', 'Gamma', { start: '0d', end: '+1d', priority: 3, planned: 240 }),
];

test('a sheet filter does not change "Allotted today"', async ({ page }) => {
  await boot(page, { tasks, settings });

  const before = await allottedByTask(page);
  expect(Object.keys(before).sort(), 'all three tasks are on the day').toEqual(['f-a', 'f-b', 'f-c']);
  const wasAlpha = before['f-a'];
  expect(wasAlpha, 'Alpha holds a real slice of the pool').toBeGreaterThan(0);

  /* Apply a real filter: the P1 quick-filter chip, which lives behind the filter bar's
     "Filters ▾" popover since the C3 demotion. */
  await page.locator('[title^="More filters"]').first().click();
  await page.locator('[title="Filter to P1"]').first().click();
  await expect(page.locator('[data-task-id="f-b"]'), 'the filter really hid the P2 row').toHaveCount(0);
  await expect(page.locator('[data-task-id="f-a"]'), 'the P1 row survived').toHaveCount(1);

  const after = await allottedByTask(page);
  expect(after['f-a'],
    'the day is the same day: filtering the sheet must not re-divide the pool').toBe(wasAlpha);
});
