// @ts-check
/* Bulk snooze from the multi-select row menu, under REAL input.
 *
 * The unit layer (tests/bulk-snooze.test.js) pins what each duration writes. What only a live mount proves
 * is that the typed "until…" box inside the menu actually TAKES a phrase with a space in it: the menu's own
 * key handler (menuKeyDown) claims Space, Enter and the arrows for item navigation, so a box that did not
 * stop its keys would swallow "3 days" into "3days" or fire the focused item instead.
 */
const { test, expect } = require('@playwright/test');
const { boot, task } = require('./_seed');

const TASKS = [
  task('t1', 'First', { start: '0d', end: '+1d' }),
  task('t2', 'Second', { start: '0d', end: '+1d' }),
  task('t3', 'Third', { start: '0d', end: '+1d' }),
];
const row = (page, id) => page.locator(`[data-pp-row][data-task-id="${id}"]`);
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('pp-tasks')));

test('right-click on a multi-selection → type "3 days" → both rows snooze, the third does not', async ({ page }) => {
  await boot(page, { tasks: TASKS, prefs: { mainView: 'gantt' } });
  await row(page, 't1').waitFor({ state: 'visible' });
  await page.keyboard.down('Control');
  await row(page, 't1').locator('[data-task-name]').click();
  await row(page, 't2').locator('[data-task-name]').click();
  await page.keyboard.up('Control');
  await row(page, 't2').locator('[data-task-name]').click({ button: 'right' });
  const menu = page.locator('[data-pp-menu="row"]');
  await expect(menu).toBeVisible();
  await expect(menu).toContainText('2 tasks selected');
  const box = menu.locator('[data-pp-snooze-until]');
  await box.click();
  await page.keyboard.type('3 days');
  await expect(box, 'Space reached the box').toHaveValue('3 days');
  await page.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  const tasks = await stored(page);
  const until = (id) => tasks.find((t) => t.id === id).snoozeUntil;
  expect(until('t1')).not.toBeNull();
  expect(until('t1')).toBe(until('t2'));
  expect(until('t3')).toBeNull();
  await expect(page.locator('[role="status"]').filter({ hasText: '2 tasks snoozed until' })).toBeVisible();
});
