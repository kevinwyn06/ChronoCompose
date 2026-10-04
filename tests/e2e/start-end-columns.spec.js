const { test, expect } = require('@playwright/test');
const { boot, task } = require('./_seed');

test('Start and End cells distinguish bare dates from explicit clocks and open the shared picker', async ({ page }) => {
  await boot(page, { tasks: [
    task('bare-date', 'Bare date', { start:'0d', end:'+2d', startClock:null, endClock:null }),
    task('clocked', 'Clocked', { start:'0d', end:'+2d', startClock:true, endClock:true }),
  ] });

  const bare = page.locator('[data-task-id="bare-date"]');
  const clocked = page.locator('[data-task-id="clocked"]');
  await expect(page.locator('[data-colk="start"]')).toBeVisible();
  await expect(page.locator('[data-colk="end"]')).toBeVisible();
  await expect(bare.locator('[data-cellk="start"] [data-date-clock]')).toHaveCount(0);
  await expect(bare.locator('[data-cellk="end"] [data-date-clock]')).toHaveCount(0);
  await expect(clocked.locator('[data-cellk="start"] [data-date-clock]')).toBeVisible();
  await expect(clocked.locator('[data-cellk="end"] [data-date-clock]')).toBeVisible();

  await bare.locator('[data-cellk="start"]').click();
  await expect(page.locator('[data-qa="dp-head"]')).toHaveText(/^Start/); /* UI revamp block 4 */
  await page.keyboard.press('Escape');
  await bare.locator('[data-cellk="end"]').click();
  await expect(page.locator('[data-qa="dp-head"]')).toHaveText(/^End/); /* UI revamp block 4: "End", as the column says */
});
