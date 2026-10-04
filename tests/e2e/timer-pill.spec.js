/* UI revamp block 9 — a running timer is visible outside its row.
 *
 * The unit layer (tests/ui-revamp-timer.test.js) proves the pill model, the title string, the block's
 * elapsed bar and the Pomodoro rule as functions. What only a browser proves: that a REAL press on the
 * row's play button puts the pill in the live top bar, that the 1 s tick actually advances it, that
 * `document.title` (which the mock DOM has no tab for) follows, and that a real press on the pill's Stop
 * ends the timer and credits the time.
 */
const { test, expect } = require('@playwright/test');
const { boot } = require('./_seed');

const rows = (page) => page.locator('[data-task-id]:not([data-card-id])');
const pill = (page) => page.locator('[data-timer-pill]');
const spentOf = (page, id) => page.evaluate((tid) => {
  const ts = JSON.parse(localStorage.getItem('pp-tasks') || '[]');
  const t = ts.find((x) => x.id === tid); return t ? (t.spent || 0) : -1;
}, id);
const secs = (txt) => txt.split(':').map(Number).reduce((a, n) => a * 60 + n, 0);

test('play → pill with name and ticking elapsed, tab title follows → pill Stop ends it and credits time', async ({ page }) => {
  await boot(page);
  await expect(pill(page), 'idle: no pill, no placeholder').toHaveCount(0);
  expect(await page.title()).toBe('ChronoCompose');

  await rows(page).nth(0).hover();
  await rows(page).nth(0).locator('[data-cellk="actions"] button[title="Start timer"]').click();

  await expect(pill(page)).toHaveCount(1);
  await expect(pill(page).locator('[data-timer-pill-name]')).toHaveText('Alpha task');
  const el = pill(page).locator('[data-timer-pill-elapsed]');
  const first = secs(await el.textContent());
  await expect.poll(async () => secs(await el.textContent()), { message: 'elapsed advances each second', timeout: 5000 })
    .toBeGreaterThan(first);
  await expect.poll(() => page.title()).toMatch(/^▶ \d+:\d\d · Alpha task — ChronoCompose$/);

  /* The pill sits in the top bar, right of the primary nav — and, since UI revamp block 11b, at the right
     end of the bar, immediately left of the gear (the {{ drawertoggle }} slot, no new placeholder). */
  const nav = await page.locator('[data-topnav]').boundingBox();
  const box = await pill(page).boundingBox();
  expect(box.x).toBeGreaterThan(nav.x + nav.width - 1);
  const gear = await page.getByRole('button', { name: 'Settings', exact: true }).boundingBox();
  expect(box.x + box.width, 'the pill ends left of the gear').toBeLessThanOrEqual(gear.x + 0.5);
  expect(gear.x - (box.x + box.width), 'and sits right beside it').toBeLessThan(24);
  /* Stop renders at least HIT_MIN_PX (24) under the 0.8 shell zoom. */
  const stopBox = await pill(page).locator('[data-timer-pill-stop]').boundingBox();
  expect(stopBox.width).toBeGreaterThanOrEqual(23.5);
  expect(stopBox.height).toBeGreaterThanOrEqual(23.5);

  await page.waitForTimeout(1200); // accrue a measurable amount
  await pill(page).locator('[data-timer-pill-stop]').click();
  await expect(pill(page)).toHaveCount(0);
  await expect.poll(() => page.title()).toBe('ChronoCompose');
  expect(await spentOf(page, 'e2e-1'), 'the stop credited spent time').toBeGreaterThan(0);
  const run = await page.evaluate(() => JSON.parse(localStorage.getItem('pp-run') || '{}'));
  expect(Object.keys(run)).toEqual([]);
});

test('clicking the pill name opens the running task; T stops it from the keyboard', async ({ page }) => {
  await boot(page, { run: { 'e2e-2': 5 } });
  await expect(pill(page).locator('[data-timer-pill-name]')).toHaveText('Beta task');
  await expect(pill(page).locator('[data-timer-pill-elapsed]')).toHaveText(/^5:\d\d$/);
  await pill(page).locator('[data-timer-pill-name]').click();
  await expect(page.locator('[data-pp-dialog="detail"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-pp-dialog="detail"]')).toHaveCount(0);
  await page.keyboard.press('t');
  await expect(pill(page)).toHaveCount(0);
  expect(await spentOf(page, 'e2e-2')).toBeGreaterThan(4.9);
});
