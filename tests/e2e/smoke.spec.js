const { test, expect } = require('@playwright/test');
const { boot } = require('./_seed');

/* Replaces the ad-hoc `chrome --headless=new --dump-dom` mount check with something that fails loudly
   and records WHY. A clean console is part of the assertion: the old check only proved the DOM had
   text in it. */
test.describe('mount', () => {
  test('boots with seeded tasks and a clean console', async ({ page }) => {
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));

    await boot(page);

    await expect(page.locator('[data-task-id]').first()).toBeVisible();
    await expect(page.getByText('Alpha task').first()).toBeVisible();
    await expect(page.getByText('Gantt').first()).toBeVisible();
    expect(errors, 'console errors on boot').toEqual([]);
  });

  test('an empty workspace still mounts', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('/index.html');
    await expect(page.getByText('Gantt').first()).toBeVisible();
    expect(errors, 'page errors on empty boot').toEqual([]);
  });
});
