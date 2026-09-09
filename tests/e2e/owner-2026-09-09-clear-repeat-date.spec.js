const { test, expect } = require('@playwright/test');
const { boot, task } = require('./_seed');

/* Owner report, 2026-09-09: *"the clear button on start/end date edit panel does not work, at least on
   recurring tasks."* `clearDate` always wrote null; what failed was the readback — the End cell showed
   the repeat's next OCCURRENCE (rule-derived, so nothing the Clear could touch) while the picker it
   opens writes the SERIES WINDOW. The press therefore looked like a no-op.

   This has to be e2e: the defect is the round trip between a cell and the editor it opens, through a
   real click on a real overlay. The unit half (Clear writes null; the cell renders an em-dash for null)
   lives in tests/owner-2026-09-09-defects.test.js. */
test('Clear on a repeat\'s End cell visibly clears the series window', async ({ page }) => {
  await boot(page, { tasks: [
    task('rep', 'Daily standup', {
      start: '-30d+9h', end: '+40d', startClock: true,
      recur: { kind: 'day', n: 1, label: 'Daily', durMs: 3600000, shifts: [], overrides: {} },
    }),
  ] });

  const endCell = page.locator('[data-task-id="rep"] [data-cellk="end"] [data-date-cell="end"]');
  await expect(endCell).toBeVisible();
  await expect(endCell).not.toHaveText('—', { useInnerText: true });

  await endCell.click();
  await expect(page.getByText('DUE · WHOLE SERIES', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear' }).click();

  await expect(page.locator('[data-task-id="rep"] [data-cellk="end"]')).toHaveText('—');
});
