/* UI revamp block 11b — the first minute, in a real browser.
 *
 * The unit layer (tests/ui-revamp-truth.test.js) proves the predicates. What only a live mount proves: that a
 * TRULY fresh browser (no seeded storage — the app seeds its own routines) shows the welcome; that the welcome's
 * own example, typed with real keys, closes quick add and lands on today's Day timeline; that a zh-CN browser
 * still reads English dates; that the habit ⋯ menu closes on a real outside press and on Escape; and that the
 * top bar says "Local only" while signed out.
 */
const { test, expect } = require('@playwright/test');
const { seed } = require('./_seed');

test.use({ locale: 'zh-CN', viewport: { width: 1600, height: 900 } });

/* The audit's moment: Sunday 2026-10-04, 3pm local. A fixed clock keeps "by Friday" and the day's free time
   identical on every run. */
const AUDIT_DAY = () => new Date(2026, 9, 4, 15, 0, 0, 0);

test('fresh workspace: welcome → "Finish the report by Friday 2pm" → quick add closes, today has it, dates stay English', async ({ page }) => {
  await page.clock.install({ time: AUDIT_DAY() });
  await page.addInitScript(() => { try { localStorage.setItem('pp-settings', JSON.stringify({ usageTracking: false })); } catch (e) {} });
  await page.goto('/index.html');
  const welcome = page.locator('[data-pp-dialog="firstrun"]');
  await expect(welcome, 'routines are seeded, and the welcome still shows').toBeVisible();
  await expect(welcome).toContainText('Welcome to ChronoCompose');
  await expect(page.getByText('Good morning')).toHaveCount(0);
  await expect(page.locator('[data-sync-status]')).toContainText('Local only');

  await page.locator('[data-qa="firstrun-add"]').click();
  await page.keyboard.type('Finish the report by Friday 2pm');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-pp-dialog="quick"]'), 'quick add closes after the add').toHaveCount(0);
  await expect(welcome).toHaveCount(0);

  const rows = page.locator('[data-task-id]:not([data-card-id])').filter({ hasText: 'Finish the report' });
  await expect(rows, 'one task').toHaveCount(1);
  await expect(rows.first().locator('[data-cellk="end"]')).toContainText(/Oct|Nov|Dec|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep/);
  const body = await page.locator('body').innerText();
  expect(body, 'no machine-locale dates (月/日/星期)').not.toMatch(/\d+月\d+日|星期/);

  await page.locator('[data-view-key="today"]').click();
  await expect(page.locator('[data-tl-block]').filter({ hasText: 'Finish the report' }).first(),
    'it lands on TODAY\'s timeline').toBeVisible();
});

test('Load demo keeps the welcome for later, files the demo into sections, and nothing starts Unscheduled', async ({ page }) => {
  await page.clock.install({ time: AUDIT_DAY() });
  await page.addInitScript(() => { try { localStorage.setItem('pp-settings', JSON.stringify({ usageTracking: false })); } catch (e) {} });
  await page.goto('/index.html');
  await page.getByRole('button', { name: 'Load demo tasks' }).click();
  await expect(page.getByText('No section', { exact: true })).toHaveCount(0);
  for (const n of ['Work', 'Study', 'Personal']) await expect(page.locator('[data-section-id]').filter({ hasText: n }).first()).toBeVisible();
  await page.locator('[data-view-key="today"]').click();
  await expect(page.locator('[data-tl-block]').first()).toBeVisible();
  await expect(page.locator('[data-tl-unsched]'), 'the demo day fits').toHaveCount(0);
  await page.getByRole('button', { name: 'Clear demo' }).click();
  await expect(page.locator('[data-pp-dialog="firstrun"]'), 'clearing the demo brings the welcome back').toBeVisible();
});

test('habit ⋯ menu closes on a real outside press and on Escape', async ({ page }) => {
  await page.addInitScript(() => {
    const d0 = new Date(); d0.setHours(0, 0, 0, 0);
    localStorage.setItem('pp-habits', JSON.stringify([{ id: 'h1', name: 'Stretch', schedule: { kind: 'daily', days: [] },
      taskIds: [], done: {}, createdAt: d0.getTime() - 3 * 86400000 }]));
  });
  await seed(page, { prefs: { mainView: 'dashboard', dashMode: 'review', dashModeV: 2 } });
  await page.goto('/index.html');
  const btn = page.locator('[data-habit-menu="h1"]');
  await btn.waitFor({ timeout: 15000 });
  await btn.click();
  await expect(page.locator('[data-habit-delete="h1"]')).toBeVisible();
  await page.mouse.click(1500, 850);
  await expect(page.locator('[data-habit-delete="h1"]'), 'outside press closes it').toHaveCount(0);
  await btn.click();
  await expect(page.locator('[data-habit-delete="h1"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-habit-delete="h1"]'), 'Escape closes it').toHaveCount(0);
  await expect(btn).toBeFocused();
});
