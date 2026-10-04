// @ts-check
/* UI revamp block 3 — the undo snackbar, under real input.
 *
 * The message text, the Undo semantics and the toast replacement rules are pinned in the unit layer
 * (tests/ui-revamp-undo-toast.test.js). What only a live mount can show: that a REAL Delete key and a
 * REAL Gantt drag raise a visible toast, that its Undo button is clickable by a real pointer (it sits in
 * a fixed region inside the 0.8-zoomed shell), and that the restored state is what the user sees.
 */
const { test, expect } = require('@playwright/test');
const { boot, bootSurface, task } = require('./_seed');

const rows = (page) => page.locator('[data-task-id]:not([data-card-id])');
const toast = (page) => page.locator('[data-pp-toast]');
const undoBtn = (page) => page.locator('[data-pp-toast-undo]');
const detailOpen = (page) => page.getByRole('button', { name: 'Previous task' });
const closeSheet = (page) => page.getByRole('button', { name: 'Close (Esc)' });
/* e2e runs anonymous, so the task store is the unscoped `pp-tasks` key (see _seed.js). */
const storedStart = (page) => page.evaluate(() =>
  (JSON.parse(localStorage.getItem('pp-tasks') || '[]').find((t) => t.id === 'g-long') || {}).start);

test('Delete key → toast names the task → Undo puts the row back', async ({ page }) => {
  await boot(page);
  await expect(rows(page).filter({ hasText: 'Beta task' })).toHaveCount(1);
  /* Light the row with the sheet shut — the state the Delete shortcut operates in (see
     selection-keyboard.spec.js for why the sheet's ✕ is the honest route there). */
  const box = await rows(page).filter({ hasText: 'Beta task' }).locator('[data-task-name]').boundingBox();
  if (!box) throw new Error('no row box');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(detailOpen(page)).toBeVisible();
  await closeSheet(page).click();
  await expect(detailOpen(page)).toHaveCount(0);

  await page.keyboard.press('Delete');
  await expect(rows(page).filter({ hasText: 'Beta task' })).toHaveCount(0);
  await expect(toast(page)).toBeVisible();
  await expect(toast(page)).toContainText('Deleted “Beta task”');
  await expect(page.locator('[data-pp-toast-region]')).toHaveAttribute('aria-live', 'polite');

  const ub = await undoBtn(page).boundingBox();
  if (!ub) throw new Error('no Undo box');
  expect(ub.height, 'the Undo hit box renders at least 24px tall').toBeGreaterThanOrEqual(24);
  await page.mouse.click(ub.x + ub.width / 2, ub.y + ub.height / 2);
  await expect(rows(page).filter({ hasText: 'Beta task' })).toHaveCount(1);
  await expect(toast(page)).toContainText('Undone');
});

test('a Gantt bar drag → toast → Undo returns the bar', async ({ page }) => {
  await bootSurface(page, { view: 'gantt' }, {
    tasks: [
      task('g-long', 'Ship the release', { start: '-2d', end: '+6d', priority: 1, planned: 300 }),
      task('g-other', 'Renew passport', { start: '+1d', end: '+2d', priority: 3, planned: 45 }),
    ],
  });
  const BAR = '[data-gantt-tip^="Ship the release ·"]';
  await page.locator(BAR).first().waitFor({ state: 'visible', timeout: 15000 });
  const start0 = await storedStart(page);
  const before = await page.locator(BAR).first().boundingBox();
  if (!before) throw new Error('no bar box');
  const p = { x: before.x + before.width / 2, y: before.y + before.height / 2 };
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 160, p.y, { steps: 14 });
  await page.mouse.up();

  await expect(toast(page)).toContainText('Moved “Ship the release”');
  /* Read the persisted dates rather than the bar's x: the Gantt re-fits its range after a drop, so the
     bar's screen position is not a stable measure of the task's dates. */
  await expect.poll(() => storedStart(page), { message: 'the drag re-dated the task' }).toBeGreaterThan(start0);

  await undoBtn(page).click();
  await expect.poll(() => storedStart(page), { message: 'Undo restores the original dates' }).toBe(start0);
  await expect(toast(page)).toContainText('Undone');
});

test('bare `a` puts the caret in the new task’s title, so typing names it', async ({ page }) => {
  await boot(page);
  await page.keyboard.press('a');
  const ed = page.locator('[data-qa="title-editor"]');
  await expect(ed).toBeFocused();
  await page.keyboard.type('Buy milk');
  await page.keyboard.press('Enter');
  await expect(rows(page).filter({ hasText: 'Buy milk' })).toHaveCount(1);
  await expect(rows(page).filter({ hasText: 'New task' })).toHaveCount(0);
});
