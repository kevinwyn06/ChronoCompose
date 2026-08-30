/* PP-EXT (owner 2026-08-25, filter-bar redesign): the search field against a live mount. The grammar
   itself is a unit table (tests/search-query.test.js); this file covers only what a browser is genuinely
   needed for — the real `s` hotkey under the real editing guard, the live preview NOT moving the sheet,
   and Escape restoring the parked horizon. */
const { test, expect } = require('@playwright/test');
const { boot } = require('./_seed.js');

/* Raw task objects, not `_seed.js`'s `task()` helper: that helper stamps `included:true`, which makes a
   task survive every horizon by owner ruling — see tests/e2e/filter-bar.spec.js. */
const T = (id, name, extra) =>
  Object.assign({ id, name, type: 'Proportional', planned: 60 }, extra || {});

const FIXTURE = {
  seedOnce: true,
  tasks: [
    T('a', 'Write report', { labels: ['work'], start: '+1d', end: '+2d' }),
    T('b', 'Buy milk',     { labels: ['home'], start: '+1d', end: '+2d' }),
    T('c', 'Read report',  { labels: ['home'], start: '+1d', end: '+2d' }),
  ],
};

const SEARCH = '[data-pp-search="1"]';
const PREVIEW = '[data-pp-search-preview="1"]';
const ROW = '[data-task-id]';

test('s focuses the search field, and is inert while typing in a row', async ({ page }) => {
  await boot(page, FIXTURE);
  await page.keyboard.press('s');
  await expect(page.locator(SEARCH)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator(SEARCH)).not.toBeFocused();

  /* Inside another field the bare letter must reach the field being typed into, not the filter bar —
     exactly the guard `isEditingTarget` provides, and unreachable from the mocked DOM. Quick-add is the
     precise probe for it: no detail panel is open, so `isEditingTarget` is the only thing standing
     between the keystroke and the search field. */
  await page.keyboard.press('q');
  const quick = page.locator('input[placeholder^="Quick add"]');
  await expect(quick).toBeFocused({ timeout: 5000 });
  await page.keyboard.type('s');
  await expect(page.locator(SEARCH)).not.toBeFocused();
  await expect(quick).toHaveValue('s');
});

test('typing previews without changing the sheet; Enter applies', async ({ page }) => {
  await boot(page, FIXTURE);
  const rows = page.locator(ROW);
  const before = await rows.count();

  await page.keyboard.press('s');
  await page.keyboard.type('report');
  await expect(page.locator(PREVIEW)).toContainText('2 matches');
  await expect(rows).toHaveCount(before);          // the sheet must NOT move while typing

  await page.keyboard.press('Enter');
  await expect(rows).toHaveCount(2);
  await expect(page.locator(PREVIEW)).toHaveCount(0);
});

test('a tag token filters, and negation excludes', async ({ page }) => {
  await boot(page, FIXTURE);
  const rows = page.locator(ROW);

  await page.keyboard.press('s');
  await page.keyboard.type('@home');
  await page.keyboard.press('Enter');
  await expect(rows).toHaveCount(2);

  await page.locator(SEARCH).fill('-@home');
  await page.locator(SEARCH).press('Enter');
  await expect(rows).toHaveCount(1);
});

test('the horizon and group controls are parked while a search runs', async ({ page }) => {
  await boot(page, FIXTURE);
  await page.keyboard.press('s');
  await page.keyboard.type('report');
  await page.keyboard.press('Enter');
  /* Parked, NOT removed: the user has to be able to see what is coming back. */
  await expect(page.locator('[data-pp-seg="horizon"]')).toHaveCount(1);
  await expect(page.locator('[data-pp-seg="group"]')).toHaveCount(1);
  await expect(page.locator('[data-pp-seg="horizon"]')).toHaveCSS('pointer-events', 'none');
});

test('Escape clears the search and restores the pre-search horizon', async ({ page }) => {
  await boot(page, FIXTURE);
  const notch = '[data-pp-seg="horizon"] [data-seg-key="1m"]';
  await page.locator(notch).click();
  await expect(page.locator(`${notch}[data-active="1"]`)).toHaveCount(1);

  await page.keyboard.press('s');
  await page.keyboard.type('report');
  await page.keyboard.press('Enter');
  await expect(page.locator(ROW)).toHaveCount(2);

  await page.keyboard.press('s');
  await page.keyboard.press('Escape');
  await expect(page.locator(SEARCH)).toHaveValue('');
  await expect(page.locator(`${notch}[data-active="1"]`)).toHaveCount(1);
  await expect(page.locator(ROW)).toHaveCount(3);
});
