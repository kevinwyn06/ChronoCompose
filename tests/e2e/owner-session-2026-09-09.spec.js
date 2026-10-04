/* Owner session 2026-09-09 — the two reports whose fix is only provable against a live mount.
 *
 * The decision logic behind both lives in tests/owner-session-2026-09-09.test.js, where it belongs: it
 * is pure and the mock DOM reaches all of it. What only this layer can show is that the real gestures
 * arrive at that logic — a trusted Ctrl+Z through the live key handler, and a right-click → menu →
 * modal chain that the mock DOM has no hit-testing to deliver.
 *
 *   1. "deleting section not control z able"
 *   2. "I edit a daily recurrance by deleting it and it just comes back"
 */
const { test, expect } = require('@playwright/test');
const { boot, task } = require('./_seed');

test.describe('owner session 2026-09-09', () => {

  test('Ctrl+Z restores a deleted section and re-files the tasks it dissolved', async ({ page }) => {
    await boot(page, {
      sections: [{ id: 's1', name: 'Research', order: 0 }],
      tasks: [task('r1', 'Read the spec', { sectionId: 's1', start: '0d', end: '+2d' })],
    });

    const header = page.locator('text=Research').first();
    await expect(header).toBeVisible();

    await page.locator('[title="Delete section (its tasks move to No section)"]').first().click();
    /* UI revamp block 3: the delete is now announced — the undo toast names the section, so the
       "header is gone" check is scoped to the sheet rather than the whole page. */
    await expect(page.locator('[data-sheet-pane] >> text=Research')).toHaveCount(0);
    await expect(page.locator('[data-pp-toast]')).toContainText('Section “Research” deleted');

    // The gesture under test: one trusted Ctrl+Z through the app's own key handler.
    await page.keyboard.press('Control+z');

    await expect(page.locator('[data-sheet-pane] >> text=Research').first()).toBeVisible();
    // The section is back AND the task is filed in it again — one undo, both stores.
    const filed = await page.evaluate(() => {
      const tasks = JSON.parse(localStorage.getItem('pp-tasks') || '[]');
      const secs = JSON.parse(localStorage.getItem('pp-sections') || '[]');
      return { sectionIds: secs.map(s => s.id), taskSection: (tasks.find(t => t.id === 'r1') || {}).sectionId };
    });
    expect(filed.sectionIds).toEqual(['s1']);
    expect(filed.taskSection).toBe('s1');
  });

  test('deleting one occurrence of a daily repeat moves the row on instead of leaving it put', async ({ page }) => {
    await boot(page, {
      tasks: [task('r1', 'Standup', {
        start: '-3d+9h', end: '-3d+10h', startClock: true, endClock: true,
        recur: { kind: 'day', n: 1, label: 'Daily', shifts: [], overrides: {} },
      })],
    });

    const row = page.locator('[data-task-id="r1"]').first();
    await expect(row).toBeVisible();
    const startCell = row.locator('[data-cellk="start"]');
    const shown = (await startCell.innerText()).trim();
    expect(shown).not.toBe('');

    // Right-click the row → Delete → "This occurrence only". A repeat never deletes straight from the
    // menu; it asks for a scope first, and that modal is what the fix routes through.
    await row.click({ button: 'right' });
    await page.locator('text=Delete').first().click();
    await expect(page.locator('text=Delete repeating task')).toBeVisible();
    await page.locator('text=This occurrence only').click();

    // The series survives — deleting one occurrence is not deleting the task.
    await expect(page.locator('[data-task-id="r1"]').first()).toBeVisible();
    // And the date the owner was looking at is no longer the one on the row. Compared through
    // innerText, not toHaveText: the cell renders the day and the clock on two lines, and textContent
    // runs them together — matching that against an innerText snapshot passes for free and proves
    // nothing (it did, against the unfixed build, which is how this assertion was caught).
    await expect.poll(async () => (await startCell.innerText()).trim()).not.toBe(shown);

    // Exactly one occurrence was struck, and it is the one that had been on screen.
    const overrides = await page.evaluate(() => {
      const t = JSON.parse(localStorage.getItem('pp-tasks') || '[]').find(x => x.id === 'r1');
      const ov = (t && t.recur && t.recur.overrides) || {};
      return Object.keys(ov).filter(k => ov[k] && ov[k].deleted);
    });
    expect(overrides).toHaveLength(1);
  });

});
