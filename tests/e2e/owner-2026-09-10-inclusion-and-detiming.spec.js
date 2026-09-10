// @ts-check
/* ACCEPTANCE → AUTOMATION. Owner report, 2026-09-10:
 *   "If a task starts on sept 16, I have no idea why it would be auto included in today. … Also,
 *    frequently I can't delete the time from a date."
 *
 * The RULES are unit-covered (`tests/owner-2026-09-10-future-start.test.js`). Two things are not, and
 * both are gestures rather than arithmetic:
 *
 *  · the Gantt bar drag was the one date-writing path that never re-derived inclusion, because it
 *    persists through `saveTasks` instead of `commit()`. Whether it re-derives is a fact about a real
 *    drag — `dragMoved` is only set when pointer travel crosses a whole day column, so a dispatched
 *    MouseEvent proves nothing here (AGENTS.md).
 *  · "I can't delete the time" is a fact about the PICKER: the time field commits on blur and the task
 *    commits on Done, so the failure only appears when a real pointer moves between the two.
 */
const { test, expect } = require('@playwright/test');
const { bootSurface, task } = require('./_seed');

const stored = (page, id) => page.evaluate((tid) => {
  const t = JSON.parse(localStorage.getItem('pp-tasks') || '[]').find((x) => x.id === tid);
  return t ? { start: t.start, end: t.end, included: t.included, includedExplicit: t.includedExplicit } : null;
}, id);
const midnight = (page) => page.evaluate(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); });

test.describe('a bar drag into the future takes the task off today', () => {
  const BAR = '[title^="Ship the release ·"]';

  test('dragging next week clears the creation-default press', async ({ page }) => {
    await bootSurface(page, { view: 'gantt' }, {
      tasks: [task('g-long', 'Ship the release', { start: '0d', end: '+1d', planned: 120 })],
    });
    await page.locator(BAR).first().waitFor({ state: 'visible', timeout: 15000 });
    const before = await stored(page, 'g-long');
    expect(before.included, 'premise: it starts today and is on the list').toBe(true);

    const box = await page.locator(BAR).first().boundingBox();
    if (!box) throw new Error('the bar had no box');
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(x + i * 25, y);
    await page.mouse.up();

    const mid = await midnight(page);
    await expect.poll(async () => {
      const t = await stored(page, 'g-long');
      return t && t.start > mid ? t.included : 'not-moved-yet';
    }, { message: 'the drag re-derives inclusion, like every other direct date edit' }).toBe(null);

    /* The row agrees: an unpressed checkbox, not a pressed one. This is the half the owner actually
       sees — the stored flag only explains it. */
    await page.locator('[data-date-cell="start"]').first().waitFor({ state: 'visible', timeout: 15000 })
      .catch(() => {});
    const glyph = page.locator('[data-incl-glyph="g-long"]').first();
    if (await glyph.count()) await expect(glyph).toHaveText('☐');
  });
});

test.describe('deleting a time deletes only that edge', () => {
  const openStartPicker = async (page) => {
    await page.locator('[data-date-cell="start"]').first().waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('[data-date-cell="start"]').first().click();
    await expect(page.locator('[data-dp-mer]').first()).toBeVisible();
  };

  test('clearing the 9am off a 9–10am appointment leaves the 10am end alone', async ({ page }) => {
    await bootSurface(page, { view: 'plan' }, {
      tasks: [task('appt', 'Dentist', { start: '+6d+9h', end: '+6d+10h', planned: 60 })],
    });
    await openStartPicker(page);

    const timeField = page.locator('input.pp-num[placeholder="—"]');
    await expect(timeField, 'premise: the picker is showing the 9am clock').toHaveValue('9:00');
    await timeField.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Backspace');
    await page.getByRole('button', { name: 'Done' }).click();

    const mid = await midnight(page);
    const hours = (ms) => (ms - mid - 6 * 86400000) / 3600000;
    await expect.poll(async () => {
      const t = await stored(page, 'appt');
      return t ? [hours(t.start), hours(t.end)] : null;
    }, { message: 'the start loses its clock and the end does NOT slide back nine hours' })
      .toEqual([0, 10]);
  });
});
