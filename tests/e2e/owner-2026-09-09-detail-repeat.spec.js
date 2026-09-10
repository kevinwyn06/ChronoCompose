const { test, expect } = require('@playwright/test');
const { boot, task } = require('./_seed');

/* Owner report, 2026-09-09: *"I'm unable to change it in chronocompose from a recurring task to a non
   recurring task."* `setRecur` worked; it was reachable from exactly one place — the right-click menu on
   a Gantt bar. The detail panel, where every other fact about a task is edited, had no repeat control at
   all. This is e2e because the defect IS the control's presence and wiring in a real mount; the data half
   (dropping the rule collapses the series window) lives in tests/drop-repeat-collapses-window.test.js. */
test('the detail panel can turn a repeating task into a single one', async ({ page }) => {
  await boot(page, { tasks: [
    task('ep', 'Email follow-ups', {
      start: '+2d+7h', end: null, startClock: true, planned: 180,
      recur: { kind: 'day', n: 1, label: 'Daily', durMs: 180 * 60000, shifts: [], overrides: {} },
    }),
  ] });

  await page.locator('[data-task-id="ep"] [data-task-name]').click();
  await expect(page.getByText('DESCRIPTION', { exact: true })).toBeVisible({ timeout: 15000 });

  const sel = page.locator('[data-qa="detail-repeat"]');
  await expect(sel).toBeVisible();
  await expect(sel).toHaveValue('day', { timeout: 5000 });
  await expect(page.locator('[data-qa="detail-repeat-sub"]')).toContainText('3:00');

  await sel.selectOption('none');

  await expect(sel).toHaveValue('none');
  await expect(page.locator('[data-qa="detail-repeat-sub"]')).toHaveCount(0);
  /* Read the committed task back out of storage — the drop has to reach the DATA, not just the control. */
  await expect.poll(() => page.evaluate(() => {
    const t = JSON.parse(localStorage.getItem('pp-tasks') || '[]').find(x => x.id === 'ep');
    return t ? { recur: t.recur, len: t.end - t.start } : null;
  })).toEqual({ recur: null, len: 180 * 60000 });
});
