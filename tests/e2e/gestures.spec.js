const { test, expect } = require('@playwright/test');
const { boot } = require('./_seed');

/* THE reason this layer exists.
   `rowPointerDown` records a pending drag; `onMouseMove` promotes it to a real drag only past a 4px
   threshold, and a promoted drag sets `_suppressRowClick` so the drop does not also open the detail
   panel. That threshold is a property of REAL pointer input: a synthetic dispatched MouseEvent skips
   hit-testing and pointer capture, so it is not evidence. Playwright drives CDP, so these are trusted
   events on the real element under the cursor.

   The detail panel has no test id; its "Previous task" control exists nowhere else, so it is the
   behavioural probe. */

const detail = (page) => page.getByRole('button', { name: 'Previous task' });

async function firstRow(page) {
  const row = page.locator('[data-task-id]:not([data-card-id])').first();
  await expect(row).toBeVisible();
  return row;
}

test.describe('click vs drag disambiguation on a sheet row', () => {
  test('a press that moves under the 4px threshold is a click and opens details', async ({ page }) => {
    await boot(page);
    const row = await firstRow(page);
    const box = await row.boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;

    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 2, y + 2); /* under threshold on both axes */
    await page.mouse.up();

    await expect(detail(page)).toBeVisible();
  });

  test('a press that moves past the threshold is a drag and does NOT open details', async ({ page }) => {
    await boot(page);
    const row = await firstRow(page);
    const box = await row.boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;

    await page.mouse.move(x, y);
    await page.mouse.down();
    /* Stepped, so the app sees the same intermediate moves a human hand produces. */
    await page.mouse.move(x, y + 40, { steps: 8 });
    await page.mouse.up();

    await expect(detail(page)).toHaveCount(0);
  });

  test('a drag that is released still leaves the app interactive', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await boot(page);
    const row = await firstRow(page);
    const box = await row.boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;

    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 60, { steps: 10 });
    await page.mouse.up();

    /* A plain click after the drag must work: the suppression flag is one-shot, not sticky.
       Re-locate the row — the drag may have reordered the sheet under the old coordinates. */
    await (await firstRow(page)).click();
    await expect(detail(page)).toBeVisible();
    expect(errors, 'page errors during drag').toEqual([]);
  });
});
