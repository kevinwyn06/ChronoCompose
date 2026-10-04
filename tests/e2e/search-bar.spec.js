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
/* UI revamp block 2: the preview tooltip is gone — search filters live, and the field shows the count. */
const COUNT = '[data-pp-search-count]';
const openFilters = async (page) => {
  await page.locator('[data-pp-filterbtn]').click();
  await expect(page.locator('[data-pp-filterpop="1"]')).toBeVisible();
};
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

/* UI revamp block 2: `/` is the search key the field advertises; `s` still works (above). */
test('/ focuses the search field and is not typed into it', async ({ page }) => {
  await boot(page, FIXTURE);
  await page.keyboard.press('/');
  await expect(page.locator(SEARCH)).toBeFocused();
  await expect(page.locator(SEARCH)).toHaveValue('');
});

/* UI revamp block 2 (supersedes "preview, then Enter"): the sheet filters as you type, after a short
   debounce; Enter still applies at once. */
test('typing filters live; the field shows the match count; Enter applies at once', async ({ page }) => {
  await boot(page, FIXTURE);
  const rows = page.locator(ROW);
  await expect(rows).toHaveCount(3);

  await page.keyboard.press('s');
  await page.keyboard.type('report');
  await expect(rows).toHaveCount(2);                // no Enter — the debounce applied it
  await expect(page.locator(COUNT)).toHaveText('2');

  await page.locator(SEARCH).fill('milk');
  await page.locator(SEARCH).press('Enter');
  await expect(rows).toHaveCount(1);

  await page.locator(SEARCH).fill('zzzz');
  await expect(page.locator(COUNT)).toHaveText('No match');
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

test('the horizon and the Included chip are parked while a search runs', async ({ page }) => {
  await boot(page, FIXTURE);
  await page.keyboard.press('s');
  await page.keyboard.type('report');
  await page.keyboard.press('Enter');
  /* Parked, NOT removed: the user has to be able to see what is coming back. */
  await openFilters(page);
  await expect(page.locator('[data-pp-seg="horizon"]')).toHaveCount(1);
  await expect(page.locator('[data-pp-chip="incl"]')).toHaveCount(1);
  await expect(page.locator('[data-pp-seg="horizon"]')).toHaveCSS('pointer-events', 'none');
  await expect(page.locator('[data-pp-chip="incl"]')).toHaveCSS('pointer-events', 'none');
});

test('Escape clears the search and restores the pre-search horizon', async ({ page }) => {
  await boot(page, FIXTURE);
  const notch = '[data-pp-seg="horizon"] [data-seg-key="1m"]';
  await openFilters(page);
  await page.locator(notch).click();
  await expect(page.locator(`${notch}[data-active="1"]`)).toHaveCount(1);
  await page.keyboard.press('Escape');               // close the popover

  await page.keyboard.press('s');
  await page.keyboard.type('report');
  await page.keyboard.press('Enter');
  await expect(page.locator(ROW)).toHaveCount(2);

  await page.keyboard.press('s');
  await page.keyboard.press('Escape');
  await expect(page.locator(SEARCH)).toHaveValue('');
  await openFilters(page);
  await expect(page.locator(`${notch}[data-active="1"]`)).toHaveCount(1);
  await expect(page.locator(ROW)).toHaveCount(3);
});
