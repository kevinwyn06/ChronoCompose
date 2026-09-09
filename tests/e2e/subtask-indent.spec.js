/* Owner report 2026-09-09: *"subtask row should be clearly indented."*
 *
 * This is a claim about what reaches the screen — a computed offset and a guide rule that has to be
 * painted and visible — so it is checked against a live mount rather than against the element tree the
 * mock DOM returns. Two things are asserted, because the report has two halves: each level really is
 * pushed further right than its parent, and the indent is more than whitespace.
 */
const { test, expect } = require('@playwright/test');
const { bootSurface, task } = require('./_seed');

const fixture = () => ({
  tasks: [
    task('p', 'Plan the trip', { start: '+0d', end: '+3d' }),
    task('c', 'Book flights', { start: '+0d', end: '+1d', parentId: 'p' }),
    task('g', 'Compare fares', { start: '+0d', end: '+1d', parentId: 'c' }),
  ],
});

test('each nesting level is visibly further in, with a guide rule per ancestor', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await bootSurface(page, { view: 'gantt' }, fixture());
  await page.locator('[data-row-depth]').first().waitFor({ state: 'attached', timeout: 15000 });

  const nameX = async name => {
    const el = page.locator(`b[data-task-name="1"]`, { hasText: name }).first();
    const box = await el.boundingBox();
    return box.x;
  };
  const parent = await nameX('Plan the trip');
  const child = await nameX('Book flights');
  const grand = await nameX('Compare fares');

  expect(child - parent).toBeGreaterThanOrEqual(16);
  expect(grand - child).toBeGreaterThanOrEqual(16);

  // The guides are what make one row legible on its own, without comparing it to the row above.
  const guides = async name => page.evaluate(n => {
    const b = [...document.querySelectorAll('b[data-task-name="1"]')].find(x => x.textContent === n);
    const block = b && b.closest('[data-row-depth]');
    return block ? block.querySelectorAll('[data-indent-guide]').length : -1;
  }, name);
  expect(await guides('Plan the trip')).toBe(0);
  expect(await guides('Book flights')).toBe(1);
  expect(await guides('Compare fares')).toBe(2);
});
