/* UI revamp block 2 — the plan pane's one header strip, against a live mount. The view list, the
   per-view controls and the zoom arithmetic are unit-tested (tests/ui-revamp-plan-toolbar.test.js); this
   file covers what only a browser can show: that Today really scrolls the Gantt back to today, that − / +
   really change the drawn day width, and that the divider's double-click reset lands on a real width. */
const { test, expect } = require('@playwright/test');
const { boot, bootSurface, task } = require('./_seed');

const TASKS = [
  task('g-1', 'Near work', { start: '0d', end: '+2d' }),
  task('g-2', 'Far work', { start: '+200d', end: '+202d' }),
];

/* The Gantt scroller's horizontal position, in its own local px. */
async function todayVisible(page) {
  return page.evaluate(() => {
    const sc = document.querySelector('[data-gantt-scroll="1"]');
    return { scrollLeft: sc.scrollLeft, clientWidth: sc.clientWidth };
  });
}

test('Today scrolls the Gantt back to today after scrolling away', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await bootSurface(page, { view: 'gantt' }, { tasks: TASKS });
  const sc = page.locator('[data-gantt-scroll="1"]');
  await expect(sc).toBeVisible();
  const start = (await todayVisible(page)).scrollLeft;

  await page.locator('[data-pp-planhead] [data-pp-step="1"]').click();
  await page.locator('[data-pp-planhead] [data-pp-step="1"]').click();
  const away = (await todayVisible(page)).scrollLeft;
  expect(away, '› steps the Gantt later').toBeGreaterThan(start + 100);

  await page.locator('[data-pp-planhead] [data-pp-today]').click();
  const back = await todayVisible(page);
  expect(back.scrollLeft, 'Today brings the Gantt back').toBeLessThan(away - 100);
});

test('− / + change the Gantt day width and the zoom label', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await bootSurface(page, { view: 'gantt' }, { tasks: TASKS });
  const sc = page.locator('[data-gantt-scroll="1"]');
  await expect(sc).toBeVisible();
  const w0 = await sc.evaluate((el) => el.scrollWidth);
  await page.locator('[data-pp-zoom="in"]').click();
  await page.locator('[data-pp-zoom="in"]').click();
  await expect.poll(() => sc.evaluate((el) => el.scrollWidth)).toBeGreaterThan(w0 * 1.3);
  const w1 = await sc.evaluate((el) => el.scrollWidth);
  await page.locator('[data-pp-zoom="out"]').click();
  await expect.poll(() => sc.evaluate((el) => el.scrollWidth)).toBeLessThan(w1);
  await expect(page.locator('[data-pp-zoom-label]')).toHaveText(/^(Day|Week|Month)$/);
});

test('Week steppers move the period and Today returns it', async ({ page }) => {
  await boot(page, { prefs: { mainView: 'week' }, tasks: TASKS });
  const label = page.locator('[data-pp-planhead] [data-pp-period]');
  const today = page.locator('[data-pp-planhead] [data-pp-today]');
  const now = await label.textContent();
  await expect(today).toBeDisabled();
  await page.locator('[data-pp-planhead] [data-pp-step="1"]').click();
  await expect(label).not.toHaveText(now);
  await expect(today).toBeEnabled();
  await today.click();
  await expect(label).toHaveText(now);
});

test('the divider: double-click forgets a dragged width', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await boot(page, { prefs: { mainView: 'today' }, seedOnce: true, tasks: TASKS });
  const pane = page.locator('[data-sheet-pane="1"]');
  const divider = page.locator('[data-pane-divider="sheet"]');
  const w0 = (await pane.boundingBox()).width;
  const d = await divider.boundingBox();
  await page.mouse.move(d.x + d.width / 2, d.y + 60);
  await page.mouse.down();
  await page.mouse.move(d.x - 200, d.y + 60, { steps: 8 });
  await page.mouse.up();
  expect((await pane.boundingBox()).width).toBeLessThan(w0 - 120);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pp-prefs')).viewSplit.agenda)).toBeGreaterThan(0);

  await divider.dblclick();
  await expect.poll(async () => (await pane.boundingBox()).width).toBeCloseTo(w0, 0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pp-prefs')).viewSplit.agenda)).toBeUndefined();
});
